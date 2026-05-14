# 세션 1 검증 문서 — G1~G4

**작성일:** 2026-05-14
**대상 변경:** 5 파일, +437 / -220 라인
**커밋 단위:** G별 atomic commit 권장 (현재 미커밋 상태)

이 문서는 세션 1에서 수정한 G1~G4 각각에 대해 **수정 전 버그 시나리오 (Before)**, **수정 후 동작 (After)**, **검증 방법**을 정리합니다. 사용자 확인 후 commit + 배포 권장.

---

## 변경 요약

| 파일 | 변경 내용 |
|---|---|
| `apps_script/Code.gs` | `appendRow`/`updateRow`/`upsertRow`에 LockService, `saveAppWithIdGuard` 신규, `saveQt`/`updateQt`/`saveApp`/`updateApp` 후크에 큐옵션 + warnings, `saveQuoteWithVersion`에 `_findApp` 사전 검증 |
| `apps_script/NotionSync.gs` | `upsertUnified`에 LockService, `_safeSync` 보강(큐옵션·warnings), `_processSyncQueue`에 `upsertUnified` 케이스 추가 |
| `apps_script/GuideMail.gs` | `sendGuideForRow`에 LockService + `_alreadyLocked` 옵션, `pollAndSend`에서 옵션 전달 |
| `공급기업_관리.html` | `genPDF`/`genEquipPDF`에 `_pdfInProgress` 게이트 (`_ownsPdfGate` 패턴) |
| `신청기업_장비신청.html` | `saveApp` 응답에서 서버 재발급 ID 처리 + 응답 실패 가드 |

---

## G1: appendRow/updateRow/upsertRow LockService + saveApp ID 충돌 가드

### Before (수정 전 버그)

**시나리오 1: 동시 신청으로 행 손실**
1. 신청자 A와 신청자 B가 거의 동시(0.5초 이내)에 "신청 확정" 버튼 클릭
2. 두 doPost 실행 모두 `saveApp` → `appendRow`로 진입
3. 두 실행이 동시에 `sheet.getLastRow()` 호출 → 같은 값 N 반환
4. 두 실행 모두 `setValues(N+1, ...)` 호출 → **같은 row N+1에 두 번 쓰기**
5. 결과: 한 신청자의 데이터가 다른 신청자의 데이터로 통째로 덮어쓰여 영구 손실

**시나리오 2: 신청 ID `NO-YYMMDD-XXXX` 충돌**
1. 같은 날 신청자 A가 `NO-260514-1234`로 신청, 시트에 저장됨
2. 잠시 후 신청자 B가 신청 — `Math.random()`이 우연히 `1234` 반환 → 같은 `NO-260514-1234`로 발급
3. 서버는 충돌 검사 없이 `appendRow` 수행 → 시트에 같은 ID 두 행
4. B에 대한 견적 발급 시 `_findApp("NO-260514-1234")`이 **첫 일치(=A의 행)**만 반환
5. 견적이 A의 회사명·bizno로 attach → B의 가이드 메일이 A에게 발송

### After (수정 후 동작)

**시나리오 1 (동시 신청):**
- `appendRow` 진입 시 `LockService.getScriptLock().waitLock(10000)` 획득
- A의 실행이 lock을 잡고 있는 동안 B는 대기
- A의 `setValues(N+1)` 완료 후 lock release
- B가 lock 획득 → 새로 `getLastRow()` 호출 → N+1 반환 (A가 방금 채움) → `setValues(N+2)`
- 결과: 두 행 모두 시트에 안전하게 저장

**시나리오 2 (ID 충돌):**
- `saveAppWithIdGuard` 진입 → lock 획득 → 시트 전체 ID 수집
- B의 클라이언트 ID `NO-260514-1234`가 `existingIds`에 포함됨을 감지
- 같은 prefix(`NO-260514-`) 안에서 random 100회 시도 → 충돌 안 나는 `NO-260514-5678` 등 발급
- 서버 응답에 `{ ok:true, id:'NO-260514-5678', idCollided:true }` 포함
- 클라이언트(`goStep5`)가 응답 받아 `app.id`를 `NO-260514-5678`로 갱신
- 영수증 박스에 새 ID 표시 → 사용자는 새 영수증번호를 받음
- 견적 발급 시 `_findApp("NO-260514-5678")` = B의 행 1개만 반환 → 정상 attach

### 검증 방법

**정적 검증:**
- `Code.gs:355-373` `appendRow`에 `LockService.getScriptLock().waitLock(10000)` + try/finally release 적용됨 확인 ✅
- `Code.gs:375-401` `updateRow`에 동일 패턴 적용됨 확인 ✅
- `Code.gs:702-720` `upsertRow`에 동일 패턴 적용됨 확인 ✅
- `Code.gs:553-616` `saveAppWithIdGuard` 함수 신규 추가됨 확인 ✅
- `Code.gs:115-132` `case 'saveApp'`이 `saveAppWithIdGuard(data)` 호출로 변경됨 확인 ✅
- `신청기업_장비신청.html:2224-2245` 응답 처리에서 `r.id !== app.id` 시 `app.id = r.id` 갱신됨 확인 ✅

**동적 검증 (Apps Script 에디터에서 실행):**
```javascript
// 에디터에 추가 후 ▶️ 클릭
function _test_saveAppIdGuard() {
  // 1) 신규 신청 1건
  var data1 = { id:'NO-260514-9999', bizno:'888-88-88881', company:'테스트A', date:'2026-05-14 10:00' };
  Logger.log('1차 발급: ' + JSON.stringify(saveAppWithIdGuard(data1)));

  // 2) 같은 ID로 다시 시도 → 재발급되어야 함
  var data2 = { id:'NO-260514-9999', bizno:'888-88-88882', company:'테스트B', date:'2026-05-14 10:01' };
  var r2 = saveAppWithIdGuard(data2);
  Logger.log('2차 발급 (같은 ID): ' + JSON.stringify(r2));
  // 기대: r2.idCollided === true, r2.id !== 'NO-260514-9999'

  // 3) 정리
  var sheet = getSheet(SN.APP);
  var d = sheet.getDataRange().getValues();
  for (var i = d.length - 1; i >= 1; i--) {
    if (String(d[i][0]).indexOf('NO-260514-9999') === 0 || String(d[i][APP_COLS.indexOf('bizno')]).indexOf('888-88') === 0) {
      sheet.deleteRow(i + 1);
    }
  }
  Logger.log('테스트 행 정리 완료');
}
```

기대 출력:
```
1차 발급: {"ok":true,"id":"NO-260514-9999","idCollided":false}
2차 발급 (같은 ID): {"ok":true,"id":"NO-260514-XXXX","idCollided":true}   ← XXXX는 9999 외 다른 값
테스트 행 정리 완료
```

---

## G2: saveQt 후크 체인 lock + 가이드 메일 lock + _safeSync 큐 적재

### Before (수정 전 버그)

**시나리오 1: 견적 발급 hook chain interleaving**
1. 운영자 A와 B가 같은 신청에 거의 동시에 견적 발급 (예: 두 PC 분담)
2. A의 `saveQuoteWithVersion`이 lock 잡고 v2 작성 → release
3. B의 `saveQuoteWithVersion`이 lock 잡고 v3 작성, A의 v2 `isLatest=''` 마킹 → release
4. **이 시점 두 실행 모두 lock 외부 hook chain 진입**
5. A의 `_safeSync('upsertUnified')` → 통합정보에 v2 데이터 쓰기 (A는 v2이 latest라 믿음)
6. B의 `_safeSync('upsertUnified')` → 통합정보에 v3 데이터 쓰기
7. 두 hook가 동시에 같은 unified row의 `setValues` 호출 → race
8. 최악: 통합정보 / 노션이 옛 v2 데이터로 끝남, 가이드 메일이 v2 PDF로 발송

**시나리오 2: 가이드 메일 중복 발송**
1. `pollAndSend`가 5분 트리거로 발화 — lock 잡고 row를 `sendGuideForRow`에 넘김
2. 동시에 Make.com 백업 경로가 `sendGuideNow` 호출 (lock 없음)
3. 두 실행이 같은 unifiedRow를 lock 없이 `sendGuideForRow` 진입
4. 둘 다 `guide_sent_version=0`인 상태로 검사 통과 → 둘 다 메일 발송
5. 결과: 같은 가이드 v=1 메일이 신청자에게 2번 도착

**시나리오 3: hook 침묵 실패 → drift 누적**
1. `saveQt` 후 `upsertUnified` hook가 일시적 시트 quota 등으로 throw
2. `_safeSync`가 `Logger.log`만 찍고 silently 통과
3. 클라이언트는 `{ok:true}` 받아 "발급 완료" 토스트 표시
4. 통합정보 시트는 stale → `pollAndSend`가 가이드 메일을 옛 견적 데이터로 발송 (또는 그냥 미발송)

### After (수정 후 동작)

**시나리오 1 (hook chain):**
- `upsertUnified` 진입 시 `LockService.getScriptLock().waitLock(10000)` 획득
- A의 hook가 lock 잡고 v2 쓰기 → release
- B의 hook가 lock 잡고 v3 쓰기 (A의 v2 위에 덮어씀, B가 최신이 맞음) → release
- 결과: 통합정보가 최신 v3 데이터를 일관되게 유지

**시나리오 2 (가이드 메일):**
- `sendGuideForRow` 진입 시 lock 획득 (단 `pollAndSend`는 `_alreadyLocked: true`로 nested 회피)
- `sendGuideNow` 호출 시 함수 내부 lock 자동 acquire
- 동시 진입한 경우 한 쪽이 대기 후 진입 → 시트 재조회 후 `guide_sent_version >= guide_version` 가드에 걸려 skip
- 결과: 메일 1번만 발송

**시나리오 3 (hook 실패):**
- `_safeSync`가 hook 실패 시 `queueOpt`로 받은 action을 `_sync_queue` 시트에 적재
- 동시에 `result.warnings`에 `{ label, error, queued: true }` push
- 클라이언트가 `result.warnings`를 검사하면 부분 실패를 인지 가능
- 5분 후 `syncFromNotion` 끝에서 `_processSyncQueue`가 큐 항목 재처리 → upsertUnified 재시도
- 3회 실패 시 큐에서 제거 + 운영자 로그

### 검증 방법

**정적 검증:**
- `NotionSync.gs:87-95` `upsertUnified` 첫 줄에 LockService 획득 ✅
- `NotionSync.gs:193-218` `_safeSync` signature가 `(label, fn, queueOpt, result)` ✅
- `NotionSync.gs:1416-1428` `_processSyncQueue` switch에 `case 'upsertUnified'` 추가됨 ✅
- `GuideMail.gs:648-660` `sendGuideForRow`에 `opts._alreadyLocked` 분기 + outer try-finally ✅
- `GuideMail.gs:825` `pollAndSend`에서 `sendGuideForRow(row, { _alreadyLocked: true })` ✅
- `Code.gs:115-204` doPost 4개 case의 `_safeSync` 호출에 큐 옵션 + result 전달됨 ✅

**동적 검증:**
```javascript
function _test_safeSync_queue() {
  // 1) 임시 result 객체
  var result = { ok: true };

  // 2) 일부러 throw 하는 fn → 큐에 적재 + warnings 누적되어야 함
  _safeSync('test failure', function() {
    throw new Error('의도적 실패');
  }, { action: 'upsertUnified', payload: { app: { id: '_test_' } } }, result);

  Logger.log('result.warnings: ' + JSON.stringify(result.warnings));
  // 기대: [{ label:'test failure', error:'Error: 의도적 실패', queued:true }]

  // 3) 큐에 적재됐는지 확인
  var queue = getSheet(SN.QUEUE).getDataRange().getValues();
  Logger.log('큐 마지막 행: ' + JSON.stringify(queue[queue.length - 1]));

  // 4) 정리 — 방금 적재한 큐 항목 삭제
  if (queue[queue.length - 1][1] === 'upsertUnified' && queue[queue.length - 1][2].indexOf('_test_') >= 0) {
    getSheet(SN.QUEUE).deleteRow(queue.length);
    Logger.log('테스트 큐 항목 정리 완료');
  }
}
```

기대: warnings 1건 + 큐 시트 마지막 행에 `upsertUnified` action.

**가이드 메일 동시 발송 테스트** (조심해서 — 실제 메일 발송):
- 테스트 unified row 1건 준비, `guide_send_request=true`, `guide_html_url` 설정
- 에디터에서 다음을 거의 동시에 실행 (또는 setTimeout으로):
  ```javascript
  function _test_concurrent_guide_send() {
    // 동일한 row 객체로 2번 호출
    var row = _loadUnifiedByBizno('테스트bizno');
    Logger.log('1: ' + JSON.stringify(sendGuideForRow(row)));
    Logger.log('2: ' + JSON.stringify(sendGuideForRow(row)));
  }
  ```
- 기대: 첫 번째는 `{ok:true}`, 두 번째는 `{ok:true, skipped:'already sent for guide_version=N'}` (lock 안에서 시트 재조회로 차단)

---

## G3: genPDF/genEquipPDF에 _pdfInProgress 게이트 일반화

### Before (수정 전 버그)

**시나리오 1: 버전 모달의 PDF 버튼 + autopoll race**
1. 운영자가 견적 버전 히스토리 모달에서 `[견적]` 버튼 클릭 → `genPDF(qtId)` 진입
2. `_pdfInProgress = false` 상태 (sendQuote만 게이트 설정)
3. PDF 생성 중 60초 autopoll이 발화 → `_backgroundRefresh` 실행
4. `quotes` 배열이 통째로 새로 fetch한 데이터로 교체
5. 진행 중인 `q` 객체가 더 이상 `quotes`에 없는 stale 객체
6. PDF 생성 끝 → `q.pdfUrl = url; await syncQt(q, false)` → stale q에 대한 updateQt
7. 결과: 잘못된 객체에 pdfUrl 저장, Drive에 중복 PDF 가능

**시나리오 2: 동시 PDF 버튼 클릭**
1. 운영자가 버전 모달에서 v1 `[견적]` 버튼 클릭 직후 v2 `[견적]` 버튼 빠르게 클릭
2. 두 `genPDF` 호출이 동시에 진행 → 둘 다 `_pdfInProgress` 영향 없음
3. 두 PDF 동시 생성 + 두 Drive 업로드 → race 가능, generateGuide hook도 2번 trigger

### After (수정 후 동작)

**시나리오 1 (버전 모달 + autopoll):**
- `genPDF` 진입 시 `_ownsPdfGate = !_pdfInProgress` (= true) → `_pdfInProgress = true`
- 60초 autopoll이 발화해도 `_backgroundRefresh`의 `if (_pdfInProgress) return` 가드로 즉시 skip
- PDF 생성, syncQt, Drive 업로드 모두 같은 `q` 객체로 안전하게 진행
- `finally` 블록에서 `_pdfInProgress = false` 해제

**시나리오 2 (동시 클릭):**
- 첫 번째 `genPDF` 진입 → `_ownsPdfGate=true`, `_pdfInProgress=true`
- 두 번째 `genPDF` 진입 → `_ownsPdfGate=false` (이미 true) → nested 통과
- 두 번째 실행이 첫 번째 마무리 전에 fire되지만 `_backgroundRefresh`는 차단됨
- 단점: 두 번째 클릭이 완전히 막히진 않음 (단지 race만 방지). 더 강한 보호는 차후 `Set<qtId>` 격상으로 (보고서 권장)
- sendQuote 경로에서 호출되는 경우: sendQuote가 먼저 `_pdfInProgress=true` 설정 → genPDF가 `_ownsPdfGate=false` → 통과 후 unset 안 함 → sendQuote의 finally가 해제 → 정상

### 검증 방법

**정적 검증:**
- `공급기업_관리.html:2521-2526` `genPDF` 진입부에 `_ownsPdfGate` 변수 + outer try 시작 ✅
- `공급기업_관리.html:2640-2645` `genPDF` 끝에 outer finally → `if (_ownsPdfGate) _pdfInProgress = false` ✅
- `공급기업_관리.html:2952-2957` `genEquipPDF`도 동일 ✅
- `공급기업_관리.html:3024-3028` `genEquipPDF` 끝에 outer finally ✅

**동적 검증 (브라우저 콘솔):**
1. 공급기업_관리.html 열기
2. 콘솔에서 `_pdfInProgress` 변수 값 확인 → `false`
3. 견적 발급 시작 → 콘솔에서 `_pdfInProgress` 확인 → `true`
4. 견적 발급 완료 후 → `false`
5. 버전 모달에서 PDF 버튼 클릭 후 즉시 콘솔 확인 → `true`
6. PDF 완료 → `false`

기대: 모든 PDF 생성 경로에서 `_pdfInProgress` 가 `true`로 설정되었다가 finally에서 `false`로 복귀.

---

## G4: q-receiptno readonly + saveQuoteWithVersion에 _findApp 검증

### Before (수정 전 버그)

**시나리오 1: 운영자가 영수증번호를 수정**
1. (가정) 사용자가 DevTools로 readonly 우회 → `q-receiptno` 값을 `NO-260514-9999` (존재 안 함) 으로 변경
2. 또는 외부에서 임의 `saveQt` 호출 with `appId='NO-260514-9999'`
3. 서버 `saveQuoteWithVersion`이 검증 없이 그대로 처리 → 견적 시트에 orphan 행
4. `_safeSync('upsertUnified ...')` hook 안에서 `_findApp(appId)`이 null 반환 → if (app) 가드로 silent skip
5. 견적은 시트에 들어가지만 통합정보 / 노션 / 가이드 메일은 모두 누락
6. 운영자는 클라이언트의 `{ok:true}`만 보고 "발급 성공"으로 인지

### After (수정 후 동작)

- `saveQuoteWithVersion` 진입 직후 (`lock` 잡기 전) `_findApp(data.appId)` 호출
- null이면 즉시 `{ ok:false, error:'해당 신청을 찾을 수 없습니다 (영수증번호=...). 신청 등록 여부를 확인해 주세요.' }` 반환
- 견적 시트에 행 추가 안 됨, 후크도 trigger 안 됨
- 클라이언트 모달의 응답 처리에서 `r.ok===false` 시 `showToast('견적 저장 실패: ' + r.error, 'error')` 등 표시 (기존 클라이언트 로직)

**참고:** `q-receiptno` 입력은 이미 line 961에서 `readonly`로 설정되어 있어 클라이언트 측 보호는 이미 존재. G4.b의 서버 검증은 readonly 우회 / 외부 호출 / DevTools 조작에 대한 second line of defense.

### 검증 방법

**정적 검증:**
- `공급기업_관리.html:961` `q-receiptno` input에 `readonly` 속성 존재 ✅ (기존)
- `Code.gs:553-563` `saveQuoteWithVersion` 진입부에 `_findApp(data.appId)` null 검사 + 거부 응답 ✅
- `updateQt` 케이스의 `updateRow`에는 검증 추가 안 됨 → orphan 견적의 PDF URL 갱신 등 후속 수정 허용 ✅

**동적 검증:**
```javascript
function _test_saveQt_orphan_guard() {
  // 1) 존재하지 않는 appId
  var r1 = saveQuoteWithVersion({ appId:'NO-999999-9999', items:[], total:0 });
  Logger.log('1. orphan appId 거부: ' + JSON.stringify(r1));
  // 기대: { ok:false, error:'해당 신청을 찾을 수 없습니다...' }

  // 2) 빈 appId
  var r2 = saveQuoteWithVersion({ appId:'', items:[], total:0 });
  Logger.log('2. 빈 appId 거부: ' + JSON.stringify(r2));
  // 기대: { ok:false, error:'영수증번호(appId)가 누락되었습니다' }

  // 3) 실재하는 appId (운영 데이터 중 하나)
  var apps = getRows(SN.APP, APP_COLS, APP_ARR);
  if (apps.length > 0) {
    var existingId = apps[0].id;
    // 시트에 진짜 데이터 안 쓰기 위해 dryrun 같은 건 없음. 실 운영 데이터 영향 우려되면 이 케이스는 skip.
    Logger.log('3. 실 appId 가용 검증 skip (운영 영향 회피)');
  }
}
```

기대: 1, 2 모두 `ok:false` + 적절한 에러 메시지.

---

## 운영 배포 절차

세션 1의 변경을 운영에 반영할 때:

### 1) 코드 검토
- `git diff` 또는 IDE에서 5개 파일의 변경 사항을 한 번 더 검토
- 특히 새 함수 `saveAppWithIdGuard` (Code.gs:553-616) 로직 확인

### 2) Atomic commit (권장)
```bash
# G1
git add apps_script/Code.gs 신청기업_장비신청.html
git commit -m "fix(concurrency): G1 — LockService for appendRow/updateRow/upsertRow + saveAppWithIdGuard"

# G2
git add apps_script/NotionSync.gs apps_script/GuideMail.gs apps_script/Code.gs
git commit -m "fix(concurrency): G2 — upsertUnified lock, _safeSync queue, sendGuideForRow lock"

# G3
git add 공급기업_관리.html
git commit -m "fix(concurrency): G3 — _pdfInProgress gate for genPDF/genEquipPDF"

# G4
git add apps_script/Code.gs
git commit -m "fix(integrity): G4 — _findApp guard in saveQuoteWithVersion"
```

(주의: 위 파일 분배는 변경이 G별로 깨끗하게 분리됐다는 전제. 실제로는 Code.gs가 G1·G2·G4에 걸쳐있어 한 commit이 될 수 있음. `git add -p`로 hunk별 분리 권장.)

### 3) Apps Script 에디터에서 배포
- Apps Script 콘솔 열기
- 5개 파일 중 3개(`.gs`)는 Apps Script 프로젝트 안에 있는지 확인
- 새 버전 배포 (Deploy → Manage Deployments → New Version)
- 한가한 시간대(저녁/주말) 권장

### 4) HTML 배포
- `공급기업_관리.html`, `신청기업_장비신청.html`의 호스팅 방식에 따라:
  - Drive 호스팅: 파일 업로드
  - 별도 정적 서버: rsync/scp

### 5) 배포 후 즉시 검증
- `_test_saveAppIdGuard()` 실행 → 충돌 가드 동작 확인
- `_test_safeSync_queue()` 실행 → 큐 적재 동작 확인
- `_test_saveQt_orphan_guard()` 실행 → 검증 거부 동작 확인
- 클라이언트(공급기업/신청기업 페이지) 정상 동작 확인

### 6) 모니터링 (배포 후 24시간)
- Apps Script 실행 로그에서 다음 키워드 확인:
  - `[saveAppWithIdGuard] ID 충돌` — 새로운 충돌 가드 동작 흔적
  - `시트 락 대기 timeout` — lock 대기 timeout 발생 빈도 (잦으면 lock scope 재검토)
  - `_sync_queue` 시트 행 수 변화 — 후크 실패로 적재된 큐 항목

---

## 롤백 절차

모든 변경이 코드 레벨이므로 git 단위 revert로 즉시 복원 가능:

```bash
# 단일 commit 롤백
git revert <commit-hash>

# 또는 마지막 N개 commit 일괄 롤백
git revert HEAD~3..HEAD
```

복원 후 Apps Script 새 버전 배포 + HTML 재배포.

**시트 데이터에는 변경이 없으므로 data rollback은 불필요.**

---

## 사용자 확인 요청

위 시나리오와 검증 방법을 검토하시고, 다음 중 하나로 응답해 주세요:

1. **OK, commit 진행** — G별 atomic commit 후 다음 묶음(세션 2: G5+G6)으로 이동
2. **특정 G 재검토 필요** — 어느 G에 대한 우려나 질문이 있으면 명시
3. **검증 케이스 추가 필요** — 위 동적 검증 외 추가로 확인하고 싶은 시나리오가 있으면 명시
4. **운영 영향 재검토** — 특히 우려되는 영향이 있으면 명시
