// ────────────────────────────────────────────────────────────────────
// PDF 폰트 동적 로더 — 첫 PDF 생성 시점에만 base64 폰트 모듈 lazy load
// 한 번 로드되면 window.__pdfFontsLoaded 플래그로 재호출 시 즉시 반환
// 페이지 초기 로드 사이즈에 영향 없음 (~12MB 폰트는 PDF 생성 시점에만 다운로드)
// 사용 폰트: Source Han Sans Korean (Adobe/Google) — 한글+한자+라틴 모두 지원
// ────────────────────────────────────────────────────────────────────

window.__pdfFontsLoaded = false;
window.__pdfFontsLoading = null;

function _loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve(src);
    s.onerror = () => reject(new Error('script load failed: ' + src));
    document.head.appendChild(s);
  });
}

/**
 * PDF 폰트 4개를 한 번만 lazy load.
 * - 동시에 여러 호출이 들어와도 1회만 fetch (inflight promise 공유)
 * - 모든 base64 변수가 window 에 등록되면 resolve
 */
async function ensurePdfFonts() {
  if (window.__pdfFontsLoaded) return;
  if (window.__pdfFontsLoading) return window.__pdfFontsLoading;
  window.__pdfFontsLoading = (async () => {
    await Promise.all([
      _loadScript('assets/fonts/SourceHanSansKR-Regular-KR.js'),
      _loadScript('assets/fonts/SourceHanSansKR-Bold-KR.js')
    ]);
    // 폰트 base64 변수들이 모두 노출됐는지 확인
    const required = ['SourceHanReg_BASE64','SourceHanBold_BASE64'];
    const missing = required.filter(k => !window[k]);
    if (missing.length) throw new Error('PDF 폰트 로드 실패: ' + missing.join(', '));
    window.__pdfFontsLoaded = true;
  })();
  return window.__pdfFontsLoading;
}

/**
 * jsPDF 인스턴스에 4개 폰트(Pretendard / NanumGothic 각각 normal+bold) 등록.
 * - 이 함수 호출 후 pdf.setFont('Pretendard', 'normal') 등으로 사용 가능
 * - PDF 자체에 폰트가 임베딩됨 (subset 미적용 시 PDF 사이즈 ~3MB+)
 */
function registerPdfFonts(pdf) {
  if (!window.__pdfFontsLoaded) {
    throw new Error('ensurePdfFonts() 를 먼저 호출하세요.');
  }
  // Source Han Sans Korean (한글+한자+라틴 모두 지원, Regular/Bold)
  // jsPDF 내부 폰트 ID 는 'NanumGothic' 으로 유지 (quote-generator 호환)
  pdf.addFileToVFS('NanumGothic-Regular.ttf', window.SourceHanReg_BASE64);
  pdf.addFont('NanumGothic-Regular.ttf', 'NanumGothic', 'normal');
  pdf.addFileToVFS('NanumGothic-Bold.ttf', window.SourceHanBold_BASE64);
  pdf.addFont('NanumGothic-Bold.ttf', 'NanumGothic', 'bold');
}

window.ensurePdfFonts = ensurePdfFonts;
window.registerPdfFonts = registerPdfFonts;
