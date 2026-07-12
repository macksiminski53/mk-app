import { Router } from 'express';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { customAlphabet } from 'nanoid';
import { db } from '../db.js';
import { signToken, requireAuth, rateLimit } from '../auth.js';

// Auth endpoints are the classic brute-force target -- 8 attempts/minute per
// IP+route is generous for a real user (a typo or two) but useless to a
// credential-stuffing script.
const authRateLimit = rateLimit({ windowMs: 60_000, max: 8 });
import { emitProfileChanged } from '../events.js';

const router = Router();

// Account tokens: used to log in on a second device (phone <-> PC) without
// typing username/password again. Mixed-case letters + digits, 22 chars from
// a 62-char alphabet -- nowhere near guessable, unlike a short numeric PIN.
const TOKEN_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const generateAccountToken = customAlphabet(TOKEN_ALPHABET, 22);

// Generates a token and retries on the astronomically unlikely chance of a
// collision with the unique index in db.js.
async function createUniqueAccountToken() {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateAccountToken();
    const clash = await db.prepare('SELECT id FROM users WHERE account_token = ?').get(candidate);
    if (!clash) return candidate;
  }
  throw new Error('Could not generate a unique account token');
}

// Older accounts (registered before this feature existed) won't have a
// token yet -- generate and persist one lazily the first time it's needed,
// instead of requiring a one-off migration script.
async function ensureAccountToken(userId, existingToken) {
  if (existingToken) return existingToken;
  const token = await createUniqueAccountToken();
  await db.prepare('UPDATE users SET account_token = ? WHERE id = ?').run(token, userId);
  return token;
}

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

router.post('/register', authRateLimit, asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password || username.length < 3 || password.length < 6) {
    return res.status(400).json({ error: 'Username min 3 chars, password min 6 chars' });
  }
  const existing = await db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return res.status(409).json({ error: 'Username taken' });

  const hash = await bcrypt.hash(password, 10);
  const color = randomColor();
  const accountToken = await createUniqueAccountToken();
  const info = await db.prepare(
    'INSERT INTO users (username, password_hash, avatar_color, account_token) VALUES (?, ?, ?, ?)'
  ).run(username, hash, color, accountToken);

  const user = { id: info.lastInsertRowid, username };
  const token = signToken(user);
  res.json({
    token,
    user: {
      id: user.id,
      username,
      displayName: null,
      avatarColor: color,
      avatarUrl: null,
      statusText: null,
      statusSource: null,
      bio: null,
      ringtoneOutgoingUrl: null,
      ringtoneIncomingUrl: null,
      isPlus: false,
      isPremium: false,
      isUltra: false,
      isAdmin: false,
      ultraColor: null,
      nameColor: null,
      bannerUrl: null,
      customEmojiUrl: null,
    },
  });
}));

router.post('/login', authRateLimit, asyncHandler(async (req, res) => {
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
      displayName: row.display_name,
      avatarColor: row.avatar_color,
      avatarUrl: row.avatar_url,
      statusText: row.status_text,
      statusSource: row.status_source,
      bio: row.bio,
      ringtoneOutgoingUrl: row.ringtone_outgoing_url,
      ringtoneIncomingUrl: row.ringtone_incoming_url,
      isPlus: !!(row.is_plus || row.is_premium || row.is_ultra),
      isPremium: !!(row.is_premium || row.is_ultra),
      isUltra: !!row.is_ultra,
      isAdmin: !!row.is_admin,
      ultraColor: row.ultra_color,
      nameColor: row.name_color,
      bannerUrl: row.banner_url,
      customEmojiUrl: row.custom_emoji_url,
    },
  });
}));

// Log in on a new device using the account token from Settings > Account
// instead of username/password -- same response shape as /login so the
// client can reuse the exact same onAuthed(token, user) handling.
router.post('/login-token', authRateLimit, asyncHandler(async (req, res) => {
  const { accountToken } = req.body;
  if (!accountToken || typeof accountToken !== 'string') {
    return res.status(400).json({ error: 'Account token is required' });
  }
  const row = await db.prepare('SELECT * FROM users WHERE account_token = ?').get(accountToken.trim());
  if (!row) return res.status(401).json({ error: 'Invalid account token' });
  const token = signToken(row);
  res.json({
    token,
    user: {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      avatarColor: row.avatar_color,
      avatarUrl: row.avatar_url,
      statusText: row.status_text,
      statusSource: row.status_source,
      bio: row.bio,
      ringtoneOutgoingUrl: row.ringtone_outgoing_url,
      ringtoneIncomingUrl: row.ringtone_incoming_url,
      isPlus: !!(row.is_plus || row.is_premium || row.is_ultra),
      isPremium: !!(row.is_premium || row.is_ultra),
      isUltra: !!row.is_ultra,
      isAdmin: !!row.is_admin,
      ultraColor: row.ultra_color,
      nameColor: row.name_color,
      bannerUrl: row.banner_url,
      customEmojiUrl: row.custom_emoji_url,
    },
  });
}));

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const row = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!row) return res.status(404).json({ error: 'User not found' });
  res.json({
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarColor: row.avatar_color,
    avatarUrl: row.avatar_url,
    statusText: row.status_text,
    statusSource: row.status_source,
    bio: row.bio,
    createdAt: row.created_at,
    ringtoneOutgoingUrl: row.ringtone_outgoing_url,
    ringtoneIncomingUrl: row.ringtone_incoming_url,
    isPlus: !!(row.is_plus || row.is_premium || row.is_ultra),
    isPremium: !!(row.is_premium || row.is_ultra),
    isUltra: !!row.is_ultra,
    isAdmin: !!row.is_admin,
    ultraColor: row.ultra_color,
    nameColor: row.name_color,
    bannerUrl: row.banner_url,
    customEmojiUrl: row.custom_emoji_url,
  });
}));

// The account token itself is never included in /register, /login, or /me
// responses -- it stays hidden until the user confirms their password in
// Settings > Account, matching "hidden until you type/confirm" from spec.
router.post('/reveal-token', requireAuth, asyncHandler(async (req, res) => {
  const { password } = req.body;
  const row = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!row) return res.status(404).json({ error: 'User not found' });
  const ok = await bcrypt.compare(password || '', row.password_hash);
  if (!ok) return res.status(401).json({ error: 'Incorrect password' });
  const accountToken = await ensureAccountToken(row.id, row.account_token);
  res.json({ accountToken });
}));

// Regenerating invalidates the old token (any other device using it to log
// in stops working) -- requiring the password again here is deliberate,
// since a leaked/expired session token alone shouldn't be enough to do this.
router.post('/token/regenerate', requireAuth, asyncHandler(async (req, res) => {
  const { password } = req.body;
  const row = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!row) return res.status(404).json({ error: 'User not found' });
  const ok = await bcrypt.compare(password || '', row.password_hash);
  if (!ok) return res.status(401).json({ error: 'Incorrect password' });
  const accountToken = await createUniqueAccountToken();
  await db.prepare('UPDATE users SET account_token = ? WHERE id = ?').run(accountToken, row.id);
  res.json({ accountToken });
}));

router.post('/avatar', requireAuth, upload.single('avatar'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const avatarUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
  await db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(avatarUrl, req.user.id);
  emitProfileChanged(req.user.id);
  res.json({ avatarUrl });
}));

// MK ULTRA perk: a profile banner image, shown across the top of the
// profile card above the avatar. Same base64-in-DB storage as avatars.
router.post('/banner', requireAuth, upload.single('banner'), asyncHandler(async (req, res) => {
  const row = await db.prepare('SELECT is_ultra FROM users WHERE id = ?').get(req.user.id);
  if (!row?.is_ultra) return res.status(403).json({ error: 'MK ULTRA required' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const bannerUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
  await db.prepare('UPDATE users SET banner_url = ? WHERE id = ?').run(bannerUrl, req.user.id);
  emitProfileChanged(req.user.id);
  res.json({ bannerUrl });
}));

router.delete('/banner', requireAuth, asyncHandler(async (req, res) => {
  await db.prepare('UPDATE users SET banner_url = NULL WHERE id = ?').run(req.user.id);
  emitProfileChanged(req.user.id);
  res.json({ ok: true });
}));

// MK ULTRA perk: a personal custom emoji, insertable from the emoji picker
// and shown inline in any message that uses it (see EmojiPicker.jsx's
// renderWithCustomEmoji). Same base64-in-DB storage as avatars/banners --
// deliberately small file size cap since it's rendered at emoji scale.
router.post('/custom-emoji', requireAuth, upload.single('emoji'), asyncHandler(async (req, res) => {
  const row = await db.prepare('SELECT is_ultra FROM users WHERE id = ?').get(req.user.id);
  if (!row?.is_ultra) return res.status(403).json({ error: 'MK ULTRA required' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const customEmojiUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
  await db.prepare('UPDATE users SET custom_emoji_url = ? WHERE id = ?').run(customEmojiUrl, req.user.id);
  emitProfileChanged(req.user.id);
  res.json({ customEmojiUrl });
}));

router.delete('/custom-emoji', requireAuth, asyncHandler(async (req, res) => {
  await db.prepare('UPDATE users SET custom_emoji_url = NULL WHERE id = ?').run(req.user.id);
  emitProfileChanged(req.user.id);
  res.json({ ok: true });
}));

// A free, optional display name shown throughout the UI in place of the
// username. Sending an empty string clears it (falls back to showing the
// username again) -- the client also does this via a "Reset" button rather
// than requiring the user to select-all-delete the input.
router.patch('/display-name', requireAuth, asyncHandler(async (req, res) => {
  const { displayName } = req.body;
  const trimmed = typeof displayName === 'string' ? displayName.trim().slice(0, 32) : '';
  const clean = trimmed ? trimmed : null;
  await db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(clean, req.user.id);
  emitProfileChanged(req.user.id);
  res.json({ displayName: clean });
}));

router.patch('/status', requireAuth, asyncHandler(async (req, res) => {
  const { statusText, source } = req.body;
  const clean = typeof statusText === 'string' ? statusText.trim().slice(0, 120) : null;
  const value = clean ? clean : null;
  // Only the MusicToDiscord reporter script sends source: 'music'. Anything
  // else (or no source at all) is tagged 'manual' so the client's "Playing"
  // card only ever renders for a real detected song, never a typed status.
  const statusSource = value ? (source === 'music' ? 'music' : 'manual') : null;
  await db.prepare("UPDATE users SET status_text = ?, status_source = ?, status_updated_at = datetime('now') WHERE id = ?")
    .run(value, statusSource, req.user.id);
  emitProfileChanged(req.user.id);
  res.json({ statusText: value, statusSource });
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

// A small "fun stats" panel in the client's Extra menu -- friend/Mega
// Chat/Mini Chat counts and total messages sent, aggregated across DMs,
// Mega Chat channels, and Mini Chats.
router.get('/stats', requireAuth, asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const [user, friendRow, megaRow, miniRow, dmMsgRow, serverMsgRow, groupMsgRow] = await Promise.all([
    db.prepare('SELECT created_at FROM users WHERE id = ?').get(userId),
    db.prepare(`
      SELECT COUNT(*) as c FROM friend_requests
      WHERE status = 'accepted' AND (from_id = ? OR to_id = ?)
    `).get(userId, userId),
    db.prepare('SELECT COUNT(*) as c FROM server_members WHERE user_id = ?').get(userId),
    db.prepare('SELECT COUNT(*) as c FROM group_chat_members WHERE user_id = ?').get(userId),
    db.prepare('SELECT COUNT(*) as c FROM messages WHERE user_id = ?').get(userId),
    db.prepare('SELECT COUNT(*) as c FROM server_messages WHERE user_id = ?').get(userId),
    db.prepare('SELECT COUNT(*) as c FROM group_messages WHERE user_id = ?').get(userId),
  ]);

  res.json({
    createdAt: user?.created_at || null,
    friendCount: Number(friendRow.c) || 0,
    megaChatCount: Number(megaRow.c) || 0,
    miniChatCount: Number(miniRow.c) || 0,
    messagesSent: (Number(dmMsgRow.c) || 0) + (Number(serverMsgRow.c) || 0) + (Number(groupMsgRow.c) || 0),
  });
}));

export default router;
