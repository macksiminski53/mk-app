import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import {
  emitPodcastStarted,
  emitPodcastEnded,
  emitPodcastJoinRequest,
  emitPodcastRequestResolved,
  emitPodcastSpeakerJoined,
  emitPodcastSpeakerLeft,
} from '../events.js';

const router = Router();
router.use(requireAuth);

function asyncHandler(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

async function getSpeakers() {
  return db.prepare(`
    SELECT u.id, u.username, u.display_name as displayName, u.avatar_color as avatarColor,
           u.avatar_icon as avatarIcon, u.avatar_url as avatarUrl
    FROM podcast_speakers ps
    JOIN users u ON u.id = ps.user_id
    ORDER BY ps.joined_at ASC
  `).all();
}

async function getSession() {
  const session = await db.prepare(`
    SELECT ps.is_live as isLive, ps.host_id as hostId, ps.title, ps.started_at as startedAt,
           u.username as hostUsername, u.display_name as hostDisplayName
    FROM podcast_session ps
    LEFT JOIN users u ON u.id = ps.host_id
    WHERE ps.id = 1
  `).get();
  const speakers = await getSpeakers();
  return { ...session, isLive: !!session?.isLive, speakers };
}

async function endSession() {
  await db.prepare("UPDATE podcast_session SET is_live = 0, host_id = NULL, title = NULL, started_at = NULL WHERE id = 1").run();
  await db.prepare('DELETE FROM podcast_speakers').run();
  await db.prepare('DELETE FROM podcast_join_requests').run();
  emitPodcastEnded();
}

async function removeSpeaker(userId) {
  await db.prepare('DELETE FROM podcast_speakers WHERE user_id = ?').run(userId);
  emitPodcastSpeakerLeft(userId);
}

// Called from the socket disconnect handler (index.js/app.js) when
// someone closes their browser mid-broadcast without hitting an explicit
// "leave"/"end" button -- the host disappearing ends the whole thing,
// same as if they'd called /end; any other speaker disappearing just
// drops them from the roster.
export async function handlePodcastDisconnect(userId) {
  const session = await db.prepare('SELECT is_live, host_id FROM podcast_session WHERE id = 1').get();
  if (!session?.is_live) return;
  if (session.host_id === userId) {
    await endSession();
  } else {
    const wasSpeaking = await db.prepare('SELECT 1 FROM podcast_speakers WHERE user_id = ?').get(userId);
    if (wasSpeaking) await removeSpeaker(userId);
  }
}

// Anyone can check current status -- no approval needed just to see
// whether a podcast is live and listen to it, only to speak on it.
router.get('/status', asyncHandler(async (req, res) => {
  res.json(await getSession());
}));

// Admin-only: go live. Wipes any leftover speakers/requests from a
// previous session and adds the host as the first speaker.
router.post('/start', requireAdmin, asyncHandler(async (req, res) => {
  const { title } = req.body || {};
  const current = await db.prepare('SELECT is_live FROM podcast_session WHERE id = 1').get();
  if (current?.is_live) return res.status(400).json({ error: 'A podcast is already live.' });

  await db.prepare('DELETE FROM podcast_speakers').run();
  await db.prepare('DELETE FROM podcast_join_requests').run();
  await db.prepare(`
    UPDATE podcast_session SET is_live = 1, host_id = ?, title = ?, started_at = datetime('now')
    WHERE id = 1
  `).run(req.user.id, title || null);
  await db.prepare('INSERT INTO podcast_speakers (user_id) VALUES (?)').run(req.user.id);

  const session = await getSession();
  emitPodcastStarted(session);
  res.json(session);
}));

// Host or an admin can end it. Clears speakers/requests so the next
// broadcast starts from a clean slate.
router.post('/end', asyncHandler(async (req, res) => {
  const current = await db.prepare('SELECT is_live, host_id FROM podcast_session WHERE id = 1').get();
  if (!current?.is_live) return res.status(400).json({ error: 'No podcast is live.' });

  const isHost = current.host_id === req.user.id;
  const admin = await db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.user.id);
  if (!isHost && !admin?.is_admin) return res.status(403).json({ error: 'Only the host or an admin can end this.' });

  await endSession();
  res.json({ ok: true });
}));

// Any user can ask to become a co-speaker. No-ops quietly if they're
// already a speaker or already have a pending request in, rather than
// erroring -- the client doesn't need to track that state itself.
router.post('/request-join', asyncHandler(async (req, res) => {
  const session = await db.prepare('SELECT is_live, host_id FROM podcast_session WHERE id = 1').get();
  if (!session?.is_live) return res.status(400).json({ error: 'No podcast is live.' });

  const alreadySpeaking = await db.prepare('SELECT 1 FROM podcast_speakers WHERE user_id = ?').get(req.user.id);
  if (alreadySpeaking) return res.json({ ok: true, alreadySpeaking: true });

  await db.prepare('INSERT OR IGNORE INTO podcast_join_requests (user_id) VALUES (?)').run(req.user.id);

  const requester = await db.prepare(`
    SELECT id, username, display_name as displayName, avatar_color as avatarColor,
           avatar_icon as avatarIcon, avatar_url as avatarUrl
    FROM users WHERE id = ?
  `).get(req.user.id);
  emitPodcastJoinRequest(session.host_id, requester);
  res.json({ ok: true });
}));

// Host-only: list current pending requests (for the host's own UI to
// render an incoming-requests panel).
router.get('/requests', asyncHandler(async (req, res) => {
  const session = await db.prepare('SELECT is_live, host_id FROM podcast_session WHERE id = 1').get();
  if (!session?.is_live || session.host_id !== req.user.id) {
    return res.status(403).json({ error: 'Only the current host can view requests.' });
  }
  const rows = await db.prepare(`
    SELECT u.id, u.username, u.display_name as displayName, u.avatar_color as avatarColor,
           u.avatar_icon as avatarIcon, u.avatar_url as avatarUrl
    FROM podcast_join_requests jr
    JOIN users u ON u.id = jr.user_id
    ORDER BY jr.created_at ASC
  `).all();
  res.json(rows);
}));

router.post('/requests/:userId/accept', asyncHandler(async (req, res) => {
  const session = await db.prepare('SELECT is_live, host_id FROM podcast_session WHERE id = 1').get();
  if (!session?.is_live || session.host_id !== req.user.id) {
    return res.status(403).json({ error: 'Only the current host can accept requests.' });
  }
  const targetId = Number(req.params.userId);
  await db.prepare('DELETE FROM podcast_join_requests WHERE user_id = ?').run(targetId);
  await db.prepare('INSERT OR IGNORE INTO podcast_speakers (user_id) VALUES (?)').run(targetId);

  const speaker = await db.prepare(`
    SELECT id, username, display_name as displayName, avatar_color as avatarColor,
           avatar_icon as avatarIcon, avatar_url as avatarUrl
    FROM users WHERE id = ?
  `).get(targetId);

  emitPodcastRequestResolved(targetId, true);
  emitPodcastSpeakerJoined(speaker);
  res.json({ ok: true });
}));

router.post('/requests/:userId/decline', asyncHandler(async (req, res) => {
  const session = await db.prepare('SELECT is_live, host_id FROM podcast_session WHERE id = 1').get();
  if (!session?.is_live || session.host_id !== req.user.id) {
    return res.status(403).json({ error: 'Only the current host can decline requests.' });
  }
  const targetId = Number(req.params.userId);
  await db.prepare('DELETE FROM podcast_join_requests WHERE user_id = ?').run(targetId);
  emitPodcastRequestResolved(targetId, false);
  res.json({ ok: true });
}));

// A speaker (including the host, which just ends the whole broadcast --
// handled by /end instead) leaves the stage voluntarily.
router.post('/leave', asyncHandler(async (req, res) => {
  const session = await db.prepare('SELECT is_live, host_id FROM podcast_session WHERE id = 1').get();
  if (!session?.is_live) return res.status(400).json({ error: 'No podcast is live.' });
  if (session.host_id === req.user.id) {
    return res.status(400).json({ error: 'The host leaving ends the podcast -- use /end instead.' });
  }
  await removeSpeaker(req.user.id);
  res.json({ ok: true });
}));

export default router;
