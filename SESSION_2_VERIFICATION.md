# 세션 2 검증 문서 — G5 + G6

**작성일:** 2026-05-14
**대상 변경:** 5 파일, +125 / -9 라인
**커밋 단위:** G별 atomic commit 권장

---

## 변경 요약

| 파일 | 변경 내용 |
|---|---|
| `apps_script/Code.gs` | `_idemCacheGet`/`_idemCachePut` 헬퍼 + `saveAppWithIdGuard`/`saveQuoteWithVersion`/`uploadPhoto`에 멱등성 처리 |
| `apps_script/_session2_tests.gs` | 세션 2 검증 테스트 함수 (신규) |
| `api.js` | 클라이언트 멱등성 키 헬퍼 + `apiUploadPhoto` 자동 키 생성 |
| `공급기업_관리.html` | `getQData` item에 `eqId` 저장, `openQuoteModal` 매칭에 eqId 우선, `syncQt` 멱등성 키 동봉 |
| `신청기업_장비신청.html` | `goStep5` `saveApp` 호출에 멱등성 키 동봉 + 성공 시 clear |
| `.gitignore` | `apps_script/**/*.js` 추가 (clasp 자동 생성 파일 무시) |

---

## G5: 견적 item에 eqId 영구 저장

### Before (수정 전 버그)

**시나리오: 동명/동모델 장비 사진 swap**
1. 운영자가 견적 발급 — item: `{name:'자동포장기', model:'BPK-MRP-2500', price:15000000}`
2. 견적 시트에 저장됨 (item에 `eqId` 없음)
3. 시트에서 장비 id=11 추가 — 같은 model `BPK-MRP-2500` (실수 또는 의도적 신규 장비)
4. 운영자가 1번 견적 재발급 → `genEquipPDF`가 item 매칭 시 `e.model === item.model` 로 첫 일치 (id=11)
5. **장비사양 PDF에 id=11의 사진/스펙이 나옴** (의도는 id=5)

### After (수정 후 동작)

- `getQData`가 item에 `eqId: eq.id` 저장 (line 2417-2424)
- `genPDF`/`genEquipPDF`의 매칭 코드는 이미 eqId 우선 (line 2532-2540, 2961-2969)
- `openQuoteModal` 수정 모드도 eqId 우선 매칭 (line 2359-2368)
- **새 견적부터 정확한 장비 사진/스펙 PDF**
- 기존 견적(eqId 없는 legacy)은 name/model fallback으로 동일하게 동작

### 검증 방법

**브라우저에서:**
1. 공급기업_관리.html 열기
2. 견적 발급 1건 진행
3. 콘솔에서: `JSON.parse(localStorage.bpk_qt_v1).slice(-1)[0].items`
4. 각 item에 `eqId` 필드가 있어야 정상

```javascript
// 콘솔 예상 결과:
[
  { eqId: 1, name: '...', model: '...', qty: 1, unit: 'SET', price: 15000000 },
  ...
]
```

---

## G6: 멱등성 키 도입

### Before (수정 전 버그)

**시나리오 1: 더블 클릭으로 중복 신청**
1. 모바일 신청자가 응답 느릴 때 "신청 확정" 2번 탭
2. 두 `saveApp` 호출 모두 시트에 새 행 append
3. 같은 회사가 같은 내용으로 2건 신청 → 운영자 dedup 부담

**시나리오 2: 네트워크 실패 후 retry**
1. `fetch` 가 5xx 응답하지만 서버는 이미 row append 완료
2. 사용자가 "다시 시도" 클릭 → 또 다른 row append
3. Drive에도 사진 중복 업로드

**시나리오 3: 견적 발급 중 페이지 되돌아가기**
1. `sendQuote` 후 `await syncQt` 진행 중 사용자가 모달 닫고 다시 견적 발급
2. 두 `saveQuoteWithVersion` 호출 → 두 견적 v2, v3 생성 (의도는 v2 1건)

### After (수정 후 동작)

**시나리오 1:**
- 첫 클릭 시 클라이언트가 `_idemKey: UUID-A` 생성 → window 전역 보관
- 두 번째 클릭 시 같은 `UUID-A` 재사용
- 서버 `saveAppWithIdGuard` 진입: ScriptCache에서 `UUID-A` 조회 → 1차 결과 그대로 반환
- 시트에는 1건만 추가, 두 번째 응답은 캐시 hit (즉시 반환)
- 성공 후 `_clearIdempotencyKey('saveApp')` → 다음 신청은 새 키

**시나리오 2:**
- 네트워크 실패 시 `_clearIdempotencyKey` 호출 안 함 → 키 보존
- 사용자 retry 시 같은 키 → 서버가 cache hit으로 같은 결과 반환
- Drive 사진도 `_photoIdemKey(base64)` 가 같은 base64에 같은 키 → 캐시된 URL 재사용

**시나리오 3:**
- `syncQt`가 `_idemKey: UUID-B` 동봉
- 두 번째 호출도 같은 키 → 서버 캐시 hit
- 견적 시트에는 v2 1건만, 두 번째 응답은 첫 번째 v2 결과 그대로

### 검증 방법

**Apps Script 에디터:** `_session2_tests.gs` 파일 추가 후:
1. 함수 드롭다운 → `_test_session2_all` 선택
2. ▶️ 실행 → 로그 확인
3. 기대 출력 (예시):

```
── G6: saveApp idempotency 테스트 ──
1차: id=NO-260514-XXXX ok=true
2차: id=NO-260514-XXXX ok=true
✅ 같은 결과 반환 (id NO-260514-XXXX === NO-260514-XXXX)
✅ 시트 행 수 = 1 (멱등 동작 정상)

── G6: saveQt idempotency 테스트 ──
1차: id=QT-2026-XXX v=1
2차: id=QT-2026-XXX v=1
✅ 같은 결과 반환 (id=QT-2026-XXX v=1)
✅ 견적 시트 행 수 = 1 (멱등 동작 정상)

── G6: uploadPhoto idempotency 테스트 ──
1차: url=https://drive.google.com/thumbnail?id=...
2차: url=https://drive.google.com/thumbnail?id=...
✅ 같은 URL 반환 (Drive 중복 파일 안 생김)
   (테스트 Drive 파일 trash 완료)
```

**브라우저에서 (실제 운영 동작):**
1. 신청 페이지에서 "신청 확정" 더블 클릭
2. Apps Script Logger 로그 확인 → `[saveAppWithIdGuard] idem cache hit: ...` 한 번 나오면 멱등 동작 정상
3. 같은 회사 시트 행 수 1건만 확인

---

## 운영 영향 분석

| 항목 | 영향 |
|---|---|
| 기존 견적 행 (eqId 없음) | ✅ 그대로 — 매칭 코드의 name/model fallback이 처리 |
| 새로 발급되는 견적 | ✅ item.eqId 필드 추가 (JSON 안), 기존 컬럼 변경 없음 |
| 정상 1회 호출 | ✅ idem cache에 적재만 됨 (5분 후 자동 만료), 동작 동일 |
| 더블 클릭/retry | ✅ 1차 결과 즉시 반환 — 사용자에게 새 요청처럼 보임 |
| ScriptCache 메모리 사용 | ~수십 byte/key × 5분 — 무시 가능 |
| 옛 클라이언트 (G6 미적용) | ✅ `_idemKey` 미동봉 → 서버가 멱등 처리 skip, 기존 동작 그대로 |
| 옛 서버 (G6 미적용) | ✅ 클라이언트의 `_idemKey` 필드 무시, 기존 동작 그대로 |

호환성: 양방향 모두 안전 (배포 순서 무관).

---

## 배포 순서

clasp가 설정됐으므로 명령어가 한 줄 추가됐습니다:

### 1) 코드 검토
```bash
git status
git diff --stat
git diff apps_script/Code.gs | head -80
```

### 2) Atomic commit (권장)
```bash
# G5
git add 공급기업_관리.html
git commit -m "fix(integrity): G5 persist eqId in quote items + eqId-first matching"

# G6
git add api.js apps_script/Code.gs 공급기업_관리.html 신청기업_장비신청.html
git commit -m "fix(idempotency): G6 idempotency keys for saveApp/saveQt/uploadPhoto"

# 테스트 + 검증 문서
git add apps_script/_session2_tests.gs SESSION_2_VERIFICATION.md
git commit -m "test: session 2 verification suite + scenario docs"

# clasp 설정 (이미 commit 안 했다면)
git add .clasp.json .claspignore .gitignore
git commit -m "chore: clasp setup for Apps Script auto-sync"
```

### 3) GitHub Push — HTML 자동 배포
```bash
git push origin main
```

### 4) Apps Script 동기화 (clasp)
```bash
clasp push
# 결과: "Pushed 6 files." (5 .gs + appsscript.json)
```

### 5) Apps Script 새 버전 배포
- 에디터 우상단 **`배포`** → **`배포 관리`** → ✏️ → 새 버전 → `배포`

### 6) 검증
- Apps Script 에디터에서 `_test_session2_all` ▶️ — ✅ 6개 확인
- 브라우저에서 신청 더블 클릭 테스트 — 시트에 1건만 추가되는지 확인

---

## 롤백 절차

```bash
# 특정 G만 롤백
git revert <commit-hash>
git push origin main
clasp push

# Apps Script 새 버전 재배포
```

시트 데이터 변경 0건이므로 data rollback 불필요.

---

## 사용자 확인 요청

1. **OK, commit + push + clasp 진행** → 세션 3 (G7 IDOR + H4/H5 drift) 로 이동
2. **특정 G 재검토 필요**
3. **추가 검증 케이스 필요**
4. **운영 영향 재검토**
