# 동영상 가이드 메일 자동 생성·발송 — Design Spec

- 작성일: 2026-05-09
- 대상 사업: 2026 소공인 스마트제조지원사업(스마트공방) — 현안문제 해결형
- 위치: `bpksmart2026` 레포

---

## 0. 목적

견적서가 발급되면 신청기업에게 보낼 **스마트제조 지원사업 신청 가이드 + 동영상 촬영 대본**을 자동으로 생성하고, 노션에서 담당자가 체크박스 한 번으로 메일을 발송하는 시스템을 구축한다.

핵심 가치:
- **5단계 동영상 스크립트(자기소개 / 제품·공정 / 문제점·도입장비 / 설치장소·기대효과 / 마무리)** 를 기업별로 GPT가 자동 작성
- 작성된 메일 HTML을 Drive에 박제해 동일 본문 재발송 가능
- 노션에서 발송 트리거 + 상태 확인이 가능 (별도 콘솔 불필요)
- 발송자는 `bpksmart26@gmail.com` — 보낸 메일함에 자동 저장

---

## 1. 시스템 아키텍처

### 1-1. 두 개의 Apps Script 분리

```
┌──────────────────────────────────────────────────────┐
│ smart@paxc.co.kr  ●  메인 Apps Script                │
│ (기존: 시트/Drive/노션 sync/PDF 생성)                │
│ ─ 추가: GPT 호출, HTML 합성, Drive 저장, 폴링/위임   │
└────────────────┬─────────────────────────────────────┘
                 │ POST { token, to, subject, html, attachments }
                 ↓
┌──────────────────────────────────────────────────────┐
│ bpksmart26@gmail.com  ●  메일 전용 Apps Script       │
│ (신규: ~50줄, GmailApp.sendEmail 만 수행)            │
│ → 발송 시 bpksmart26 보낸 메일함에 자동 저장         │
└──────────────────────────────────────────────────────┘
```

**왜 분리했나?**
- Sheets/Drive 소유 계정(`smart@paxc.co.kr`)과 메일 발송 계정(`bpksmart26@gmail.com`)이 다름
- `GmailApp.sendEmail()`은 **스크립트 실행 계정**의 Gmail로 발송되며 보낸함도 그 계정에 저장됨
- 기존 인프라(노션 sync, 시트 처리)는 그대로 두고, 메일 발송만 별도 계정으로 위임

### 1-2. 백업 발송 경로 (Make.com)

```
노션 페이지 [즉시발송] 외부 URL 클릭
  → Make.com Webhook (슬림 시나리오, 2 ops/회사)
  → HTTP module로 메인 Apps Script 호출
  → Apps Script가 폴링과 동일한 발송 로직 실행
```

기본 발송 경로는 폴링이며, Make는 "장애/특수 상황에서 수동 발송" 용도로만 사용.

---

## 2. 데이터 모델

### 2-1. 통합정보 시트 — 추가할 8개 컬럼

`UNIFIED_COLS` 배열 끝에 다음 컬럼을 추가한다 (자동 마이그레이션 함수가 처음 실행 시 헤더 추가).

| 컬럼명 | 타입 | 설명 | 노션 sync | 노션 속성 타입 |
|---|---|---|---|---|
| `guide_script` | 긴 텍스트 | 마크다운 형식 5 PART 스크립트 | ✅ | 텍스트 |
| `guide_generated_at` | ISO 일시 | 스크립트/HTML 생성 시각 | ✅ | 날짜 |
| `guide_html_url` | URL | 최신 HTML Drive 공유 링크 | ✅ | URL |
| `guide_version` | 숫자 | v1, v2, v3... | ✅ | 숫자 |
| `guide_send_request` | 불리언 | 노션에서 체크 = 발송 요청 | ✅ (양방향) | 체크박스 |
| `guide_sent_at` | ISO 일시 | 실제 발송 시각 | ✅ | 날짜 |
| `guide_sent_status` | 한글 텍스트 | `대기중` / `발송완료` / `발송실패` | ✅ | **선택(Select)** |
| `guide_error` | 텍스트 | 마지막 실패 원인 (디버그용) | ❌ (시트만) | — |

### 2-2. 노션 Select 속성 사전등록

`guide_sent_status` Select 속성을 다음 옵션으로 미리 등록 (한 번만):

| 옵션 | 색상 |
|---|---|
| `대기중` | 회색 |
| `발송완료` | 초록 |
| `발송실패` | 빨강 |

### 2-3. 상태 전환 다이어그램

```
[견적 발급]
   ↓
[generateGuide 호출]
   ├─ 성공 → status='대기중', send_request=FALSE
   └─ 실패 → status='발송실패', error=원인

[사용자 노션에서 발송요청 체크]
   ↓ (노션→시트 양방향 sync)
   send_request=TRUE
   ↓ 5분 내 폴링이 잡음
[pollAndSend → bpksmart26 Web App]
   ├─ 성공 → status='발송완료', sent_at=now, send_request=FALSE
   └─ 실패 → status='발송실패', error=원인, send_request=TRUE 유지(재시도)

[견적 재발급 (같은 appId, 새 견적)]
   ↓
[generateGuide 재호출]
   version=N+1, html_url=새파일, generated_at=now
   status='대기중'으로 되돌리기, send_request=FALSE, sent_at=null
   → 사용자가 다시 체크해야 발송
```

### 2-4. Drive 파일 명명 규칙

```
{회사명}_가이드메일_{YYYYMMDD-HHmm}_v{N}.html

예:
㈜대원팩_가이드메일_20260509-1430_v1.html
㈜대원팩_가이드메일_20260512-0915_v2.html
```

- Drive 폴더 ID: `1FPJebwdF6HeoKd-UXFMKYhowHxJL6arY`
- 모든 버전 보관, 시트(노션)에는 최신 버전 URL만
- 회사명에 파일시스템 부적합 문자(`/`, `\`, `:`, `?` 등) 있을 시 `_`로 치환

### 2-5. 메일 템플릿

`_template.html` 파일을 위 Drive 폴더에 사용자 사전 업로드. Apps Script가 매 생성 시 `DriveApp.getFileById()` 또는 폴더 내 이름 검색으로 로드.

`<!-- PART 1 -->` ~ `<!-- PART 5 -->` HTML 주석으로 구분된 5개 블록의 본문 텍스트(`<td style="padding:18px 22px;...">` 안)만 GPT 출력으로 치환. 나머지(헤더/CHAPTER 01-03/디스클레이머/푸터)는 모든 회사 동일.

### 2-6. `guide_script` 마크다운 포맷

```markdown
## PART 1 · 자기소개 및 필수 문구 (10초)
"안녕하세요. ㈜○○ 대표 ○○○입니다.
저희는 ○○ 제품을 생산하고 있으며, 스마트 제조 지원사업을 통해 ...
부정수급을 하지 않을 것이며, 부정수급 발생 시 보조금 환수 및 제재처분에 동의합니다."

## PART 2 · 대표 제품 및 공정 소개 (15초)
"저희는 ○○ 제품을 생산하고 있습니다. ..."

## PART 3 · 현 공정의 문제점 및 도입 장비 (30초)
"현재 저희는 ... 이번에 도입 예정인 **○○○**는 ..."

## PART 4 · 설치 장소 및 기대효과 (20초)
"현재 이 공간에 장비를 설치할 예정입니다. ..."

## PART 5 · 간단한 마무리 (5초)
"이번 스마트 제조 지원사업을 통해 ... 감사합니다."
```

---

## 3. 컴포넌트

### 3-1. 메인 Apps Script (smart@paxc) — `Code.gs` 추가 함수

#### `generateGuide(unifiedRow)`
1. `unifiedRow`에서 GPT 프롬프트 데이터 추출
   - **회사 정보**: company, ceo
   - **제품/공정**: pname(제품명), processes(공정 배열)
   - **문제·도입장비**:
     - problem_type, problem_points(문제점 체크리스트)
     - **`memo`(업체 자유 입력) ← 보조 참고용**
       - 업체가 신청서에 직접 작성한 문제점/불편사항 자유 텍스트
       - 비어있을 수도 있음 — 있으면 PART 3 톤·디테일 보강에 활용, 없으면 무시
       - System 프롬프트에 "참고용 보조 정보, 비어있으면 무시" 명시
     - **`items`(견적 확정 장비 명세) ← 핵심 입력**
       - 형식: `[{name, model, qty, unit, price}, ...]`
       - GPT에는 `name`, `model`, `qty`만 전달 (가격 정보는 동영상 스크립트에 불필요)
       - `equipment`(ID 배열)는 사용 안 함 — `items`가 BPK 담당자 확정한 실제 장비 정보를 담고 있어 더 정확
   - **설치 공간**: space_w, space_h
2. OpenAI Chat Completions API 호출
   - 모델: `gpt-4o-mini`
   - System: 한국어 동영상 스크립트 작성 가이드라인 + 마크다운 출력 강제
   - User: 추출된 회사 데이터 JSON
   - 응답: 마크다운 5 PART 텍스트
3. 응답 파싱 — `## PART N` 단위로 split
4. Drive에서 `_template.html` 로드 (`getDriveTemplate()`)
5. PART 1-5 본문을 `<!-- PART N -->` 블록 안 `<td>` 본문에 치환 (정규식 또는 마커 기반)
6. `{회사명}_가이드메일_{datetime}_v{N}.html` 이름으로 Drive 저장 → `webViewLink` 받음
7. 시트 8개 컬럼 업데이트:
   - `guide_script`, `guide_generated_at`, `guide_html_url`, `guide_version`, `guide_sent_status='대기중'`, `guide_send_request=FALSE`, `guide_sent_at=null`, `guide_error=''`

#### `pollAndSend()` — 5분 시간 트리거
1. 통합정보 시트 전체 스캔
2. 필터: `guide_send_request===TRUE && guide_sent_status!=='발송완료'`
3. 각 행마다:
   - HTML 파일 Drive에서 텍스트로 fetch
   - 견적 PDF (이미 있는 `pdfUrl`) Drive에서 base64로 fetch
   - bpksmart26 Web App URL에 `UrlFetchApp.fetch` POST
     ```
     {
       token: MAILER_TOKEN,
       to: row.email,
       subject: `[BPK] 2026 스마트제조 지원사업 신청 가이드 — ${row.company}`,
       html: <HTML 본문>,
       attachments: [{name, base64, mime}]
     }
     ```
   - 응답 OK이면 `status='발송완료', sent_at=now, send_request=FALSE`
   - 실패면 `status='발송실패', error=err, send_request=FALSE` (자동 재시도 안 함 — 사용자가 노션에서 재체크하거나 Make 백업 사용)
4. 시트→노션 sync 자동 반영

#### `sendGuideNow(data)` — Make 백업 진입점 (`doPost` switch에 새 case)
- `data.companyId` 또는 `data.id`로 한 행 찾아 `pollAndSend`의 단일 행 처리 로직 재사용

#### `getDriveTemplate()` — 템플릿 캐시
- `CacheService.getScriptCache()`로 5분 캐싱 (Drive API 호출 절약)
- 캐시 미스 시 폴더에서 `_template.html` 검색해서 로드

#### `migrateUnifiedColumns()` — 컬럼 자동 추가
- `autoInitSheets` 또는 별도 트리거에서 호출
- 통합정보 시트 헤더 행을 읽어 누락된 8개 컬럼만 끝에 append
- `UNIFIED_COLS` 상수도 동기 수정

#### `saveQt` 후크 (기존 함수 수정)
- 함수 마지막에 `pdfUrl`이 채워진 시점에서 `generateGuide(unifiedRow)` 호출
- 실패해도 견적 저장 자체는 성공으로 응답 (가이드 생성은 보조 작업)

### 3-2. 메일 전용 Apps Script (bpksmart26) — 신규 프로젝트

```javascript
// Code.gs (전체)
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var expected = PropertiesService.getScriptProperties().getProperty('MAILER_TOKEN');
    if (body.token !== expected) {
      return out({ ok:false, error:'unauthorized' });
    }
    var opts = {
      htmlBody: body.html,
      name: '주식회사 비피케이',
      replyTo: 'bpksmart26@gmail.com'
    };
    if (body.attachments && body.attachments.length) {
      opts.attachments = body.attachments.map(function(a){
        return Utilities.newBlob(Utilities.base64Decode(a.base64), a.mime, a.name);
      });
    }
    GmailApp.sendEmail(body.to, body.subject, '', opts);
    return out({ ok:true, sentAt: new Date().toISOString() });
  } catch (err) {
    return out({ ok:false, error: err.toString() });
  }
}

function out(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
```

배포: 새 배포 → 웹 앱 → 실행 사용자: 본인(`bpksmart26@gmail.com`), 액세스: 모든 사용자(익명) → URL 복사.

### 3-3. Make.com 백업 시나리오 (슬림)

```
[Webhook] (Make 자동 생성 URL, ?id=xxx 파라미터 포함)
   ↓
[HTTP module] POST to 메인 Apps Script:
  body: { action: 'sendGuideNow', data: { id, token: MAKE_TOKEN } }
   ↓
[Webhook response] (HTTP 응답 그대로 반환)
```

- 2 ops/회사
- Free 1,000 ops로 ~500회 백업 가능 (백업 용도라 충분)

### 3-4. 노션 DB 추가 작업

1. 통합정보 DB에 8개 속성 추가 (위 2-1 표 매핑대로)
2. `guide_sent_status`는 Select 타입으로 만들고 옵션 3개 미리 등록
3. `guide_send_request`는 체크박스 타입
4. (선택) 페이지 템플릿에 "즉시발송" URL 속성 추가 — Make Webhook URL을 `?id={페이지ID}` 형태로 (수동 셋업)
5. `NotionSync.gs`의 매핑 코드에 8개 컬럼 추가 (양방향 sync 지원)

---

## 4. PropertiesService 시크릿

### 메인 Apps Script (smart@paxc.co.kr)

| 키 | 용도 |
|---|---|
| `OPENAI_API_KEY` | GPT 호출 (사용자 보유, sk-...) |
| `NOTION_TOKEN` | 기존 (NotionSync.gs용) |
| `NOTION_DATABASE_ID` | 기존 |
| `MAILER_WEBAPP_URL` | bpksmart26 Apps Script Web App URL |
| `MAILER_TOKEN` | 32자 랜덤 시크릿 (bpksmart26 Apps Script와 동일 값) |
| `MAKE_TOKEN` | 32자 랜덤 시크릿 (Make 백업 호출 검증용, 별도 값) |
| `GUIDE_DRIVE_FOLDER_ID` | `1FPJebwdF6HeoKd-UXFMKYhowHxJL6arY` |

### 메일 전용 Apps Script (bpksmart26@gmail.com)

| 키 | 용도 |
|---|---|
| `MAILER_TOKEN` | 메인과 동일 시크릿 (요청 검증) |

---

## 5. 오류 처리

| 실패 지점 | 동작 |
|---|---|
| OpenAI API 실패 | `status='발송실패'`, `error=원인`. 같은 회사 견적 재발급 시 자동 재시도 |
| GPT 응답 파싱 실패 (PART 5개 미만) | `status='발송실패'`, `error='GPT 응답 형식 오류'`. 로그에 raw 응답 |
| Drive 저장 실패 | `error=원인`. Logger.log + 시트 업데이트 시도 |
| 메일 Web App 응답 NG | `status='발송실패'`, `error=원인`, `send_request=FALSE` (사용자가 노션에서 재체크하거나 Make 백업 사용) |
| Mailer 토큰 불일치 | bpksmart26 Apps Script가 401 응답. 메인 Apps Script 로그에 기록 |
| 일일 Gmail 한도(100통) 초과 | 다음날 자동 재시도. 100통은 일반 운영상 충분 |
| 노션 sync 일시 실패 | `_sync_queue`에 retry (기존 메커니즘 재사용) |

---

## 6. 보안

- OpenAI/Notion/Mailer 토큰은 모두 `PropertiesService` 사용 (코드 하드코딩 금지)
- bpksmart26 Web App: 익명 접근 허용하되 **반드시 토큰 검증** (없으면 누구나 임의 메일 발송 가능)
- Make Webhook URL: Make 자체의 unguessable URL이 1차 방어, 메인 Apps Script 호출 시 `MAKE_TOKEN`으로 2차 방어
- 회사명 → 파일명 변환 시 path traversal 방지 (`/`, `\`, `..` 치환)
- HTML 치환은 PART 본문 영역만 — 외곽 디자인 영역 변조 불가하게 마커 검사

---

## 7. 테스트 계획

| # | 테스트 | 방법 | 통과 기준 |
|---|---|---|---|
| T1 | GPT 호출 단독 | Apps Script 에디터에서 `generateGuide(testRow)` 직접 실행 | 콘솔에 마크다운 5 PART 출력 |
| T2 | HTML 템플릿 치환 | `_template.html` + 더미 스크립트로 합성 | Drive에 저장된 HTML을 브라우저에서 열어 5 PART 본문 확인 |
| T3 | bpksmart26 Web App 인증 | curl/Postman으로 잘못된 token 보냄 | `unauthorized` 응답 |
| T4 | bpksmart26 메일 발송 | curl로 정상 token + 더미 HTML | bpksmart26 보낸함에 메일 확인 |
| T5 | 첨부파일 검증 | T4 + attachments 추가 | 수신함에서 PDF 열림 |
| T6 | E2E (자동 생성) | 테스트 회사로 견적 발급 | 시트에 8개 컬럼 채워짐, Drive에 v1 파일 |
| T7 | E2E (폴링 발송) | 노션에서 체크 → 5분 대기 | 메일 수신, 시트에 `발송완료` |
| T8 | 재발급 | 같은 회사 견적 재발급 | v2 파일 생성, 시트 status='대기중'으로 reset |
| T9 | Make 백업 | 노션 [즉시발송] URL 클릭 | 5분 안 기다리고 즉시 발송 |
| T10 | 발송 실패 시뮬 | 잘못된 이메일로 발송 시도 | status='발송실패', error 기록, send_request 유지 |

---

## 8. 작업 순서 (오늘 안 완료 목표)

| 순서 | 작업 | 예상 | 담당 |
|---|---|---|---|
| 1 | `_template.html`을 Drive 폴더에 업로드 | 5분 | 사용자 ✅ 완료 |
| 2 | bpksmart26@gmail.com에 신규 Apps Script 프로젝트 생성, 코드 작성 + Web App 배포 | 20분 | 사용자(가이드 제공) |
| 3 | bpksmart26 Web App URL + `MAILER_TOKEN` 양쪽 PropertiesService에 입력 | 10분 | 사용자 |
| 4 | `OPENAI_API_KEY`, `GUIDE_DRIVE_FOLDER_ID` 메인 PropertiesService에 입력 | 5분 | 사용자 |
| 5 | 노션 DB에 8개 속성 추가 + Select 옵션 3개 등록 | 15분 | 사용자(가이드 제공) |
| 6 | `Code.gs` 코드 작업 (UNIFIED_COLS 확장, generateGuide, pollAndSend, sendGuideNow, saveQt 후크) | 90분 | Claude |
| 7 | `NotionSync.gs` 매핑 8개 컬럼 추가 | 20분 | Claude |
| 8 | 시간 트리거 추가 (`pollAndSend`, 5분 단위) | 5분 | 사용자 |
| 9 | T1~T7 E2E 테스트 | 30분 | 함께 |
| 10 | Make 백업 시나리오 셋업 (옵션) | 20분 | 사용자 |

**합계 ~3.5시간**, 병렬 작업 시 단축 가능.

---

## 9. 비용 추정

| 항목 | 비용 | 비고 |
|---|---|---|
| OpenAI gpt-4o-mini | ~$1 (1,400원) | 1,900회사 모두 생성 가정 |
| Apps Script | 무료 | 두 계정 모두 무료 한도 내 |
| Make.com | 무료 | 백업용 ~500회 가능 |
| Drive 저장 | 무료 | 텍스트 파일 < 100KB × 수천 |
| Gmail 발송 | 무료 | 일 100통 한도 충분 |

---

## 10. 향후 개선 (이번 범위 밖)

- 발송 결과 대시보드 (성공률, 실패 회사 목록)
- 가이드 메일 본문 BPK 담당자 검토 UI (공급기업_관리.html에 미리보기 모달)
- 한국어 외 언어 지원
- A/B 테스트 (스크립트 톤 변형)
