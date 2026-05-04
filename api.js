// ============================================================
// BPK Smart 2026 — API Helper
// 두 HTML 파일이 공통으로 사용하는 Google Sheets API 래퍼
// ============================================================

// ── 범용 API 호출 (모든 액션을 POST로 통일)
async function apiCall(action, data = {}) {
  if (!API_ENABLED) return null;
  try {
    const resp = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action, data })
    });
    return await resp.json();
  } catch (e) {
    console.warn('[API] 호출 실패:', action, e.message);
    return null;
  }
}

// ── Drive URL → base64 캐시 (페이지 세션 동안 유지)
const _b64Cache = {};

function _isDriveUrl(url) {
  return url && typeof url === 'string' && url.startsWith('https://drive.google.com');
}

// ── Drive URL 1개를 base64로 변환 (캐시 활용)
async function apiGetPhotoBase64(url) {
  if (!url || !API_ENABLED) return url;
  if (!_isDriveUrl(url)) return url;           // Drive URL이 아니면 그대로
  if (_b64Cache[url]) return _b64Cache[url];   // 캐시 히트
  const res = await apiCall('getPhotoBase64', { url });
  if (res && res.ok && res.base64) {
    _b64Cache[url] = res.base64;
    return res.base64;
  }
  return url; // 실패 시 원본 URL 그대로
}

// ── 여러 Drive URL을 배치로 base64 변환 (한 번의 API 호출)
async function apiResolvePhotos(urls) {
  if (!urls || !urls.length || !API_ENABLED) return urls || [];
  const toFetch = urls.filter(u => _isDriveUrl(u) && !_b64Cache[u]);
  if (toFetch.length) {
    const res = await apiCall('getPhotosBase64', { urls: toFetch });
    if (res && res.ok && res.data) {
      Object.entries(res.data).forEach(([k, v]) => { if (v) _b64Cache[k] = v; });
    }
  }
  return urls.map(u => _b64Cache[u] || u);
}

// ── 장비 배열 전체의 photos / photos_pkg를 base64로 변환
async function apiResolveEquipmentPhotos(equipmentArr) {
  if (!API_ENABLED || !equipmentArr || !equipmentArr.length) return equipmentArr;
  // 모든 Drive URL 수집 (중복 제거)
  const allUrls = [...new Set(
    equipmentArr.flatMap(eq => [...(eq.photos||[]), ...(eq.photos_pkg||[])])
      .filter(_isDriveUrl)
  )];
  if (!allUrls.length) return equipmentArr;
  // 배치 변환
  const toFetch = allUrls.filter(u => !_b64Cache[u]);
  if (toFetch.length) {
    // 20개씩 나눠서 요청 (Apps Script 응답 크기 제한 대비)
    const CHUNK = 20;
    for (let i = 0; i < toFetch.length; i += CHUNK) {
      const res = await apiCall('getPhotosBase64', { urls: toFetch.slice(i, i + CHUNK) });
      if (res && res.ok && res.data) {
        Object.entries(res.data).forEach(([k, v]) => { if (v) _b64Cache[k] = v; });
      }
    }
  }
  // 장비 배열의 photos/photos_pkg를 base64로 교체
  return equipmentArr.map(eq => ({
    ...eq,
    photos:     (eq.photos||[]).map(u => _b64Cache[u] || u),
    photos_pkg: (eq.photos_pkg||[]).map(u => _b64Cache[u] || u)
  }));
}

// ── 사진 1장을 Drive에 업로드 → URL 반환 (업로드 시 base64 캐싱)
// meta: { type: 'space'|'equipment'|'pkg', company: '회사명', eqName: '장비명' }
async function apiUploadPhoto(base64DataUrl, name, meta) {
  if (!API_ENABLED) return base64DataUrl;
  // 이미 Drive URL이면 재업로드 안 함
  if (!base64DataUrl.startsWith('data:')) return base64DataUrl;
  const res = await apiCall('uploadPhoto', {
    base64: base64DataUrl,
    name: name || 'photo.jpg',
    type: meta?.type || 'other',
    company: meta?.company || '',
    eqName: meta?.eqName || ''
  });
  if (res && res.ok && res.url) {
    _b64Cache[res.url] = base64DataUrl; // 업로드 직후 캐시 → 즉시 표시 가능
    return res.url;
  }
  return base64DataUrl;
}

// ── 여러 장 업로드 (순차, 새 base64만 업로드)
// meta: { type, company, eqName }
async function apiUploadPhotos(base64Array, prefix, meta) {
  const urls = [];
  for (let i = 0; i < base64Array.length; i++) {
    const url = await apiUploadPhoto(base64Array[i], `${prefix}_${i+1}.jpg`, meta);
    urls.push(url);
  }
  return urls;
}

// ── 로딩 오버레이 표시/숨김 (선택적 UI 헬퍼)
function showApiLoading(msg) {
  let el = document.getElementById('api-loading-ov');
  if (!el) {
    el = document.createElement('div');
    el.id = 'api-loading-ov';
    el.style.cssText = 'position:fixed;inset:0;background:rgba(255,255,255,.85);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px';
    el.innerHTML = '<div style="width:44px;height:44px;border:5px solid #dbeafe;border-top-color:#1d4ed8;border-radius:50%;animation:spin .8s linear infinite"></div><div id="api-loading-msg" style="font-size:15px;font-weight:600;color:#1e40af"></div>';
    document.body.appendChild(el);
  }
  document.getElementById('api-loading-msg').textContent = msg || '데이터를 불러오는 중...';
  el.style.display = 'flex';
}

function hideApiLoading() {
  const el = document.getElementById('api-loading-ov');
  if (el) el.style.display = 'none';
}

// ── API 연결 상태 배지 (elId 요소를 찾아 연결 결과를 표시)
async function initApiStatus(elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  const b = (bg, color, border, txt) =>
    `<span style="display:inline-flex;align-items:center;gap:5px;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;background:${bg};color:${color};border:1.5px solid ${border};white-space:nowrap;font-family:'Pretendard',sans-serif">${txt}</span>`;
  if (!API_ENABLED) {
    el.innerHTML = b('#fef9c3','#854d0e','#fde047','⚠️ 로컬 모드 (config.js URL 미설정)');
    return;
  }
  el.innerHTML = b('#f1f5f9','#64748b','#e2e8f0','🔄 서버 연결 확인 중...');
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'ping', data: {} })
    });
    const json = await res.json();
    if (json && json.ok) {
      el.innerHTML = b('#dcfce7','#166534','#86efac','🟢 서버 연결됨');
    } else {
      const msg = json && json.error ? json.error.substring(0, 60) : '응답 이상';
      el.innerHTML = b('#fee2e2','#991b1b','#fca5a5','🔴 서버 오류: ' + msg);
    }
  } catch(err) {
    el.innerHTML = b('#fee2e2','#991b1b','#fca5a5','🔴 연결 실패: ' + err.message.substring(0, 60));
  }
}

// ── 토스트 메시지
function showToast(msg, type) {
  let el = document.getElementById('api-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'api-toast';
    el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);padding:12px 24px;border-radius:10px;font-size:14px;font-weight:600;color:#fff;z-index:9999;transition:opacity .3s;opacity:0;pointer-events:none;white-space:nowrap';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.background = type === 'error' ? '#ef4444' : type === 'warn' ? '#f59e0b' : '#10b981';
  el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = '0'; }, 2800);
}
