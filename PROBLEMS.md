# BPK Smart 2026 — 코드 분석: 발견된 문제점

> 분석 일자: 2026-05-06
> 분석 대상 커밋: `f721236` (master)
> 분석 범위: 공급기업_관리.html, 신청기업_장비신청.html, api.js, config.js, jikin.js, eq_default.js, eq_data.js, apps_script/Code.gs

본 문서는 **수정 전 시점의 문제 스냅샷**입니다. 각 문제는 고유 ID(`P{영역}-{번호}`)를 가지며 `FIXES.md`에서 동일 ID로 참조됩니다.

## 심각도 기준

- 🔴 **Critical** — 데이터 정합성 / 보안 / 운영 차질을 일으킬 수 있음
- 🟠 **High** — 사용자 체감 성능·UX에 직접적 영향
- 🟡 **Medium** — 코드 품질·유지보수에 영향, 기능 자체엔 문제 없음

---

## 1. 중복 / Dead Code

### P1-1 장비 데이터 4중 중복 🔴

**위치**
- `eq_default.js` (정본, PROJECT_STATUS.md 명시)
- `eq_data.js` — **어디에서도 참조되지 않는 고아 파일**
- `공급기업_관리.html:748-808` 인라인
- `신청기업_장비신청.html:969-1029` 인라인

**증상** 60개 장비 데이터가 네 곳에 동일하게 박혀있어 `~80KB` 의 중복 텍스트 발생.

**영향** 한 곳을 수정해도 다른 세 곳은 옛 데이터 유지 → 화면별로 다른 장비 정보가 표시될 위험. 신뢰성 / 유지보수성에 직접적 위협.

---

### P1-2 함수 중복 🟠

**위치**
| 함수 | 정의 위치 |
|---|---|
| `numToKorean` | `공급기업_관리.html:1551`, `신청기업_장비신청.html:1876` |
| `getYouTubeId` 정규식 | `공급기업_관리.html:1304`, `신청기업_장비신청.html:1672` 인라인 |
| `compressImage` | 두 HTML 모두 동일 |
| `resolvePhoto` | 두 HTML (다만 신청기업은 PDF 단순화로 부분 사용) |
| `const SK = {...}` | `공급기업_관리.html:741`, `신청기업_장비신청.html:964` |
| 견적서 PDF 1페이지 HTML 템플릿 | `공급기업_관리.html:1602-1658`, `신청기업_장비신청.html:1924-1970` |

**영향** DRY 원칙 위배. 한 쪽만 수정 시 두 화면이 다른 동작.

---

### P1-3 죽은 코드 (Dead Code) 🟠

| ID | 위치 | 코드 | 사유 |
|---|---|---|---|
| P1-3a | `공급기업_관리.html:1233-1253` | `async function preloadImages(el)` | PROJECT_STATUS.md 8차 세션에 "preloadImages 의존 제거 (불안정했음)" 명시. 정의만 있고 호출 없음 |
| P1-3b | `공급기업_관리.html:1275-1281` | `async function waitForImages(el)` | 정의만 있고 호출 없음 |
| P1-3c | `공급기업_관리.html:1114-1120` | `async function changeStatus(id, status)` | 어디에서도 호출 안 함 (UI 버튼 제거된 흔적) |
| P1-3d | `공급기업_관리.html:969`, `신청기업_장비신청.html:1302` | `w_speed:5` 가중치 | UI에 입력 필드(`cfg-w_speed`) 없음. 매칭 로직이 별도 처리하므로 dead config |
| P1-3e | `공급기업_관리.html:1058` | `['st-total','st-new','st-ok','st-rev'].forEach(id=>document.getElementById(id))` | DOM 조회 후 결과 무시 — no-op |
| P1-3f | `공급기업_관리.html:1212` | `function openAddProduct(){ openEditProd(null); }` | 단일 호출 래퍼, `openEditProd(null)` 직접 호출 가능 |

---

### P1-4 데이터 구조·CSS 중복 🟡

- `:root` 변수, `.btn`, `.fc`, `.modal-ov`, PDF 스타일 등 **CSS 약 250줄이 사실상 동일**.
- `PROC_MAP_G`, `PKG_MAP_G`, `TEXTURE_MAP_G`, `DEFAULT_SCORING_CFG` 모두 두 파일에 (또는 매칭 로직과 함께) 중복.

---

## 2. PDF / Drive 성능

### P2-1 PDF 사진 직렬 처리 🔴

**위치** `공급기업_관리.html:1677-1733`, `1741-1782`

**증상**
```javascript
for (const eq of eqInfoList) {
  pdf.addPage();
  const photo = await resolvePhoto(eq.photos[0]);  // 매 루프마다 GAS 1회 왕복
  // ...
}
```

장비 5개 + 신청기업 사진 8장이면 → **resolvePhoto 13회 순차 호출** → 누적 30-60초.

**영향** 사용자가 "사진 로딩 중..." 화면을 길게 본다. PDF 생성 체감속도 최악 부분.

---

### P2-2 GAS getPhotoBase64 단건 처리 🟠

**위치** `apps_script/Code.gs:314-327`

**증상** Apps Script 측에서 한 번에 한 사진만 변환. 5장 사진이면 5번의 doPost / cold start 비용.

**영향** P2-1과 결합되어 누적 응답시간 악화.

---

### P2-3 PDF Drive 재업로드 (왕복 2회) 🟠

**위치** `공급기업_관리.html:1791-1803`

**증상**
```javascript
pdf.save(fileName);                                   // 1회: 사용자 다운로드
const pdfUri = pdf.output('datauristring');           // ~2-5MB base64
const url = await apiUploadPhoto(pdfUri, fileName);   // 2회: Drive 업로드 (5-10초)
```

**영향** 사용자는 이미 다운로드 받았는데 화면은 계속 로딩.

---

### P2-4 사진 캐싱 부재 🟠

**증상** 같은 견적서를 두 번 PDF로 만들어도 동일 사진을 두 번 base64 변환. 페이지 새로고침 후에도 동일.

**영향** 동일 사용자 반복 작업 시 매번 풀 비용.

---

### P2-5 `getRows` 페이징 없음 🟡

**위치** `apps_script/Code.gs:152-170`

**증상** `sheet.getDataRange().getValues()` 로 전체 시트 로드 후 매핑. 신청 1,000건 누적 시 매 페이지 로드마다 1,000행 + 27컬럼 + 사진 URL JSON 모두 가져옴.

**영향** 운영 1년 시점부터 체감. 현 시점 60건 수준에서는 문제 없음.

---

### P2-6 `bulkSaveEq` 트랜잭션 보장 부재 🟠

**위치** `apps_script/Code.gs:234-243`

**증상**
```javascript
sheet.clearContents();           // ← 시트 전체 비움
sheet.appendRow(cols);
sheet.getRange(...).setValues(values);
```

전송 중 다른 사용자가 동시 수정 시 데이터 손실 위험. `LockService` 미사용.

**영향** 여러 관리자가 동시 작업하면 한 쪽이 묻힐 수 있음.

---

## 3. PDF 사진 누락 / 인코딩

### P3-1 사진 누락 시 사용자 알림 없음 🔴

**위치** `공급기업_관리.html:1730-1733`, `1780-1782`

**증상**
```javascript
if (photo) {
  try { pdf.addImage(photo, 'JPEG', ...); }
  catch (e) { try { pdf.addImage(photo, 'PNG', ...); } catch (e2) {} }  // 조용한 실패
}
```

`resolvePhoto`가 `null` 반환해도 PDF 생성 그대로 진행 → 사진 자리 빈 PDF가 발행됨.

**영향** 신청기업이 견적서를 받았는데 사진이 비어있음 → 신뢰도 타격.

---

### P3-2 PNG 사용으로 PDF 비대화 🟠

**위치** `공급기업_관리.html:1672, 1727, 1772`, `신청기업_장비신청.html:1983`

**증상**
```javascript
const c1 = await html2canvas(tpl, {scale:2});
pdf.addImage(c1.toDataURL('image/png'), 'PNG', ...);
```

A4 1장 @ scale:2 PNG = 800KB ~ 1.5MB. 5장비 PDF 합치면 5-10MB.

**영향** PDF 파일 크기 비대 + 생성 시간 증가. JPEG quality 0.85로 50% 절감 가능.

---

### P3-3 jikin.js 56KB 즉시 로드 🟡

**위치** 두 HTML의 `<script src="jikin.js">` (line 15)

**증상** PDF 다운로드 안 하는 사용자도 매 진입 시 56KB base64 inline 이미지 로드. 동기 로드라 First Paint 늦춤.

**영향** 모바일 / 느린 네트워크에서 첫 화면 표시 지연.

---

### P3-4 사진 비율 무시 🟡

**위치** `공급기업_관리.html:1775-1782`

**증상** 사진 그리드는 88×62mm (4:3) 고정. 세로 사진은 일그러짐.

```javascript
const photoW=88, photoH=62;
pdf.addImage(resolved[i], 'JPEG', x, y, photoW, photoH, undefined, 'FAST');
```

**영향** 신청기업이 세로로 찍은 제품 사진이 PDF에서 왜곡되어 표시.

---

### P3-5 `useCORS` 일관성 부재 🟡

**위치**
- `genPDF` 1페이지: `useCORS:true` (line 1669)
- `genPDF` 장비페이지: `useCORS:false` (line 1725)
- `genEquipPDF`: `useCORS:false` (line 1874)

**영향** 현재는 `pdf.addImage` 직접 삽입이라 영향 없으나 향후 `<img>` 추가 시 혼란을 부름.

---

### P3-6 `getBoundingClientRect()` 의존 🟡

**위치** `공급기업_관리.html:1721, 1764, 1869`

**증상** `eTpl` 의 위치가 `left:-9999px` → `left:0` 전환 후 측정. 한글 폰트(Pretendard) CDN 늦게 로드 시 레이아웃이 변하면서 사진 위치 어긋남.

**영향** 가끔 사진 위치가 어긋난 PDF 발행 (재현이 어려운 버그).

---

### P3-7 GAS 사진 변환이 원본 사이즈 🟡

**위치** `apps_script/Code.gs:319-323`

**증상** `DriveApp.getFileById(fileId).getBlob()` 으로 **원본** base64화. 업로드 시 900px 압축이 안 된 사진은 그대로 큰 base64 반환.

**영향** PDF가 비대해지고 base64 응답이 느려짐.

---

## 4. UI / 디자인 / 배치

### P4-1 모바일 메뉴 접근 불가 (공급기업) 🔴

**위치** `공급기업_관리.html:288-292`

**증상**
```css
@media (max-width: 900px) {
  .sidebar { display: none }   /* 사이드바 숨김 */
  /* 햄버거 메뉴 없음 → 다른 섹션 이동 불가 */
}
```

900px 이하에서 사이드바 사라지지만 **대체 메뉴 없음**.

**영향** 모바일에서 첫 화면(신청업체관리) 외 다른 섹션 접근 불가.

---

### P4-2 신청 page 2가 너무 김 🟠 [연기]

**위치** `신청기업_장비신청.html:522-792`

**증상** 한 페이지에 10개 섹션 (제품정보, 물성11종, 포장13종, 문제점7종, 공정10종, 속도4종, 전기, 공압, 공간, 사진).

**영향** 데스크톱도 3-4 화면 분량, 모바일 5-6 화면 → 이탈 가능성 높음.

**연기 이유** wizard 흐름 재설계 + STATE 마이그레이션 필요. 별도 PR 권장.

---

### P4-3 공급기업 modal-prod 과다 🟠 [연기]

**위치** `공급기업_관리.html:556-699`

**증상** 한 모달에 기본정보 + 사진 + 영상 + 9태그 + 7스펙. 모달 본문이 화면의 2-3배.

**연기 이유** 탭 컴포넌트 신설 필요. 별도 PR 권장.

---

### P4-4 색상 대비 부족 (WCAG AA 미달) 🟠

**위치** 두 HTML의 `--g400: #94a3b8` 텍스트

**증상** `--g400` 텍스트 on 흰 배경 → 대비비 ~2.7:1 (WCAG AA 4.5:1 미달). 신청기업 카드 본문 가독성 낮음.

---

### P4-5 step bar 모바일 라벨 숨김 🟠

**위치** `신청기업_장비신청.html:413` 미디어 쿼리

**증상**
```css
@media (max-width: 640px) { .st-lbl { display: none } }
```

모바일에서 단계 라벨 모두 숨김 → 숫자만 남음. 어느 단계인지 알 수 없음.

---

### P4-6 대시보드 견적 발송 총액 표시 어색 🟡

**위치** `공급기업_관리.html:1912`

**증상**
- 0원이면 그냥 `0` (단위 없음)
- 1만원이 `1만`(2글자), 1억이 `1.0억`(3글자) → 정렬 일관성 깨짐
- 0과 1만의 시각 차이가 미미

---

### P4-7 카드 일관성 부족 🟡 [연기]

**위치** `신청기업_장비신청.html:makeCard / makeAllEqCard`

**증상** 매칭 카드(progress bar+reasons)와 전체 목록 카드(카테고리 뱃지)가 거의 같은 모양인데 디테일이 다름. "통합" 뱃지가 매칭 카드에만 있어 혼란.

---

### P4-8 버튼 종류 과다 🟡

**위치** 두 HTML

**증상** 5종류 버튼(`primary/success/warn/danger/outline`)이 한 모달(견적서)에 동시 노출 — 어떤 게 주 액션인지 불분명.

---

### P4-9 신청 테이블 반응형 부재 🟡 [연기]

**위치** `공급기업_관리.html:407` (10컬럼 테이블)

**증상** 모바일에서 가로 스크롤 강제. 카드형 변환 / 컬럼 우선순위 미적용.

**연기 이유** 모바일 카드 레이아웃 신규 디자인 필요.

---

### P4-10 공간 사진 미리보기 약함 🟡

**위치** `신청기업_장비신청.html:778-781`

**증상** 사진 선택 후 텍스트만 변경. 모바일 작은 썸네일 + 삭제/재선택 UX 모호.

---

### P4-11 칩 그룹 모바일 처리 🟡

**위치** `신청기업_장비신청.html:117 chip-grp-3`

**증상** 3열 grid를 모바일에도 적용 → 화면 320px 폭에서 chip 1개가 ~95px → 텍스트 줄바꿈 + 이모지 작아짐.

---

### P4-12 `eq-photo-thumb` 비율 고정 🟡

**위치** `신청기업_장비신청.html:245` `.eq-photo-thumb { height: 100px; object-fit: cover }`

**증상** 세로 사진은 잘리고 가로 사진은 양옆이 잘림.

---

## 분류별 카운트

| 영역 | 🔴 Critical | 🟠 High | 🟡 Medium | 합계 |
|---|---|---|---|---|
| 1. 중복 / Dead code | 1 | 2 | 1 | 4 |
| 2. PDF / Drive 성능 | 1 | 4 | 1 | 6 |
| 3. PDF 사진 / 인코딩 | 1 | 1 | 5 | 7 |
| 4. UI / 디자인 | 1 | 3 | 8 | 12 |
| **합계** | **4** | **10** | **15** | **29** |

---

## 처리 정책

| 분류 | 처리 |
|---|---|
| 🔴 Critical, 🟠 High | 본 PR에서 즉시 수정 |
| 🟡 Medium 중 단순 수정 | 본 PR에서 함께 수정 |
| 대규모 UX 재설계 (P4-2, P4-3, P4-7, P4-9) | 별도 PR로 연기, `FIXES.md`에 사유 기록 |
