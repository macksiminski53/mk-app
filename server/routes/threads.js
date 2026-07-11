import { Router } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
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

// Any file type is allowed -- the client picks a renderer (image, audio,
// video, or a generic download link) based on the file extension in the
// stored URL. Same upload endpoint and same `image_url` DB column for all
// attachment types regardless of kind.
function isAllowedAttachment(_file) {
  return true;
}

// Large attachments (>50MB) are allowed but get auto-deleted after an hour
// (see scheduleAutoDelete below); cap hard at 200MB so uploads can't grow
// unbounded.
const LARGE_FILE_THRESHOLD = 50 * 1024 * 1024;
const AUTO_DELETE_MS = 60 * 60 * 1000;

function scheduleAutoDelete(filePath) {
  setTimeout(() => {
    fs.unlink(filePath, (err) => {
      if (err && err.code !== 'ENOENT') {
        console.error('Failed to auto-delete expired attachment:', filePath, err);
      }
    });
  }, AUTO_DELETE_MS);
}

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!isAllowedAttachment(file)) return cb(new Error('File type not allowed'));
    cb(null, true);
  },
});

// Current mutual-delete-vote state for this thread, from the caller's
// perspective (so the client doesn't need to know internal user_a/user_b
// ordering).
router.get('/:threadId/delete-votes', asyncHandler(async (req, res) => {
  const { threadId } = req.params;
  const thread = await userInThread(req.user.id, threadId);
  if (!thread) return res.status(403).json({ error: 'No access to this conversation' });
  const isA = thread.user_a_id === req.user.id;
  res.json({
    myVote: !!(isA ? thread.delete_vote_a : thread.delete_vote_b),
    otherVote: !!(isA ? thread.delete_vote_b : thread.delete_vote_a),
    autoReset: !!thread.auto_reset_24h,
  });
}));

// Toggle "auto-delete every 24h" for this thread. Either participant can
// flip it; enabling it resets the 24h clock starting now.
router.patch('/:threadId/auto-reset', asyncHandler(async (req, res) => {
  const { threadId } = req.params;
  const { enabled } = req.body;
  const thread = await userInThread(req.user.id, threadId);
  if (!thread) return res.status(403).json({ error: 'No access to this conversation' });

  if (enabled) {
    await db.prepare(
      "UPDATE dm_threads SET auto_reset_24h = 1, last_reset_at = datetime('now') WHERE id = ?"
    ).run(threadId);
  } else {
    await db.prepare('UPDATE dm_threads SET auto_reset_24h = 0 WHERE id = ?').run(threadId);
  }
  res.json({ autoReset: !!enabled });
}));

router.get('/:threadId/messages', asyncHandler(async (req, res) => {
  const { threadId } = req.params;
  if (!(await userInThread(req.user.id, threadId))) {
    return res.status(403).json({ error: 'No access to this conversation' });
  }
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const rows = await db.prepare(`
    SELECT msg.id, msg.content, msg.image_url as imageUrl, msg.created_at as createdAt,
           u.id as userId, u.username, u.avatar_color as avatarColor, u.avatar_url as avatarUrl,
           u.is_ultra as isUltra, u.name_color as nameColor,
           msg.reply_to_id as replyToId,
           ru.username as replyToUsername, rm.content as replyToContent,
           (SELECT COUNT(*) FROM message_likes ml WHERE ml.message_type = 'dm' AND ml.message_id = msg.id) as likeCount,
           EXISTS(SELECT 1 FROM message_likes ml WHERE ml.message_type = 'dm' AND ml.message_id = msg.id AND ml.user_id = ?) as likedByMe
    FROM messages msg
    JOIN users u ON u.id = msg.user_id
    LEFT JOIN messages rm ON rm.id = msg.reply_to_id
    LEFT JOIN users ru ON ru.id = rm.user_id
    WHERE msg.thread_id = ?
    ORDER BY msg.id DESC
    LIMIT ?
  `).all(req.user.id, threadId, limit);
  res.json(rows.reverse().map((r) => ({ ...r, isUltra: !!r.isUltra, nameColor: r.isUltra ? r.nameColor : null, likedByMe: !!r.likedByMe })));
}));

// upload an image or mp3 to attach to a message you're about to send
router.post('/:threadId/attachments', upload.single('image'), asyncHandler(async (req, res) => {
  const { threadId } = req.params;
  if (!(await userInThread(req.user.id, threadId))) {
    return res.status(403).json({ error: 'No access to this conversation' });
  }
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  if (req.file.size > LARGE_FILE_THRESHOLD) {
    scheduleAutoDelete(req.file.path);
  }
  res.json({ imageUrl: `/uploads/${req.file.filename}`, expiresInMs: req.file.size > LARGE_FILE_THRESHOLD ? AUTO_DELETE_MS : null });
}));

export default router;
