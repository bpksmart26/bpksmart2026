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

// ─────────────────────────────────────────────────────────────
// OpenAI gpt-4o-mini 호출 — 동영상 스크립트 생성
// ─────────────────────────────────────────────────────────────
const GUIDE_SYSTEM_PROMPT = [
  '당신은 한국 소공인 스마트제조 지원사업 신청자의 동영상 촬영 대본 작가입니다.',
  '아래 회사 정보를 바탕으로 동영상 스크립트 5개 PART를 작성하세요.',
  '',
  '【출력 형식】',
  '반드시 다음 마크다운 형식으로만 응답하세요. 다른 텍스트 금지:',
  '',
  '## PART 1 · 자기소개 및 필수 문구 (10초)',
  '<3~5문장 구어체>',
  '',
  '## PART 2 · 대표 제품 및 공정 소개 (15초)',
  '<3~5문장 구어체>',
  '',
  '## PART 3 · 현 공정의 문제점 및 도입 장비 (30초)',
  '<3~5문장 구어체>',
  '',
  '## PART 4 · 설치 장소 및 기대효과 (20초)',
  '<3~5문장 구어체>',
  '',
  '## PART 5 · 간단한 마무리 (5초)',
  '<3~5문장 구어체>',
  '',
  '【작성 지침】',
  '- 모든 문장은 자연스러운 구어체로 작성',
  '- PART 1 마지막에 반드시 다음 문구를 그대로 포함: "부정수급을 하지 않을 것이며, 부정수급 발생 시 보조금 환수 및 제재처분에 동의합니다."',
  '- PART 3에서 도입 장비명은 input.items의 name/model을 그대로 사용 (대체 표현 금지)',
  '- input.memo가 비어있지 않으면 PART 3의 어조와 디테일에 반영',
  '- 가격/금액 정보는 절대 노출 금지',
  '- 회사명·대표명·제품명은 input의 값을 그대로 사용'
].join('\n');

function callOpenAI(promptInput) {
  const apiKey = _guideProp(GUIDE_PROP_KEYS.OPENAI_API_KEY);
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const payload = {
    model: 'gpt-4o-mini',
    temperature: 0.7,
    messages: [
      { role: 'system', content: GUIDE_SYSTEM_PROMPT },
      { role: 'user',   content: JSON.stringify(promptInput, null, 2) }
    ]
  };

  const res = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code !== 200) {
    throw new Error('OpenAI HTTP ' + code + ': ' + body);
  }

  const json = JSON.parse(body);
  const text = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
  if (!text) throw new Error('OpenAI 응답에 content 없음');
  return text;
}

function _test_callOpenAI() {
  const out = callOpenAI({
    company: '테스트회사',
    ceo: '홍길동',
    pname: '떡볶이 분말',
    processes: ['계량','혼합','충진','포장'],
    problem_type: '공정자동화',
    problem_points: ['생산속도','수작업부담'],
    memo: '주문량이 늘어나면 손이 부족해서 야근이 많습니다.',
    items: [{ name: '스틱포장기', model: 'SP-200', qty: 1 }],
    space_w: '3000',
    space_h: '2500'
  });
  Logger.log(out);
}

// ─────────────────────────────────────────────────────────────
// GPT 응답 마크다운 → { part1, part2, ..., part5 }
// ## PART N 헤더 단위로 split
// ─────────────────────────────────────────────────────────────
function parseScript(markdown) {
  // 코드펜스 방어 — GPT가 가끔 ```markdown...``` 으로 감싸 응답
  if (typeof markdown === 'string') {
    markdown = markdown
      .replace(/^\s*```[a-z]*\s*\n?/i, '')
      .replace(/\n?```\s*$/, '');
  }
  const result = { part1:'', part2:'', part3:'', part4:'', part5:'' };
  // 헤더 정규식: ## PART <number> [...]
  const re = /##\s*PART\s*(\d)[^\n]*\n([\s\S]*?)(?=\n##\s*PART\s*\d|\s*$)/gi;
  let m;
  while ((m = re.exec(markdown)) !== null) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= 5) {
      result['part' + n] = m[2].trim();
    }
  }
  // 검증 — 5개 모두 채워졌는지
  for (let i = 1; i <= 5; i++) {
    if (!result['part' + i]) {
      throw new Error('PART ' + i + ' 파싱 실패. raw 응답:\n' + markdown);
    }
  }
  return result;
}

function _test_parseScript() {
  const md = '## PART 1 · 자기소개 (10초)\n안녕하세요.\n첫번째 본문.\n\n' +
             '## PART 2 · 제품소개 (15초)\n두번째.\n\n' +
             '## PART 3 · 문제점 (30초)\n세번째.\n\n' +
             '## PART 4 · 효과 (20초)\n네번째.\n\n' +
             '## PART 5 · 마무리 (5초)\n다섯번째.';
  const out = parseScript(md);
  Logger.log(JSON.stringify(out, null, 2));
}

// ─────────────────────────────────────────────────────────────
// 템플릿 HTML + 5 PART 본문 → 회사별 메일 HTML
// 각 <!-- PART N --> 블록 안의 본문 <td> 첫 인스턴스만 치환
// ─────────────────────────────────────────────────────────────
function mergeTemplate(templateHtml, parts) {
  let html = templateHtml;
  for (let i = 1; i <= 5; i++) {
    const marker = '<!-- PART ' + i + ' -->';
    const idx = html.indexOf(marker);
    if (idx === -1) throw new Error('템플릿에 ' + marker + ' 없음');

    // marker 뒤 본문 <td> 첫 인스턴스를 찾음
    // 본문 <td>는 padding:18px 22px (헤더 td는 padding:12px 18px)
    const bodyTdRe = /<td[^>]*padding:18px 22px[^>]*>([\s\S]*?)<\/td>/i;
    const tail = html.substring(idx);
    const tailMatch = tail.match(bodyTdRe);
    if (!tailMatch) throw new Error('PART ' + i + ' 본문 td 못 찾음');

    // split/join 사용 — String.replace(string, string)은 $ 토큰을 해석하므로
    // 사용자 입력에 $&, $$, $1 등이 있으면 출력이 깨짐
    const newBody = _formatPartHtml(parts['part' + i]);
    const fullTd = tailMatch[0];
    const innerBody = tailMatch[1];
    const newFullTd = fullTd.split(innerBody).join(newBody);
    const newTail = tail.split(fullTd).join(newFullTd);
    html = html.substring(0, idx) + newTail;
  }
  return html;
}

// PART 본문 텍스트 → HTML (줄바꿈 <br>, 따옴표 보존, 굵게는 마크다운 ** 변환)
function _formatPartHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '<br>');
}

function _test_mergeTemplate() {
  const tpl = getDriveTemplate();
  const parts = {
    part1: '안녕하세요. ㈜테스트 대표 홍길동입니다.\n부정수급을 하지 않을 것이며...',
    part2: '저희는 떡볶이 분말을 생산하고 있습니다.',
    part3: '현재 수작업으로 ... 이번에 도입할 **스틱포장기 SP-200**은 ...',
    part4: '이 공간에 설치할 예정이며 효과는 ...',
    part5: '감사합니다.'
  };
  const html = mergeTemplate(tpl, parts);
  // Drive에 임시 저장해서 브라우저로 시각 확인
  const folderId = _guideProp(GUIDE_PROP_KEYS.DRIVE_FOLDER_ID);
  const file = DriveApp.getFolderById(folderId).createFile('_test_merge.html', html, 'text/html');
  Logger.log('테스트 파일: ' + file.getUrl());
}

// ─────────────────────────────────────────────────────────────
// 합성된 HTML → Drive에 회사명_가이드메일_YYYYMMDD-HHmm_v{N}.html 저장
// ─────────────────────────────────────────────────────────────
function saveGuideToDrive(html, company, version) {
  const folderId = _guideProp(GUIDE_PROP_KEYS.DRIVE_FOLDER_ID);
  if (!folderId) throw new Error('GUIDE_DRIVE_FOLDER_ID not set');

  const safeName = String(company || 'unknown').replace(/[\/\\:?*"<>|]+/g, '_').trim();
  const ts = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMdd-HHmm');
  const filename = safeName + '_가이드메일_' + ts + '_v' + version + '.html';

  const file = DriveApp.getFolderById(folderId)
    .createFile(filename, html, MimeType.HTML);

  // 누구나 링크로 읽기 가능 (메일에서 열 수 있도록)
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return {
    id: file.getId(),
    name: filename,
    url: file.getUrl()
  };
}

function _test_saveGuideToDrive() {
  const r = saveGuideToDrive('<html><body>테스트</body></html>', '㈜테스트회사', 1);
  Logger.log(JSON.stringify(r, null, 2));
}

// ─────────────────────────────────────────────────────────────
// 통합정보 시트 1행의 일부 컬럼만 업데이트 (id 매칭)
// fields: { guide_script: '...', guide_sent_at: '...' } 형태
// ─────────────────────────────────────────────────────────────
function updateUnifiedRowFields(unifiedId, fields) {
  const sheet = getSheet(SN.UNIFIED);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('통합정보 시트가 비어있음');

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idCol = headers.indexOf('id') + 1;
  if (idCol === 0) throw new Error('통합정보 시트에 id 컬럼 없음');

  // id 매칭 행 찾기
  const idValues = sheet.getRange(2, idCol, lastRow - 1, 1).getValues();
  let rowIdx = -1;
  for (let i = 0; i < idValues.length; i++) {
    if (String(idValues[i][0]) === String(unifiedId)) {
      rowIdx = i + 2;
      break;
    }
  }
  if (rowIdx === -1) throw new Error('id=' + unifiedId + ' 행 없음');

  // 각 필드 업데이트
  Object.keys(fields).forEach(function(key) {
    const col = headers.indexOf(key) + 1;
    if (col === 0) {
      Logger.log('[updateUnifiedRowFields] 컬럼 없음: ' + key + ' (skip)');
      return;
    }
    sheet.getRange(rowIdx, col).setValue(fields[key]);
  });
}
