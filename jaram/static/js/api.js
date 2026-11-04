// 서버(Flask) API 호출

async function request(method, url, body, { form = false } = {}) {
  const opts = { method, headers: {} };
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
    throw new Error('서버에 연결할 수 없어요. 컴퓨터에서 서버가 켜져 있는지 확인해 주세요.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `요청에 실패했어요 (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
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
};
