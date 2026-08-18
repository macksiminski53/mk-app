import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { emitProfileChanged } from '../events.js';

// Everything that used to be a paid tier (MK PLUS/PREMIUM/ULTRA) is free
// for every account now -- see the migration in db.js that sets
// is_plus/is_premium/is_ultra to 1 for all users. This file keeps only the
// routes that still do something useful: reporting tier status (so the UI
// can show perk badges/unlock cosmetic controls), the two color-customization
// endpoints, and Mega Chat creation (now always free, so it creates the
// server immediately with no checkout step).

const SERVER_COLORS = ['#8B0000', '#B22222', '#DC143C', '#A52A2A', '#FF6347', '#CD5C5C'];
function randomServerColor() {
  return SERVER_COLORS[Math.floor(Math.random() * SERVER_COLORS.length)];
}

function asyncHandler(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

const router = Router();

// Mega Chat creation -- always free now, so this just creates the server
// immediately instead of kicking off a checkout flow.
router.post('/mega-chat-checkout', requireAuth, asyncHandler(async (req, res) => {
  const { name } = req.body;
  const clean = typeof name === 'string' ? name.trim().slice(0, 60) : '';
  if (!clean) return res.status(400).json({ error: 'Server name is required' });

  const serverInfo = await db.prepare(
    'INSERT INTO servers (name, owner_id, icon_color) VALUES (?, ?, ?)'
  ).run(clean, req.user.id, randomServerColor());
  const serverId = serverInfo.lastInsertRowid;

  await db.prepare(
    'INSERT INTO server_members (server_id, user_id) VALUES (?, ?)'
  ).run(serverId, req.user.id);

  const channelInfo = await db.prepare(
    'INSERT INTO server_channels (server_id, name, position) VALUES (?, ?, ?)'
  ).run(serverId, 'general', 0);

  const server = {
    id: Number(serverId),
    name: clean,
    ownerId: req.user.id,
    iconColor: (await db.prepare('SELECT icon_color FROM servers WHERE id = ?').get(serverId)).icon_color,
    channels: [{ id: Number(channelInfo.lastInsertRowid), name: 'general', position: 0 }],
  };
  res.json({ free: true, server });
}));

router.get('/status', requireAuth, asyncHandler(async (req, res) => {
  const row = await db.prepare('SELECT is_plus, is_premium, is_ultra, ultra_color FROM users WHERE id = ?').get(req.user.id);
  res.json({
    isPlus: !!(row?.is_plus || row?.is_premium || row?.is_ultra),
    isPremium: !!(row?.is_premium || row?.is_ultra),
    isUltra: !!row?.is_ultra,
    ultraColor: row?.ultra_color || null,
    configured: false,
  });
}));

router.patch('/ultra-color', requireAuth, asyncHandler(async (req, res) => {
  const { color } = req.body;
  const clean = typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color) ? color : null;
  await db.prepare('UPDATE users SET ultra_color = ? WHERE id = ?').run(clean, req.user.id);
  emitProfileChanged(req.user.id);
  res.json({ ultraColor: clean });
}));

// Custom name color shown next to the username in chat (distinct from the
// shared accent-color perk above).
router.patch('/name-color', requireAuth, asyncHandler(async (req, res) => {
  const { color } = req.body;
  const clean = typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color) ? color : null;
  await db.prepare('UPDATE users SET name_color = ? WHERE id = ?').run(clean, req.user.id);
  emitProfileChanged(req.user.id);
  res.json({ nameColor: clean });
}));

export default router;
