import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { emitAdminMessageDeleted } from '../events.js';

const router = Router();
router.use(requireAuth, requireAdmin);

function asyncHandler(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

const TIER_COLUMNS = { plus: 'is_plus', premium: 'is_premium', ultra: 'is_ultra' };
const MESSAGE_TABLES = { dm: 'messages', mega: 'server_messages', mini: 'group_messages' };

// Every user, for the admin panel's user list. Deliberately not paginated
// -- this is an operator tool for a small app, not a consumer-facing list.
router.get('/users', asyncHandler(async (req, res) => {
  const rows = await db.prepare(`
    SELECT id, username, display_name as displayName, avatar_color as avatarColor, avatar_url as avatarUrl,
           is_plus as isPlus, is_premium as isPremium, is_ultra as isUltra, is_admin as isAdmin,
           created_at as createdAt
    FROM users
    ORDER BY id ASC
  `).all();
  res.json(rows.map((r) => ({
    ...r,
    isPlus: !!(r.isPlus || r.isPremium || r.isUltra),
    isPremium: !!(r.isPremium || r.isUltra),
    isUltra: !!r.isUltra,
    isAdmin: !!r.isAdmin,
  })));
}));

// Grant or revoke a specific tier on any account -- same underlying columns
// grant-ultra.js already manages from the command line, just reachable from
// the admin panel without needing Turso env vars in a terminal.
router.patch('/users/:id/tier', asyncHandler(async (req, res) => {
  const targetId = Number(req.params.id);
  const { tier, value } = req.body;
  const column = TIER_COLUMNS[tier];
  if (!column) return res.status(400).json({ error: 'tier must be plus, premium, or ultra' });

  const target = await db.prepare('SELECT id FROM users WHERE id = ?').get(targetId);
  if (!target) return res.status(404).json({ error: 'User not found' });

  await db.prepare(`UPDATE users SET ${column} = ? WHERE id = ?`).run(value ? 1 : 0, targetId);
  res.json({ ok: true });
}));

// Grant or revoke admin itself. Blocked against your own account so an
// admin can't accidentally lock themselves out with a stray click.
router.patch('/users/:id/admin', asyncHandler(async (req, res) => {
  const targetId = Number(req.params.id);
  const { value } = req.body;
  if (targetId === req.user.id) {
    return res.status(400).json({ error: "You can't change your own admin status" });
  }
  const target = await db.prepare('SELECT id FROM users WHERE id = ?').get(targetId);
  if (!target) return res.status(404).json({ error: 'User not found' });

  await db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(value ? 1 : 0, targetId);
  res.json({ ok: true });
}));

// Fully removes an account: their messages (DMs, Mega Chat channels, Mini
// Chats), reactions/likes/pins, read state, memberships, and friend
// requests in either direction, then the user row itself. DM threads
// involving them are deleted outright (a DM with only one real
// participant left doesn't make sense to keep). Deliberately does NOT
// reassign Mega Chat ownership or Mini Chat "created_by" -- those just
// degrade gracefully (owner-only actions become unavailable) rather than
// picking a new owner on the admin's behalf.
router.delete('/users/:id', asyncHandler(async (req, res) => {
  const targetId = Number(req.params.id);
  if (targetId === req.user.id) {
    return res.status(400).json({ error: "You can't delete your own account from here" });
  }
  const target = await db.prepare('SELECT id FROM users WHERE id = ?').get(targetId);
  if (!target) return res.status(404).json({ error: 'User not found' });

  await db.prepare('DELETE FROM message_reactions WHERE user_id = ?').run(targetId);
  await db.prepare('DELETE FROM message_likes WHERE user_id = ?').run(targetId);
  await db.prepare('DELETE FROM pinned_messages WHERE pinned_by = ?').run(targetId);
  await db.prepare('DELETE FROM dm_read_state WHERE user_id = ?').run(targetId);

  await db.prepare(
    'DELETE FROM messages WHERE thread_id IN (SELECT id FROM dm_threads WHERE user_a_id = ? OR user_b_id = ?)'
  ).run(targetId, targetId);
  await db.prepare('DELETE FROM dm_threads WHERE user_a_id = ? OR user_b_id = ?').run(targetId, targetId);

  await db.prepare('DELETE FROM server_messages WHERE user_id = ?').run(targetId);
  await db.prepare('DELETE FROM group_messages WHERE user_id = ?').run(targetId);
  await db.prepare('DELETE FROM server_members WHERE user_id = ?').run(targetId);
  await db.prepare('DELETE FROM group_chat_members WHERE user_id = ?').run(targetId);
  await db.prepare('DELETE FROM friend_requests WHERE from_id = ? OR to_id = ?').run(targetId, targetId);

  await db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
  res.json({ ok: true });
}));

// Deletes any single message (DM, Mega Chat channel, or Mini Chat) by type
// + id, plus its reactions/likes/pin so nothing orphaned lingers. roomId
// (thread/channel/group id) is passed as a query param so the deletion can
// be broadcast to whoever's currently viewing it, same room convention
// message:new/message:like-update/etc. already use.
router.delete('/messages/:type/:id', asyncHandler(async (req, res) => {
  const { type, id } = req.params;
  const table = MESSAGE_TABLES[type];
  if (!table) return res.status(400).json({ error: 'type must be dm, mega, or mini' });
  const messageId = Number(id);
  const roomId = req.query.roomId ? Number(req.query.roomId) : null;

  const row = await db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(messageId);
  if (!row) return res.status(404).json({ error: 'Message not found' });

  await db.prepare('DELETE FROM message_reactions WHERE message_type = ? AND message_id = ?').run(type, messageId);
  await db.prepare('DELETE FROM message_likes WHERE message_type = ? AND message_id = ?').run(type, messageId);
  await db.prepare('DELETE FROM pinned_messages WHERE message_type = ? AND message_id = ?').run(type, messageId);
  await db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(messageId);

  if (roomId) emitAdminMessageDeleted(type, messageId, roomId);
  res.json({ ok: true });
}));

export default router;
