// ════════════════════════════════════════════════════════════════════════════
// 세션 1 (G1~G4) 검증 테스트 함수
// ────────────────────────────────────────────────────────────────────────────
// 사용법:
//   1. Apps Script 에디터 좌측 파일 목록에 이 파일이 있는지 확인
//      (clasp 동기화 또는 수동 복사)
//   2. 상단 함수 드롭다운에서 _test_session1_all 선택
//   3. ▶️ 실행 버튼 클릭
//   4. 좌측 메뉴 "실행" → "실행 로그" 또는 Ctrl+Enter 로 로그 확인
//   5. 기대 출력과 실제 출력 비교
//
// 안전성:
//   - 모든 테스트가 시작 시점에 임시 데이터만 작성 후 끝에 자동 정리
//   - 운영 데이터(실 신청·견적 행) 절대 건드리지 않음
//   - 메일 발송 / 노션 push / Drive 업로드 일절 없음 (write 경로 일부만 시뮬레이션)
//
// 한 번에 모두 실행하려면 _test_session1_all 만 ▶️
// 개별 검증은 _test_g1_xxx, _test_g2_xxx, _test_g4_xxx 각각 ▶️
// ════════════════════════════════════════════════════════════════════════════

function _test_session1_all() {
  Logger.log('════════════════════════════════════════════════════════');
  Logger.log('세션 1 (G1~G4) 통합 테스트 시작');
  Logger.log('════════════════════════════════════════════════════════');
  Logger.log('');

  try {
    _test_g1_saveAppIdGuard();
  } catch (e) {
    Logger.log('❌ G1 테스트 실패: ' + e);
  }
  Logger.log('');

  try {
    _test_g2_safeSyncQueue();
  } catch (e) {
    Logger.log('❌ G2 테스트 실패: ' + e);
  }
  Logger.log('');

  try {
    _test_g4_saveQtOrphanGuard();
  } catch (e) {
    Logger.log('❌ G4 테스트 실패: ' + e);
  }

  Logger.log('');
  Logger.log('════════════════════════════════════════════════════════');
  Logger.log('통합 테스트 완료. 위 로그에 ✅ 가 5개 있어야 정상');
  Logger.log('════════════════════════════════════════════════════════');
}

// ────────────────────────────────────────────────────────────────────────────
// G1: 신청 ID 충돌 가드 + appendRow LockService
// ────────────────────────────────────────────────────────────────────────────
function _test_g1_saveAppIdGuard() {
  Logger.log('── G1: 신청 ID 충돌 가드 테스트 ──');
  const TEST_ID = 'NO-260514-TEST';
  const TEST_BIZNO_1 = '999-99-T0001';
  const TEST_BIZNO_2 = '999-99-T0002';

  try {
    // 1) 첫 발급
    const r1 = saveAppWithIdGuard({
      id: TEST_ID,
      bizno: TEST_BIZNO_1,
      company: '_test_세션1_A',
      date: '2026-05-14 10:00'
    });
    if (r1 && r1.ok && r1.id === TEST_ID && !r1.idCollided) {
      Logger.log('✅ 1차 발급 정상: id=' + r1.id + ' idCollided=false');
    } else {
      Logger.log('❌ 1차 발급 비정상: ' + JSON.stringify(r1));
    }

    // 2) 같은 ID 로 다시 시도 → 재발급되어야 함
    const r2 = saveAppWithIdGuard({
      id: TEST_ID,
      bizno: TEST_BIZNO_2,
      company: '_test_세션1_B',
      date: '2026-05-14 10:01'
    });
    if (r2 && r2.ok && r2.idCollided && r2.id !== TEST_ID) {
      Logger.log('✅ 2차 발급 (충돌 가드 동작): id=' + r2.id + ' idCollided=true');
    } else {
      Logger.log('❌ 2차 발급 비정상: ' + JSON.stringify(r2));
    }
  } finally {
    // 정리 — 테스트 행만 정확히 삭제
    _cleanupTestApps([TEST_BIZNO_1, TEST_BIZNO_2]);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// G2: _safeSync 큐 적재 + warnings 누적
// ────────────────────────────────────────────────────────────────────────────
function _test_g2_safeSyncQueue() {
  Logger.log('── G2: _safeSync 큐 적재 테스트 ──');
  const TEST_MARKER = '_test_g2_marker_' + Date.now();

  try {
    // 1) 의도적으로 throw 하는 fn → 큐 적재 + warnings 누적
    const result = { ok: true };
    _safeSync('_test_session1_g2', function() {
      throw new Error('의도적 실패 (' + TEST_MARKER + ')');
    }, {
      action: 'upsertUnified',
      payload: { _testMarker: TEST_MARKER, app: { id: '_test_' } }
    }, result);

    // 2) result.warnings 검사
    if (result.warnings && result.warnings.length === 1 && result.warnings[0].queued === true) {
      Logger.log('✅ warnings 누적 정상: ' + JSON.stringify(result.warnings[0]));
    } else {
      Logger.log('❌ warnings 비정상: ' + JSON.stringify(result.warnings));
    }

    // 3) 큐 시트에 적재됐는지 확인
    const queueSheet = getSheet(SN.QUEUE);
    const queueData = queueSheet.getDataRange().getValues();
    let found = false;
    for (let i = 1; i < queueData.length; i++) {
      if (String(queueData[i][2] || '').indexOf(TEST_MARKER) >= 0) {
        found = true;
        Logger.log('✅ 큐 시트 적재 확인: row=' + (i + 1) + ' action=' + queueData[i][1]);
        // 적재된 테스트 항목 정리
        queueSheet.deleteRow(i + 1);
        Logger.log('   (테스트 큐 항목 정리 완료)');
        break;
      }
    }
    if (!found) Logger.log('❌ 큐 시트에 적재 안 됨 (TEST_MARKER 미발견)');
  } catch (e) {
    Logger.log('❌ G2 테스트 자체 에러: ' + e);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// G4: saveQuoteWithVersion 의 _findApp 검증
// ────────────────────────────────────────────────────────────────────────────
function _test_g4_saveQtOrphanGuard() {
  Logger.log('── G4: saveQt orphan appId 검증 테스트 ──');

  // 1) 존재하지 않는 appId → 거부되어야 함
  const r1 = saveQuoteWithVersion({
    appId: 'NO-999999-XXXX',
    items: [],
    total: 0
  });
  if (r1 && r1.ok === false && r1.error && r1.error.indexOf('찾을 수 없습니다') >= 0) {
    Logger.log('✅ orphan appId 거부: ' + r1.error);
  } else {
    Logger.log('❌ orphan appId 거부 안 됨: ' + JSON.stringify(r1));
  }

  // 2) 빈 appId → 거부되어야 함
  const r2 = saveQuoteWithVersion({
    appId: '',
    items: [],
    total: 0
  });
  if (r2 && r2.ok === false && r2.error && r2.error.indexOf('누락') >= 0) {
    Logger.log('✅ 빈 appId 거부: ' + r2.error);
  } else {
    Logger.log('❌ 빈 appId 거부 안 됨: ' + JSON.stringify(r2));
  }

  // 3) appId 없음 → 거부되어야 함
  const r3 = saveQuoteWithVersion({});
  if (r3 && r3.ok === false) {
    Logger.log('✅ appId 미지정 거부: ' + r3.error);
  } else {
    Logger.log('❌ appId 미지정 거부 안 됨: ' + JSON.stringify(r3));
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 정리 헬퍼 — 테스트가 만든 행만 안전하게 삭제
// ────────────────────────────────────────────────────────────────────────────
function _cleanupTestApps(biznos) {
  if (!biznos || !biznos.length) return;
  const sheet = getSheet(SN.APP);
  const data = sheet.getDataRange().getValues();
  const biznoIdx = APP_COLS.indexOf('bizno');
  const biznoSet = new Set(biznos.map(String));
  let removed = 0;
  for (let i = data.length - 1; i >= 1; i--) {
    if (biznoSet.has(String(data[i][biznoIdx]))) {
      sheet.deleteRow(i + 1);
      removed++;
    }
  }
  if (removed > 0) Logger.log('   (테스트 신청 ' + removed + '건 정리 완료)');
}
