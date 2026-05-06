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
        _photoCache.set(url, res.base64);
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
          _photoCache.set(n.url, item.base64);
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

// ── 캐시 비우기 (필요 시 외부에서 호출)
function clearPhotoCache() { _photoCache.clear(); }

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
