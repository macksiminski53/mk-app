import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';

const router = Router();
router.use(requireAuth);

function asyncHandler(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

async function getServer(serverId) {
  return db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
}

async function isMember(serverId, userId) {
  return db.prepare('SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?').get(serverId, userId);
}

async function loadChannels(serverId) {
  const rows = await db.prepare(
    'SELECT id, name, position FROM server_channels WHERE server_id = ? ORDER BY position ASC, id ASC'
  ).all(serverId);
  return rows.map((r) => ({ id: r.id, name: r.name, position: r.position }));
}

// Every Mega Chat the current user belongs to (owned or joined), each with
// its full channel list -- the client keeps this in memory as the "server
// rail" + channel sidebar, same shape as the friends list.
router.get('/', asyncHandler(async (req, res) => {
  const rows = await db.prepare(`
    SELECT s.id, s.name, s.owner_id as ownerId, s.icon_color as iconColor
    FROM servers s
    JOIN server_members sm ON sm.server_id = s.id
    WHERE sm.user_id = ?
    ORDER BY s.id ASC
  `).all(req.user.id);

  const servers = [];
  for (const row of rows) {
    servers.push({ ...row, channels: await loadChannels(row.id) });
  }
  res.json(servers);
}));

// Full detail for one Mega Chat: channels + member list (for the members
// panel and to know who's allowed to be kicked/etc.).
router.get('/:id', asyncHandler(async (req, res) => {
  const server = await getServer(req.params.id);
  if (!server || !(await isMember(server.id, req.user.id))) {
    return res.status(403).json({ error: 'Not a member of this Mega Chat' });
  }
  const members = await db.prepare(`
    SELECT u.id, u.username, u.avatar_color as avatarColor, u.avatar_url as avatarUrl, u.is_plus as isPlus, u.is_premium as isPremium, u.is_ultra as isUltra, u.name_color as nameColor
    FROM server_members sm
    JOIN users u ON u.id = sm.user_id
    WHERE sm.server_id = ?
    ORDER BY u.username COLLATE NOCASE ASC
  `).all(server.id);

  res.json({
    id: server.id,
    name: server.name,
    ownerId: server.owner_id,
    iconColor: server.icon_color,
    channels: await loadChannels(server.id),
    members: members.map((m) => ({ ...m, isPlus: !!(m.isPlus || m.isPremium || m.isUltra), isPremium: !!(m.isPremium || m.isUltra), isUltra: !!m.isUltra, nameColor: m.isUltra ? m.nameColor : null })),
  });
}));

// Owner-only: create a new text channel.
router.post('/:id/channels', asyncHandler(async (req, res) => {
  const server = await getServer(req.params.id);
  if (!server) return res.status(404).json({ error: 'Mega Chat not found' });
  if (server.owner_id !== req.user.id) return res.status(403).json({ error: 'Only the owner can create channels' });

  const { name } = req.body;
  const clean = typeof name === 'string' ? name.trim().slice(0, 40) : '';
  if (!clean) return res.status(400).json({ error: 'Channel name is required' });

  const countRow = await db.prepare('SELECT COUNT(*) as c FROM server_channels WHERE server_id = ?').get(server.id);
  const info = await db.prepare(
    'INSERT INTO server_channels (server_id, name, position) VALUES (?, ?, ?)'
  ).run(server.id, clean, Number(countRow.c) || 0);

  res.json({ id: Number(info.lastInsertRowid), name: clean, position: Number(countRow.c) || 0 });
}));

// Owner-only: delete a channel (refuses to delete the last one -- a Mega
// Chat always needs at least one place to talk).
router.delete('/:id/channels/:channelId', asyncHandler(async (req, res) => {
  const server = await getServer(req.params.id);
  if (!server) return res.status(404).json({ error: 'Mega Chat not found' });
  if (server.owner_id !== req.user.id) return res.status(403).json({ error: 'Only the owner can delete channels' });

  const countRow = await db.prepare('SELECT COUNT(*) as c FROM server_channels WHERE server_id = ?').get(server.id);
  if (Number(countRow.c) <= 1) return res.status(400).json({ error: 'A Mega Chat needs at least one channel' });

  await db.prepare('DELETE FROM server_channels WHERE id = ? AND server_id = ?').run(req.params.channelId, server.id);
  res.json({ ok: true });
}));

// Add a member by username -- any current member can do this (matches
// Discord-ish "anyone can invite" norms); the owner is the only one who can
// remove someone else, though.
router.post('/:id/members', asyncHandler(async (req, res) => {
  const server = await getServer(req.params.id);
  if (!server || !(await isMember(server.id, req.user.id))) {
    return res.status(403).json({ error: 'Not a member of this Mega Chat' });
  }

  const { username } = req.body;
  const clean = typeof username === 'string' ? username.trim() : '';
  if (!clean) return res.status(400).json({ error: 'Username is required' });

  const target = await db.prepare('SELECT id, username, avatar_color as avatarColor, avatar_url as avatarUrl, is_plus as isPlus, is_premium as isPremium, is_ultra as isUltra, name_color as nameColor FROM users WHERE username = ?').get(clean);
  if (!target) return res.status(404).json({ error: `No user named "${clean}" found` });

  if (await isMember(server.id, target.id)) {
    return res.status(400).json({ error: `${target.username} is already in this Mega Chat` });
  }

  await db.prepare('INSERT INTO server_members (server_id, user_id) VALUES (?, ?)').run(server.id, target.id);
  res.json({ id: target.id, username: target.username, avatarColor: target.avatarColor, avatarUrl: target.avatarUrl, isPlus: !!(target.isPlus || target.isPremium || target.isUltra), isPremium: !!(target.isPremium || target.isUltra), isUltra: !!target.isUltra, nameColor: target.isUltra ? target.nameColor : null });
}));

// Remove a member. The owner can remove anyone; anyone can remove themself
// (i.e. leave). The owner can't leave/be removed this way -- they have to
// delete the whole Mega Chat instead.
router.delete('/:id/members/:userId', asyncHandler(async (req, res) => {
  const server = await getServer(req.params.id);
  if (!server) return res.status(404).json({ error: 'Mega Chat not found' });

  const targetId = Number(req.params.userId);
  if (targetId === server.owner_id) {
    return res.status(400).json({ error: 'The owner can\'t be removed -- delete the Mega Chat instead' });
  }
  const isSelf = targetId === req.user.id;
  if (!isSelf && server.owner_id !== req.user.id) {
    return res.status(403).json({ error: 'Only the owner can remove other members' });
  }

  await db.prepare('DELETE FROM server_members WHERE server_id = ? AND user_id = ?').run(server.id, targetId);
  res.json({ ok: true });
}));

// Owner-only: delete the entire Mega Chat (cascades to channels, members,
// and messages via foreign keys).
router.delete('/:id', asyncHandler(async (req, res) => {
  const server = await getServer(req.params.id);
  if (!server) return res.status(404).json({ error: 'Mega Chat not found' });
  if (server.owner_id !== req.user.id) return res.status(403).json({ error: 'Only the owner can delete this Mega Chat' });

  await db.prepare('DELETE FROM servers WHERE id = ?').run(server.id);
  res.json({ ok: true });
}));

router.get('/:id/channels/:channelId/messages', asyncHandler(async (req, res) => {
  const server = await getServer(req.params.id);
  if (!server || !(await isMember(server.id, req.user.id))) {
    return res.status(403).json({ error: 'Not a member of this Mega Chat' });
  }
  const channel = await db.prepare('SELECT id FROM server_channels WHERE id = ? AND server_id = ?').get(req.params.channelId, server.id);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });

  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const rows = await db.prepare(`
    SELECT msg.id, msg.content, msg.image_url as imageUrl, msg.created_at as createdAt,
           u.id as userId, u.username, u.avatar_color as avatarColor, u.avatar_url as avatarUrl,
           u.is_ultra as isUltra, u.name_color as nameColor,
           (SELECT COUNT(*) FROM message_likes ml WHERE ml.message_type = 'mega' AND ml.message_id = msg.id) as likeCount,
           EXISTS(SELECT 1 FROM message_likes ml WHERE ml.message_type = 'mega' AND ml.message_id = msg.id AND ml.user_id = ?) as likedByMe,
           pm.pinned_by as pinnedBy, pu.username as pinnedByUsername
    FROM server_messages msg
    JOIN users u ON u.id = msg.user_id
    LEFT JOIN pinned_messages pm ON pm.message_type = 'mega' AND pm.message_id = msg.id
    LEFT JOIN users pu ON pu.id = pm.pinned_by
    WHERE msg.channel_id = ?
    ORDER BY msg.id DESC
    LIMIT ?
  `).all(req.user.id, channel.id, limit);
  res.json(rows.reverse().map((r) => ({ ...r, isUltra: !!r.isUltra, nameColor: r.isUltra ? r.nameColor : null, likedByMe: !!r.likedByMe, pinned: !!r.pinnedBy })));
}));

// Free perk: up to 10 pinned messages per Mega Chat channel.
router.get('/:id/channels/:channelId/pinned', asyncHandler(async (req, res) => {
  const server = await getServer(req.params.id);
  if (!server || !(await isMember(server.id, req.user.id))) {
    return res.status(403).json({ error: 'Not a member of this Mega Chat' });
  }
  const channel = await db.prepare('SELECT id FROM server_channels WHERE id = ? AND server_id = ?').get(req.params.channelId, server.id);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });

  const rows = await db.prepare(`
    SELECT msg.id, msg.content, msg.image_url as imageUrl, msg.created_at as createdAt,
           u.username, pm.pinned_by as pinnedBy, pu.username as pinnedByUsername, pm.created_at as pinnedAt
    FROM pinned_messages pm
    JOIN server_messages msg ON msg.id = pm.message_id
    JOIN users u ON u.id = msg.user_id
    LEFT JOIN users pu ON pu.id = pm.pinned_by
    WHERE pm.message_type = 'mega' AND msg.channel_id = ?
    ORDER BY pm.created_at ASC
  `).all(channel.id);
  res.json(rows);
}));

export default router;
export { isMember };
