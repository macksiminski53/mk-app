import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { db } from './db.js';
import { verifySocketToken, requireAuth } from './auth.js';
import { markOnline, markOffline } from './presence.js';
import { events } from './events.js';
import authRoutes from './routes/auth.js';
import friendRoutes from './routes/friends.js';
import threadRoutes from './routes/threads.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.CLIENT_ORIGIN || '*' },
});

app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*' }));
app.use(express.json());
app.use('/uploads', express.static(uploadsDir));

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/friends', friendRoutes);
app.use('/api/threads', threadRoutes);

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  const user = verifySocketToken(token);
  if (!user) return next(new Error('unauthorized'));
  socket.user = user;
  next();
});

function userInThread(userId, threadId) {
  return db.prepare(
    'SELECT * FROM dm_threads WHERE id = ? AND (user_a_id = ? OR user_b_id = ?)'
  ).get(threadId, userId, userId);
}

function friendIdsOf(userId) {
  const rows = db.prepare(`
    SELECT from_id, to_id FROM friend_requests
    WHERE status = 'accepted' AND (from_id = ? OR to_id = ?)
  `).all(userId, userId);
  return rows.map((r) => (r.from_id === userId ? r.to_id : r.from_id));
}

function broadcastPresence(userId, online) {
  for (const friendId of friendIdsOf(userId)) {
    io.to(`user:${friendId}`).emit('presence:update', { userId, online });
  }
}

// Fired whenever a REST route changes a user's profile (avatar/status) -
// regardless of whether the caller was the browser UI or an external tool
// like the music reporter. Notify the user's own other sessions (so their
// own open tabs refresh) and all their friends.
events.on('user:profile-changed', ({ userId }) => {
  io.to(`user:${userId}`).emit('profile:changed', { userId, self: true });
  for (const friendId of friendIdsOf(userId)) {
    io.to(`user:${friendId}`).emit('profile:changed', { userId, self: false });
  }
});

function loadMessageRow(id) {
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
  broadcastPresence(userId, true);

  socket.on('thread:join', (threadId) => {
    if (userInThread(userId, threadId)) socket.join(`thread:${threadId}`);
  });

  socket.on('thread:leave', (threadId) => {
    socket.leave(`thread:${threadId}`);
  });

  socket.on('message:send', ({ threadId, content, replyToId, imageUrl }, ack) => {
    const trimmed = (content || '').trim();
    if (!trimmed && !imageUrl) return ack?.({ error: 'Empty message' });
    if (!userInThread(userId, threadId)) return ack?.({ error: 'No access' });

    let validReplyToId = null;
    if (replyToId) {
      const replyRow = db.prepare('SELECT id FROM messages WHERE id = ? AND thread_id = ?').get(replyToId, threadId);
      if (replyRow) validReplyToId = replyRow.id;
    }

    const info = db.prepare(
      'INSERT INTO messages (thread_id, user_id, content, reply_to_id, image_url) VALUES (?, ?, ?, ?, ?)'
    ).run(threadId, userId, trimmed, validReplyToId, imageUrl || null);

    const row = loadMessageRow(info.lastInsertRowid);

    io.to(`thread:${threadId}`).emit('message:new', { threadId: Number(threadId), message: row });
    ack?.({ ok: true, message: row });
  });

  socket.on('typing', ({ threadId, username, isTyping }) => {
    socket.to(`thread:${threadId}`).emit('typing', { threadId, username, isTyping });
  });

  socket.on('friend:request-sent', (toUserId) => {
    io.to(`user:${toUserId}`).emit('friend:request-received');
  });

  socket.on('disconnect', () => {
    markOffline(userId);
    setTimeout(() => {
      broadcastPresence(userId, false);
    }, 300);
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
