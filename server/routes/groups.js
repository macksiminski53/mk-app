import { Router } from 'express';
import multer from 'multer';
import { db } from '../db.js';
import { getReactionsForMany } from '../reactions.js';
import { requireAuth } from '../auth.js';
import { emitGroupAvatarChanged } from '../events.js';

const MAX_MEMBERS = 15;
const MAX_MEMBERS_ULTRA = 30; // MK ULTRA perk: a raised cap for Mini Chats the ULTRA member created

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
    SELECT u.id, u.username, u.display_name as displayName, u.avatar_color as avatarColor, u.avatar_icon as avatarIcon, u.avatar_url as avatarUrl, u.is_plus as isPlus, u.is_premium as isPremium, u.is_ultra as isUltra, u.is_admin as isAdmin, u.name_color as nameColor
    FROM group_chat_members gm
    JOIN users u ON u.id = gm.user_id
    WHERE gm.group_chat_id = ?
    ORDER BY u.username COLLATE NOCASE ASC
  `).all(groupId);
  return rows.map((r) => ({ ...r, isPlus: !!(r.isPlus || r.isPremium || r.isUltra), isPremium: !!(r.isPremium || r.isUltra), isUltra: !!r.isUltra, isAdmin: !!r.isAdmin, nameColor: r.isUltra ? r.nameColor : null }));
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

  // MK ULTRA perk: a Mini Chat created by an ULTRA member gets a raised
  // member cap.
  const group = await db.prepare('SELECT created_by FROM group_chats WHERE id = ?').get(groupId);
  const creatorRow = group?.created_by
    ? await db.prepare('SELECT is_ultra FROM users WHERE id = ?').get(group.created_by)
    : null;
  const cap = creatorRow?.is_ultra ? MAX_MEMBERS_ULTRA : MAX_MEMBERS;

  const countRow = await db.prepare('SELECT COUNT(*) as c FROM group_chat_members WHERE group_chat_id = ?').get(groupId);
  if (Number(countRow.c) >= cap) {
    return res.status(400).json({ error: `Mini Chats are capped at ${cap} members` });
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
    SELECT msg.id, msg.content, msg.image_url as imageUrl, msg.created_at as createdAt, msg.edited_at as editedAt,
           u.id as userId, u.username, u.display_name as displayName, u.avatar_color as avatarColor, u.avatar_icon as avatarIcon, u.avatar_url as avatarUrl,
           u.is_ultra as isUltra, u.name_color as nameColor, u.custom_emoji_url as customEmojiUrl,
           (SELECT COUNT(*) FROM message_likes ml WHERE ml.message_type = 'mini' AND ml.message_id = msg.id) as likeCount,
           EXISTS(SELECT 1 FROM message_likes ml WHERE ml.message_type = 'mini' AND ml.message_id = msg.id AND ml.user_id = ?) as likedByMe,
           pm.pinned_by as pinnedBy, pu.username as pinnedByUsername
    FROM group_messages msg
    JOIN users u ON u.id = msg.user_id
    LEFT JOIN pinned_messages pm ON pm.message_type = 'mini' AND pm.message_id = msg.id
    LEFT JOIN users pu ON pu.id = pm.pinned_by
    WHERE msg.group_chat_id = ?
    ORDER BY msg.id DESC
    LIMIT ?
  `).all(req.user.id, groupId, limit);
  const ordered = rows.reverse();
  const reactionsByMsg = await getReactionsForMany('mini', ordered.map((r) => r.id));
  res.json(ordered.map((r) => ({
    ...r,
    isUltra: !!r.isUltra,
    nameColor: r.isUltra ? r.nameColor : null,
    customEmojiUrl: r.isUltra ? r.customEmojiUrl : null,
    likedByMe: !!r.likedByMe,
    pinned: !!r.pinnedBy,
    reactions: reactionsByMsg.get(r.id) || [],
  })));
}));

// Free perk: up to 10 pinned messages per Mini Chat.
router.get('/:id/pinned', asyncHandler(async (req, res) => {
  const groupId = req.params.id;
  if (!(await isMember(groupId, req.user.id))) {
    return res.status(403).json({ error: 'Not a member of this Mini Chat' });
  }
  const rows = await db.prepare(`
    SELECT msg.id, msg.content, msg.image_url as imageUrl, msg.created_at as createdAt,
           u.username, u.display_name as displayName, pm.pinned_by as pinnedBy, pu.username as pinnedByUsername, pm.created_at as pinnedAt
    FROM pinned_messages pm
    JOIN group_messages msg ON msg.id = pm.message_id
    JOIN users u ON u.id = msg.user_id
    LEFT JOIN users pu ON pu.id = pm.pinned_by
    WHERE pm.message_type = 'mini' AND msg.group_chat_id = ?
    ORDER BY pm.created_at ASC
  `).all(groupId);
  res.json(rows);
}));

export default router;
export { isMember, MAX_MEMBERS };
