import express from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { db, initSchema } from './db.js';
import { verifySocketToken, requireAuth } from './auth.js';
import { markOnline, markOffline } from './presence.js';
import { events } from './events.js';
import authRoutes from './routes/auth.js';
import friendRoutes from './routes/friends.js';
import threadRoutes from './routes/threads.js';
import billingRoutes, { handleStripeWebhook } from './routes/billing.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.CLIENT_ORIGIN || '*' },
});

app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*' }));

// Stripe webhook needs the raw request body (for signature verification),
// so it's registered before express.json() and only that one route is
// exempt from JSON body-parsing.
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  handleStripeWebhook(req, res).catch((err) => {
    console.error('Stripe webhook handler error:', err);
    res.status(500).end();
  });
});

app.use(express.json());
app.use('/uploads', express.static(uploadsDir));

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/friends', friendRoutes);
app.use('/api/threads', threadRoutes);
app.use('/api/billing', billingRoutes);

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  const user = verifySocketToken(token);
  if (!user) return next(new Error('unauthorized'));
  socket.user = user;
  next();
});

async function userInThread(userId, threadId) {
  return db.prepare(
    'SELECT * FROM dm_threads WHERE id = ? AND (user_a_id = ? OR user_b_id = ?)'
  ).get(threadId, userId, userId);
}

async function friendIdsOf(userId) {
  const rows = await db.prepare(`
    SELECT from_id, to_id FROM friend_requests
    WHERE status = 'accepted' AND (from_id = ? OR to_id = ?)
  `).all(userId, userId);
  return rows.map((r) => (r.from_id === userId ? r.to_id : r.from_id));
}

async function broadcastPresence(userId, online) {
  const friendIds = await friendIdsOf(userId);
  for (const friendId of friendIds) {
    io.to(`user:${friendId}`).emit('presence:update', { userId, online });
  }
}

// Fired whenever a REST route changes a user's profile (avatar/status) -
// regardless of whether the caller was the browser UI or an external tool
// like the music reporter. Notify the user's own other sessions (so their
// own open tabs refresh) and all their friends.
events.on('user:profile-changed', async ({ userId }) => {
  io.to(`user:${userId}`).emit('profile:changed', { userId, self: true });
  const friendIds = await friendIdsOf(userId);
  for (const friendId of friendIds) {
    io.to(`user:${friendId}`).emit('profile:changed', { userId, self: false });
  }
});

async function loadMessageRow(id) {
  return db.prepare(`
    SELECT msg.id, msg.content, msg.image_url as imageUrl, msg.created_at as createdAt,
           u.id as userId, u.username, u.avatar_color as avatarColor, u.avatar_url as avatarUrl,
           msg.reply_to_id as replyToId,
           ru.username as replyToUsername, rm.content as replyToContent
    FROM messages msg
    JOIN users u ON u.id = msg.user_id
    LEFT JOIN messages rm ON rm.id = msg.reply_to_id
    LEFT JOIN users ru ON ru.id = rm.user_id
    WHERE msg.id = ?
  `).get(id);
}

io.on('connection', (socket) => {
  const userId = socket.user.id;
  socket.join(`user:${userId}`);
  markOnline(userId);
  broadcastPresence(userId, true).catch((err) => console.error('broadcastPresence error', err));

  socket.on('thread:join', async (threadId) => {
    try {
      if (await userInThread(userId, threadId)) socket.join(`thread:${threadId}`);
    } catch (err) {
      console.error('thread:join error', err);
    }
  });

  socket.on('thread:leave', (threadId) => {
    socket.leave(`thread:${threadId}`);
  });

  socket.on('message:send', async ({ threadId, content, replyToId, imageUrl }, ack) => {
    try {
      const trimmed = (content || '').trim();
      if (!trimmed && !imageUrl) return ack?.({ error: 'Empty message' });
      const thread = await userInThread(userId, threadId);
      if (!thread) return ack?.({ error: 'No access' });

      let validReplyToId = null;
      if (replyToId) {
        const replyRow = await db.prepare('SELECT id FROM messages WHERE id = ? AND thread_id = ?').get(replyToId, threadId);
        if (replyRow) validReplyToId = replyRow.id;
      }

      const info = await db.prepare(
        'INSERT INTO messages (thread_id, user_id, content, reply_to_id, image_url) VALUES (?, ?, ?, ?, ?)'
      ).run(threadId, userId, trimmed, validReplyToId, imageUrl || null);

      const row = await loadMessageRow(info.lastInsertRowid);

      io.to(`thread:${threadId}`).emit('message:new', { threadId: Number(threadId), message: row });

      // Lightweight event so the recipient can show a desktop notification +
      // sound even for a thread they don't currently have open (message:new
      // above only reaches clients that have joined this specific thread's
      // room via thread:join, i.e. only whoever is actively viewing it).
      const otherId = thread.user_a_id === userId ? thread.user_b_id : thread.user_a_id;
      io.to(`user:${otherId}`).emit('notify:message', {
        threadId: Number(threadId),
        fromUserId: userId,
        fromUsername: socket.user.username,
        preview: trimmed ? trimmed.slice(0, 120) : (imageUrl ? 'Sent an attachment' : ''),
      });

      ack?.({ ok: true, message: row });
    } catch (err) {
      console.error('message:send error', err);
      ack?.({ error: 'Server error' });
    }
  });

  socket.on('typing', ({ threadId, username, isTyping }) => {
    socket.to(`thread:${threadId}`).emit('typing', { threadId, username, isTyping });
  });

  socket.on('friend:request-sent', (toUserId) => {
    io.to(`user:${toUserId}`).emit('friend:request-received');
  });

  // ---- 1:1 voice call signaling ----
  // Pure relay -- the server never touches SDP/ICE payloads, it just routes
  // them to the other user's room. WebRTC media flows directly between the
  // two browsers once negotiation finishes; only signaling goes through us.
  socket.on('call:invite', ({ toUserId }) => {
    io.to(`user:${toUserId}`).emit('call:incoming', {
      fromUserId: userId,
      fromUsername: socket.user.username,
    });
  });

  socket.on('call:accept', ({ toUserId }) => {
    io.to(`user:${toUserId}`).emit('call:accepted', { fromUserId: userId });
  });

  socket.on('call:decline', ({ toUserId }) => {
    io.to(`user:${toUserId}`).emit('call:declined', { fromUserId: userId });
  });

  socket.on('call:end', ({ toUserId }) => {
    io.to(`user:${toUserId}`).emit('call:ended', { fromUserId: userId });
  });

  socket.on('call:signal', ({ toUserId, data }) => {
    io.to(`user:${toUserId}`).emit('call:signal', { fromUserId: userId, data });
  });

  // ---- Mutual-consent "delete chat" ----
  // Either user can toggle their own vote; once both are yes, every message
  // in the thread is wiped and both votes reset to 0. Each participant gets
  // a payload phrased as "myVote"/"otherVote" so the client doesn't need to
  // know which of user_a/user_b it is.
  socket.on('chat:delete-vote', async ({ threadId, vote }, ack) => {
    try {
      const thread = await userInThread(userId, threadId);
      if (!thread) return ack?.({ error: 'No access' });
      const isA = thread.user_a_id === userId;
      const column = isA ? 'delete_vote_a' : 'delete_vote_b';
      await db.prepare(`UPDATE dm_threads SET ${column} = ? WHERE id = ?`).run(vote ? 1 : 0, threadId);

      const updated = await db.prepare(
        'SELECT delete_vote_a, delete_vote_b, user_a_id, user_b_id FROM dm_threads WHERE id = ?'
      ).get(threadId);
      const bothYes = !!updated.delete_vote_a && !!updated.delete_vote_b;

      if (bothYes) {
        await db.prepare('DELETE FROM messages WHERE thread_id = ?').run(threadId);
        await db.prepare('UPDATE dm_threads SET delete_vote_a = 0, delete_vote_b = 0 WHERE id = ?').run(threadId);
        io.to(`thread:${threadId}`).emit('chat:deleted', { threadId: Number(threadId) });
      } else {
        io.to(`user:${updated.user_a_id}`).emit('chat:delete-vote-update', {
          threadId: Number(threadId),
          myVote: !!updated.delete_vote_a,
          otherVote: !!updated.delete_vote_b,
        });
        io.to(`user:${updated.user_b_id}`).emit('chat:delete-vote-update', {
          threadId: Number(threadId),
          myVote: !!updated.delete_vote_b,
          otherVote: !!updated.delete_vote_a,
        });
      }
      ack?.({ ok: true });
    } catch (err) {
      console.error('chat:delete-vote error', err);
      ack?.({ error: 'Server error' });
    }
  });

  socket.on('disconnect', () => {
    markOffline(userId);
    setTimeout(() => {
      broadcastPresence(userId, false).catch((err) => console.error('broadcastPresence error', err));
    }, 300);
  });
});

// ---- Mandatory 24-hour chat wipe for free (non-ULTRA) threads ----
// Every thread where neither participant has MK ULTRA gets its messages
// wiped once last_reset_at is more than 24h old, then last_reset_at is
// bumped so the cycle repeats. This is not an opt-in toggle -- it applies
// to every free-tier thread unconditionally (the old `auto_reset_24h`
// per-thread flag is no longer consulted). Buying MK ULTRA on either side
// of a conversation makes that chat permanent. Runs on an interval rather
// than per-message so it works even for threads nobody is actively viewing.
const AUTO_RESET_SWEEP_MS = 5 * 60 * 1000; // check every 5 minutes
const AUTO_RESET_WINDOW = "24 hours";

async function sweepAutoResetThreads() {
  try {
    // MK ULTRA perk: chats with an ULTRA participant never auto-delete.
    const due = await db.prepare(`
      SELECT dm.id FROM dm_threads dm
      JOIN users ua ON ua.id = dm.user_a_id
      JOIN users ub ON ub.id = dm.user_b_id
      WHERE ua.is_ultra = 0
        AND ub.is_ultra = 0
        AND (
          dm.last_reset_at IS NULL
          OR datetime(dm.last_reset_at, '+${AUTO_RESET_WINDOW}') <= datetime('now')
        )
    `).all();
    for (const { id: threadId } of due) {
      await db.prepare('DELETE FROM messages WHERE thread_id = ?').run(threadId);
      await db.prepare("UPDATE dm_threads SET last_reset_at = datetime('now') WHERE id = ?").run(threadId);
      io.to(`thread:${threadId}`).emit('chat:deleted', { threadId: Number(threadId) });
    }
  } catch (err) {
    console.error('sweepAutoResetThreads error', err);
  }
}

setInterval(() => sweepAutoResetThreads(), AUTO_RESET_SWEEP_MS);

const PORT = process.env.PORT || 4000;

console.log('[boot] app.js: all imports resolved, calling initSchema()...');

initSchema()
  .then(() => {
    console.log('[boot] app.js: initSchema() done, calling server.listen()...');
    server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
    sweepAutoResetThreads();
  })
  .catch((err) => {
    const msg = `[boot] app.js: Failed to initialize database schema: ${err && err.stack ? err.stack : err}\n`;
    process.stderr.write(msg, () => process.exit(1));
  });
