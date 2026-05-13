# 가이드 메일 중복 발송 근절 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 노션 체크박스 양방향 sync 중 boolean→string→`!!` truthy 변환 버그로 발생하던 자동 중복 발송을 완전히 차단하고, 같은 가이드 버전에 대한 멱등성을 데이터 모델 차원에서 보장한다.

**Architecture:** 
- **Layer 1 (근본 수정):** `_loadUnifiedByBizno`가 `UNIFIED_BOOL`을 인식하도록 + `_toNotionValue` checkbox 변환을 strict 매칭으로.
- **Layer 2 (방어망):** 시트 read/write 전 경로에서 boolean 정규화를 단일 헬퍼로 통일, `_bidirectionalHash`도 정규화된 값 기반.
- **Layer 3 (버전 멱등성):** `guide_sent_version` 신설 컬럼으로 "이 가이드 버전 발송 완료" 단일 진실 보장. `sendGuideNow` 백업 경로도 동일 가드 적용.
- **Layer 4 (운영 데이터 정리):** 모든 정리 함수는 dryRun=true 기본, 로그만 출력. 사용자가 검토 후 명시적으로 dryRun=false 호출. 변경 전 원본 값 모두 로깅하여 역전 가능.

**Tech Stack:** Google Apps Script (V8 런타임), Google Sheets API, Notion REST API.

**데이터 안전 원칙 (모든 태스크 공통):**
1. **읽기와 쓰기를 명확히 분리** — 진단 함수는 절대 데이터를 변경하지 않는다.
2. **모든 변경 함수는 dryRun 파라미터를 받고 기본값 true** — 실제 변경 전 반드시 로그 검토 단계.
3. **변경 직전 원본 값을 Logger에 남긴다** — Apps Script 로그(Execution log)에서 사후 복구 가능.
4. **시트 컬럼 추가만 가능, 컬럼 삭제·재정렬은 절대 금지** — `autoInitSheets`는 추가만 처리한다 (Code.gs:263-283 확인됨).
5. **노션 페이지 삭제·archive 절대 금지** — 운영 페이지에는 PATCH(필드 업데이트)만.
6. **각 태스크 종료 시 git commit** — 문제 발생 시 즉시 git revert로 코드 단위 롤백.

---

## 사전 단계 (필수)

### Task 0: 작업 시작 전 안전 체크리스트

**Files:** 없음 (체크리스트만)

- [ ] **Step 1: 현재 시트·노션 상태 백업**

운영 시트 ID 확인 후, 사용자가 직접 Google Sheets UI에서 `파일 > 사본 만들기`로 백업 시트 생성. 백업 시트 ID를 `docs/dev-notes/2026-05-13_가이드중복발송_수정노트.md` 에 기록.

- [ ] **Step 2: 노션 DB 백업 확인**

노션 DB UI에서 `... > Export` 로 Markdown & CSV 익스포트. 다운로드한 파일을 `~/Downloads` 등에 보관, 경로를 위 노트에 기록.

- [ ] **Step 3: 현재 시간 트리거 일시 정지**

Apps Script 에디터 > 트리거(시계 아이콘)에서 `pollAndSend`, `syncFromNotion` 두 트리거를 **임시 비활성화**. 작업 중 자동 발송·동기화로 인한 간섭을 막는다. 트리거 ID 캡처해서 노트에 기록.

- [ ] **Step 4: 작업 노트 파일 생성**

```
docs/dev-notes/2026-05-13_가이드중복발송_수정노트.md
```

다음 항목을 미리 채워둔다:
- 백업 시트 ID
- 노션 익스포트 경로
- 비활성화한 트리거 목록
- 작업 시작 시각
- 각 태스크 commit hash (작업 중 채워나감)

- [ ] **Step 5: Commit (체크리스트 노트만)**

```bash
git add docs/dev-notes/2026-05-13_가이드중복발송_수정노트.md docs/superpowers/plans/2026-05-13-guide-mail-duplicate-fix.md
git commit -m "docs: 가이드 메일 중복발송 수정 작업 노트 + 계획서 추가"
```

---

## 계층 1 — 근본 원인 수정

### Task 1: `_loadUnifiedByBizno`에 UNIFIED_BOOL 처리 추가

**Files:**
- Modify: `apps_script/NotionSync.gs:204-227`
- Test (옵션): `apps_script/NotionSync.gs` 하단에 `_test_loadUnifiedByBizno_boolean()` 함수 추가

**배경:** `Code.gs:63`에 `UNIFIED_BOOL = { guide_send_request:'boolean' }`가 선언되어 있으나 `_loadUnifiedByBizno`는 이를 참조하지 않아 boolean 셀이 문자열 `"false"`/`"true"`로 변환됨. 이것이 `_toNotionValue('checkbox', "false")` → `!!"false"` === `true` 버그의 입력 조건.

- [ ] **Step 1: 실패 테스트 작성 (Apps Script 에디터에서 실행)**

`apps_script/NotionSync.gs` 파일 맨 아래에 추가:

```javascript
// ─────────────────────────────────────────────────────────────
// 단위 테스트 — Apps Script 에디터에서 직접 실행 (▶️)
// 통과 시: "[PASS] ..." 로그. 실패 시: "[FAIL] ..." 로그.
// ─────────────────────────────────────────────────────────────
function _test_loadUnifiedByBizno_boolean() {
  // 통합정보 시트 첫 데이터 행의 bizno 로 검증
  const sheet = getSheet(SN.UNIFIED);
  if (sheet.getLastRow() < 2) {
    Logger.log('[SKIP] 통합정보 시트가 비어있음');
    return;
  }
  const biznoIdx = UNIFIED_COLS.indexOf('bizno');
  const firstBizno = sheet.getRange(2, biznoIdx + 1).getValue();
  if (!firstBizno) {
    Logger.log('[SKIP] 첫 행 bizno 없음');
    return;
  }
  const row = _loadUnifiedByBizno(firstBizno);
  const v = row.guide_send_request;
  const isBoolean = (typeof v === 'boolean');
  if (isBoolean) {
    Logger.log('[PASS] guide_send_request 가 boolean: ' + v);
  } else {
    Logger.log('[FAIL] guide_send_request 가 boolean 아님. 타입=' + typeof v + ', 값=' + JSON.stringify(v));
  }
}
```

- [ ] **Step 2: Apps Script 에디터에서 `_test_loadUnifiedByBizno_boolean` 실행 → FAIL 확인**

수정 전이므로 `[FAIL] guide_send_request 가 boolean 아님. 타입=string, 값="false"` (또는 `"true"`) 로그 확인.

- [ ] **Step 3: `_loadUnifiedByBizno` 본체 수정**

`NotionSync.gs:212-222` 의 forEach 블록을 다음으로 교체:

```javascript
UNIFIED_COLS.forEach(function(col, j) {
  const v = data[i][j];
  if (UNIFIED_ARR.indexOf(col) >= 0) {
    try { obj[col] = JSON.parse(v || '[]'); } catch(e) { obj[col] = []; }
  } else if (UNIFIED_NUM[col] === 'number') {
    // 빈 셀은 빈 문자열로 보존 (0과 구분 — 노션에 null로 가도록)
    obj[col] = (v === '' || v == null) ? '' : (Number(v) || 0);
  } else if (UNIFIED_BOOL[col] === 'boolean') {
    // boolean 셀은 boolean 으로 보존 — 시트 체크박스/노션 checkbox 와의 sync 일관성
    if (v === true || v === false) {
      obj[col] = v;
    } else if (v == null || v === '') {
      obj[col] = false;
    } else {
      obj[col] = String(v).toLowerCase() === 'true';
    }
  } else {
    obj[col] = v == null ? '' : String(v);
  }
});
```

- [ ] **Step 4: 테스트 재실행 → PASS 확인**

`_test_loadUnifiedByBizno_boolean` 다시 실행. `[PASS] guide_send_request 가 boolean: true` 또는 `false` 로그 확인.

- [ ] **Step 5: Commit**

```bash
git add apps_script/NotionSync.gs
git commit -m "fix(notion-sync): _loadUnifiedByBizno가 UNIFIED_BOOL을 인식하도록 — boolean 컬럼이 문자열로 변환되던 버그"
```

---

### Task 2: `_toNotionValue` checkbox 변환 strict 매칭

**Files:**
- Modify: `apps_script/NotionSync.gs:656-657`
- Test: 같은 파일 하단에 `_test_toNotionValue_checkbox()` 추가

**배경:** `case 'checkbox': return { checkbox: !!val };` 에서 `!!"false"` 가 `true` 인 자바스크립트 truthy 함정. Task 1 만으로도 호출처에서 boolean 만 들어오게 되지만, 미래 호출자(예: 직접 `_toNotionValue('checkbox', '0')` 호출)도 안전하도록 방어 강화.

- [ ] **Step 1: 실패 테스트 작성**

```javascript
function _test_toNotionValue_checkbox() {
  const cases = [
    [true,    true,  'boolean true'],
    [false,   false, 'boolean false'],
    ['true',  true,  '문자열 "true"'],
    ['false', false, '문자열 "false"'],   // 핵심 — 기존 버그
    ['TRUE',  true,  '문자열 "TRUE"'],
    ['FALSE', false, '문자열 "FALSE"'],
    ['',      false, '빈 문자열'],
    [null,    false, 'null'],
    [undefined, false, 'undefined'],
    [0,       false, '숫자 0'],
    [1,       true,  '숫자 1']
  ];
  let pass = 0, fail = 0;
  cases.forEach(function(c) {
    const input = c[0], expected = c[1], desc = c[2];
    const out = _toNotionValue('checkbox', input);
    const ok = (out && out.checkbox === expected);
    if (ok) {
      pass++;
      Logger.log('[PASS] ' + desc + ' → ' + expected);
    } else {
      fail++;
      Logger.log('[FAIL] ' + desc + ' → got ' + JSON.stringify(out) + ', expected {checkbox:' + expected + '}');
    }
  });
  Logger.log('TOTAL: ' + pass + ' pass, ' + fail + ' fail');
}
```

- [ ] **Step 2: 테스트 실행 → 일부 FAIL 확인 (특히 "문자열 \"false\"")**

기존 `!!val` 구현에서는 `"false"`, `"FALSE"` 케이스가 FAIL. 0, 1 도 boolean 으로 안 떨어짐.

- [ ] **Step 3: `_toNotionValue` checkbox 케이스 교체**

`NotionSync.gs:656-657` 의 다음 두 줄
```javascript
case 'checkbox':
  return { checkbox: !!val };
```
을 다음으로 교체:
```javascript
case 'checkbox': {
  let t;
  if (val === true || val === false) {
    t = val;
  } else if (val == null || val === '') {
    t = false;
  } else if (typeof val === 'number') {
    t = val !== 0;
  } else {
    t = String(val).toLowerCase() === 'true';
  }
  return { checkbox: t };
}
```

- [ ] **Step 4: 테스트 재실행 → 모두 PASS 확인**

`TOTAL: 11 pass, 0 fail` 로그 확인.

- [ ] **Step 5: Commit**

```bash
git add apps_script/NotionSync.gs
git commit -m "fix(notion-sync): _toNotionValue checkbox를 strict 매칭으로 — 문자열 \"false\"가 truthy로 변환되던 버그"
```

---

## 계층 4 — 운영 데이터 진단 (mutation 전, 읽기 전용)

> Layer 4를 Task 11(정리, mutation)과 Task 3(진단, 읽기 전용)로 분할. 진단을 먼저 수행해 영향 범위 가시화.

### Task 3: 읽기 전용 진단 함수 — 현재 데이터의 불일치 식별

**Files:**
- Create section in: `apps_script/GuideMail.gs` 하단

**배경:** Task 1·2 적용 전 작성된 데이터의 불일치 상태를 파악. 절대로 시트·노션을 변경하지 않는 읽기 전용 함수.

- [ ] **Step 1: `_audit_guideSendState` 함수 추가**

`apps_script/GuideMail.gs` 맨 아래에 추가:

```javascript
// ─────────────────────────────────────────────────────────────
// 진단 (읽기 전용) — 가이드발송요청 / 발송상태 / 노션 상태 불일치 검사
// 절대로 시트·노션을 변경하지 않음. 로그만 출력.
// 실행: Apps Script 에디터에서 _audit_guideSendState 선택 후 ▶️
// 결과: View > Logs (또는 Execution log) 에서 확인
// ─────────────────────────────────────────────────────────────
function _audit_guideSendState() {
  Logger.log('=== _audit_guideSendState 시작 (READ-ONLY) ===');
  const sheet = getSheet(SN.UNIFIED);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('통합정보 시트가 비어있음');
    return { ok: true, rows: 0 };
  }

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const data = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();

  const idCol      = headers.indexOf('id');
  const companyCol = headers.indexOf('company');
  const biznoCol   = headers.indexOf('bizno');
  const reqCol     = headers.indexOf('guide_send_request');
  const statusCol  = headers.indexOf('guide_sent_status');
  const sentAtCol  = headers.indexOf('guide_sent_at');
  const verCol     = headers.indexOf('guide_version');

  const findings = {
    sheetReqAsString:           [],   // 시트 셀에 문자열 "true"/"false" 가 들어있는 행
    sentButRequestStillTrue:    [],   // status=발송완료 이지만 시트 guide_send_request가 truthy
    sentNoSentAt:               [],   // status=발송완료 인데 guide_sent_at 비어있음
    rowsWithoutGuideVersion:    [],   // status=발송완료 인데 guide_version 비어있음
    totalRows: 0
  };

  for (let i = 0; i < data.length; i++) {
    findings.totalRows++;
    const r = data[i];
    const id      = r[idCol];
    const company = r[companyCol];
    const bizno   = r[biznoCol];
    const reqRaw  = r[reqCol];
    const status  = r[statusCol];
    const sentAt  = r[sentAtCol];
    const ver     = r[verCol];

    const reqIsString = (typeof reqRaw === 'string');
    const reqTruthy   = (reqRaw === true || String(reqRaw).toLowerCase() === 'true');
    const isSent      = (status === GUIDE_STATUS.SENT);

    if (reqIsString && reqRaw !== '') {
      findings.sheetReqAsString.push({ id:id, company:company, bizno:bizno, value:reqRaw });
    }
    if (isSent && reqTruthy) {
      findings.sentButRequestStillTrue.push({ id:id, company:company, bizno:bizno, sentAt:sentAt, version:ver });
    }
    if (isSent && !sentAt) {
      findings.sentNoSentAt.push({ id:id, company:company, bizno:bizno });
    }
    if (isSent && (ver === '' || ver == null)) {
      findings.rowsWithoutGuideVersion.push({ id:id, company:company, bizno:bizno });
    }
  }

  Logger.log('총 행 수: ' + findings.totalRows);
  Logger.log('--- 시트 guide_send_request 가 문자열로 저장된 행 ' + findings.sheetReqAsString.length + '개 ---');
  findings.sheetReqAsString.forEach(function(f){
    Logger.log('  id=' + f.id + ' company=' + f.company + ' bizno=' + f.bizno + ' value=' + JSON.stringify(f.value));
  });
  Logger.log('--- status=발송완료 인데 guide_send_request truthy 인 행 ' + findings.sentButRequestStillTrue.length + '개 ---');
  findings.sentButRequestStillTrue.forEach(function(f){
    Logger.log('  id=' + f.id + ' company=' + f.company + ' bizno=' + f.bizno + ' sentAt=' + f.sentAt + ' version=' + f.version);
  });
  Logger.log('--- status=발송완료 인데 guide_sent_at 없음 ' + findings.sentNoSentAt.length + '개 ---');
  findings.sentNoSentAt.forEach(function(f){
    Logger.log('  id=' + f.id + ' company=' + f.company + ' bizno=' + f.bizno);
  });
  Logger.log('--- status=발송완료 인데 guide_version 없음 ' + findings.rowsWithoutGuideVersion.length + '개 ---');
  findings.rowsWithoutGuideVersion.forEach(function(f){
    Logger.log('  id=' + f.id + ' company=' + f.company + ' bizno=' + f.bizno);
  });
  Logger.log('=== _audit_guideSendState 완료 ===');
  return { ok: true, findings: findings };
}
```

- [ ] **Step 2: Apps Script 에디터에서 `_audit_guideSendState` 실행**

View > Logs 에서 결과 확인. 출력 내용을 `docs/dev-notes/2026-05-13_가이드중복발송_수정노트.md` 의 "진단 결과" 섹션에 복사.

- [ ] **Step 3: 노션 측 진단 함수 추가**

같은 파일에 추가:

```javascript
function _audit_notionGuideCheckbox() {
  Logger.log('=== _audit_notionGuideCheckbox 시작 (READ-ONLY) ===');
  const config = getNotionConfig();
  const sheet = getSheet(SN.UNIFIED);
  const lastRow = sheet.getLastRow();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const biznoCol  = headers.indexOf('bizno');
  const statusCol = headers.indexOf('guide_sent_status');
  const reqCol    = headers.indexOf('guide_send_request');
  const idCol     = headers.indexOf('id');

  const data = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  let checked = 0, mismatch = 0, missing = 0;
  data.forEach(function(r) {
    const bizno = String(r[biznoCol] || '').trim();
    if (!bizno) return;
    const status = r[statusCol];
    const sheetReq = r[reqCol];
    const sheetTruthy = (sheetReq === true || String(sheetReq).toLowerCase() === 'true');

    const page = _findNotionPageByBizno(bizno);
    if (!page) {
      missing++;
      Logger.log('  [MISSING] id=' + r[idCol] + ' bizno=' + bizno + ' → 노션 페이지 없음');
      return;
    }
    const notionVal = !!(page.properties && page.properties['가이드발송요청'] && page.properties['가이드발송요청'].checkbox);
    checked++;
    const isSent = (status === GUIDE_STATUS.SENT);

    if (isSent && notionVal) {
      mismatch++;
      Logger.log('  [MISMATCH] id=' + r[idCol] + ' bizno=' + bizno
        + ' status=발송완료, 시트=' + JSON.stringify(sheetReq)
        + ', 노션=TRUE (정리 대상)');
    } else if (notionVal !== sheetTruthy) {
      Logger.log('  [DIVERGE] id=' + r[idCol] + ' bizno=' + bizno
        + ' status=' + status
        + ' 시트=' + JSON.stringify(sheetReq) + ' 노션=' + notionVal);
    }
  });
  Logger.log('총 검사: ' + checked + ', 발송완료&노션TRUE 불일치: ' + mismatch + ', 노션페이지없음: ' + missing);
  Logger.log('=== _audit_notionGuideCheckbox 완료 ===');
  return { ok:true, checked:checked, mismatch:mismatch, missing:missing };
}
```

- [ ] **Step 4: 노션 진단 함수 실행 후 결과 노트에 기록**

Apps Script API quota 주의 — 노션 API가 행당 1회 호출이라 100행 넘으면 시간 걸림.

- [ ] **Step 5: Commit**

```bash
git add apps_script/GuideMail.gs
git commit -m "feat(guide): 가이드 발송 상태 진단 함수 추가 (read-only)"
```

---

## 계층 2 — 방어망

### Task 4: `_applyNotionPageToSheet` boolean 보존

**Files:**
- Modify: `apps_script/NotionSync.gs:1237-1244`

**배경:** 노션 → 시트 역동기화 시 모든 값이 `String(val)`로 변환됨. boolean 컬럼은 boolean 으로 유지되어야 일관성 보장.

- [ ] **Step 1: 진단 — 현재 시트의 guide_send_request 셀 타입 캡처**

Apps Script 에디터에서 임시 함수 실행:
```javascript
function _diag_sheetReqCellTypes() {
  const sheet = getSheet(SN.UNIFIED);
  const lastRow = sheet.getLastRow();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const reqCol = headers.indexOf('guide_send_request') + 1;
  if (reqCol < 1) return Logger.log('컬럼 없음');
  const vals = sheet.getRange(2, reqCol, lastRow - 1, 1).getValues();
  const counts = { boolean:0, string:0, number:0, empty:0, other:0 };
  vals.forEach(function(r) {
    const v = r[0];
    if (v === '' || v == null) counts.empty++;
    else if (typeof v === 'boolean') counts.boolean++;
    else if (typeof v === 'string') counts.string++;
    else if (typeof v === 'number') counts.number++;
    else counts.other++;
  });
  Logger.log(JSON.stringify(counts));
}
```
실행 결과를 노트에 기록 후 함수 삭제. (커밋하지 않는 일회성 진단)

- [ ] **Step 2: `_applyNotionPageToSheet` setValue 분기 수정**

`NotionSync.gs:1237-1244` 의 setValue 블록을 다음으로 교체:

```javascript
Object.keys(changes).forEach(function(f) {
  const colIdx = UNIFIED_COLS.indexOf(f);
  if (colIdx >= 0) {
    let val = changes[f];
    let writeVal;
    if (UNIFIED_BOOL[f] === 'boolean') {
      // boolean 컬럼: 항상 boolean 으로 쓰기 (시트 체크박스 셀 유지)
      writeVal = (val === true || String(val).toLowerCase() === 'true');
    } else if (Array.isArray(val)) {
      writeVal = JSON.stringify(val);
    } else {
      writeVal = (val == null ? '' : String(val));
    }
    unifiedSheet.getRange(targetRow, colIdx + 1).setValue(writeVal);
  }
});
```

- [ ] **Step 3: 진단 함수 재실행으로 변화 확인 (단, 시트는 아직 변경 안 됨 — 새 노션 sync 이벤트가 와야 적용)**

이 태스크는 future-proofing. 즉시 효과는 없지만 다음 sync 부터 boolean 보존.

- [ ] **Step 4: Commit**

```bash
git add apps_script/NotionSync.gs
git commit -m "fix(notion-sync): _applyNotionPageToSheet 가 boolean 컬럼을 boolean 으로 보존"
```

---

### Task 5: `_bidirectionalHash` 정규화

**Files:**
- Modify: `apps_script/NotionSync.gs:777-785`

**배경:** 해시 계산에서 `String(unifiedRow[f])` 로 모두 문자열화. `true` 와 `"true"` 가 같은 해시를 내도록 정규화.

- [ ] **Step 1: 테스트 추가**

```javascript
function _test_bidirectionalHash_boolEquivalence() {
  const a = { status:'접수', manager:'', memo:'', quoteMemo:'', guide_send_request: true };
  const b = { status:'접수', manager:'', memo:'', quoteMemo:'', guide_send_request: 'true' };
  const c = { status:'접수', manager:'', memo:'', quoteMemo:'', guide_send_request: false };
  const d = { status:'접수', manager:'', memo:'', quoteMemo:'', guide_send_request: 'false' };
  const ha = _bidirectionalHash(a);
  const hb = _bidirectionalHash(b);
  const hc = _bidirectionalHash(c);
  const hd = _bidirectionalHash(d);
  if (ha === hb && hc === hd && ha !== hc) {
    Logger.log('[PASS] hash(true)==hash("true"), hash(false)==hash("false"), true≠false');
  } else {
    Logger.log('[FAIL] ha=' + ha + ' hb=' + hb + ' hc=' + hc + ' hd=' + hd);
  }
}
```

- [ ] **Step 2: 테스트 실행 → FAIL 확인**

기존 구현은 `String(true)="true"` 와 `String("true")="true"` 가 같아서 ha==hb 는 우연히 통과할 수도 있지만, 시트에서 false 가 boolean 으로 들어왔을 때 String(false)="false" 와 비교 시 이슈. 어쨌든 명시적 정규화로.

- [ ] **Step 3: `_bidirectionalHash` 본체 수정**

`NotionSync.gs:777-785` 의 함수를 다음으로 교체:

```javascript
function _bidirectionalHash(unifiedRow) {
  const parts = BIDIRECTIONAL_FIELDS.map(function(f) {
    let v = unifiedRow[f];
    if (UNIFIED_BOOL[f] === 'boolean') {
      // boolean 정규화: true/false 만 가능
      v = (v === true || String(v).toLowerCase() === 'true') ? 'true' : 'false';
    } else {
      v = (v == null ? '' : String(v));
    }
    return f + '=' + v;
  });
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, parts.join('|'))
    .map(function(b) { return ((b < 0 ? b + 256 : b)).toString(16); })
    .map(function(h) { return h.length === 1 ? '0' + h : h; })
    .join('').slice(0, 16);
}
```

- [ ] **Step 4: 테스트 재실행 → PASS 확인**

- [ ] **Step 5: 해시 재계산 영향 분석 노트**

이 변경으로 기존에 저장된 `hash_<bizno>` 값들과 새로 계산되는 해시가 달라질 수 있음. 단, `_applyNotionPageToSheet`의 분기는 `currentSheetHash !== lastHash` 이면 "시트가 더 최근에 변경됨" 으로 간주해 push 후 sync skip 하므로, 최악의 결과는 **다음 sync 1회가 sheet→Notion push 한 번 추가** 정도. 데이터 손실은 없음. 노트에 기록.

- [ ] **Step 6: Commit**

```bash
git add apps_script/NotionSync.gs
git commit -m "fix(notion-sync): _bidirectionalHash 가 boolean 값을 정규화하여 비교"
```

---

## 계층 3 — 버전 기반 멱등성

### Task 6: `guide_sent_version` 컬럼 추가 (스키마 변경, 비파괴적)

**Files:**
- Modify: `apps_script/Code.gs:39-54` (UNIFIED_COLS 배열에 추가)
- Modify: `apps_script/Code.gs:61` (UNIFIED_NUM 에 추가)
- Modify: `apps_script/NotionSync.gs:53-60` (NOTION_PROP_MAP 에 추가)

**배경:** "이 가이드 버전이 발송 완료되었는가" 를 단일 진실로 보장하기 위한 컬럼. autoInitSheets 가 자동으로 헤더에 컬럼 추가 (Code.gs:274-278 확인), 기존 데이터는 빈 셀로 유지됨.

- [ ] **Step 1: `UNIFIED_COLS` 에 `guide_sent_version` 추가**

`apps_script/Code.gs:39-54` 의 `UNIFIED_COLS` 배열 끝에 추가:

```javascript
const UNIFIED_COLS = [
  // ... 기존 컬럼들 ...
  'guide_script','guide_generated_at','guide_html_url','guide_version',
  'guide_send_request','guide_sent_at','guide_sent_status','guide_error',
  'guide_sent_version'   // ← 신설: 마지막으로 발송 완료된 가이드 버전 (멱등성 키)
];
```

(현재 정확한 줄을 보고 정확히 마지막 위치에 추가. UNIFIED_COLS 순서 변경 금지.)

- [ ] **Step 2: `UNIFIED_NUM` 에 추가**

`apps_script/Code.gs:61`:
```javascript
const UNIFIED_NUM = { total:'number', eqCount:'number', version:'number', guide_version:'number', guide_sent_version:'number' };
```

- [ ] **Step 3: `NOTION_PROP_MAP` 에 추가**

`apps_script/NotionSync.gs:53-60` 의 가이드 메일 섹션에 추가:
```javascript
guide_sent_status:   { name: '가이드발송상태',     type: 'select' },
guide_sent_version:  { name: '가이드발송버전',     type: 'number' }   // ← 신설
```

- [ ] **Step 4: 노션 스키마 자동 동기화 — `ensureNotionSchema` 가 처리**

이미 `pushToNotion` 내에서 `ensureNotionSchema()` 호출하므로 첫 push 시 노션 DB 에 속성이 추가됨. 추가 코드 불필요. 단, 추후 확인 필요.

- [ ] **Step 5: 시트 자동 마이그레이션 검증**

Apps Script 에디터에서 `initSheets()` 실행. 통합정보 시트 마지막 컬럼이 `guide_sent_version` 으로 추가되었는지 확인. 기존 데이터 변경 없음을 확인 (마지막 컬럼 셀 모두 빈 값).

- [ ] **Step 6: Commit**

```bash
git add apps_script/Code.gs apps_script/NotionSync.gs
git commit -m "feat(guide): guide_sent_version 컬럼 추가 — 가이드 버전 기반 멱등성 키"
```

---

### Task 7: `sendGuideForRow` 버전 멱등성 가드 + 발송 직전 클리어

**Files:**
- Modify: `apps_script/GuideMail.gs:648-736`

**배경:** 
- 현재 멱등성: `status===SENT && 5분 이내` (시간창 의존, 5분 지나면 뚫림)
- 신규 멱등성: `guide_sent_version === guide_version` 이면 무조건 skip (시간 의존 제거)
- 추가 안전망: 발송 직전 `guide_send_request=false` 먼저 클리어 후 발송 (TOCTOU 방어)

- [ ] **Step 1: 테스트 함수 — 동일 버전 재발송 차단 시나리오**

```javascript
function _test_sendGuideForRow_versionIdempotency() {
  // 시트의 첫 발송완료 행을 찾아 검증
  const sheet = getSheet(SN.UNIFIED);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) { Logger.log('[SKIP] 시트 비어있음'); return; }
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const statusCol  = headers.indexOf('guide_sent_status');
  const verCol     = headers.indexOf('guide_version');
  const sentVerCol = headers.indexOf('guide_sent_version');
  const biznoCol   = headers.indexOf('bizno');

  const data = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  let target = null;
  for (let i = 0; i < data.length; i++) {
    if (data[i][statusCol] === GUIDE_STATUS.SENT && data[i][verCol] && data[i][sentVerCol]
        && Number(data[i][verCol]) === Number(data[i][sentVerCol])) {
      target = { bizno: data[i][biznoCol], v: data[i][verCol] };
      break;
    }
  }
  if (!target) { Logger.log('[SKIP] guide_sent_version 백필된 행이 없음 — Task 11 정리 후 재실행'); return; }

  const row = _loadUnifiedByBizno(target.bizno);
  const r = sendGuideForRow(row);
  if (r.ok && r.skipped && /version/.test(r.skipped)) {
    Logger.log('[PASS] 같은 버전 재발송 skip: ' + r.skipped);
  } else {
    Logger.log('[FAIL] 결과=' + JSON.stringify(r));
  }
}
```

- [ ] **Step 2: `sendGuideForRow` 본체 수정 — 버전 가드 추가, 발송 직전 클리어**

`apps_script/GuideMail.gs:648-736` 의 `sendGuideForRow` 함수에서 다음 변경을 적용:

A. 기존 5분 멱등성 블록(672-680) 위에 버전 멱등성 추가:

```javascript
// 버전 기반 멱등성 — 이 가이드 버전이 이미 발송 완료된 경우 skip
const curVer    = Number(unifiedRow.guide_version) || 0;
const sentVer   = Number(unifiedRow.guide_sent_version) || 0;
if (curVer > 0 && sentVer >= curVer && unifiedRow.guide_sent_status === GUIDE_STATUS.SENT) {
  Logger.log('[sendGuideForRow] 버전 멱등성 skip — guide_version=' + curVer + ' guide_sent_version=' + sentVer + ' id=' + id);
  return { ok:true, skipped:'already sent for guide_version=' + curVer };
}
```

B. 기존 5분 멱등성 블록은 보존 (Make.com 재시도 안전망으로 그대로 유효).

C. 발송 직전 `guide_send_request=false` 먼저 클리어:

기존:
```javascript
try {
  // 1. HTML 본문 Drive에서 fetch
  const htmlFileId = ...
```

수정:
```javascript
try {
  // 0. TOCTOU 방어 — 발송 시도 전 send_request 먼저 클리어
  //    이 시점에 다른 트리거가 같은 행을 보더라도 isRequested=false 로 skip 됨
  updateUnifiedRowFields(id, { guide_send_request: false });

  // 1. HTML 본문 Drive에서 fetch
  const htmlFileId = ...
```

D. 성공 시 시트 업데이트(`GuideMail.gs:717-723`)에 `guide_sent_version` 기록:

기존:
```javascript
updateUnifiedRowFields(id, {
  guide_sent_status:  GUIDE_STATUS.SENT,
  guide_sent_at:      nowKst,
  guide_send_request: false,
  guide_error:        ''
});
```

수정:
```javascript
updateUnifiedRowFields(id, {
  guide_sent_status:   GUIDE_STATUS.SENT,
  guide_sent_at:       nowKst,
  guide_send_request:  false,
  guide_sent_version:  curVer,   // ← 신설
  guide_error:         ''
});
```

(C 단계에서 이미 `guide_send_request=false` 를 썼지만, 발송 성공 후 다시 명시적으로 false 유지 — 무해함.)

E. 실패 시(`GuideMail.gs:728-734`)도 `guide_send_request: false` 보존. 변경 없음.

- [ ] **Step 3: 테스트 실행 → 첫 실행은 SKIP (guide_sent_version 미백필) 정상**

Task 11 백필 후 재검증 예정. 일단 코드 컴파일·문법 오류 없는지만 확인 (Apps Script 에디터에서 어떤 함수든 실행 시 syntax error 면 즉시 에러 뜸).

- [ ] **Step 4: Commit**

```bash
git add apps_script/GuideMail.gs
git commit -m "feat(guide): sendGuideForRow 버전 멱등성 + 발송 전 send_request 클리어"
```

---

### Task 8: `sendGuideNow` (백업 경로) 멱등성 가드

**Files:**
- Modify: `apps_script/GuideMail.gs:827-868`

**배경:** Make.com `즉시발송` URL 호출 시 `guide_send_request` 무시하고 발송. 의도된 동작이긴 하나, `sendGuideForRow` 버전 가드만으로 충분히 안전해짐. 추가 변경 없이도 Task 7 의 가드가 이미 적용됨 → 명시적 확인만.

- [ ] **Step 1: 동작 확인 — `sendGuideNow` 가 `sendGuideForRow` 를 거치므로 자동 가드됨**

코드 변경 없음. `sendGuideForRow` 호출이 Task 7 의 버전 멱등성을 받으므로, 같은 버전 가이드는 `sendGuideNow` 로도 재발송 불가.

- [ ] **Step 2: 단, `sendGuideNow` 에 명시적 안전 로그 추가**

`GuideMail.gs:858` 의 `const r = sendGuideForRow(target);` 직전에 추가:

```javascript
// 백업 경로 호출 진입 로깅 — Make.com 호출 추적용
Logger.log('[sendGuideNow] 진입 id=' + data.id + ' bizno=' + target.bizno
  + ' status=' + target.guide_sent_status
  + ' guide_version=' + target.guide_version
  + ' guide_sent_version=' + target.guide_sent_version);
const r = sendGuideForRow(target);
Logger.log('[sendGuideNow] 결과 id=' + data.id + ' → ' + JSON.stringify(r));
```

- [ ] **Step 3: Commit**

```bash
git add apps_script/GuideMail.gs
git commit -m "feat(guide): sendGuideNow 호출 추적 로그 추가 — 백업 경로도 sendGuideForRow 의 버전 가드 상속"
```

---

### Task 9: `pollAndSend` 발송 전 행 단위 락 강화 (선택적)

**Files:**
- Modify: `apps_script/GuideMail.gs:747-817`

**배경:** Task 7 의 발송 직전 `guide_send_request=false` 클리어로 이미 대부분의 race 가 차단됨. 추가로 `MAX_PER_TICK` 도달 시 안전한 종료를 보강.

- [ ] **Step 1: `pollAndSend` 의 행 처리 직전에 status 재확인 추가**

`GuideMail.gs:782-794` 의 row 객체 구성 직후, sendGuideForRow 호출 전에 추가:

```javascript
// 재확인 — 다른 트리거가 직전에 발송했을 가능성
const freshRowCheck = _loadUnifiedByBizno(row.bizno);
if (freshRowCheck) {
  const cv = Number(freshRowCheck.guide_version) || 0;
  const sv = Number(freshRowCheck.guide_sent_version) || 0;
  if (cv > 0 && sv >= cv && freshRowCheck.guide_sent_status === GUIDE_STATUS.SENT) {
    Logger.log('[pollAndSend] skip id=' + row.id + ' — 직전 다른 경로에서 동일 버전 발송됨');
    continue;
  }
}
```

(Task 7 의 sendGuideForRow 내부 가드와 중복되지만, 외부에서 한 번 더 확인하여 sendGuideForRow 호출 자체를 줄임. 무해한 중복 방어.)

- [ ] **Step 2: Commit**

```bash
git add apps_script/GuideMail.gs
git commit -m "fix(guide): pollAndSend 발송 전 행 단위 재확인 — race condition 추가 방어"
```

---

## 계층 4 — 운영 데이터 정리 (mutation, dry-run 기본)

### Task 10: `_repair_guideSendState` — dry-run 정리 함수

**Files:**
- Create section in: `apps_script/GuideMail.gs` 하단

**배경:** Task 3 진단에서 식별된 불일치 행들을 안전하게 정상화. 무조건 dryRun=true 기본, 명시적으로 false 전달해야 변경.

- [ ] **Step 1: `_repair_guideSendState` 함수 추가**

```javascript
// ─────────────────────────────────────────────────────────────
// 정리 (dryRun 기본 true) — 불일치 데이터를 안전하게 정상화
// 변경 대상:
//   1) 시트 guide_send_request 가 문자열 "true"/"false" → boolean 으로 정규화
//   2) status=발송완료 인데 guide_send_request truthy → boolean false 로
//   3) status=발송완료 이고 guide_sent_version 비어있음 → 현재 guide_version 으로 백필
//   4) 위 3종 변경 후 노션도 pushToNotion 으로 동기화
//
// 절대 변경하지 않는 것:
//   - guide_sent_status (운영 상태 보존)
//   - guide_sent_at (이력 보존)
//   - 노션 페이지 archive (PATCH만)
//
// 실행:
//   _repair_guideSendState(true)   // dry-run, 로그만
//   _repair_guideSendState(false)  // 실제 변경 (충분히 검토 후에만)
// ─────────────────────────────────────────────────────────────
function _repair_guideSendState(dryRun) {
  const isDryRun = (dryRun !== false);   // 기본 true
  Logger.log('=== _repair_guideSendState 시작 (dryRun=' + isDryRun + ') ===');

  const sheet = getSheet(SN.UNIFIED);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) { Logger.log('시트 비어있음'); return { ok:true, changed:0 }; }

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idCol      = headers.indexOf('id');
  const biznoCol   = headers.indexOf('bizno');
  const companyCol = headers.indexOf('company');
  const reqCol     = headers.indexOf('guide_send_request');
  const statusCol  = headers.indexOf('guide_sent_status');
  const verCol     = headers.indexOf('guide_version');
  const sentVerCol = headers.indexOf('guide_sent_version');

  if (sentVerCol < 0) {
    Logger.log('[ERROR] guide_sent_version 컬럼이 없음 — Task 6 후 initSheets() 실행 필요');
    return { ok:false, reason:'no_sent_version_col' };
  }

  const data = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  let touched = 0, notionToPush = [];

  for (let i = 0; i < data.length; i++) {
    const r = data[i];
    const rowNum = i + 2;
    const id = r[idCol], bizno = r[biznoCol], company = r[companyCol];
    const reqRaw = r[reqCol];
    const status = r[statusCol];
    const ver = Number(r[verCol]) || 0;
    const sentVer = Number(r[sentVerCol]) || 0;
    const isSent = (status === GUIDE_STATUS.SENT);
    const reqTruthy = (reqRaw === true || String(reqRaw).toLowerCase() === 'true');

    const ops = [];

    // (1) 문자열로 저장된 경우 boolean 으로 정규화
    if (typeof reqRaw === 'string' && reqRaw !== '') {
      const target = (reqRaw.toLowerCase() === 'true');
      // 단, (2) 조건과 합쳐서 처리하기 위해 일단 후보만 기록
      ops.push({ col:'guide_send_request', from:reqRaw, to:target, reason:'string→boolean' });
    }

    // (2) status=발송완료 인데 request truthy → false
    if (isSent && reqTruthy) {
      // 이미 (1)에서 target=true 였다면 false 로 덮어쓰기
      const existing = ops.find(function(o){ return o.col === 'guide_send_request'; });
      if (existing) {
        existing.to = false;
        existing.reason = 'sent_state_with_truthy_request';
      } else {
        ops.push({ col:'guide_send_request', from:reqRaw, to:false, reason:'sent_state_with_truthy_request' });
      }
    }

    // (3) 발송완료인데 sent_version 미백필
    if (isSent && sentVer === 0 && ver > 0) {
      ops.push({ col:'guide_sent_version', from:r[sentVerCol], to:ver, reason:'backfill_sent_version' });
    }

    if (ops.length === 0) continue;

    touched++;
    Logger.log('--- row ' + rowNum + ' id=' + id + ' bizno=' + bizno + ' company=' + company + ' ---');
    ops.forEach(function(o) {
      Logger.log('  ' + o.col + ': ' + JSON.stringify(o.from) + ' → ' + JSON.stringify(o.to) + '  (' + o.reason + ')');
    });

    if (!isDryRun) {
      ops.forEach(function(o) {
        const colIdx = headers.indexOf(o.col);
        if (colIdx < 0) return;
        sheet.getRange(rowNum, colIdx + 1).setValue(o.to);
      });
      notionToPush.push(bizno);
    }
  }

  Logger.log('변경 대상 행: ' + touched + (isDryRun ? ' (dry-run, 시트 변경 없음)' : ''));

  if (!isDryRun && notionToPush.length > 0) {
    Logger.log('--- 노션 push 시작 (' + notionToPush.length + '건) ---');
    notionToPush.forEach(function(bizno) {
      try {
        const fresh = _loadUnifiedByBizno(bizno);
        if (fresh) {
          const r = pushToNotion(fresh);
          Logger.log('  bizno=' + bizno + ' push → ' + JSON.stringify(r));
        }
      } catch (e) {
        Logger.log('  bizno=' + bizno + ' push 실패: ' + e);
      }
    });
  }

  Logger.log('=== _repair_guideSendState 완료 ===');
  return { ok:true, touched:touched, dryRun:isDryRun };
}
```

- [ ] **Step 2: dry-run 실행 → 로그 확인 → 노트에 복사**

Apps Script 에디터에서 함수 선택 후 ▶️. 단 파라미터는 못 넘기므로 `_repair_guideSendState()` 호출이 기본 dryRun=true.

```javascript
function _repair_guideSendState_dryRun() { _repair_guideSendState(true); }
```
같은 래퍼 함수 추가해서 실행 편의 확보.

- [ ] **Step 3: 사용자 검토 단계 — STOP**

dry-run 로그를 사용자가 직접 확인. `docs/dev-notes/2026-05-13_가이드중복발송_수정노트.md` 의 "정리 변경 계획" 섹션에 복사. **이 시점에서 사용자 승인 없이는 다음 단계 진행 금지.**

- [ ] **Step 4: 실제 변경 실행 (사용자 승인 후)**

`_repair_guideSendState(false)` 호출용 래퍼 함수도 추가:
```javascript
function _repair_guideSendState_apply() { _repair_guideSendState(false); }
```

사용자가 명시적으로 실행. 로그를 다시 노트에 복사 (이번엔 "실행 결과" 섹션).

- [ ] **Step 5: Commit (래퍼 포함)**

```bash
git add apps_script/GuideMail.gs
git commit -m "feat(guide): 가이드 발송 상태 정리 스크립트 (_repair_guideSendState, dry-run 기본)"
```

---

## 계층 5 — 회귀 방지

### Task 11: 회귀 방지 통합 테스트 모음

**Files:**
- Modify: `apps_script/GuideMail.gs` 하단

**배경:** 이번에 추가한 단위 테스트들을 한 번에 돌릴 수 있도록 묶고, 시나리오 통합 테스트 추가.

- [ ] **Step 1: 테스트 러너 함수**

```javascript
function _test_all_guideDuplicateFix() {
  Logger.log('### _test_all_guideDuplicateFix START ###');
  try { _test_loadUnifiedByBizno_boolean(); } catch(e) { Logger.log('ERR loadUnified: ' + e); }
  try { _test_toNotionValue_checkbox(); }    catch(e) { Logger.log('ERR toNotionValue: ' + e); }
  try { _test_bidirectionalHash_boolEquivalence(); } catch(e) { Logger.log('ERR hash: ' + e); }
  try { _test_sendGuideForRow_versionIdempotency(); } catch(e) { Logger.log('ERR versionIdem: ' + e); }
  Logger.log('### _test_all_guideDuplicateFix END ###');
}
```

- [ ] **Step 2: 전체 실행 → 모두 PASS / SKIP 확인**

- [ ] **Step 3: Commit**

```bash
git add apps_script/GuideMail.gs
git commit -m "test(guide): 중복 발송 수정 회귀 방지 테스트 모음 _test_all_guideDuplicateFix"
```

---

## 사후 단계 (배포·재가동·관찰)

### Task 12: 트리거 재활성화 및 관찰

**Files:** 없음 (운영 작업)

- [ ] **Step 1: Apps Script 에디터에서 코드 push 확인**

repo 의 `apps_script/Code.gs`, `apps_script/NotionSync.gs`, `apps_script/GuideMail.gs` 가 운영 Apps Script 프로젝트(smart@paxc)에 반영되었는지 확인. clasp 사용 중이면 `clasp push`, 수동 운영 중이면 에디터에 복사.

- [ ] **Step 2: `initSheets()` 1회 실행**

`guide_sent_version` 컬럼이 통합정보 시트에 추가되는지 확인.

- [ ] **Step 3: `pushToNotion` 1회 임의 행 호출하여 노션 스키마 갱신 (`가이드발송버전` 속성 자동 추가)**

```javascript
function _test_notionSchemaSync() {
  const sheet = getSheet(SN.UNIFIED);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const biznoCol = headers.indexOf('bizno');
  const firstBizno = sheet.getRange(2, biznoCol + 1).getValue();
  const row = _loadUnifiedByBizno(firstBizno);
  Logger.log(JSON.stringify(pushToNotion(row)));
}
```

- [ ] **Step 4: Task 10 dry-run → 검토 → apply 순서 실행**

(이미 Task 10 안에 포함된 단계지만, 트리거 비활성 상태에서 실행하는 것이 안전.)

- [ ] **Step 5: 트리거 재활성화**

Task 0 Step 3 에서 비활성화한 `pollAndSend`, `syncFromNotion` 트리거 다시 활성화.

- [ ] **Step 6: 1시간 관찰 — 로그 모니터링**

Apps Script 에디터의 Executions 화면에서 `pollAndSend`, `syncFromNotion` 의 로그 확인:
- "발송 완료 후 노션 체크박스 자동 OFF" 가 정상 동작하는지
- 비정상 자동 발송이 없는지

- [ ] **Step 7: 노트 마무리**

`docs/dev-notes/2026-05-13_가이드중복발송_수정노트.md` 에 작업 종료 시각, 실제 변경된 행 수, 관찰 결과 기록.

- [ ] **Step 8: Commit (노트만)**

```bash
git add docs/dev-notes/2026-05-13_가이드중복발송_수정노트.md
git commit -m "docs: 가이드 메일 중복발송 수정 작업 종료 노트"
```

---

## Self-Review Checklist

작업 전 다음 항목 모두 ✓ 확인:

- [ ] 모든 변경 함수는 `dryRun=true` 가 기본값인가? (Task 10 ✓)
- [ ] 모든 시트 mutation 전에 원본 값을 Logger.log 에 남기는가? (Task 10 의 ops 로깅 ✓)
- [ ] 컬럼 삭제·재정렬이 없는가? (Task 6 은 추가만 ✓)
- [ ] 노션 페이지 archive 호출이 없는가? (모든 노션 작업이 PATCH 또는 read ✓)
- [ ] 각 태스크가 독립적으로 커밋되어 git revert 가 단위별로 가능한가? ✓
- [ ] Task 0 의 백업·트리거 비활성화가 우선 실행되는가? ✓
- [ ] Task 12 의 트리거 재활성화 전에 모든 코드·데이터 정리가 완료되는가? ✓
- [ ] dry-run → 사용자 검토 → apply 게이트가 있는가? (Task 10 Step 3 ✓)

---

## 영향 범위 요약

| 변경 | 즉시 효과 | 데이터 영향 |
|---|---|---|
| Task 1-2 | 자동 중복 발송 차단 | 코드만, 데이터 무영향 |
| Task 4-5 | 향후 sync sync 일관성 | 코드만 |
| Task 6 | `guide_sent_version` 컬럼 추가 | **시트 컬럼 1개 추가** (기존 데이터 무영향) |
| Task 7-9 | 버전 멱등성 보장 | 코드만 |
| Task 10 dry-run | 영향 없음 | 영향 없음 |
| Task 10 apply | 일부 행 정리 | **시트 변경 + 노션 PATCH** (변경 행 로그 보존) |
| Task 11-12 | 회귀 방지 + 재가동 | 트리거 재활성화 |

---

## 롤백 절차

문제 발생 시:

1. **즉시 조치:** Apps Script 에디터에서 `pollAndSend`, `syncFromNotion` 트리거 비활성화.
2. **코드 롤백:** `git revert <commit-hash>` 로 해당 태스크 커밋 되돌리기 후 Apps Script 에 재배포.
3. **데이터 롤백:** Task 0 Step 1 에서 만든 백업 시트로부터 영향받은 행만 수동 복사. 노션은 페이지별 수정 이력에서 복원.
4. **분석:** 실패 원인을 노트에 기록 후 계획 재검토.
