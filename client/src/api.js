const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

async function request(path, { method = 'GET', body, token, isForm } = {}) {
  const res = await fetch(`${API_BASE}/api${path}`, {
    method,
    headers: {
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export const api = {
  register: (username, password) => request('/auth/register', { method: 'POST', body: { username, password } }),
  login: (username, password) => request('/auth/login', { method: 'POST', body: { username, password } }),
  uploadAvatar: (token, file) => {
    const form = new FormData();
    form.append('avatar', file);
    return request('/auth/avatar', { method: 'POST', body: form, token, isForm: true });
  },

  listFriends: (token) => request('/friends', { token }),
  listRequests: (token) => request('/friends/requests', { token }),
  sendFriendRequest: (token, username) => request('/friends/request', { method: 'POST', body: { username }, token }),
  respondToRequest: (token, requestId, accept) => request('/friends/respond', { method: 'POST', body: { requestId, accept }, token }),
  removeFriend: (token, friendId) => request('/friends/remove', { method: 'POST', body: { friendId }, token }),

  listMessages: (token, threadId) => request(`/threads/${threadId}/messages`, { token }),
};

export function resolveAvatarUrl(url) {
  if (!url) return null;
  return url.startsWith('http') ? url : `${API_BASE}${url}`;
}

export const API_BASE_URL = API_BASE;
