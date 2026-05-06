# BPK Smart 2026 — 로컬 테스트 가이드

본 가이드는 수정된 코드를 **로컬 환경에서 동작 확인**하기 위한 절차입니다.

## 1. 사전 요구사항

| 항목 | 필요 여부 | 설명 |
|---|---|---|
| 웹 브라우저 | 필수 | Chrome, Edge, Safari 모두 가능. 한글 폰트 / Drive 공유 사진 호환 위해 최신 버전 권장 |
| 로컬 웹서버 | 권장 | Python 또는 Node — `file://` 직접 열기로도 작동하나 일부 기능(common.js의 `fetch('jikin.js')`) 이 차단될 수 있음 |
| Apps Script 접근 | 선택 | API 모드 테스트용. localStorage 모드만 쓸 거면 불필요 |
| Google 계정 | 선택 | Apps Script 재배포 시에만 필요 |

---

## 2. 로컬 웹서버로 띄우기

가장 간단한 방법 (`python3` 기본 내장):

```bash
cd ~/Projects/bpksmart2026
python3 -m http.server 8080
```

또는 Node.js:

```bash
npx http-server -p 8080 -c-1
```

브라우저에서 다음 URL 열기:

- 신청기업 화면: <http://localhost:8080/신청기업_장비신청.html>
- 공급기업 관리자 화면: <http://localhost:8080/공급기업_관리.html>

> ⚠️ `file:///` 경로로 직접 여는 것은 권장하지 않습니다. 
> `loadJikin()` 의 `fetch('jikin.js')` 가 일부 브라우저에서 차단됩니다.

---

## 3. 두 가지 동작 모드

### 모드 A: 로컬 모드 (localStorage 전용)

`config.js` 의 `APPS_SCRIPT_URL` 을 빈 문자열 `''` 로 두면 자동으로 로컬 모드로 동작합니다.
- 모든 데이터는 브라우저 `localStorage` 에 저장됨
- 사진은 base64 로 저장 (Drive 업로드 안 됨)
- PDF 생성 시 `loadJikin()` 이 `fetch('jikin.js')` 를 시도. 직인 base64 추출 성공 시 사용
- 로그인은 `bpkadmin / BPK2026!` (`common.js` `CRED`)
- 헤더에 `⚠️ 로컬 모드` 배지가 표시됨

```javascript
// config.js
const APPS_SCRIPT_URL = '';   // ← 빈 문자열로 두면 로컬 모드
```

이 모드는 GAS 배포 없이 모든 UI/UX 를 검증할 수 있습니다.

### 모드 B: API 모드 (Google Sheets / Drive 연동)

`APPS_SCRIPT_URL` 에 배포된 Apps Script 웹앱 URL 입력:

```javascript
// config.js
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/.../exec';
```

이 모드에서 P2-2 (`getPhotosBase64Bulk`), P2-6 (`LockService`), P3-7 (썸네일) 의 효과가 활성화됩니다.

**중요:** 본 PR에서 추가한 `getPhotosBase64Bulk` 액션과 `LockService` 는 **GAS 재배포 후에만** 활성화됩니다. 재배포 전이라도 `resolvePhotosBatch` 가 자동으로 단건 fallback 모드로 동작하므로 앱은 정상 작동합니다 (단, P2-2 의 속도 이득은 못 봄).

---

## 4. Apps Script 재배포 절차

`apps_script/Code.gs` 가 변경되었으므로 새 endpoint(`getPhotosBase64Bulk`)와 LockService를 활성화하려면 재배포가 필요합니다.

1. Google Sheet 열기 → **확장 프로그램** → **Apps Script**
2. 좌측 파일 트리에서 `Code.gs` 선택 → 본 저장소의 새 `apps_script/Code.gs` 내용으로 **전체 교체**
3. 디스크 아이콘으로 **저장** (Ctrl+S)
4. 우상단 **배포 (파란 버튼)** → **배포 관리** 클릭
5. 기존 배포 옆 ✏️ 아이콘 → **새 버전** 선택
6. 설명에 "P2-2 bulk endpoint + LockService" 정도 입력 → **배포**
7. 표시된 새 URL 복사
8. `config.js` 의 `APPS_SCRIPT_URL` 을 새 URL로 갱신 → 저장
9. 브라우저 새로고침

> 배포 후 첫 호출에서 권한 동의 화면이 뜰 수 있습니다 (Drive·Sheets 접근 권한).

**검증 방법** Apps Script 에디터에서 실행:
```javascript
function testBulk() {
  const r = getPhotosBase64Bulk({urls: ['https://drive.google.com/thumbnail?id=...']});
  Logger.log(r);
}
```
`{ ok:true, data: [{ok:true, base64:'data:...'}] }` 형태로 반환되면 성공.

---

## 5. 동작 검증 체크리스트

각 변경 사항을 실제로 검증할 수 있는 시나리오입니다.

### 5.1 데이터·함수 단일화 (P1-1, P1-2)

- [ ] **신청기업 화면**: 처음으로 → 신규 장비 신청 → step 2까지 진행 → 매칭 시작 → step 3에 장비 60개 전체 노출 확인
- [ ] **공급기업 화면**: 로그인 → 공급 물품 목록 → 카테고리 탭 별 합계 60개 표시 확인
- [ ] 브라우저 콘솔에 `eq_default.js`, `common.js` 200 OK 로딩 확인 (Network 탭)
- [ ] 콘솔에서 `DEFAULT_EQ.length` 입력 → `60` 반환

### 5.2 Dead code 제거 (P1-3)

- [ ] 콘솔에서 `typeof preloadImages` → `"undefined"` (제거 확인)
- [ ] `typeof changeStatus` → `"undefined"`
- [ ] 매칭 설정 화면 → `w_speed` 입력 필드 없음 확인 (이전부터 없었지만 dead config 제거)

### 5.3 PDF 성능 개선 (P2-1 ~ P3-3)

- [ ] **API 모드 + GAS 재배포 후**: 견적서 작성 → 5장비 + 신청기업 사진 5장 포함 견적서 → 📄 PDF 클릭 → 토스트에서 "사진 로딩 중... (10장)" 한번만 → 빠르게 완료
- [ ] PDF 파일 크기 확인 → 이전 대비 ~50% 감소 (5MB → 2-2.5MB 정도)
- [ ] 동일 견적서 PDF 재생성 → 캐시로 사진 변환 즉시
- [ ] PDF 다운로드 직후 토스트 "📄 PDF 다운로드 완료" → 약 5초 후 "☁️ Drive 백업 완료" 확인 (백그라운드 동작)
- [ ] 일부 사진 URL을 일부러 깨뜨리고 PDF 생성 시도 → confirm 다이얼로그로 "사진 N장 로드 실패. 빈칸 상태로 PDF를 생성할까요?" 표시

### 5.4 모바일 UI (P4-1, P4-5)

- [ ] 브라우저 개발자 도구의 Device Mode (모바일 380px 폭) 활성화
- [ ] **공급기업**: topbar 좌측에 ☰ 버튼 보임 → 클릭 시 사이드바 슬라이드 + 백드롭 → 메뉴 항목 클릭 시 자동 닫힘
- [ ] **신청기업**: 신청 step 2~5 페이지에서 step bar 의 현재 단계만 라벨 표시 (이전엔 모두 숨김)

### 5.5 색상 대비 (P4-4)

- [ ] 신청기업 랜딩의 카드 본문(`.c-desc`), 작은 메타 정보가 이전보다 선명하게 보이는지 시각 확인
- [ ] 개발자 도구로 어느 요소든 `var(--g400)` 실 색상 확인 → `#6b7d96` (이전 `#94a3b8`)

### 5.6 대시보드 표시 (P4-6)

- [ ] **공급기업**: 대시보드 → 견적이 0건일 때 `0원` 표시 확인
- [ ] 견적 1건이 30,000,000원일 때 `30,000,000원` 표시 (이전엔 `3000만`)
- [ ] 합계가 1억 이상일 때 `1.5억원` (이전엔 `1.5억`)

### 5.7 사진 비율 (P4-12)

- [ ] **신청기업** 매칭 결과 화면에서 등록된 사진이 있는 장비 카드 표시 → 사진이 카드 너비에 맞게 4:3 비율 박스로 표시 (반응형 너비 변경 시 높이도 비율 따라 변경)

---

## 6. 회귀 테스트 (기능 변경 없음 확인)

다음은 본 PR에서 동작이 변경되어선 안 되는 항목들. 모두 동일하게 작동해야 합니다.

- [ ] 신청기업 5단계 위자드 진행 (step 1 → 2 → 3 → 4 → 5)
- [ ] 매칭 알고리즘 결과: 같은 입력에 대해 동일 추천 장비 + 동일 매칭률
- [ ] 공급기업 로그인: `bpkadmin / BPK2026!` 으로 진입
- [ ] 물품 추가/수정 (이전엔 `openAddProduct()`, 지금은 `openEditProd(null)` — 동일 모달 열림)
- [ ] 견적서 작성 → 확정 → 신청기업 조회 화면에서 PDF 다운로드 가능
- [ ] 견적서 한글 금액 변환 (`numToKorean`): 12,345,678 → "금 일천이백삼십사만오천육백칠십팔원정"
- [ ] 모달 외부 클릭 시 모달 닫힘 (이전엔 인라인 핸들러, 지금은 `common.js` 자동 바인딩)

---

## 7. 트러블슈팅

| 증상 | 원인 / 해결 |
|---|---|
| 콘솔 `DEFAULT_EQ is not defined` | `<script src="eq_default.js">` 로드 실패. Network 탭에서 404 확인 → 파일 경로 확인 |
| 콘솔 `numToKorean is not defined` | `common.js` 로드 실패 또는 script 순서 문제. `config.js → eq_default.js → common.js → api.js` 순서 확인 |
| PDF 생성 시 "사진 N장 누락" 매번 발생 | API 모드인데 GAS URL이 잘못됐거나 미배포. Drive 사진 URL이 base64로 변환되지 않음 |
| 모바일에서 햄버거 클릭해도 메뉴 안 열림 | 화면 폭이 901px 이상이면 햄버거 비활성화. DevTools에서 Device Mode 폭을 900 이하로 조정 |
| 견적서 PDF에 직인 안 보임 | `jikin.js` lazy fetch 실패. 콘솔 경고 확인. `file://` 직접 열었으면 로컬 서버로 변경 |
| `getPhotosBase64Bulk` 가 안 먹힘 | GAS 재배포가 안 됐을 가능성. Apps Script 에디터에서 새 버전 배포 + URL 갱신 |
| 견적 동기화 시 "다른 사용자가 동기화 중" 에러 | LockService가 정상 작동 중. 10초 대기 후 재시도 |

---

## 8. 변경 이력 문서

- `PROBLEMS.md` — 분석 시점에 발견된 모든 문제 (수정 전 스냅샷)
- `FIXES.md` — 각 문제의 처리 결과 (해결 / 연기 / 사용자 작업 필요)
- `README_TEST.md` — 본 문서 (로컬 테스트 가이드)

---

## 9. 다음 단계

본 PR 머지 후 권장 작업 순서:

1. **GAS 재배포** (P2-2, P2-6, P3-7 활성화) ← 즉시
2. 운영 환경에서 PDF 생성 시간 측정 → 이전 대비 단축 확인
3. `FIXES.md` 의 🔄 연기 항목 중 우선순위 정해 별도 PR 진행
   - 권장 1순위: P4-2 신청 page 2 분할 (이탈률 개선)
   - 권장 2순위: P4-1 외 모바일 UX 개선 (P4-9, P4-11)
4. 보안 작업 (별도 PR, PROBLEMS.md 외 영역)
   - 평문 비밀번호 → 환경변수 또는 PropertiesService
   - GAS doPost 에 인증 미들웨어 추가
