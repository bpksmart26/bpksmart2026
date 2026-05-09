// ============================================================
// BPK Smart 2026 — 동영상 가이드 메일 자동 생성·발송
// Code.gs와 NotionSync.gs와 같은 글로벌 네임스페이스 공유
// ============================================================

// 가이드 발송 상태 (한글 — 시트와 노션 Select 옵션 둘 다 이 값 사용)
const GUIDE_STATUS = {
  PENDING: '대기중',
  SENT:    '발송완료',
  FAILED:  '발송실패'
};

// PropertiesService 키 (Phase 0.4에서 셋업)
const GUIDE_PROP_KEYS = {
  OPENAI_API_KEY:    'OPENAI_API_KEY',
  MAILER_WEBAPP_URL: 'MAILER_WEBAPP_URL',
  MAILER_TOKEN:      'MAILER_TOKEN',
  MAKE_TOKEN:        'MAKE_TOKEN',
  DRIVE_FOLDER_ID:   'GUIDE_DRIVE_FOLDER_ID',
  TEMPLATE_FILE_ID:  'GUIDE_TEMPLATE_FILE_ID'
};

// 캐시 TTL — Drive 템플릿 파일 캐시
const GUIDE_TEMPLATE_CACHE_KEY = 'guide_template_html_v1';
const GUIDE_TEMPLATE_CACHE_SEC = 300;

function _guideProp(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

// ─────────────────────────────────────────────────────────────
// _template.html 로드 — Drive 파일 ID 기반, 5분 캐시
// ─────────────────────────────────────────────────────────────
function getDriveTemplate() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(GUIDE_TEMPLATE_CACHE_KEY);
  if (cached) return cached;

  const fileId = _guideProp(GUIDE_PROP_KEYS.TEMPLATE_FILE_ID);
  if (!fileId) throw new Error('GUIDE_TEMPLATE_FILE_ID not set in PropertiesService');

  const html = DriveApp.getFileById(fileId).getBlob().getDataAsString('UTF-8');
  if (!html || html.indexOf('<!-- PART 1 -->') === -1) {
    throw new Error('Template missing PART markers (PART 1~5)');
  }

  cache.put(GUIDE_TEMPLATE_CACHE_KEY, html, GUIDE_TEMPLATE_CACHE_SEC);
  return html;
}

// 테스트용 — 에디터에서 실행
function _test_getDriveTemplate() {
  const html = getDriveTemplate();
  Logger.log('템플릿 길이: ' + html.length);
  Logger.log('PART 1 마커 존재: ' + (html.indexOf('<!-- PART 1 -->') !== -1));
  Logger.log('PART 5 마커 존재: ' + (html.indexOf('<!-- PART 5 -->') !== -1));
}
