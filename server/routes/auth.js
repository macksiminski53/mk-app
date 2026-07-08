import { Router } from 'express';
import bcrypt from 'bcryptjs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { db } from '../db.js';
import { signToken, requireAuth } from '../auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '..', 'uploads');

const router = Router();

const COLORS = ['#8B0000', '#B22222', '#DC143C', '#A52A2A', '#FF6347', '#CD5C5C'];
function randomColor() {
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    cb(null, `avatar-${req.user.id}-${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image files are allowed'));
    cb(null, true);
  },
});

router.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password || username.length < 3 || password.length < 6) {
    return res.status(400).json({ error: 'Username min 3 chars, password min 6 chars' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return res.status(409).json({ error: 'Username taken' });

  const hash = await bcrypt.hash(password, 10);
  const color = randomColor();
  const info = db.prepare(
    'INSERT INTO users (username, password_hash, avatar_color) VALUES (?, ?, ?)'
  ).run(username, hash, color);

  const user = { id: info.lastInsertRowid, username };
  const token = signToken(user);
  res.json({ token, user: { id: user.id, username, avatarColor: color, avatarUrl: null, statusText: null } });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
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
    },
  });
});

router.post('/avatar', requireAuth, upload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const avatarUrl = `/uploads/${req.file.filename}`;
  db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(avatarUrl, req.user.id);
  res.json({ avatarUrl });
});

router.patch('/status', requireAuth, (req, res) => {
  const { statusText } = req.body;
  const clean = typeof statusText === 'string' ? statusText.trim().slice(0, 120) : null;
  const value = clean ? clean : null;
  db.prepare("UPDATE users SET status_text = ?, status_updated_at = datetime('now') WHERE id = ?")
    .run(value, req.user.id);
  res.json({ statusText: value });
});

export default router;
