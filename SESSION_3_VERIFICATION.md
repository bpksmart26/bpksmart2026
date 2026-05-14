# 세션 3 검증 문서 — G7 + G8

**작성일:** 2026-05-14
**대상 변경:** 4 파일 + 1 신규 = 5 파일, +151 / -89 라인

---

## 변경 요약

| 파일 | 변경 |
|---|---|
| `apps_script/Code.gs` | `getLatestQuotePdf`에 bizno+phone 인증 + bizno-scoped fallback, `_resolveTargetFolder`의 quote 타입에 bizno 폴더명 |
| `apps_script/NotionSync.gs` | `upsertUnified`에 `opts._alreadyLocked` 옵션 + 견적 컬럼 보존, `_reconcileAfterDelete` 전체 lock |
| `apps_script/_session3_tests.gs` | 세션 3 검증 테스트 (신규) |
| `공급기업_관리.html` | `genPDF`/`genEquipPDF`의 `apiUploadPhoto`에 bizno 동봉 |
| `신청기업_장비신청.html` | `_prefetchQuotePdf`/`downloadPDF`의 `getLatestQuotePdf` 호출에 bizno+phone 동봉 |

---

## G7: getLatestQuotePdf 인증 + IDOR 차단

### Before (수정 전 위험)

**시나리오 1: 외부 무인증 PDF 다운로드**
1. 공격자가 회사명(`(주)대한식품`)과 대략적 신청 날짜만 알면
2. `getLatestQuotePdf` 엔드포인트를 직접 호출 — `{company:'대한식품', appId:'NO-260501-XXXX'}` 4-digit 4자리 brute force
3. 9000개 경우의 수 → 몇 분~몇 시간이면 다 시도 가능
4. 매칭되는 PDF 발견 시 견적 금액, 공급사 가격, 신청자 bizno/주소/이메일 노출

**시나리오 2: 동명 회사 PDF leak**
1. `(주)대한식품` A (bizno=001-11-22222) 와 `(주)대한식품` B (bizno=003-33-44444) 둘 다 신청
2. Drive 폴더는 `대한식품` 한 폴더에 두 PDF 공존
3. A의 신청자가 다운로드 클릭 → `appId` 매칭 안 되면 `allCompanyFiles` fallback → B의 최신 PDF 받음

### After (수정 후 동작)

**시나리오 1:**
- `getLatestQuotePdf` 진입 시 `bizno + phone` 필수
- 시트의 신청 행과 `(bizno, phone)` 일치 검증 — 둘 다 안 알면 호출 불가
- bizno + phone 조합은 약 ~10^10 공간, brute force 비실용적

**시나리오 2:**
- Drive 폴더 패턴 = `회사명_bizno숫자` (새 발급 시)
- 동명 회사라도 bizno가 다르면 폴더 분리
- fallback도 `bizno-scoped`: 같은 bizno의 다른 appId만 fallback 허용
- legacy 폴더(회사명만)도 검색하므로 기존 데이터 호환

### 검증

테스트 함수 `_test_g7_authGuard`, `_test_g7_folderName` 자동 검증.

**브라우저 시나리오:**
1. 신청자 페이지에서 "조회하기" → bizno+phone 입력 → "견적서 다운로드" 클릭
2. 정상 다운로드 → ✅ G7 동작 정상
3. 콘솔에서 `apiCall('getLatestQuotePdf', { company:'X' })` 호출 → `{ok:false, error:'인증 정보 누락'}` 반환 → ✅ IDOR 차단

---

## G8: upsertUnified 견적 보존 + _reconcileAfterDelete lock

### Before (수정 전 버그)

**시나리오 1: 재신청 시 견적 사라짐**
1. 신청자 A가 신청 → 견적 v=1 발급 → 통합정보에 견적 컬럼 채워짐
2. A가 같은 bizno로 재신청 (변경된 정보)
3. `saveApp` hook가 `upsertUnified(app2)` 호출 (quote 인자 없음)
4. 기존 통합정보 행의 **견적 컬럼이 모두 빈 값**으로 초기화
5. 가이드 메일 발송 시 `unifiedRow.pdfUrl=''` → 첨부 없음, 또는 "guide_html_url 없음"으로 실패
6. 기존 견적은 견적 시트에 남아있지만 통합정보에서 잘려 orphan 상태

**시나리오 2: dedup 도중 동시 신청이 함께 삭제**
1. 운영자가 dedup 모달에서 중복 행 3개 삭제
2. `_reconcileAfterDelete([id1, id2, id3])` 호출 → 잔여 신청 확인 + unified row 삭제
3. 그 사이 신청자가 같은 bizno로 새 신청 → 시트에 append
4. `_reconcileAfterDelete`가 `freshData`를 다시 읽어 bizno 매칭 삭제 — **새로 들어온 신청 행이 unified에서 잘못 삭제**
5. 노션 페이지도 archive → 새 신청자가 안 보임

### After (수정 후 동작)

**시나리오 1:**
- `upsertUnified(app, undefined)` 호출 시 기존 행이 있으면 견적 컬럼을 **그대로 복사하여 보존**
- 신규 행이면 빈 값으로 시작 (이전 동작과 동일)
- 가이드 메일 발송 시 견적 PDF 정상 첨부

**시나리오 2:**
- `_reconcileAfterDelete` 전체가 `LockService.getScriptLock()` 안
- dedup 처리 중에 들어오는 새 신청의 `appendRow` (G1에서 lock 적용됨)도 대기
- reconcile 끝난 후 신규 신청이 안전하게 처리
- nested lock 회피: `upsertUnified(app, q, { _alreadyLocked: true })` 호출

### 검증

테스트 함수 `_test_g8_quotePreservation`, `_test_g8_reconcileLock`이 자동 검증.

**시나리오 검증 (운영 데이터로):**
1. 견적 v=1 발급된 신청 1건 확인
2. 같은 bizno로 재신청 (운영자가 클라이언트로 새 신청 등록 — 또는 manual)
3. 통합정보 시트에서 그 bizno 행의 `pdfUrl`, `total`, `quoteVersion` 컬럼 확인 → 기존 값 그대로 유지되어야 함

---

## 운영 영향 분석

| 항목 | 영향 |
|---|---|
| 신청자 PDF 다운로드 (정상) | ✅ 무영향 — bizno+phone 이미 조회 단계에서 입력 |
| 외부 무인증 PDF URL 접근 | ✅ 차단 (의도된 보안 개선) |
| 새 견적 PDF 업로드 | Drive 폴더가 `회사명_bizno` 패턴으로 생성 — 기존 `회사명` 폴더와 분리 |
| 기존 `회사명` 폴더의 PDF | ✅ legacy fallback으로 그대로 조회 가능 |
| 재신청 시 통합정보 견적 컬럼 | ✅ 보존 (동작 변경) — 이전: wipe / 이후: 보존 |
| dedup + 동시 신청 | ✅ lock으로 직렬화 — 새 신청이 잘못 삭제 안 됨 |
| 신청 등록 latency | dedup 작업 진행 중이면 max 10초 대기 — 빈도 매우 낮음 |

---

## 배포 순서

```bash
# G7 — IDOR 차단 + 폴더 분리
git add apps_script/Code.gs 공급기업_관리.html 신청기업_장비신청.html
git commit -m "fix(security): G7 auth getLatestQuotePdf with bizno+phone, bizno-scoped folders"

# G8 — 견적 보존 + reconcile lock
git add apps_script/NotionSync.gs
git commit -m "fix(integrity): G8 preserve quote on re-application + reconcile lock"

# 테스트 + 문서
git add apps_script/_session3_tests.gs SESSION_3_VERIFICATION.md
git commit -m "test: session 3 verification suite + scenario docs"

# Push + Apps Script 동기화
git push origin main
clasp push
# Apps Script 에디터에서 "새 버전 배포"
```

---

## 사용자 확인 요청

1. **OK, commit + push + clasp 진행** → 세션 4 (G9 입력 안전화 + G10 saveQDraft fix)로 이동
2. **특정 G 재검토**
3. **추가 검증 케이스**

테스트 결과 ✅ 7개 받으면 세션 3 종료입니다.
