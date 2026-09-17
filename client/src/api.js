const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

export const api = {
  getStatus: () => request('/status'),
  // keywords
  getKeywords: () => request('/keywords'),
  addKeyword: (text, intervalMin) =>
    request('/keywords', { method: 'POST', body: JSON.stringify({ text, intervalMin }) }),
  updateKeyword: (id, data) =>
    request(`/keywords/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteKeyword: (id) => request(`/keywords/${id}`, { method: 'DELETE' }),
  runKeyword: (id) => request(`/keywords/${id}/run`, { method: 'POST' }),
  // data
  getAlerts: (params = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') qs.append(k, v);
    }
    const s = qs.toString();
    return request(`/alerts${s ? `?${s}` : ''}`);
  },
  getNotifications: () => request('/notifications'),
  getStats: () => request('/stats'),
};
