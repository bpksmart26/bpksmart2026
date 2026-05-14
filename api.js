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

// ── 멱등성 키 헬퍼 (P2-G6)
// 클라이언트가 더블 클릭 / 네트워크 실패 후 재시도해도 서버가 같은 작업으로 인지.
// 스코프: 페이지 단위(window 전역 변수) — 페이지 리로드 시 새 키 발급(=새 신청으로 취급)되어
// 같은 브라우저를 다른 사용자가 이어 쓰는 경우의 키 leak 방지.
//
// 사용 패턴:
//   const key = _ensureIdempotencyKey('saveApp');   // 같은 흐름이면 동일 키 재사용
//   data._idemKey = key;
//   const r = await apiCall('saveApp', data);
//   if (r && r.ok) _clearIdempotencyKey('saveApp'); // 성공 시 clear → 다음 호출은 새 키
function _newIdempotencyKey() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'idem-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
}
function _ensureIdempotencyKey(scope) {
  if (typeof window === 'undefined') return _newIdempotencyKey();
  window._bpkIdemKeys = window._bpkIdemKeys || {};
  if (!window._bpkIdemKeys[scope]) window._bpkIdemKeys[scope] = _newIdempotencyKey();
  return window._bpkIdemKeys[scope];
}
function _clearIdempotencyKey(scope) {
  if (typeof window === 'undefined' || !window._bpkIdemKeys) return;
  delete window._bpkIdemKeys[scope];
}

// ── 사진 1장을 Drive에 업로드 → 썸네일 URL 반환
// meta: { type: 'space'|'equipment'|'pkg', company: '회사명', eqName: '장비명' }
//
// P2-G6: 같은 base64 의 재업로드는 동일한 idempotency 키를 자동 생성 → 서버 ScriptCache 가
// 같은 키의 이전 결과(이미 업로드된 Drive URL) 를 반환. retry / 네트워크 실패 후 사용자가
// 다시 클릭해도 Drive 에 중복 파일이 생기지 않음.
async function apiUploadPhoto(base64DataUrl, name, meta) {
  if (!API_ENABLED) return base64DataUrl;
  if (!base64DataUrl.startsWith('data:')) return base64DataUrl;
  const idemKey = (meta && meta._idemKey) || _photoIdemKey(base64DataUrl);
  const res = await apiCall('uploadPhoto', {
    base64: base64DataUrl,
    name: name || 'photo.jpg',
    type: meta?.type || 'other',
    company: meta?.company || '',
    eqName: meta?.eqName || '',
    _idemKey: idemKey
  });
  return (res && res.ok && res.url) ? res.url : base64DataUrl;
}
// 같은 base64 = 같은 키 보장. 길이 + 머리 60자 의 single-pass hash.
function _photoIdemKey(b64) {
  if (!b64) return null;
  const head = b64.slice(0, 60);
  let h = 0;
  for (let i = 0; i < head.length; i++) h = ((h << 5) - h + head.charCodeAt(i)) | 0;
  return 'photo-' + b64.length + '-' + Math.abs(h).toString(36);
}

// ── 여러 장 업로드 (병렬, 새 base64만 업로드)
// Promise.all 로 모든 사진을 한꺼번에 GAS 로 전송 → 5장 사진 기준 5-15초 → 2-4초로 단축
// 업로드 실패 시 apiUploadPhoto 가 원본 base64 반환하므로 reject 안 됨 → 순서 보존
// onProgress(done, total) 콜백: 사진 1장 완료될 때마다 호출 (UI 진행바 갱신용)
async function apiUploadPhotos(base64Array, prefix, meta, onProgress) {
  if (!base64Array || !base64Array.length) return [];
  if (typeof onProgress !== 'function') {
    return Promise.all(
      base64Array.map((b64, i) => apiUploadPhoto(b64, `${prefix}_${i+1}.jpg`, meta))
    );
  }
  const total = base64Array.length;
  return Promise.all(base64Array.map(async (b64, i) => {
    const url = await apiUploadPhoto(b64, `${prefix}_${i+1}.jpg`, meta);
    try { onProgress(i + 1, total); } catch (e) {}
    return url;
  }));
}

// ── 로딩 오버레이 표시/숨김 (선택적 UI 헬퍼)
function showApiLoading(msg) {
  let el = document.getElementById('api-loading-ov');
  if (!el) {
    el = document.createElement('div');
    el.id = 'api-loading-ov';
    el.style.cssText = 'position:fixed;inset:0;background:rgba(255,255,255,.98);z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px';
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

// ── API 연결 상태 배지
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
