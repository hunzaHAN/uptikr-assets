// REST API 클라이언트
export class ApiError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code; } }

let bearer = null; // Electron 로컬 토큰 로그인 후에도 쿠키를 쓰지만, 필요 시 Bearer 병행
export function setBearer(t) { bearer = t; }

async function request(method, url, body, opts = {}) {
  const headers = { 'X-MacServer': '1', ...(opts.headers || {}) };
  if (bearer) headers.Authorization = 'Bearer ' + bearer;
  let payload;
  if (body !== undefined) {
    if (body instanceof Blob || body instanceof ArrayBuffer || body instanceof FormData) payload = body;
    else { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  }
  let res;
  try { res = await fetch(url, { method, headers, body: payload, credentials: 'same-origin', signal: opts.signal }); }
  catch (e) { if (e.name === 'AbortError') throw e; throw new ApiError(0, '서버에 연결할 수 없습니다.'); }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json().catch(() => ({})) : await res.text();
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || res.statusText || '요청 실패', data && data.code);
  return data;
}

export const api = {
  get: (u, o) => request('GET', u, undefined, o),
  post: (u, b, o) => request('POST', u, b, o),
  put: (u, b, o) => request('PUT', u, b, o),
  del: (u, o) => request('DELETE', u, undefined, o),

  info: () => request('GET', '/api/info'),
  me: () => request('GET', '/api/auth/me'),
  login: (username, password) => request('POST', '/api/auth/login', { username, password }),
  loginLocal: (token) => request('POST', '/api/auth/local', { token }),
  logout: () => request('POST', '/api/auth/logout'),
  setup: (body) => request('POST', '/api/setup', body),
  systemInfo: () => request('GET', '/api/system/info'),

  files: {
    shares: () => request('GET', '/api/files/shares'),
    list: (share, path = '', hidden = false) => request('GET', `/api/files/list?share=${enc(share)}&path=${enc(path)}${hidden ? '&hidden=1' : ''}`),
    stat: (share, path) => request('GET', `/api/files/stat?share=${enc(share)}&path=${enc(path)}`),
    text: (share, path) => request('GET', `/api/files/text?share=${enc(share)}&path=${enc(path)}`),
    search: (q, share) => request('GET', `/api/files/search?q=${enc(q)}${share ? '&share=' + enc(share) : ''}`),
    downloadUrl: (share, path, inline = false) => `/api/files/download?share=${enc(share)}&path=${enc(path)}${inline ? '&inline=1' : ''}`,
    mkdir: (share, path, name) => request('POST', '/api/files/mkdir', { share, path, name }),
    rename: (share, path, name) => request('POST', '/api/files/rename', { share, path, name }),
    move: (share, paths, dest) => request('POST', '/api/files/move', { share, paths, dest }),
    delete: (share, paths) => request('POST', '/api/files/delete', { share, paths }),
  },
  admin: {
    accounts: () => request('GET', '/api/admin/accounts'),
    createAccount: (b) => request('POST', '/api/admin/accounts', b),
    updateAccount: (id, b) => request('PUT', `/api/admin/accounts/${id}`, b),
    deleteAccount: (id) => request('DELETE', `/api/admin/accounts/${id}`),
    shares: () => request('GET', '/api/admin/shares'),
    createShare: (b) => request('POST', '/api/admin/shares', b),
    updateShare: (id, b) => request('PUT', `/api/admin/shares/${id}`, b),
    deleteShare: (id) => request('DELETE', `/api/admin/shares/${id}`),
    dirs: (path) => request('GET', `/api/admin/fs/dirs${path ? '?path=' + enc(path) : ''}`),
    settings: () => request('GET', '/api/admin/settings'),
    updateSettings: (b) => request('PUT', '/api/admin/settings', b),
    restart: () => request('POST', '/api/admin/restart'),
    status: () => request('GET', '/api/admin/status'),
    audit: (q = '') => request('GET', '/api/admin/audit' + q),
    sessions: () => request('GET', '/api/admin/sessions'),
    revokeSession: (id) => request('DELETE', `/api/admin/sessions/${id}`),
    system: () => request('GET', '/api/admin/system'),
    systemAction: (action, body) => request('POST', `/api/admin/system/${action}`, body || {}),
  },
};

function enc(v) { return encodeURIComponent(v == null ? '' : String(v)); }

/** XHR 업로드 (진행률 콜백) */
export function uploadFile({ share, path, file, overwrite = false, onProgress, signal }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const url = `/api/files/upload?share=${enc(share)}&path=${enc(path)}${overwrite ? '&overwrite=1' : ''}&mtime=${file.lastModified || ''}`;
    xhr.open('PUT', url);
    xhr.setRequestHeader('X-MacServer', '1');
    if (bearer) xhr.setRequestHeader('Authorization', 'Bearer ' + bearer);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => { if (onProgress && e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      let data = {}; try { data = JSON.parse(xhr.responseText); } catch (_) {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data); else reject(new ApiError(xhr.status, data.error || '업로드 실패', data.code));
    };
    xhr.onerror = () => reject(new ApiError(0, '업로드 중 네트워크 오류'));
    xhr.onabort = () => reject(new ApiError(0, '업로드 취소됨', 'ABORT'));
    if (signal) signal.addEventListener('abort', () => xhr.abort());
    xhr.send(file);
  });
}
