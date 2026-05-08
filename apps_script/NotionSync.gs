// ============================================================
// BPK Smart 2026 — Notion 동기화 + 통합정보 시트 관리
// 같은 프로젝트의 Code.gs와 글로벌 네임스페이스 공유
// ============================================================

// quote 객체 키 → 통합정보 row 키 매핑 (한 곳에서 관리, fromNotion 등 다른 곳에서도 재사용)
const QUOTE_FIELD_MAP = {
  id:'quoteId', process:'quoteProcess', memo:'quoteMemo', status:'quoteStatus', date:'quoteDate',
  validUntil:'validUntil', items:'items', options:'options', total:'total', eqCount:'eqCount',
  pdfUrl:'pdfUrl', equipPdfUrl:'equipPdfUrl', pdfHash:'pdfHash', equipPdfHash:'equipPdfHash',
  version:'version', isLatest:'isLatest'
};

// ─────────────────────────────────────────────────────────────
// upsertUnified: 신청 + (선택)견적 → 통합정보 시트 upsert
// 매칭 키: 사업자번호 (bizno) — 같은 사업자 재신청 시 row 교체
// ─────────────────────────────────────────────────────────────
function upsertUnified(app, quote) {
  const sheet = getSheet(SN.UNIFIED);
  ensureHeader(sheet, UNIFIED_COLS);

  const bizno = String((app && app.bizno) || '').trim();
  if (!bizno) {
    Logger.log('upsertUnified: bizno 없음, skip — id=' + (app && app.id));
    return { ok:false, reason:'no_bizno' };
  }

  // 기존 행 검색 (bizno 매칭, -1 = 없음)
  const data = sheet.getDataRange().getValues();
  const biznoIdx = UNIFIED_COLS.indexOf('bizno');
  let existingRow = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][biznoIdx]) === bizno) { existingRow = i + 1; break; }
  }

  // merged row 구성
  const merged = {};
  // 신청 컬럼 복사 (UNIFIED_COLS에 있는 키만)
  Object.keys(app || {}).forEach(k => {
    if (UNIFIED_COLS.includes(k)) merged[k] = app[k];
  });

  if (quote) {
    // 견적 → quote* prefix 매핑
    Object.entries(QUOTE_FIELD_MAP).forEach(([qk, mk]) => {
      if (quote[qk] !== undefined) merged[mk] = quote[qk];
    });
  } else {
    // 견적 없음 (신규/재신청 동일) — 견적 컬럼 모두 빈 값으로 초기화
    Object.values(QUOTE_FIELD_MAP).forEach(k => { merged[k] = ''; });
  }

  const values = serializeRow(UNIFIED_COLS, UNIFIED_ARR, merged);
  const targetRow = existingRow > 0 ? existingRow : sheet.getLastRow() + 1;
  sheet.getRange(targetRow, 1, 1, values.length).setValues([values]);

  // 날짜 컬럼 plain text 포맷 강제 (Sheets datetime 자동 변환 방지)
  _enforceTextDate(sheet, targetRow, UNIFIED_COLS, merged);                  // 'date'
  _enforceTextDate(sheet, targetRow, UNIFIED_COLS, merged, 'quoteDate');     // 'quoteDate'

  return {
    ok: true,
    action: existingRow > 0 ? 'updated' : 'inserted',
    row: targetRow,
    bizno: bizno
  };
}

// ─────────────────────────────────────────────────────────────
// 테스트: Apps Script 에디터에서 직접 실행
// ─────────────────────────────────────────────────────────────
function _test_upsertUnified() {
  // 1) 신규 신청 1건
  const app1 = {
    id:'TEST-A1', company:'테스트회사A', ceo:'홍길동', bizno:'999-99-99991',
    phone:'010-1234-5678', email:'a@test.com', address:'서울시 강남구',
    pname:'테스트제품', qty:'1000', status:'접수', date:'2026-05-08',
    processes:['인쇄','후가공'], pkgtypes:['파우치']
  };
  Logger.log('--- 신규 ---');
  Logger.log(JSON.stringify(upsertUnified(app1)));

  // 2) 같은 사업자 재신청 (bizno 같음, id/내용 다름)
  const app2 = Object.assign({}, app1, { id:'TEST-A2', pname:'재신청제품', qty:'2000' });
  Logger.log('--- 재신청 (같은 bizno) ---');
  Logger.log(JSON.stringify(upsertUnified(app2)));

  // 3) 견적 들어옴
  const quote = {
    id:'TEST-Q1', appId:'TEST-A2', company:'테스트회사A',
    process:'견적공정', memo:'견적메모', validUntil:'2026-06-08',
    items:[{eqId:'eq1',name:'자동포장기',qty:1,price:15000000}],
    options:[{name:'설치비',amount:500000}],
    total:15500000, eqCount:1, status:'발급완료', date:'2026-05-08',
    pdfUrl:'https://example.com/q.pdf', version:1, isLatest:'1'
  };
  Logger.log('--- 견적 매칭 ---');
  Logger.log(JSON.stringify(upsertUnified(app2, quote)));

  // 4) 통합정보 시트 직접 확인
  const sheet = getSheet(SN.UNIFIED);
  const last = sheet.getLastRow();
  Logger.log('통합정보 마지막 행: ' + last);
  Logger.log('마지막 행 데이터: ' + JSON.stringify(sheet.getRange(last,1,1,UNIFIED_COLS.length).getValues()[0]));
}

// 테스트 데이터 정리
function _cleanup_test_unified() {
  const sheet = getSheet(SN.UNIFIED);
  const data = sheet.getDataRange().getValues();
  const biznoIdx = UNIFIED_COLS.indexOf('bizno');
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][biznoIdx]) === '999-99-99991') sheet.deleteRow(i + 1);
  }
  Logger.log('테스트 데이터 정리 완료');
}
