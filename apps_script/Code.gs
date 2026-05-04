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

const SN = { EQ:'장비', APP:'신청', QT:'견적', CFG:'설정' };

const EQ_COLS  = ['id','name','model','price','category','desc','status',
                  'photos','photos_pkg','videos','tags','tag_texture','tag_pkg',
                  'tag_process','tag_product','tag_feature','tag_space',
                  'tag_electric','tag_air','tag_keyword',
                  'spec_speed','spec_power','spec_packing','spec_dimension','spec_weight','spec_air','spec_voltage'];
const APP_COLS = ['id','company','ceo','bizno','phone','email','address',
                  'pname','texture','processes','pkgtypes','qty','speed','memo',
                  'problem_type','problem_points','equipment','electric','air_yn','air_flow','space_w','space_h',
                  'space_photos','product_photos','status','date','manager'];
const QT_COLS  = ['id','company','appId','process','memo','validUntil',
                  'items','total','eqCount','status','date','pdfUrl','equipPdfUrl'];

const EQ_ARR   = ['photos','photos_pkg','videos'];
const APP_ARR  = ['processes','pkgtypes','problem_points','equipment','electric','space_photos','product_photos'];
const QT_ARR   = ['items'];

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
      case 'saveApp':     result = appendRow(SN.APP,  APP_COLS, APP_ARR, data); break;
      case 'updateApp':   result = updateRow(SN.APP,  APP_COLS, APP_ARR, data, 'id'); break;

      case 'getQts':      result = { ok:true, data: getRows(SN.QT,  QT_COLS,  QT_ARR,  {total:'number',eqCount:'number'}) }; break;
      case 'saveQt':      result = appendRow(SN.QT,   QT_COLS,  QT_ARR,  data); break;
      case 'updateQt':    result = updateRow(SN.QT,   QT_COLS,  QT_ARR,  data, 'id'); break;

      case 'getCfg':      result = { ok:true, data: getCfg() }; break;
      case 'saveCfg':     result = saveCfg(data); break;

      case 'uploadPhoto':    result = uploadPhoto(data); break;

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
  [[SN.EQ, EQ_COLS], [SN.APP, APP_COLS], [SN.QT, QT_COLS]].forEach(([name, cols]) => {
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
  return data.slice(1).map(row => {
    const obj = {};
    cols.forEach((col, i) => {
      const val = row[i];
      if (arrCols && arrCols.includes(col)) {
        try { obj[col] = JSON.parse(val || '[]'); } catch(e) { obj[col] = []; }
      } else if (numCols && numCols[col] === 'number') {
        obj[col] = Number(val) || 0;
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

function appendRow(sheetName, cols, arrCols, obj) {
  const sheet = getSheet(sheetName);
  ensureHeader(sheet, cols);
  sheet.appendRow(serializeRow(cols, arrCols, obj));
  return { ok:true };
}

function updateRow(sheetName, cols, arrCols, obj, keyCol) {
  const sheet  = getSheet(sheetName);
  const data   = sheet.getDataRange().getValues();
  const keyIdx = cols.indexOf(keyCol);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][keyIdx]) === String(obj[keyCol])) {
      sheet.getRange(i+1, 1, 1, cols.length).setValues([serializeRow(cols, arrCols, obj)]);
      return { ok:true };
    }
  }
  // 없으면 추가
  sheet.appendRow(serializeRow(cols, arrCols, obj));
  return { ok:true, action:'inserted' };
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
  const sheet = getSheet(sheetName);
  sheet.clearContents();
  sheet.appendRow(cols);
  if (rows && rows.length) {
    const values = rows.map(obj => serializeRow(cols, arrCols, obj));
    sheet.getRange(2, 1, values.length, cols.length).setValues(values);
  }
  return { ok:true };
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
// Drive 폴더 헬퍼
// ============================================================
function getOrCreateFolder(parent, name) {
  const iter = parent ? parent.getFoldersByName(name) : DriveApp.getFoldersByName(name);
  if (iter.hasNext()) return iter.next();
  return parent ? parent.createFolder(name) : DriveApp.createFolder(name);
}

function sanitizeName(name) {
  return String(name || '기타').replace(/[\\/:*?"<>|]/g, '_').trim() || '기타';
}

// ============================================================
// 사진/PDF 업로드 → Google Drive
// data.type: 'space' | 'equipment' | 'pkg' | 'quote' | 기타
// ============================================================
function uploadPhoto(data) {
  const parts = data.base64.split(',');
  const mime  = parts[0].split(';')[0].replace('data:', '');
  const blob  = Utilities.newBlob(Utilities.base64Decode(parts[1]), mime, data.name || 'file');

  const root = getOrCreateFolder(null, PHOTO_FOLDER);
  let target;

  if (data.type === 'space') {
    const sub = getOrCreateFolder(root, '신청서_사진');
    target = getOrCreateFolder(sub, sanitizeName(data.company || '미분류'));

  } else if (data.type === 'equipment' || data.type === 'pkg') {
    const sub = getOrCreateFolder(root, '장비_사진');
    target = getOrCreateFolder(sub, sanitizeName(data.eqName || '미분류'));

  } else if (data.type === 'product') {
    const sub = getOrCreateFolder(root, '제품_사진');
    target = getOrCreateFolder(sub, sanitizeName(data.company || '미분류'));

  } else if (data.type === 'quote') {
    const sub = getOrCreateFolder(root, '견적서');
    target = getOrCreateFolder(sub, sanitizeName(data.company || '미분류'));

  } else {
    target = root;
  }

  const file = target.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const fileId = file.getId();
  return { ok:true, url: 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w600' };
}
