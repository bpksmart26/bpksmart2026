# 동영상 가이드 메일 자동 생성·발송 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 견적서가 발급되면 GPT가 회사별 동영상 촬영 대본을 자동 생성하고, 노션에서 체크박스 한 번으로 메일을 발송하는 시스템 구축

**Architecture:** smart@paxc.co.kr 메인 Apps Script(시트/Drive/GPT/HTML/폴링) + bpksmart26@gmail.com 메일 전용 Apps Script(GmailApp 발송) 분리. 노션 양방향 sync로 발송요청 체크박스를 시트로 전달, 5분 시간 트리거로 폴링·발송. 백업 경로는 Make.com 슬림 webhook.

**Tech Stack:** Google Apps Script (V8), Google Sheets/Drive API, OpenAI gpt-4o-mini, Notion API, Make.com (옵션)

**Spec 참조:** `docs/superpowers/specs/2026-05-09-video-script-email-guide-design.md`

---

## File Structure

| 경로 | 변경 | 책임 |
|---|---|---|
| `apps_script/Code.gs` | 수정 | UNIFIED_COLS 확장, doPost 새 케이스(`sendGuideNow`), saveQt 후크, 마이그레이션 호출 |
| `apps_script/GuideMail.gs` | **신규** | generateGuide / pollAndSend / sendGuideNow 본체와 헬퍼 함수 (Code.gs 비대화 방지) |
| `apps_script/NotionSync.gs` | 수정 | NOTION_PROP_MAP에 8개 필드 매핑 추가, BIDIRECTIONAL_FIELDS에 `guide_send_request` 추가 |
| `apps_script/mailer/Code.gs` | **신규** | bpksmart26 Apps Script 소스 (레포 추적용 사본). 실제 배포는 사용자가 bpksmart26 계정에서 수동 |
| `docs/superpowers/specs/...` | 참조 | 설계 SSOT |

**왜 새 파일?** Apps Script는 같은 프로젝트의 모든 .gs 파일이 글로벌 네임스페이스를 공유함. `GuideMail.gs`로 분리해도 `Code.gs`의 함수/상수에 접근 가능. Code.gs(907줄)에 300+줄 추가하면 1200줄 넘어 가독성 저하.

---

## Phase 0 — Prerequisites (사용자 수동 작업)

코드 작업 전 사용자가 미리 완료해야 하는 셋업. 일부는 작업 도중에도 가능.

### Task 0.1: 메일 템플릿 Drive 업로드

이미 완료 ✅ (사용자 확인). `1FPJebwdF6HeoKd-UXFMKYhowHxJL6arY` 폴더에 `_template.html` 존재.

- [ ] **Step 1: 파일 ID 메모**
  - Drive에서 `_template.html` 우클릭 → 「링크 가져오기」 → URL의 `?id=XXXX` 또는 `/d/XXXX/` 부분이 파일 ID
  - 메모해둘 것 (Phase 0.4에서 사용)

### Task 0.2: bpksmart26@gmail.com에 메일 전용 Apps Script 생성

- [ ] **Step 1: bpksmart26 계정으로 로그인**
  - 브라우저에서 bpksmart26@gmail.com 로 로그인

- [ ] **Step 2: script.google.com 접속 → 새 프로젝트**
  - https://script.google.com → 「+ 새 프로젝트」 클릭
  - 프로젝트 이름: `BPK Mailer`

- [ ] **Step 3: 코드 붙여넣기** (Task 3.1에서 작성한 `apps_script/mailer/Code.gs` 내용을 복사)

- [ ] **Step 4: Web App 배포**
  - 우측 상단 「배포」 → 「새 배포」
  - 유형: **웹 앱**
  - 설명: `BPK Mailer v1`
  - 실행 사용자: **본인 (bpksmart26@gmail.com)** ← 중요!
  - 액세스: **모든 사용자**
  - 「배포」 클릭 → 권한 승인 (GmailApp 권한 포함)
  - **웹 앱 URL 복사** → 메모 (`MAILER_WEBAPP_URL`)

- [ ] **Step 5: PropertiesService에 토큰 저장**
  - 좌측 메뉴 「프로젝트 설정」(톱니바퀴) → 「스크립트 속성」
  - 속성 추가: `MAILER_TOKEN` = (32자 랜덤 문자열, 사용자 직접 생성)
    - 예: 터미널에서 `openssl rand -hex 16` 또는 1Password 비밀번호 생성기
  - 저장한 토큰값 메모 (Phase 0.4에서도 사용)

### Task 0.3: 노션 DB 속성 추가

- [ ] **Step 1: 노션 워크스페이스 로그인**
  - bpksmart26@gmail.com 계정의 노션 접속

- [ ] **Step 2: 통합정보 데이터베이스 열기**
  - 기존 sync 중인 DB

- [ ] **Step 3: 속성 7개 추가** (`guide_error`는 sheet-only이므로 노션에 안 만듦)
  | 속성명 | 타입 |
  |---|---|
  | 가이드스크립트 | 텍스트 |
  | 가이드생성일 | 날짜 |
  | 가이드메일HTML | URL |
  | 가이드버전 | 숫자 |
  | 가이드발송요청 | **체크박스** |
  | 가이드발송일 | 날짜 |
  | 가이드발송상태 | **선택** |

- [ ] **Step 4: 가이드발송상태 Select 옵션 등록**
  - 옵션: `대기중`(회색), `발송완료`(초록), `발송실패`(빨강)

### Task 0.4: 메인 Apps Script(smart@paxc) PropertiesService 셋업

- [ ] **Step 1: smart@paxc.co.kr 계정으로 시트 열기**

- [ ] **Step 2: 「확장 프로그램 → Apps Script」 열기**

- [ ] **Step 3: 「프로젝트 설정 → 스크립트 속성」**

- [ ] **Step 4: 다음 4개 속성 추가**
  | 키 | 값 |
  |---|---|
  | `OPENAI_API_KEY` | (사용자 보유 sk-...) |
  | `MAILER_WEBAPP_URL` | (Task 0.2-Step4에서 메모한 URL) |
  | `MAILER_TOKEN` | (Task 0.2-Step5에서 메모한 32자 토큰, **양쪽 동일**) |
  | `MAKE_TOKEN` | (32자 랜덤, Make 백업용 별도 토큰) |
  | `GUIDE_DRIVE_FOLDER_ID` | `1FPJebwdF6HeoKd-UXFMKYhowHxJL6arY` |
  | `GUIDE_TEMPLATE_FILE_ID` | (Task 0.1에서 메모한 _template.html 파일 ID) |

---

## Phase 1 — 컬럼 확장 + 마이그레이션 인프라

### Task 1.1: UNIFIED_COLS에 8개 컬럼 추가

**Files:**
- Modify: `apps_script/Code.gs:39-58`

- [ ] **Step 1: UNIFIED_COLS 상수 끝에 8개 추가**

`apps_script/Code.gs` line 39-58을 다음으로 교체:

```javascript
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
  'guide_send_request','guide_sent_at','guide_sent_status','guide_error'
];

const UNIFIED_ARR = [
  'processes','pkgtypes','problem_points','equipment','electric',
  'space_photos','product_photos','items','options'
];

const UNIFIED_NUM = { total:'number', eqCount:'number', version:'number', guide_version:'number' };

const UNIFIED_BOOL = { guide_send_request:'boolean' };
```

- [ ] **Step 2: 검증** — 시트의 통합정보 헤더가 자동 확장되는지 확인
  - Apps Script 에디터에서 `autoInitSheets` 함수 실행
  - 시트 「통합정보」 1행에 8개 컬럼이 끝에 추가됐는지 육안 확인
  - 안 됐으면 `ensureHeader` 함수 동작을 다음 step에서 검증

- [ ] **Step 3: 커밋**

```bash
git add apps_script/Code.gs
git commit -m "feat(unified): 가이드 메일 8개 컬럼 추가 (UNIFIED_COLS 확장)"
```

### Task 1.2: 가이드 상태값 상수 + KST 헬퍼 사용 확인

**Files:**
- Create: `apps_script/GuideMail.gs`

- [ ] **Step 1: 새 .gs 파일 생성**

Apps Script 에디터에서 「+ 파일 추가 → 스크립트」 → 이름 `GuideMail`. 또는 로컬에 파일 만들고 clasp로 푸시.

- [ ] **Step 2: 파일 헤더와 상수 정의**

`apps_script/GuideMail.gs` 신규 파일:

```javascript
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
```

- [ ] **Step 3: 커밋**

```bash
git add apps_script/GuideMail.gs
git commit -m "feat(guide): GuideMail.gs 신규 — 상태 상수 + 환경변수 헬퍼"
```

---

## Phase 2 — Generate Guide (스크립트 생성)

### Task 2.1: Drive 템플릿 로더 (캐시 포함)

**Files:**
- Modify: `apps_script/GuideMail.gs`

- [ ] **Step 1: getDriveTemplate 함수 추가**

`apps_script/GuideMail.gs`의 `_guideProp` 다음에:

```javascript
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
```

- [ ] **Step 2: 에디터에서 테스트 실행**
  - 함수 선택: `_test_getDriveTemplate` → 「실행」
  - 권한 승인 (Drive 읽기)
  - Logs에 길이 + 두 마커 모두 `true` 확인

- [ ] **Step 3: 커밋**

```bash
git add apps_script/GuideMail.gs
git commit -m "feat(guide): getDriveTemplate — _template.html 로더 + 캐시"
```

### Task 2.2: OpenAI gpt-4o-mini 호출

**Files:**
- Modify: `apps_script/GuideMail.gs`

- [ ] **Step 1: System 프롬프트 + callOpenAI 함수 추가**

```javascript
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
```

- [ ] **Step 2: 에디터에서 `_test_callOpenAI` 실행**
  - Logs에 5개 PART 마크다운 출력 확인
  - PART 1 끝에 "부정수급을 하지 않을 것이며..." 포함 확인
  - PART 3에 "스틱포장기 SP-200" 등장 확인

- [ ] **Step 3: 커밋**

```bash
git add apps_script/GuideMail.gs
git commit -m "feat(guide): callOpenAI — gpt-4o-mini 5 PART 스크립트 생성"
```

### Task 2.3: 마크다운 응답 파싱

**Files:**
- Modify: `apps_script/GuideMail.gs`

- [ ] **Step 1: parseScript 함수 추가**

```javascript
// ─────────────────────────────────────────────────────────────
// GPT 응답 마크다운 → { part1, part2, ..., part5 }
// ## PART N 헤더 단위로 split
// ─────────────────────────────────────────────────────────────
function parseScript(markdown) {
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
```

- [ ] **Step 2: `_test_parseScript` 실행**
  - 5개 키 모두 값이 들어있는지 확인

- [ ] **Step 3: 커밋**

```bash
git add apps_script/GuideMail.gs
git commit -m "feat(guide): parseScript — GPT 마크다운 → 5 PART 객체"
```

### Task 2.4: HTML 템플릿 치환

**Files:**
- Modify: `apps_script/GuideMail.gs`

- [ ] **Step 1: mergeTemplate 함수 추가**

```javascript
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

    // marker 뒤에서 시작하는 본문 <td>를 찾음
    // 패턴: <td style="padding:18px 22px; ...> ... </td>
    // 본문 <td>는 padding:18px 22px로 식별 (헤더 td는 padding:12px 18px)
    const bodyTdRe = /<td[^>]*padding:18px 22px[^>]*>([\s\S]*?)<\/td>/i;
    const tail = html.substring(idx);
    const tailMatch = tail.match(bodyTdRe);
    if (!tailMatch) throw new Error('PART ' + i + ' 본문 td 못 찾음');

    const newBody = _formatPartHtml(parts['part' + i]);
    const replaced = tailMatch[0].replace(bodyTdRe, function(_, __) {
      return tailMatch[0].replace(tailMatch[1], newBody);
    });

    html = html.substring(0, idx) + tail.replace(tailMatch[0], replaced);
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
```

- [ ] **Step 2: `_test_mergeTemplate` 실행**
  - Logs에 출력된 URL을 브라우저에서 열어 5 PART 본문 시각 확인
  - 굵게(`**...**`)가 `<strong>`으로 변환됐는지 확인
  - 확인 후 `_test_merge.html` 파일은 Drive에서 수동 삭제 가능

- [ ] **Step 3: 커밋**

```bash
git add apps_script/GuideMail.gs
git commit -m "feat(guide): mergeTemplate — PART 마커 기반 본문 치환"
```

### Task 2.5: Drive 저장 (버전 관리)

**Files:**
- Modify: `apps_script/GuideMail.gs`

- [ ] **Step 1: saveGuideToDrive 함수 추가**

```javascript
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
```

- [ ] **Step 2: `_test_saveGuideToDrive` 실행 → URL 메모하고 브라우저로 열어 동작 확인 → 테스트 파일 수동 삭제**

- [ ] **Step 3: 커밋**

```bash
git add apps_script/GuideMail.gs
git commit -m "feat(guide): saveGuideToDrive — 버전 파일명으로 HTML 저장"
```

### Task 2.6: 시트 부분 업데이트 헬퍼

**Files:**
- Modify: `apps_script/GuideMail.gs`

- [ ] **Step 1: updateUnifiedRowFields 함수 추가**

이미 `Code.gs`에 시트 행 업데이트 패턴이 있는지 확인 — 없으면 새로 작성.

```javascript
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
```

- [ ] **Step 2: 커밋**

```bash
git add apps_script/GuideMail.gs
git commit -m "feat(guide): updateUnifiedRowFields — 통합정보 부분 업데이트"
```

### Task 2.7: generateGuide 통합 함수

**Files:**
- Modify: `apps_script/GuideMail.gs`

- [ ] **Step 1: generateGuide 함수 추가**

```javascript
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
```

- [ ] **Step 2: `_test_generateGuide` 실행 (실제 데이터로)**
  - Logs에 `성공 id=... v1 file=...` 확인
  - 통합정보 시트의 해당 행에 8개 컬럼이 채워졌는지 확인
  - Drive 폴더에 새 HTML 파일 생긴 것 확인

- [ ] **Step 3: 커밋**

```bash
git add apps_script/GuideMail.gs
git commit -m "feat(guide): generateGuide — GPT→HTML→Drive→시트 통합 플로우"
```

### Task 2.8: saveQt 후크 — 자동 트리거

**Files:**
- Modify: `apps_script/Code.gs:133-156`

- [ ] **Step 1: saveQt 케이스에 후크 추가**

`apps_script/Code.gs`의 saveQt 케이스(line 133~156) 끝, `pushToNotion` `_safeSync` 다음에 추가:

```javascript
        _safeSync('generateGuide after saveQt', function() {
          var app = _findApp(data.appId);
          if (app) {
            var row = _loadUnifiedByBizno(app.bizno);
            Logger.log('[saveQt] generateGuide row id=' + (row ? row.id : 'NULL'));
            if (row) {
              var r = generateGuide(row);
              Logger.log('[saveQt] generateGuide result: ' + JSON.stringify(r));
              // 가이드 변경된 시트 row를 노션에 다시 push (가이드 컬럼 sync)
              if (r.ok) {
                var freshRow = _loadUnifiedByBizno(app.bizno);
                if (freshRow) pushToNotion(freshRow);
              }
            }
          }
        });
        break;  // 기존 break 위치 확인 — 중복 break 안 들어가게
```

**주의:** 기존 코드에 이미 `break;`가 있다. 새 `_safeSync` 블록을 기존 `break;` **위에** 삽입.

- [ ] **Step 2: 검증 — 견적 발급해서 자동 생성되는지**
  - 공급기업_관리.html에서 테스트 회사로 견적 발급
  - Apps Script 「실행 로그」에서 `[saveQt] generateGuide` 메시지 확인
  - 통합정보 시트 + 노션 페이지 둘 다 가이드 컬럼 채워짐 확인

- [ ] **Step 3: 커밋**

```bash
git add apps_script/Code.gs
git commit -m "feat(guide): saveQt 후크 — 견적 발급 시 generateGuide 자동 호출"
```

---

## Phase 3 — Send Email (메일 발송)

### Task 3.1: bpksmart26 메일 전용 Apps Script 소스

**Files:**
- Create: `apps_script/mailer/Code.gs`

- [ ] **Step 1: mailer 폴더 + 파일 생성**

```bash
mkdir -p /Users/seonjecho/Projects/bpksmart2026/apps_script/mailer
```

`apps_script/mailer/Code.gs` 신규:

```javascript
// ============================================================
// BPK Mailer — bpksmart26@gmail.com Apps Script
// 단일 책임: 인증된 요청을 받아 GmailApp으로 메일 발송
// 이 코드는 bpksmart26 계정에서 별도 Apps Script 프로젝트로 배포되며,
// 본 레포에는 추적용 사본으로만 보관됨
// ============================================================

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var expected = PropertiesService.getScriptProperties().getProperty('MAILER_TOKEN');
    if (!expected) return out({ ok:false, error:'MAILER_TOKEN not configured' });
    if (body.token !== expected) return out({ ok:false, error:'unauthorized' });

    if (!body.to || !body.subject || !body.html) {
      return out({ ok:false, error:'missing fields: to/subject/html' });
    }

    var opts = {
      htmlBody: body.html,
      name: '주식회사 비피케이',
      replyTo: 'bpksmart26@gmail.com'
    };

    if (Array.isArray(body.attachments) && body.attachments.length) {
      opts.attachments = body.attachments.map(function(a) {
        var bytes = Utilities.base64Decode(a.base64);
        return Utilities.newBlob(bytes, a.mime || 'application/octet-stream', a.name);
      });
    }

    GmailApp.sendEmail(body.to, body.subject, '', opts);
    return out({ ok:true, sentAt: new Date().toISOString() });

  } catch (err) {
    return out({ ok:false, error: String(err && err.message || err) });
  }
}

function doGet(e) {
  return out({ ok:true, msg:'BPK Mailer alive', ts: new Date().toISOString() });
}

function out(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// 에디터에서 토큰 검증 우회 + 직접 발송 테스트용
function _test_send() {
  GmailApp.sendEmail('bpksmart26@gmail.com', '[BPK Mailer] 테스트', '본문', {
    htmlBody: '<h1>테스트</h1><p>정상 동작</p>',
    name: '주식회사 비피케이'
  });
  Logger.log('테스트 발송 완료. bpksmart26 받은편지함 확인.');
}
```

- [ ] **Step 2: 사용자에게 안내 — Phase 0.2 작업 완료**
  - 위 코드를 bpksmart26 Apps Script 에디터에 붙여넣고 배포
  - `_test_send` 한 번 실행해서 수신 확인

- [ ] **Step 3: 커밋**

```bash
git add apps_script/mailer/Code.gs
git commit -m "feat(mailer): bpksmart26 Apps Script 소스 — 토큰 검증 + GmailApp 발송"
```

### Task 3.2: 메인에서 Mailer 호출하는 헬퍼

**Files:**
- Modify: `apps_script/GuideMail.gs`

- [ ] **Step 1: callMailer 함수 추가**

```javascript
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
```

- [ ] **Step 2: `_test_callMailer` 실행 → bpksmart26 받은편지함에 도착 확인**

- [ ] **Step 3: 커밋**

```bash
git add apps_script/GuideMail.gs
git commit -m "feat(guide): callMailer — bpksmart26 Web App 호출 헬퍼"
```

### Task 3.3: 한 행 발송 처리 함수

**Files:**
- Modify: `apps_script/GuideMail.gs`

- [ ] **Step 1: sendGuideForRow 함수 추가**

```javascript
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
        attachments.push({
          name: pdfBlob.getName() || '견적서.pdf',
          base64: Utilities.base64Encode(pdfBlob.getBytes()),
          mime: 'application/pdf'
        });
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
```

- [ ] **Step 2: 커밋**

```bash
git add apps_script/GuideMail.gs
git commit -m "feat(guide): sendGuideForRow — 한 행 발송 + 시트 업데이트"
```

### Task 3.4: pollAndSend (5분 트리거)

**Files:**
- Modify: `apps_script/GuideMail.gs`

- [ ] **Step 1: pollAndSend 함수 추가**

```javascript
// ─────────────────────────────────────────────────────────────
// 5분 시간 트리거에서 호출 — 발송요청=TRUE & status≠'발송완료' 행 일괄 처리
// ─────────────────────────────────────────────────────────────
function pollAndSend() {
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
  }

  Logger.log('[pollAndSend] 완료 — 처리:' + processed + ' 성공:' + succeeded + ' 실패:' + failed);
  return { ok:true, processed:processed, succeeded:succeeded, failed:failed };
}

function _test_pollAndSend() {
  Logger.log(JSON.stringify(pollAndSend()));
}
```

- [ ] **Step 2: 수동 테스트**
  - 통합정보 시트 한 행의 `guide_send_request` 셀을 TRUE로 변경
  - 에디터에서 `_test_pollAndSend` 실행
  - 메일 수신 확인 + 시트 컬럼 변경 확인 (`발송완료`, `sent_at` 채워짐, `send_request` FALSE로 됨)

- [ ] **Step 3: 커밋**

```bash
git add apps_script/GuideMail.gs
git commit -m "feat(guide): pollAndSend — 5분 트리거 폴링 발송"
```

### Task 3.5: sendGuideNow 액션 (Make 백업 진입점)

**Files:**
- Modify: `apps_script/GuideMail.gs`, `apps_script/Code.gs`

- [ ] **Step 1: GuideMail.gs에 sendGuideNow 추가**

```javascript
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
```

- [ ] **Step 2: Code.gs doPost switch에 새 case 추가**

`apps_script/Code.gs`의 doPost switch (line 99~191)에서 `case 'getLatestQuotePdf':` 다음에:

```javascript
      case 'sendGuideNow':
        Logger.log('[sendGuideNow] entered. id=' + (data && data.id));
        result = sendGuideNow(data);
        Logger.log('[sendGuideNow] result: ' + JSON.stringify(result));
        break;
```

- [ ] **Step 3: 커밋**

```bash
git add apps_script/GuideMail.gs apps_script/Code.gs
git commit -m "feat(guide): sendGuideNow — Make 백업 진입점 (token 검증)"
```

---

## Phase 4 — Notion Sync 매핑 추가

### Task 4.1: NOTION_PROP_MAP 확장

**Files:**
- Modify: `apps_script/NotionSync.gs:11-53`

- [ ] **Step 1: NOTION_PROP_MAP 끝에 7개 매핑 추가**

`apps_script/NotionSync.gs` line 52 (기존 `version` 항목) 다음에:

```javascript
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
```

기존 `};` 닫는 괄호 위치 주의 — 새 7개 항목이 그 안에 들어가야 함.

- [ ] **Step 2: BIDIRECTIONAL_FIELDS에 guide_send_request 추가**

`apps_script/NotionSync.gs:56` 라인:

```javascript
const BIDIRECTIONAL_FIELDS = ['status','manager','memo','quoteMemo','guide_send_request'];
```

- [ ] **Step 3: 커밋**

```bash
git add apps_script/NotionSync.gs
git commit -m "feat(notion): 가이드 7개 필드 매핑 + guide_send_request 양방향"
```

### Task 4.2: 노션 sync 테스트

**Files:**
- Modify: `apps_script/NotionSync.gs` (테스트 함수만)

- [ ] **Step 1: 양방향 sync 검증 — 시트 → 노션 방향**
  - Apps Script 에디터에서 `pushToNotion` 직접 호출 (테스트용 row로) 또는
  - 통합정보 시트 한 행을 수동 수정 후 `_test_pushToNotion_update` 호출
  - 노션에서 가이드 7개 속성 모두 업데이트 됐는지 확인

- [ ] **Step 2: 양방향 sync 검증 — 노션 → 시트 방향**
  - 노션에서 가이드발송요청 체크박스를 ON
  - Apps Script 에디터에서 `syncFromNotion` 실행
  - 통합정보 시트의 guide_send_request 셀이 TRUE로 업데이트 됐는지 확인

- [ ] **Step 3: 검증 메모**
  - 양방향이 정상 동작하면 다음 단계로
  - 안 되면 `ensureNotionSchema` 또는 `syncFromNotion` 코드를 살펴서 checkbox 처리가 누락된 곳 보완

---

## Phase 5 — Operational Setup

### Task 5.1: 시간 트리거 등록 (사용자)

- [ ] **Step 1: smart@paxc Apps Script 에디터 → 시간 트리거**
  - 좌측 「트리거」 탭 → 「+ 트리거 추가」
  - 함수: `pollAndSend`
  - 이벤트 소스: 시간 기반
  - 시간 기반 트리거 유형: 분 타이머
  - 분 간격: **5분 마다**
  - 알림 설정: 즉시 (디버깅용, 안정화 후 매일로 변경 가능)
  - 저장

- [ ] **Step 2: 5분 후 「실행 로그」에서 `[pollAndSend] 완료 — 처리:0` 출력 확인** (대기 중인 발송 요청이 없을 때)

### Task 5.2: Make.com 백업 시나리오 (옵션)

- [ ] **Step 1: Make.com 가입 + 새 시나리오**
  - https://make.com 가입 (Free 플랜)
  - 「+ Create a new scenario」

- [ ] **Step 2: Webhook 모듈 추가**
  - `Webhooks` → `Custom webhook` 선택 → 새 webhook 생성
  - URL 복사 (사용자가 노션에 붙일 URL)

- [ ] **Step 3: HTTP 모듈 추가**
  - `HTTP` → `Make a request`
  - URL: smart@paxc Apps Script Web App URL (config.js의 APPS_SCRIPT_URL)
  - Method: POST
  - Body type: Raw
  - Content type: application/json
  - Request content (Make의 변수 매핑):
    ```json
    {
      "action": "sendGuideNow",
      "data": {
        "id": "{{1.id}}",
        "token": "<MAKE_TOKEN의 값을 직접 박아넣기>"
      }
    }
    ```

- [ ] **Step 4: Webhook response 모듈 (옵션)**
  - HTTP 응답을 그대로 클라이언트에 반환

- [ ] **Step 5: 시나리오 저장 + 실행 활성화 (Run)**

- [ ] **Step 6: 노션에 Webhook URL 추가**
  - 통합정보 DB의 각 페이지 또는 템플릿에 「가이드즉시발송」 URL 속성 (수동)
  - URL 형식: `<Make webhook URL>?id=<페이지의 신청ID>`
  - 또는 Notion Formula 속성으로 동적 URL 생성

### Task 5.3: E2E 검증

- [ ] **Step 1: 테스트 회사 견적 발급**
  - 공급기업_관리.html에서 1건 새 견적 발급
  - 자동 트리거 → generateGuide → 시트 컬럼 채워짐 확인
  - Drive 폴더에 v1 파일 생성 확인
  - 노션에 7개 속성 채워짐 확인 (`발송상태=대기중`)

- [ ] **Step 2: 노션에서 발송요청 체크**
  - 해당 페이지의 `가이드발송요청` 체크박스 ON
  - 5분 대기 (또는 에디터에서 `pollAndSend` 즉시 실행)

- [ ] **Step 3: 메일 도착 확인**
  - 신청기업의 이메일 주소로 가이드 메일 도착 확인 (테스트용 이메일 권장)
  - 본문에 5 PART 내용 + 견적서 PDF 첨부 확인
  - bpksmart26@gmail.com 보낸 편지함에 메일 저장됨 확인

- [ ] **Step 4: 시트/노션 상태 변경 확인**
  - 시트: `guide_sent_status='발송완료'`, `guide_sent_at` 채워짐, `guide_send_request=FALSE`
  - 노션: 동일 (sync 후)

- [ ] **Step 5: 견적 재발급 → v2 생성 검증**
  - 같은 회사 견적 다시 발급
  - Drive에 v2 파일 추가 (v1은 그대로 보관)
  - 시트의 `guide_html_url`이 v2 URL로, `guide_version=2`, `guide_sent_status='대기중'`으로 reset
  - 노션도 동일 반영

- [ ] **Step 6: Make 백업 동작 확인 (옵션)**
  - 노션의 `가이드즉시발송` URL 클릭
  - 즉시 메일 발송 확인 (5분 안 기다리고)

---

## Phase 6 — Final Cleanup

### Task 6.1: 문서 업데이트

**Files:**
- Modify: `PROJECT_STATUS.md`

- [ ] **Step 1: PROJECT_STATUS.md에 10차 세션 작업 추가**

`PROJECT_STATUS.md` 상단의 "마지막 업데이트" 날짜 갱신 + 「✅ 9차 세션 완료 작업」 위에 새 섹션:

```markdown
## ✅ 10차 세션 완료 작업

### 동영상 가이드 메일 자동 생성·발송
- bpksmart26@gmail.com에 메일 전용 Apps Script 분리 (단일 책임: GmailApp 발송)
- smart@paxc.co.kr 메인에 GuideMail.gs 신규
  - generateGuide: 견적 발급 시 자동 트리거, GPT-4o-mini로 5 PART 스크립트 생성
  - pollAndSend: 5분 시간 트리거로 노션 발송요청 체크박스 폴링·발송
  - sendGuideNow: Make.com 백업 진입점 (token 검증)
- 통합정보 시트 8개 컬럼 추가 (guide_*)
- 노션 7개 속성 sync (가이드발송상태 Select, 가이드발송요청 양방향 체크박스)
- Drive에 회사명_가이드메일_YYYYMMDD-HHmm_v{N}.html 버전 보관
```

- [ ] **Step 2: 커밋**

```bash
git add PROJECT_STATUS.md
git commit -m "docs(status): 10차 세션 — 가이드 메일 자동화 완료"
```

---

## Self-Review (작성자 확인)

### Spec coverage
- ✅ 두 Apps Script 분리 (Phase 0.2 + Task 3.1)
- ✅ generateGuide 자동 트리거 (Task 2.7 + 2.8)
- ✅ pollAndSend (Task 3.4)
- ✅ Make 백업 (Task 3.5 + 5.2)
- ✅ 8개 시트 컬럼 + 노션 7개 속성 (Phase 1.1 + Task 4.1)
- ✅ 한글 상태값 + Select (Task 4.1 NOTION_PROP_MAP, 1.2 GUIDE_STATUS 상수)
- ✅ 버전 관리 (Task 2.5 saveGuideToDrive, Task 2.7 generateGuide)
- ✅ 실패 시 send_request=FALSE 자동 해제 (Task 3.3 sendGuideForRow)
- ✅ memo, items 모두 GPT 입력 포함 (Task 2.7 promptInput)

### Placeholder scan
- 코드 없는 step 없음
- 모든 함수 시그니처와 호출 일치 확인
- "TBD/TODO" 0건

### Type consistency
- `GUIDE_STATUS.PENDING/SENT/FAILED` 상수 일관 사용
- `updateUnifiedRowFields(id, fields)` 시그니처 모든 호출 위치 일관
- `_extractDriveFileId` 헬퍼 한 곳에 정의, 사용 일관

### Scope check
- 단일 기능에 집중 (가이드 메일 자동화)
- 기존 인프라 재사용 (NotionSync, _safeSync, formatKST 패턴)
- 무관한 리팩토링 없음
