# 세션 4 검증 문서 — G9 + G10

**작성일:** 2026-05-14
**대상 변경:** 4 파일 + 1 신규, +36 / -4 라인 (G10 1줄 포함)

---

## 변경 요약

| 파일 | 변경 |
|---|---|
| `apps_script/Code.gs` | `_parseMoney` 헬퍼 + `getRows` 사용 교체, `serializeRow`에 수식 인젝션 방지 |
| `apps_script/NotionSync.gs` | `_loadUnifiedByBizno`의 numeric 변환을 `_parseMoney`로 교체 |
| `common.js` | `quoteHash`에 options 포함 (sorted+joined) |
| `공급기업_관리.html` | `saveQDraft` 끝에 `editQtId = qt.id` 1줄 추가 |
| `apps_script/_session4_tests.gs` | 세션 4 검증 테스트 (신규) |

---

## G9-a: `_parseMoney` 헬퍼

### Before

운영 시트의 `total` 셀이 `"15,000,000"` 같은 콤마 포함 문자열이면:
- `Number("15,000,000") = NaN` → `|| 0` 로 0 변환
- PDF에 "₩ 0 원" 출력
- 가이드 메일 견적 금액도 0
- 노션 동기화도 0

### After

- `_parseMoney("15,000,000")` → `15000000` 정상 파싱
- 빈 셀/null/undefined → `0` (이전 동작 보존)
- 비숫자 → `0` (이전과 동일 silent 처리)

### 검증

`_test_g9_parseMoney` 자동 검증 — 10개 케이스 (정상/콤마/빈값/null/whitespace 등)

---

## G9-b: 수식 인젝션 방지

### Before

운영자가 메모 필드에 `=SUM(A1:A10)` 입력 → Sheets 가 셀에서 수식 평가 → 원본 텍스트 영구 손실.

### After

`serializeRow`에서 string 값이 `=`, `+`, `@`로 시작하면 `'` prefix 추가 → Sheets가 plain text로 강제. `-`(음수)는 의도적으로 보존.

### 검증

`_test_g9_formulaInjection` 자동 검증 — 정상 텍스트, `=`/`+`/`@` 차단, `-` 음수 보존 5케이스.

---

## G9-c: `quoteHash`에 options 포함

### Before

`q.options`가 hash에서 빠짐 → 옵션만 다른 v2 재발급 시 PDF 재업로드 skip → Drive에 옛 PDF 그대로 → 신청자가 다운로드하면 stale 옵션 표시.

### After

옵션을 `name|qty|price` 형식으로 sort 후 join 해 hash 포함. 옵션 변경 시 hash 변경 → PDF 재업로드.

### 검증 (브라우저 콘솔)

```js
// 공급기업_관리.html 콘솔에서:
quoteHash({ items:[{name:'A', qty:1, price:1000}], options:[{name:'옵션1', qty:1, price:500}], total:1500 })
// 옵션 변경 시 결과 hash 가 변경되어야 함:
quoteHash({ items:[{name:'A', qty:1, price:1000}], options:[{name:'옵션2', qty:1, price:500}], total:1500 })
// 위 두 결과가 달라야 정상
```

---

## G10: `saveQDraft` 뒤 `editQtId` 동기화

### Before

서버 `saveQuoteWithVersion`이 ID 충돌로 재발급 시 `qt.id`는 갱신되지만 `editQtId` 변수는 옛 값. 후속 동작이 stale ID 참조하면 wrong row 찾거나 못 찾음.

### After

`await syncQt(qt, isNew)` 다음 `if (isNew) editQtId = qt.id` 1줄 추가. 1줄 fix.

### 검증

브라우저 콘솔:
1. 견적 임시저장
2. 콘솔에서 `editQtId` 값 확인 → 최신 견적의 id와 일치해야 함
3. 또는 임시저장 후 같은 모달에서 한 번 더 저장 → 중복 행 안 생겨야 함

---

## 운영 영향 분석

| 항목 | 영향 |
|---|---|
| 정상 숫자 입력 | ✅ 무영향 |
| 콤마 포함 수동 입력 (운영자 편의용) | 정상 파싱 (이전: 0) |
| 운영자가 의도적으로 `=` 시작 텍스트 입력 | text로 강제 (이전: Sheets 수식 평가) |
| 음수 입력 (`-100`) | ✅ 보존 |
| 기존 견적의 quoteHash | 변경됨 — 다음 재발급 시 PDF 재업로드 1회 |
| Drive storage | 일시적 증가 (옛 PDF + 새 hash PDF) — 한 번 후 정상 |

---

## 배포 순서

```bash
git add apps_script/Code.gs apps_script/NotionSync.gs
git commit -m "fix(integrity): G9 _parseMoney helper + formula injection prevention"

git add common.js
git commit -m "fix(integrity): G9 include options in quoteHash (prevent stale PDF reuse)"

git add 공급기업_관리.html
git commit -m "fix(integrity): G10 sync editQtId after syncQt for saveQDraft"

git add apps_script/_session4_tests.gs SESSION_4_VERIFICATION.md
git commit -m "test: session 4 verification suite + scenario docs"

git push origin main
clasp push
# Apps Script 새 버전 배포
```

---

## 사용자 확인 요청

1. **OK, commit + push + clasp 진행** → 세션 5 (G11~G14 + 정리)로 이동
2. **재검토**
3. **추가 검증**

테스트 결과 ✅ 7개 받으면 세션 4 종료.
