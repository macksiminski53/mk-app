const onlineUsers = new Map();

export function markOnline(userId) {
  onlineUsers.set(userId, (onlineUsers.get(userId) || 0) + 1);
}

export function markOffline(userId) {
  const count = (onlineUsers.get(userId) || 0) - 1;
  if (count <= 0) onlineUsers.delete(userId);
  else onlineUsers.set(userId, count);
}

export function isOnline(userId) {
  return onlineUsers.has(userId);
}
