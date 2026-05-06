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
// T1-3: pdfHash/equipPdfHash 추가 — Drive 재업로드 스킵 판정용 (자동 마이그레이션)
const QT_COLS  = ['id','company','appId','process','memo','validUntil',
                  'items','total','eqCount','status','date','pdfUrl','equipPdfUrl',
                  'pdfHash','equipPdfHash'];

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

      case 'uploadPhoto':         result = uploadPhoto(data); break;
      case 'getPhotoBase64':      result = getPhotoBase64(data); break;
      case 'getPhotosBase64Bulk': result = getPhotosBase64Bulk(data); break;

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

// date 컬럼이 있으면 해당 셀을 plain text 포맷으로 (Sheets가 'YYYY-MM-DD HH:MM' 을 datetime 으로 자동 변환해 시간 잘라내는 현상 방지)
function _forceTextFormatForDate(sheet, rowIdx, cols) {
  const dateIdx = cols.indexOf('date');
  if (dateIdx < 0) return;
  try { sheet.getRange(rowIdx, dateIdx + 1).setNumberFormat('@'); } catch (e) {}
}

function appendRow(sheetName, cols, arrCols, obj) {
  const sheet = getSheet(sheetName);
  ensureHeader(sheet, cols);
  const newRow = sheet.getLastRow() + 1;
  _forceTextFormatForDate(sheet, newRow, cols);
  sheet.appendRow(serializeRow(cols, arrCols, obj));
  return { ok:true };
}

function updateRow(sheetName, cols, arrCols, obj, keyCol) {
  const sheet  = getSheet(sheetName);
  const data   = sheet.getDataRange().getValues();
  const keyIdx = cols.indexOf(keyCol);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][keyIdx]) === String(obj[keyCol])) {
      _forceTextFormatForDate(sheet, i + 1, cols);
      sheet.getRange(i+1, 1, 1, cols.length).setValues([serializeRow(cols, arrCols, obj)]);
      return { ok:true };
    }
  }
  // 없으면 추가
  const newRow = sheet.getLastRow() + 1;
  _forceTextFormatForDate(sheet, newRow, cols);
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
