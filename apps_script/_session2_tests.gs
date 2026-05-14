// ════════════════════════════════════════════════════════════════════════════
// 세션 2 (G5~G6) 검증 테스트 함수
// ────────────────────────────────────────────────────────────────────────────
// 사용법:
//   1. 함수 드롭다운에서 _test_session2_all 선택
//   2. ▶️ 실행 → 실행 로그 확인
//
// 안전성:
//   - 임시 데이터만 작성 후 자동 정리
//   - 운영 데이터 절대 안 건드림
//   - 메일/노션 작업 없음
// ════════════════════════════════════════════════════════════════════════════

function _test_session2_all() {
  Logger.log('════════════════════════════════════════════════════════');
  Logger.log('세션 2 (G5~G6) 통합 테스트 시작');
  Logger.log('════════════════════════════════════════════════════════');
  Logger.log('');

  try { _test_g6_idemSaveApp(); } catch (e) { Logger.log('❌ G6 saveApp 테스트 실패: ' + e); }
  Logger.log('');
  try { _test_g6_idemSaveQt(); } catch (e) { Logger.log('❌ G6 saveQt 테스트 실패: ' + e); }
  Logger.log('');
  try { _test_g6_idemUploadPhoto(); } catch (e) { Logger.log('❌ G6 uploadPhoto 테스트 실패: ' + e); }

  Logger.log('');
  Logger.log('════════════════════════════════════════════════════════');
  Logger.log('통합 테스트 완료. 위 로그에 ✅ 가 6개 있어야 정상');
  Logger.log('════════════════════════════════════════════════════════');
  Logger.log('');
  Logger.log('※ G5 (견적 item eqId 저장) 는 브라우저에서 검증:');
  Logger.log('   1. 공급기업_관리.html 열기 → 견적 발급 → 사양서 PDF 생성');
  Logger.log('   2. localStorage.bpk_qt_v1 안 quotes[].items 에 eqId 필드가 있어야 정상');
}

// ────────────────────────────────────────────────────────────────────────────
// G6: saveApp 멱등성 (같은 _idemKey 두 번 호출 → 한 행만 생성)
// ────────────────────────────────────────────────────────────────────────────
function _test_g6_idemSaveApp() {
  Logger.log('── G6: saveApp idempotency 테스트 ──');
  const TEST_BIZNO = '999-99-G6T01';
  const TEST_IDEM_KEY = 'idem_test_g6_app_' + Date.now();

  try {
    const data = {
      id: 'NO-260514-IDEM',
      bizno: TEST_BIZNO,
      company: '_test_세션2_idem',
      date: '2026-05-14 11:00',
      _idemKey: TEST_IDEM_KEY
    };

    // 1차 호출 — 새 행 생성
    const r1 = saveAppWithIdGuard(data);
    const id1 = r1 && r1.id;
    Logger.log('1차: id=' + id1 + ' ok=' + (r1 && r1.ok));

    // 2차 호출 (같은 _idemKey, 같은 data) — cache hit, 같은 결과
    const r2 = saveAppWithIdGuard(data);
    const id2 = r2 && r2.id;
    Logger.log('2차: id=' + id2 + ' ok=' + (r2 && r2.ok));

    if (id1 === id2 && r1.ok && r2.ok) {
      Logger.log('✅ 같은 결과 반환 (id ' + id1 + ' === ' + id2 + ')');
    } else {
      Logger.log('❌ 결과 불일치 — r1=' + JSON.stringify(r1) + ' r2=' + JSON.stringify(r2));
    }

    // 시트에 행이 1개만 들어갔는지 확인
    const sheet = getSheet(SN.APP);
    const all = sheet.getDataRange().getValues();
    const biznoIdx = APP_COLS.indexOf('bizno');
    let count = 0;
    for (let i = 1; i < all.length; i++) {
      if (String(all[i][biznoIdx]) === TEST_BIZNO) count++;
    }
    if (count === 1) {
      Logger.log('✅ 시트 행 수 = 1 (멱등 동작 정상)');
    } else {
      Logger.log('❌ 시트 행 수 = ' + count + ' (1이어야 정상)');
    }
  } finally {
    _cleanupTestApps([TEST_BIZNO]);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// G6: saveQuoteWithVersion 멱등성
// ────────────────────────────────────────────────────────────────────────────
function _test_g6_idemSaveQt() {
  Logger.log('── G6: saveQt idempotency 테스트 ──');
  const TEST_BIZNO = '999-99-G6T02';
  const TEST_IDEM_KEY = 'idem_test_g6_qt_' + Date.now();
  let testAppId = null;

  try {
    // 1) 테스트 신청 1건 (saveQt 검증 통과 위해 appId 가 시트에 있어야)
    const appResult = saveAppWithIdGuard({
      id: 'NO-260514-QT01',
      bizno: TEST_BIZNO,
      company: '_test_세션2_qt',
      date: '2026-05-14 11:00'
    });
    testAppId = appResult.id;

    // 2) 견적 1차 발급
    const qt = {
      id: 'QT-2026-998',
      appId: testAppId,
      company: '_test_세션2_qt',
      items: [{name:'테스트장비', qty:1, price:1000}],
      options: [],
      total: 1000,
      eqCount: 1,
      status: '확정',
      date: '2026-05-14 11:01',
      _idemKey: TEST_IDEM_KEY
    };
    const r1 = saveQuoteWithVersion(qt);
    Logger.log('1차: id=' + r1.id + ' v=' + r1.version);

    // 3) 견적 2차 발급 (같은 _idemKey) — cache hit
    const r2 = saveQuoteWithVersion(qt);
    Logger.log('2차: id=' + r2.id + ' v=' + r2.version);

    if (r1.id === r2.id && r1.version === r2.version) {
      Logger.log('✅ 같은 결과 반환 (id=' + r1.id + ' v=' + r1.version + ')');
    } else {
      Logger.log('❌ 결과 불일치');
    }

    // 4) 견적 시트에 행 1개만 있는지
    const qtSheet = getSheet(SN.QT);
    const qtAll = qtSheet.getDataRange().getValues();
    const qtAppIdx = QT_COLS.indexOf('appId');
    let qtCount = 0;
    for (let i = 1; i < qtAll.length; i++) {
      if (String(qtAll[i][qtAppIdx]) === String(testAppId)) qtCount++;
    }
    if (qtCount === 1) {
      Logger.log('✅ 견적 시트 행 수 = 1 (멱등 동작 정상)');
    } else {
      Logger.log('❌ 견적 시트 행 수 = ' + qtCount + ' (1이어야 정상)');
    }
  } finally {
    // 정리 — 견적 + 신청 모두
    if (testAppId) {
      const qtSheet = getSheet(SN.QT);
      const qtAll = qtSheet.getDataRange().getValues();
      const qtAppIdx = QT_COLS.indexOf('appId');
      for (let i = qtAll.length - 1; i >= 1; i--) {
        if (String(qtAll[i][qtAppIdx]) === String(testAppId)) qtSheet.deleteRow(i + 1);
      }
    }
    _cleanupTestApps([TEST_BIZNO]);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// G6: uploadPhoto 멱등성
// ────────────────────────────────────────────────────────────────────────────
function _test_g6_idemUploadPhoto() {
  Logger.log('── G6: uploadPhoto idempotency 테스트 ──');

  // 1x1 픽셀 PNG base64 (가장 작은 이미지)
  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=';
  const TEST_IDEM_KEY = 'idem_test_g6_photo_' + Date.now();

  const data = {
    base64: tinyPng,
    name: '_test_g6_idem_photo.png',
    type: 'other',
    company: '_test_session2',
    _idemKey: TEST_IDEM_KEY
  };

  let url1 = null, url2 = null;
  try {
    // 1차 업로드
    const r1 = uploadPhoto(data);
    url1 = r1 && r1.url;
    Logger.log('1차: url=' + url1);

    // 2차 업로드 (같은 _idemKey) — cache hit, 같은 URL
    const r2 = uploadPhoto(data);
    url2 = r2 && r2.url;
    Logger.log('2차: url=' + url2);

    if (url1 && url1 === url2) {
      Logger.log('✅ 같은 URL 반환 (Drive 중복 파일 안 생김)');
    } else {
      Logger.log('❌ URL 불일치');
    }
  } finally {
    // 정리 — 업로드된 Drive 파일 trash
    if (url1) {
      try {
        const m = url1.match(/[?&]id=([^&]+)/);
        if (m) {
          DriveApp.getFileById(m[1]).setTrashed(true);
          Logger.log('   (테스트 Drive 파일 trash 완료)');
        }
      } catch (e) { Logger.log('   (Drive 파일 정리 실패: ' + e + ')'); }
    }
  }
}
