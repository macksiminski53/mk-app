import { Router } from 'express';
import multer from 'multer';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { emitGroupAvatarChanged } from '../events.js';

const MAX_MEMBERS = 15;

// Same in-memory + base64-in-DB pattern as user avatars in auth.js -- Render
// has no persistent disk, so this is what survives a redeploy.
const uploadAvatar = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image files are allowed'));
    cb(null, true);
  },
});

const router = Router();
router.use(requireAuth);

function asyncHandler(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

async function isMember(groupId, userId) {
  return db.prepare('SELECT 1 FROM group_chat_members WHERE group_chat_id = ? AND user_id = ?').get(groupId, userId);
}

async function loadMembers(groupId) {
  const rows = await db.prepare(`
    SELECT u.id, u.username, u.avatar_color as avatarColor, u.avatar_url as avatarUrl, u.is_plus as isPlus, u.is_ultra as isUltra
    FROM group_chat_members gm
    JOIN users u ON u.id = gm.user_id
    WHERE gm.group_chat_id = ?
    ORDER BY u.username COLLATE NOCASE ASC
  `).all(groupId);
  return rows.map((r) => ({ ...r, isPlus: !!(r.isPlus || r.isUltra), isUltra: !!r.isUltra }));
}

// Every Mini Chat the current user is in, each with its full member list so
// the client can build a display name (no dedicated "name" is required).
router.get('/', asyncHandler(async (req, res) => {
  const rows = await db.prepare(`
    SELECT g.id, g.name, g.created_at as createdAt, g.created_by as createdBy, g.avatar_url as avatarUrl
    FROM group_chats g
    JOIN group_chat_members gm ON gm.group_chat_id = g.id
    WHERE gm.user_id = ?
    ORDER BY g.id DESC
  `).all(req.user.id);

  const groups = [];
  for (const row of rows) {
    groups.push({ ...row, members: await loadMembers(row.id) });
  }
  res.json(groups);
}));

// Create a Mini Chat -- free, no checkout. Creator is the first (and for
// now only) member; others get added via POST /:id/members afterwards.
router.post('/', asyncHandler(async (req, res) => {
  const { name } = req.body;
  const clean = typeof name === 'string' ? name.trim().slice(0, 60) : '';

  const info = await db.prepare('INSERT INTO group_chats (name, created_by) VALUES (?, ?)').run(clean || null, req.user.id);
  const groupId = info.lastInsertRowid;
  await db.prepare('INSERT INTO group_chat_members (group_chat_id, user_id) VALUES (?, ?)').run(groupId, req.user.id);

  res.json({
    id: Number(groupId),
    name: clean || null,
    createdAt: new Date().toISOString(),
    createdBy: req.user.id,
    avatarUrl: null,
    members: await loadMembers(groupId),
  });
}));

// Add a member by username -- any current member can do this (no owner/role
// concept here), capped at MAX_MEMBERS total.
router.post('/:id/members', asyncHandler(async (req, res) => {
  const groupId = req.params.id;
  if (!(await isMember(groupId, req.user.id))) {
    return res.status(403).json({ error: 'Not a member of this Mini Chat' });
  }

  const { username } = req.body;
  const clean = typeof username === 'string' ? username.trim() : '';
  if (!clean) return res.status(400).json({ error: 'Username is required' });

  const countRow = await db.prepare('SELECT COUNT(*) as c FROM group_chat_members WHERE group_chat_id = ?').get(groupId);
  if (Number(countRow.c) >= MAX_MEMBERS) {
    return res.status(400).json({ error: `Mini Chats are capped at ${MAX_MEMBERS} members` });
  }

  const target = await db.prepare('SELECT id, username FROM users WHERE username = ?').get(clean);
  if (!target) return res.status(404).json({ error: `No user named "${clean}" found` });
  if (await isMember(groupId, target.id)) {
    return res.status(400).json({ error: `${target.username} is already in this Mini Chat` });
  }

  await db.prepare('INSERT INTO group_chat_members (group_chat_id, user_id) VALUES (?, ?)').run(groupId, target.id);
  res.json({ members: await loadMembers(groupId) });
}));

// Only the creator can set a group picture -- Mini Chats otherwise have no
// roles, but this one action needs *someone* to own it, and "whoever made
// it" is the least surprising choice.
router.post('/:id/avatar', uploadAvatar.single('avatar'), asyncHandler(async (req, res) => {
  const groupId = req.params.id;
  const group = await db.prepare('SELECT created_by FROM group_chats WHERE id = ?').get(groupId);
  if (!group) return res.status(404).json({ error: 'Mini Chat not found' });
  if (group.created_by !== req.user.id) return res.status(403).json({ error: 'Only the creator can change the group picture' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const avatarUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
  await db.prepare('UPDATE group_chats SET avatar_url = ? WHERE id = ?').run(avatarUrl, groupId);

  const memberIds = (await db.prepare('SELECT user_id FROM group_chat_members WHERE group_chat_id = ?').all(groupId)).map((r) => r.user_id);
  emitGroupAvatarChanged(memberIds, Number(groupId), avatarUrl);

  res.json({ avatarUrl });
}));

// Leave a Mini Chat. No roles/owner here, so this is self-only -- there's no
// "kick" action. If the last member leaves, the whole chat (and its
// messages) is deleted via the foreign key cascade.
router.delete('/:id/members/:userId', asyncHandler(async (req, res) => {
  const groupId = req.params.id;
  const targetId = Number(req.params.userId);
  if (targetId !== req.user.id) {
    return res.status(403).json({ error: 'You can only remove yourself from a Mini Chat' });
  }
  if (!(await isMember(groupId, req.user.id))) {
    return res.status(403).json({ error: 'Not a member of this Mini Chat' });
  }

  await db.prepare('DELETE FROM group_chat_members WHERE group_chat_id = ? AND user_id = ?').run(groupId, targetId);

  const remaining = await db.prepare('SELECT COUNT(*) as c FROM group_chat_members WHERE group_chat_id = ?').get(groupId);
  if (Number(remaining.c) === 0) {
    await db.prepare('DELETE FROM group_chats WHERE id = ?').run(groupId);
  }

  res.json({ ok: true });
}));

router.get('/:id/messages', asyncHandler(async (req, res) => {
  const groupId = req.params.id;
  if (!(await isMember(groupId, req.user.id))) {
    return res.status(403).json({ error: 'Not a member of this Mini Chat' });
  }
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const rows = await db.prepare(`
    SELECT msg.id, msg.content, msg.image_url as imageUrl, msg.created_at as createdAt,
           u.id as userId, u.username, u.avatar_color as avatarColor, u.avatar_url as avatarUrl,
           (SELECT COUNT(*) FROM message_likes ml WHERE ml.message_type = 'mini' AND ml.message_id = msg.id) as likeCount,
           EXISTS(SELECT 1 FROM message_likes ml WHERE ml.message_type = 'mini' AND ml.message_id = msg.id AND ml.user_id = ?) as likedByMe
    FROM group_messages msg
    JOIN users u ON u.id = msg.user_id
    WHERE msg.group_chat_id = ?
    ORDER BY msg.id DESC
    LIMIT ?
  `).all(req.user.id, groupId, limit);
  res.json(rows.reverse().map((r) => ({ ...r, likedByMe: !!r.likedByMe })));
}));

export default router;
export { isMember, MAX_MEMBERS };
