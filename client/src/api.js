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
  loginWithToken: (accountToken) => request('/auth/login-token', { method: 'POST', body: { accountToken } }),
  getMe: (token) => request('/auth/me', { token }),
  revealAccountToken: (token, password) => request('/auth/reveal-token', { method: 'POST', body: { password }, token }),
  regenerateAccountToken: (token, password) => request('/auth/token/regenerate', { method: 'POST', body: { password }, token }),
  uploadAvatar: (token, file) => {
    const form = new FormData();
    form.append('avatar', file);
    return request('/auth/avatar', { method: 'POST', body: form, token, isForm: true });
  },
  setStatus: (token, statusText) => request('/auth/status', { method: 'PATCH', body: { statusText }, token }),
  setBio: (token, bio) => request('/auth/bio', { method: 'PATCH', body: { bio }, token }),
  uploadRingtone: (token, type, file) => {
    const form = new FormData();
    form.append('type', type);
    form.append('ringtone', file);
    return request('/auth/ringtone', { method: 'POST', body: form, token, isForm: true });
  },
  resetRingtone: (token, type) => request('/auth/ringtone/reset', { method: 'POST', body: { type }, token }),

  getBillingStatus: (token) => request('/billing/status', { token }),
  createUltraCheckout: (token) => request('/billing/checkout', { method: 'POST', token }),
  setUltraColor: (token, color) => request('/billing/ultra-color', { method: 'PATCH', body: { color }, token }),

  listFriends: (token) => request('/friends', { token }),
  listRequests: (token) => request('/friends/requests', { token }),
  sendFriendRequest: (token, username) => request('/friends/request', { method: 'POST', body: { username }, token }),
  respondToRequest: (token, requestId, accept) => request('/friends/respond', { method: 'POST', body: { requestId, accept }, token }),
  removeFriend: (token, friendId) => request('/friends/remove', { method: 'POST', body: { friendId }, token }),

  listMessages: (token, threadId) => request(`/threads/${threadId}/messages`, { token }),
  getDeleteVotes: (token, threadId) => request(`/threads/${threadId}/delete-votes`, { token }),
  setAutoReset: (token, threadId, enabled) => request(`/threads/${threadId}/auto-reset`, { method: 'PATCH', body: { enabled }, token }),
  uploadAttachment: (token, threadId, file) => {
    const form = new FormData();
    form.append('image', file);
    return request(`/threads/${threadId}/attachments`, { method: 'POST', body: form, token, isForm: true });
  },

  // ---- Mega Chats ----
  createMegaChatCheckout: (token, name) => request('/billing/mega-chat-checkout', { method: 'POST', body: { name }, token }),
  listServers: (token) => request('/servers', { token }),
  getServer: (token, serverId) => request(`/servers/${serverId}`, { token }),
  createChannel: (token, serverId, name) => request(`/servers/${serverId}/channels`, { method: 'POST', body: { name }, token }),
  deleteChannel: (token, serverId, channelId) => request(`/servers/${serverId}/channels/${channelId}`, { method: 'DELETE', token }),
  addServerMember: (token, serverId, username) => request(`/servers/${serverId}/members`, { method: 'POST', body: { username }, token }),
  removeServerMember: (token, serverId, userId) => request(`/servers/${serverId}/members/${userId}`, { method: 'DELETE', token }),
  deleteServer: (token, serverId) => request(`/servers/${serverId}`, { method: 'DELETE', token }),
  listChannelMessages: (token, serverId, channelId) => request(`/servers/${serverId}/channels/${channelId}/messages`, { token }),

  // ---- Mini Chats ----
  listGroups: (token) => request('/groups', { token }),
  createGroup: (token, name) => request('/groups', { method: 'POST', body: { name }, token }),
  addGroupMember: (token, groupId, username) => request(`/groups/${groupId}/members`, { method: 'POST', body: { username }, token }),
  leaveGroup: (token, groupId, userId) => request(`/groups/${groupId}/members/${userId}`, { method: 'DELETE', token }),
  listGroupMessages: (token, groupId) => request(`/groups/${groupId}/messages`, { token }),
};

export function resolveAvatarUrl(url) {
  if (!url) return null;
  // Avatars are stored as base64 data URIs (so they survive redeploys on
  // hosts with no persistent disk); message/attachment images still come
  // back as relative /uploads/... paths served by the API.
  if (url.startsWith('http') || url.startsWith('data:')) return url;
  return `${API_BASE}${url}`;
}

export const API_BASE_URL = API_BASE;
