// ============================================================
// BPK Smart 2026 — Notion 동기화 + 통합정보 시트 관리
// 같은 프로젝트의 Code.gs와 글로벌 네임스페이스 공유
// ============================================================

// ─────────────────────────────────────────────────────────────
// 노션 매핑 — 시트 영문 컬럼 ↔ 노션 한글 속성명
// 단일 출처: 시트 컬럼명·노션 속성명·타입·양방향 여부 모두 여기에서 결정
// 양방향 4개 필드(status/manager/memo/quoteMemo)만 노션→시트 sync 대상
// ─────────────────────────────────────────────────────────────
const NOTION_PROP_MAP = {
  // 신청
  id:             { name: '신청ID',         type: 'rich_text' },
  company:        { name: '회사명',         type: 'title' },
  ceo:            { name: '대표자',         type: 'rich_text' },
  bizno:          { name: '사업자번호',     type: 'rich_text' },
  phone:          { name: '연락처',         type: 'phone_number' },
  email:          { name: '이메일',         type: 'email' },
  address:        { name: '주소',           type: 'rich_text' },
  pname:          { name: '제품명',         type: 'rich_text' },
  texture:        { name: '제품특성',       type: 'rich_text' },
  processes:      { name: '공정',           type: 'multi_select' },
  pkgtypes:       { name: '포장형태',       type: 'multi_select' },
  qty:            { name: '수량',           type: 'rich_text' },
  speed:          { name: '속도',           type: 'rich_text' },
  problem_type:   { name: '문제유형',       type: 'select' },
  problem_points: { name: '문제점',         type: 'multi_select' },
  equipment:      { name: '추천장비',       type: 'multi_select' },
  electric:       { name: '전기',           type: 'multi_select' },
  air_yn:         { name: '에어유무',       type: 'select' },
  air_flow:       { name: '에어유량',       type: 'rich_text' },
  space_w:        { name: '설치공간_가로',  type: 'rich_text' },
  space_h:        { name: '설치공간_세로',  type: 'rich_text' },
  space_photos:   { name: '설치공간사진',   type: 'files' },
  product_photos: { name: '제품사진',       type: 'files' },
  date:           { name: '신청일',         type: 'date' },
  status:         { name: '신청상태',       type: 'select',     bidirectional: true },
  manager:        { name: '담당자',         type: 'rich_text',  bidirectional: true },
  memo:           { name: '신청메모',       type: 'rich_text',  bidirectional: true },
  // 견적
  quoteId:        { name: '견적ID',         type: 'rich_text' },
  quoteProcess:   { name: '견적공정',       type: 'rich_text' },
  quoteMemo:      { name: '견적메모',       type: 'rich_text',  bidirectional: true },
  validUntil:     { name: '견적유효기간',   type: 'date' },
  __summary:      { name: '견적요약',       type: 'rich_text' },  // items+options 변환 (formatItemsForNotion)
  total:          { name: '견적총액',       type: 'number' },
  eqCount:        { name: '장비수',         type: 'number' },
  quoteStatus:    { name: '견적상태',       type: 'select' },
  quoteDate:      { name: '견적생성일',     type: 'date' },
  pdfUrl:         { name: '견적PDF',        type: 'url' },
  equipPdfUrl:    { name: '장비사양PDF',    type: 'url' },
  version:        { name: '견적버전',       type: 'number' }
};

// 양방향 필드 — 시트와 노션 둘 다 source 가능
const BIDIRECTIONAL_FIELDS = ['status','manager','memo','quoteMemo'];

// 시트 컬럼 (영문) → 노션 속성명 (한글) 매핑
const SHEET_TO_NOTION_NAME = {};
Object.keys(NOTION_PROP_MAP).forEach(k => { SHEET_TO_NOTION_NAME[k] = NOTION_PROP_MAP[k].name; });

// 노션 속성명 (한글) → 시트 컬럼 (영문) 역매핑
const NOTION_NAME_TO_SHEET = {};
Object.keys(NOTION_PROP_MAP).forEach(k => { NOTION_NAME_TO_SHEET[NOTION_PROP_MAP[k].name] = k; });

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

// ─────────────────────────────────────────────────────────────
// 시트 조회 헬퍼 — doPost 라우터의 sync hook에서 사용
// ─────────────────────────────────────────────────────────────

// try-catch + Logger.log 묶음 — sync hook 표준 패턴
// Task 11에서 pushToNotion 호출도 이 헬퍼로 추가됨
function _safeSync(label, fn) {
  try { fn(); } catch (e) { Logger.log(label + ' 실패: ' + e); }
}

// 신청 시트에서 id로 신청 객체 1건 찾기
function _findApp(appId) {
  if (!appId) return null;
  const apps = getRows(SN.APP, APP_COLS, APP_ARR);
  return apps.find(a => String(a.id) === String(appId)) || null;
}

// ─────────────────────────────────────────────────────────────
// 신청 삭제 후 통합정보 reconcile
// 잔여 신청 있으면 가장 최근으로 통합정보 갱신, 없으면 통합정보 row 삭제
// (노션 archive 호출은 Task 15에서 추가)
// ─────────────────────────────────────────────────────────────
function _reconcileAfterDelete(deletedIds) {
  if (!deletedIds || !deletedIds.length) return;

  const apps = getRows(SN.APP, APP_COLS, APP_ARR);
  const quotes = getRows(SN.QT, QT_COLS, QT_ARR, {total:'number',eqCount:'number'});
  const unified = getSheet(SN.UNIFIED);
  const data = unified.getDataRange().getValues();
  const idIdx = UNIFIED_COLS.indexOf('id');
  const biznoIdx = UNIFIED_COLS.indexOf('bizno');

  // 영향받은 사업자번호 수집 (통합정보에서 deletedIds와 매칭되는 row의 bizno)
  const deletedIdSet = new Set(deletedIds.map(String));
  const affectedBiznos = new Set();
  for (let i = 1; i < data.length; i++) {
    if (deletedIdSet.has(String(data[i][idIdx]))) {
      const rowBizno = String(data[i][biznoIdx]);
      if (rowBizno) affectedBiznos.add(rowBizno);
    }
  }

  affectedBiznos.forEach(bizno => {
    // 잔여 신청 중 가장 최근 1건 (date 내림차순)
    const remaining = apps.filter(a => String(a.bizno) === bizno)
                          .sort((a, b) => String(b.date).localeCompare(String(a.date)));

    if (remaining.length === 0) {
      // 통합정보 row 삭제 (아래에서 위로 순회해서 인덱스 안 깨지게)
      const freshData = unified.getDataRange().getValues();
      let deletedCount = 0;
      for (let i = freshData.length - 1; i >= 1; i--) {
        if (String(freshData[i][biznoIdx]) === bizno) {
          unified.deleteRow(i + 1);
          deletedCount++;
        }
      }
      if (deletedCount > 1) {
        Logger.log('⚠️ 통합정보에 같은 bizno 중복 row ' + deletedCount + '건 발견 후 삭제 — 데이터 정합성 점검 필요 (bizno=' + bizno + ')');
      } else if (deletedCount === 1) {
        Logger.log('통합정보 row 삭제 (bizno=' + bizno + ')');
      }
      // 노션 archive는 Task 15의 archiveNotionPage가 처리
    } else {
      // 가장 최근 신청 + 그 신청의 isLatest=1 견적으로 갱신
      const latestApp = remaining[0];
      const latestQuote = quotes.filter(q => String(q.appId) === String(latestApp.id) && String(q.isLatest) === '1')[0];
      upsertUnified(latestApp, latestQuote || null);
    }
  });
}

// ─────────────────────────────────────────────────────────────
// rebuildUnified: 신청+견적 시트로부터 통합정보 일괄 재구축
// 통합정보 시트 손상 / 룰 변경 / 운영자 요청 시 수동 실행
// Apps Script 에디터에서 함수 드롭다운으로 실행
// ─────────────────────────────────────────────────────────────
function rebuildUnified() {
  const apps = getRows(SN.APP, APP_COLS, APP_ARR);
  const quotes = getRows(SN.QT, QT_COLS, QT_ARR, {total:'number',eqCount:'number'});

  // 사업자번호별 가장 최근 신청 1건만 선별 (date 기준 내림차순)
  const byBizno = {};
  apps.forEach(a => {
    const bizno = String(a.bizno || '').trim();
    if (!bizno) return;
    if (!byBizno[bizno] || String(a.date) > String(byBizno[bizno].date)) {
      byBizno[bizno] = a;
    }
  });

  // 통합정보 시트 데이터 영역 초기화 (헤더는 보존)
  const sheet = getSheet(SN.UNIFIED);
  ensureHeader(sheet, UNIFIED_COLS);
  const last = sheet.getLastRow();
  if (last > 1) sheet.getRange(2, 1, last - 1, UNIFIED_COLS.length).clearContent();

  // 각 사업자에 대해 upsertUnified — 가장 최근 신청 + 그 신청의 isLatest=1 견적
  let count = 0;
  Object.keys(byBizno).forEach(bizno => {
    const app = byBizno[bizno];
    const latestQuote = quotes.filter(q => String(q.appId) === String(app.id) && String(q.isLatest) === '1')[0];
    upsertUnified(app, latestQuote || null);
    count++;
  });

  Logger.log('rebuildUnified 완료: ' + count + ' 건');
  return { ok:true, count:count };
}

// ─────────────────────────────────────────────────────────────
// 매핑 정합성 체크 — Apps Script 에디터에서 실행
// ─────────────────────────────────────────────────────────────
function _test_notionMap() {
  // 양방향 필드 모두 NOTION_PROP_MAP에 존재하고 bidirectional 마킹 됐는지
  BIDIRECTIONAL_FIELDS.forEach(f => {
    if (!NOTION_PROP_MAP[f]) throw new Error('BIDIRECTIONAL_FIELDS의 ' + f + ' 가 NOTION_PROP_MAP 에 없음');
    if (!NOTION_PROP_MAP[f].bidirectional) throw new Error(f + ' bidirectional 마킹 누락');
  });
  // SHEET_TO_NOTION_NAME / NOTION_NAME_TO_SHEET 양방향 일치
  Object.keys(NOTION_PROP_MAP).forEach(k => {
    const name = NOTION_PROP_MAP[k].name;
    if (SHEET_TO_NOTION_NAME[k] !== name) throw new Error('SHEET_TO_NOTION_NAME 불일치: ' + k);
    if (NOTION_NAME_TO_SHEET[name] !== k) throw new Error('NOTION_NAME_TO_SHEET 불일치: ' + name);
  });
  Logger.log('NOTION_PROP_MAP 정합성 OK — 매핑 ' + Object.keys(NOTION_PROP_MAP).length + '개, 양방향 ' + BIDIRECTIONAL_FIELDS.length + '개');
}
