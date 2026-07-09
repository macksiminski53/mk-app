import { Router } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '..', 'uploads');

const router = Router();
router.use(requireAuth);

function asyncHandler(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

async function userInThread(userId, threadId) {
  return db.prepare(
    'SELECT * FROM dm_threads WHERE id = ? AND (user_a_id = ? OR user_b_id = ?)'
  ).get(threadId, userId, userId);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    cb(null, `attachment-${req.user.id}-${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image files are allowed'));
    cb(null, true);
  },
});

router.get('/:threadId/messages', asyncHandler(async (req, res) => {
  const { threadId } = req.params;
  if (!(await userInThread(req.user.id, threadId))) {
    return res.status(403).json({ error: 'No access to this conversation' });
  }
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const rows = await db.prepare(`
    SELECT msg.id, msg.content, msg.image_url as imageUrl, msg.created_at as createdAt,
           u.id as userId, u.username, u.avatar_color as avatarColor, u.avatar_url as avatarUrl,
           msg.reply_to_id as replyToId,
           ru.username as replyToUsername, rm.content as replyToContent
    FROM messages msg
    JOIN users u ON u.id = msg.user_id
    LEFT JOIN messages rm ON rm.id = msg.reply_to_id
    LEFT JOIN users ru ON ru.id = rm.user_id
    WHERE msg.thread_id = ?
    ORDER BY msg.id DESC
    LIMIT ?
  `).all(threadId, limit);
  res.json(rows.reverse());
}));

// upload an image to attach to a message you're about to send
router.post('/:threadId/attachments', upload.single('image'), asyncHandler(async (req, res) => {
  const { threadId } = req.params;
  if (!(await userInThread(req.user.id, threadId))) {
    return res.status(403).json({ error: 'No access to this conversation' });
  }
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ imageUrl: `/uploads/${req.file.filename}` });
}));

export default router;
