import { db } from './db.js';

// Groups flat (message_id, emoji, user) rows into the shape the client
// wants: one entry per distinct emoji on a message, with a count and the
// list of who reacted (so a hover/title can say who).
function groupReactions(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.emoji)) map.set(r.emoji, []);
    map.get(r.emoji).push({ userId: r.userId, username: r.username, displayName: r.displayName });
  }
  return Array.from(map.entries()).map(([emoji, users]) => ({ emoji, count: users.length, users }));
}

export async function getReactionsFor(messageType, messageId) {
  const rows = await db.prepare(`
    SELECT mr.emoji, mr.user_id as userId, u.username, u.display_name as displayName
    FROM message_reactions mr
    JOIN users u ON u.id = mr.user_id
    WHERE mr.message_type = ? AND mr.message_id = ?
    ORDER BY mr.created_at ASC
  `).all(messageType, messageId);
  return groupReactions(rows);
}

// Batch version for a list of messages (e.g. loading a channel's history) --
// one query instead of one-per-message. Returns a Map keyed by message id.
export async function getReactionsForMany(messageType, messageIds) {
  const ids = (messageIds || []).map(Number).filter((n) => Number.isFinite(n));
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const rows = await db.prepare(`
    SELECT mr.message_id as messageId, mr.emoji, mr.user_id as userId, u.username, u.display_name as displayName
    FROM message_reactions mr
    JOIN users u ON u.id = mr.user_id
    WHERE mr.message_type = ? AND mr.message_id IN (${placeholders})
    ORDER BY mr.created_at ASC
  `).all(messageType, ...ids);

  const byMessage = new Map();
  for (const r of rows) {
    if (!byMessage.has(r.messageId)) byMessage.set(r.messageId, []);
    byMessage.get(r.messageId).push(r);
  }
  const result = new Map();
  for (const [id, rs] of byMessage) result.set(id, groupReactions(rs));
  return result;
}
