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
  version:        { name: '견적버전',         type: 'number' },
  // 가이드 메일 (Phase 4)
  guide_script:        { name: '가이드스크립트',     type: 'rich_text' },
  guide_generated_at:  { name: '가이드생성일',       type: 'date' },
  guide_html_url:      { name: '가이드메일HTML',     type: 'url' },
  guide_version:       { name: '가이드버전',         type: 'number' },
  guide_send_request:  { name: '가이드발송요청',     type: 'checkbox',  bidirectional: true },
  guide_sent_at:       { name: '가이드발송일',       type: 'date' },
  guide_sent_status:   { name: '가이드발송상태',     type: 'select' }
};

// 양방향 필드 — 시트와 노션 둘 다 source 가능
const BIDIRECTIONAL_FIELDS = ['status','manager','memo','quoteMemo','guide_send_request'];

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

// 통합정보 시트에서 bizno로 row 객체 1개 로드 (영문 키, 배열은 파싱)
function _loadUnifiedByBizno(bizno) {
  if (!bizno) return null;
  const sheet = getSheet(SN.UNIFIED);
  const data = sheet.getDataRange().getValues();
  const biznoIdx = UNIFIED_COLS.indexOf('bizno');
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][biznoIdx]) === String(bizno)) {
      const obj = {};
      UNIFIED_COLS.forEach(function(col, j) {
        const v = data[i][j];
        if (UNIFIED_ARR.indexOf(col) >= 0) {
          try { obj[col] = JSON.parse(v || '[]'); } catch(e) { obj[col] = []; }
        } else if (UNIFIED_NUM[col] === 'number') {
          // 빈 셀은 빈 문자열로 보존 (0과 구분 — 노션에 null로 가도록)
          obj[col] = (v === '' || v == null) ? '' : (Number(v) || 0);
        } else {
          obj[col] = v == null ? '' : String(v);
        }
      });
      return obj;
    }
  }
  return null;
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
      // 노션 페이지도 archive (휴지통 30일 보관)
      try {
        archiveNotionPage(bizno);
      } catch (e) {
        Logger.log('archiveNotionPage 실패 bizno=' + bizno + ': ' + e);
      }
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

// ============================================================
// Notion API HTTP 레이어
// ============================================================

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

// Script Properties에서 토큰·DB ID 읽기
function getNotionConfig() {
  const p = PropertiesService.getScriptProperties();
  const token = p.getProperty('NOTION_TOKEN');
  const dbId = p.getProperty('NOTION_DB_ID');
  if (!token) throw new Error('Script Properties에 NOTION_TOKEN 없음');
  if (!dbId) throw new Error('Script Properties에 NOTION_DB_ID 없음');
  return { token: token, dbId: dbId };
}

// 모든 Notion API 호출의 단일 진입점 — 인증·retry·rate limit 처리
// _retry 인자는 내부 재귀용 (외부에서 호출하지 말 것)
function notionFetch(method, path, payload, _retry) {
  const config = getNotionConfig();
  const url = NOTION_API_BASE + path;
  const opts = {
    method: String(method).toLowerCase(),
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + config.token,
      'Notion-Version': NOTION_VERSION
    },
    muteHttpExceptions: true
  };
  if (payload) opts.payload = JSON.stringify(payload);

  const res = UrlFetchApp.fetch(url, opts);
  const code = res.getResponseCode();
  const body = res.getContentText();

  // 성공
  if (code >= 200 && code < 300) {
    try {
      return { ok: true, code: code, data: JSON.parse(body) };
    } catch (e) {
      return { ok: true, code: code, data: body };
    }
  }

  // Rate limit (429) — retry-after 헤더 따라 대기 후 1회 재시도
  if (code === 429 && !_retry) {
    const headers = res.getHeaders();
    let ra = '1';
    for (const k in headers) {
      if (k.toLowerCase() === 'retry-after') { ra = headers[k]; break; }
    }
    Utilities.sleep((Number(ra) || 1) * 1000);
    return notionFetch(method, path, payload, true);
  }

  // 일시 장애 (502/503/504) — 1.5초 대기 후 1회 재시도
  if ((code === 502 || code === 503 || code === 504) && !_retry) {
    Utilities.sleep(1500);
    return notionFetch(method, path, payload, true);
  }

  Logger.log('Notion API 실패 ' + code + ' ' + path + ' — ' + body.slice(0, 500));
  return { ok: false, code: code, error: body };
}

// 연결 테스트 — Apps Script 에디터에서 실행
// Expected: ok, DB title, 속성 개수, Title 속성명
function _test_notionFetch() {
  const config = getNotionConfig();
  const r = notionFetch('GET', '/databases/' + config.dbId);
  if (!r.ok) {
    Logger.log('실패: ' + r.code + ' — ' + (r.error || '').slice(0, 300));
    throw new Error('Notion 연결 실패. Token / DB_ID / Integration 연결 확인');
  }
  const titleProp = Object.keys(r.data.properties || {}).filter(function(k) {
    return r.data.properties[k].type === 'title';
  })[0];
  Logger.log('OK — DB title: ' + ((r.data.title || [])[0] && r.data.title[0].plain_text || '(no title)'));
  Logger.log('속성 개수: ' + Object.keys(r.data.properties || {}).length);
  Logger.log('Title 속성: ' + (titleProp || '(없음 — 회사명으로 rename 필요)'));
}

// Script Properties 사전 점검 — Apps Script 에디터에서 실행
function _checkPrereqs() {
  const p = PropertiesService.getScriptProperties();
  Logger.log('TOKEN: ' + (p.getProperty('NOTION_TOKEN') ? '✓ exists' : '✗ MISSING'));
  Logger.log('DB_ID: ' + (p.getProperty('NOTION_DB_ID') ? '✓ exists' : '✗ MISSING'));
}

// ─────────────────────────────────────────────────────────────
// ensureNotionSchema: NOTION_PROP_MAP 정의된 속성이 DB에 없으면 자동 추가
// 매 sync 시작 시 호출 (메모리 캐시로 1세션 1회만 실행)
// 사용자가 핵심 컬럼만 미리 만들고 나머지는 GAS가 자동 보충하는 워크플로우 (옵션 C)
// ─────────────────────────────────────────────────────────────
let _schemaCheckedAt = 0;  // 메모리 캐시 (실행마다 reset)

function ensureNotionSchema() {
  // 같은 실행 안에서 중복 호출 방지 (60초 내)
  if (_schemaCheckedAt && Date.now() - _schemaCheckedAt < 60000) {
    return { ok: true, cached: true };
  }

  const config = getNotionConfig();
  const r = notionFetch('GET', '/databases/' + config.dbId);
  if (!r.ok) return { ok: false, error: r.error };

  const existingProps = r.data.properties || {};
  const existingNames = Object.keys(existingProps);
  const missingProps = {};

  Object.keys(NOTION_PROP_MAP).forEach(function(sheetKey) {
    const def = NOTION_PROP_MAP[sheetKey];
    if (!existingNames.includes(def.name)) {
      missingProps[def.name] = _propertySchemaFor(def.type);
    }
  });

  if (Object.keys(missingProps).length === 0) {
    _schemaCheckedAt = Date.now();
    return { ok: true, added: 0 };
  }

  const patchRes = notionFetch('PATCH', '/databases/' + config.dbId, { properties: missingProps });
  if (!patchRes.ok) return { ok: false, error: patchRes.error };

  Logger.log('ensureNotionSchema: ' + Object.keys(missingProps).length + ' 속성 자동 추가 → ' + Object.keys(missingProps).join(', '));
  _schemaCheckedAt = Date.now();
  return { ok: true, added: Object.keys(missingProps).length };
}

// type → Notion property schema 변환
// NOTION_PROP_MAP 의 type 값을 Notion API 가 받는 schema 객체로 변환
function _propertySchemaFor(type) {
  switch (type) {
    case 'title':         return { title: {} };
    case 'rich_text':     return { rich_text: {} };
    case 'number':        return { number: { format: 'number' } };
    case 'select':        return { select: { options: [] } };
    case 'multi_select':  return { multi_select: { options: [] } };
    case 'date':          return { date: {} };
    case 'phone_number':  return { phone_number: {} };
    case 'email':         return { email: {} };
    case 'url':           return { url: {} };
    case 'files':         return { files: {} };
    case 'checkbox':      return { checkbox: {} };
    default: throw new Error('알 수 없는 Notion 속성 타입: ' + type);
  }
}

// 테스트 — 사용자가 만든 노션 DB에 빠진 속성이 있으면 자동 추가
// 두 번째 호출은 cached:true 반환 (60초 캐시)
function _test_ensureSchema() {
  const r = ensureNotionSchema();
  Logger.log('1차: ' + JSON.stringify(r));
  const r2 = ensureNotionSchema();
  Logger.log('2차 (캐시): ' + JSON.stringify(r2));
}

// ─────────────────────────────────────────────────────────────
// formatItemsForNotion: items + options (raw JSON) → 사람 읽기 텍스트
// 노션의 '견적요약' 속성에 들어갈 텍스트 (rich_text 2000자 제한 고려해 잘림)
// ─────────────────────────────────────────────────────────────
function formatItemsForNotion(items, options) {
  // 견적 없음 (items + options 모두 비어있음) → 빈 문자열
  const hasItems = items && items.length;
  const hasOptions = options && options.length;
  if (!hasItems && !hasOptions) return '';

  const parts = [];
  function won(n) { return Number(n || 0).toLocaleString('ko-KR') + '원'; }

  // 옵션 가격 추출 — 옛 스키마({name, amount})와 새 스키마({name, qty, price, unit}) 모두 지원
  // 새 스키마: price가 그 옵션의 총 금액 (qty 곱셈 없음 — frontend 디자인과 일치)
  function _optAmount(o) {
    return o.amount !== undefined ? Number(o.amount || 0) : Number(o.price || 0);
  }

  if (hasItems) {
    items.forEach(function(it, i) {
      const name = it.name || it.eqName || ('장비' + (i + 1));
      const model = it.model ? ' (' + it.model + ')' : '';
      const qty = it.qty || 1;
      const lineTotal = (it.price || 0) * qty;
      parts.push('[' + (i + 1) + '] ' + name + model + ' × ' + qty + ' = ' + won(lineTotal));
    });
  }

  if (hasOptions) {
    const optStr = options.map(function(o, i) {
      const name = o.name || ('옵션' + (i + 1));
      const amount = _optAmount(o);
      // qty가 1보다 크면 (X SET) 형태로 부가 정보 표시 (가격은 그 옵션의 총 금액)
      if (o.qty && Number(o.qty) > 1) {
        const unit = o.unit ? ' ' + o.unit : '';
        return name + ' (' + Number(o.qty) + unit + ') ' + won(amount);
      }
      return name + ' ' + won(amount);
    }).join(', ');
    parts.push('[옵션] ' + optStr);
  }

  let total = 0;
  (items || []).forEach(function(it) { total += (it.price || 0) * (it.qty || 1); });
  (options || []).forEach(function(o) { total += _optAmount(o); });

  parts.push('─────────────────────');
  parts.push('합계: ' + won(total) + ' (부가세 별도)');

  const result = parts.join('\n');
  return result.length > 1900 ? result.slice(0, 1900) + '...' : result;
}

// 테스트 — Apps Script 에디터에서 실행
function _test_formatItems() {
  const items = [
    { name:'자동포장기', model:'AP-300', qty:2, price:15000000 },
    { name:'라벨러', model:'LB-100', qty:1, price:8000000 }
  ];
  // 신 스키마: {name, qty, price, unit} — qty는 메타정보, price=총금액
  const options = [
    { name:'대형노즐', qty:4, price:500000, unit:'SET' },
    { name:'소형노즐', qty:10, price:700000, unit:'SET' }
  ];
  Logger.log('--- 신 스키마 (qty>1) ---');
  Logger.log(formatItemsForNotion(items, options));

  // 옛 스키마 호환성 — {name, amount}
  const optionsLegacy = [
    { name:'설치비', amount:500000 },
    { name:'출장비', amount:200000 }
  ];
  Logger.log('--- 옛 스키마 (amount) ---');
  Logger.log(formatItemsForNotion(items, optionsLegacy));

  // 빈 케이스
  Logger.log('--- 견적 없음 ---');
  Logger.log(formatItemsForNotion([], []));

  // 옵션 없음
  Logger.log('--- 옵션 없음 ---');
  Logger.log(formatItemsForNotion(items, []));

  // qty=1 옵션 (qty 표시 안 함)
  const optionsSingle = [{ name:'설치비', qty:1, price:300000, unit:'SET' }];
  Logger.log('--- qty=1 옵션 ---');
  Logger.log(formatItemsForNotion(items, optionsSingle));
}

// ─────────────────────────────────────────────────────────────
// 시트값 → 노션 property 변환
// 각 type별로 노션 API가 요구하는 정확한 형식으로 packaging
// ─────────────────────────────────────────────────────────────

// 단일 값 변환
function _toNotionValue(type, val) {
  if (val === null || val === undefined || val === '') return _emptyValueFor(type);

  switch (type) {
    case 'title':
      return { title: [{ text: { content: String(val).slice(0, 2000) } }] };
    case 'rich_text':
      return { rich_text: [{ text: { content: String(val).slice(0, 2000) } }] };
    case 'number':
      const n = Number(val);
      return { number: isNaN(n) ? null : n };
    case 'select':
      return { select: { name: String(val).slice(0, 100) } };
    case 'multi_select': {
      let arr;
      if (Array.isArray(val)) {
        arr = val;
      } else if (typeof val === 'string') {
        // 시트 JSON 직렬화 결과면 파싱, 아니면 단일 값으로 wrap
        const trimmed = val.trim();
        if (trimmed.charAt(0) === '[') {
          arr = _safeParseArr(val);
        } else {
          arr = [val];
        }
      } else {
        arr = [val];
      }
      return {
        multi_select: arr.filter(function(x) { return x !== null && x !== undefined && x !== ''; })
                         .map(function(x) { return { name: String(x).slice(0, 100) }; })
      };
    }
    case 'date':
      const d = _normalizeDate(val);
      return d ? { date: { start: d } } : _emptyValueFor(type);
    case 'phone_number':
      return { phone_number: String(val) };
    case 'email':
      return { email: String(val) };
    case 'url':
      const u = String(val);
      return /^https?:\/\//.test(u) ? { url: u } : _emptyValueFor(type);
    case 'files':
      const urls = Array.isArray(val) ? val
                  : (typeof val === 'string' ? _safeParseArr(val) : []);
      return {
        files: urls.filter(function(x) { return x; }).slice(0, 5).map(function(u, i) {
          return {
            name: 'photo' + (i + 1) + '.jpg',
            type: 'external',
            external: { url: String(u) }
          };
        })
      };
    case 'checkbox':
      return { checkbox: !!val };
    default:
      return _emptyValueFor(type);
  }
}

// 빈 값 (각 타입별 노션이 요구하는 "비어있음" 표현)
function _emptyValueFor(type) {
  switch (type) {
    case 'title':         return { title: [] };
    case 'rich_text':     return { rich_text: [] };
    case 'number':        return { number: null };
    case 'select':        return { select: null };
    case 'multi_select':  return { multi_select: [] };
    case 'date':          return { date: null };
    case 'phone_number':  return { phone_number: null };
    case 'email':         return { email: null };
    case 'url':           return { url: null };
    case 'files':         return { files: [] };
    case 'checkbox':      return { checkbox: false };
    default: return null;
  }
}

// 시트의 JSON 문자열 → 배열 (안전 파싱)
function _safeParseArr(s) {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch (e) { return []; }
}

// 'YYYY-MM-DD' 또는 'YYYY-MM-DD HH:MM' → Notion ISO 8601 date
// 시간 컴포넌트가 있으면 KST(+09:00) offset 명시 — 시트 시각이 KST 기준
// (offset 없으면 Notion이 UTC로 가정해 9시간 drift 발생)
function _normalizeDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (!m) return null;
  return m[4]
    ? m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':00+09:00'
    : m[1] + '-' + m[2] + '-' + m[3];
}

// ─────────────────────────────────────────────────────────────
// toNotionProperties: 통합정보 row 객체 → Notion API properties 객체
// 39 매핑 모두 변환. items+options는 견적요약 텍스트로 합성.
// ─────────────────────────────────────────────────────────────
function toNotionProperties(unifiedRow) {
  const props = {};
  Object.keys(NOTION_PROP_MAP).forEach(function(sheetKey) {
    const def = NOTION_PROP_MAP[sheetKey];

    // 견적요약은 items + options에서 합성
    if (sheetKey === '__summary') {
      props[def.name] = _toNotionValue('rich_text',
        formatItemsForNotion(unifiedRow.items, unifiedRow.options));
      return;
    }

    // 일반 키 — sheet 값 → Notion 형식으로 변환 (undefined도 빈 값으로 보내서 sync 일관성 유지)
    props[def.name] = _toNotionValue(def.type, unifiedRow[sheetKey]);
  });
  return props;
}

// 테스트 — Apps Script 에디터에서 실행, Logs로 결과 확인
function _test_toNotionProperties() {
  const row = {
    id: 'TEST-A1',
    company: '테스트회사',
    bizno: '999-99-99991',
    phone: '010-1234-5678',
    email: 'a@test.com',
    date: '2026-05-08',
    processes: ['인쇄', '후가공'],
    status: '접수',
    items: [{ name: '자동포장기', qty: 1, price: 15000000 }],
    options: [],
    total: 15000000,
    eqCount: 1,
    space_photos: ['https://drive.google.com/thumbnail?id=ABC&sz=w600'],
    pdfUrl: 'https://example.com/q.pdf'
  };
  Logger.log(JSON.stringify(toNotionProperties(row), null, 2));

  // 시간대 검증 — KST 시각이 노션에서도 KST로 보여야 함
  Logger.log('--- 시간대 검증 ---');
  const dateRow = { date: '2026-05-08 19:17', quoteDate: '2026-05-08 14:30' };
  const dateProps = toNotionProperties(dateRow);
  Logger.log('신청일 (KST 19:17 기대): ' + JSON.stringify(dateProps['신청일']));
  Logger.log('견적생성일 (KST 14:30 기대): ' + JSON.stringify(dateProps['견적생성일']));
  // 기대: { date: { start: '2026-05-08T19:17:00+09:00' } }
}

// ─────────────────────────────────────────────────────────────
// pushToNotion: 통합정보 row → 노션 페이지 upsert
// 매칭 키: 사업자번호 (재신청 시 신청ID는 변경되므로 안정 키 X)
// 운영자 메모 보존을 위해 page ID 유지하며 PATCH
// ─────────────────────────────────────────────────────────────

// 사업자번호로 노션 페이지 query (1건만 가져옴)
function _findNotionPageByBizno(bizno) {
  const config = getNotionConfig();
  const payload = {
    filter: {
      property: SHEET_TO_NOTION_NAME.bizno,  // '사업자번호'
      rich_text: { equals: String(bizno) }
    },
    page_size: 1
  };
  const r = notionFetch('POST', '/databases/' + config.dbId + '/query', payload);
  if (!r.ok) return null;
  const results = (r.data && r.data.results) || [];
  return results.length ? results[0] : null;
}

// 양방향 4필드의 현재 값 hash — _lastPushedHash 비교로 무한루프 방지
// (syncFromNotion이 노션→시트 갱신 직후 다시 push 트리거하지 않도록)
function _bidirectionalHash(unifiedRow) {
  const parts = BIDIRECTIONAL_FIELDS.map(function(f) {
    return f + '=' + (unifiedRow[f] == null ? '' : String(unifiedRow[f]));
  });
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, parts.join('|'))
    .map(function(b) { return ((b < 0 ? b + 256 : b)).toString(16); })
    .map(function(h) { return h.length === 1 ? '0' + h : h; })
    .join('').slice(0, 16);
}

function pushToNotion(unifiedRow) {
  if (!unifiedRow || !unifiedRow.bizno) return { ok: false, reason: 'no_bizno' };

  // 스키마 보장 — ensureNotionSchema는 실행 단위 캐시되어 있음
  try { ensureNotionSchema(); } catch (e) {
    Logger.log('ensureNotionSchema 실패 (무시하고 진행): ' + e);
  }

  const config = getNotionConfig();
  const bizno = String(unifiedRow.bizno);
  const props = toNotionProperties(unifiedRow);

  const existing = _findNotionPageByBizno(bizno);
  let r;
  if (existing) {
    // PATCH로 갱신 — page ID 유지 (운영자 메모/하위페이지/태그 보존)
    r = notionFetch('PATCH', '/pages/' + existing.id, { properties: props });
  } else {
    // POST로 새 페이지
    r = notionFetch('POST', '/pages', {
      parent: { database_id: config.dbId },
      properties: props
    });
  }

  if (!r.ok) {
    Logger.log('pushToNotion 실패 bizno=' + bizno + ' code=' + r.code);
    // 큐 적재 — Task 16에서 _enqueueSync 정의됨, 그 전엔 typeof 체크로 noop
    if (typeof _enqueueSync === 'function') {
      _enqueueSync('pushToNotion', { bizno: bizno, unifiedRow: unifiedRow }, r.error);
    }
    return r;
  }

  // 성공 — _lastPushedHash 갱신 (무한루프 방지 hash)
  PropertiesService.getScriptProperties()
    .setProperty('hash_' + bizno, _bidirectionalHash(unifiedRow));

  return {
    ok: true,
    pageId: r.data.id,
    action: existing ? 'updated' : 'created'
  };
}

// ─────────────────────────────────────────────────────────────
// 테스트 — 실제 노션 DB에 페이지 1건 만들고 / 갱신하기 / 정리
// 순서대로 실행: _test_pushToNotion_create → _test_pushToNotion_update → _cleanup_test_notion
// ─────────────────────────────────────────────────────────────
function _test_pushToNotion_create() {
  const row = {
    id: 'TEST-A1',
    company: '테스트회사A',
    ceo: '홍길동',
    bizno: '999-99-99991',
    phone: '010-1234-5678',
    email: 'a@test.com',
    address: '서울시 강남구',
    pname: '테스트제품',
    qty: '1000',
    status: '접수',
    date: '2026-05-08',
    processes: ['인쇄', '후가공'],
    pkgtypes: ['파우치']
  };
  Logger.log(JSON.stringify(pushToNotion(row)));
}

function _test_pushToNotion_update() {
  // 같은 bizno로 다시 push → PATCH 동작 (같은 page ID 유지)
  const row = {
    id: 'TEST-A2',
    company: '테스트회사A 수정',
    ceo: '홍길동',
    bizno: '999-99-99991',
    phone: '010-9999-8888',
    status: '견적발송',
    date: '2026-05-09',
    pname: '재신청제품',
    qty: '2000'
  };
  Logger.log(JSON.stringify(pushToNotion(row)));
}

function _cleanup_test_notion() {
  // 테스트 페이지 archive (노션 휴지통으로)
  const page = _findNotionPageByBizno('999-99-99991');
  if (page) {
    notionFetch('PATCH', '/pages/' + page.id, { archived: true });
    Logger.log('테스트 페이지 archive 완료 (page ID: ' + page.id + ')');
  } else {
    Logger.log('테스트 페이지 찾을 수 없음 (이미 정리됨?)');
  }
  // 해시도 정리
  PropertiesService.getScriptProperties().deleteProperty('hash_999-99-99991');
}

// ─────────────────────────────────────────────────────────────
// _cleanupOrphanHashes: 통합정보 시트에 없는 bizno의 hash_* 속성을 일괄 삭제
// 테스트 잔여물 / 삭제 후 cleanup 누락된 hash를 안전하게 정리한다.
// dryRun=true로 먼저 실행해 삭제 대상을 확인할 것을 권장.
// ─────────────────────────────────────────────────────────────
function _cleanupOrphanHashes(dryRun) {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();

  // 통합정보 시트에서 살아있는 bizno 집합 구성
  const sheet = getSheet(SN.UNIFIED);
  const data = sheet.getDataRange().getValues();
  const biznoIdx = UNIFIED_COLS.indexOf('bizno');
  const liveBiznos = {};
  for (let i = 1; i < data.length; i++) {
    const b = String(data[i][biznoIdx] || '').trim();
    if (b) liveBiznos[b] = true;
  }

  const orphans = [];
  Object.keys(all).forEach(function(key) {
    if (key.indexOf('hash_') !== 0) return;
    const bizno = key.substring(5);
    if (!liveBiznos[bizno]) orphans.push(key);
  });

  Logger.log('hash_* 총 ' + Object.keys(all).filter(function(k){return k.indexOf('hash_')===0;}).length + '개 중 고아 ' + orphans.length + '개');
  orphans.forEach(function(k) { Logger.log('  - ' + k); });

  if (dryRun) {
    Logger.log('dryRun=true — 실제 삭제는 수행하지 않음. 삭제하려면 _cleanupOrphanHashes(false) 실행.');
    return { ok: true, dryRun: true, orphans: orphans };
  }

  orphans.forEach(function(k) { props.deleteProperty(k); });
  Logger.log('삭제 완료: ' + orphans.length + '개');
  return { ok: true, deleted: orphans.length, orphans: orphans };
}

// dryRun: 삭제 대상만 로그로 확인 (실제 삭제 X)
function _cleanupOrphanHashes_dryRun() { return _cleanupOrphanHashes(true); }
// 실제 삭제 실행
function _cleanupOrphanHashes_run()    { return _cleanupOrphanHashes(false); }

// ─────────────────────────────────────────────────────────────
// 진단: 마지막 견적의 sync 상태를 확인
// 견적은 시트에 정상 들어갔는데 통합정보에는 안 들어갈 때 원인 분석
// Apps Script 에디터 함수 드롭다운에서 실행
// ─────────────────────────────────────────────────────────────
function _diagnoseLastQuoteSync() {
  const quotes = getRows(SN.QT, QT_COLS, QT_ARR, {total:'number',eqCount:'number'});
  if (!quotes.length) {
    Logger.log('❌ 견적 시트가 비어있음');
    return;
  }
  const last = quotes[quotes.length - 1];
  Logger.log('=== 마지막 견적 ===');
  Logger.log('id: "' + last.id + '"');
  Logger.log('appId: "' + last.appId + '" (길이=' + (last.appId || '').length + ')');
  Logger.log('company: "' + last.company + '"');
  Logger.log('isLatest: "' + last.isLatest + '"');
  Logger.log('version: ' + last.version);

  if (!last.appId || !String(last.appId).trim()) {
    Logger.log('');
    Logger.log('❌ 진단 결과: 견적의 appId가 비어있음.');
    Logger.log('   원인: 견적 폼에서 신청 없이 임의 발급되었거나 appId 입력이 누락됨.');
    Logger.log('   조치: 운영자가 견적서 작성 시 신청을 선택해서 발급하도록 안내, 또는 견적의 appId 컬럼 수동 채움.');
    return;
  }

  Logger.log('');
  Logger.log('=== 신청 시트에서 _findApp 시도 ===');
  const app = _findApp(last.appId);
  if (!app) {
    Logger.log('❌ _findApp("' + last.appId + '") → null');
    Logger.log('   신청 시트에 해당 id의 row가 없음.');
    Logger.log('');
    Logger.log('--- 신청 시트의 모든 id (참고) ---');
    const apps = getRows(SN.APP, APP_COLS, APP_ARR);
    if (!apps.length) {
      Logger.log('   (신청 시트가 비어있음)');
    } else {
      apps.forEach(function(a) {
        Logger.log('   id="' + a.id + '" | bizno="' + a.bizno + '" | company="' + a.company + '"');
      });
    }
    Logger.log('');
    Logger.log('   → 견적의 appId와 일치하는 id가 신청 시트에 없으면 통합정보 sync는 정상적으로 skip됨.');
    Logger.log('   조치: 견적의 appId 컬럼을 신청 시트의 정확한 id 값으로 수정 후 saveQt 다시 호출 또는 _diagnoseLastQuoteSync_force() 실행.');
    return;
  }
  Logger.log('✓ _findApp 성공');
  Logger.log('  app.id: "' + app.id + '"');
  Logger.log('  app.bizno: "' + app.bizno + '"');
  Logger.log('  app.company: "' + app.company + '"');

  Logger.log('');
  Logger.log('=== 통합정보 row 조회 ===');
  const unified = _loadUnifiedByBizno(app.bizno);
  if (!unified) {
    Logger.log('❌ _loadUnifiedByBizno("' + app.bizno + '") → null');
    Logger.log('   통합정보 시트에 해당 bizno row가 없음.');
    Logger.log('   원인: upsertUnified가 신청 시점에 호출되지 않았거나 bizno가 비어있음.');
    Logger.log('   조치: 신청을 다시 제출하거나 rebuildUnified() 실행.');
    return;
  }
  Logger.log('✓ 통합정보 row 발견');
  Logger.log('  현재 견적 컬럼 상태:');
  ['quoteId','quoteProcess','quoteStatus','quoteDate','total','eqCount','version','isLatest','items','options','pdfUrl'].forEach(function(k) {
    const v = unified[k];
    const display = (v == null || v === '') ? '(빈 값)' : JSON.stringify(v);
    Logger.log('    ' + k + ': ' + display);
  });

  Logger.log('');
  Logger.log('=== 진단 결론 ===');
  if (!unified.quoteId || unified.quoteId === '') {
    Logger.log('통합정보의 견적 컬럼이 비어있음 — 견적 발급 시 upsertUnified 호출이 실패했거나 silent skip됨.');
    Logger.log('수동 복구: _diagnoseLastQuoteSync_force() 실행하면 마지막 견적을 통합정보에 강제 반영.');
  } else if (String(unified.quoteId) === String(last.id)) {
    Logger.log('✓ 통합정보가 마지막 견적과 일치 — 정상.');
  } else {
    Logger.log('통합정보의 견적이 다른 견적임 (' + unified.quoteId + ' vs 마지막 ' + last.id + ').');
    Logger.log('isLatest 견적이 별도로 있을 수 있음 — 정상일 수 있음.');
  }
}

// 강제 복구 — 마지막 견적을 통합정보에 강제 반영 (디버깅 후 사용)
function _diagnoseLastQuoteSync_force() {
  const quotes = getRows(SN.QT, QT_COLS, QT_ARR, {total:'number',eqCount:'number'});
  if (!quotes.length) { Logger.log('견적 없음'); return; }
  const last = quotes[quotes.length - 1];
  if (!last.appId) {
    Logger.log('❌ appId 없음 — 강제 복구 불가. 견적 시트에서 appId 컬럼을 채운 후 다시 실행.');
    return;
  }
  const app = _findApp(last.appId);
  if (!app) {
    Logger.log('❌ 신청 못 찾음 — 강제 복구 불가.');
    return;
  }
  const r = upsertUnified(app, last);
  Logger.log('upsertUnified 결과: ' + JSON.stringify(r));
  if (r.ok) {
    const unified = _loadUnifiedByBizno(app.bizno);
    if (unified) {
      const pushR = pushToNotion(unified);
      Logger.log('pushToNotion 결과: ' + JSON.stringify(pushR));
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 노션 property → 시트값 역변환 (syncFromNotion이 사용)
// 양방향 4 필드만 시트로 가져올 때 사용 (onlyBidirectional=true)
// ─────────────────────────────────────────────────────────────

// 단일 property 값 추출
function _fromNotionValue(prop) {
  if (!prop) return '';
  switch (prop.type) {
    case 'title':
      return (prop.title || []).map(function(t) { return t.plain_text || ''; }).join('');
    case 'rich_text':
      return (prop.rich_text || []).map(function(t) { return t.plain_text || ''; }).join('');
    case 'number':
      return prop.number == null ? '' : prop.number;
    case 'select':
      return prop.select ? prop.select.name : '';
    case 'multi_select':
      return (prop.multi_select || []).map(function(o) { return o.name; });
    case 'date':
      return prop.date ? prop.date.start : '';
    case 'phone_number':
      return prop.phone_number || '';
    case 'email':
      return prop.email || '';
    case 'url':
      return prop.url || '';
    case 'files':
      return (prop.files || []).map(function(f) {
        return (f.external && f.external.url) || (f.file && f.file.url) || '';
      });
    case 'checkbox':
      return !!prop.checkbox;
    default:
      return '';
  }
}

// 노션 페이지 → 시트값 객체 (영문 키)
// onlyBidirectional=true 이면 양방향 4필드 + bizno만 추출 (syncFromNotion용)
// onlyBidirectional=false 면 알려진 모든 NOTION_PROP_MAP 키 추출 (디버깅·확장용)
function fromNotionPage(page, onlyBidirectional) {
  const out = {
    __pageId: page.id,
    __lastEdited: page.last_edited_time
  };
  Object.keys(page.properties || {}).forEach(function(notionName) {
    const sheetKey = NOTION_NAME_TO_SHEET[notionName];
    if (!sheetKey) return;  // 운영자 자유 컬럼 — sync 무관
    if (sheetKey === '__summary') return;  // 가상 키, 역변환 안 함
    if (onlyBidirectional && BIDIRECTIONAL_FIELDS.indexOf(sheetKey) < 0) {
      // 양방향만 모드 — bizno는 매칭 키이므로 항상 포함
      if (sheetKey !== 'bizno') return;
    }
    out[sheetKey] = _fromNotionValue(page.properties[notionName]);
  });
  return out;
}

// ─────────────────────────────────────────────────────────────
// 테스트 — 가상 노션 페이지 객체로 역변환 확인
// (실제 노션 호출 안 함 — 노션 API 응답 형태 모킹)
// ─────────────────────────────────────────────────────────────
function _test_fromNotionPage() {
  const mockPage = {
    id: 'test-page-id-abc',
    last_edited_time: '2026-05-08T12:00:00.000Z',
    properties: {
      '회사명': { type: 'title', title: [{ plain_text: '테스트회사', type: 'text' }] },
      '신청ID': { type: 'rich_text', rich_text: [{ plain_text: 'NO-260508-9999', type: 'text' }] },
      '사업자번호': { type: 'rich_text', rich_text: [{ plain_text: '999-99-99999', type: 'text' }] },
      '신청상태': { type: 'select', select: { name: '검토중' } },
      '담당자': { type: 'rich_text', rich_text: [{ plain_text: '홍길동', type: 'text' }] },
      '신청메모': { type: 'rich_text', rich_text: [{ plain_text: '전화 예정', type: 'text' }] },
      '견적메모': { type: 'rich_text', rich_text: [{ plain_text: '협의 중', type: 'text' }] },
      '연락처': { type: 'phone_number', phone_number: '010-1234-5678' },
      '공정': { type: 'multi_select', multi_select: [{ name: '인쇄' }, { name: '후가공' }] },
      '신청일': { type: 'date', date: { start: '2026-05-08' } },
      '견적총액': { type: 'number', number: 15000000 },
      '운영자_자유컬럼': { type: 'rich_text', rich_text: [{ plain_text: '메모', type: 'text' }] }  // sync 무관
    }
  };

  Logger.log('--- 양방향만 추출 (onlyBidirectional=true) ---');
  Logger.log(JSON.stringify(fromNotionPage(mockPage, true), null, 2));

  Logger.log('--- 전체 추출 (onlyBidirectional=false) ---');
  Logger.log(JSON.stringify(fromNotionPage(mockPage, false), null, 2));

  // 운영자_자유컬럼은 NOTION_PROP_MAP에 없으므로 두 모드 모두에서 제외되어야 함 ✓
}

// ─────────────────────────────────────────────────────────────
// syncFromNotion: 노션 → 시트 양방향 동기화 (5분 Time Trigger + 즉시 버튼)
// last_edited_time > LAST_SYNC_AT 인 페이지만 처리
// 양방향 4 필드만 시트로 반영, 단방향은 매번 시트값으로 push (되돌리기 정책 B)
// ─────────────────────────────────────────────────────────────
function syncFromNotion() {
  const props = PropertiesService.getScriptProperties();
  const lastSyncAt = props.getProperty('LAST_SYNC_AT') || '2000-01-01T00:00:00.000Z';
  const nowIso = new Date().toISOString();

  let changed = 0;
  let scanned = 0;
  let hasMore = true;
  let cursor = null;
  const config = getNotionConfig();

  while (hasMore) {
    const payload = {
      filter: {
        timestamp: 'last_edited_time',
        last_edited_time: { after: lastSyncAt }
      },
      sorts: [{ timestamp: 'last_edited_time', direction: 'ascending' }],
      page_size: 50
    };
    if (cursor) payload.start_cursor = cursor;

    const r = notionFetch('POST', '/databases/' + config.dbId + '/query', payload);
    if (!r.ok) {
      Logger.log('syncFromNotion query 실패: ' + r.error);
      return { ok: false, error: r.error };
    }

    (r.data.results || []).forEach(function(page) {
      scanned++;
      if (page.archived) return;  // 휴지통 페이지 무시
      try {
        if (_applyNotionPageToSheet(page)) changed++;
      } catch (e) {
        Logger.log('페이지 sync 실패 ' + page.id + ': ' + e);
      }
    });

    hasMore = r.data.has_more;
    cursor = r.data.next_cursor;
  }

  props.setProperty('LAST_SYNC_AT', nowIso);

  // 큐 재처리 (Task 16에서 정의될 예정 — typeof 가드)
  try {
    if (typeof _processSyncQueue === 'function') _processSyncQueue();
  } catch (e) {
    Logger.log('_processSyncQueue 실패: ' + e);
  }

  Logger.log('syncFromNotion 완료: scanned=' + scanned + ', changed=' + changed);
  return { ok: true, scanned: scanned, changed: changed };
}

// ─────────────────────────────────────────────────────────────
// _applyNotionPageToSheet: 1개 페이지의 양방향 변경을 시트에 반영
// 무한루프 방지: hash_<bizno> Properties와 비교
// 단방향 컬럼이 노션에서 변조됐을 가능성 → pushToNotion으로 강제 되돌리기
// 반환: true면 시트에 변경 반영함, false면 skip 또는 변경 없음
// ─────────────────────────────────────────────────────────────
function _applyNotionPageToSheet(page) {
  const fromNotion = fromNotionPage(page, true);
  const bizno = String(fromNotion.bizno || '').trim();
  if (!bizno) return false;

  const unified = _loadUnifiedByBizno(bizno);
  if (!unified) return false;

  const props = PropertiesService.getScriptProperties();
  const lastHash = props.getProperty('hash_' + bizno);
  const currentSheetHash = _bidirectionalHash(unified);
  if (currentSheetHash !== lastHash) {
    Logger.log('skip ' + bizno + ' — 시트가 더 최근에 변경됨 (last-write-wins, sheet wins)');
    try { pushToNotion(unified); } catch (e) { Logger.log('skip 후 push 실패 ' + bizno + ': ' + e); }
    return false;
  }

  const changes = {};
  BIDIRECTIONAL_FIELDS.forEach(function(f) {
    const newVal = fromNotion[f];
    const oldVal = unified[f] == null ? '' : String(unified[f]);
    const newStr = newVal == null ? '' : String(newVal);
    if (newStr !== oldVal) changes[f] = newVal;
  });

  if (Object.keys(changes).length === 0) {
    try { pushToNotion(unified); } catch (e) { Logger.log('단방향 되돌리기 push 실패 ' + bizno + ': ' + e); }
    return false;
  }

  // 통합정보 시트의 양방향 4필드만 직접 업데이트 (견적 정보 보존)
  const unifiedSheet = getSheet(SN.UNIFIED);
  const data = unifiedSheet.getDataRange().getValues();
  const biznoIdx = UNIFIED_COLS.indexOf('bizno');
  let targetRow = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][biznoIdx]) === bizno) { targetRow = i + 1; break; }
  }
  if (targetRow < 0) {
    Logger.log('통합정보 row 사라짐 — sync skip ' + bizno);
    return false;
  }
  Object.keys(changes).forEach(function(f) {
    const colIdx = UNIFIED_COLS.indexOf(f);
    if (colIdx >= 0) {
      let val = changes[f];
      if (Array.isArray(val)) val = JSON.stringify(val);
      unifiedSheet.getRange(targetRow, colIdx + 1).setValue(val == null ? '' : String(val));
    }
  });

  // 신청 시트의 status/manager/memo 갱신
  const apps = getRows(SN.APP, APP_COLS, APP_ARR);
  const targetApp = apps.find(function(a) { return String(a.id) === String(unified.id); });
  if (targetApp) {
    let needUpdate = false;
    ['status','manager','memo'].forEach(function(f) {
      if (changes[f] !== undefined) { targetApp[f] = changes[f]; needUpdate = true; }
    });
    if (needUpdate) updateRow(SN.APP, APP_COLS, APP_ARR, targetApp, 'id');
  }

  // 견적 시트의 memo (= 통합정보의 quoteMemo) 갱신
  if (changes.quoteMemo !== undefined && unified.quoteId) {
    const quotes = getRows(SN.QT, QT_COLS, QT_ARR, {total:'number',eqCount:'number'});
    const targetQuote = quotes.find(function(q) { return String(q.id) === String(unified.quoteId); });
    if (targetQuote) {
      targetQuote.memo = changes.quoteMemo;
      updateRow(SN.QT, QT_COLS, QT_ARR, targetQuote, 'id');
    }
  }

  // push 해시 갱신 + 단방향 되돌리기 push
  Object.assign(unified, changes);
  props.setProperty('hash_' + bizno, _bidirectionalHash(unified));
  try { pushToNotion(unified); } catch (e) { Logger.log('되돌리기 push 실패 ' + bizno + ': ' + e); }

  Logger.log('synced ' + bizno + ' fields=' + Object.keys(changes).join(','));
  return true;
}

// ─────────────────────────────────────────────────────────────
// archiveNotionPage: 사업자번호로 노션 페이지 찾아 archive (휴지통 30일 보관)
// _reconcileAfterDelete에서 사업자의 잔여 신청이 0건일 때 호출
// 운영자가 노션 휴지통에서 30일 안에 복원 가능
// ─────────────────────────────────────────────────────────────
function archiveNotionPage(bizno) {
  if (!bizno) return { ok: false, reason: 'no_bizno' };
  const page = _findNotionPageByBizno(bizno);
  if (!page) {
    Logger.log('archiveNotionPage: 노션 페이지 없음 (이미 archive 됐거나 push 실패) bizno=' + bizno);
    return { ok: true, action: 'no_page' };
  }
  const r = notionFetch('PATCH', '/pages/' + page.id, { archived: true });
  if (!r.ok) {
    // 큐 적재 (Task 16에서 _enqueueSync 정의)
    if (typeof _enqueueSync === 'function') {
      _enqueueSync('archiveNotionPage', { bizno: bizno }, r.error);
    }
    Logger.log('archiveNotionPage 실패 bizno=' + bizno + ' code=' + r.code);
    return r;
  }
  // 해시도 정리 (다음 신청 시 새 페이지 만들 수 있도록)
  PropertiesService.getScriptProperties().deleteProperty('hash_' + bizno);
  Logger.log('archiveNotionPage 성공 bizno=' + bizno + ' page=' + page.id);
  return { ok: true, action: 'archived', pageId: page.id };
}

// 테스트 — 999-99-99991 사업자번호의 노션 페이지를 archive
function _test_archiveNotionPage() {
  const r = archiveNotionPage('999-99-99991');
  Logger.log(JSON.stringify(r));
}

// ─────────────────────────────────────────────────────────────
// _sync_queue: Notion API 실패 시 적재 → 다음 syncFromNotion 폴링에서 재처리
// 3회 실패 시 큐에서 제거 + 운영자 로그 (무한 retry 방지)
// QUEUE_COLS = ['id','action','payload_json','retry_count','last_error','created_at']
// ─────────────────────────────────────────────────────────────

// 큐 적재 — pushToNotion / archiveNotionPage 실패 시 호출됨
function _enqueueSync(action, payload, error) {
  try {
    const sheet = getSheet(SN.QUEUE);
    ensureHeader(sheet, QUEUE_COLS);

    const id = 'q' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    const row = [
      id,
      action,
      JSON.stringify(payload || {}),
      0,
      String(error == null ? '' : error).slice(0, 500),
      new Date().toISOString()
    ];
    sheet.appendRow(row);
    Logger.log('큐 적재: ' + id + ' (' + action + ')');
  } catch (e) {
    Logger.log('_enqueueSync 자체 실패: ' + e);
  }
}

// 큐 재처리 — syncFromNotion 끝에 호출됨
// 성공/3회 실패 시 row 삭제, 그 외엔 retry_count + 1 + last_error 갱신
function _processSyncQueue() {
  const sheet = getSheet(SN.QUEUE);
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { ok: true, processed: 0, failed: 0 };

  let processed = 0;
  let failed = 0;
  // 위에서 아래로 읽되 row 삭제는 거꾸로 진행 (인덱스 안 깨지게)
  for (let i = data.length - 1; i >= 1; i--) {
    const row = data[i];
    const id = row[0];
    const action = row[1];
    const payloadStr = row[2];
    const retryCount = Number(row[3]) || 0;

    let payload;
    try {
      payload = JSON.parse(payloadStr || '{}');
    } catch (e) {
      Logger.log('큐 항목 payload 파싱 실패 → 삭제: ' + id);
      sheet.deleteRow(i + 1);
      continue;
    }

    let r;
    try {
      switch (action) {
        case 'pushToNotion':
          // payload: { bizno, unifiedRow }
          // unifiedRow는 stale 가능성 있으므로 시트에서 다시 로드 (있으면)
          var fresh = payload.bizno ? _loadUnifiedByBizno(payload.bizno) : null;
          r = pushToNotion(fresh || payload.unifiedRow);
          break;
        case 'archiveNotionPage':
          // payload: { bizno }
          r = archiveNotionPage(payload.bizno);
          break;
        default:
          Logger.log('알 수 없는 큐 action → 삭제: ' + action);
          sheet.deleteRow(i + 1);
          continue;
      }
    } catch (e) {
      r = { ok: false, error: e.toString() };
    }

    if (r && r.ok) {
      sheet.deleteRow(i + 1);
      processed++;
      Logger.log('큐 처리 성공: ' + id + ' (' + action + ')');
    } else {
      const newCount = retryCount + 1;
      if (newCount >= 3) {
        // 3회 실패 — 포기. 큐에서 삭제 + 운영자 알림용 로그
        Logger.log('⚠️ 큐 항목 3회 실패 → 포기: ' + id + ' (' + action + ', bizno=' + (payload.bizno || '') + '): ' + ((r && r.error) || ''));
        sheet.deleteRow(i + 1);
        failed++;
      } else {
        // 재시도 카운트 + 마지막 에러 갱신
        sheet.getRange(i + 1, 4).setValue(newCount);
        sheet.getRange(i + 1, 5).setValue(String((r && r.error) || '').slice(0, 500));
      }
    }
  }
  if (processed || failed) {
    Logger.log('큐 처리 완료: 성공 ' + processed + ', 포기 ' + failed);
  }
  return { ok: true, processed: processed, failed: failed };
}

// 테스트 — 의도적으로 큐에 항목 적재 후 처리
function _test_syncQueue() {
  // 1) 가상 실패 항목 적재
  _enqueueSync('pushToNotion', { bizno: '999-99-99991', unifiedRow: { bizno: '999-99-99991', company: 'Q테스트' } }, '테스트용 가상 실패');
  Logger.log('큐 적재 후');

  // 2) 큐 처리 (실제로는 pushToNotion 호출되지만 테스트라 결과 따름)
  const r = _processSyncQueue();
  Logger.log(JSON.stringify(r));
}

// 큐 전체 보기 (디버깅)
function _peek_syncQueue() {
  const sheet = getSheet(SN.QUEUE);
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) {
    Logger.log('큐 비어있음');
    return;
  }
  for (let i = 1; i < data.length; i++) {
    Logger.log(JSON.stringify({
      id: data[i][0],
      action: data[i][1],
      retry: data[i][3],
      err: String(data[i][4]).slice(0, 100),
      created: data[i][5]
    }));
  }
}
