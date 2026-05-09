# BPK Smart 2026 — 프로젝트 작업 현황

> 마지막 업데이트: 2026-05-09 (10차 세션)  
> 작업 디렉토리: `C:\bpksmart2026\`  
> GitHub: `https://github.com/bpksmart26/bpksmart2026.git`  
> Apps Script URL: `https://script.google.com/macros/s/AKfycbx8nPCdXAquqKdtohklR29_OOKPuBQE4P9cAGqGxJnONY42OpaCeFQorUPN8O91qqGb/exec`

---

## 📁 파일 구조

| 파일 | 설명 |
|------|------|
| `공급기업_관리.html` | 관리자(공급기업) 전용 페이지 — 로그인, 물품 관리, 견적서 관리, 대시보드 |
| `신청기업_장비신청.html` | 신청기업(고객) 전용 페이지 — 5단계 장비 신청 위자드, 장비 매칭 결과 |
| `api.js` | 공통 API 헬퍼 — apiCall, apiUploadPhoto, initApiStatus, showToast 등 |
| `config.js` | Apps Script URL 설정 (`APPS_SCRIPT_URL`) |
| `jikin.js` | 직인 이미지 base64 (`JIKINTB64`) — PDF 직인용 |
| `apps_script/Code.gs` | Google Apps Script 백엔드 — Sheets CRUD, Drive 업로드, getPhotoBase64 |
| `eq_default.js` | 장비 데이터 원본 (60개 장비) |

---

## ⚠️ 다음 세션 시작 전 반드시 확인

### Apps Script에 `getPhotoBase64` 함수가 있는지 확인 필요
PDF 사진 출력이 이 함수에 의존함. Apps Script 에디터에서 확인 후 없으면 아래 코드 추가:

```javascript
function getPhotoBase64(data) {
  try {
    var url = String(data.url || '');
    var m = url.match(/[?&]id=([^&\s]+)/) || url.match(/\/file\/d\/([^/?]+)/);
    var fileId = m ? m[1] : '';
    if (!fileId) return { ok:false, error:'fileId 없음' };
    var file = DriveApp.getFileById(fileId);
    var blob = file.getBlob();
    var mime = blob.getContentType() || 'image/jpeg';
    return { ok:true, base64: 'data:' + mime + ';base64,' + Utilities.base64Encode(blob.getBytes()) };
  } catch(e) {
    return { ok:false, error: e.toString() };
  }
}
```

추가 후 **배포 → 배포 관리 → 새 버전 업데이트** → 새 URL을 `config.js`에 반영.

---

## ✅ 10차 세션 완료 작업

### 동영상 가이드 메일 자동 생성·발송
- bpksmart26@gmail.com에 메일 전용 Apps Script 분리 (단일 책임: GmailApp 발송)
- smart@paxc.co.kr 메인에 `apps_script/GuideMail.gs` 신규
  - `generateGuide`: 견적 발급 시 자동 트리거, GPT-4o-mini로 5 PART 스크립트 생성 → HTML 합성 → Drive 저장 → 시트 8개 컬럼 업데이트
  - `pollAndSend`: 5분 시간 트리거로 노션 발송요청 체크박스 폴링·발송. LockService + MAX_PER_TICK 30 cap으로 안전성 확보
  - `sendGuideForRow`: 단일 행 발송 + 5분 멱등성 윈도우 (Make 재시도 안전망) + PDF 20MB 초과 시 첨부 생략
  - `sendGuideNow`: Make.com 백업 진입점 (token 검증)
- `apps_script/mailer/Code.gs` 신규 (bpksmart26 Apps Script 소스 추적용)
- `Code.gs`: UNIFIED_COLS에 가이드 8개 컬럼 추가, saveQt 후크에 generateGuide 호출 추가, doPost에 sendGuideNow 케이스
- `NotionSync.gs`: NOTION_PROP_MAP에 가이드 7개 필드 매핑, BIDIRECTIONAL_FIELDS에 guide_send_request 양방향 추가
- Drive에 `회사명_가이드메일_YYYYMMDD-HHmm_v{N}.html` 버전 보관 (재발급 시 v2/v3...)
- 한글 상태값: 대기중 / 발송완료 / 발송실패 (노션 Select)
- 스펙: `docs/superpowers/specs/2026-05-09-video-script-email-guide-design.md`
- 계획: `docs/superpowers/plans/2026-05-09-video-script-email-guide.md`

## ✅ 9차 세션 완료 작업

### PDF 사진 출력 완전 해결
- **원인**: html2canvas가 이미지 디코딩 전에 캡처 → 빈칸 발생
- **해결**: html2canvas 템플릿에서 img 태그 제거, `pdf.addImage()`로 사진 직접 삽입
  - 장비 사양 페이지: spacer div + `getBoundingClientRect()`로 위치 계산 후 `pdf.addImage()`
  - 제품/설치장소 사진 페이지: 헤더 텍스트만 html2canvas, 사진 4장 모두 `pdf.addImage()`
  - `genEquipPDF` 동일 방식 적용
- Apps Script 재배포 및 `config.js` URL 업데이트
- GitHub push 완료

---

## ✅ 8차 세션 완료 작업

### GitHub 연동
- `https://github.com/bpksmart26/bpksmart2026.git` 레포지토리에 전체 코드 업로드
- PAT 인증으로 push 설정 (GitHub Developer Settings에서 PAT 재발급 필요 시 확인)
- `jikin.js` → `.gitignore`에서 제거하고 커밋 (배포 사이트에서 직인 표시 문제 해결)

### 사진 저장 방식 전환 (Drive 썸네일 URL)
- 장비 사진 업로드 시 Google Drive에 저장 후 썸네일 URL 반환
  - `https://drive.google.com/thumbnail?id=FILE_ID&sz=w600`
- `api.js`에서 base64 캐시/변환 로직 제거 (단순화)
- `공급기업_관리.html` `saveProd()`: base64인 신규 사진만 Drive 업로드, 기존 URL 유지

### 신청기업_장비신청.html — 선택 버그 수정
- `updateSelBar()`: 선택 장비명 필로 표시 (선택된 장비 이름 표시)
- `goStep4()`: `.filter(Boolean)` 추가로 미등록 장비 ID crash 방지
- `EQUIPMENT.find()` 비교: `String(e.id) === String(id)` 방어 처리

### PDF 사진 출력 수정 (CORS 문제 해결)
- **문제**: Drive 썸네일 URL → html2canvas CORS 차단 → PDF에 사진 빈칸
- **해결 방법 1**: `Code.gs`에 `getPhotoBase64` 함수 추가
  - Drive 파일 ID 추출 → `DriveApp.getFileById()` → base64 반환
  - 스위치에 `case 'getPhotoBase64'` 추가
- **해결 방법 2 (최종)**: `resolvePhoto(url)` 헬퍼 함수 추가
  - **html2canvas에 넣기 전에** Drive URL → base64로 미리 변환
  - `genPDF()`, `genEquipPDF()` 모두 적용
  - `preloadImages()` 의존 제거 (불안정했음)

### 견적서 PDF에 신청기업 사진 추가
- `genPDF()`: 장비 사양 페이지 이후에 추가 페이지 삽입
  - **제품 사진** (application.product_photos) — 페이지당 4장 (2×2)
  - **설치 장소 사진** (application.space_photos) — 페이지당 4장 (2×2)
  - 사진 없는 섹션 자동 생략, 5장 이상 시 페이지 자동 분할
  - 각 페이지: 회사명 + 견적 ID 헤더, BPK 푸터

---

## ✅ 이전 세션 완료 작업 요약

### 1~5차 세션 (기반 구축)
- 장비 60개 데이터 정비 (`eq_default.js`)
- 신청기업 5단계 위자드 기본 구조
- 장비 매칭 알고리즘 (공정별 그룹화, 점수화, 통합 추천)
- 공급기업 관리: 장비사진/포장사진/YouTube 등록, 견적서, 반응형
- 신청기업: 환경조건(전기/공압/공간/사진), 매칭 점수 환경 반영

### 6차 세션 — API/Sheets 연동
- Google Sheets 연동 (`apiCall`, `getEq`/`upsertEq`/`bulkSaveEq` 등)
- 신청기업: 탭/선택UX 전면 개선, 공정 문제점 체크리스트, 속도 프리셋
- `APP_COLS` 확장: `problem_type`, `problem_points`, `product_photos`

### 7차 세션 — 견적서 PDF 전면 재설계
- `genPDF()`: 見積書 레이아웃 (직인 포함), 장비 사양 페이지 자동 추가
- `genEquipPDF()`: 독립 장비사양 PDF
- `jikin.js`: 실 직인 이미지 base64
- 스펙 7개 필드: 생산속도/소비전력/포장재/치수/중량/공압/전원

---

## 🔲 미완료 / 다음 작업

### 1. 공급기업_관리.html — 견적서 확인 기능
- 신청기업이 확정 버튼 누르면 상태 변경되는 흐름
- 견적서 미리보기 (모달 내 PDF 미리보기)

### 3. 유튜브 채널 연동 (선택)
- `@daewon_pack` 채널 영상을 태그 검색으로 가져오는 기능
- YouTube Data API v3 필요

### 4. 공급기업_관리.html — 물품 목록 표시 개선
- 현재: 사진 수만 표시 (`📷 N장`)
- 개선: 포장사진 수, 영상 수도 함께 표시

---

## 🏗️ 주요 기술 구조

### 장비 데이터 구조 (Sheets `장비` 시트 / localStorage `bpk_eq_v2`)
```javascript
{
  id: Number,
  name: String, model: String, price: Number,
  category: String, desc: String, status: 'active'|'inactive',
  photos: String[],      // Drive 썸네일 URL 또는 base64
  photos_pkg: String[],  // 포장 제품 사진
  videos: String[],      // YouTube URL
  tags: String,
  tag_texture/pkg/process/product/feature/space/electric/air/keyword: String,
  spec_speed/power/packing/dimension/weight/air/voltage: String
}
```

### 신청 데이터 구조 (Sheets `신청` 시트)
```javascript
{
  id, company, ceo, bizno, phone, email, address,
  pname, texture, processes[], pkgtypes[], qty, speed, memo,
  problem_type, problem_points[], equipment[], electric[], air_yn, air_flow,
  space_w, space_h, space_photos[], product_photos[],
  status, date, manager
}
```

### 견적 데이터 구조 (Sheets `견적` 시트)
```javascript
{
  id, company, appId, process, memo, validUntil,
  items[{name, model, qty, unit, price}],
  total, eqCount, status, date, pdfUrl, equipPdfUrl
}
```

### PDF 생성 방식
- `html2canvas` + `jsPDF` (CDN)
- `genPDF(qtId)`:
  - 1페이지: 見積書 (직인 포함) — html2canvas
  - 2페이지~: 장비별 사양 — html2canvas(텍스트/표) + `pdf.addImage()`(사진)
  - 이후: 제품/설치장소 사진 페이지 — html2canvas(헤더) + `pdf.addImage()`(사진 4장)
- `genEquipPDF(qtId)`: 장비사양 PDF 단독 (동일 방식)
- `resolvePhoto(url)`: Drive URL → Apps Script `getPhotoBase64` → base64 반환

### 사진 저장 흐름
```
브라우저에서 사진 선택
  → compressImage() (최대 900px, JPEG 80%)
  → saveProd() / saveApp()
  → API_ENABLED이면 apiUploadPhotos() → Apps Script uploadPhoto()
  → Google Drive 저장 → 썸네일 URL 반환
  → Sheets에 URL 저장
PDF 생성 시:
  → resolvePhoto(driveUrl) → apiCall('getPhotoBase64')
  → Apps Script에서 Drive 파일 → base64 반환
  → html2canvas에 data:URL로 전달
```

### 관리자 로그인
- ID: `bpkadmin` / PW: `BPK2026!`

---

## 📋 세션 히스토리

| 세션 | 주요 작업 |
|------|----------|
| 1차 | eq_default.js 장비 60개 데이터 정비, photos 필드 추가 |
| 2차 | 신청기업 5단계 위자드 기본 구조, 공급기업 관리 화면 기본 구조 |
| 3차 | 장비 매칭 알고리즘 — 공정별 그룹화, 점수화, 통합 추천, 상세 모달 |
| 4차 | 공급기업_관리: 장비사진/포장사진/YouTube 등록, 견적서 모델명+공급가액, 장비사진 PDF, 반응형 |
| 5차 | 신청기업: 전기/공압/설치공간/공간사진 추가, 매칭 점수 환경조건 반영 |
| 6차 | 신청기업 장비매칭 탭/선택UX 전면개선, 공정문제점 체크리스트, 속도프리셋, API/Sheets 연동 |
| 7차 | 견적서 PDF 전면 재설계(직인/레이아웃), 장비사양 PDF, jikin.js, 스펙 7개 필드 |
| 8차 | GitHub 연동, Drive 썸네일 URL 방식, PDF CORS 해결(resolvePhoto), 견적서에 신청기업 사진 추가 |
| 9차 | PDF 사진 출력 완전 해결 — pdf.addImage() 직접 삽입으로 html2canvas 이미지 렌더 이슈 우회 |

---

*이 파일은 `C:\bpksmart2026\PROJECT_STATUS.md` 에 저장됩니다.*  
*다음 세션 시작 시 자동으로 로드됩니다.*
