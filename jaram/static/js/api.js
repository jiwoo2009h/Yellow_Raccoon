// 서버(Flask) API 호출

const TIMEOUT = 20000;      // 일반 요청
const LONG_TIMEOUT = 180000; // 사진 업로드·분석·다시 분석

/** 사용자에게 그대로 보여 줘도 되는 오류 (서버가 보낸 안내 문구, 연결 오류 등) */
function apiError(message, status) {
  const err = new Error(message);
  err.userFacing = true;
  if (status) err.status = status;
  return err;
}

async function request(method, url, body, { form = false, timeout = TIMEOUT } = {}) {
  // X-Requested-With: 서버가 '이 앱에서 보낸 요청'인지 확인하는 표시 (CSRF 방지)
  const opts = { method, headers: { 'X-Requested-With': 'jaram' } };
  if (body !== undefined) {
    if (form) opts.body = body;
    else {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
  }
  // 응답이 오지 않으면 '분석 중' 화면에서 영원히 못 나가지 않도록 시간 제한
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout) : null;
  if (ctrl) opts.signal = ctrl.signal;
  let res;
  try {
    res = await fetch(url, opts);
  } catch (e) {
    if (e && e.name === 'AbortError') {
      throw apiError('응답이 너무 오래 걸려요. 인터넷 연결을 확인하고 다시 시도해 주세요.');
    }
    throw apiError(navigator.onLine === false
      ? '인터넷에 연결되어 있지 않아요. 연결을 확인해 주세요.'
      : '서버에 연결할 수 없어요. 인터넷 연결이나 서버가 켜져 있는지 확인해 주세요.');
  } finally {
    if (timer) clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.auth_required) {
    // 로그인이 풀렸으면 로그인 화면으로
    window.dispatchEvent(new CustomEvent('jaram:login-required'));
  }
  if (!res.ok) {
    const fallback = res.status === 413 ? '사진 파일이 너무 커요. 20MB보다 작은 사진을 골라 주세요.'
      : res.status >= 500 ? '서버에서 문제가 생겼어요. 잠시 후 다시 시도해 주세요.'
        : `요청에 실패했어요 (${res.status})`;
    const err = apiError(data.error || fallback, res.status);
    err.data = data; // 예: 규칙 저장 실패 때 줄 번호별 문제 목록 (data.errors)
    throw err;
  }
  return data;
}

export const api = {
  auth: () => request('GET', '/api/auth'),
  login: (username, password) => request('POST', '/api/login', { username, password }),
  signup: (body) => request('POST', '/api/signup', body),
  logout: () => request('POST', '/api/logout'),
  changePassword: (current, next) => request('POST', '/api/account/password', { current, new: next }),
  users: () => request('GET', '/api/users'),
  resetUser: (id) => request('POST', `/api/users/${id}/reset`),
  plants: () => request('GET', '/api/plants'),
  rules: () => request('GET', '/api/rules'),
  checkRules: (text) => request('POST', '/api/rules/check', { text }),
  saveRules: (text) => request('PUT', '/api/rules', { text }),
  resetRules: () => request('POST', '/api/rules/reset'),
  previewRules: (text, plantId) => request('POST', '/api/rules/preview', { text, plant_id: plantId }, { timeout: LONG_TIMEOUT }),
  plant: (id) => request('GET', `/api/plants/${id}`),
  createPlant: (body) => request('POST', '/api/plants', body),
  updatePlant: (id, body) => request('PATCH', `/api/plants/${id}`, body, { timeout: LONG_TIMEOUT }),
  deletePlant: (id) => request('DELETE', `/api/plants/${id}`),
  upload: (id, blob, takenAt) => {
    const fd = new FormData();
    fd.append('photo', blob, 'photo.jpg');
    if (takenAt) fd.append('taken_at', takenAt);
    return request('POST', `/api/plants/${id}/measurements`, fd, { form: true, timeout: LONG_TIMEOUT });
  },
  measurement: (id) => request('GET', `/api/measurements/${id}`),
  updateMeasurement: (id, body) => request('PATCH', `/api/measurements/${id}`, body),
  deleteMeasurement: (id) => request('DELETE', `/api/measurements/${id}`),
  addCare: (id, body) => request('POST', `/api/plants/${id}/care`, body),
  deleteCare: (id) => request('DELETE', `/api/care/${id}`),
  addEnv: (id, body) => request('POST', `/api/plants/${id}/env`, body),
  deleteEnv: (id) => request('DELETE', `/api/env/${id}`),
  addObservation: (id, body) => request('POST', `/api/plants/${id}/observations`, body),
  deleteObservation: (id) => request('DELETE', `/api/observations/${id}`),
  reanalyze: (id) => request('POST', id ? `/api/plants/${id}/reanalyze` : '/api/reanalyze', undefined, { timeout: LONG_TIMEOUT * 3 }),
  settings: () => request('GET', '/api/settings'),
  saveSettings: (thresholds) => request('PUT', '/api/settings', { thresholds }),
  resetSettings: () => request('POST', '/api/settings/reset'),
  suggest: (species, from, to) => {
    const q = new URLSearchParams({ species });
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    return request('GET', `/api/settings/suggest?${q}`, undefined, { timeout: LONG_TIMEOUT });
  },
  report: () => request('GET', '/api/report', undefined, { timeout: LONG_TIMEOUT }),
  validation: () => request('GET', '/api/validation', undefined, { timeout: LONG_TIMEOUT }),
  // 3D 측정
  createScan: (plantId, body = {}) => request('POST', `/api/plants/${plantId}/scans`, body),
  scan: (id) => request('GET', `/api/scans/${id}`),
  uploadScanView: (id, blob, kind, angle) => {
    const fd = new FormData();
    fd.append('photo', blob, 'view.jpg');
    fd.append('kind', kind);
    if (angle !== null && angle !== undefined) fd.append('angle', String(angle));
    return request('POST', `/api/scans/${id}/views`, fd, { form: true, timeout: LONG_TIMEOUT });
  },
  updateScanView: (id, viewId, body) => request('PATCH', `/api/scans/${id}/views/${viewId}`, body, { timeout: LONG_TIMEOUT }),
  deleteScanView: (id, viewId) => request('DELETE', `/api/scans/${id}/views/${viewId}`),
  computeScan: (id) => request('POST', `/api/scans/${id}/compute`, undefined, { timeout: LONG_TIMEOUT }),
  deleteScan: (id) => request('DELETE', `/api/scans/${id}`),
  backupUrl: '/api/backup.zip',
};
