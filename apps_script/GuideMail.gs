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
  if (!html) throw new Error('Template empty');
  // 5개 PART 마커 존재 확인 (주석 안에 추가 텍스트 허용 — 예: <!-- PART 3 (핵심) -->)
  for (let i = 1; i <= 5; i++) {
    const re = new RegExp('<!--\\s*PART\\s*' + i + '[^>]*?-->', 'i');
    if (!re.test(html)) {
      throw new Error('Template missing PART ' + i + ' marker');
    }
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

// ═════════════════════════════════════════════════════════════
// 프롬프트 튜닝 전용 테스트 함수
//
// 사용법:
//   1. 아래 [편집 영역 1] 의 TEST_SYSTEM_PROMPT 를 자유롭게 수정
//   2. 필요하면 [편집 영역 2] 의 TEST_INPUT 도 수정 (또는 시트에서 로드 사용)
//   3. Apps Script 에디터에서 _test_promptIteration 선택 → 「실행」
//   4. 「실행 로그」에서 PART 1~5 결과 확인
//   5. 결과가 만족스러우면 TEST_SYSTEM_PROMPT 내용을 위쪽 GUIDE_SYSTEM_PROMPT 상수에
//      복사해서 붙여넣고 저장 → 이후 production generateGuide 가 새 프롬프트로 동작
//
// generateGuide / callOpenAI 본 함수는 건드리지 않고, 이 함수만 단독으로 반복 실행
// 가능. 토큰 비용도 같이 표시됨.
// ═════════════════════════════════════════════════════════════
function _test_promptIteration() {
  // ───── [편집 영역 1] 테스트할 System 프롬프트 ─────
  // (처음에는 GUIDE_SYSTEM_PROMPT 와 동일. 자유롭게 수정해서 응답 변화 비교)
  const TEST_SYSTEM_PROMPT = [
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

  // ───── [편집 영역 2] 테스트 입력 데이터 ─────
  // 옵션 A: 시트에서 로드 — UNIFIED_ID 에 통합정보 시트의 신청 id 입력 (빈 문자열이면 첫 번째 row)
  // 옵션 B: 직접 정의 — TEST_INPUT 를 수정 (UNIFIED_ID는 무시됨)
  const UNIFIED_ID = '';        // 예: 'APP-2026-001' 또는 '' (첫 row)
  const TEST_INPUT = null;      // null 이면 시트에서 로드. 객체로 덮어쓰려면:
  // const TEST_INPUT = {
  //   company: '테스트회사', ceo: '홍길동', pname: '떡볶이 분말',
  //   processes: ['계량','혼합','충진','포장'],
  //   problem_type: '공정자동화', problem_points: ['생산속도','수작업부담'],
  //   memo: '주문량이 늘어나면 손이 부족해서 야근이 많습니다.',
  //   items: [{ name: '스틱포장기', model: 'SP-200', qty: 1 }],
  //   space_w: '3000', space_h: '2500'
  // };

  // ───── 이하 함수 본문 (수정 불필요) ─────
  const promptInput = TEST_INPUT || _loadPromptInputFromSheet(UNIFIED_ID);

  Logger.log('═══════════════════════════════════════════════');
  Logger.log('  프롬프트 튜닝 테스트');
  Logger.log('═══════════════════════════════════════════════');
  Logger.log('');
  Logger.log('━━━━━━━━━━ 입력 데이터 ━━━━━━━━━━');
  Logger.log(JSON.stringify(promptInput, null, 2));
  Logger.log('');

  const apiKey = _guideProp(GUIDE_PROP_KEYS.OPENAI_API_KEY);
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const payload = {
    model: 'gpt-4o-mini',
    temperature: 0.7,
    messages: [
      { role: 'system', content: TEST_SYSTEM_PROMPT },
      { role: 'user',   content: JSON.stringify(promptInput, null, 2) }
    ]
  };

  const t0 = new Date().getTime();
  const res = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  const elapsedMs = new Date().getTime() - t0;

  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code !== 200) {
    Logger.log('━━━━━━━━━━ ❌ OpenAI 에러 ━━━━━━━━━━');
    Logger.log('HTTP ' + code);
    Logger.log(body);
    return;
  }

  const json = JSON.parse(body);
  const text = (json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) || '';

  Logger.log('━━━━━━━━━━ Raw 응답 (' + elapsedMs + 'ms) ━━━━━━━━━━');
  Logger.log(text);
  Logger.log('');

  // 파싱
  let parts;
  try {
    parts = parseScript(text);
  } catch (e) {
    Logger.log('━━━━━━━━━━ ❌ 파싱 실패 ━━━━━━━━━━');
    Logger.log(e.message);
    return;
  }

  // 각 PART 출력
  const titles = {
    1: '자기소개 및 필수 문구 (10초)',
    2: '대표 제품 및 공정 소개 (15초)',
    3: '현 공정의 문제점 및 도입 장비 (30초)',
    4: '설치 장소 및 기대효과 (20초)',
    5: '간단한 마무리 (5초)'
  };

  Logger.log('████████████████████████████████████████████████');
  Logger.log('  파싱된 5 PART 결과');
  Logger.log('████████████████████████████████████████████████');

  for (let i = 1; i <= 5; i++) {
    Logger.log('');
    Logger.log('━━━━━━━ PART ' + i + ' · ' + titles[i] + ' ━━━━━━━');
    Logger.log(parts['part' + i]);
  }

  // 사용량 + 비용
  if (json.usage) {
    const u = json.usage;
    const cost = (u.prompt_tokens * 0.00000015) + (u.completion_tokens * 0.00000060);
    const krw = Math.round(cost * 1400 * 100) / 100;
    Logger.log('');
    Logger.log('━━━━━━━━━━ 사용량 ━━━━━━━━━━');
    Logger.log('Prompt: ' + u.prompt_tokens + ' tokens / Completion: ' + u.completion_tokens + ' / Total: ' + u.total_tokens);
    Logger.log('비용: ~$' + cost.toFixed(6) + ' (≈ ' + krw + '원)');
  }
}

// _test_promptIteration 의 시트 로드 헬퍼
// generateGuide 와 동일한 입력 형식으로 변환
function _loadPromptInputFromSheet(unifiedId) {
  const sheet = getSheet(SN.UNIFIED);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('통합정보 시트에 데이터 없음');

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const data = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();

  let target = data[0];
  if (unifiedId) {
    const idCol = headers.indexOf('id');
    if (idCol === -1) throw new Error('통합정보 시트에 id 컬럼 없음');
    target = null;
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][idCol]) === String(unifiedId)) { target = data[i]; break; }
    }
    if (!target) throw new Error('id=' + unifiedId + ' 행 없음');
  }

  const row = {};
  headers.forEach(function(h, i) { row[h] = target[i]; });

  // 배열 컬럼 파싱
  ['processes','problem_points','items','equipment','pkgtypes','electric'].forEach(function(k) {
    if (typeof row[k] === 'string' && row[k]) {
      try { row[k] = JSON.parse(row[k]); } catch(e) {}
    }
  });

  // generateGuide 와 동일한 입력 형식
  const items = (row.items || []).map(function(it) {
    return { name: it.name, model: it.model, qty: it.qty };
  });
  return {
    company: row.company || '',
    ceo:     row.ceo || '',
    pname:   row.pname || '',
    processes:      row.processes || [],
    problem_type:   row.problem_type || '',
    problem_points: row.problem_points || [],
    memo:    row.memo || '',
    items:   items,
    space_w: row.space_w || '',
    space_h: row.space_h || ''
  };
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
    // PART 마커는 주석 안에 추가 텍스트 허용 (예: <!-- PART 3 (핵심) -->)
    const markerRe = new RegExp('<!--\\s*PART\\s*' + i + '[^>]*?-->', 'i');
    const markerMatch = markerRe.exec(html);
    if (!markerMatch) throw new Error('템플릿에 PART ' + i + ' 마커 없음');
    const idx = markerMatch.index;

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


// ─────────────────────────────────────────────────────────────
// 메인 진입점 — 통합정보 row를 받아 GPT→HTML→Drive 저장→시트 업데이트
// 견적 발급 시 saveQt 후크에서 호출됨
// ─────────────────────────────────────────────────────────────
function generateGuide(unifiedRow) {
  if (!unifiedRow || !unifiedRow.id) {
    Logger.log('[generateGuide] unifiedRow 또는 id 없음, skip');
    return { ok: false, reason: 'no_row' };
  }

  const id = unifiedRow.id;
  const company = unifiedRow.company || '';
  const prevVersion = parseInt(unifiedRow.guide_version, 10) || 0;
  const newVersion = prevVersion + 1;
  const nowKst = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');

  try {
    // 1. GPT 입력 데이터 추출
    const items = (unifiedRow.items || []).map(function(it) {
      return { name: it.name, model: it.model, qty: it.qty };
    });
    const promptInput = {
      company: company,
      ceo:     unifiedRow.ceo || '',
      pname:   unifiedRow.pname || '',
      processes:      unifiedRow.processes || [],
      problem_type:   unifiedRow.problem_type || '',
      problem_points: unifiedRow.problem_points || [],
      memo:    unifiedRow.memo || '',
      items:   items,
      space_w: unifiedRow.space_w || '',
      space_h: unifiedRow.space_h || ''
    };

    // 2. GPT 호출
    Logger.log('[generateGuide] OpenAI 호출 시작 id=' + id);
    const rawScript = callOpenAI(promptInput);
    const parts = parseScript(rawScript);

    // 3. HTML 합성
    const tpl = getDriveTemplate();
    const html = mergeTemplate(tpl, parts);

    // 4. Drive 저장
    const saved = saveGuideToDrive(html, company, newVersion);

    // 5. 시트 업데이트 — 새 버전 시 status는 '대기중'으로 reset, 기존 발송 이력 클리어
    updateUnifiedRowFields(id, {
      guide_script:        rawScript,
      guide_generated_at:  nowKst,
      guide_html_url:      saved.url,
      guide_version:       newVersion,
      guide_send_request:  false,
      guide_sent_at:       '',
      guide_sent_status:   GUIDE_STATUS.PENDING,
      guide_error:         ''
    });

    Logger.log('[generateGuide] 성공 id=' + id + ' v' + newVersion + ' file=' + saved.name);
    return { ok: true, version: newVersion, url: saved.url };

  } catch (err) {
    const errMsg = String(err && err.message || err);
    Logger.log('[generateGuide] 실패 id=' + id + ': ' + errMsg);
    try {
      updateUnifiedRowFields(id, {
        guide_sent_status: GUIDE_STATUS.FAILED,
        guide_error:       errMsg,
        guide_generated_at: nowKst
      });
    } catch (e2) {
      Logger.log('[generateGuide] 시트 업데이트 실패: ' + e2);
    }
    return { ok: false, error: errMsg };
  }
}

function _test_generateGuide() {
  // 통합정보 시트의 첫번째 row를 사용해서 실제로 가이드 생성
  const sheet = getSheet(SN.UNIFIED);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const data = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
  const row = {};
  headers.forEach(function(h, i) { row[h] = data[i]; });
  // 배열 컬럼 파싱
  ['processes','problem_points','items'].forEach(function(k){
    if (typeof row[k] === 'string' && row[k]) {
      try { row[k] = JSON.parse(row[k]); } catch(e) {}
    }
  });
  Logger.log(JSON.stringify(generateGuide(row)));
}

// ─────────────────────────────────────────────────────────────
// bpksmart26 Mailer Web App 호출 — 메일 발송 위임
// ─────────────────────────────────────────────────────────────
function callMailer(payload) {
  const url = _guideProp(GUIDE_PROP_KEYS.MAILER_WEBAPP_URL);
  const token = _guideProp(GUIDE_PROP_KEYS.MAILER_TOKEN);
  if (!url) throw new Error('MAILER_WEBAPP_URL not set');
  if (!token) throw new Error('MAILER_TOKEN not set');

  const body = Object.assign({ token: token }, payload);

  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
    followRedirects: true
  });

  const code = res.getResponseCode();
  const text = res.getContentText();
  let json;
  try { json = JSON.parse(text); } catch (e) { json = { ok:false, error:'non-json: ' + text }; }
  if (code !== 200 || !json.ok) {
    throw new Error('Mailer 응답 NG (HTTP ' + code + '): ' + (json.error || text));
  }
  return json;
}

function _test_callMailer() {
  const r = callMailer({
    to: 'bpksmart26@gmail.com',
    subject: '[BPK 통신 테스트] ' + new Date().toISOString(),
    html: '<h1>smart@paxc → bpksmart26 호출 성공</h1>'
  });
  Logger.log(JSON.stringify(r));
}

// ─────────────────────────────────────────────────────────────
// 통합정보 1행 → 메일 발송 + 시트 업데이트
// pollAndSend / sendGuideNow 둘 다 이 함수를 사용
// ─────────────────────────────────────────────────────────────
function sendGuideForRow(unifiedRow) {
  const id = unifiedRow.id;
  const nowKst = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');

  if (!unifiedRow.email) {
    const err = '이메일 없음';
    updateUnifiedRowFields(id, {
      guide_sent_status: GUIDE_STATUS.FAILED,
      guide_error: err,
      guide_send_request: false
    });
    return { ok:false, error: err };
  }

  if (!unifiedRow.guide_html_url) {
    const err = '가이드 HTML 없음 (generateGuide 미실행?)';
    updateUnifiedRowFields(id, {
      guide_sent_status: GUIDE_STATUS.FAILED,
      guide_error: err,
      guide_send_request: false
    });
    return { ok:false, error: err };
  }

  // 멱등성 — 5분 이내 발송된 적 있으면 skip (Make 재시도 / 동시 폴링 안전망)
  if (unifiedRow.guide_sent_status === GUIDE_STATUS.SENT && unifiedRow.guide_sent_at) {
    const sentAt = new Date(unifiedRow.guide_sent_at);
    const ageMs = Date.now() - sentAt.getTime();
    if (!isNaN(sentAt.getTime()) && ageMs >= 0 && ageMs < 5 * 60 * 1000) {
      Logger.log('[sendGuideForRow] 5분 이내 이미 발송됨, skip id=' + id);
      return { ok:true, skipped:'recently sent' };
    }
  }

  try {
    // 1. HTML 본문 Drive에서 fetch
    const htmlFileId = _extractDriveFileId(unifiedRow.guide_html_url);
    const html = DriveApp.getFileById(htmlFileId).getBlob().getDataAsString('UTF-8');

    // 2. 견적 PDF (있으면) 첨부
    const attachments = [];
    if (unifiedRow.pdfUrl) {
      try {
        const pdfFileId = _extractDriveFileId(unifiedRow.pdfUrl);
        const pdfBlob = DriveApp.getFileById(pdfFileId).getBlob();
        const pdfBytes = pdfBlob.getBytes();
        if (pdfBytes.length > 20 * 1024 * 1024) {
          Logger.log('[sendGuideForRow] PDF 20MB 초과, 첨부 생략 (크기:' + pdfBytes.length + ')');
        } else {
          attachments.push({
            name: pdfBlob.getName() || '견적서.pdf',
            base64: Utilities.base64Encode(pdfBytes),
            mime: 'application/pdf'
          });
        }
      } catch (e) {
        Logger.log('[sendGuideForRow] PDF 첨부 실패 (메일은 계속): ' + e);
      }
    }

    // 3. Mailer 호출
    const subject = '[BPK] 2026 스마트제조 지원사업 신청 가이드 — ' + (unifiedRow.company || '');
    callMailer({
      to: unifiedRow.email,
      subject: subject,
      html: html,
      attachments: attachments
    });

    // 4. 시트 업데이트 — 성공
    updateUnifiedRowFields(id, {
      guide_sent_status:  GUIDE_STATUS.SENT,
      guide_sent_at:      nowKst,
      guide_send_request: false,
      guide_error:        ''
    });
    return { ok:true };

  } catch (err) {
    const errMsg = String(err && err.message || err);
    Logger.log('[sendGuideForRow] 실패 id=' + id + ': ' + errMsg);
    updateUnifiedRowFields(id, {
      guide_sent_status:  GUIDE_STATUS.FAILED,
      guide_error:        errMsg,
      guide_send_request: false  // 실패해도 자동 재시도 안 함 — 사용자가 다시 체크해야 함
    });
    return { ok:false, error: errMsg };
  }
}

function _extractDriveFileId(url) {
  const m = String(url).match(/[?&]id=([^&\s]+)/) || String(url).match(/\/d\/([^/?]+)/);
  if (!m) throw new Error('Drive URL에서 파일 ID 추출 실패: ' + url);
  return m[1];
}

// ─────────────────────────────────────────────────────────────
// 5분 시간 트리거에서 호출 — 발송요청=TRUE & status≠'발송완료' 행 일괄 처리
// ─────────────────────────────────────────────────────────────
function pollAndSend() {
  // 동시 실행 방지 — 이전 5분 트리거가 아직 돌고 있으면 skip
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) {
    Logger.log('[pollAndSend] 다른 실행이 진행 중, skip');
    return { ok:true, skipped:'lock held' };
  }

  try {
    const MAX_PER_TICK = 30;

    const sheet = getSheet(SN.UNIFIED);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { ok:true, processed:0 };

    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const data = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();

    const reqCol    = headers.indexOf('guide_send_request');
    const statusCol = headers.indexOf('guide_sent_status');
    if (reqCol === -1 || statusCol === -1) {
      Logger.log('[pollAndSend] 가이드 컬럼 없음. autoInitSheets 실행 필요.');
      return { ok:false, error:'columns not migrated' };
    }

    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < data.length; i++) {
      const reqVal = data[i][reqCol];
      const statusVal = data[i][statusCol];
      const isRequested = (reqVal === true || String(reqVal).toLowerCase() === 'true');
      if (!isRequested) continue;
      if (statusVal === GUIDE_STATUS.SENT) continue;

      // row 객체 구성
      const row = {};
      headers.forEach(function(h, j) { row[h] = data[i][j]; });
      // 배열 컬럼 파싱
      UNIFIED_ARR.forEach(function(k){
        if (typeof row[k] === 'string' && row[k]) {
          try { row[k] = JSON.parse(row[k]); } catch(e) {}
        }
      });

      Logger.log('[pollAndSend] 발송 시작 id=' + row.id + ' company=' + row.company);
      const r = sendGuideForRow(row);
      processed++;
      if (r.ok) succeeded++; else failed++;

      // 발송 후 노션에도 push (sent_at, status 반영)
      try {
        var freshRow = _loadUnifiedByBizno(row.bizno);
        if (freshRow) pushToNotion(freshRow);
      } catch (e) {
        Logger.log('[pollAndSend] pushToNotion 실패 (무시): ' + e);
      }

      if (processed >= MAX_PER_TICK) {
        Logger.log('[pollAndSend] 이번 틱 한도(' + MAX_PER_TICK + ') 도달, 다음 틱에서 계속');
        break;
      }
    }

    Logger.log('[pollAndSend] 완료 — 처리:' + processed + ' 성공:' + succeeded + ' 실패:' + failed);
    return { ok:true, processed:processed, succeeded:succeeded, failed:failed };
  } finally {
    lock.releaseLock();
  }
}

function _test_pollAndSend() {
  Logger.log(JSON.stringify(pollAndSend()));
}

// ─────────────────────────────────────────────────────────────
// Make.com 백업 경로 — 단일 회사 즉시 발송
// data: { id, token } — token은 MAKE_TOKEN과 일치해야 함
// ─────────────────────────────────────────────────────────────
function sendGuideNow(data) {
  const expected = _guideProp(GUIDE_PROP_KEYS.MAKE_TOKEN);
  if (!expected) return { ok:false, error:'MAKE_TOKEN not configured' };
  if (!data || data.token !== expected) return { ok:false, error:'unauthorized' };
  if (!data.id) return { ok:false, error:'missing id' };

  const sheet = getSheet(SN.UNIFIED);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idCol = headers.indexOf('id');
  if (idCol === -1) return { ok:false, error:'id column missing' };

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok:false, error:'sheet empty' };

  const all = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  let target = null;
  for (let i = 0; i < all.length; i++) {
    if (String(all[i][idCol]) === String(data.id)) {
      target = {};
      headers.forEach(function(h, j) { target[h] = all[i][j]; });
      break;
    }
  }
  if (!target) return { ok:false, error:'row not found id=' + data.id };

  // 배열 파싱
  UNIFIED_ARR.forEach(function(k){
    if (typeof target[k] === 'string' && target[k]) {
      try { target[k] = JSON.parse(target[k]); } catch(e) {}
    }
  });

  const r = sendGuideForRow(target);

  // 발송 후 노션 push
  try {
    var fresh = _loadUnifiedByBizno(target.bizno);
    if (fresh) pushToNotion(fresh);
  } catch(e) { Logger.log('[sendGuideNow] pushToNotion 실패: ' + e); }

  return r;
}

// ─────────────────────────────────────────────────────────────
// 진단 (READ-ONLY) — 가이드 발송 상태 불일치 검사
// 절대로 시트·노션을 변경하지 않음. Logger.log 만 출력.
// 실행: Apps Script 에디터에서 함수 선택 후 ▶️
// 결과 확인: View > Logs (또는 Execution log)
// ─────────────────────────────────────────────────────────────
function _audit_guideSendState() {
  Logger.log('=== _audit_guideSendState 시작 (READ-ONLY) ===');
  const sheet = getSheet(SN.UNIFIED);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('통합정보 시트가 비어있음');
    return { ok: true, rows: 0 };
  }

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const data    = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();

  const idCol      = headers.indexOf('id');
  const companyCol = headers.indexOf('company');
  const biznoCol   = headers.indexOf('bizno');
  const reqCol     = headers.indexOf('guide_send_request');
  const statusCol  = headers.indexOf('guide_sent_status');
  const sentAtCol  = headers.indexOf('guide_sent_at');
  const verCol     = headers.indexOf('guide_version');

  const findings = {
    sheetReqAsString:        [],
    sentButRequestStillTrue: [],
    sentNoSentAt:            [],
    sentWithoutGuideVersion: [],
    totalRows: 0
  };

  for (let i = 0; i < data.length; i++) {
    findings.totalRows++;
    const r       = data[i];
    const id      = r[idCol];
    const company = r[companyCol];
    const bizno   = r[biznoCol];
    const reqRaw  = r[reqCol];
    const status  = r[statusCol];
    const sentAt  = r[sentAtCol];
    const ver     = r[verCol];

    const reqIsString = (typeof reqRaw === 'string');
    const reqTruthy   = (reqRaw === true || String(reqRaw).toLowerCase() === 'true');
    const isSent     = (status === GUIDE_STATUS.SENT);

    if (reqIsString && reqRaw !== '') {
      findings.sheetReqAsString.push({ id:id, company:company, bizno:bizno, value:reqRaw });
    }
    if (isSent && reqTruthy) {
      findings.sentButRequestStillTrue.push({ id:id, company:company, bizno:bizno, sentAt:sentAt, version:ver });
    }
    if (isSent && !sentAt) {
      findings.sentNoSentAt.push({ id:id, company:company, bizno:bizno });
    }
    if (isSent && (ver === '' || ver == null)) {
      findings.sentWithoutGuideVersion.push({ id:id, company:company, bizno:bizno });
    }
  }

  Logger.log('총 행 수: ' + findings.totalRows);

  Logger.log('--- (1) 시트 guide_send_request 가 문자열로 저장된 행: ' + findings.sheetReqAsString.length + '개 ---');
  findings.sheetReqAsString.forEach(function(f){
    Logger.log('  id=' + f.id + ' company=' + f.company + ' bizno=' + f.bizno + ' value=' + JSON.stringify(f.value));
  });

  Logger.log('--- (2) status=발송완료 인데 guide_send_request truthy 인 행: ' + findings.sentButRequestStillTrue.length + '개 ---');
  findings.sentButRequestStillTrue.forEach(function(f){
    Logger.log('  id=' + f.id + ' company=' + f.company + ' bizno=' + f.bizno + ' sentAt=' + f.sentAt + ' version=' + f.version);
  });

  Logger.log('--- (3) status=발송완료 인데 guide_sent_at 없음: ' + findings.sentNoSentAt.length + '개 ---');
  findings.sentNoSentAt.forEach(function(f){
    Logger.log('  id=' + f.id + ' company=' + f.company + ' bizno=' + f.bizno);
  });

  Logger.log('--- (4) status=발송완료 인데 guide_version 없음: ' + findings.sentWithoutGuideVersion.length + '개 ---');
  findings.sentWithoutGuideVersion.forEach(function(f){
    Logger.log('  id=' + f.id + ' company=' + f.company + ' bizno=' + f.bizno);
  });

  Logger.log('=== _audit_guideSendState 완료 ===');
  return { ok: true, findings: findings };
}

// 노션 측 가이드발송요청 체크박스 상태 진단 (READ-ONLY)
// 행마다 1회 노션 API 호출 — quota·시간 주의 (100행 ≒ 수십 초)
function _audit_notionGuideCheckbox() {
  Logger.log('=== _audit_notionGuideCheckbox 시작 (READ-ONLY) ===');
  const sheet = getSheet(SN.UNIFIED);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('통합정보 시트가 비어있음');
    return { ok:true };
  }

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const data    = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();

  const idCol     = headers.indexOf('id');
  const biznoCol  = headers.indexOf('bizno');
  const statusCol = headers.indexOf('guide_sent_status');
  const reqCol    = headers.indexOf('guide_send_request');

  let checked = 0, mismatch = 0, missing = 0, diverge = 0;
  data.forEach(function(r) {
    const bizno  = String(r[biznoCol] || '').trim();
    if (!bizno) return;
    const status = r[statusCol];
    const sheetReq = r[reqCol];
    const sheetTruthy = (sheetReq === true || String(sheetReq).toLowerCase() === 'true');

    const page = _findNotionPageByBizno(bizno);
    if (!page) {
      missing++;
      Logger.log('  [MISSING] id=' + r[idCol] + ' bizno=' + bizno + ' → 노션 페이지 없음');
      return;
    }
    const prop = page.properties && page.properties['가이드발송요청'];
    const notionVal = !!(prop && prop.checkbox);
    checked++;
    const isSent = (status === GUIDE_STATUS.SENT);

    if (isSent && notionVal) {
      mismatch++;
      Logger.log('  [MISMATCH] id=' + r[idCol] + ' bizno=' + bizno
        + ' status=발송완료, 시트=' + JSON.stringify(sheetReq)
        + ', 노션=TRUE (정리 대상)');
    } else if (notionVal !== sheetTruthy) {
      diverge++;
      Logger.log('  [DIVERGE] id=' + r[idCol] + ' bizno=' + bizno
        + ' status=' + status
        + ' 시트=' + JSON.stringify(sheetReq) + ' 노션=' + notionVal);
    }
  });
  Logger.log('검사: ' + checked + ', 발송완료&노션TRUE: ' + mismatch
    + ', 노션페이지없음: ' + missing + ', 단순불일치: ' + diverge);
  Logger.log('=== _audit_notionGuideCheckbox 완료 ===');
  return { ok:true, checked:checked, mismatch:mismatch, missing:missing, diverge:diverge };
}
