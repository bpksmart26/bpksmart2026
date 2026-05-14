# 코드 리뷰 — bpksmart2026

**작성일:** 2026-05-14
**리뷰어:** Claude Code (Opus 4.7) + 3개 병렬 서브에이전트
**범위:** 프로젝트 전체 (Apps Script 백엔드 + HTML/JS 프론트엔드)
**리뷰 영역:** ID 생성 로직 · 동시성 · 데이터 정합성

---

## 0. 사용자 추가 컨텍스트 (2026-05-14 17:xx)

- **장비 모델 중복(`BPK-MRP-2500` on id=5 & id=11)은 시트에서 이미 수정 완료, 웹 반영됨.** 따라서 `eq_default.js`의 중복은 historical artifact이며 운영 영향 없음. 단, **코드 레벨의 매칭 패턴(name/model cross-match)** 은 여전히 fragile하므로 견적 item에 `eqId`를 영구 저장하는 구조적 fix는 유효한 권장 사항으로 남김.
- 운영 데이터의 SSoT는 시트(`BPK_장비`), `eq_default.js`는 seed/오프라인 폴백.

---

## 1. 요약

- 코드베이스는 동시성 하드닝이 **진행 중**: 견적 ID 충돌 가드 + LockService(`saveQuoteWithVersion`), 가이드 메일 version 멱등성, `_pdfInProgress` 게이트, `_resolveTargetFolder` 폴더 락 등 핫스팟에 보호가 들어가 있음.
- 그러나 보호가 **고르지 못함**: 신청 시트 쓰기, `upsertUnified`/`pushToNotion` 후크 체인, 마이그레이션 함수들은 무방비.
- 최근 fix(`_pdfInProgress` 게이트 + `qt` 객체 직접 전달)는 견적 재발급 race의 한 증상은 막았지만 인접 경로에 같은 race가 살아 있음.
- 시트가 SSoT이고 외부 노션은 보조라는 구조 자체는 합리적이지만, 둘 사이의 sync가 lock 밖에서 일어나 drift가 누적될 수 있음.

전체 평가: **현재 운영에서 데이터가 실제로 손상되거나 잘못 전달될 수 있는 결함이 7건, 곧 부딪힐 위험 10건, 브리틀 7건.**

---

## 2. 🔥 최상위 위험 (TOP 7)

### T1. 신청 ID `NO-YYMMDD-XXXX`가 4자리 random + 서버 충돌 가드 0건

- **위치:** `신청기업_장비신청.html:2186-2188` (클라이언트 발급) + `apps_script/Code.gs:115-117` (서버 `saveApp`)
- **코드:**
  ```js
  const _seq=String(1000+Math.floor(Math.random()*9000));
  const id=`NO-${_dc}-${_seq}`;
  ```
  ```js
  case 'saveApp':
    result = appendRow(SN.APP, APP_COLS, APP_ARR, data);
  ```
- **문제:** 9000개 ID 공간에서 birthday-paradox 충돌 확률이 30건/일 ≈ 5%, 60건/일 ≈ 20%. 충돌 시 `_findApp(appId)`가 첫 일치만 반환 → 두 번째 신청자의 견적·가이드 메일이 다른 회사로 전송. `deleteApps`가 모든 매칭 행을 삭제하는 코드로 보아 시트가 이미 중복을 허용 중.
- **권장 수정:** `saveApp`에 `saveQuoteWithVersion`과 동일한 `existingIds.has(clientId)` 가드 추가, 또는 ID 발급을 서버로 이관.

### T2. `appendRow` / `updateRow` / `upsertRow`에 LockService 전무

- **위치:** `Code.gs:355-365, 367-384, 688-701`
- **문제:** 견적 시트는 보호되지만 그 외 모든 시트 쓰기는 무방비. `getLastRow()+1 → setValues` 패턴은 동시 실행 시 같은 행에 덮어쓰는 고전 race. 두 신청자가 0.5초 이내 신청하면 한 건이 사라짐 (재현 가능, 가설 아님).
- **권장 수정:** 세 함수를 `LockService.getScriptLock().waitLock(10000)` + try/finally release로 래핑.

### T3. 장비 ID 클라이언트 `Math.max(...localStorage)+1` — 락 없음 + `upsertRow`가 충돌 시 silent overwrite

- **위치:** `공급기업_관리.html:2121` (발급) → `Code.gs:688-701 upsertRow`
- **코드:**
  ```js
  const newId = Math.max(...equipment.map(e=>e.id), 0) + 1;
  ```
- **문제:** 두 디바이스(또는 두 탭)에서 거의 동시에 장비를 추가하면 같은 id를 받아 `upsertRow`가 **에러 없이 한 쪽을 덮어씀**. 한 쪽 장비가 통째로 사라짐.
- **권장 수정:** `Utilities.getUuid()`로 서버 발급하거나, 견적 ID와 동일한 max+1 + LockService 패턴.

### T4. 장비 cross-match 패턴이 name/model 기반 — 시트는 수정됐지만 코드는 여전히 fragile

- **위치:** `공급기업_관리.html:2532-2540 (genPDF)`, `:2961-2969 (genEquipPDF)`, `:2361 (openQuoteModal)`
- **코드:**
  ```js
  const found = equipment.find(e =>
    (item.eqId && String(e.id) === String(item.eqId)) ||
    e.name === item.name ||
    (item.model && item.model !== '-' && e.model === item.model)
  );
  ```
- **문제:** 저장된 견적 item에 `eqId`가 없어 결국 name/model fallback에 의존. 시트에서 같은 model이 다시 들어오면 같은 버그 재발. **최근 fix(`_pdfInProgress` + qt 직접 전달)는 `quotes.find` 레이스 한 증상만 막은 것** — 장비 spec PDF는 여전히 잘못된 장비 사진을 가져올 수 있음.
- **사용자 컨텍스트:** `eq_default.js`의 중복 자체는 시트에서 수정 완료. 즉 즉각적 incident는 없으나 구조적 위험은 남아있음.
- **권장 수정:** `getQData`에서 item에 `eqId`를 영구 저장 → 매칭은 `String(e.id) === String(item.eqId)` 우선, name/model은 fallback만.

### T5. `saveQt` 후크 체인이 lock 외부 — `upsertUnified` + `pushToNotion`이 무방비 + `_safeSync`가 에러 침묵

- **위치:** `Code.gs:140-163` (saveQt case)
- **코드:**
  ```js
  case 'saveQt':
    result = saveQuoteWithVersion(data);   // ← 이까지만 lock
    _safeSync('upsertUnified after saveQt', function() {
      var app = _findApp(data.appId);
      if (app) { var r = upsertUnified(app, data); }
    });
    _safeSync('pushToNotion after saveQt', function() {
      var app = _findApp(data.appId);
      if (app) {
        var row = _loadUnifiedByBizno(app.bizno);
        if (row) pushToNotion(row);
      }
    });
  ```
- **문제:**
  1. 견적 시트는 직렬화되지만 통합정보·노션은 후크가 락 밖이라 두 운영자의 hook가 interleave되면 unified/노션이 더 옛 견적 데이터를 갖게 됨.
  2. `_safeSync`는 모든 에러를 `Logger.log` 후 침묵 → 클라이언트는 `ok:true`를 받음. 견적 시트만 정상이고 통합/노션은 stale → 가이드 메일 미발송 또는 잘못된 금액 발송.
- **권장 수정:** doPost의 `saveQt`/`updateQt` 케이스 전체를 `getScriptLock()`으로 래핑. `_safeSync` 실패 시 `_sync_queue`에 적재하고 응답에 `warnings` 필드 추가.

### T6. `_pdfInProgress` 게이트가 `sendQuote`에만 적용 — 버전 모달의 `[견적]`/`[장비]` 버튼은 무방비

- **위치:** `공급기업_관리.html:2279, 2282` (버전 모달 onclick), `:2521 genPDF`, `:2952 genEquipPDF`
- **문제:** `genPDF`/`genEquipPDF` 함수 자체에는 `_pdfInProgress = true`가 없음. 버전 모달에서 PDF 재생성을 클릭하는 동안 60초 autopoll이 발화하면 `quotes` 배열이 통째로 교체 → 잘못된 객체에 `pdfUrl` 저장 + Drive에 중복 파일 생성.
- **권장 수정:** `genPDF`/`genEquipPDF` 진입부에서도 같은 게이트 설정. 더 안전하게는 `Set<qtId>` mutex로 격상해 서로 다른 견적 PDF는 병렬 허용.

### T7. `q-receiptno` 입력이 readonly 아님 → 사용자가 영수증번호를 수정하면 다른 신청자의 행에 견적이 붙음

- **위치:** `공급기업_관리.html` 견적 모달 `q-receiptno` 필드, `:2461 sendQuote`
- **문제:** `getQData`가 `d.appId`를 폼 입력에서 그대로 가져옴. 검증 없음. 서버 `saveQuoteWithVersion`도 `data.appId`가 실재하는지 검사 안 함. 결과: 운영자가 실수로 영수증번호를 고치면 견적이 orphan이 되거나 다른 회사 신청에 attach됨.
- **권장 수정:** 필드를 `readonly`로 변경. 서버에서 `_findApp(data.appId)` 결과가 null이면 `saveQt` 거부.

---

## 3. ⚠️ HIGH 위험 (10건)

| # | 위치 | 문제 | 권장 수정 |
|---|------|------|----------|
| H1 | `공급기업_관리.html:2439 saveQDraft` | `syncQt` 후 `editQtId`가 서버 재발급 ID로 갱신 안 됨 → 후속 동작이 stale ID에 작용, 드래프트 중복 행 발생 가능 | `await syncQt(qt, isNew)` 뒤 `editQtId = qt.id` 추가 |
| H2 | `api.js:7-20 apiCall` | retry/멱등성 키 0건. `fetch` 네트워크 실패 후 사용자 재시도 = 시트 중복 행 + Drive 중복 파일 | 클라이언트 UUID idempotency key를 localStorage에 저장, 서버는 lookup 후 기존 ID 반환 |
| H3 | `Code.gs:801-887 getLatestQuotePdf` | `company` 폴더 fallback이 다른 신청자의 PDF 반환 가능 (동명회사). 무인증 + `appId` 예측 가능 → IDOR 위험 | fallback 제거 + `bizno`+`phone` 검증, 또는 폴더명에 bizno 포함 |
| H4 | `GuideMail.gs:648-755 sendGuideForRow` | `pollAndSend` + `sendGuideNow` ≤100ms 차이 동시 진입 시 version 가드 TOCTOU → 가이드 메일 **중복 발송** 가능 | `sendGuideForRow` 전체를 `LockService.getScriptLock()`로 감싸기 |
| H5 | `NotionSync.gs:87-136 upsertUnified` | 같은 bizno 재신청 시 견적 컬럼을 무조건 비움 → 기존 latest 견적이 unified에서 사라짐 (시트의 견적 행은 남지만 orphan) | quote 인자가 없으면 견적 컬럼 보존, 또는 latest quote 재조회 후 재기록 |
| H6 | `NotionSync.gs:245-298 _reconcileAfterDelete` | LockService 없음. dedup 중 동시 신청이 들어오면 새 행도 함께 삭제됨 | 전체를 `getScriptLock` 안으로 |
| H7 | `Code.gs:307-308`, `pdf-quote-generator.js:182` 등 4곳 | 금액 `Number(val) \|\| 0` 패턴이 `"15.000.000"` 같은 입력을 0으로 강제 → PDF에 "0원" 출력 | `_parseMoney(v)` 헬퍼로 통일 + 정상 범위(>10만, <10억) 검증 |
| H8 | `common.js:350-354 quoteHash` | `options`가 hash에 빠짐 → 옵션만 다른 v2 발급 시 PDF 재업로드 skip → 옛 PDF 노출 | items+options를 canonicalize 후 MD5 |
| H9 | `Code.gs:327-337 serializeRow` | string 컬럼이 plain text 강제 안 됨 → 사용자가 `=SUM(...)` 입력 시 Sheets가 수식 평가 | string 컬럼에 `setNumberFormat('@')` 또는 `=/+/-/@` 시작 시 `'` prefix |
| H10 | `Code.gs:388-441` 등 모든 `migrate*` 함수 | LockService 없이 시트 전체 rewrite → 운영 중 실행 시 동시 들어온 신청 소실 | 모든 마이그레이션 함수에 documentLock |

---

## 4. 🟡 MEDIUM (브리틀, 가까운 미래 위험)

- **bizno 정규화 부재** (`NotionSync.gs:91`): `"275-88-01197"`과 `"27588011 97"`을 다른 키로 취급. 조인 키 전체에 영향. → 서버에서 숫자만 추출 후 `NNN-NN-NNNNN` 재포맷.
- **`migrateAppContentHash`가 헤더 무조건 rewrite** (`Code.gs:418-441`): 운영자가 추가한 커스텀 컬럼을 파괴 + 데이터가 한 칸씩 이동. → 헤더 일치 검증 후 진행.
- **`getRows`의 midnight Date 처리** (`Code.gs:301-320`): 정확히 00:00:00이면 시간 portion 삭제 → 정렬 일관성 깨짐. → 항상 ISO 8601로 emit.
- **`_lookupPdfInflight` 탭별 분리**: 같은 사용자가 두 탭에서 동일 PDF 다운로드 시 GAS 중복 호출. → localStorage 단기 캐시.
- **장비 ID `Math.max(...arr)+1`이 string 섞임에 NaN**: `reduce(..., Number(e.id)||0)`로 안전화.
- **`_processSyncQueue` 동시 처리**: `tryLock(0)` 미사용 → 5분 트리거 겹침 시 같은 큐 항목 2회 처리. (pushToNotion은 멱등이라 무해하지만 코드 smell.)
- **`_photoCacheLS` 두 탭 동시 쓰기**: 마지막 쓰기 win으로 캐시 일부 손실. (안전성 영향 없음.)
- **`getQData`의 영수증번호 입력 자유**: T7과 연관. 검증 layer 부재.
- **`goStep5()` 신청 확정 버튼 더블 클릭 가드 부재**: 모바일 느린 응답 시 중복 신청 행 생성. 운영자 dedup 모달이 사후 보완이지만 운영 부담 증가.

---

## 5. ⚪ LOW

- `tmp_${Date.now()}` 업로드 prefix가 retry마다 재발급 → Drive orphan 파일.
- `selectedEq`, `editProdId` 모듈 전역 globals → 동시 모달 시나리오에 취약.
- `sanitizeName`이 trailing dot 처리 안 함 (Windows 호환성).
- `sendGuideForRow` 5분 idempotency 윈도우가 timezone suffix 없는 문자열 파싱에 의존.
- `_enqueueSync` 큐 ID가 `Utilities.getUuid()` 아님 (현재 무해, 미래 foot-gun).
- `doLookup()` 검색 더블 클릭 시 응답 순서 뒤집힘 → 잘못된 결과 표시 가능.

---

## 6. 견적 재발급 path 심층 검증

최근 fix(`52469d1`, `161e119`)가 정말 root cause를 닫았는지 추적한 결과:

**Fix가 닫은 것:** `_backgroundRefresh`가 `quotes` 배열을 PDF 생성 중간에 swap해서 `quotes.find(qtId)`가 다른 객체를 반환하던 race. `_pdfInProgress` 게이트 + qt 객체 직접 전달로 해결됨.

**Fix가 놓친 인접 경로:**
1. **`getQData`가 폼에서 `appId`/`company`를 검증 없이 가져옴** (T7) — 사용자/운영자 입력 오염 시 다른 회사로 견적이 들어감.
2. **버전 히스토리 모달의 PDF 버튼은 `_pdfInProgress` 미설정** (T6) — 같은 race가 그대로 살아있음.
3. **`_findApp(data.appId)`이 `_safeSync` 안에 있고 실패 시 침묵** (T5) — appId가 stale하면 견적은 시트에 들어가지만 통합/노션은 미반영.
4. **장비 매칭이 name/model fallback에 의존** (T4) — eqId가 견적 item에 없음. 시트 데이터 형태에 따라 다른 장비의 사진이 PDF에 박힐 수 있음.

따라서 fix는 정확하지만 좁음. 위 4가지를 닫지 않으면 "재발급 시 다른 업체 정보" 부류 버그는 다른 입구로 재발할 수 있음.

---

## 7. 스키마 취약성 맵

| Sheet / 상수 | 컬럼 reorder/rename 시 영향 | 위치 |
|---|---|---|
| `APP_COLS` | `_computeAppContentHash`, `migrateAppContentHash`, `appendRow`의 blind setValues | Code.gs:23-27, 355-365, 418-441 |
| `QT_COLS` | `saveQuoteWithVersion`가 `QT_COLS.indexOf('id')`를 매 저장마다 호출 | Code.gs:30-32, 478-540 |
| `QT_COLS` 인덱싱 | `_repairDuplicateQuoteIds`, `migrateQuoteVersions`가 헤더 검증 없이 rewrite | Code.gs:555-621, 646-686 |
| `UNIFIED_COLS` | `upsertUnified`, `_loadUnifiedByBizno`, `_reconcileAfterDelete`, 모든 `_audit_*`/`_repair_*` | NotionSync.gs 전반, GuideMail.gs |
| `UNIFIED_COLS.bizno` | 모든 bizno-keyed lookup. autoInit가 매 doPost에서 헤더 rewrite | Code.gs:265-285 |
| `UNIFIED_NUM`/`UNIFIED_BOOL` | 신규 num/bool 컬럼 추가 시 이 상수도 같이 갱신해야 round-trip | NotionSync.gs:63-65, 218-229 |
| `QUEUE_COLS` 0-5 인덱스 | `_enqueueSync` row-by-position 빌드, `_processSyncQueue` 위치 기반 read | NotionSync.gs:1356-1447 |

`GuideMail.gs`만 헤더를 live로 읽음(`headers.indexOf('id')`) — 가장 robust한 패턴. 다른 파일도 같은 패턴으로 통일 권장.

---

## 8. LockService 사용 현황

| 위치 | 락 종류 | 적절성 |
|---|---|---|
| `saveQuoteWithVersion` (Code.gs:481-540) | `getScriptLock().waitLock(10000)` | ✅ try/finally, flush 후 release |
| `_repairDuplicateQuoteIds` (Code.gs:611-621) | `getScriptLock().waitLock(10000)` | ✅ dry-run은 락 없이, 실제 변경만 락 |
| `bulkSave` (Code.gs:719-734) | `getDocumentLock().waitLock(10000)` | ✅ clearContents→setValues 패턴 보호 |
| `_resolveTargetFolder` (Code.gs:911-932) | `getScriptLock().waitLock(8000)` | ✅ 실패 시 fall-through 의도적 |
| `pollAndSend` (GuideMail.gs:768-848) | `getScriptLock().tryLock(0)` | ⚠️ scope가 batch loop만 — `sendGuideForRow` 내부는 무방비 |

**누락:** `appendRow`/`updateRow`/`upsertRow`/`upsertUnified`/모든 `migrate*` — 가장 트래픽이 많은 경로가 무방비.

**Scope 일관성 부족:** `getScriptLock` vs `getDocumentLock` 혼용. 같은 시트를 만지는 모든 함수가 같은 scope의 lock을 써야 의미가 있음.

---

## 9. 멱등성 갭

| Action | Key | 상태 |
|---|---|---|
| `sendGuideForRow` 메일 발송 | `guide_sent_version === guide_version` | ✅ (TOCTOU 잔재 — H4) |
| `pushToNotion` | bizno로 페이지 query → PATCH/POST | ✅ 멱등 |
| `archiveNotionPage` | bizno로 페이지 조회 후 archive | ✅ 멱등 |
| `saveQuoteWithVersion` ID 충돌 | `existingIds.has(clientId)` | ✅ |
| `saveApp` (클라이언트→시트) | **없음** | ❌ T1 |
| `uploadPhoto` (Drive) | **없음** | ❌ retry 시 중복 파일 |
| `bulkSaveEq` | clearContents → 전체 재작성 | △ 멱등이지만 락은 필요 |

---

## 10. 권장 수정 순서

체인 효과를 고려한 작업 순서:

1. **T4 (장비 cross-match)** — 시트는 이미 정상화됐지만 코드 패턴 자체를 견고화. 견적 item에 `eqId` 영구 저장. 1~2시간 작업.
2. **T1 + T2 (앱 ID 충돌 + appendRow 락)** — 함께 작업. `saveApp`에 LockService + existingIds 가드 동시 도입.
3. **T5 + H4 (락 외부 hook chain + 가이드 메일 TOCTOU)** — saveQt 케이스를 lock으로 감쌀 때 `sendGuideForRow`도 같이 묶기.
4. **T6 (`_pdfInProgress` 일반화)** — `genPDF`/`genEquipPDF` 직접 호출 경로 보호.
5. **T7 + H3 (입력 검증 + IDOR 차단)** — `q-receiptno` readonly + `getLatestQuotePdf` 인증.
6. **T3 (장비 ID 서버 발급)** — 위 작업으로 패턴이 정착된 뒤 마지막.
7. **H1, H5 (drift 정리)** — orphan 견적/통합행 청소 스크립트와 함께.

---

## 11. 운영자에게 답변 필요한 질문

코드만으로는 판단 불가한 결정 포인트:

1. `getLatestQuotePdf`가 외부에 노출돼 있나? (deployment의 "Anyone with the link" 설정 + 토큰 유무) — H3의 심각도 결정.
2. 일일 신청 건수 예상치는? (T1 충돌 확률 산정의 기준)
3. 동일 공급사 운영자가 여러 PC에서 동시에 견적을 발급할 수 있나? (T5 락 scope 결정)
4. `q-receiptno` 입력을 운영자가 수동 수정해야 하는 use case가 실제로 있나? (T7 fix 방식 결정)
5. `sendGuideNow`(Make.com 백업 경로)와 `pollAndSend`(5분 트리거)의 동시 발화 빈도는? (H4 우선순위)

---

## 12. 유지할 가치가 있는 패턴

- `saveQuoteWithVersion`의 ID 충돌 가드 + LockService — 견적 시트의 모범 사례. 다른 시트에 확산할 가치 있음.
- `_pdfInProgress` 게이트 + qt 객체 직접 전달 — race를 명시적으로 차단. (단 적용 범위 확대 필요 — T6)
- `guide_sent_version` vs `guide_version` 분리 — 시간창 대신 진정한 멱등 키. (단 atomic 처리 추가 필요 — H4)
- `_safeSync(label, fn)` 헬퍼 — try/catch + Logger.log 표준화. (단 에러 침묵 보완 필요 — T5)
- `_sync_queue` 시트 — 노션 API 실패 재시도. happy-path에서도 활용 권장.
- `_resolveTargetFolder`의 폴더 결정 lock — 폴더 작성은 lock 안, 파일 업로드는 lock 밖. 적절한 granularity.
- dedup 클라이언트 모달 + 그룹별 최소 1건 가드 — 운영자 실수 방지.
- `_diagnoseLastQuoteSync_force`, `_audit_*`, `_repair_*` 등 진단/복구 도구의 존재 — 운영 가능한 자세.
- `GuideMail.gs`의 live header read 패턴 — schema robust. 다른 파일도 통일 권장.

---

## 부록 A. ID 인벤토리

| ID 종류 | 발급 위치 | 메커니즘 | 범위 |
|---|---|---|---|
| 견적 ID (final/draft) | `공급기업_관리.html:1199-1208` + `Code.gs:478-540` | 클라이언트 max+1 → 서버 LockService + 충돌 가드 + re-mint | Global |
| 신청 ID | `신청기업_장비신청.html:2186-2188` | `NO-YYMMDD-` + 4자리 random, **서버 가드 없음** | per browser session |
| 장비 ID | `공급기업_관리.html:2121` | `Math.max(...local)+1`, **서버 락 없음** | per device |
| Sync queue ID | `NotionSync.gs:1361` | `'q' + Date.now() + Math.random().slice(2,6)` | server-only |
| Quote PDF 파일명 | `공급기업_관리.html:2589, 2901, 2991, 3122` | 파생: `BPK_견적서_${company}_${appId\|\|id}_v${version}_${date}.pdf` | per company Drive folder |
| Unified row 키 | `NotionSync.gs:87-136` | 외부 입력 `bizno` (사용자 타이핑) | per business |
| App contentHash | `Code.gs:444-471`, `common.js:248-306` | MD5 첫 16 hex of canonicalized tuple | dedup 신호 |
| 사진 업로드 temp tag | `신청기업_장비신청.html:1613` | `tmp_${Date.now()}` | per upload attempt |
| Notion page ID | Notion API 할당 | 외부 | per business |

---

## 부록 B. Raw 보고서 출처

본 통합 보고서는 다음 3개 병렬 서브에이전트 보고를 종합한 것:
1. **ID generation logic review** — agentId aba8dce088be93719, 33 tool uses, 282s, 137k tokens
2. **Concurrency review** — agentId a92c3f548960bc7f7, 44 tool uses, 430s, 181k tokens
3. **Data integrity review** — agentId a76e3b29a00739f20, 32 tool uses, 342s, 207k tokens

각 보고는 같은 코드를 다른 관점으로 read-only 감사. 통합 시 중복 발견은 한 항목으로 합치고, 한 보고만이 발견한 항목은 출처 유지.

---

*리뷰 종료. 작업 시작 시 위 권장 순서(섹션 10)를 참고하시고, 각 항목의 "위치"와 "코드"를 그대로 grep해 진입점으로 사용할 수 있습니다.*
