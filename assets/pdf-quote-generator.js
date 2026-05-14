// ════════════════════════════════════════════════════════════════════
// PDF 견적서 / 장비사양서 생성 — jsPDF 직접 그리기 (한글 폰트 임베딩)
// 기존 html2canvas 방식의 폰트 자간 압축·화면 노출 문제 해결
// ════════════════════════════════════════════════════════════════════
//
// 사용법
//   const pdf = await buildQuotePdf(q, a, eqInfoList, photos, jikinDataUrl);
//   pdf.save('파일명.pdf');                     // 다운로드
//   const dataUri = pdf.output('datauristring'); // base64 (Drive 업로드용)
//
// 좌표·단위
//   - jsPDF 기본 단위 mm. A4 = 210 × 297 mm
//   - 폰트 사이즈는 pt
//
// 폰트 매핑
//   - Pretendard : 제목·헤더·강조 (모던 한글)
//   - NanumGothic: 표 본문·일반 텍스트 (공식 문서 톤)

(function(){

const PAGE_W = 210;
const PAGE_H = 297;
const M_LEFT  = 18;    // 좌측 여백 (mm) — 14 → 18 로 확대
const M_RIGHT = 18;    // 우측 여백 — 14 → 18 로 확대
const M_TOP   = 12;    // 상단 여백
const M_BOTTOM = 14;   // 하단 여백 (footer 포함 영역)
const CONTENT_W = PAGE_W - M_LEFT - M_RIGHT;

// 색상
const COLOR_TEXT_DARK   = [17, 17, 17];
const COLOR_TEXT_BODY   = [34, 34, 34];
const COLOR_TEXT_MUTED  = [102, 102, 102];
const COLOR_TEXT_FAINT  = [153, 153, 153];
const COLOR_BORDER      = [187, 187, 187];
const COLOR_BORDER_LIGHT= [229, 229, 229];
const COLOR_HEADER_BG   = [34, 34, 34];
const COLOR_TOTAL_BG    = [239, 239, 239];

// ── 헬퍼: 컬러 setter ──
function _setText(pdf, c){ pdf.setTextColor(c[0], c[1], c[2]); }
function _setDraw(pdf, c){ pdf.setDrawColor(c[0], c[1], c[2]); }
function _setFill(pdf, c){ pdf.setFillColor(c[0], c[1], c[2]); }

// ── 헬퍼: 일정 폭 안에 문자열을 letter-spacing 으로 배치 ──
//   (기존 HTML 의 letter-spacing:20px 효과 재현)
function _drawSpacedText(pdf, text, xCenter, y, totalWidth) {
  const chars = [...text];
  if (chars.length <= 1) {
    pdf.text(text, xCenter, y, { align: 'center' });
    return;
  }
  const step = totalWidth / (chars.length - 1);
  const startX = xCenter - totalWidth / 2;
  chars.forEach((ch, i) => {
    pdf.text(ch, startX + step * i, y, { align: 'center' });
  });
}

// ── 헬퍼: 한 줄 텍스트의 baseline 기준 X 좌표 ──
function _alignX(pdf, text, x, w, align) {
  if (align === 'center') return x + w / 2;
  if (align === 'right')  return x + w;
  return x;
}

// ── 헬퍼: 표 셀 그리기 (border + 텍스트 align) ──
function _drawCell(pdf, x, y, w, h, text, opts={}) {
  const fillColor = opts.fillColor;
  const textColor = opts.textColor || COLOR_TEXT_BODY;
  const align = opts.align || 'left';
  const fontStyle = opts.fontStyle || 'normal';
  const fontSize  = opts.fontSize  || 9.5;
  const fontName  = opts.fontName  || 'NanumGothic';
  const padX = opts.padX != null ? opts.padX : 2.4;
  const padY = opts.padY != null ? opts.padY : 1.3;
  const drawBorder = opts.drawBorder !== false;
  if (fillColor){ _setFill(pdf, fillColor); pdf.rect(x, y, w, h, 'F'); }
  if (drawBorder){ _setDraw(pdf, COLOR_BORDER); pdf.setLineWidth(0.15); pdf.rect(x, y, w, h, 'S'); }
  if (text === undefined || text === null) return;
  pdf.setFont(fontName, fontStyle);
  pdf.setFontSize(fontSize);
  _setText(pdf, textColor);
  let tx;
  if (align === 'center') tx = x + w / 2;
  else if (align === 'right') tx = x + w - padX;
  else tx = x + padX;
  // 셀 height 정확한 수직 중앙 — pt 사이즈를 mm 로 환산(0.353)해서 baseline 보정
  const fontMm = fontSize * 0.3528;
  const ty = y + h / 2 + fontMm * 0.36;
  pdf.text(String(text), tx, ty, { align });
}

// ── 헬퍼: 한글 mm width 측정 ──
function _textWidth(pdf, text, fontName, fontStyle, fontSize) {
  pdf.setFont(fontName, fontStyle);
  pdf.setFontSize(fontSize);
  return pdf.getTextWidth(String(text));
}

// ════════════════════════════════════════════════════════════════════
// 견적서 1페이지 그리기
// ════════════════════════════════════════════════════════════════════
function drawQuotePage(pdf, q, a, jikinDataUrl) {
  let y = M_TOP;

  // ── 제목 "見 積 書" — 조금 더 아래로 ──
  pdf.setFont('NanumGothic', 'bold');
  pdf.setFontSize(28);
  _setText(pdf, COLOR_TEXT_DARK);
  _drawSpacedText(pdf, '見 積 書', PAGE_W / 2, y + 16, 60);
  y += 30;   // 22 → 30 (제목 ↔ 헤더 간격 확보)

  // ── 헤더: 좌(수신/사업자/연락처) | 우(회사명+직인 / 본사 / TEL / 사업자) ──
  const headerTop = y;
  // 좌측 수신 영역 — 줄간격 5 → 6.5 로 살짝 넓힘
  pdf.setFont('NanumGothic', 'normal'); pdf.setFontSize(9.5); _setText(pdf, COLOR_TEXT_BODY);
  pdf.text('수신 : ', M_LEFT, y + 5);
  const recvLabelW = pdf.getTextWidth('수신 : ');
  pdf.setFont('NanumGothic','bold'); pdf.setFontSize(11);
  pdf.text(q.company || '-', M_LEFT + recvLabelW, y + 5);
  const companyW = pdf.getTextWidth(q.company || '-');
  pdf.setFont('NanumGothic','normal'); pdf.setFontSize(9.5);
  pdf.text(' 貴中', M_LEFT + recvLabelW + companyW, y + 5);

  pdf.text('사업자등록번호 : ' + (a.bizno || '-'), M_LEFT, y + 12);
  pdf.text('연락처 : '         + (a.phone || '-'), M_LEFT, y + 18.5);

  // 우측 회사 정보 영역
  const rightX = PAGE_W - M_RIGHT;
  pdf.setFont('NanumGothic','normal'); pdf.setFontSize(9); _setText(pdf, COLOR_TEXT_BODY);
  pdf.text('날짜 : ' + (q.date || ''), rightX - 38, y + 5, { align: 'left' });
  // 회사명 + 도장 (도장은 텍스트 우측에 배치) — 날짜와 간격 확보
  const compNameW = _textWidth(pdf, '주식회사 비피케이', 'NanumGothic', 'bold', 13);
  pdf.setFont('NanumGothic','bold'); pdf.setFontSize(13); _setText(pdf, COLOR_TEXT_DARK);
  const stampSize = 16;
  const stampX = rightX - stampSize;
  const compNameX = stampX - 1 - compNameW;
  // 도장 중앙(y + 9 + stampSize/2 = y + 17) 과 글자 시각 중앙 일치
  // baseline = 도장중앙 + (fontSize_pt × 0.3528 × 0.36) = 17 + 1.65 ≈ 18.6
  pdf.text('주식회사 비피케이', compNameX, y + 18.6);
  if (jikinDataUrl) {
    try { pdf.addImage(jikinDataUrl, 'PNG', stampX, y + 9, stampSize, stampSize); } catch(e){}
  } else {
    _setDraw(pdf, [204, 0, 0]); pdf.setLineWidth(0.7);
    pdf.circle(stampX + stampSize/2, y + 9 + stampSize/2, stampSize/2 - 0.5, 'S');
    pdf.setFont('NanumGothic','bold'); pdf.setFontSize(8); _setText(pdf, [204,0,0]);
    pdf.text('(인)', stampX + stampSize/2, y + 9 + stampSize/2 + 1.5, { align: 'center' });
    _setText(pdf, COLOR_TEXT_BODY);
  }

  // 본사 / TEL / 사업자등록번호 — 폰트 8 → 9 (좌측 9.5 보다 작게), 도장과 간격 확보, 줄간격 4.5 → 5
  pdf.setFont('NanumGothic','normal'); pdf.setFontSize(9); _setText(pdf, COLOR_TEXT_BODY);
  pdf.text('본사 : 대구광역시 달서구 문화회관 11길 61(장기동)', rightX, y + 30, { align: 'right' });
  pdf.text('TEL: (053)716-7600  /  FAX: (053)716-7670  /  bpk90@naver.com', rightX, y + 35, { align: 'right' });
  pdf.text('사업자등록번호 : 275-88-01197',                             rightX, y + 40, { align: 'right' });

  y = headerTop + 47;

  // ── "下記 와 같이 見積 합니다" — 위아래 여백 확보 ──
  pdf.setFont('NanumGothic','bold'); pdf.setFontSize(11); _setText(pdf, COLOR_TEXT_DARK);
  pdf.text('下記 와 같이 見積 합니다', M_LEFT, y + 4);
  y += 10;

  // ── 합계금액 박스 (테두리 진하게) — 좌/우 모두 박스 수직 중앙, 우측은 align:'right' 로 끝점 기준 ──
  const sumBoxH = 12;
  _setDraw(pdf, COLOR_TEXT_DARK); pdf.setLineWidth(0.6);
  pdf.rect(M_LEFT, y, CONTENT_W, sumBoxH, 'S');
  // baseline 보정: cy 는 박스 수직 중앙, baseline = cy + fontSize_pt × 0.3528 × 0.36
  const cy = y + sumBoxH / 2;
  // 좌측: 合計金額 + 한글 변환
  pdf.setFont('NanumGothic','bold'); pdf.setFontSize(10); _setText(pdf, COLOR_TEXT_DARK);
  const koreanAmt = (typeof numToKorean === 'function') ? numToKorean(q.total||0) : '';
  pdf.text('合計金額 : ' + koreanAmt, M_LEFT + 4, cy + 1.27);
  // 우측: '₩ 41,700,000 원 (부가세 별도)' — 두 텍스트가 모두 align:'right' 로 우측 끝 기준 정렬
  const vatLabel = '(부가세 별도)';
  // 1) (부가세 별도) — 박스 우측 끝
  pdf.setFont('NanumGothic','normal'); pdf.setFontSize(9); _setText(pdf, COLOR_TEXT_MUTED);
  pdf.text(vatLabel, rightX - 4, cy + 1.14, { align: 'right' });
  const vatW = pdf.getTextWidth(vatLabel);
  // 2) ₩ 41,700,000 원 — (부가세 별도) 좌측에 인접 (3mm 간격)
  pdf.setFont('NanumGothic','bold'); pdf.setFontSize(12); _setText(pdf, COLOR_TEXT_DARK);
  const totalStr = '₩ ' + (q.total||0).toLocaleString('ko-KR') + ' 원';
  pdf.text(totalStr, rightX - 4 - vatW - 3, cy + 1.52, { align: 'right' });
  y += sumBoxH + 8;

  // ── 도입장비명 ── (위아래 간격 확보)
  pdf.setFont('NanumGothic','bold'); pdf.setFontSize(9.5); _setText(pdf, COLOR_TEXT_DARK);
  pdf.text('도입장비명 :', M_LEFT, y);
  pdf.setFont('NanumGothic','normal'); pdf.setFontSize(9.5);
  pdf.text((q.process || '포장자동화') + ' 장비', M_LEFT + 28, y);
  y += 8;

  pdf.setFont('NanumGothic','bold'); pdf.setFontSize(9); _setText(pdf, COLOR_TEXT_DARK);
  pdf.text('구성 장비 내역', M_LEFT, y);
  y += 3;

  // ── 항목 표 (품명 / 수량 / 단위 / 합계) ──
  const TBL_X = M_LEFT;
  const TBL_W = CONTENT_W;
  const COL_QTY  = 22;
  const COL_UNIT = 22;
  const COL_AMT  = 45;
  const COL_NAME = TBL_W - COL_QTY - COL_UNIT - COL_AMT;
  const HEADER_H = 8;
  // header
  _drawCell(pdf, TBL_X,                       y, COL_NAME,  HEADER_H, '품          명', { fillColor: COLOR_HEADER_BG, textColor: [255,255,255], align:'center', fontName:'NanumGothic', fontStyle:'bold', fontSize:10, drawBorder:true });
  _drawCell(pdf, TBL_X+COL_NAME,              y, COL_QTY,   HEADER_H, '수 량',          { fillColor: COLOR_HEADER_BG, textColor: [255,255,255], align:'center', fontName:'NanumGothic', fontStyle:'bold', fontSize:10, drawBorder:true });
  _drawCell(pdf, TBL_X+COL_NAME+COL_QTY,      y, COL_UNIT,  HEADER_H, '단 위',          { fillColor: COLOR_HEADER_BG, textColor: [255,255,255], align:'center', fontName:'NanumGothic', fontStyle:'bold', fontSize:10, drawBorder:true });
  _drawCell(pdf, TBL_X+COL_NAME+COL_QTY+COL_UNIT, y, COL_AMT, HEADER_H, '합          계',{ fillColor: COLOR_HEADER_BG, textColor: [255,255,255], align:'center', fontName:'NanumGothic', fontStyle:'bold', fontSize:10, drawBorder:true });
  y += HEADER_H;

  // body — items + options. 품명+모델명이 함께 있는 행은 셀 높이 12mm, 단일 줄은 8.5mm
  const ROW_H_SINGLE = 8.5;
  const ROW_H_DOUBLE = 12;
  const items = (q.items || []);
  items.forEach(it => {
    const nameLine1 = it.name || '-';
    const nameLine2 = (it.model && it.model !== '-') ? it.model : '';
    const rowH = nameLine2 ? ROW_H_DOUBLE : ROW_H_SINGLE;
    // 품명 셀: 본문 + (모델 작은 글씨) — 두 줄을 셀 안 수직 중앙으로 배치
    _drawCell(pdf, TBL_X, y, COL_NAME, rowH, undefined, {});
    pdf.setFont('NanumGothic','normal'); pdf.setFontSize(9.5); _setText(pdf, COLOR_TEXT_BODY);
    if (nameLine2) {
      // 두 줄: 품명(상) → 모델명(하). 각자 절반에 수직 중앙
      pdf.text(nameLine1, TBL_X + 2.4, y + 4.8);
      pdf.setFont('NanumGothic','normal'); pdf.setFontSize(7.5); _setText(pdf, COLOR_TEXT_MUTED);
      pdf.text(nameLine2, TBL_X + 2.4, y + 9.2);
    } else {
      pdf.text(nameLine1, TBL_X + 2.4, y + rowH/2 + 1.2);
    }
    _drawCell(pdf, TBL_X+COL_NAME,              y, COL_QTY,  rowH, it.qty || 1,                                 { align:'center' });
    _drawCell(pdf, TBL_X+COL_NAME+COL_QTY,      y, COL_UNIT, rowH, it.unit || 'SET',                            { align:'center' });
    _drawCell(pdf, TBL_X+COL_NAME+COL_QTY+COL_UNIT, y, COL_AMT, rowH, ((it.qty||1)*(it.price||0)).toLocaleString('ko-KR') + '원', { align:'right', fontName:'NanumGothic', fontStyle:'bold' });
    y += rowH;
  });
  // 이후 단일 줄 행들 (옵션, 자동화 행 등) 은 ROW_H_SINGLE 사용
  const ROW_H = ROW_H_SINGLE;

  // 옵션 row — [옵션] 라벨 + 입력 금액 그대로
  const opts = Array.isArray(q.options) ? q.options : [];
  opts.forEach(op => {
    _drawCell(pdf, TBL_X, y, COL_NAME, ROW_H, '[옵션] ' + (op.name || '-'),                              { align:'left' });
    _drawCell(pdf, TBL_X+COL_NAME,              y, COL_QTY,  ROW_H, op.qty || 0,                          { align:'center' });
    _drawCell(pdf, TBL_X+COL_NAME+COL_QTY,      y, COL_UNIT, ROW_H, 'SET',                                { align:'center' });
    _drawCell(pdf, TBL_X+COL_NAME+COL_QTY+COL_UNIT, y, COL_AMT, ROW_H, (op.price||0).toLocaleString('ko-KR') + '원', { align:'right', fontName:'NanumGothic', fontStyle:'bold' });
    y += ROW_H;
  });

  y += 1; // 표 아래 간격

  // ── 추가 표 (1. 자동화 / 2. 설치 및 시운전 / TOTAL) ──
  // 1행
  _drawCell(pdf, TBL_X,                            y, COL_NAME,  ROW_H, '1.  ' + (q.process || '포장자동화') + ' 자동화', {});
  _drawCell(pdf, TBL_X+COL_NAME,                   y, COL_QTY,   ROW_H, '1',     { align:'center' });
  _drawCell(pdf, TBL_X+COL_NAME+COL_QTY,           y, COL_UNIT,  ROW_H, 'SET',   { align:'center' });
  _drawCell(pdf, TBL_X+COL_NAME+COL_QTY+COL_UNIT,  y, COL_AMT,   ROW_H, (q.total||0).toLocaleString('ko-KR') + '원', { align:'right', fontName:'NanumGothic', fontStyle:'bold' });
  y += ROW_H;
  // 2행
  _drawCell(pdf, TBL_X,                            y, COL_NAME,  ROW_H, '2.  설치 및 시운전경비, 전제반비용', {});
  _drawCell(pdf, TBL_X+COL_NAME,                   y, COL_QTY,   ROW_H, '1',   { align:'center' });
  _drawCell(pdf, TBL_X+COL_NAME+COL_QTY,           y, COL_UNIT,  ROW_H, '식',   { align:'center' });
  _drawCell(pdf, TBL_X+COL_NAME+COL_QTY+COL_UNIT,  y, COL_AMT,   ROW_H, '포함', { align:'center' });
  y += ROW_H;
  // TOTAL 행
  _drawCell(pdf, TBL_X,                            y, COL_NAME+COL_QTY+COL_UNIT, ROW_H, 'TOTAL', { fillColor: COLOR_TOTAL_BG, align:'center', fontName:'NanumGothic', fontStyle:'bold', fontSize:10.5 });
  _drawCell(pdf, TBL_X+COL_NAME+COL_QTY+COL_UNIT,  y, COL_AMT,    ROW_H, (q.total||0).toLocaleString('ko-KR') + '원', { fillColor: COLOR_TOTAL_BG, align:'right', fontName:'NanumGothic', fontStyle:'bold', fontSize:10.5 });
  y += ROW_H + 4;

  // ── 비고 박스 ──
  const remarkH = 32;
  _setDraw(pdf, COLOR_BORDER); pdf.setLineWidth(0.18);
  pdf.rect(M_LEFT, y, CONTENT_W, remarkH, 'S');
  // 좌측 "비 고" 영역
  const remarkLabelW = 16;
  pdf.line(M_LEFT + remarkLabelW, y, M_LEFT + remarkLabelW, y + remarkH);
  pdf.setFont('NanumGothic','bold'); pdf.setFontSize(10); _setText(pdf, COLOR_TEXT_DARK);
  pdf.text('비  고', M_LEFT + remarkLabelW/2, y + remarkH/2 + 1, { align:'center' });
  // 우측 본문
  const remarkLines = [
    '· 본 견적은 장비 공급 및 설치 기준 금액이며, 현장 여건에 따른 전기, 공압, 설비배관, 기초 공사 비용은 포함되어',
    '   있지 않습니다.',
    '· 견적서의 유효기간은 발행일로부터 30일간 유효합니다.',
    '· 유지보수 기간은 5년이며, 무상A/S기간은 2년입니다. 무상A/S기간 내라도 귀사의 귀책사유(사용상 과실 등)',
    '   또는 천재지변에 의한 경우에는 유상 처리 될 수 있습니다.',
    '· 상기 금액은 VAT 별도 금액입니다.'
  ];
  if (q.memo) remarkLines.push('· ' + q.memo);
  pdf.setFont('NanumGothic','normal'); pdf.setFontSize(8.5); _setText(pdf, COLOR_TEXT_BODY);
  let ry = y + 4.5;
  remarkLines.forEach(line => { pdf.text(line, M_LEFT + remarkLabelW + 2.5, ry); ry += 4.2; });

  // ── footer (페이지 하단 고정) ──
  drawFooter(pdf);
}

// ── footer 그리기 (모든 페이지 공통) ──
function drawFooter(pdf) {
  const fy = PAGE_H - M_BOTTOM + 2;
  _setDraw(pdf, COLOR_BORDER_LIGHT); pdf.setLineWidth(0.15);
  pdf.line(M_LEFT, fy - 2, PAGE_W - M_RIGHT, fy - 2);
  pdf.setFont('NanumGothic','normal'); pdf.setFontSize(7); _setText(pdf, COLOR_TEXT_FAINT);
  pdf.text('(주)비피케이  |  TEL (053)716-7600  |  bpk90@naver.com  |  대구광역시 달서구 문화회관 11길 61(장기동)',
           PAGE_W / 2, fy + 2, { align: 'center' });
}

// ════════════════════════════════════════════════════════════════════
// 장비 사양서 페이지 (eqInfoList 의 각 장비당 1페이지)
//   photoDataUrls: string | string[] | null/undefined 모두 허용
//     - 1장 → full-width hero (기존 디자인 보존)
//     - 2~4장 → 2x2 그리드 + 스펙표
//     - 5장 이상 → 첫 4장만 사양서 페이지에 그리고, 나머지는 호출자가
//                  drawEquipExtraPhotoPages 로 추가 페이지에 그림
// ════════════════════════════════════════════════════════════════════
function drawEquipPage(pdf, eq, photoDataUrls, qHeader) {
  // 헤더 — 좌측 (장비명 + 모델), 우측 (회사 정보)
  pdf.setFont('NanumGothic','normal'); pdf.setFontSize(7.5); _setText(pdf, COLOR_TEXT_MUTED);
  pdf.text('장비 사양서 · ' + (qHeader.id||'') + ' · ' + (qHeader.company||''), M_LEFT, M_TOP + 2);
  pdf.setFont('NanumGothic','bold'); pdf.setFontSize(16); _setText(pdf, COLOR_TEXT_DARK);
  pdf.text(eq.name || '-', M_LEFT, M_TOP + 10);
  if (eq.model && eq.model !== '-') {
    pdf.setFont('NanumGothic','normal'); pdf.setFontSize(10); _setText(pdf, [55,65,81]);
    pdf.text(eq.model, M_LEFT, M_TOP + 16);
  }
  // 우측
  pdf.setFont('NanumGothic','normal'); pdf.setFontSize(8); _setText(pdf, [148,163,184]);
  pdf.text('(주)비피케이', PAGE_W - M_RIGHT, M_TOP + 6, { align: 'right' });
  pdf.text('TEL (053)716-7600', PAGE_W - M_RIGHT, M_TOP + 11, { align: 'right' });
  // 헤더 하단 굵은 라인
  _setDraw(pdf, [29,78,216]); pdf.setLineWidth(1.2);
  pdf.line(M_LEFT, M_TOP + 22, PAGE_W - M_RIGHT, M_TOP + 22);

  // 사진 영역 — 입력 정규화 (단일/배열 둘 다 허용)
  let y = M_TOP + 28;
  const photos = Array.isArray(photoDataUrls)
    ? photoDataUrls.filter(Boolean)
    : (photoDataUrls ? [photoDataUrls] : []);

  if (photos.length === 1) {
    // 1장 — 기존 full-width hero (95mm) 보존
    const heroH = 95;
    try {
      pdf.addImage(photos[0], 'JPEG', M_LEFT, y, CONTENT_W, heroH);
    } catch(e) {
      try { pdf.addImage(photos[0], 'PNG', M_LEFT, y, CONTENT_W, heroH); } catch(e2){}
    }
    y += heroH + 14;   // 사진 ↔ 사양 타이틀 간격
  } else if (photos.length >= 2) {
    // 2~4장 — 사양서 페이지에 2x2 그리드. 5장 이상이면 첫 4장만 여기.
    const gridPhotos = photos.slice(0, 4);
    const cellW = (CONTENT_W - 6) / 2;     // ≈ 84mm
    const cellH = 63;                       // 4:3 ≈ 63mm
    const gap   = 6;
    const rows  = Math.ceil(gridPhotos.length / 2);
    for (let i = 0; i < gridPhotos.length; i++) {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const px  = M_LEFT + col * (cellW + gap);
      const py  = y + row * (cellH + gap);
      try { pdf.addImage(gridPhotos[i], 'JPEG', px, py, cellW, cellH, undefined, 'FAST'); }
      catch(e) { try { pdf.addImage(gridPhotos[i], 'PNG', px, py, cellW, cellH, undefined, 'FAST'); } catch(e2){} }
    }
    y += rows * cellH + (rows - 1) * gap + 14;
  }
  // 사진 0장이면 사진 영역 생략 — 사양표를 바로 그림

  // 사양 표 — 글머리 동그라미 + 라벨
  pdf.setFont('NanumGothic','bold'); pdf.setFontSize(10.5); _setText(pdf, [29,78,216]);
  // 글머리 동그라미 (속이 찬 작은 원)
  _setFill(pdf, [29,78,216]);
  pdf.circle(M_LEFT + 1.2, y - 1.6, 1.0, 'F');
  // 라벨 텍스트 — 동그라미 우측에 배치
  pdf.text('장비 사양 (Specifications)', M_LEFT + 4.2, y);
  y += 5;
  const specDefs = [
    ['생산속도',                 eq.spec_speed],
    ['소비전력 (Total Power)',  eq.spec_power],
    ['포장재 종류 (Packing material)', eq.spec_packing],
    ['외형 치수 (Dimension)',    eq.spec_dimension],
    ['장비 중량 (Weight)',       eq.spec_weight],
    ['공압 조건 (Compressed air)', eq.spec_air],
    ['전원 사양 (Power source)', eq.spec_voltage]
  ];
  const specRows = specDefs.filter(([,v]) => v);
  const SPEC_LABEL_W = 60;
  const SPEC_VALUE_W = CONTENT_W - SPEC_LABEL_W;
  const SPEC_ROW_H = 9;
  if (specRows.length === 0) {
    _drawCell(pdf, M_LEFT, y, CONTENT_W, SPEC_ROW_H, '등록된 스펙 정보가 없습니다.', { align:'center', textColor: [156,163,175] });
    y += SPEC_ROW_H;
  } else {
    specRows.forEach(([k,v]) => {
      _drawCell(pdf, M_LEFT,                  y, SPEC_LABEL_W, SPEC_ROW_H, k, { fillColor: [244,246,249], fontName:'NanumGothic', fontStyle:'bold', textColor:[30,58,95] });
      _drawCell(pdf, M_LEFT + SPEC_LABEL_W,   y, SPEC_VALUE_W, SPEC_ROW_H, v, {});
      y += SPEC_ROW_H;
    });
  }

  drawFooter(pdf);
}

// ── 장비 추가 사진 페이지 (5장 이상일 때, 5~N 번째 사진을 4장씩 페이지에) ──
function drawEquipExtraPhotoPages(pdf, eq, photos, qHeader) {
  const PER_PAGE = 4;
  const totalPages = Math.ceil(photos.length / PER_PAGE);
  for (let p = 0; p < totalPages; p++) {
    pdf.addPage();
    const chunk = photos.slice(p * PER_PAGE, (p + 1) * PER_PAGE);
    _drawEquipExtraPhotoPage(pdf, eq, chunk, qHeader, p + 1, totalPages);
  }
}

function _drawEquipExtraPhotoPage(pdf, eq, chunk, qHeader, pageNum, totalPages) {
  // 헤더 — 사양서 페이지와 동일 양식이되 "(추가 사진 N/N)" 라벨
  pdf.setFont('NanumGothic','normal'); pdf.setFontSize(7.5); _setText(pdf, COLOR_TEXT_MUTED);
  pdf.text('장비 사양서 · ' + (qHeader.id||'') + ' · ' + (qHeader.company||''), M_LEFT, M_TOP + 2);
  pdf.setFont('NanumGothic','bold'); pdf.setFontSize(16); _setText(pdf, COLOR_TEXT_DARK);
  const label = (eq.name || '-') + ` (추가 사진 ${pageNum}/${totalPages})`;
  pdf.text(label, M_LEFT, M_TOP + 10);
  if (eq.model && eq.model !== '-') {
    pdf.setFont('NanumGothic','normal'); pdf.setFontSize(10); _setText(pdf, [55,65,81]);
    pdf.text(eq.model, M_LEFT, M_TOP + 16);
  }
  pdf.setFont('NanumGothic','normal'); pdf.setFontSize(8); _setText(pdf, [148,163,184]);
  pdf.text('(주)비피케이', PAGE_W - M_RIGHT, M_TOP + 6, { align: 'right' });
  pdf.text('TEL (053)716-7600', PAGE_W - M_RIGHT, M_TOP + 11, { align: 'right' });
  _setDraw(pdf, [29,78,216]); pdf.setLineWidth(1.2);
  pdf.line(M_LEFT, M_TOP + 22, PAGE_W - M_RIGHT, M_TOP + 22);

  // 2x2 grid — 신청사진 페이지와 동일한 규격 (84×63mm)
  const photoW = (CONTENT_W - 6) / 2;
  const photoH = photoW * 0.75;
  const gap    = 6;
  const startY = M_TOP + 28;
  for (let i = 0; i < chunk.length; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = M_LEFT + col * (photoW + gap);
    const y = startY + row * (photoH + gap);
    try { pdf.addImage(chunk[i], 'JPEG', x, y, photoW, photoH, undefined, 'FAST'); }
    catch(e) { try { pdf.addImage(chunk[i], 'PNG', x, y, photoW, photoH, undefined, 'FAST'); } catch(e2){} }
  }
  drawFooter(pdf);
}

// ── 헬퍼: 장비별 사진 배열 정규화 (단일 dataUrl도 허용해 하위호환 유지) ──
function _normalizeEqPhotos(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value) return [value];
  return [];
}

// ════════════════════════════════════════════════════════════════════
// 메인 진입점 — 견적서 + 장비사양서 + 신청 사진 모든 페이지 빌드
// ════════════════════════════════════════════════════════════════════
async function buildQuotePdf(q, a, eqInfoList, eqPhotos, jikinDataUrl, productPhotos, spacePhotos) {
  await ensurePdfFonts();
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF('p', 'mm', 'a4');
  registerPdfFonts(pdf);

  // 1페이지: 견적서
  drawQuotePage(pdf, q, a || {}, jikinDataUrl);

  // 2페이지~: 장비별 사양서 (+ 사진 5장 이상이면 추가 페이지)
  (eqInfoList || []).forEach((eq, i) => {
    pdf.addPage();
    const allPhotos = _normalizeEqPhotos(eqPhotos ? eqPhotos[i] : null);
    drawEquipPage(pdf, eq, allPhotos, { id: q.id, company: q.company });
    const extra = allPhotos.slice(4);
    if (extra.length) drawEquipExtraPhotoPages(pdf, eq, extra, { id: q.id, company: q.company });
  });

  // 신청 사진 페이지 — 제품 사진 / 설치 장소 사진 (있을 때만, 페이지당 4장 grid)
  const _productPhotos = (productPhotos || []).filter(Boolean);
  const _spacePhotos   = (spacePhotos   || []).filter(Boolean);
  if (_productPhotos.length) drawSubmissionPhotoPages(pdf, _productPhotos, '제품 사진',     { id: q.id, company: q.company });
  if (_spacePhotos.length)   drawSubmissionPhotoPages(pdf, _spacePhotos,   '설치 장소 사진', { id: q.id, company: q.company });

  return pdf;
}

// ── 신청 사진(제품/설치) 페이지 그리기 — 페이지당 최대 4장 (2x2 grid) ──
function drawSubmissionPhotoPages(pdf, photos, title, qHeader) {
  const PER_PAGE = 4;
  const totalPages = Math.ceil(photos.length / PER_PAGE);
  for (let p = 0; p < totalPages; p++) {
    pdf.addPage();
    const chunk = photos.slice(p * PER_PAGE, (p + 1) * PER_PAGE);
    _drawSubmissionPhotoPage(pdf, chunk, title, qHeader, p + 1, totalPages);
  }
}

function _drawSubmissionPhotoPage(pdf, chunk, title, qHeader, pageNum, totalPages) {
  // 헤더 (장비 사양서 페이지와 동일 양식)
  pdf.setFont('NanumGothic','normal'); pdf.setFontSize(7.5); _setText(pdf, COLOR_TEXT_MUTED);
  pdf.text((qHeader.company||'') + ' 신청 자료 · ' + (qHeader.id||''), M_LEFT, M_TOP + 2);
  pdf.setFont('NanumGothic','bold'); pdf.setFontSize(16); _setText(pdf, COLOR_TEXT_DARK);
  const pageLabel = totalPages > 1 ? ` (${pageNum}/${totalPages})` : '';
  pdf.text(title + pageLabel, M_LEFT, M_TOP + 10);
  // 우측
  pdf.setFont('NanumGothic','normal'); pdf.setFontSize(8); _setText(pdf, [148,163,184]);
  pdf.text('(주)비피케이',          PAGE_W - M_RIGHT, M_TOP + 6,  { align: 'right' });
  pdf.text('TEL (053)716-7600', PAGE_W - M_RIGHT, M_TOP + 11, { align: 'right' });
  // 헤더 하단 라인
  _setDraw(pdf, [29,78,216]); pdf.setLineWidth(1.2);
  pdf.line(M_LEFT, M_TOP + 18, PAGE_W - M_RIGHT, M_TOP + 18);

  // 사진 grid (2x2) — A4 가용 폭 174mm, gap 6mm → photoW = 84mm, height 63mm (4:3 비율)
  const photoW = (CONTENT_W - 6) / 2;     // ≈ 84mm
  const photoH = photoW * 0.75;           // 4:3 → ≈ 63mm
  const gap    = 6;
  const startY = M_TOP + 24;
  for (let i = 0; i < chunk.length; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = M_LEFT + col * (photoW + gap);
    const y = startY + row * (photoH + gap);
    if (chunk[i]) {
      try { pdf.addImage(chunk[i], 'JPEG', x, y, photoW, photoH, undefined, 'FAST'); }
      catch(e) { try { pdf.addImage(chunk[i], 'PNG', x, y, photoW, photoH, undefined, 'FAST'); } catch(e2){} }
    } else {
      // 빈 자리 placeholder
      _setDraw(pdf, COLOR_BORDER_LIGHT); pdf.setLineWidth(0.2);
      pdf.rect(x, y, photoW, photoH, 'S');
    }
  }

  drawFooter(pdf);
}

// ── 장비사양서 단독 PDF (genEquipPDF 용) ──
//   photos: per-equipment 사진 배열의 배열 (단일 dataUrl도 하위호환 허용)
async function buildEquipPdf(q, eqList, photos) {
  await ensurePdfFonts();
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF('p', 'mm', 'a4');
  registerPdfFonts(pdf);
  (eqList || []).forEach((eq, i) => {
    if (i > 0) pdf.addPage();
    const allPhotos = _normalizeEqPhotos(photos ? photos[i] : null);
    drawEquipPage(pdf, eq, allPhotos, { id: q.id, company: q.company });
    const extra = allPhotos.slice(4);
    if (extra.length) drawEquipExtraPhotoPages(pdf, eq, extra, { id: q.id, company: q.company });
  });
  return pdf;
}

// 글로벌로 노출 (기존 genPDF / genEquipPDF 안에서 호출)
window.buildQuotePdf = buildQuotePdf;
window.buildEquipPdf = buildEquipPdf;

})();
