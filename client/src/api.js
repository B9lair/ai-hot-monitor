const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  if (res.status === 401) {
    const body = await res.json().catch(() => ({}));
    if (body.needGate) {
      window.dispatchEvent(new Event('ahm:need-gate'));
      throw new Error(body.error || '需要访问口令');
    }
    window.dispatchEvent(new Event('ahm:unauthorized'));
    throw new Error(body.error || '未登录');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

export const api = {
  // 访问口令门禁
  gateStatus: () => request('/gate/status'),
  gateVerify: (password) => request('/gate/verify', { method: 'POST', body: JSON.stringify({ password }) }),

  // 登录与偏好
  login: (email) => request('/auth/login', { method: 'POST', body: JSON.stringify({ email }) }),
  me: () => request('/auth/me'),
  logout: () => request('/auth/logout', { method: 'POST' }),
  updatePrefs: (data) => request('/auth/prefs', { method: 'PATCH', body: JSON.stringify(data) }),

  // 状态
  getStatus: () => request('/status'),

  // 数据源开关（运行时动态切换）
  getSources: () => request('/sources'),
  updateSource: (key, enabled) =>
    request(`/sources/${key}`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),

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

  // favorites
  getFavorites: () => request('/favorites'),
  addFavorite: (name) => request('/favorites', { method: 'POST', body: JSON.stringify({ name }) }),
  renameFavorite: (id, name) => request(`/favorites/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteFavorite: (id) => request(`/favorites/${id}`, { method: 'DELETE' }),
  favoriteAlert: (id, favoriteId) =>
    request(`/alerts/${id}/favorite`, { method: 'POST', body: JSON.stringify({ favoriteId }) }),
  unfavoriteAlert: (id) => request(`/alerts/${id}/favorite`, { method: 'DELETE' }),
};
