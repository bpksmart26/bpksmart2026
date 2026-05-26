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

const SN = { EQ:'장비', APP:'신청', QT:'견적', CFG:'설정', UNIFIED:'통합정보', QUEUE:'_sync_queue', AQ:'신청용견적' };

// 신청용견적 시트 컬럼 — 업체당 1행, 상세는 items_json에 압축
const AQ_COLS = ['company','totalAdj','totalSubsidy','totalSelfPay','items_json','confirmedAt'];

// 신청용견적 메일 본문 템플릿 — Drive 파일 ID 기반, 5분 캐시
// v3: 본문 템플릿 파일 교체 → 캐시키 v2→v3 로 강제 무효화
const APP_QUOTE_TEMPLATE_FILE_ID  = '15GJPaxxkJxqcRPnQm7ihaiymoYAFJREN';
const APP_QUOTE_TEMPLATE_CACHE_KEY = 'app_quote_template_html_v3';
const APP_QUOTE_TEMPLATE_CACHE_SEC = 300;

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

// 통합정보 시트 — 신청 28 + 견적 16 + 가이드 8 (company/appId 제외, 충돌 컬럼은 quote* prefix)
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
  'pdfHash','equipPdfHash','version','isLatest',
  // 가이드 (8) — Phase 1 추가
  'guide_script','guide_generated_at','guide_html_url','guide_version',
  'guide_send_request','guide_sent_at','guide_sent_status','guide_error',
  // 가이드 멱등성 키 (Phase 2) — 마지막으로 발송 완료된 guide_version
  'guide_sent_version'
];

const UNIFIED_ARR = [
  'processes','pkgtypes','problem_points','equipment','electric',
  'space_photos','product_photos','items','options'
];

const UNIFIED_NUM = { total:'number', eqCount:'number', version:'number', guide_version:'number', guide_sent_version:'number' };

const UNIFIED_BOOL = { guide_send_request:'boolean' };

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
  try { autoInitSheets(); } catch(err) { Logger.log('[doPost] autoInitSheets 실패: ' + err); }

  try {
    const payload = JSON.parse(e.postData.contents);
    const { action, data } = payload;
    let result;

    switch (action) {
      case 'ping':        result = { ok:true, msg:'연결 성공', ts: new Date().toISOString() }; break;
      case 'auth':        result = checkAuth(data); break;

      case 'getEq':       result = { ok:true, data: getRows(SN.EQ,  EQ_COLS,  EQ_ARR,  {id:'number',price:'number'}) }; break;
      case 'upsertEq':    result = upsertEqWithIdGuard(data); break;
      case 'deleteEq':    result = deleteRow(SN.EQ,  'id', data.id); break;
      case 'bulkSaveEq':  result = bulkSave(SN.EQ,   EQ_COLS,  EQ_ARR,  data); break;

      case 'getApps':     result = { ok:true, data: getRows(SN.APP, APP_COLS, APP_ARR) }; break;
      case 'saveApp':
        Logger.log('[saveApp] entered. id=' + data.id + ', bizno=' + data.bizno + ', company=' + data.company);
        // P1-G1: 클라이언트 random ID 충돌 가드 + 시트 쓰기를 한 lock 안에서 atomic 하게
        result = saveAppWithIdGuard(data);
        if (result && result.ok) {
          // P1-G2: 후크 실패 시 _sync_queue 적재 + result.warnings 누적
          _safeSync('upsertUnified after saveApp', function() {
            var r = upsertUnified(data);
            Logger.log('[saveApp] upsertUnified result: ' + JSON.stringify(r));
          }, { action: 'upsertUnified', payload: { app: data } }, result);
          _safeSync('pushToNotion after saveApp', function() {
            var row = _loadUnifiedByBizno(data.bizno);
            if (row) {
              var r = pushToNotion(row);
              Logger.log('[saveApp] pushToNotion result: ' + JSON.stringify(r));
            }
          }, { action: 'pushToNotion', payload: { bizno: data.bizno } }, result);
        }
        break;
      case 'updateApp':
        result = updateRow(SN.APP,  APP_COLS, APP_ARR, data, 'id');
        if (result && result.ok) {
          // P1-G2: 후크 실패 시 _sync_queue 적재 + result.warnings 누적
          _safeSync('upsertUnified after updateApp', function() {
            upsertUnified(data);
          }, { action: 'upsertUnified', payload: { app: data } }, result);
          _safeSync('pushToNotion after updateApp', function() {
            var row = _loadUnifiedByBizno(data.bizno);
            if (row) pushToNotion(row);
          }, { action: 'pushToNotion', payload: { bizno: data.bizno } }, result);
        }
        break;

      case 'getQts':      result = { ok:true, data: getRows(SN.QT,  QT_COLS,  QT_ARR,  {total:'number',eqCount:'number'}) }; break;
      case 'saveQt':
        Logger.log('[saveQt] entered. appId=' + data.appId + ', items=' + ((data.items||[]).length) + ', total=' + data.total);
        result = saveQuoteWithVersion(data);
        Logger.log('[saveQt] saveQuoteWithVersion done: ' + JSON.stringify(result));
        if (result && result.ok) {
          // P1-G2: 후크 실패 시 _sync_queue 적재 + result.warnings 누적
          _safeSync('upsertUnified after saveQt', function() {
            var app = _findApp(data.appId);
            Logger.log('[saveQt] _findApp(' + data.appId + ') → ' + (app ? 'found bizno=' + app.bizno : 'NULL'));
            if (app) {
              var r = upsertUnified(app, data);
              Logger.log('[saveQt] upsertUnified result: ' + JSON.stringify(r));
            }
          }, { action: 'upsertUnified', payload: { appId: data.appId, quote: data } }, result);
          _safeSync('pushToNotion after saveQt', function() {
            var app = _findApp(data.appId);
            if (app) {
              var row = _loadUnifiedByBizno(app.bizno);
              Logger.log('[saveQt] _loadUnifiedByBizno(' + app.bizno + ') → ' + (row ? 'found id=' + row.id : 'NULL'));
              if (row) {
                var r = pushToNotion(row);
                Logger.log('[saveQt] pushToNotion result: ' + JSON.stringify(r));
              }
            }
          }, null, result);
        }
        break;
      case 'updateQt':
        result = updateRow(SN.QT,   QT_COLS,  QT_ARR,  data, 'id');
        if (result && result.ok) {
          // P1-G2: 후크 실패 시 _sync_queue 적재 + result.warnings 누적
          _safeSync('upsertUnified after updateQt', function() {
            var app = _findApp(data.appId);
            if (app) upsertUnified(app, data);
          }, { action: 'upsertUnified', payload: { appId: data.appId, quote: data } }, result);
          _safeSync('pushToNotion after updateQt', function() {
            var app = _findApp(data.appId);
            if (app) {
              var row = _loadUnifiedByBizno(app.bizno);
              if (row) pushToNotion(row);
            }
          }, null, result);
        }
        _safeSync('generateGuide after updateQt', function() {
          // [C] 두 PDF 중 하나라도 없는 updateQt(임시저장 등)는 빠르게 skip
          if (!data.pdfUrl && !data.equipPdfUrl) return;
          var app = _findApp(data.appId);
          if (!app) return;
          var row = _loadUnifiedByBizno(app.bizno);
          if (!row) return;

          // 멱등성 — 같은 견적 버전에 대해 중복 실행 방지
          var quoteVersion = parseInt(data.version, 10) || 0;
          var guideVersion = parseInt(row.guide_version, 10) || 0;
          if (quoteVersion > 0 && quoteVersion <= guideVersion) {
            Logger.log('[updateQt] generateGuide skip — quote v' + quoteVersion + ' 이미 가이드 v' + guideVersion + ' 생성됨');
            return;
          }

          // [C] 두 PDF가 통합시트에 모두 있을 때만 generateGuide 실행
          // genPDF 1차 syncQt → row.equipPdfUrl 없음 → skip (대기)
          // genEquipPDF 2차 syncQt → 둘 다 있음 → 실행
          if (!row.pdfUrl || !row.equipPdfUrl) {
            // [Layer 2] 견적PDF는 있는데 장비PDF만 없는 경우 → BLOCKED 상태 시트에 기록
            if (row.pdfUrl && !row.equipPdfUrl) {
              Logger.log('[updateQt] generateGuide BLOCKED — 장비사양PDF 없음 id=' + row.id);
              var missing = [];
              if (!row.pdfUrl) missing.push('견적서PDF');
              if (!row.equipPdfUrl) missing.push('장비사양PDF');
              updateUnifiedRowFields(row.id, {
                guide_sent_status: GUIDE_STATUS.BLOCKED,
                guide_error: missing.join(', ') + ' 없음 — 장비사양서 재발급 시 자동 복구됩니다'
              });
              var notionRow = _loadUnifiedByBizno(app.bizno);
              if (notionRow) pushToNotion(notionRow);
            }
            return;
          }

          Logger.log('[updateQt] generateGuide row id=' + row.id + ', quoteVer=' + quoteVersion + ', guideVer=' + guideVersion);
          var r = generateGuide(row);
          Logger.log('[updateQt] generateGuide result: ' + JSON.stringify(r));
          if (r.ok) {
            var freshRow = _loadUnifiedByBizno(app.bizno);
            if (freshRow) pushToNotion(freshRow);
          }
        }, null, result);
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

      case 'sendGuideNow':
        Logger.log('[sendGuideNow] entered. id=' + (data && data.id));
        result = sendGuideNow(data);
        Logger.log('[sendGuideNow] result: ' + JSON.stringify(result));
        break;

      case 'syncNotionNow':
        Logger.log('[syncNotionNow] entered');
        result = syncFromNotion();
        Logger.log('[syncNotionNow] result: ' + JSON.stringify(result));
        break;

      case 'getAppQuotes':       result = getAppQuotes(); break;
      case 'saveAppQuote':       result = saveAppQuote(data); break;
      case 'sendQuoteConfirmMail': result = sendQuoteConfirmMail(data); break;  // 공급기업_관리.html 견적서 발급 후
      case 'sendSubsidyGuideMail': result = sendSubsidyGuideMail(data); break; // subsidy.html 확정&메일발송

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
    [SN.UNIFIED, UNIFIED_COLS], [SN.QUEUE, QUEUE_COLS], [SN.AQ, AQ_COLS]
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
        // P4-G9: 콤마 포함 숫자 안전 처리
        obj[col] = _parseMoney(val);
      } else if (val instanceof Date) {
        // P5-cleanup: 시간 portion 항상 포함 — 정확히 00:00:00 인 경우에도 정렬 일관성 유지
        // (이전엔 자정이면 시간 정보 누락 → 같은 날 다른 시각의 행과 정렬이 어긋남)
        obj[col] = `${val.getFullYear()}-${pad(val.getMonth()+1)}-${pad(val.getDate())} ${pad(val.getHours())}:${pad(val.getMinutes())}`;
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
    if (arrCols && arrCols.includes(col)) {
      const v = obj[col];
      // 빈 배열/null/undefined는 빈 셀로 (시트 가독성)
      if (!v || (Array.isArray(v) && v.length === 0)) return '';
      return JSON.stringify(v);
    }
    const raw = obj[col];
    if (raw === undefined || raw === null) return '';
    // P4-G9: 수식 인젝션 방지 — '=', '+', '@' 로 시작하는 문자열은 ' prefix 로 plain text 강제
    // (음수 '-' 는 제외해 정상 음수 입력은 그대로 보존)
    if (typeof raw === 'string' && raw.length > 0 && /^[=+@]/.test(raw)) {
      return "'" + raw;
    }
    return raw;
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
  // P1-G1: 동시 append 시 getLastRow()+1 race 방지
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return { ok:false, error:'시트 락 대기 timeout — 잠시 후 다시 시도해 주세요' }; }
  try {
    const sheet = getSheet(sheetName);
    ensureHeader(sheet, cols);
    const values = serializeRow(cols, arrCols, obj);
    const newRow = sheet.getLastRow() + 1;
    // 먼저 setValues 로 행 전체 작성 (appendRow 는 자동 파싱 가능성 있음)
    sheet.getRange(newRow, 1, 1, values.length).setValues([values]);
    // date 셀은 text 포맷 + 값 재작성으로 시간 보존 강제
    _enforceTextDate(sheet, newRow, cols, obj);
    return { ok:true };
  } finally {
    try { lock.releaseLock(); } catch(e) {}
  }
}

function updateRow(sheetName, cols, arrCols, obj, keyCol) {
  // P1-G1: 행 찾기와 setValues 사이의 race 방지
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return { ok:false, error:'시트 락 대기 timeout — 잠시 후 다시 시도해 주세요' }; }
  try {
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
  } finally {
    try { lock.releaseLock(); } catch(e) {}
  }
}

// 일회성 마이그레이션: 견적 시트의 date 컬럼 전체를 text 포맷으로 + Date 객체를 'YYYY-MM-DD HH:MM' 문자열로 변환
// Apps Script 에디터 함수 드롭다운에서 직접 실행 (▶️ 버튼)
function migrateQtDateColumn() {
  // P5-G13: 마이그레이션 도중 동시 신청·견적이 잘못 처리되는 race 차단
  const _migLock = LockService.getDocumentLock();
  try { _migLock.waitLock(30000); }
  catch (e) { return Logger.log('migrateQtDateColumn lock 대기 timeout — 다른 작업 진행 중'); }
  try {
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
  } finally {
    try { _migLock.releaseLock(); } catch (e) {}
  }
}

// ============================================================
// 신청 contentHash 마이그레이션 (Apps Script 에디터에서 1회 실행)
// 기존 신청 행 중 contentHash 가 비어있는 것을 채움
// ============================================================
function migrateAppContentHash() {
  // P5-G13: 마이그레이션 도중 동시 신청 race 차단
  const _migLock = LockService.getDocumentLock();
  try { _migLock.waitLock(30000); }
  catch (e) { return Logger.log('migrateAppContentHash lock 대기 timeout — 다른 작업 진행 중'); }
  try {
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
  } finally {
    try { _migLock.releaseLock(); } catch (e) {}
  }
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
  // P2-G6: idempotency cache hit → 이전 결과 즉시 반환 (5분 TTL)
  // 견적 발급 더블 클릭 / 네트워크 실패 후 retry 시 중복 견적 행 생성 방지
  const idemKey = data && data._idemKey;
  const cached = _idemCacheGet('saveQt', idemKey);
  if (cached) {
    Logger.log('[saveQuoteWithVersion] idem cache hit: ' + idemKey + ' → id=' + cached.id + ' v=' + cached.version);
    return cached;
  }

  // P1-G4: appId 가 실재하는 신청을 가리키는지 사전 검증
  // 운영자가 client-side readonly 를 우회해 영수증번호를 수정하거나, 외부 호출로 임의 appId 를
  // 보낼 경우 orphan 견적 / 다른 신청자에 대한 견적 attach 를 차단
  // updateQt 는 이 검증을 적용하지 않음 — 기존 orphan 견적의 PDF URL 갱신 등 후속 수정 허용
  if (!data || !data.appId) {
    return { ok:false, error:'영수증번호(appId)가 누락되었습니다' };
  }
  const targetApp = _findApp(data.appId);
  if (!targetApp) {
    Logger.log('[saveQuoteWithVersion] 거부 — appId 없음: ' + data.appId);
    return { ok:false, error:'해당 신청을 찾을 수 없습니다 (영수증번호=' + data.appId + '). 신청 등록 여부를 확인해 주세요.' };
  }

  const sheet = getSheet(SN.QT);
  ensureHeader(sheet, QT_COLS);
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return { ok:false, error:'동시 저장 충돌' }; }
  try {
    const all = sheet.getDataRange().getValues();
    const idxId     = QT_COLS.indexOf('id');
    const idxAppId  = QT_COLS.indexOf('appId');
    const idxVer    = QT_COLS.indexOf('version');
    const idxLatest = QT_COLS.indexOf('isLatest');

    // ── ID 충돌 가드 — 클라이언트가 보낸 id 가 이미 존재하면 시트 내 max+1 로 재발급
    // (length+1 방식의 client id 가 _backgroundRefresh 지연·다중 디바이스에서 충돌 가능)
    const existingIds = new Set();
    let maxIdN = 0;
    const ID_RE = /^(QT-\d+-)(\d+)$/;
    let idPrefix = 'QT-2026-';
    for (let i = 1; i < all.length; i++) {
      const id = String(all[i][idxId] || '');
      if (!id) continue;
      existingIds.add(id);
      const m = id.match(ID_RE);
      if (m) {
        idPrefix = m[1];
        const n = parseInt(m[2], 10);
        if (Number.isFinite(n) && n > maxIdN) maxIdN = n;
      }
    }
    const clientId = String(data.id || '');
    let idCollided = false;
    if (!clientId || existingIds.has(clientId)) {
      idCollided = !!clientId && existingIds.has(clientId);
      data.id = idPrefix + String(maxIdN + 1).padStart(3, '0');
      if (idCollided) Logger.log('[saveQuoteWithVersion] ID 충돌 → ' + clientId + ' → ' + data.id);
    }

    // 같은 appId 내 version / isLatest 정리
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
    // P2-G6: 멱등성 캐시 적재 + 클라이언트가 최종 id/version 으로 로컬 상태 갱신
    const result = { ok:true, id: data.id, version: data.version, isLatest:'1', idCollided: idCollided };
    _idemCachePut('saveQt', idemKey, result, 300);
    return result;
  } finally {
    try { lock.releaseLock(); } catch(e) {}
  }
}

// ============================================================
// bizno 정규화 헬퍼 (P5-G12)
// 비교/조인 키로 쓰이는 bizno 가 입력 형식 차이로 다른 키로 취급되는 문제 차단
// "275-88-01197", "27588011 97", "27588011-97" 모두 같은 사업자번호로 매칭되도록.
//
// 정책: 숫자만 추출. 10자리면 NNN-NN-NNNNN 형식으로 재포맷. 아니면 숫자 그대로 반환.
// ============================================================
function _normalizeBizno(b) {
  const digits = String(b || '').replace(/[^0-9]/g, '');
  if (digits.length === 10) {
    return digits.slice(0, 3) + '-' + digits.slice(3, 5) + '-' + digits.slice(5);
  }
  return digits;
}

// ============================================================
// 금액 파싱 헬퍼 (P4-G9)
// 콤마 포함 숫자 ("15,000,000") 자동 정규화 — Number() || 0 패턴의 silent zero 결함 해소.
// 사용처: getRows / _loadUnifiedByBizno 의 numeric 컬럼 변환
// 정책: 콤마만 strip, 그 외 비정상 입력은 0 으로 (이전 동작과 호환)
// ============================================================
function _parseMoney(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  // 콤마만 제거 (유로 점 단위는 한국 운영 시 가능성 낮으므로 보존 = 0 으로 떨어짐)
  const cleaned = String(v).replace(/,/g, '').trim();
  if (cleaned === '') return 0;
  const n = Number(cleaned);
  return isFinite(n) ? n : 0;
}

// ============================================================
// 멱등성 캐시 헬퍼 (P2-G6)
// CacheService.getScriptCache() = script project 단위 공유 캐시 (instance 간 공유 가능)
// 같은 _idemKey 의 호출이 5분 안에 다시 들어오면 이전 결과를 그대로 반환
// 더블 클릭 / 네트워크 실패 후 retry 시 중복 row · 중복 Drive 파일 방지
// ============================================================
function _idemCacheGet(scope, key) {
  if (!key) return null;
  try {
    var v = CacheService.getScriptCache().get(scope + ':' + key);
    return v ? JSON.parse(v) : null;
  } catch (e) { return null; }
}
function _idemCachePut(scope, key, value, ttlSec) {
  if (!key) return;
  try {
    CacheService.getScriptCache().put(scope + ':' + key, JSON.stringify(value), ttlSec || 300);
  } catch (e) {}
}

// ============================================================
// 신청 저장 + ID 충돌 가드 (P1-G1)
// 클라이언트가 보낸 NO-YYMMDD-XXXX 가 이미 시트에 존재하면 같은 prefix 안에서
// 다른 random seq 를 재발급. 100회 random 시도 실패 시 max+1 sequential fallback.
// 클라이언트는 응답의 r.id 로 영수증/로컬 상태를 갱신해야 함.
// ============================================================
function saveAppWithIdGuard(data) {
  // P2-G6: idempotency cache hit → 이전 결과 즉시 반환 (5분 TTL)
  const idemKey = data && data._idemKey;
  const cached = _idemCacheGet('saveApp', idemKey);
  if (cached) {
    Logger.log('[saveAppWithIdGuard] idem cache hit: ' + idemKey + ' → id=' + cached.id);
    return cached;
  }

  // P5-G12: bizno 정규화 — 입력 형식 차이로 조인 키 매칭 누락되는 문제 차단
  if (data && data.bizno) data.bizno = _normalizeBizno(data.bizno);

  const sheet = getSheet(SN.APP);
  ensureHeader(sheet, APP_COLS);
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return { ok:false, error:'동시 저장 충돌 — 잠시 후 다시 시도해 주세요' }; }
  try {
    const all = sheet.getDataRange().getValues();
    const idxId = APP_COLS.indexOf('id');

    // 기존 신청 ID 전부 수집
    const existingIds = new Set();
    for (let i = 1; i < all.length; i++) {
      const id = String(all[i][idxId] || '');
      if (id) existingIds.add(id);
    }

    // ── ID 충돌 가드
    // 클라이언트 ID 가 비어있거나 이미 존재하면 같은 날(prefix) 안에서 충돌 안 나는 ID 재발급
    const clientId = String(data.id || '');
    let idCollided = false;
    if (!clientId || existingIds.has(clientId)) {
      idCollided = !!clientId && existingIds.has(clientId);
      // prefix 추출: NO-YYMMDD- 형태. 클라이언트 ID 없으면 오늘 날짜로 생성
      const m = clientId.match(/^(NO-\d{6}-)/);
      let prefix;
      if (m) {
        prefix = m[1];
      } else {
        const tz = Session.getScriptTimeZone() || 'Asia/Seoul';
        prefix = 'NO-' + Utilities.formatDate(new Date(), tz, 'yyMMdd') + '-';
      }

      // 100회 random 시도 (9000 슬롯 대비 collision 확률 충분히 낮음)
      let candidate = null;
      for (let attempt = 0; attempt < 100; attempt++) {
        const seq = String(1000 + Math.floor(Math.random() * 9000));
        const c = prefix + seq;
        if (!existingIds.has(c)) { candidate = c; break; }
      }
      // fallback: 같은 prefix 안 max+1 (4자리 sequential)
      if (!candidate) {
        let max = 0;
        existingIds.forEach(function(id) {
          if (id.indexOf(prefix) === 0) {
            const n = parseInt(id.slice(prefix.length), 10);
            if (isFinite(n) && n > max) max = n;
          }
        });
        candidate = prefix + String(max + 1).padStart(4, '0');
      }

      if (idCollided) Logger.log('[saveAppWithIdGuard] ID 충돌 → ' + clientId + ' → ' + candidate);
      else Logger.log('[saveAppWithIdGuard] ID 미지정 → ' + candidate);
      data.id = candidate;
    }

    // 행 작성 (appendRow 와 동일 패턴, 같은 lock 안에서 inline)
    const values = serializeRow(APP_COLS, APP_ARR, data);
    const newRow = sheet.getLastRow() + 1;
    sheet.getRange(newRow, 1, 1, values.length).setValues([values]);
    _enforceTextDate(sheet, newRow, APP_COLS, data);
    SpreadsheetApp.flush();

    // P2-G6: 멱등성 캐시 적재 → 같은 _idemKey 재시도 시 위 cache hit 으로 즉시 반환
    const result = { ok:true, id: data.id, idCollided: idCollided };
    _idemCachePut('saveApp', idemKey, result, 300);
    return result;
  } finally {
    try { lock.releaseLock(); } catch(e) {}
  }
}

// ============================================================
// 장비 저장 + ID 충돌 가드 (P5-G11)
// data._isNew=true: 신규 장비 — 클라이언트가 보낸 id 가 이미 시트에 있으면 max+1 로 재발급
// data._isNew=false (또는 없음): 기존 장비 수정 — id 그대로 행 찾아 update
// 클라이언트는 응답의 r.id 로 로컬 상태 갱신
// ============================================================
function upsertEqWithIdGuard(data) {
  const sheet = getSheet(SN.EQ);
  ensureHeader(sheet, EQ_COLS);
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return { ok:false, error:'장비 저장 lock timeout' }; }
  try {
    const all = sheet.getDataRange().getValues();
    const idIdx = EQ_COLS.indexOf('id');

    // 기존 ID 수집
    const existingIds = new Set();
    let maxIdN = 0;
    for (let i = 1; i < all.length; i++) {
      const id = String(all[i][idIdx] || '');
      if (!id) continue;
      existingIds.add(id);
      const n = parseInt(id, 10);
      if (isFinite(n) && n > maxIdN) maxIdN = n;
    }

    const isNew = !!data._isNew;
    const clientId = String(data.id || '');
    let idCollided = false;

    if (isNew) {
      // 신규 — ID 충돌 검사 + 재발급
      if (clientId === '' || existingIds.has(clientId)) {
        idCollided = clientId !== '' && existingIds.has(clientId);
        data.id = maxIdN + 1;
        if (idCollided) Logger.log('[upsertEqWithIdGuard] ID 충돌 → ' + clientId + ' → ' + data.id);
      }
    }
    // 수정 — id 그대로 사용

    // 클라이언트 _isNew 플래그는 시트에 저장하지 않음 (serializeRow 는 EQ_COLS 기준이라 자동 제외)
    // 행 찾기 (id 기준)
    let targetRow = -1;
    for (let i = 1; i < all.length; i++) {
      if (String(all[i][idIdx]) === String(data.id)) { targetRow = i + 1; break; }
    }
    const action = targetRow > 0 ? 'updated' : 'inserted';
    if (targetRow === -1) targetRow = sheet.getLastRow() + 1;

    const values = serializeRow(EQ_COLS, EQ_ARR, data);
    sheet.getRange(targetRow, 1, 1, values.length).setValues([values]);
    SpreadsheetApp.flush();

    return { ok:true, id: data.id, idCollided: idCollided, action: action };
  } finally {
    try { lock.releaseLock(); } catch(e) {}
  }
}

// ============================================================
// 중복 견적 ID 진단·정리 — length+1 ID 충돌 픽스 잔재 데이터 클린업
//
// 사용:
//   _repairDuplicateQuoteIds()      → dry-run. 변경 없이 보고서만 출력
//   _repairDuplicateQuoteIds(true)  → 실제 정리. 중복된 ID 행 중 첫 행은
//                                      유지하고 나머지 행에 새 고유 ID 부여
//
// 주의:
//   - 첫 행(가장 위)을 원본으로 간주. 사용자 데이터가 이미 어느 쪽에
//     모여있는지 모를 수 있으므로 dry-run 결과를 먼저 검토할 것
//   - 행 자체는 삭제하지 않음 (id 만 변경) — PDF/Drive 링크와의 참조 유지
// ============================================================
function _repairDuplicateQuoteIds(applyChanges) {
  const dryRun = !applyChanges;  // 기본 dry-run, true 전달 시 실제 적용
  const sheet = getSheet(SN.QT);
  const all = sheet.getDataRange().getValues();
  if (all.length <= 1) { Logger.log('견적 데이터 없음'); return { ok:true, duplicates:[] }; }
  const idxId = QT_COLS.indexOf('id');

  // ID 별 행 인덱스 수집 + max 번호 파악
  const byId = {};
  let maxIdN = 0;
  let idPrefix = 'QT-2026-';
  const ID_RE = /^(QT-\d+-)(\d+)$/;
  for (let i = 1; i < all.length; i++) {
    const id = String(all[i][idxId] || '');
    if (!id) continue;
    if (!byId[id]) byId[id] = [];
    byId[id].push(i + 1);  // 1-based row index
    const m = id.match(ID_RE);
    if (m) {
      idPrefix = m[1];
      const n = parseInt(m[2], 10);
      if (Number.isFinite(n) && n > maxIdN) maxIdN = n;
    }
  }

  const duplicates = Object.keys(byId).filter(id => byId[id].length > 1);
  Logger.log('=== 견적 ID 중복 보고서 ===');
  Logger.log('총 행: ' + (all.length - 1) + ' / 고유 ID: ' + Object.keys(byId).length + ' / 중복 ID: ' + duplicates.length);
  if (!duplicates.length) {
    Logger.log('중복 없음 ✓');
    return { ok:true, duplicates:[] };
  }

  const changes = [];
  duplicates.forEach(dupId => {
    const rows = byId[dupId];
    Logger.log('• ' + dupId + ' → 행 ' + rows.join(', '));
    // 첫 행은 그대로, 나머지 행에 새 ID 발급
    for (let k = 1; k < rows.length; k++) {
      maxIdN++;
      const newId = idPrefix + String(maxIdN).padStart(3, '0');
      const rowIdx = rows[k];
      const oldRow = all[rowIdx - 1];
      const company = oldRow[QT_COLS.indexOf('company')] || '';
      const appId   = oldRow[QT_COLS.indexOf('appId')]   || '';
      Logger.log('    행 ' + rowIdx + ' (' + company + ' / ' + appId + ') → ' + newId);
      changes.push({ row: rowIdx, oldId: dupId, newId: newId });
    }
  });

  if (dryRun) {
    Logger.log('(dry-run — 변경 없음. 실제 적용은 _repairDuplicateQuoteIds(false))');
    return { ok:true, duplicates: duplicates, planned: changes };
  }

  // 실제 적용
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return { ok:false, error:'동시 저장 충돌' }; }
  try {
    changes.forEach(c => sheet.getRange(c.row, idxId + 1).setValue(c.newId));
    SpreadsheetApp.flush();
    Logger.log('정리 완료 — ' + changes.length + '개 행 id 변경');
    return { ok:true, repaired: changes.length, changes: changes };
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
  // P5-G13: 마이그레이션 도중 동시 견적 발급 race 차단
  const _migLock = LockService.getDocumentLock();
  try { _migLock.waitLock(30000); }
  catch (e) { return Logger.log('migrateQuoteVersions lock 대기 timeout — 다른 작업 진행 중'); }
  try {
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
  } finally {
    try { _migLock.releaseLock(); } catch (e) {}
  }
}

function upsertRow(sheetName, cols, arrCols, obj, keyCol) {
  // P1-G1: keyCol 매칭과 setValues/appendRow 사이의 race 방지
  // 두 디바이스에서 동일 keyCol 값으로 동시 upsert 시 silent overwrite 차단
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return { ok:false, error:'시트 락 대기 timeout — 잠시 후 다시 시도해 주세요' }; }
  try {
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
  } finally {
    try { lock.releaseLock(); } catch(e) {}
  }
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
  const bizno = String(data.bizno || '').trim();
  const phone = String(data.phone || '').trim();
  if (!company) return { ok:false, error:'company 누락' };

  // P3-G7: bizno + phone 인증 — 외부 무인증 IDOR 차단
  // 정상 클라이언트(신청기업_장비신청.html)는 조회 단계에서 이미 bizno/phone 입력했으므로 그대로 동봉
  if (!bizno || !phone) return { ok:false, error:'인증 정보 누락 (bizno, phone)' };
  const apps = getRows(SN.APP, APP_COLS, APP_ARR);
  const matchedApp = apps.find(function(a) {
    if (String(a.bizno) !== bizno) return false;
    if (String(a.phone) !== phone) return false;
    if (appId && String(a.id) !== appId) return false;
    return true;
  });
  if (!matchedApp) {
    Logger.log('[getLatestQuotePdf] 인증 실패 — company=' + company + ' appId=' + appId + ' bizno=' + bizno);
    return { ok:false, error:'인증 실패 — 회사/사업자번호/전화번호가 일치하지 않습니다' };
  }

  // P3-G7: 같은 bizno 의 모든 신청 ID — fallback 범위를 bizno 로 제한 (동명 회사 leak 차단)
  const biznoAppIds = apps.filter(function(a) { return String(a.bizno) === bizno; }).map(function(a) { return String(a.id); });

  // 폴더 탐색: BPK_Smart_Photos/견적서/
  const root = getOrCreateFolder(null, PHOTO_FOLDER);
  const subIter = root.getFoldersByName('견적서');
  if (!subIter.hasNext()) return { ok:false, error:'견적서 폴더 없음' };
  const sub = subIter.next();
  if (sub.isTrashed()) return { ok:false, error:'견적서 폴더가 휴지통에 있음' };

  // P3-G7: 새 폴더 패턴 '회사명_bizno숫자' 우선, legacy '회사명' fallback
  const biznoDigits = bizno.replace(/[^0-9]/g, '');
  const newFolderName = sanitizeName(company) + '_' + biznoDigits;
  const legacyFolderName = sanitizeName(company);
  let companyFolder = null;
  const tryNames = [newFolderName, legacyFolderName];
  for (let n = 0; n < tryNames.length && !companyFolder; n++) {
    const it = sub.getFoldersByName(tryNames[n]);
    while (it.hasNext()) {
      const f = it.next();
      if (!f.isTrashed()) { companyFolder = f; break; }
    }
  }
  if (!companyFolder) return { ok:false, error:'회사 폴더 없음: ' + newFolderName + ' / ' + legacyFolderName };

  // 파일 리스트 수집
  const files = [];           // appId 정확 매칭
  const biznoFiles = [];      // 같은 bizno 의 다른 appId 도 허용 (재신청 fallback)
  const biznoAppIdSet = {};
  biznoAppIds.forEach(function(id) { biznoAppIdSet[id] = true; });
  const fileIter = companyFolder.getFiles();
  while (fileIter.hasNext()) {
    const f = fileIter.next();
    if (f.isTrashed()) continue;
    const name = f.getName();
    if (name.indexOf('BPK_견적서_') !== 0) continue;
    const entry = { id: f.getId(), name: name, createdAt: f.getDateCreated().getTime() };
    if (appId && name.indexOf(appId) !== -1) files.push(entry);
    // bizno-scoped fallback: 파일명에 bizno 의 어느 appId 라도 포함
    let belongsToBizno = false;
    for (let k = 0; k < biznoAppIds.length; k++) {
      if (name.indexOf(biznoAppIds[k]) !== -1) { belongsToBizno = true; break; }
    }
    if (belongsToBizno) biznoFiles.push(entry);
  }

  if (!files.length && !biznoFiles.length) return { ok:false, error:'견적서 PDF 파일 없음' };

  // 정렬 (최신 우선)
  files.sort(function(a, b) { return b.createdAt - a.createdAt; });
  biznoFiles.sort(function(a, b) { return b.createdAt - a.createdAt; });

  // 보호 장치: 같은 bizno 안의 더 최근 PDF 가 있으면 그것 사용 (재신청 처리, 동명 회사 leak 없음)
  const latest = (biznoFiles.length > 0 && (!files.length || biznoFiles[0].createdAt > files[0].createdAt))
    ? biznoFiles[0]
    : files[0];
  const fallbackUsed = files.length > 0 && latest.id !== files[0].id;

  const result = {
    ok: true,
    fileId: latest.id,
    fileName: latest.name,
    downloadUrl: 'https://drive.google.com/uc?export=download&id=' + latest.id,
    viewUrl: 'https://drive.google.com/file/d/' + latest.id + '/view',
    totalMatched: files.length,
    totalCompanyFiles: biznoFiles.length,
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
  // P5-cleanup: trailing dot 제거 (Windows 호환성) + 기존 sanitize
  return String(name || '기타').replace(/[\\/:*?"<>|]/g, '_').replace(/\.+$/, '').trim() || '기타';
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
      // P3-G7: bizno 있으면 '회사명_bizno숫자' 폴더 사용 (동명 회사 disambiguation)
      // bizno 없으면 legacy '회사명' (구 호출자 호환)
      const biznoDigits = String(data.bizno || '').replace(/[^0-9]/g, '');
      const folderName = biznoDigits
        ? sanitizeName(data.company || '미분류') + '_' + biznoDigits
        : sanitizeName(data.company || '미분류');
      return getOrCreateFolder(sub, folderName);
    }
    return root;
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function uploadPhoto(data) {
  // P2-G6: idempotency cache hit → 이전 Drive URL 즉시 반환 (5분 TTL)
  // 같은 base64 재업로드 (retry / 더블 클릭) 시 Drive 중복 파일 생성 방지
  const idemKey = data && data._idemKey;
  const cached = _idemCacheGet('uploadPhoto', idemKey);
  if (cached) {
    Logger.log('[uploadPhoto] idem cache hit: ' + idemKey);
    return cached;
  }

  // 1) 폴더 결정 (lock 으로 직렬화 — 병렬 업로드 시 폴더 중복 생성 방지)
  const target = _resolveTargetFolder(data);

  // 2) 파일 업로드 (lock 밖 — 병렬 안전, 빠름)
  const parts = data.base64.split(',');
  const mime  = parts[0].split(';')[0].replace('data:', '');
  const blob  = Utilities.newBlob(Utilities.base64Decode(parts[1]), mime, data.name || 'file');
  const file = target.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const fileId = file.getId();
  const result = { ok:true, url: 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w600' };
  _idemCachePut('uploadPhoto', idemKey, result, 300);
  return result;
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

// ============================================================
// 신청용견적 관리 (신규 — 기존 시트 무수정)
// ============================================================

// 신청용견적 시트 전체 조회 — 업체당 1행
function getAppQuotes() {
  try {
    const sheet = getSpreadsheet().getSheetByName(SN.AQ);
    if (!sheet || sheet.getLastRow() <= 1) return { ok:true, data:[] };
    const rows = sheet.getDataRange().getValues();
    const header = rows[0];
    const data = rows.slice(1).map(function(row) {
      var obj = {};
      header.forEach(function(col, i) {
        var val = row[i];
        if (col === 'items_json') {
          try { obj[col] = JSON.parse(val || '[]'); } catch(e) { obj[col] = []; }
        } else if (col === 'totalAdj' || col === 'totalSubsidy' || col === 'totalSelfPay') {
          obj[col] = Number(val) || 0;
        } else {
          obj[col] = (val !== undefined && val !== null) ? String(val) : '';
        }
      });
      return obj;
    });
    return { ok:true, data:data };
  } catch(e) {
    return { ok:false, error: e.toString() };
  }
}

// 업체 확정 시 신청용견적 시트에 업체당 1행으로 기록 (덮어쓰기)
// data.company: 업체명
// data.rows: [{ name, model, origPrice, optionPrice, adjPrice, subsidyAmt, selfPayAmt }]
function saveAppQuote(data) {
  try {
    var company = String(data.company || '').trim();
    if (!company) return { ok:false, error:'company 누락' };
    var rows = Array.isArray(data.rows) ? data.rows : [];
    if (rows.length === 0) return { ok:false, error:'rows 누락' };

    var sheet = getSpreadsheet().getSheetByName(SN.AQ);
    if (!sheet) {
      sheet = getSpreadsheet().insertSheet(SN.AQ);
      sheet.appendRow(AQ_COLS);
    }

    var now = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');

    // 합계 계산
    var totalAdj      = rows.reduce(function(s,r){ return s + (Number(r.adjPrice)||0); }, 0);
    var totalSubsidy  = rows.reduce(function(s,r){ return s + (Number(r.subsidyAmt)||0); }, 0);
    var totalSelfPay  = rows.reduce(function(s,r){ return s + (Number(r.selfPayAmt)||0); }, 0);

    // 기존 행 삭제 (같은 업체명)
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      var compCol = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (var i = compCol.length - 1; i >= 0; i--) {
        if (String(compCol[i][0]).trim() === company) {
          sheet.deleteRow(i + 2);
        }
      }
    }

    // 업체당 1행 append
    sheet.appendRow([
      company,
      totalAdj,
      totalSubsidy,
      totalSelfPay,
      JSON.stringify(rows),
      now
    ]);

    return { ok:true };
  } catch(e) {
    return { ok:false, error: e.toString() };
  }
}

// ── 견적확정 메일 ── 공급기업_관리.html 견적서 발급 완료 후 호출
// data.to: 수신 이메일 (신청기업)
// data.company: 업체명
// data.pdfUrl: 견적서 PDF Drive URL
// data.equipPdfUrl: 장비사양서 PDF Drive URL
function sendQuoteConfirmMail(data) {
  try {
    var to          = String(data.to          || '').trim();
    var company     = String(data.company     || '').trim();
    var pdfUrl      = String(data.pdfUrl      || '').trim();
    var equipPdfUrl = String(data.equipPdfUrl || '').trim();
    if (!to)      return { ok:false, error:'to 누락' };
    if (!company) return { ok:false, error:'company 누락' };

    var html =
      '<div style="font-family:\'Apple SD Gothic Neo\',Malgun Gothic,sans-serif;max-width:600px;margin:0 auto">' +
      '<div style="background:#1d4ed8;border-radius:10px 10px 0 0;padding:28px 36px">' +
        '<p style="margin:0;color:#bfdbfe;font-size:11px;letter-spacing:2px;font-weight:700">BPK SMART 2026</p>' +
        '<h2 style="margin:8px 0 0;color:#ffffff;font-size:20px;font-weight:700">견적서 송부 및 동영상 촬영 가이드</h2>' +
      '</div>' +
      '<div style="background:#ffffff;padding:32px 36px;border:1px solid #e2e8f0;border-top:none">' +
        '<p style="margin:0 0 14px;color:#374151;font-size:14px;line-height:1.8">' + _aqEsc(company) + ' 담당자님, 안녕하세요.</p>' +
        '<p style="margin:0 0 14px;color:#374151;font-size:14px;line-height:1.8">' +
          '2026 스마트제조지원사업 견적서 및 장비사양서를 첨부하여 발송드립니다.<br>' +
          '첨부 파일을 확인하시어 검토해 주시기 바랍니다.' +
        '</p>' +
        '<p style="margin:0;color:#374151;font-size:14px">감사합니다.</p>' +
      '</div>' +
      '<div style="background:#f8fafc;border-radius:0 0 10px 10px;padding:16px 36px;border:1px solid #e2e8f0;border-top:none">' +
        '<p style="margin:0;color:#94a3b8;font-size:12px">주식회사 비피케이 | bpksmart26@gmail.com</p>' +
      '</div>' +
      '</div>';

    var attachments = [];

    // 견적서 PDF 첨부
    if (pdfUrl) {
      try {
        var pdfBlob  = DriveApp.getFileById(_extractDriveFileId(pdfUrl)).getBlob();
        var pdfBytes = pdfBlob.getBytes();
        if (pdfBytes.length <= 20 * 1024 * 1024) {
          attachments.push({ name: pdfBlob.getName() || '견적서.pdf', base64: Utilities.base64Encode(pdfBytes), mime: 'application/pdf' });
        }
      } catch(e) { Logger.log('[sendQuoteConfirmMail] 견적서 PDF 첨부 실패 (메일은 계속): ' + e); }
    }

    // 장비사양서 PDF 첨부
    if (equipPdfUrl) {
      try {
        var equipBlob  = DriveApp.getFileById(_extractDriveFileId(equipPdfUrl)).getBlob();
        var equipBytes = equipBlob.getBytes();
        if (equipBytes.length <= 20 * 1024 * 1024) {
          attachments.push({ name: equipBlob.getName() || '장비사양서.pdf', base64: Utilities.base64Encode(equipBytes), mime: 'application/pdf' });
        }
      } catch(e) { Logger.log('[sendQuoteConfirmMail] 장비사양서 PDF 첨부 실패 (메일은 계속): ' + e); }
    }

    var subject = '[BPK] 견적서 송부 및 동영상 촬영 가이드 - ' + company;
    callMailer({ to:to, subject:subject, html:html, attachments:attachments, cc:'choseonje@gmail.com' });
    return { ok:true };
  } catch(e) {
    return { ok:false, error: e.toString() };
  }
}

// ── 신청가이드 메일 ── subsidy.html 확정&메일발송 후 호출
// data.to: 수신 이메일 (신청기업)
// data.company: 업체명
function sendSubsidyGuideMail(data) {
  try {
    var to       = String(data.to      || '').trim();
    var company  = String(data.company || '').trim();
    var mailRows = Array.isArray(data.mailRows) ? data.mailRows : [];
    if (!to)      return { ok:false, error:'to 누락' };
    if (!company) return { ok:false, error:'company 누락' };

    // Drive 템플릿 로드 후 견적 행 렌더링
    var template = getAppQuoteTemplate();
    var trs = mailRows.map(function(r, i) {
      var label = _aqEsc(r.name  || '-');
      var model = _aqEsc(r.model || '-');
      var qty   = Number(r.qty   || 1);
      var gov   = Number(r.subsidy  || 0);
      var cash  = Number(r.selfPay  || 0);
      var tot   = gov + cash;
      return '<tr>' +
        '<td style="padding:11px 4px;font-size:12px;color:#2a3635;border-bottom:1px solid #d8dcd6;border-right:1px solid #d8dcd6;text-align:center;">'  + (i+1)  + '</td>' +
        '<td style="padding:11px 4px;font-size:12px;color:#2a3635;border-bottom:1px solid #d8dcd6;border-right:1px solid #d8dcd6;text-align:center;">구매</td>' +
        '<td style="padding:11px 8px;font-size:12px;color:#2a3635;border-bottom:1px solid #d8dcd6;border-right:1px solid #d8dcd6;text-align:left;">'   + label  + '</td>' +
        '<td style="padding:11px 8px;font-size:12px;color:#2a3635;border-bottom:1px solid #d8dcd6;border-right:1px solid #d8dcd6;text-align:left;">'   + model  + '</td>' +
        '<td style="padding:11px 4px;font-size:12px;color:#2a3635;border-bottom:1px solid #d8dcd6;border-right:1px solid #d8dcd6;text-align:center;">' + qty    + '</td>' +
        '<td style="padding:11px 6px;font-size:12px;color:#2a3635;border-bottom:1px solid #d8dcd6;border-right:1px solid #d8dcd6;text-align:right;">'  + _aqNum(gov)  + '</td>' +
        '<td style="padding:11px 6px;font-size:12px;color:#2a3635;border-bottom:1px solid #d8dcd6;border-right:1px solid #d8dcd6;text-align:right;">'  + _aqNum(cash) + '</td>' +
        '<td style="padding:11px 6px;font-size:12px;color:#2a3635;border-bottom:1px solid #d8dcd6;text-align:right;">'                                  + _aqNum(tot)  + '</td>' +
      '</tr>';
    }).join('');
    var html = template.split('{{EQUIPMENT_ROWS}}').join(trs);

    var attachments = [];

    // 사업신청 메뉴얼 PDF 첨부 (고정 파일)
    try {
      var manualBlob  = DriveApp.getFileById(GUIDE_MANUAL_DRIVE_FILE_ID).getBlob();
      var manualBytes = manualBlob.getBytes();
      if (manualBytes.length <= 20 * 1024 * 1024) {
        attachments.push({ name: '사업신청 메뉴얼.pdf', base64: Utilities.base64Encode(manualBytes), mime: 'application/pdf' });
      }
    } catch(e) { Logger.log('[sendSubsidyGuideMail] 메뉴얼 첨부 실패 (메일은 계속): ' + e); }

    var subject = '[BPK] 스마트제조지원사업 신청가이드-' + company;
    callMailer({ to:to, subject:subject, html:html, attachments:attachments, cc:'choseonje@gmail.com' });
    return { ok:true };
  } catch(e) {
    return { ok:false, error: e.toString() };
  }
}

// 신청용견적 메일 템플릿 — Drive 파일에서 로드 (5분 캐시)
function getAppQuoteTemplate() {
  var cache  = CacheService.getScriptCache();
  var cached = cache.get(APP_QUOTE_TEMPLATE_CACHE_KEY);
  if (cached) return cached;
  var html = DriveApp.getFileById(APP_QUOTE_TEMPLATE_FILE_ID).getBlob().getDataAsString('UTF-8');
  if (!html) throw new Error('신청용견적 메일 템플릿이 비어있습니다');
  if (html.indexOf('{{EQUIPMENT_ROWS}}') === -1) throw new Error('템플릿에 {{EQUIPMENT_ROWS}} 토큰이 없습니다');
  cache.put(APP_QUOTE_TEMPLATE_CACHE_KEY, html, APP_QUOTE_TEMPLATE_CACHE_SEC);
  return html;
}

// 템플릿 파일 교체 후 캐시 클리어 — GAS 에디터에서 직접 실행
function _clearAppQuoteTemplateCache() {
  CacheService.getScriptCache().remove(APP_QUOTE_TEMPLATE_CACHE_KEY);
  Logger.log('신청용견적 메일 템플릿 캐시 클리어 완료');
}

function _aqEsc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function _aqNum(n) {
  return Number(n||0).toLocaleString('ko-KR');
}
