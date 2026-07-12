import { Router } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import multer from 'multer';
import { db } from '../db.js';
import { getReactionsForMany } from '../reactions.js';
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
    SELECT msg.id, msg.content, msg.image_url as imageUrl, msg.created_at as createdAt, msg.edited_at as editedAt,
           u.id as userId, u.username, u.display_name as displayName, u.avatar_color as avatarColor, u.avatar_url as avatarUrl,
           u.is_ultra as isUltra, u.name_color as nameColor, u.custom_emoji_url as customEmojiUrl,
           msg.reply_to_id as replyToId,
           ru.username as replyToUsername, rm.content as replyToContent,
           (SELECT COUNT(*) FROM message_likes ml WHERE ml.message_type = 'dm' AND ml.message_id = msg.id) as likeCount,
           EXISTS(SELECT 1 FROM message_likes ml WHERE ml.message_type = 'dm' AND ml.message_id = msg.id AND ml.user_id = ?) as likedByMe,
           pm.pinned_by as pinnedBy, pu.username as pinnedByUsername
    FROM messages msg
    JOIN users u ON u.id = msg.user_id
    LEFT JOIN messages rm ON rm.id = msg.reply_to_id
    LEFT JOIN users ru ON ru.id = rm.user_id
    LEFT JOIN pinned_messages pm ON pm.message_type = 'dm' AND pm.message_id = msg.id
    LEFT JOIN users pu ON pu.id = pm.pinned_by
    WHERE msg.thread_id = ?
    ORDER BY msg.id DESC
    LIMIT ?
  `).all(req.user.id, threadId, limit);
  const ordered = rows.reverse();
  const reactionsByMsg = await getReactionsForMany('dm', ordered.map((r) => r.id));
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

// Free perk: up to 10 pinned messages per DM thread, listed separately so
// the client can show a "Pinned" panel without re-fetching the whole
// message history.
router.get('/:threadId/pinned', asyncHandler(async (req, res) => {
  const { threadId } = req.params;
  if (!(await userInThread(req.user.id, threadId))) {
    return res.status(403).json({ error: 'No access to this conversation' });
  }
  const rows = await db.prepare(`
    SELECT msg.id, msg.content, msg.image_url as imageUrl, msg.created_at as createdAt,
           u.username, u.display_name as displayName, pm.pinned_by as pinnedBy, pu.username as pinnedByUsername, pm.created_at as pinnedAt
    FROM pinned_messages pm
    JOIN messages msg ON msg.id = pm.message_id
    JOIN users u ON u.id = msg.user_id
    LEFT JOIN users pu ON pu.id = pm.pinned_by
    WHERE pm.message_type = 'dm' AND msg.thread_id = ?
    ORDER BY pm.created_at ASC
  `).all(threadId);
  res.json(rows);
}));

// MK ULTRA perk: read receipts. Returns the *other* participant's read
// progress in this thread so the client can show a "Seen" indicator under
// the current user's last message. Always returns a value (even if neither
// side has ULTRA) -- the client itself decides whether to display it.
router.get('/:threadId/read-state', asyncHandler(async (req, res) => {
  const { threadId } = req.params;
  const thread = await userInThread(req.user.id, threadId);
  if (!thread) return res.status(403).json({ error: 'No access to this conversation' });
  const otherId = thread.user_a_id === req.user.id ? thread.user_b_id : thread.user_a_id;
  const row = await db.prepare(
    'SELECT last_read_message_id as lastReadMessageId FROM dm_read_state WHERE thread_id = ? AND user_id = ?'
  ).get(threadId, otherId);
  res.json({ theirLastRead: row?.lastReadMessageId || 0 });
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
