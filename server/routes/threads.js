import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';

const router = Router();
router.use(requireAuth);

function userInThread(userId, threadId) {
  return db.prepare(
    'SELECT * FROM dm_threads WHERE id = ? AND (user_a_id = ? OR user_b_id = ?)'
  ).get(threadId, userId, userId);
}

router.get('/:threadId/messages', (req, res) => {
  const { threadId } = req.params;
  if (!userInThread(req.user.id, threadId)) {
    return res.status(403).json({ error: 'No access to this conversation' });
  }
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const rows = db.prepare(`
    SELECT msg.id, msg.content, msg.created_at as createdAt,
           u.id as userId, u.username, u.avatar_color as avatarColor, u.avatar_url as avatarUrl
    FROM messages msg
    JOIN users u ON u.id = msg.user_id
    WHERE msg.thread_id = ?
    ORDER BY msg.id DESC
    LIMIT ?
  `).all(threadId, limit);
  res.json(rows.reverse());
});

export default router;
