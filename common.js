// ============================================================
// BPK Smart 2026 — 공통 유틸리티 (두 HTML이 공유)
// 의존성: config.js (API_ENABLED), api.js (apiCall, showToast)
// ============================================================

// ── localStorage 키 ──
const SK = { EQ: 'bpk_eq_v2', APP: 'bpk_app_v1', QT: 'bpk_qt_v1' };

// ── 관리자 로컬 fallback (API_ENABLED=false 시에만 사용) ──
const CRED = { id: 'bpkadmin', pw: 'BPK2026!' };

// ── 한글 금액 변환 (예: 12345 → '금 일만이천삼백사십오원정')
function numToKorean(num) {
  if (!num) return '금 영원정';
  const ko = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
  const u1 = ['', '십', '백', '천'];
  const u2 = ['', '만', '억', '조'];
  let result = ''; let gi = 0; let n = num;
  while (n > 0) {
    const chunk = n % 10000;
    if (chunk !== 0) {
      let cs = ''; let c = chunk;
      for (let i = 0; i < 4; i++) {
        const d = c % 10;
        if (d !== 0) cs = (d === 1 && i > 0 ? '' : ko[d]) + u1[i] + cs;
        c = Math.floor(c / 10);
      }
      result = cs + u2[gi] + result;
    }
    gi++; n = Math.floor(n / 10000);
  }
  return '금 ' + result + '원정';
}

// ── YouTube URL → videoId 추출
function getYouTubeId(url) {
  if (!url) return null;
  const m = String(url).match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|v\/))([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

// ── 이미지 파일 압축 (canvas, 최대 900px / JPEG quality 0.8)
function compressImage(dataUrl) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const MAX = 900;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height, 1));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * scale);
      cv.height = Math.round(img.height * scale);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      resolve(cv.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

// ============================================================
// 사진 base64 변환 + 캐시 (PDF 생성용)
// ============================================================

// 메모리 캐시: Drive URL → base64 dataURI
const _photoCache = new Map();

// 동일 URL에 대한 동시 요청 묶음 (in-flight de-dup)
const _photoInflight = new Map();

// ── T1-4: localStorage 영구 캐시 (세션 간 유지)
// 50개 LRU + 1MB 안전 한도. QuotaExceeded 시 자동 비움.
const _photoCacheLS_KEY = 'bpk_photo_cache_v1';
const _photoCacheLS_MAX = 50;
const _photoCacheLS_BYTE_MAX = 1024 * 1024; // 1MB

const _photoCacheLS = (() => {
  try {
    const raw = localStorage.getItem(_photoCacheLS_KEY);
    if (!raw) return new Map();
    const arr = JSON.parse(raw);
    // 부팅 시 메모리 캐시에도 워밍
    arr.forEach(([k, v]) => _photoCache.set(k, v));
    return new Map(arr);
  } catch (e) { return new Map(); }
})();

let _photoCachePersistTimer = null;
function _persistPhotoCache() {
  // 디바운스 (연속 호출 시 마지막만 저장)
  if (_photoCachePersistTimer) clearTimeout(_photoCachePersistTimer);
  _photoCachePersistTimer = setTimeout(() => {
    try {
      // LRU: 최근 항목 우선 (Map은 삽입 순서 유지)
      const arr = [..._photoCacheLS.entries()].slice(-_photoCacheLS_MAX);
      const json = JSON.stringify(arr);
      if (json.length > _photoCacheLS_BYTE_MAX) {
        // 너무 크면 절반만 저장
        localStorage.setItem(_photoCacheLS_KEY, JSON.stringify(arr.slice(arr.length / 2 | 0)));
      } else {
        localStorage.setItem(_photoCacheLS_KEY, json);
      }
    } catch (e) {
      // QuotaExceeded → 비우고 재시도
      try { localStorage.removeItem(_photoCacheLS_KEY); } catch (_) {}
    }
  }, 200);
}

function _putPhotoCache(url, base64) {
  _photoCache.set(url, base64);
  _photoCacheLS.set(url, base64);
  // 50개 초과 시 가장 오래된 것 제거
  if (_photoCacheLS.size > _photoCacheLS_MAX) {
    const oldestKey = _photoCacheLS.keys().next().value;
    _photoCacheLS.delete(oldestKey);
  }
  _persistPhotoCache();
}

// ── 단건 변환: Drive URL → base64
//   - data: URL이면 그대로 반환
//   - https://drive.google.com/* 이면 GAS 경유 base64 변환 (CORS 우회)
//   - 캐시 hit 시 즉시 반환
async function resolvePhoto(url) {
  if (!url) return null;
  if (url.startsWith('data:')) return url;
  if (_photoCache.has(url)) return _photoCache.get(url);
  if (_photoInflight.has(url)) return _photoInflight.get(url);
  if (!url.startsWith('https://drive.google.com')) return null;
  if (typeof API_ENABLED === 'undefined' || !API_ENABLED) return null;

  const p = (async () => {
    try {
      const res = await apiCall('getPhotoBase64', { url });
      if (res && res.ok && res.base64) {
        _putPhotoCache(url, res.base64); // T1-4: 메모리 + localStorage
        return res.base64;
      }
      console.warn('[resolvePhoto] 실패 응답:', res);
      return null;
    } catch (e) {
      console.error('[resolvePhoto] 예외:', e);
      return null;
    } finally {
      _photoInflight.delete(url);
    }
  })();
  _photoInflight.set(url, p);
  return p;
}

// ── 일괄 변환: URL[] → base64[] (병렬 + 백엔드 bulk endpoint 활용)
//   - 캐시에 있는 것은 즉시 반환
//   - 캐시에 없는 것만 GAS bulk 1회 호출
//   - bulk endpoint 미지원 GAS면 자동 fallback (개별 병렬 호출)
async function resolvePhotosBatch(urls) {
  const result = new Array(urls.length).fill(null);
  const need = []; // {idx, url}

  urls.forEach((u, i) => {
    if (!u) { result[i] = null; return; }
    if (u.startsWith('data:')) { result[i] = u; return; }
    if (_photoCache.has(u)) { result[i] = _photoCache.get(u); return; }
    if (u.startsWith('https://drive.google.com')) need.push({ idx: i, url: u });
  });

  if (!need.length) return result;
  if (typeof API_ENABLED === 'undefined' || !API_ENABLED) return result;

  // 1) bulk endpoint 시도
  try {
    const res = await apiCall('getPhotosBase64Bulk', { urls: need.map(n => n.url) });
    if (res && res.ok && Array.isArray(res.data)) {
      need.forEach((n, k) => {
        const item = res.data[k];
        if (item && item.ok && item.base64) {
          _putPhotoCache(n.url, item.base64); // T1-4
          result[n.idx] = item.base64;
        }
      });
      return result;
    }
  } catch (e) {
    // bulk 미지원 → fallback
  }

  // 2) Fallback: 병렬 단건 호출 (Promise.all)
  const arr = await Promise.all(need.map(n => resolvePhoto(n.url)));
  need.forEach((n, k) => { result[n.idx] = arr[k]; });
  return result;
}

// ── 캐시 비우기 (필요 시 외부에서 호출, 예: 사진 변경 후)
function clearPhotoCache() {
  _photoCache.clear();
  _photoCacheLS.clear();
  try { localStorage.removeItem(_photoCacheLS_KEY); } catch (e) {}
}

// ============================================================
// 직인 lazy load (jikin.js eager script 대체)
// 사용처: PDF 생성 직전에 한 번 호출, 결과는 모듈 변수에 캐시
// ============================================================
let _jikinCache = null;

async function loadJikin() {
  if (_jikinCache !== null) return _jikinCache;
  // 이미 jikin.js가 로드되어 JIKINTB64가 있으면 그대로 사용 (역호환)
  if (typeof JIKINTB64 !== 'undefined' && JIKINTB64) {
    _jikinCache = JIKINTB64;
    return _jikinCache;
  }
  try {
    const resp = await fetch('jikin.js', { cache: 'force-cache' });
    if (!resp.ok) throw new Error('jikin.js fetch failed');
    const text = await resp.text();
    // const JIKINTB64 = '...' 형태에서 base64 부분만 추출
    const m = text.match(/['"`](data:image\/[^'"`]+)['"`]/);
    _jikinCache = m ? m[1] : '';
  } catch (e) {
    console.warn('[loadJikin] 실패:', e);
    _jikinCache = '';
  }
  return _jikinCache;
}

// ============================================================
// 현재 시각 — 'YYYY-MM-DD HH:MM' (한국 로컬 시간 기준)
// 견적서 작성/수정 일시, 신청 접수 일시 등에 사용
// ============================================================
function nowDateTime() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 'YYYY-MM-DD' (날짜만 — CSV 파일명, 견적 유효일 등)
function nowDate() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

// ============================================================
// 신청 내용 contentHash — 같은 회사가 동일한 내용을 중복 제출했는지 판별용
// GAS 의 _computeAppContentHash 와 동일한 알고리즘. MD5 16자 hex.
// ============================================================
function appContentHash(app) {
  if (!app) return '';
  const sortJoin = v => Array.isArray(v) ? v.slice().sort().join(',') : (v || '');
  const parts = [
    app.bizno || '',
    app.pname || '',
    app.texture || '',
    sortJoin(app.processes),
    sortJoin(app.pkgtypes),
    app.qty || '',
    app.speed || '',
    app.problem_type || '',
    sortJoin(app.problem_points),
    sortJoin((app.equipment || []).map(String)),
    sortJoin(app.electric),
    app.air_yn || '',
    app.air_flow || '',
    app.space_w || '',
    app.space_h || '',
    app.memo || ''
  ].join('|');
  return _md5_16(parts);
}

// 동기 MD5 (16자 hex). 외부 라이브러리 없이 작은 구현
function _md5_16(s) {
  function md5(str) {
    function rh(n){let s='',j;for(j=0;j<=3;j++)s+=((n>>(j*8+4))&0x0F).toString(16)+((n>>(j*8))&0x0F).toString(16);return s;}
    function ad(x,y){const lsw=(x&0xFFFF)+(y&0xFFFF);const msw=(x>>16)+(y>>16)+(lsw>>16);return(msw<<16)|(lsw&0xFFFF);}
    function rl(n,c){return(n<<c)|(n>>>(32-c));}
    function cm(q,a,b,x,s,t){return ad(rl(ad(ad(a,q),ad(x,t)),s),b);}
    function ff(a,b,c,d,x,s,t){return cm((b&c)|((~b)&d),a,b,x,s,t);}
    function gg(a,b,c,d,x,s,t){return cm((b&d)|(c&(~d)),a,b,x,s,t);}
    function hh(a,b,c,d,x,s,t){return cm(b^c^d,a,b,x,s,t);}
    function ii(a,b,c,d,x,s,t){return cm(c^(b|(~d)),a,b,x,s,t);}
    function ct(s){let n=((s.length+8)>>6)+1,a=new Array(n*16);for(let i=0;i<n*16;i++)a[i]=0;for(let i=0;i<s.length;i++)a[i>>2]|=s.charCodeAt(i)<<((i%4)*8);a[s.length>>2]|=0x80<<((s.length%4)*8);a[n*16-2]=s.length*8;return a;}
    const x=ct(unescape(encodeURIComponent(str)));let a=1732584193,b=-271733879,c=-1732584194,d=271733878;
    for(let i=0;i<x.length;i+=16){const oa=a,ob=b,oc=c,od=d;
      a=ff(a,b,c,d,x[i+0],7,-680876936);d=ff(d,a,b,c,x[i+1],12,-389564586);c=ff(c,d,a,b,x[i+2],17,606105819);b=ff(b,c,d,a,x[i+3],22,-1044525330);
      a=ff(a,b,c,d,x[i+4],7,-176418897);d=ff(d,a,b,c,x[i+5],12,1200080426);c=ff(c,d,a,b,x[i+6],17,-1473231341);b=ff(b,c,d,a,x[i+7],22,-45705983);
      a=ff(a,b,c,d,x[i+8],7,1770035416);d=ff(d,a,b,c,x[i+9],12,-1958414417);c=ff(c,d,a,b,x[i+10],17,-42063);b=ff(b,c,d,a,x[i+11],22,-1990404162);
      a=ff(a,b,c,d,x[i+12],7,1804603682);d=ff(d,a,b,c,x[i+13],12,-40341101);c=ff(c,d,a,b,x[i+14],17,-1502002290);b=ff(b,c,d,a,x[i+15],22,1236535329);
      a=gg(a,b,c,d,x[i+1],5,-165796510);d=gg(d,a,b,c,x[i+6],9,-1069501632);c=gg(c,d,a,b,x[i+11],14,643717713);b=gg(b,c,d,a,x[i+0],20,-373897302);
      a=gg(a,b,c,d,x[i+5],5,-701558691);d=gg(d,a,b,c,x[i+10],9,38016083);c=gg(c,d,a,b,x[i+15],14,-660478335);b=gg(b,c,d,a,x[i+4],20,-405537848);
      a=gg(a,b,c,d,x[i+9],5,568446438);d=gg(d,a,b,c,x[i+14],9,-1019803690);c=gg(c,d,a,b,x[i+3],14,-187363961);b=gg(b,c,d,a,x[i+8],20,1163531501);
      a=gg(a,b,c,d,x[i+13],5,-1444681467);d=gg(d,a,b,c,x[i+2],9,-51403784);c=gg(c,d,a,b,x[i+7],14,1735328473);b=gg(b,c,d,a,x[i+12],20,-1926607734);
      a=hh(a,b,c,d,x[i+5],4,-378558);d=hh(d,a,b,c,x[i+8],11,-2022574463);c=hh(c,d,a,b,x[i+11],16,1839030562);b=hh(b,c,d,a,x[i+14],23,-35309556);
      a=hh(a,b,c,d,x[i+1],4,-1530992060);d=hh(d,a,b,c,x[i+4],11,1272893353);c=hh(c,d,a,b,x[i+7],16,-155497632);b=hh(b,c,d,a,x[i+10],23,-1094730640);
      a=hh(a,b,c,d,x[i+13],4,681279174);d=hh(d,a,b,c,x[i+0],11,-358537222);c=hh(c,d,a,b,x[i+3],16,-722521979);b=hh(b,c,d,a,x[i+6],23,76029189);
      a=hh(a,b,c,d,x[i+9],4,-640364487);d=hh(d,a,b,c,x[i+12],11,-421815835);c=hh(c,d,a,b,x[i+15],16,530742520);b=hh(b,c,d,a,x[i+2],23,-995338651);
      a=ii(a,b,c,d,x[i+0],6,-198630844);d=ii(d,a,b,c,x[i+7],10,1126891415);c=ii(c,d,a,b,x[i+14],15,-1416354905);b=ii(b,c,d,a,x[i+5],21,-57434055);
      a=ii(a,b,c,d,x[i+12],6,1700485571);d=ii(d,a,b,c,x[i+3],10,-1894986606);c=ii(c,d,a,b,x[i+10],15,-1051523);b=ii(b,c,d,a,x[i+1],21,-2054922799);
      a=ii(a,b,c,d,x[i+8],6,1873313359);d=ii(d,a,b,c,x[i+15],10,-30611744);c=ii(c,d,a,b,x[i+6],15,-1560198380);b=ii(b,c,d,a,x[i+13],21,1309151649);
      a=ii(a,b,c,d,x[i+4],6,-145523070);d=ii(d,a,b,c,x[i+11],10,-1120210379);c=ii(c,d,a,b,x[i+2],15,718787259);b=ii(b,c,d,a,x[i+9],21,-343485551);
      a=ad(a,oa);b=ad(b,ob);c=ad(c,oc);d=ad(d,od);}
    return rh(a)+rh(b)+rh(c)+rh(d);
  }
  return md5(s).slice(0, 16);
}

// 신청 배열을 bizno 기준 그룹화. 각 그룹: { bizno, company, latest, all, hasDuplicates, hasChanges }
function groupAppsByBizno(apps) {
  const groups = {};
  (apps || []).forEach(a => {
    const key = a.bizno || ('__no_bizno_' + a.id);
    if (!groups[key]) groups[key] = { bizno: a.bizno || '', company: a.company || '', all: [], hashes: new Set() };
    groups[key].all.push(a);
    if (a.contentHash) groups[key].hashes.add(a.contentHash);
  });
  // 각 그룹: 정렬 + 메타 계산
  return Object.values(groups).map(g => {
    g.all.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // 최신 먼저
    g.latest = g.all[0];
    g.company = g.latest.company || g.company;
    // 중복 = 같은 contentHash 가 2개 이상인 경우
    const counts = {};
    g.all.forEach(a => { const h = a.contentHash || '__none__'; counts[h] = (counts[h] || 0) + 1; });
    g.hasDuplicates = Object.values(counts).some(c => c >= 2);
    g.hasChanges = Object.keys(counts).length >= 2;
    return g;
  }).sort((a, b) => (a.latest.date < b.latest.date ? 1 : -1));
}

// 견적 배열을 appId 기준 그룹화. 같은 그룹 안에서 version 내림차순 정렬
function groupQuotesByApp(quotes) {
  const groups = {};
  (quotes || []).forEach(q => {
    const key = q.appId || ('__no_app_' + q.id);
    if (!groups[key]) groups[key] = { appId: q.appId || '', company: q.company || '', versions: [], latest: null };
    groups[key].versions.push(q);
  });
  Object.values(groups).forEach(g => {
    g.versions.sort((a, b) => (Number(b.version) || 0) - (Number(a.version) || 0));
    g.latest = g.versions.find(q => String(q.isLatest) === '1') || g.versions[0];
  });
  return Object.values(groups).sort((a, b) => (a.latest.date < b.latest.date ? 1 : -1));
}

// ============================================================
// 견적서 변경 감지 해시 (T1-3: Drive 재업로드 스킵 판정용)
// 항목/수량/가격/공정/비고가 같으면 동일 PDF로 간주
// ============================================================
function quoteHash(q) {
  if (!q) return '';
  const items = (q.items || []).map(i => `${i.name}|${i.qty}|${i.price}`).join(';');
  return [items, q.total||0, q.process||'', q.memo||''].join('::');
}

// ============================================================
// 모달 / 토스트 (기존 인라인 함수 통일)
// ============================================================
function openModal(id) { const el = document.getElementById(id); if (el) el.classList.add('open'); }
function closeModal(id) { const el = document.getElementById(id); if (el) el.classList.remove('open'); }

// 모달 외부 클릭 시 닫기 (자동 바인딩)
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.modal-ov').forEach(el => {
    el.addEventListener('click', e => { if (e.target === el) el.classList.remove('open'); });
  });
});

// ============================================================
// PDF 생성 진행 모달 — 단계별 progress + UI 차단
// 견적서 발급/재발급 시 PDF 생성·다운로드·Drive 업로드 흐름에서 사용
// ============================================================
// 단계 사이 "정체감" 해소용 creep 애니메이션 — 한 단계가 길어도 바가 천천히 움직이며 살아있는 느낌
let _pdfProgressCreepTimer = null;
function _stopPdfProgressCreep() {
  if (_pdfProgressCreepTimer) { clearInterval(_pdfProgressCreepTimer); _pdfProgressCreepTimer = null; }
}

function showPdfProgress(stage, totalStages, label) {
  let el = document.getElementById('pdf-progress-modal');
  if (!el) {
    el = document.createElement('div');
    el.id = 'pdf-progress-modal';
    el.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:99999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px);font-family:Pretendard,sans-serif';
    el.innerHTML = `
      <div style="background:#fff;border-radius:14px;padding:32px 36px;min-width:380px;max-width:480px;box-shadow:0 24px 64px rgba(0,0,0,.25)">
        <div style="font-size:11px;color:#64748b;letter-spacing:2px;font-weight:700;margin-bottom:6px">BPK SMART 2026</div>
        <div style="font-size:18px;font-weight:700;color:#0f172a;margin-bottom:20px" id="pdf-progress-title">견적서 생성 중</div>
        <div style="background:#e2e8f0;border-radius:8px;height:8px;overflow:hidden;margin-bottom:14px">
          <div id="pdf-progress-bar" style="background:linear-gradient(90deg,#1d4ed8,#3b82f6);height:100%;width:0%;transition:width .3s ease"></div>
        </div>
        <div id="pdf-progress-label" style="font-size:13.5px;color:#475569;line-height:1.5;font-weight:500"></div>
        <div id="pdf-progress-stage" style="font-size:12px;color:#94a3b8;margin-top:8px"></div>
      </div>
    `;
    document.body.appendChild(el);
  }
  // 색상 reset (이전 실패에서 빨간색이었을 수 있음)
  document.getElementById('pdf-progress-bar').style.background = 'linear-gradient(90deg,#1d4ed8,#3b82f6)';
  document.getElementById('pdf-progress-title').textContent = '견적서 생성 중';

  _stopPdfProgressCreep();
  const total = Math.max(1, totalStages);
  const pct = Math.min(100, Math.max(0, Math.round((stage / total) * 100)));
  // 다음 단계까지의 85% 지점을 ceiling 으로 — 다음 단계 호출 시 자연스럽게 jump up
  const nextPct = Math.min(100, Math.round(((stage + 1) / total) * 100));
  const ceiling = pct + (nextPct - pct) * 0.85;

  const bar = document.getElementById('pdf-progress-bar');
  bar.style.width = pct + '%';
  document.getElementById('pdf-progress-label').textContent = label || '';
  document.getElementById('pdf-progress-stage').textContent =
    stage <= 0 ? '준비 중...' : `${stage} / ${total} 단계 (${pct}%)`;
  el.style.display = 'flex';

  // creep 시작 (ease-out: 처음엔 빠르게, ceiling 가까울수록 느리게)
  if (pct < 100 && ceiling > pct + 0.5) {
    let cur = pct;
    const tick = () => {
      const gap = ceiling - cur;
      if (gap <= 0.2) { _stopPdfProgressCreep(); return; }
      cur += Math.max(0.12, gap * 0.04);
      bar.style.width = cur + '%';
    };
    tick();  // 즉시 첫 tick — 바가 비어있어 보이지 않도록
    _pdfProgressCreepTimer = setInterval(tick, 200);
  }
}

// success === true: 완료 표시 후 1.5초 뒤 자동 닫기
// success === false: 에러 표시 + 사용자 닫기 버튼 (수동 닫기)
// success === undefined: 즉시 닫기
function hidePdfProgress(success, message) {
  _stopPdfProgressCreep();
  const el = document.getElementById('pdf-progress-modal');
  if (!el) return;
  if (success === true) {
    document.getElementById('pdf-progress-bar').style.width = '100%';
    document.getElementById('pdf-progress-bar').style.background = 'linear-gradient(90deg,#10b981,#22c55e)';
    document.getElementById('pdf-progress-title').textContent = '✓ 완료';
    document.getElementById('pdf-progress-label').textContent = message || 'Drive에 저장 완료';
    document.getElementById('pdf-progress-stage').textContent = '';
    setTimeout(() => { if (el) el.style.display = 'none'; }, 1500);
  } else if (success === false) {
    document.getElementById('pdf-progress-title').textContent = '⚠️ 생성 실패';
    document.getElementById('pdf-progress-bar').style.background = '#dc2626';
    document.getElementById('pdf-progress-label').textContent = message || '알 수 없는 오류';
    document.getElementById('pdf-progress-stage').innerHTML = '<button onclick="document.getElementById(\'pdf-progress-modal\').style.display=\'none\'" style="margin-top:14px;padding:8px 18px;background:#dc2626;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;font-family:inherit">닫기</button>';
  } else {
    el.style.display = 'none';
  }
}

window.showPdfProgress = showPdfProgress;
window.hidePdfProgress = hidePdfProgress;
