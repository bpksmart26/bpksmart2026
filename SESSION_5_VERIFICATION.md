# 세션 5 검증 문서 — G11~G14 + 정리

**작성일:** 2026-05-14
**대상 변경:** 5 파일 + 1 신규, +197 / -50 라인
**상태:** 보고서의 "권장 수정 순서" 마지막 묶음 — 세션 5 종료 시 모든 권장 fix 완료

---

## 변경 요약

| G | 위치 | 핵심 |
|---|---|---|
| **G11** | Code.gs `upsertEqWithIdGuard` 신규 + doPost 라우팅 + 공급기업_관리.html `syncEq` + 호출 사이트 | 장비 ID 서버 가드 (saveAppWithIdGuard 패턴) |
| **G12** | Code.gs `_normalizeBizno` 헬퍼 + saveAppWithIdGuard, NotionSync.gs `_loadUnifiedByBizno` · `upsertUnified` · `_reconcileAfterDelete` 양쪽 정규화 비교 | bizno 입력 형식 차이로 인한 매칭 누락 차단 |
| **G13** | Code.gs `migrateQtDateColumn` · `migrateAppContentHash` · `migrateQuoteVersions`, NotionSync.gs `rebuildUnified` | 마이그레이션 도중 동시 신청 race 차단 |
| **G14** | 신청기업_장비신청.html `btn-submit-app` id + `goStep5` 가드 + outer try-finally | 더블 클릭 UX 보호 (G6 멱등성과 별개 시각 피드백) |
| **정리** | Code.gs `sanitizeName`, NotionSync.gs `_enqueueSync`, Code.gs `getRows`, GuideMail.gs `sendGuideForRow` | trailing dot / UUID / midnight date / KST TZ — 모두 1~2줄 |

---

## G11: 장비 ID 서버 발급

### Before

두 디바이스에서 거의 동시에 새 장비를 추가하면 둘 다 `Math.max(...local)+1` 로 같은 id 발급 → `upsertRow`가 한 쪽을 silent overwrite.

### After

- 클라이언트가 `_isNew: true` 플래그 동봉
- 서버 `upsertEqWithIdGuard`가 id 중복 감지 시 `max+1` 재발급
- 응답 `r.id`로 클라이언트 로컬 상태 갱신 (`syncQt`/`saveAppWithIdGuard`와 동일 패턴)
- 수정(`_isNew: false`)은 기존 id 그대로 update

### 검증

`_test_g11_upsertEqIdGuard` 자동 — 신규 충돌 가드 + 수정 모드 확인.

---

## G12: bizno 정규화

### Before

`275-88-01197` 와 `27588011 97` 가 다른 키로 취급 → unified 시트 중복 행, 노션 페이지 중복.

### After

- 모든 입력/비교에서 `_normalizeBizno(b)` 적용 — 숫자만 추출 → 10자리면 `NNN-NN-NNNNN` 재포맷
- 새 저장은 정규화된 형식, 비교는 양쪽 정규화
- **기존 시트 데이터 변경 없음** — 비교 시 양쪽 정규화로 호환

### 검증

`_test_g12_normalizeBizno` 자동 — 8가지 입력 형식 모두 동일 결과 확인.

---

## G13: migrate 함수 락

### Before

운영자가 실수로 마이그레이션 함수를 운영 시간에 실행 → 동시 들어온 신청·견적이 시트 통째 rewrite에 묻혀 사라짐.

### After

`migrateQtDateColumn`, `migrateAppContentHash`, `migrateQuoteVersions`, `rebuildUnified` 모두 `LockService.getDocumentLock().waitLock(30000)` 으로 감쌈. 동시 작업이 있으면 대기 후 진행.

### 검증

실제 race 재현 불가 — 마이그레이션 함수 호출 시 lock acquire/release가 작동하는지 정적 확인.

---

## G14: goStep5 더블 클릭 가드

### Before

모바일 응답 느릴 때 사용자가 "신청 확정" 두 번 탭 → G6 멱등성 키가 서버 측 중복은 막지만 클라이언트에 시각 피드백 없음 (버튼이 계속 활성 상태로 보임).

### After

- button id `btn-submit-app` 추가
- 진입 즉시 `window._submitInProgress = true` + 버튼 `disabled = true` → 시각적으로 잠금
- finally에서 cleanup → 다음 신청 가능

### 검증 (브라우저)

1. 신청기업_장비신청.html 접속
2. 신청서 작성 진행
3. "신청 확정하기" 빠르게 더블 클릭
4. 콘솔 `window._submitInProgress` 확인 → 진행 중에 `true` → 끝나면 `false`
5. 시트에 같은 회사 신청이 1건만 추가되었는지 확인

---

## 정리 (소소한 fix)

| 항목 | Before | After |
|---|---|---|
| `sanitizeName` trailing dot | `(주)대한.` 그대로 → Windows에서 파일 시스템 오류 가능 | `\.+$` 제거 |
| `_enqueueSync` 큐 id | `Date.now() + 4자리 random` (충돌 가능성) | `Utilities.getUuid()` |
| `getRows` 자정 date | 시간 portion 누락 → 정렬 일관성 깨짐 | 항상 `HH:MM` 포함 |
| `guide_sent_at` 파싱 | `new Date(string)` — runtime timezone 의존 | `Utilities.parseDate(s, 'Asia/Seoul', 'yyyy-MM-dd HH:mm')` 명시 |

`_test_cleanup_sanitizeName` 자동 검증 (6 케이스).

---

## 운영 영향 분석

| 항목 | 영향 |
|---|---|
| 신규 장비 추가 | 클라이언트 임시 id ↔ 서버 canonical id 교환 — 정상 흐름에선 동일 |
| 동시 장비 추가 | ID 충돌 시 자동 재발급 → 두 디바이스 모두 정상 등록 |
| 기존 시트 bizno (다양한 형식) | ✅ 변경 없음 — 비교 시 양쪽 정규화로 매칭 |
| 새로 저장되는 bizno | `NNN-NN-NNNNN` 정규화 형식 |
| 마이그레이션 함수 실행 | 운영 시간 중에도 안전 (이전엔 위험) |
| 정상 신청 (1회 클릭) | ✅ 무영향 |
| 더블 클릭 신청 | 버튼 disable 즉시 + 두 번째 호출 무시 |
| 자정에 저장된 date 셀 | `YYYY-MM-DD 00:00` 형식으로 일관 |
| 가이드 메일 5분 idempotency | KST 명시로 timezone 무관하게 정확 |

---

## 배포 순서

```bash
git add apps_script/Code.gs 공급기업_관리.html
git commit -m "fix(integrity): G11 server-side equipment ID guard"

git add apps_script/Code.gs apps_script/NotionSync.gs
git commit -m "fix(integrity): G12 bizno normalization for join keys"

git add apps_script/Code.gs apps_script/NotionSync.gs
git commit -m "fix(safety): G13 LockService for migration functions"

git add 신청기업_장비신청.html
git commit -m "fix(ux): G14 double-click guard for goStep5"

git add apps_script/Code.gs apps_script/NotionSync.gs apps_script/GuideMail.gs
git commit -m "chore: cleanup — sanitizeName / UUID queue / midnight date / KST parse"

git add apps_script/_session5_tests.gs SESSION_5_VERIFICATION.md
git commit -m "test: session 5 verification suite + final scenario docs"

git push origin main
clasp push
# Apps Script 새 버전 배포
```

(주의: `git add` 같은 파일 여러 commit에 걸쳐 사용 시 hunk별로 `git add -p` 사용 권장. 실제로는 한 묶음 commit이 더 깔끔할 수 있음.)

---

## 모든 권장 fix 완료 — 후속 로드맵

세션 5 종료 = 보고서 `CODE_REVIEW_2026-05-14.md`의 **권장 수정 순서 1~7번 모두 완료**.

남은 항목 (보고서의 MEDIUM/LOW 추가):
- `migrateAppContentHash`의 헤더 무조건 rewrite — 운영자 커스텀 컬럼 파괴 위험 (LOW, 운영자 인지 후 실행이므로 추후 별도 작업)
- `_lookupPdfInflight` 탭 간 격리 (LOW)
- `selectedEq`, `editProdId` globals (LOW)
- 사진 업로드 retry 시 `tmp_${Date.now()}` 재발급 (LOW — G6 멱등성으로 storage 낭비만)
- `_photoCacheLS` 두 탭 동시 쓰기 (LOW)
- `doLookup` 검색 응답 순서 보장 (LOW)

이 항목들은 다음 운영 사이클에서 필요 시 별도로.

---

## 사용자 확인 요청

1. **OK, commit + push + clasp + 배포 진행** — 모든 권장 fix 완료
2. **특정 G 재검토**
3. **추가 검증**
