// ════════════════════════════════════════════════════════════════════════════
// 세션 3 (G7~G8) 검증 테스트 함수
// ────────────────────────────────────────────────────────────────────────────
// 사용법:
//   1. 함수 드롭다운에서 _test_session3_all 선택
//   2. ▶️ 실행 → 실행 로그 확인
// ════════════════════════════════════════════════════════════════════════════

function _test_session3_all() {
  Logger.log('════════════════════════════════════════════════════════');
  Logger.log('세션 3 (G7~G8) 통합 테스트 시작');
  Logger.log('════════════════════════════════════════════════════════');
  Logger.log('');

  try { _test_g7_authGuard(); } catch (e) { Logger.log('❌ G7 인증 테스트 실패: ' + e); }
  Logger.log('');
  try { _test_g7_folderName(); } catch (e) { Logger.log('❌ G7 폴더명 테스트 실패: ' + e); }
  Logger.log('');
  try { _test_g8_quotePreservation(); } catch (e) { Logger.log('❌ G8 견적 보존 테스트 실패: ' + e); }
  Logger.log('');
  try { _test_g8_reconcileLock(); } catch (e) { Logger.log('❌ G8 reconcile lock 테스트 실패: ' + e); }

  Logger.log('');
  Logger.log('════════════════════════════════════════════════════════');
  Logger.log('통합 테스트 완료. 위 로그에 ✅ 가 7개 있어야 정상');
  Logger.log('════════════════════════════════════════════════════════');
}

// ────────────────────────────────────────────────────────────────────────────
// G7: getLatestQuotePdf 인증 (bizno+phone 누락/불일치 시 거부)
// ────────────────────────────────────────────────────────────────────────────
function _test_g7_authGuard() {
  Logger.log('── G7: getLatestQuotePdf 인증 가드 테스트 ──');

  // 1) bizno 누락 → 거부
  const r1 = getLatestQuotePdf({ company: '_test_g7', appId: 'NO-260514-XXXX' });
  if (r1.ok === false && r1.error && r1.error.indexOf('인증 정보 누락') >= 0) {
    Logger.log('✅ bizno 누락 거부: ' + r1.error);
  } else {
    Logger.log('❌ bizno 누락 거부 안 됨: ' + JSON.stringify(r1));
  }

  // 2) bizno + phone 있지만 시트에 매칭되는 신청 없음 → 거부
  const r2 = getLatestQuotePdf({
    company: '_test_g7_nonexistent',
    appId: 'NO-999999-XXXX',
    bizno: '999-99-99999',
    phone: '010-9999-9999'
  });
  if (r2.ok === false && r2.error && r2.error.indexOf('인증 실패') >= 0) {
    Logger.log('✅ 매칭 신청 없음 거부: ' + r2.error);
  } else {
    Logger.log('❌ 매칭 거부 안 됨: ' + JSON.stringify(r2));
  }
}

// ────────────────────────────────────────────────────────────────────────────
// G7: _resolveTargetFolder 가 bizno 포함 폴더명 생성
// ────────────────────────────────────────────────────────────────────────────
function _test_g7_folderName() {
  Logger.log('── G7: _resolveTargetFolder bizno 폴더명 테스트 ──');
  const TEST_COMPANY = '_test_g7_folder_' + Date.now().toString(36);
  const TEST_BIZNO = '999-99-G7T01';
  const expectedFolderName = TEST_COMPANY + '_' + TEST_BIZNO.replace(/[^0-9]/g, '');

  let createdFolderId = null;
  try {
    // bizno 있는 경우 — 새 패턴 폴더
    const folder = _resolveTargetFolder({ type: 'quote', company: TEST_COMPANY, bizno: TEST_BIZNO });
    const folderName = folder.getName();
    createdFolderId = folder.getId();
    if (folderName === expectedFolderName) {
      Logger.log('✅ 폴더명 정상: ' + folderName);
    } else {
      Logger.log('❌ 폴더명 불일치: 기대=' + expectedFolderName + ' 실제=' + folderName);
    }

    // bizno 없는 경우 — legacy 패턴 (회사명만)
    const legacyFolder = _resolveTargetFolder({ type: 'quote', company: TEST_COMPANY });
    if (legacyFolder.getName() === TEST_COMPANY) {
      Logger.log('✅ legacy 폴더명 (bizno 없을 때): ' + legacyFolder.getName());
    } else {
      Logger.log('❌ legacy 폴더명 비정상: ' + legacyFolder.getName());
    }

    // 테스트 폴더 정리 (두 개 모두 trash)
    try { folder.setTrashed(true); } catch (e) {}
    try { legacyFolder.setTrashed(true); } catch (e) {}
    Logger.log('   (테스트 폴더 2개 trash 완료)');
  } catch (e) {
    Logger.log('❌ G7 폴더명 테스트 예외: ' + e);
    if (createdFolderId) {
      try { DriveApp.getFolderById(createdFolderId).setTrashed(true); } catch (e2) {}
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// G8: upsertUnified 가 quote 없을 때 기존 견적 컬럼 보존
// ────────────────────────────────────────────────────────────────────────────
function _test_g8_quotePreservation() {
  Logger.log('── G8: upsertUnified 견적 보존 테스트 ──');
  const TEST_BIZNO = '999-99-G8T01';

  try {
    const app1 = {
      id: 'NO-260514-G8A1', bizno: TEST_BIZNO, company: '_test_g8_preserve',
      phone: '010-1111-1111', email: 'g8@test.com', date: '2026-05-14 12:00'
    };
    const quote = {
      id: 'QT-G8-001', appId: app1.id, total: 50000000, eqCount: 2,
      pdfUrl: 'https://example.com/g8.pdf', isLatest: '1', version: 1
    };

    // 1) 신청 + 견적 등록
    upsertUnified(app1, quote);
    const r1 = _loadUnifiedByBizno(TEST_BIZNO);
    const total1 = r1 && r1.total;
    if (total1 === 50000000) {
      Logger.log('✅ 1차 등록: total=' + total1);
    } else {
      Logger.log('❌ 1차 등록 실패: total=' + total1);
    }

    // 2) 같은 bizno 로 재신청 (quote 없이 app 만)
    const app2 = Object.assign({}, app1, { id: 'NO-260514-G8A2', date: '2026-05-14 13:00' });
    upsertUnified(app2);  // quote 인자 없음

    // 3) 기존 견적 컬럼이 보존되었는지 확인
    const r2 = _loadUnifiedByBizno(TEST_BIZNO);
    const total2 = r2 && r2.total;
    if (total2 === 50000000) {
      Logger.log('✅ 재신청 후 견적 컬럼 보존: total=' + total2);
    } else {
      Logger.log('❌ 견적 컬럼 wipe 됨 (G8 변경 미반영): total=' + total2);
    }
  } finally {
    // 정리
    const unified = getSheet(SN.UNIFIED);
    const data = unified.getDataRange().getValues();
    const biznoIdx = UNIFIED_COLS.indexOf('bizno');
    for (let i = data.length - 1; i >= 1; i--) {
      if (String(data[i][biznoIdx]) === TEST_BIZNO) unified.deleteRow(i + 1);
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// G8: _reconcileAfterDelete 의 lock 동작 (실제 race 재현 불가 — lock 함수 호출만 검증)
// ────────────────────────────────────────────────────────────────────────────
function _test_g8_reconcileLock() {
  Logger.log('── G8: _reconcileAfterDelete lock 동작 테스트 ──');

  // 빈 deletedIds 로 호출 — 즉시 return, 에러 없으면 OK
  try {
    _reconcileAfterDelete([]);
    Logger.log('✅ 빈 ids 호출 정상 통과');
  } catch (e) {
    Logger.log('❌ 빈 ids 호출 예외: ' + e);
  }

  // 존재하지 않는 ids 로 호출 — affectedBiznos 비어있으므로 안전. 단 lock 획득·release 는 발생
  try {
    _reconcileAfterDelete(['NO-999999-G8TX']);
    Logger.log('✅ 미존재 ids 호출 정상 통과 (lock acquire/release 성공)');
  } catch (e) {
    Logger.log('❌ 미존재 ids 호출 예외: ' + e);
  }
}
