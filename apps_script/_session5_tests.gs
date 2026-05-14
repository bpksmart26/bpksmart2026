// ════════════════════════════════════════════════════════════════════════════
// 세션 5 (G11~G14 + 정리) 검증 테스트 함수
// ────────────────────────────────────────────────────────────────────────────
// 사용법: 함수 드롭다운에서 _test_session5_all → ▶️
// ════════════════════════════════════════════════════════════════════════════

function _test_session5_all() {
  Logger.log('════════════════════════════════════════════════════════');
  Logger.log('세션 5 (G11~G14 + 정리) 통합 테스트 시작');
  Logger.log('════════════════════════════════════════════════════════');
  Logger.log('');

  try { _test_g11_upsertEqIdGuard(); } catch (e) { Logger.log('❌ G11 실패: ' + e); }
  Logger.log('');
  try { _test_g12_normalizeBizno(); } catch (e) { Logger.log('❌ G12 실패: ' + e); }
  Logger.log('');
  try { _test_cleanup_sanitizeName(); } catch (e) { Logger.log('❌ cleanup sanitizeName 실패: ' + e); }

  Logger.log('');
  Logger.log('════════════════════════════════════════════════════════');
  Logger.log('통합 테스트 완료. 위 로그에 ✅ 가 6개 있어야 정상');
  Logger.log('');
  Logger.log('※ G13 (migrate lock) 와 G14 (goStep5 가드)');
  Logger.log('   는 실제 race 재현이 어려워 정적 검증 + 브라우저 검증으로 대체');
  Logger.log('════════════════════════════════════════════════════════');
}

// ────────────────────────────────────────────────────────────────────────────
// G11: 장비 ID 충돌 가드
// ────────────────────────────────────────────────────────────────────────────
function _test_g11_upsertEqIdGuard() {
  Logger.log('── G11: 장비 ID 충돌 가드 테스트 ──');
  const TEST_NAME_A = '_test_session5_eq_A';
  const TEST_NAME_B = '_test_session5_eq_B';

  try {
    // 1) 신규 장비 발급 — 클라이언트 id 99999 (충돌 거의 없음)
    const r1 = upsertEqWithIdGuard({
      _isNew: true,
      id: 99999,
      name: TEST_NAME_A,
      model: 'TEST_A',
      price: 1000,
      photos: [], photos_pkg: []
    });
    Logger.log('1차 (신규 99999): ' + JSON.stringify({ id: r1.id, action: r1.action, idCollided: r1.idCollided }));

    // 2) 같은 id 99999 로 다시 _isNew=true → 재발급되어야
    const r2 = upsertEqWithIdGuard({
      _isNew: true,
      id: 99999,
      name: TEST_NAME_B,
      model: 'TEST_B',
      price: 2000,
      photos: [], photos_pkg: []
    });
    Logger.log('2차 (같은 id _isNew): ' + JSON.stringify({ id: r2.id, action: r2.action, idCollided: r2.idCollided }));

    if (r1.id === 99999 && r2.idCollided && r2.id !== r1.id) {
      Logger.log('✅ ID 충돌 가드 정상 동작 (' + r1.id + ' → ' + r2.id + ')');
    } else {
      Logger.log('❌ 가드 비정상: r1=' + JSON.stringify(r1) + ' r2=' + JSON.stringify(r2));
    }

    // 3) _isNew=false 로 r2.id 업데이트 — 그대로 update
    const r3 = upsertEqWithIdGuard({
      _isNew: false,
      id: r2.id,
      name: TEST_NAME_B + '_수정',
      model: 'TEST_B',
      price: 2500,
      photos: [], photos_pkg: []
    });
    if (r3.id === r2.id && r3.action === 'updated') {
      Logger.log('✅ 수정 모드 정상 동작 (id=' + r3.id + ')');
    } else {
      Logger.log('❌ 수정 모드 비정상: ' + JSON.stringify(r3));
    }
  } finally {
    // 정리
    const sheet = getSheet(SN.EQ);
    const data = sheet.getDataRange().getValues();
    const nameIdx = EQ_COLS.indexOf('name');
    for (let i = data.length - 1; i >= 1; i--) {
      const n = String(data[i][nameIdx] || '');
      if (n.indexOf('_test_session5') === 0) sheet.deleteRow(i + 1);
    }
    Logger.log('   (테스트 장비 정리 완료)');
  }
}

// ────────────────────────────────────────────────────────────────────────────
// G12: bizno 정규화
// ────────────────────────────────────────────────────────────────────────────
function _test_g12_normalizeBizno() {
  Logger.log('── G12: bizno 정규화 테스트 ──');
  const cases = [
    ['275-88-01197', '275-88-01197', '표준 형식'],
    ['2758801197', '275-88-01197', '하이픈 없음'],
    ['275 88 01197', '275-88-01197', '공백 포함'],
    ['275 - 88 - 01197', '275-88-01197', '하이픈 + 공백'],
    ['275.88.01197', '275-88-01197', '점 단위'],
    ['', '', '빈 문자열'],
    [null, '', 'null'],
    ['12345', '12345', '10자리 아님 — 숫자만 추출'],
  ];

  let pass = 0, fail = 0;
  cases.forEach(c => {
    const [input, expected, label] = c;
    const got = _normalizeBizno(input);
    if (got === expected) pass++;
    else { fail++; Logger.log('  ❌ ' + label + ': input=' + JSON.stringify(input) + ' 기대=' + JSON.stringify(expected) + ' 실제=' + JSON.stringify(got)); }
  });
  if (fail === 0) Logger.log('✅ ' + pass + '/' + cases.length + ' 케이스 통과 (다양한 입력이 모두 NNN-NN-NNNNN 으로 정규화)');
  else Logger.log('❌ ' + fail + '/' + cases.length + ' 실패');
}

// ────────────────────────────────────────────────────────────────────────────
// 정리: sanitizeName trailing dot
// ────────────────────────────────────────────────────────────────────────────
function _test_cleanup_sanitizeName() {
  Logger.log('── cleanup: sanitizeName trailing dot 테스트 ──');
  const cases = [
    ['(주)대한식품', '(주)대한식품', '정상'],
    ['(주)대한식품.', '(주)대한식품', 'trailing dot 제거'],
    ['(주)대한식품...', '(주)대한식품', 'trailing dots 모두 제거'],
    ['(주)대한.식품', '(주)대한.식품', '중간 dot 보존'],
    ['', '기타', '빈 문자열 → 기타'],
    ['파일/명', '파일_명', '슬래시 → 언더스코어'],
  ];

  let pass = 0, fail = 0;
  cases.forEach(c => {
    const [input, expected, label] = c;
    const got = sanitizeName(input);
    if (got === expected) pass++;
    else { fail++; Logger.log('  ❌ ' + label + ': input=' + JSON.stringify(input) + ' 기대=' + JSON.stringify(expected) + ' 실제=' + JSON.stringify(got)); }
  });
  if (fail === 0) Logger.log('✅ ' + pass + '/' + cases.length + ' 케이스 통과');
  else Logger.log('❌ ' + fail + '/' + cases.length + ' 실패');
}
