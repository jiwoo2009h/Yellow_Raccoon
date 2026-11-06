// 서버(Flask) API 호출

async function request(method, url, body, { form = false } = {}) {
  // X-Requested-With: 서버가 '이 앱에서 보낸 요청'인지 확인하는 표시 (CSRF 방지)
  const opts = { method, headers: { 'X-Requested-With': 'jaram' } };
  if (body !== undefined) {
    if (form) opts.body = body;
    else {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
  }
  let res;
  try {
    res = await fetch(url, opts);
  } catch (e) {
    throw new Error('서버에 연결할 수 없어요. 인터넷 연결이나 서버가 켜져 있는지 확인해 주세요.');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.auth_required) {
    // 로그인이 풀렸으면 로그인 화면으로
    window.dispatchEvent(new CustomEvent('jaram:login-required'));
  }
  if (!res.ok) {
    const err = new Error(data.error || `요청에 실패했어요 (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  auth: () => request('GET', '/api/auth'),
  login: (password) => request('POST', '/api/login', { password }),
  logout: () => request('POST', '/api/logout'),
  plants: () => request('GET', '/api/plants'),
  plant: (id) => request('GET', `/api/plants/${id}`),
  createPlant: (body) => request('POST', '/api/plants', body),
  updatePlant: (id, body) => request('PATCH', `/api/plants/${id}`, body),
  deletePlant: (id) => request('DELETE', `/api/plants/${id}`),
  upload: (id, blob, takenAt) => {
    const fd = new FormData();
    fd.append('photo', blob, 'photo.jpg');
    if (takenAt) fd.append('taken_at', takenAt);
    return request('POST', `/api/plants/${id}/measurements`, fd, { form: true });
  },
  measurement: (id) => request('GET', `/api/measurements/${id}`),
  updateMeasurement: (id, body) => request('PATCH', `/api/measurements/${id}`, body),
  deleteMeasurement: (id) => request('DELETE', `/api/measurements/${id}`),
  addCare: (id, body) => request('POST', `/api/plants/${id}/care`, body),
  deleteCare: (id) => request('DELETE', `/api/care/${id}`),
  addEnv: (id, body) => request('POST', `/api/plants/${id}/env`, body),
  deleteEnv: (id) => request('DELETE', `/api/env/${id}`),
  reanalyze: (id) => request('POST', id ? `/api/plants/${id}/reanalyze` : '/api/reanalyze'),
  settings: () => request('GET', '/api/settings'),
  saveSettings: (thresholds) => request('PUT', '/api/settings', { thresholds }),
  resetSettings: () => request('POST', '/api/settings/reset'),
  report: () => request('GET', '/api/report'),
  // 3D 측정
  createScan: (plantId, body = {}) => request('POST', `/api/plants/${plantId}/scans`, body),
  scan: (id) => request('GET', `/api/scans/${id}`),
  uploadScanView: (id, blob, kind, angle) => {
    const fd = new FormData();
    fd.append('photo', blob, 'view.jpg');
    fd.append('kind', kind);
    if (angle !== null && angle !== undefined) fd.append('angle', String(angle));
    return request('POST', `/api/scans/${id}/views`, fd, { form: true });
  },
  updateScanView: (id, viewId, body) => request('PATCH', `/api/scans/${id}/views/${viewId}`, body),
  deleteScanView: (id, viewId) => request('DELETE', `/api/scans/${id}/views/${viewId}`),
  computeScan: (id) => request('POST', `/api/scans/${id}/compute`),
  deleteScan: (id) => request('DELETE', `/api/scans/${id}`),
  backupUrl: '/api/backup.zip',
};
