// ============================================================
// BPK Smart 2026 — Google Apps Script Backend  v2
// 설치 방법:
//   A. 구글 시트에서 연결(권장):
//      구글 시트 열기 → 확장 프로그램 → Apps Script → 붙여넣기
//   B. 독립형 프로젝트인 경우:
//      아래 SPREADSHEET_ID 에 시트 ID 입력
//      (시트 URL: https://docs.google.com/spreadsheets/d/[여기]/edit)
// ============================================================

const SPREADSHEET_ID = ''; // 독립형일 때만 시트 ID 입력, 바인딩이면 비워두기
const ADMIN_ID       = 'bpkadmin';
const ADMIN_PW       = 'BPK2026!';   // 반드시 변경하세요
const PHOTO_FOLDER   = 'BPK_Smart_Photos';

const SN = { EQ:'장비', APP:'신청', QT:'견적', CFG:'설정', UNIFIED:'통합정보', QUEUE:'_sync_queue' };

const EQ_COLS  = ['id','name','model','price','category','desc','status',
                  'photos','photos_pkg','videos','tags','tag_texture','tag_pkg',
                  'tag_process','tag_product','tag_feature','tag_space',
                  'tag_electric','tag_air','tag_keyword',
                  'spec_speed','spec_power','spec_packing','spec_dimension','spec_weight','spec_air','spec_voltage'];
const APP_COLS = ['id','company','ceo','bizno','phone','email','address',
                  'pname','texture','processes','pkgtypes','qty','speed','memo',
                  'problem_type','problem_points','equipment','electric','air_yn','air_flow','space_w','space_h',
                  'space_photos','product_photos','status','date','manager',
                  'contentHash'];
// T1-3: pdfHash/equipPdfHash 추가 — Drive 재업로드 스킵 판정용 (자동 마이그레이션)
// version/isLatest 추가 — 같은 appId 의 견적 버전 추적용
const QT_COLS  = ['id','company','appId','process','memo','validUntil',
                  'items','options','total','eqCount','status','date','pdfUrl','equipPdfUrl',
                  'pdfHash','equipPdfHash','version','isLatest'];

const EQ_ARR   = ['photos','photos_pkg','videos'];
const APP_ARR  = ['processes','pkgtypes','problem_points','equipment','electric','space_photos','product_photos'];
const QT_ARR   = ['items','options'];

// 통합정보 시트 — 신청 28 + 견적 16 (company/appId 제외, 충돌 컬럼은 quote* prefix)
const UNIFIED_COLS = [
  // 신청 (28)
  'id','company','ceo','bizno','phone','email','address',
  'pname','texture','processes','pkgtypes','qty','speed','memo',
  'problem_type','problem_points','equipment','electric','air_yn','air_flow',
  'space_w','space_h','space_photos','product_photos',
  'status','date','manager','contentHash',
  // 견적 (16)
  'quoteId','quoteProcess','quoteMemo','validUntil',
  'items','options','total','eqCount',
  'quoteStatus','quoteDate','pdfUrl','equipPdfUrl',
  'pdfHash','equipPdfHash','version','isLatest'
];

const UNIFIED_ARR = [
  'processes','pkgtypes','problem_points','equipment','electric',
  'space_photos','product_photos','items','options'
];

const UNIFIED_NUM = { total:'number', eqCount:'number', version:'number' };

// _sync_queue 시트 — Notion API 실패 재시도용
const QUEUE_COLS = ['id','action','payload_json','retry_count','last_error','created_at'];

// ============================================================
// 스프레드시트 접근
// ============================================================
function getSpreadsheet() {
  if (SPREADSHEET_ID && SPREADSHEET_ID.trim() !== '') {
    return SpreadsheetApp.openById(SPREADSHEET_ID.trim());
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error(
      'SPREADSHEET_ID가 설정되지 않았고, 바인딩된 시트도 없습니다. ' +
      'Code.gs 상단의 SPREADSHEET_ID에 시트 ID를 입력하거나, ' +
      '구글 시트에서 확장 프로그램 > Apps Script로 연결하세요.'
    );
  }
  return ss;
}

function getSheet(name) {
  const ss = getSpreadsheet();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

// ============================================================
// 라우터
// ============================================================
function doPost(e) {
  // 먼저 시트 자동 초기화 (최초 1회)
  try { autoInitSheets(); } catch(err) {}

  try {
    const payload = JSON.parse(e.postData.contents);
    const { action, data } = payload;
    let result;

    switch (action) {
      case 'ping':        result = { ok:true, msg:'연결 성공', ts: new Date().toISOString() }; break;
      case 'auth':        result = checkAuth(data); break;

      case 'getEq':       result = { ok:true, data: getRows(SN.EQ,  EQ_COLS,  EQ_ARR,  {id:'number',price:'number'}) }; break;
      case 'upsertEq':    result = upsertRow(SN.EQ,  EQ_COLS,  EQ_ARR,  data, 'id'); break;
      case 'deleteEq':    result = deleteRow(SN.EQ,  'id', data.id); break;
      case 'bulkSaveEq':  result = bulkSave(SN.EQ,   EQ_COLS,  EQ_ARR,  data); break;

      case 'getApps':     result = { ok:true, data: getRows(SN.APP, APP_COLS, APP_ARR) }; break;
      case 'saveApp':
        result = appendRow(SN.APP,  APP_COLS, APP_ARR, data);
        _safeSync('upsertUnified after saveApp', function() { upsertUnified(data); });
        _safeSync('pushToNotion after saveApp', function() {
          var row = _loadUnifiedByBizno(data.bizno);
          if (row) pushToNotion(row);
        });
        break;
      case 'updateApp':
        result = updateRow(SN.APP,  APP_COLS, APP_ARR, data, 'id');
        _safeSync('upsertUnified after updateApp', function() { upsertUnified(data); });
        _safeSync('pushToNotion after updateApp', function() {
          var row = _loadUnifiedByBizno(data.bizno);
          if (row) pushToNotion(row);
        });
        break;

      case 'getQts':      result = { ok:true, data: getRows(SN.QT,  QT_COLS,  QT_ARR,  {total:'number',eqCount:'number'}) }; break;
      case 'saveQt':
        result = saveQuoteWithVersion(data);
        _safeSync('upsertUnified after saveQt', function() {
          var app = _findApp(data.appId);
          if (app) upsertUnified(app, data);
        });
        _safeSync('pushToNotion after saveQt', function() {
          var app = _findApp(data.appId);
          if (app) {
            var row = _loadUnifiedByBizno(app.bizno);
            if (row) pushToNotion(row);
          }
        });
        break;
      case 'updateQt':
        result = updateRow(SN.QT,   QT_COLS,  QT_ARR,  data, 'id');
        _safeSync('upsertUnified after updateQt', function() {
          var app = _findApp(data.appId);
          if (app) upsertUnified(app, data);
        });
        _safeSync('pushToNotion after updateQt', function() {
          var app = _findApp(data.appId);
          if (app) {
            var row = _loadUnifiedByBizno(app.bizno);
            if (row) pushToNotion(row);
          }
        });
        break;
      case 'deleteApps':
        result = deleteApps(data);
        _safeSync('reconcile after deleteApps', function() { _reconcileAfterDelete(data.ids || []); });
        // 노션 archive는 Task 15에서 추가됨 (현재는 reconcile 내부에서 처리할 예정)
        break;

      case 'getCfg':      result = { ok:true, data: getCfg() }; break;
      case 'saveCfg':     result = saveCfg(data); break;

      case 'uploadPhoto':         result = uploadPhoto(data); break;
      case 'getPhotoBase64':      result = getPhotoBase64(data); break;
      case 'getPhotosBase64Bulk': result = getPhotosBase64Bulk(data); break;
      case 'getLatestQuotePdf':   result = getLatestQuotePdf(data); break;

      default: result = { ok:false, error:'Unknown action: ' + action };
    }
    return out(result);
  } catch (err) {
    return out({ ok:false, error: err.toString(), stack: err.stack });
  }
}

function doGet(e) {
  // GET ping 지원 (브라우저 주소창에서 연결 테스트용)
  try {
    autoInitSheets();
    return out({ ok:true, msg:'BPK Smart 2026 API 정상 작동 중', ts: new Date().toISOString() });
  } catch(err) {
    return out({ ok:false, error: err.toString() });
  }
}

function out(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// 인증
// ============================================================
function checkAuth(data) {
  return { ok: String(data.id) === ADMIN_ID && String(data.pw) === ADMIN_PW };
}

// ============================================================
// 시트 자동 초기화
// ============================================================
function autoInitSheets() {
  // 기존 시트 (장비/신청/견적) + 신규 (통합정보/_sync_queue)
  [
    [SN.EQ, EQ_COLS], [SN.APP, APP_COLS], [SN.QT, QT_COLS],
    [SN.UNIFIED, UNIFIED_COLS], [SN.QUEUE, QUEUE_COLS]
  ].forEach(([name, cols]) => {
    const sheet = getSheet(name);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(cols);
    } else {
      // 컬럼이 추가된 경우 시트 열 수 확보 후 헤더 최신화
      if (sheet.getMaxColumns() < cols.length) {
        sheet.insertColumnsAfter(sheet.getMaxColumns(), cols.length - sheet.getMaxColumns());
      }
      sheet.getRange(1, 1, 1, cols.length).setValues([cols]);
    }
  });
  // 설정 시트 (기존 동작)
  const cfgSheet = getSheet(SN.CFG);
  if (cfgSheet.getLastRow() === 0) { cfgSheet.appendRow(['cfg']); cfgSheet.appendRow(['{}']); }
}

// Apps Script 에디터에서 수동 실행도 가능
function initSheets() {
  autoInitSheets();
  return 'OK — 시트 초기화 완료';
}

// ============================================================
// 공통 시트 헬퍼
// ============================================================
function getRows(sheetName, cols, arrCols, numCols) {
  const sheet = getSheet(sheetName);
  const data  = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const pad = n => String(n).padStart(2, '0');
  return data.slice(1).map(row => {
    const obj = {};
    cols.forEach((col, i) => {
      const val = row[i];
      if (arrCols && arrCols.includes(col)) {
        try { obj[col] = JSON.parse(val || '[]'); } catch(e) { obj[col] = []; }
      } else if (numCols && numCols[col] === 'number') {
        obj[col] = Number(val) || 0;
      } else if (val instanceof Date) {
        // 기존에 Date 객체로 저장된 셀: 시간 정보 있으면 함께, 없으면 날짜만
        const hasTime = val.getHours() !== 0 || val.getMinutes() !== 0 || val.getSeconds() !== 0;
        obj[col] = hasTime
          ? `${val.getFullYear()}-${pad(val.getMonth()+1)}-${pad(val.getDate())} ${pad(val.getHours())}:${pad(val.getMinutes())}`
          : `${val.getFullYear()}-${pad(val.getMonth()+1)}-${pad(val.getDate())}`;
      } else {
        obj[col] = (val !== undefined && val !== null) ? String(val) : '';
      }
    });
    return obj;
  });
}

function ensureHeader(sheet, cols) {
  if (sheet.getLastRow() === 0) sheet.appendRow(cols);
}

function serializeRow(cols, arrCols, obj) {
  return cols.map(col => {
    if (arrCols && arrCols.includes(col)) return JSON.stringify(obj[col] || []);
    return (obj[col] !== undefined && obj[col] !== null) ? obj[col] : '';
  });
}

// date / quoteDate 등 날짜 컬럼을 plain text 포맷으로 강제 + 값 재작성
// (Sheets가 'YYYY-MM-DD HH:MM' 을 datetime 으로 자동 변환해 시간 잘라내는 현상 방지)
// colName 생략 시 'date' 컬럼 (기존 호출처 호환)
function _enforceTextDate(sheet, rowIdx, cols, obj, colName) {
  const target = colName || 'date';
  const idx = cols.indexOf(target);
  if (idx < 0) return;
  try {
    const cell = sheet.getRange(rowIdx, idx + 1);
    cell.setNumberFormat('@');
    if (obj && obj[target] != null) {
      cell.setValue(String(obj[target]));
    }
  } catch (e) {}
}

function appendRow(sheetName, cols, arrCols, obj) {
  const sheet = getSheet(sheetName);
  ensureHeader(sheet, cols);
  const values = serializeRow(cols, arrCols, obj);
  const newRow = sheet.getLastRow() + 1;
  // 먼저 setValues 로 행 전체 작성 (appendRow 는 자동 파싱 가능성 있음)
  sheet.getRange(newRow, 1, 1, values.length).setValues([values]);
  // date 셀은 text 포맷 + 값 재작성으로 시간 보존 강제
  _enforceTextDate(sheet, newRow, cols, obj);
  return { ok:true };
}

function updateRow(sheetName, cols, arrCols, obj, keyCol) {
  const sheet  = getSheet(sheetName);
  const data   = sheet.getDataRange().getValues();
  const keyIdx = cols.indexOf(keyCol);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][keyIdx]) === String(obj[keyCol])) {
      sheet.getRange(i+1, 1, 1, cols.length).setValues([serializeRow(cols, arrCols, obj)]);
      _enforceTextDate(sheet, i + 1, cols, obj);
      return { ok:true };
    }
  }
  // 없으면 추가
  const values = serializeRow(cols, arrCols, obj);
  const newRow = sheet.getLastRow() + 1;
  sheet.getRange(newRow, 1, 1, values.length).setValues([values]);
  _enforceTextDate(sheet, newRow, cols, obj);
  return { ok:true, action:'inserted' };
}

// 일회성 마이그레이션: 견적 시트의 date 컬럼 전체를 text 포맷으로 + Date 객체를 'YYYY-MM-DD HH:MM' 문자열로 변환
// Apps Script 에디터 함수 드롭다운에서 직접 실행 (▶️ 버튼)
function migrateQtDateColumn() {
  const sheet = getSheet(SN.QT);
  const dateIdx = QT_COLS.indexOf('date') + 1;  // 1-based
  if (dateIdx < 1) return Logger.log('date 컬럼 없음');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return Logger.log('데이터 행 없음');

  const range = sheet.getRange(2, dateIdx, lastRow - 1, 1);
  const values = range.getValues();
  range.setNumberFormat('@');  // 컬럼 전체를 plain text 로

  const pad = n => String(n).padStart(2, '0');
  const newValues = values.map(([v]) => {
    if (v instanceof Date) {
      const hasTime = v.getHours() !== 0 || v.getMinutes() !== 0 || v.getSeconds() !== 0;
      const dt = hasTime
        ? `${v.getFullYear()}-${pad(v.getMonth()+1)}-${pad(v.getDate())} ${pad(v.getHours())}:${pad(v.getMinutes())}`
        : `${v.getFullYear()}-${pad(v.getMonth()+1)}-${pad(v.getDate())}`;
      return [dt];
    }
    return [String(v == null ? '' : v)];
  });
  range.setValues(newValues);
  Logger.log('완료: ' + newValues.length + ' 행 정규화됨');
}

// ============================================================
// 신청 contentHash 마이그레이션 (Apps Script 에디터에서 1회 실행)
// 기존 신청 행 중 contentHash 가 비어있는 것을 채움
// ============================================================
function migrateAppContentHash() {
  const sheet = getSheet(SN.APP);
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return Logger.log('데이터 행 없음');
  const colIdx = APP_COLS.indexOf('contentHash');
  if (colIdx < 0) return Logger.log('contentHash 컬럼 없음 — APP_COLS 확인');
  if (sheet.getMaxColumns() < APP_COLS.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), APP_COLS.length - sheet.getMaxColumns());
  }
  sheet.getRange(1, 1, 1, APP_COLS.length).setValues([APP_COLS]);

  let updated = 0;
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[colIdx]) continue; // 이미 있음
    const obj = {};
    APP_COLS.forEach((col, j) => { obj[col] = row[j]; });
    const hash = _computeAppContentHash(obj);
    sheet.getRange(i + 1, colIdx + 1).setValue(hash);
    updated++;
  }
  Logger.log('완료: ' + updated + ' 행에 contentHash 부여');
  return { updated };
}

// 신청 객체 → contentHash (16자 hex). 클라이언트 / 서버 모두 같은 알고리즘 사용
function _computeAppContentHash(obj) {
  const sortJoin = v => Array.isArray(v) ? v.slice().sort().join(',') : (v || '');
  const _parse = v => {
    if (Array.isArray(v)) return v;
    try { return JSON.parse(v || '[]'); } catch (e) { return []; }
  };
  const parts = [
    obj.bizno || '',
    obj.pname || '',
    obj.texture || '',
    sortJoin(_parse(obj.processes)),
    sortJoin(_parse(obj.pkgtypes)),
    obj.qty || '',
    obj.speed || '',
    obj.problem_type || '',
    sortJoin(_parse(obj.problem_points)),
    sortJoin(_parse(obj.equipment).map(String)),
    sortJoin(_parse(obj.electric)),
    obj.air_yn || '',
    obj.air_flow || '',
    obj.space_w || '',
    obj.space_h || '',
    obj.memo || ''
  ].join('|');
  // MD5 16자만 사용 (충돌 가능성 무시 — 같은 회사 내 비교라 충분)
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, parts);
  return bytes.map(b => ((b < 0 ? b + 256 : b)).toString(16).padStart(2, '0')).join('').slice(0, 16);
}

// ============================================================
// 견적 신규 저장 (자동 버전 관리)
// 같은 appId 의 기존 견적이 있으면 → 모두 isLatest='' 로 마킹 + 새 row 는 v+1, isLatest=1
// 없으면 → v1, isLatest=1
// ============================================================
function saveQuoteWithVersion(data) {
  const sheet = getSheet(SN.QT);
  ensureHeader(sheet, QT_COLS);
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return { ok:false, error:'동시 저장 충돌' }; }
  try {
    const all = sheet.getDataRange().getValues();
    const idxAppId  = QT_COLS.indexOf('appId');
    const idxVer    = QT_COLS.indexOf('version');
    const idxLatest = QT_COLS.indexOf('isLatest');
    let maxVer = 0;
    const previousLatestRows = [];
    for (let i = 1; i < all.length; i++) {
      if (String(all[i][idxAppId]) === String(data.appId || '')) {
        const v = Number(all[i][idxVer]) || 0;
        if (v > maxVer) maxVer = v;
        if (String(all[i][idxLatest]) === '1') previousLatestRows.push(i + 1);
      }
    }
    // 기존 isLatest 모두 ''
    previousLatestRows.forEach(r => sheet.getRange(r, idxLatest + 1).setValue(''));
    // 새 행
    data.version = maxVer + 1;
    data.isLatest = '1';
    const newRow = sheet.getLastRow() + 1;
    const values = serializeRow(QT_COLS, QT_ARR, data);
    sheet.getRange(newRow, 1, 1, values.length).setValues([values]);
    _enforceTextDate(sheet, newRow, QT_COLS, data);
    SpreadsheetApp.flush();
    return { ok:true, version: data.version, isLatest:'1' };
  } finally {
    try { lock.releaseLock(); } catch(e) {}
  }
}

// 신청 다중 삭제 (사용자 선택 기반 중복 정리)
function deleteApps(data) {
  const ids = Array.isArray(data.ids) ? data.ids.map(String) : [];
  if (!ids.length) return { ok:true, deleted:0 };
  const sheet = getSheet(SN.APP);
  const all = sheet.getDataRange().getValues();
  const idxId = APP_COLS.indexOf('id');
  let deleted = 0;
  // 아래에서 위로 삭제 (행 인덱스 안 깨짐)
  for (let i = all.length - 1; i >= 1; i--) {
    if (ids.includes(String(all[i][idxId]))) {
      sheet.deleteRow(i + 1);
      deleted++;
    }
  }
  return { ok:true, deleted };
}

// ============================================================
// 견적 version/isLatest 마이그레이션 (1회 실행)
// 같은 appId 의 견적들을 date 순으로 정렬해 v1, v2, ... 부여
// 가장 최신만 isLatest=1, 나머지는 isLatest=''
// ============================================================
function migrateQuoteVersions() {
  const sheet = getSheet(SN.QT);
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return Logger.log('견적 데이터 없음');
  if (sheet.getMaxColumns() < QT_COLS.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), QT_COLS.length - sheet.getMaxColumns());
  }
  sheet.getRange(1, 1, 1, QT_COLS.length).setValues([QT_COLS]);

  const idxId      = QT_COLS.indexOf('id');
  const idxAppId   = QT_COLS.indexOf('appId');
  const idxDate    = QT_COLS.indexOf('date');
  const idxVersion = QT_COLS.indexOf('version');
  const idxLatest  = QT_COLS.indexOf('isLatest');

  // 행 수집 + appId 그룹핑
  const rows = data.slice(1).map((r, i) => ({ rowIdx: i + 2, id: r[idxId], appId: r[idxAppId], date: String(r[idxDate] || ''), version: r[idxVersion], isLatest: r[idxLatest] }));
  const groups = {};
  rows.forEach(r => {
    const key = r.appId || '__no_app__';
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  });

  let updated = 0;
  Object.keys(groups).forEach(appId => {
    const list = groups[appId].slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.rowIdx - b.rowIdx));
    list.forEach((r, i) => {
      const newVersion = i + 1;
      const newLatest = (i === list.length - 1) ? '1' : '';
      if (String(r.version) !== String(newVersion) || String(r.isLatest) !== String(newLatest)) {
        sheet.getRange(r.rowIdx, idxVersion + 1).setValue(newVersion);
        sheet.getRange(r.rowIdx, idxLatest + 1).setValue(newLatest);
        updated++;
      }
    });
  });

  Logger.log('완료: ' + updated + ' 행에 version/isLatest 부여');
  return { updated };
}

function upsertRow(sheetName, cols, arrCols, obj, keyCol) {
  const sheet  = getSheet(sheetName);
  ensureHeader(sheet, cols);
  const data   = sheet.getDataRange().getValues();
  const keyIdx = cols.indexOf(keyCol);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][keyIdx]) === String(obj[keyCol])) {
      sheet.getRange(i+1, 1, 1, cols.length).setValues([serializeRow(cols, arrCols, obj)]);
      return { ok:true, action:'updated' };
    }
  }
  sheet.appendRow(serializeRow(cols, arrCols, obj));
  return { ok:true, action:'inserted' };
}

function deleteRow(sheetName, keyCol, keyVal) {
  const sheet  = getSheet(sheetName);
  const data   = sheet.getDataRange().getValues();
  if (data.length === 0) return { ok:false, error:'Sheet is empty' };
  const keyIdx = data[0].indexOf(keyCol);
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][keyIdx]) === String(keyVal)) {
      sheet.deleteRow(i + 1);
      return { ok:true };
    }
  }
  return { ok:false, error:'Row not found' };
}

function bulkSave(sheetName, cols, arrCols, rows) {
  // P2-6: LockService 로 동시 수정 방지 (clearContents → 재기록 사이 보호)
  const lock = LockService.getDocumentLock();
  try { lock.waitLock(10000); }
  catch (e) { return { ok:false, error: '다른 사용자가 동기화 중입니다. 잠시 후 다시 시도하세요.' }; }
  try {
    const sheet = getSheet(sheetName);
    sheet.clearContents();
    sheet.appendRow(cols);
    if (rows && rows.length) {
      const values = rows.map(obj => serializeRow(cols, arrCols, obj));
      sheet.getRange(2, 1, values.length, cols.length).setValues(values);
    }
    SpreadsheetApp.flush();
    return { ok:true };
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// 설정
// ============================================================
function getCfg() {
  const sheet = getSheet(SN.CFG);
  const data  = sheet.getDataRange().getValues();
  if (data.length < 2) return {};
  try { return JSON.parse(data[1][0] || '{}'); } catch(e) { return {}; }
}

function saveCfg(cfg) {
  const sheet = getSheet(SN.CFG);
  sheet.clearContents();
  sheet.appendRow(['cfg']);
  sheet.appendRow([JSON.stringify(cfg)]);
  return { ok:true };
}

// ============================================================
// Drive 폴더 헬퍼 — CacheService 로 ID 캐시 + trashed 폴더 자동 회피
// 1) Drive 검색 인덱스 지연 race 방지
// 2) dedupePhotoFolders 등으로 trashed 된 폴더가 캐시에 남아있어도 자동 갱신
// ============================================================
function getOrCreateFolder(parent, name) {
  const cache = CacheService.getScriptCache();
  const parentId = parent ? parent.getId() : '__root__';
  const cacheKey = 'fld_' + parentId + '_' + name;

  // 1) 캐시 hit 시 ID 로 직접 조회. 단 trashed 면 무효화하고 재검색.
  const cached = cache.get(cacheKey);
  if (cached) {
    try {
      const folder = DriveApp.getFolderById(cached);
      if (!folder.isTrashed()) return folder;
      cache.remove(cacheKey); // trashed → 캐시 비움
    } catch (e) { /* 권한 없음 / 삭제 등 → 아래 분기 */ }
  }

  // 2) 검색: trashed 가 아닌 첫 폴더 사용
  const iter = parent ? parent.getFoldersByName(name) : DriveApp.getFoldersByName(name);
  let folder = null;
  while (iter.hasNext()) {
    const f = iter.next();
    if (!f.isTrashed()) { folder = f; break; }
  }

  // 3) 없으면 생성
  if (!folder) {
    folder = parent ? parent.createFolder(name) : DriveApp.createFolder(name);
  }

  // 4) ID 캐시 (6시간)
  try { cache.put(cacheKey, folder.getId(), 21600); } catch (e) {}
  return folder;
}

// ============================================================
// 견적서 폴더에서 가장 최신 견적서 PDF 찾기 (신청기업 다운로드용)
// data: { company, appId? }
// 반환: { ok, fileId, fileName, downloadUrl, viewUrl }
// 우선순위:
//   1) 파일명에 'BPK_견적서_' 시작 + appId 포함 (해당 신청건의 견적만)
//   2) 동일 조건이면 createdAt 최신 우선
// ============================================================
function getLatestQuotePdf(data) {
  const company = String(data.company || '').trim();
  const appId = String(data.appId || '').trim();
  if (!company) return { ok:false, error:'company 누락' };

  // 폴더 탐색: BPK_Smart_Photos/견적서/{회사명}
  const root = getOrCreateFolder(null, PHOTO_FOLDER);
  const subIter = root.getFoldersByName('견적서');
  if (!subIter.hasNext()) return { ok:false, error:'견적서 폴더 없음' };
  const sub = subIter.next();
  if (sub.isTrashed()) return { ok:false, error:'견적서 폴더가 휴지통에 있음' };

  const companyName = sanitizeName(company);
  const companyIter = sub.getFoldersByName(companyName);
  if (!companyIter.hasNext()) return { ok:false, error:'회사 폴더 없음: ' + companyName };
  let companyFolder = null;
  while (companyIter.hasNext()) {
    const f = companyIter.next();
    if (!f.isTrashed()) { companyFolder = f; break; }
  }
  if (!companyFolder) return { ok:false, error:'활성 회사 폴더 없음: ' + companyName };

  // 파일 리스트 수집 + 'BPK_견적서_' 필터 + appId 필터 (있으면)
  const files = [];
  const fileIter = companyFolder.getFiles();
  while (fileIter.hasNext()) {
    const f = fileIter.next();
    if (f.isTrashed()) continue;
    const name = f.getName();
    // 견적서만 (장비사양 제외)
    if (name.indexOf('BPK_견적서_') !== 0) continue;
    if (appId && name.indexOf(appId) === -1) continue;
    files.push({ id: f.getId(), name: name, createdAt: f.getDateCreated().getTime() });
  }

  // 회사 폴더 내 모든 견적서 PDF (appId 무관)
  const allCompanyFiles = [];
  const fileIter2 = companyFolder.getFiles();
  while (fileIter2.hasNext()) {
    const f = fileIter2.next();
    if (f.isTrashed()) continue;
    const name = f.getName();
    if (name.indexOf('BPK_견적서_') !== 0) continue;
    allCompanyFiles.push({ id: f.getId(), name: name, createdAt: f.getDateCreated().getTime() });
  }

  if (!files.length && !allCompanyFiles.length) return { ok:false, error:'견적서 PDF 파일 없음' };

  // 정렬 (최신 우선)
  files.sort((a, b) => b.createdAt - a.createdAt);
  allCompanyFiles.sort((a, b) => b.createdAt - a.createdAt);

  // 보호 장치: 같은 회사 폴더에 더 최근 PDF 가 있으면 그것을 우선 사용
  // (예: 고객이 변경 사항으로 재신청해 새 appId 가 생긴 경우 — 옛 appId 로 조회해도 최신 파일 받음)
  const latest = (allCompanyFiles.length > 0 && (!files.length || allCompanyFiles[0].createdAt > files[0].createdAt))
    ? allCompanyFiles[0]
    : files[0];
  // 디버깅용 정보
  const fallbackUsed = files.length > 0 && latest.id !== files[0].id;

  const result = {
    ok: true,
    fileId: latest.id,
    fileName: latest.name,
    downloadUrl: 'https://drive.google.com/uc?export=download&id=' + latest.id,
    viewUrl: 'https://drive.google.com/file/d/' + latest.id + '/view',
    totalMatched: files.length,
    totalCompanyFiles: allCompanyFiles.length,
    fallbackToCompanyLatest: fallbackUsed
  };

  // base64 옵션: 클라이언트가 정확히 Drive 원본을 받기 위해 사용
  // (Drive URL 다운로드는 cross-origin / 리다이렉트 이슈로 정확성 보장 안 됨)
  if (data.includeBase64) {
    try {
      const file = DriveApp.getFileById(latest.id);
      const blob = file.getBlob();
      const bytes = blob.getBytes();
      result.base64 = 'data:application/pdf;base64,' + Utilities.base64Encode(bytes);
      result.fileSize = bytes.length;
    } catch (e) {
      result.base64Error = e.toString();
    }
  }

  return result;
}

// 모든 폴더 캐시 즉시 비우기 (수동 복구용 — Apps Script 에디터에서 직접 실행)
function clearFolderCache() {
  // ScriptCache 는 패턴 삭제 미지원 — 알려진 키 패턴 + 사용자 안내
  try {
    CacheService.getScriptCache().removeAll([
      'fld___root___' + PHOTO_FOLDER
    ]);
  } catch (e) {}
  Logger.log('폴더 ID 캐시는 6시간 후 자동 만료됩니다. 또는 dedupePhotoFolders 함수가 캐시 자동 갱신.');
  return 'OK';
}

function sanitizeName(name) {
  return String(name || '기타').replace(/[\\/:*?"<>|]/g, '_').trim() || '기타';
}

// ============================================================
// 사진/PDF 업로드 → Google Drive
// data.type: 'space' | 'equipment' | 'pkg' | 'quote' | 기타
// ============================================================
// 폴더 결정 + 생성을 lock 으로 직렬화 (병렬 업로드 시 동일 회사 폴더 중복 생성 race 방지)
function _resolveTargetFolder(data) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(8000); } catch (e) { /* lock 실패 시 그냥 진행 (구버전 호환) */ }
  try {
    const root = getOrCreateFolder(null, PHOTO_FOLDER);
    if (data.type === 'space') {
      const sub = getOrCreateFolder(root, '신청서_사진');
      return getOrCreateFolder(sub, sanitizeName(data.company || '미분류'));
    } else if (data.type === 'equipment' || data.type === 'pkg') {
      const sub = getOrCreateFolder(root, '장비_사진');
      return getOrCreateFolder(sub, sanitizeName(data.eqName || '미분류'));
    } else if (data.type === 'product') {
      const sub = getOrCreateFolder(root, '제품_사진');
      return getOrCreateFolder(sub, sanitizeName(data.company || '미분류'));
    } else if (data.type === 'quote') {
      const sub = getOrCreateFolder(root, '견적서');
      return getOrCreateFolder(sub, sanitizeName(data.company || '미분류'));
    }
    return root;
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function uploadPhoto(data) {
  // 1) 폴더 결정 (lock 으로 직렬화 — 병렬 업로드 시 폴더 중복 생성 방지)
  const target = _resolveTargetFolder(data);

  // 2) 파일 업로드 (lock 밖 — 병렬 안전, 빠름)
  const parts = data.base64.split(',');
  const mime  = parts[0].split(';')[0].replace('data:', '');
  const blob  = Utilities.newBlob(Utilities.base64Decode(parts[1]), mime, data.name || 'file');
  const file = target.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const fileId = file.getId();
  return { ok:true, url: 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w600' };
}

// 1회성 마이그레이션: 같은 이름의 중복 회사 폴더를 첫 폴더로 통합 (Apps Script 에디터에서 직접 실행)
// 신청서_사진 / 제품_사진 / 견적서 / 장비_사진 의 각 하위 폴더를 회사명별로 그룹핑하여
// 2번째 이후 폴더의 파일을 첫 번째 폴더로 이동 후 빈 폴더 삭제
function dedupePhotoFolders() {
  const cache = CacheService.getScriptCache();
  const root = getOrCreateFolder(null, PHOTO_FOLDER);
  const subs = ['신청서_사진', '제품_사진', '견적서', '장비_사진'];
  let movedFiles = 0, deletedFolders = 0, cacheUpdated = 0;

  subs.forEach(subName => {
    const subIter = root.getFoldersByName(subName);
    if (!subIter.hasNext()) return;
    const sub = subIter.next();

    // 회사/장비명 기준 그룹핑
    const groups = {};
    const childIter = sub.getFolders();
    while (childIter.hasNext()) {
      const f = childIter.next();
      if (f.isTrashed()) continue;
      const key = f.getName();
      if (!groups[key]) groups[key] = [];
      groups[key].push(f);
    }

    Object.keys(groups).forEach(name => {
      const folders = groups[name];
      if (folders.length <= 1) {
        // 중복 없어도 캐시는 갱신 (이전에 trashed 폴더가 캐시되어 있을 수 있음)
        try { cache.put('fld_' + sub.getId() + '_' + name, folders[0].getId(), 21600); cacheUpdated++; } catch (e) {}
        return;
      }
      const canonical = folders[0];                 // 첫 폴더를 정본으로
      const dups = folders.slice(1);
      dups.forEach(dup => {
        const fileIter = dup.getFiles();
        while (fileIter.hasNext()) {
          const file = fileIter.next();
          canonical.addFile(file);
          dup.removeFile(file);
          movedFiles++;
        }
        dup.setTrashed(true);
        deletedFolders++;
      });
      // 캐시를 canonical 의 ID로 강제 갱신 (이전에 trashed 폴더 ID 가 들어있을 수 있음)
      try { cache.put('fld_' + sub.getId() + '_' + name, canonical.getId(), 21600); cacheUpdated++; } catch (e) {}
    });
  });

  Logger.log(`완료: ${movedFiles} 파일 이동, ${deletedFolders} 중복 폴더 휴지통, ${cacheUpdated} 캐시 갱신`);
  return { movedFiles, deletedFolders, cacheUpdated };
}

function _extractFileId(url) {
  const u = String(url || '');
  const m = u.match(/[?&]id=([^&\s]+)/) || u.match(/\/file\/d\/([^/?]+)/);
  return m ? m[1] : '';
}

// P3-7: 썸네일 우선 시도 → 실패 시 원본 fallback (PDF용 사진은 600px면 충분)
// T1-1: CacheService 6시간 캐싱 (셀당 100KB 제한 내 사진만)
function _fileToBase64(fileId) {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'p_' + fileId;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const file = DriveApp.getFileById(fileId);
  let blob;
  try {
    blob = file.getThumbnail();
    if (!blob) blob = file.getBlob();
  } catch (e) {
    blob = file.getBlob();
  }
  const mime = blob.getContentType() || 'image/jpeg';
  const result = 'data:' + mime + ';base64,' + Utilities.base64Encode(blob.getBytes());

  // CacheService 셀당 100KB 제한. 썸네일은 보통 30-80KB이라 대부분 들어감
  if (result.length < 100000) {
    try { cache.put(cacheKey, result, 21600); } catch (e) {}
  }
  return result;
}

function getPhotoBase64(data) {
  try {
    const fileId = _extractFileId(data.url);
    if (!fileId) return { ok:false, error:'fileId 없음' };
    return { ok:true, base64: _fileToBase64(fileId) };
  } catch(e) {
    return { ok:false, error: e.toString() };
  }
}

// P2-2: 다중 URL을 한번의 doPost로 변환 (콜드스타트 비용 N→1)
function getPhotosBase64Bulk(data) {
  const urls = Array.isArray(data.urls) ? data.urls : [];
  const out = urls.map(url => {
    try {
      const fileId = _extractFileId(url);
      if (!fileId) return { ok:false, error:'fileId 없음' };
      return { ok:true, base64: _fileToBase64(fileId) };
    } catch(e) {
      return { ok:false, error: e.toString() };
    }
  });
  return { ok:true, data: out };
}
