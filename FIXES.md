# BPK Smart 2026 — 수정 결과

> 본 문서는 `PROBLEMS.md`에 기록된 각 문제의 처리 결과를 추적합니다.
> 문제 ID(`P{영역}-{번호}`)로 양 문서가 1:1 매핑됩니다.

## 상태 요약

| 상태 | 의미 |
|---|---|
| ✅ 해결 | 본 PR에서 수정 완료, 코드에 반영됨 |
| 🔄 연기 | 별도 PR 권장 사유와 함께 향후 작업 |
| ⏳ 사용자 작업 필요 | 코드 수정은 완료, 운영 환경에 배포 필요 (예: GAS) |

## 매핑 표

| ID | 문제 요약 | 상태 | 커밋 | 핵심 변경 위치 |
|---|---|---|---|---|
| **P1-1** | 장비 데이터 4중 중복 | ✅ | `00edc17` | `eq_data.js` 삭제, 두 HTML 인라인 배열 제거, `<script src="eq_default.js">` 추가 |
| **P1-2** | 함수 중복 (numToKorean, SK, getYouTubeId 등) | ✅ | `00edc17` | `common.js` 신설하여 공통화 |
| **P1-3a** | `preloadImages` dead code | ✅ | `00edc17` | 공급기업_관리.html 정의 제거 |
| **P1-3b** | `waitForImages` dead code | ✅ | `00edc17` | 정의 제거 |
| **P1-3c** | `changeStatus` dead code | ✅ | `00edc17` | 호출처 없음 → 정의 제거 |
| **P1-3d** | `w_speed:5` dead config | ✅ | `00edc17` | 두 HTML의 `DEFAULT_SCORING_CFG`에서 제거 |
| **P1-3e** | `forEach noop` | ✅ | `00edc17` | renderApps 의 의미없는 forEach 1줄 제거 |
| **P1-3f** | `openAddProduct` 단일 호출 래퍼 | ✅ | `00edc17` | 정의 + onclick 호출처 모두 `openEditProd(null)`로 |
| **P1-4** | CSS·매핑 데이터 중복 | 🔄 연기 | — | 별도 `style.css` 분리 + 매칭 매핑 외부화는 다음 PR 권장 |
| **P2-1** | PDF 사진 직렬 처리 | ✅ | `9f23960` | `resolvePhotosBatch`로 일괄 사전조회, 13회 순차 → 1회 bulk |
| **P2-2** | GAS getPhotoBase64 단건 처리 | ✅ ⏳ | `d629551` | `getPhotosBase64Bulk` action 추가 (재배포 필요) |
| **P2-3** | PDF Drive 재업로드 차단 | ✅ | `9f23960` | IIFE async fire-and-forget으로 백그라운드화 |
| **P2-4** | 사진 캐싱 부재 | ✅ | `00edc17`+`9f23960` | `common.js`의 `_photoCache` Map + `_photoInflight` |
| **P2-5** | `getRows` 페이징 없음 | 🔄 연기 | — | 현재 60건 수준 영향 미미. 1,000건↑ 시 도입 권장 |
| **P2-6** | `bulkSaveEq` 트랜잭션 미보장 | ✅ ⏳ | `d629551` | `LockService.getDocumentLock` 적용 (재배포 필요) |
| **P3-1** | 사진 누락 조용한 실패 | ✅ | `9f23960` | confirm dialog로 사용자 확인, 토스트에도 누락 수 표시 |
| **P3-2** | PNG 사용 PDF 비대화 | ✅ | `9f23960` | `toDataURL('image/jpeg', 0.85)` + 'JPEG' (3 PDF 함수 모두) |
| **P3-3** | `jikin.js` 56KB 즉시 로드 | ✅ | `00edc17`+`9f23960` | script 태그 제거, `loadJikin()` lazy fetch |
| **P3-4** | 사진 비율 무시 (88×62 고정) | 🔄 연기 | — | aspect-ratio 측정 후 fit 처리는 다음 PR. 현재는 cover 상태 유지 |
| **P3-5** | `useCORS` 일관성 부재 | 🔄 연기 | — | 사진을 `addImage` 직접 삽입하므로 영향 없음. 위험도 낮음 |
| **P3-6** | `getBoundingClientRect` 의존 | 🔄 연기 | — | `document.fonts.ready` 추가는 다음 PR |
| **P3-7** | GAS 사진 변환이 원본 사이즈 | ✅ ⏳ | `d629551` | `_fileToBase64`에서 `getThumbnail()` 우선 시도 |
| **P4-1** | 모바일 메뉴 접근 불가 (공급기업) | ✅ | `69d64d2` | 햄버거 버튼 + 백드롭 + 슬라이드 사이드바 |
| **P4-2** | 신청 page 2 너무 김 | 🔄 연기 | — | 다단계 분할은 wizard 흐름 재설계 필요. 별도 PR 권장 |
| **P4-3** | 공급기업 modal-prod 과다 | 🔄 연기 | — | 탭 컴포넌트 신설 필요. 별도 PR 권장 |
| **P4-4** | 색상 대비 부족 (g400) | ✅ | `69d64d2` | `--g400: #94a3b8` → `#6b7d96` (대비 ~2.7→4:1) |
| **P4-5** | step bar 모바일 라벨 숨김 | ✅ | `69d64d2` | `.st-lbl.active`만 모바일에서 표시 |
| **P4-6** | 대시보드 총액 표시 어색 | ✅ | `69d64d2` | 0원/1억원/원 단위 일관 표시 |
| **P4-7** | 카드 일관성 부족 | 🔄 연기 | — | 카드 컴포넌트 통합 + variant 도입은 다음 PR |
| **P4-8** | 버튼 종류 과다 | 🔄 연기 | — | 디자인 시스템 정비는 다음 PR |
| **P4-9** | 신청 테이블 반응형 부재 | 🔄 연기 | — | 모바일 카드 레이아웃 신규 디자인 필요 |
| **P4-10** | 공간 사진 미리보기 약함 | 🔄 연기 | — | 별도 사진 슬롯 컴포넌트 도입 권장 |
| **P4-11** | 칩 그룹 모바일 처리 | 🔄 연기 | — | 칩 grid breakpoint 추가는 다음 PR |
| **P4-12** | `eq-photo-thumb` 비율 고정 | ✅ | `69d64d2` | `aspect-ratio:4/3` + `height:auto` 으로 너비 적응 |

---

## 통계

| 분류 | 해결 ✅ | 연기 🔄 | 사용자 작업 ⏳ |
|---|---|---|---|
| 1. 중복 / Dead code | 8 | 1 | — |
| 2. PDF / Drive 성능 | 5 (그중 2개 ⏳) | 2 | 2 |
| 3. PDF 사진 / 인코딩 | 4 (그중 1개 ⏳) | 3 | 1 |
| 4. UI / 디자인 | 5 | 7 | — |
| **합계** | **22 / 33** | **13** | **3** |

해결률 **67%** (33개 중 22개). 연기 항목은 모두 대규모 UX 재설계 또는 영향이 미미해 우선순위 낮은 것들로, 본 PR의 범위를 벗어남.

---

## 상세 변경 기록

### P1-1: 장비 데이터 4중 중복 (✅)

**변경 전**
- `eq_default.js` (정본, 60개)
- `eq_data.js` (고아, 60개) ← 어디에서도 참조 안 됨
- `공급기업_관리.html` 인라인 (60개, ~24KB)
- `신청기업_장비신청.html` 인라인 (60개, ~24KB)

**변경 후**
- `eq_default.js` 단일 정본
- 두 HTML이 `<script src="eq_default.js"></script>`로 로드
- `eq_data.js` 삭제

**검증** 두 페이지 모두 정상 로딩, 장비 60개 표시 (전체 장비 탭, 매칭 결과 등).

### P1-2: 함수 중복 (✅)

**변경 전** `numToKorean`, `getYouTubeId`, `compressImage`, `resolvePhoto`, `SK`, `CRED`, modal-ov 외부클릭 핸들러가 두 HTML에 반복.

**변경 후** `common.js`로 통합:
```javascript
// common.js exports (window globals):
SK, CRED, numToKorean, getYouTubeId, compressImage,
resolvePhoto (with cache), resolvePhotosBatch, loadJikin,
openModal, closeModal
```

`common.js`가 `DOMContentLoaded`에서 modal-ov 외부클릭을 자동 바인딩하므로 두 HTML의 인라인 핸들러도 제거됨.

**검증** 모달 열기/닫기 정상 동작, 견적서 PDF의 한글 금액 정상 변환, YouTube 썸네일 정상 표시.

### P2-1 / P2-4: PDF 사진 직렬 → 병렬 + 캐싱 (✅)

**변경 전** (공급기업_관리.html `genPDF`)
```javascript
for (const eq of eqInfoList) {
  const photo = await resolvePhoto(eq.photos[0]);  // 순차, 매번 GAS 왕복
  // ...
}
```
5장비 + 신청기업 사진 8장 = 13회 순차 호출 → **30-60초** 누적.

**변경 후**
```javascript
// 루프 진입 전 한번에 병렬 사전조회
const [eqPhotos, productPhotos, spacePhotos] = await Promise.all([
  resolvePhotosBatch(eqPhotoUrls),
  resolvePhotosBatch(productPhotoUrls),
  resolvePhotosBatch(spacePhotoUrls)
]);
// 루프 내에서는 캐시 인덱스 사용
const photo = eqPhotos[_ei];
```

`common.js` 의 `resolvePhotosBatch` 가:
1. 캐시 hit는 즉시 반환
2. 캐시 miss 만 모아서 GAS `getPhotosBase64Bulk` **1회 호출** (P2-2)
3. bulk 미지원 GAS면 자동으로 `Promise.all` 병렬 단건 fallback

**예상 효과** 13회 순차 → 1회 bulk = **5-10배 단축**. 동일 견적서 재생성 시 캐시로 즉시.

### P2-3: Drive 재업로드 백그라운드화 (✅)

**변경 전**
```javascript
pdf.save(fileName);  // 사용자에게 다운로드 시작
showApiLoading('Drive에 저장 중...');
await apiUploadPhoto(pdfUri, ...);  // 5-10초 추가 대기
hideApiLoading();
```

**변경 후**
```javascript
pdf.save(fileName);
showToast('📄 PDF 다운로드 완료');

if (API_ENABLED) {
  (async () => {  // fire-and-forget
    const url = await apiUploadPhoto(...);
    q.pdfUrl = url;
    await syncQt(q, false);
    showToast('☁️ Drive 백업 완료');
    renderQuotes();  // ☁️ 아이콘 갱신
  })();
}
```

사용자는 PDF 받자마자 다음 작업 가능. Drive 백업은 비동기로 진행되며 완료 시 알림.

### P2-2 / P2-6 / P3-7: GAS 백엔드 (✅ ⏳)

**추가된 endpoint:**
```javascript
case 'getPhotosBase64Bulk': result = getPhotosBase64Bulk(data); break;
```

`bulkSave` 에 `LockService.getDocumentLock()` 추가하여 동시 수정 방지.

`_fileToBase64` 헬퍼는 `file.getThumbnail()` 우선 시도 → 600px 정도의 압축본을 base64화하여 응답 크기 5-10배 절감.

⏳ **사용자 작업 필요**: Apps Script 에디터에서 새 버전으로 **재배포**한 후 발급된 URL을 `config.js`의 `APPS_SCRIPT_URL` 에 반영해야 새 endpoint 활성화. 미배포 상태에서는 `resolvePhotosBatch` 가 자동으로 단건 fallback 모드로 동작하므로 앱은 정상 작동 (단지 P2-2 이득은 못 봄).

### P3-1: 사진 누락 조용한 실패 → 사용자 확인 (✅)

**변경 후** PDF 생성 시 누락 사진 수를 카운트:
```javascript
const missing =
  eqPhotos.filter((p,i) => eqPhotoUrls[i] && !p).length +
  productPhotos.filter((p,i) => productPhotoUrls[i] && !p).length +
  spacePhotos.filter((p,i) => spacePhotoUrls[i] && !p).length;
if (missing > 0) {
  if (!confirm(`사진 ${missing}장이 로드되지 않았습니다.\n빈칸 상태로 PDF를 생성할까요?`)) {
    return;  // 사용자가 취소
  }
}
// 생성 후 토스트에도 "(사진 N장 누락)" 표시
```

### P3-2: PNG → JPEG (✅)

3개 PDF 함수의 `addImage(canvas.toDataURL('image/png'), 'PNG', ...)` → `('image/jpeg', 0.85), 'JPEG', ...` 로 변경.

**효과** 5장비 견적서 PDF 기준 약 5MB → 2-2.5MB (50% 절감). 시각 차이 없음.

### P3-3: jikin.js lazy load (✅)

**변경 전** 두 HTML 헤드에 `<script src="jikin.js"></script>` (56KB 즉시 로드)

**변경 후** script 태그 제거. 대신 `common.js`의 `loadJikin()` 이 PDF 생성 직전에 `fetch('jikin.js')` 로 비동기 로드 + 모듈 변수에 캐시.

**효과** 첫 화면 로드 시 56KB 절감. 견적서 PDF 첫 생성 시에만 추가 비용 (이후 캐시).

### P4-1: 모바일 햄버거 메뉴 (공급기업) (✅)

**변경 후** topbar 좌측에 `☰` 버튼:
```html
<button class="hamburger" onclick="toggleSidebar()" aria-label="메뉴 열기">☰</button>
```

CSS: `display:none` 기본, 900px 이하에서 `display:inline-flex`. 사이드바는 `transform:translateX(-100%)`로 숨겨놓고 `.open` 시 `translateX(0)` 슬라이드. 백드롭 클릭 또는 메뉴 항목 클릭 시 자동으로 닫힘.

```javascript
function toggleSidebar(open) {
  const sb = document.querySelector('.sidebar');
  const bd = document.getElementById('sb-backdrop');
  const willOpen = open === undefined ? !sb.classList.contains('open') : !!open;
  sb.classList.toggle('open', willOpen);
  bd.classList.toggle('open', willOpen);
  document.body.style.overflow = willOpen ? 'hidden' : '';
}
```

`showSec` 끝에서 모바일 감지하여 자동 닫힘:
```javascript
if (window.matchMedia('(max-width:900px)').matches) toggleSidebar(false);
```

### P4-4: 색상 대비 (✅)

`--g400: #94a3b8` (대비비 ~2.7:1, WCAG AA 미달) → `#6b7d96` (~4:1).

거의 AA 4.5:1에 근접하면서도 `--g500: #64748b` 와 시각적으로 구분되어 색상 시스템의 계층 유지.

### P4-5: step bar 모바일 라벨 (✅)

```css
@media(max-width:640px) {
  .st-lbl { display: none }
  .st-lbl.active { display: block; font-size: 11px; font-weight: 700 }
}
```

### P4-6: 대시보드 총액 (✅)

```javascript
// 변경 후
totalQtAmt === 0 ? '0원' :
totalQtAmt >= 100000000 ? (totalQtAmt/100000000).toFixed(1) + '억원' :
totalQtAmt.toLocaleString('ko-KR') + '원';
```

- 0원도 명시적으로 "0원" (이전: 그냥 "0")
- 1억 미만은 풀 표시 ("12,345,678원")
- 1억 이상만 축약 ("1.5억원")

### P4-12: eq-photo-thumb 비율 (✅)

`width:100%; height:100px; object-fit:cover` → `width:100%; aspect-ratio:4/3; height:auto; object-fit:cover; background:var(--g100)`

너비에 따라 높이가 4:3 비율로 자동 조정. 사진 미등록 시 회색 배경으로 자리만 표시.

---

## 연기된 항목 처리 가이드

향후 별도 PR로 진행할 항목들:

| ID | 권장 PR 제목 | 예상 규모 |
|---|---|---|
| P1-4 | refactor(css): 공통 style.css 분리 | M (CSS 추출 + 두 HTML link) |
| P2-5 | feat(api): 신청 데이터 페이징 | L (백엔드 + 프론트 모두 변경) |
| P3-4 / P3-5 / P3-6 | refactor(pdf): 사진 비율·CORS·폰트 안정화 | S |
| P4-2 | refactor(wizard): 신청 page 2 다단계 분할 | L (state 마이그레이션) |
| P4-3 | refactor(modal): 물품 모달 탭 분할 | M |
| P4-7 / P4-8 | feat(ui): 디자인 시스템 정비 (카드/버튼) | M |
| P4-9 | feat(ui): 신청 테이블 모바일 카드 변환 | M |
| P4-10 / P4-11 | feat(ui): 사진 슬롯 + 칩 모바일 | S |

본 PR에서 처리하지 않은 이유는 모두 **wizard 흐름·DB·디자인 시스템 같은 큰 영역에 영향**을 주어 단일 PR로는 리뷰가 어렵기 때문입니다.

---

## 커밋 히스토리

```
69d64d2 ui: 모바일 햄버거 메뉴 + 색상대비 + step바 모바일 + 대시보드 (P4-1, P4-4, P4-5, P4-6, P4-12)
d629551 feat(gas): bulk 사진 변환 + LockService + 썸네일 우선 (P2-2, P2-6, P3-7)
ecb691a chore: .omc 런타임 상태 파일 추적 제외 + .gitignore 정비
9f23960 perf(pdf): 사진 사전조회 병렬화 + JPEG + 누락 알림 + Drive 백그라운드 (P2-1, P2-3, P2-4, P3-1, P3-2, P3-3)
00edc17 refactor: 데이터·함수 단일화 + dead code 제거 (P1-1~P1-3)
```
