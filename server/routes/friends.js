import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { isOnline } from '../presence.js';

const router = Router();
router.use(requireAuth);

function asyncHandler(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

function orderPair(a, b) {
  return a < b ? [a, b] : [b, a];
}

async function getOrCreateThread(userA, userB) {
  const [a, b] = orderPair(userA, userB);
  let thread = await db.prepare('SELECT * FROM dm_threads WHERE user_a_id = ? AND user_b_id = ?').get(a, b);
  if (!thread) {
    const info = await db.prepare('INSERT INTO dm_threads (user_a_id, user_b_id) VALUES (?, ?)').run(a, b);
    thread = { id: info.lastInsertRowid, user_a_id: a, user_b_id: b };
  }
  return thread;
}

async function friendshipStatus(meId, otherId) {
  return db.prepare(`
    SELECT * FROM friend_requests
    WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)
  `).get(meId, otherId, otherId, meId);
}

router.get('/', asyncHandler(async (req, res) => {
  const meId = req.user.id;
  const rows = await db.prepare(`
    SELECT fr.*, u1.username as fromUsername, u1.display_name as fromDisplayName, u1.avatar_color as fromColor, u1.avatar_icon as fromIcon, u1.avatar_url as fromUrl, u1.status_text as fromStatus, u1.status_source as fromStatusSource, u1.bio as fromBio, u1.created_at as fromCreatedAt, u1.is_plus as fromPlus, u1.is_premium as fromPremium, u1.is_ultra as fromUltra, u1.is_admin as fromAdmin, u1.name_color as fromNameColor, u1.banner_url as fromBannerUrl,
           u2.username as toUsername, u2.display_name as toDisplayName, u2.avatar_color as toColor, u2.avatar_icon as toIcon, u2.avatar_url as toUrl, u2.status_text as toStatus, u2.status_source as toStatusSource, u2.bio as toBio, u2.created_at as toCreatedAt, u2.is_plus as toPlus, u2.is_premium as toPremium, u2.is_ultra as toUltra, u2.is_admin as toAdmin, u2.name_color as toNameColor, u2.banner_url as toBannerUrl
    FROM friend_requests fr
    JOIN users u1 ON u1.id = fr.from_id
    JOIN users u2 ON u2.id = fr.to_id
    WHERE fr.status = 'accepted' AND (fr.from_id = ? OR fr.to_id = ?)
  `).all(meId, meId);

  const friends = [];
  const threadIds = [];
  for (const r of rows) {
    const otherId = r.from_id === meId ? r.to_id : r.from_id;
    const otherUsername = r.from_id === meId ? r.toUsername : r.fromUsername;
    const otherDisplayName = r.from_id === meId ? r.toDisplayName : r.fromDisplayName;
    const otherColor = r.from_id === meId ? r.toColor : r.fromColor;
    const otherIcon = r.from_id === meId ? r.toIcon : r.fromIcon;
    const otherUrl = r.from_id === meId ? r.toUrl : r.fromUrl;
    const otherStatus = r.from_id === meId ? r.toStatus : r.fromStatus;
    const otherStatusSource = r.from_id === meId ? r.toStatusSource : r.fromStatusSource;
    const otherBio = r.from_id === meId ? r.toBio : r.fromBio;
    const otherCreatedAt = r.from_id === meId ? r.toCreatedAt : r.fromCreatedAt;
    const otherUltra = r.from_id === meId ? r.toUltra : r.fromUltra;
    const otherPremium = r.from_id === meId ? r.toPremium : r.fromPremium;
    const otherPlus = r.from_id === meId ? r.toPlus : r.fromPlus;
    const otherAdmin = r.from_id === meId ? r.toAdmin : r.fromAdmin;
    const otherNameColor = r.from_id === meId ? r.toNameColor : r.fromNameColor;
    const otherBannerUrl = r.from_id === meId ? r.toBannerUrl : r.fromBannerUrl;
    const thread = await getOrCreateThread(meId, otherId);
    threadIds.push(thread.id);
    friends.push({
      id: otherId,
      username: otherUsername,
      displayName: otherDisplayName,
      avatarColor: otherColor,
      avatarIcon: otherIcon,
      avatarUrl: otherUrl,
      statusText: otherStatus,
      statusSource: otherStatusSource,
      bio: otherBio,
      createdAt: otherCreatedAt,
      isPlus: !!(otherPlus || otherPremium || otherUltra),
      isPremium: !!(otherPremium || otherUltra),
      isUltra: !!otherUltra,
      isAdmin: !!otherAdmin,
      nameColor: otherUltra ? otherNameColor : null,
      bannerUrl: otherUltra ? otherBannerUrl : null,
      online: isOnline(otherId),
      threadId: thread.id,
      unreadCount: 0,
    });
  }

  // Unread counts: for each thread, count messages from the other person
  // with id greater than this user's last_read_message_id (0 if they've
  // never read it at all). One query total via a correlated subquery,
  // rather than N+1 lookups per friend.
  if (threadIds.length > 0) {
    const placeholders = threadIds.map(() => '?').join(',');
    const unreadRows = await db.prepare(`
      SELECT thread_id as threadId, COUNT(*) as unread
      FROM messages
      WHERE thread_id IN (${placeholders}) AND user_id != ?
        AND id > COALESCE((SELECT last_read_message_id FROM dm_read_state WHERE dm_read_state.thread_id = messages.thread_id AND dm_read_state.user_id = ?), 0)
      GROUP BY thread_id
    `).all(...threadIds, meId, meId);
    const unreadByThread = new Map(unreadRows.map((r) => [r.threadId, r.unread]));
    for (const f of friends) {
      f.unreadCount = unreadByThread.get(f.threadId) || 0;
    }
  }

  res.json(friends);
}));

router.get('/requests', asyncHandler(async (req, res) => {
  const rows = await db.prepare(`
    SELECT fr.id, fr.created_at as createdAt, u.id as fromId, u.username as fromUsername, u.display_name as fromDisplayName
    FROM friend_requests fr
    JOIN users u ON u.id = fr.from_id
    WHERE fr.to_id = ? AND fr.status = 'pending'
    ORDER BY fr.id DESC
  `).all(req.user.id);
  res.json(rows);
}));

router.post('/request', asyncHandler(async (req, res) => {
  const { username } = req.body;
  if (!username || !username.trim()) return res.status(400).json({ error: 'Username required' });

  const target = await db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim());
  if (!target) return res.status(404).json({ error: 'No user with that username' });
  if (target.id === req.user.id) return res.status(400).json({ error: "You can't friend yourself" });

  const existing = await friendshipStatus(req.user.id, target.id);
  if (existing) {
    if (existing.status === 'accepted') return res.status(409).json({ error: 'Already friends' });
    if (existing.status === 'pending' && existing.from_id === req.user.id) {
      return res.status(409).json({ error: 'Request already sent' });
    }
    if (existing.status === 'pending' && existing.to_id === req.user.id) {
      await db.prepare("UPDATE friend_requests SET status = 'accepted' WHERE id = ?").run(existing.id);
      return res.json({ ok: true, autoAccepted: true, targetId: target.id });
    }
    await db.prepare("UPDATE friend_requests SET status = 'pending', from_id = ?, to_id = ? WHERE id = ?")
      .run(req.user.id, target.id, existing.id);
    return res.json({ ok: true, targetId: target.id });
  }

  await db.prepare('INSERT INTO friend_requests (from_id, to_id) VALUES (?, ?)').run(req.user.id, target.id);
  res.json({ ok: true, targetId: target.id });
}));

router.post('/respond', asyncHandler(async (req, res) => {
  const { requestId, accept } = req.body;
  const request = await db.prepare('SELECT * FROM friend_requests WHERE id = ?').get(requestId);
  if (!request || request.to_id !== req.user.id) return res.status(404).json({ error: 'Request not found' });

  await db.prepare('UPDATE friend_requests SET status = ? WHERE id = ?').run(accept ? 'accepted' : 'declined', requestId);
  if (accept) await getOrCreateThread(request.from_id, request.to_id);
  res.json({ ok: true, fromId: request.from_id });
}));

router.post('/remove', asyncHandler(async (req, res) => {
  const { friendId } = req.body;
  await db.prepare(`
    DELETE FROM friend_requests
    WHERE status = 'accepted' AND ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))
  `).run(req.user.id, friendId, friendId, req.user.id);
  res.json({ ok: true });
}));

export default router;
export { getOrCreateThread };
