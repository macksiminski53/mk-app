import { Router } from 'express';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { db } from '../db.js';
import { signToken, requireAuth } from '../auth.js';
import { emitProfileChanged } from '../events.js';

const router = Router();

const COLORS = ['#8B0000', '#B22222', '#DC143C', '#A52A2A', '#FF6347', '#CD5C5C'];
function randomColor() {
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}

// Avatars are kept in memory (not written to disk) and stored as a base64
// data URI directly in the users.avatar_url column. Render's free tier has
// no persistent disk, so anything written to server/uploads/ disappears on
// every redeploy -- storing the bytes in the database (which lives in
// Turso, not on Render's disk) is what actually survives a redeploy. The
// client already crops avatars down to a small 256x256 PNG before
// uploading, so these stay small.
const upload = multer({
  storage: multer.memoryStorage(),
  // 8MB accommodates MK ULTRA's uncropped GIF avatars; regular cropped PNG
  // avatars are ~256x256 and land nowhere near this.
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image files are allowed'));
    cb(null, true);
  },
});

// Custom ringtones -- kept small (3MB cap) since they're stored as base64
// in the database alongside avatars for the same Render-has-no-disk reason.
const uploadRingtone = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('audio/')) return cb(new Error('Only audio files are allowed'));
    cb(null, true);
  },
});

function asyncHandler(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

router.post('/register', asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password || username.length < 3 || password.length < 6) {
    return res.status(400).json({ error: 'Username min 3 chars, password min 6 chars' });
  }
  const existing = await db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return res.status(409).json({ error: 'Username taken' });

  const hash = await bcrypt.hash(password, 10);
  const color = randomColor();
  const info = await db.prepare(
    'INSERT INTO users (username, password_hash, avatar_color) VALUES (?, ?, ?)'
  ).run(username, hash, color);

  const user = { id: info.lastInsertRowid, username };
  const token = signToken(user);
  res.json({
    token,
    user: {
      id: user.id,
      username,
      avatarColor: color,
      avatarUrl: null,
      statusText: null,
      bio: null,
      ringtoneOutgoingUrl: null,
      ringtoneIncomingUrl: null,
      isUltra: false,
      ultraColor: null,
    },
  });
}));

router.post('/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  const row = await db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!row) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  const token = signToken(row);
  res.json({
    token,
    user: {
      id: row.id,
      username: row.username,
      avatarColor: row.avatar_color,
      avatarUrl: row.avatar_url,
      statusText: row.status_text,
      bio: row.bio,
      ringtoneOutgoingUrl: row.ringtone_outgoing_url,
      ringtoneIncomingUrl: row.ringtone_incoming_url,
      isUltra: !!row.is_ultra,
      ultraColor: row.ultra_color,
    },
  });
}));

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const row = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!row) return res.status(404).json({ error: 'User not found' });
  res.json({
    id: row.id,
    username: row.username,
    avatarColor: row.avatar_color,
    avatarUrl: row.avatar_url,
    statusText: row.status_text,
    bio: row.bio,
    createdAt: row.created_at,
    ringtoneOutgoingUrl: row.ringtone_outgoing_url,
    ringtoneIncomingUrl: row.ringtone_incoming_url,
    isUltra: !!row.is_ultra,
    ultraColor: row.ultra_color,
  });
}));

router.post('/avatar', requireAuth, upload.single('avatar'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const avatarUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
  await db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(avatarUrl, req.user.id);
  emitProfileChanged(req.user.id);
  res.json({ avatarUrl });
}));

router.patch('/status', requireAuth, asyncHandler(async (req, res) => {
  const { statusText } = req.body;
  const clean = typeof statusText === 'string' ? statusText.trim().slice(0, 120) : null;
  const value = clean ? clean : null;
  await db.prepare("UPDATE users SET status_text = ?, status_updated_at = datetime('now') WHERE id = ?")
    .run(value, req.user.id);
  emitProfileChanged(req.user.id);
  res.json({ statusText: value });
}));

router.patch('/bio', requireAuth, asyncHandler(async (req, res) => {
  const { bio } = req.body;
  const clean = typeof bio === 'string' ? bio.trim().slice(0, 190) : null;
  const value = clean ? clean : null;
  await db.prepare('UPDATE users SET bio = ? WHERE id = ?').run(value, req.user.id);
  emitProfileChanged(req.user.id);
  res.json({ bio: value });
}));

const RINGTONE_COLUMNS = {
  outgoing: 'ringtone_outgoing_url',
  incoming: 'ringtone_incoming_url',
};

router.post('/ringtone', requireAuth, uploadRingtone.single('ringtone'), asyncHandler(async (req, res) => {
  const { type } = req.body;
  const column = RINGTONE_COLUMNS[type];
  if (!column) return res.status(400).json({ error: "type must be 'outgoing' or 'incoming'" });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const ringtoneUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
  await db.prepare(`UPDATE users SET ${column} = ? WHERE id = ?`).run(ringtoneUrl, req.user.id);
  emitProfileChanged(req.user.id);
  res.json({ type, ringtoneUrl });
}));

router.post('/ringtone/reset', requireAuth, asyncHandler(async (req, res) => {
  const { type } = req.body;
  const column = RINGTONE_COLUMNS[type];
  if (!column) return res.status(400).json({ error: "type must be 'outgoing' or 'incoming'" });

  await db.prepare(`UPDATE users SET ${column} = NULL WHERE id = ?`).run(req.user.id);
  emitProfileChanged(req.user.id);
  res.json({ type, ringtoneUrl: null });
}));

export default router;
