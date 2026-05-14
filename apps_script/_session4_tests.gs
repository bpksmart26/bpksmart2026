// ════════════════════════════════════════════════════════════════════════════
// 세션 4 (G9~G10) 검증 테스트 함수
// ────────────────────────────────────────────────────────────────────────────
// 사용법: 함수 드롭다운에서 _test_session4_all → ▶️
// ════════════════════════════════════════════════════════════════════════════

function _test_session4_all() {
  Logger.log('════════════════════════════════════════════════════════');
  Logger.log('세션 4 (G9~G10) 통합 테스트 시작');
  Logger.log('════════════════════════════════════════════════════════');
  Logger.log('');

  try { _test_g9_parseMoney(); } catch (e) { Logger.log('❌ G9 _parseMoney 실패: ' + e); }
  Logger.log('');
  try { _test_g9_formulaInjection(); } catch (e) { Logger.log('❌ G9 수식 인젝션 실패: ' + e); }

  Logger.log('');
  Logger.log('════════════════════════════════════════════════════════');
  Logger.log('통합 테스트 완료. 위 로그에 ✅ 가 7개 있어야 정상');
  Logger.log('');
  Logger.log('※ G9-c (quoteHash options) 와 G10 (saveQDraft editQtId)');
  Logger.log('   는 브라우저 콘솔에서 검증 — SESSION_4_VERIFICATION.md 참조');
  Logger.log('════════════════════════════════════════════════════════');
}

// ────────────────────────────────────────────────────────────────────────────
// G9-a: _parseMoney 동작 검증
// ────────────────────────────────────────────────────────────────────────────
function _test_g9_parseMoney() {
  Logger.log('── G9-a: _parseMoney 테스트 ──');
  const cases = [
    [15000000, 15000000, '정상 number'],
    ['15000000', 15000000, '정상 string'],
    ['15,000,000', 15000000, '콤마 포함 ⭐ 핵심 fix'],
    ['', 0, '빈 문자열'],
    [null, 0, 'null'],
    [undefined, 0, 'undefined'],
    ['abc', 0, '비숫자'],
    ['  1000  ', 1000, 'whitespace trim'],
    [0, 0, '0 number'],
    ['0', 0, '0 string'],
  ];

  let pass = 0, fail = 0;
  cases.forEach(c => {
    const [input, expected, label] = c;
    const got = _parseMoney(input);
    if (got === expected) {
      pass++;
    } else {
      fail++;
      Logger.log('  ❌ ' + label + ': input=' + JSON.stringify(input) + ' 기대=' + expected + ' 실제=' + got);
    }
  });
  if (fail === 0) Logger.log('✅ ' + pass + '/' + cases.length + ' 케이스 모두 통과');
  else Logger.log('❌ ' + fail + '/' + cases.length + ' 케이스 실패');
}

// ────────────────────────────────────────────────────────────────────────────
// G9-b: serializeRow 수식 인젝션 방지
// ────────────────────────────────────────────────────────────────────────────
function _test_g9_formulaInjection() {
  Logger.log('── G9-b: serializeRow 수식 인젝션 방지 테스트 ──');

  // 가상 col/obj — APP_COLS 일부만 사용
  const cols = ['id', 'company', 'memo'];

  // 1) 정상 텍스트 → 그대로
  const r1 = serializeRow(cols, [], { id: 'NO-X', company: '(주)테스트', memo: '메모 내용' });
  if (r1[2] === '메모 내용') Logger.log('✅ 정상 텍스트 보존: "' + r1[2] + '"');
  else Logger.log('❌ 정상 텍스트 변형: ' + JSON.stringify(r1[2]));

  // 2) '=' 시작 → ' prefix
  const r2 = serializeRow(cols, [], { id: 'NO-X', company: '(주)테스트', memo: '=SUM(A1:A10)' });
  if (r2[2] === "'=SUM(A1:A10)") Logger.log('✅ \'=\' 차단: "' + r2[2] + '"');
  else Logger.log('❌ \'=\' 차단 안 됨: ' + JSON.stringify(r2[2]));

  // 3) '+' 시작 → ' prefix
  const r3 = serializeRow(cols, [], { id: 'NO-X', company: '(주)테스트', memo: '+CMD' });
  if (r3[2] === "'+CMD") Logger.log('✅ \'+\' 차단: "' + r3[2] + '"');
  else Logger.log('❌ \'+\' 차단 안 됨: ' + JSON.stringify(r3[2]));

  // 4) '@' 시작 → ' prefix
  const r4 = serializeRow(cols, [], { id: 'NO-X', company: '(주)테스트', memo: '@import' });
  if (r4[2] === "'@import") Logger.log('✅ \'@\' 차단: "' + r4[2] + '"');
  else Logger.log('❌ \'@\' 차단 안 됨: ' + JSON.stringify(r4[2]));

  // 5) '-' 시작 (음수) → 그대로 보존 (의도된 동작)
  const r5 = serializeRow(cols, [], { id: 'NO-X', company: '(주)테스트', memo: '-100' });
  if (r5[2] === '-100') Logger.log('✅ \'-\' 음수 보존: "' + r5[2] + '"');
  else Logger.log('❌ \'-\' 음수 변형: ' + JSON.stringify(r5[2]));
}
