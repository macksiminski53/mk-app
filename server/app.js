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
import serverRoutes, { isMember } from './routes/servers.js';
import groupRoutes, { isMember as isGroupMember } from './routes/groups.js';
import gifRoutes from './routes/gifs.js';
import adminRoutes from './routes/admin.js';
import { getReactionsFor, getReactionsForMany } from './reactions.js';

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
app.use('/api/servers', serverRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/gifs', gifRoutes);
app.use('/api/admin', adminRoutes);

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

// A Mega Chat's Stripe purchase completed (see billing.js webhook) -- push
// the newly-created server straight to the buyer so it shows up without a
// manual refresh.
events.on('megachat:ready', ({ userId, server }) => {
  io.to(`user:${userId}`).emit('megachat:ready', server);
});

// A Mini Chat's group picture was changed -- push it to every member.
events.on('group:avatar-changed', ({ memberIds, groupId, avatarUrl }) => {
  for (const memberId of memberIds) {
    io.to(`user:${memberId}`).emit('group:updated', { groupId, avatarUrl });
  }
});

async function loadMessageRow(id) {
  const row = await db.prepare(`
    SELECT msg.id, msg.content, msg.image_url as imageUrl, msg.created_at as createdAt, msg.edited_at as editedAt,
           u.id as userId, u.username, u.display_name as displayName, u.avatar_color as avatarColor, u.avatar_url as avatarUrl,
           u.is_ultra as isUltra, u.name_color as nameColor, u.custom_emoji_url as customEmojiUrl,
           msg.reply_to_id as replyToId,
           ru.username as replyToUsername, rm.content as replyToContent
    FROM messages msg
    JOIN users u ON u.id = msg.user_id
    LEFT JOIN messages rm ON rm.id = msg.reply_to_id
    LEFT JOIN users ru ON ru.id = rm.user_id
    WHERE msg.id = ?
  `).get(id);
  return row ? { ...row, isUltra: !!row.isUltra, nameColor: row.isUltra ? row.nameColor : null, customEmojiUrl: row.isUltra ? row.customEmojiUrl : null, likeCount: 0, likedByMe: false, pinned: false, pinnedBy: null, pinnedByUsername: null, reactions: [] } : row;
}

async function loadServerMessageRow(id) {
  const row = await db.prepare(`
    SELECT msg.id, msg.content, msg.image_url as imageUrl, msg.created_at as createdAt, msg.edited_at as editedAt,
           msg.channel_id as channelId,
           u.id as userId, u.username, u.display_name as displayName, u.avatar_color as avatarColor, u.avatar_url as avatarUrl,
           u.is_ultra as isUltra, u.name_color as nameColor, u.custom_emoji_url as customEmojiUrl
    FROM server_messages msg
    JOIN users u ON u.id = msg.user_id
    WHERE msg.id = ?
  `).get(id);
  return row ? { ...row, isUltra: !!row.isUltra, nameColor: row.isUltra ? row.nameColor : null, customEmojiUrl: row.isUltra ? row.customEmojiUrl : null, likeCount: 0, likedByMe: false, pinned: false, pinnedBy: null, pinnedByUsername: null, reactions: [] } : row;
}

async function loadGroupMessageRow(id) {
  const row = await db.prepare(`
    SELECT msg.id, msg.content, msg.image_url as imageUrl, msg.created_at as createdAt, msg.edited_at as editedAt,
           msg.group_chat_id as groupId,
           u.id as userId, u.username, u.display_name as displayName, u.avatar_color as avatarColor, u.avatar_url as avatarUrl,
           u.is_ultra as isUltra, u.name_color as nameColor, u.custom_emoji_url as customEmojiUrl
    FROM group_messages msg
    JOIN users u ON u.id = msg.user_id
    WHERE msg.id = ?
  `).get(id);
  return row ? { ...row, isUltra: !!row.isUltra, nameColor: row.isUltra ? row.nameColor : null, customEmojiUrl: row.isUltra ? row.customEmojiUrl : null, likeCount: 0, likedByMe: false, pinned: false, pinnedBy: null, pinnedByUsername: null, reactions: [] } : row;
}

// MK ULTRA perk: liking a message. `messageType` disambiguates ids across
// the three separate message tables since they don't share an id space; the
// client also sends whichever room it's already joined (threadId/channelId/
// groupId) so we know which socket room to broadcast the new count to
// without an extra lookup query per like.
const LIKE_TABLES = {
  dm: { table: 'messages', room: (id) => `thread:${id}` },
  mega: { table: 'server_messages', room: (id) => `channel:${id}` },
  mini: { table: 'group_messages', room: (id) => `group:${id}` },
};
// Reactions and edits key off messages the same way likes do (table + room
// lookup only, no roomCol) -- reused as-is rather than duplicating the
// object under a new name.
const MESSAGE_TABLES = LIKE_TABLES;

// An admin deleted a message via the REST API (server/routes/admin.js) --
// broadcast it to the same room message:new/like/pin updates already go
// to, so anyone currently viewing that thread/channel/group sees it
// disappear immediately instead of on next refresh.
events.on('admin:message-deleted', ({ messageType, messageId, roomId }) => {
  const cfg = MESSAGE_TABLES[messageType];
  if (!cfg) return;
  io.to(cfg.room(roomId)).emit('message:deleted', { messageType, messageId: Number(messageId) });
});

// Detects `$username` mentions in a just-sent message's content. Matching is
// case-insensitive; `$` is used instead of the conventional `@` throughout
// MK. Returns the lowercased usernames mentioned (deduped), for the caller
// to resolve against whoever's actually allowed to be mentioned (thread
// partner, channel members, etc).
const MENTION_RE = /\$([a-zA-Z0-9_]{2,32})/g;
function extractMentionedUsernames(content) {
  if (!content) return [];
  const found = new Set();
  let m;
  MENTION_RE.lastIndex = 0;
  while ((m = MENTION_RE.exec(content))) {
    found.add(m[1].toLowerCase());
  }
  return Array.from(found);
}

async function getMessageLikeCount(messageType, messageId) {
  const row = await db.prepare(
    'SELECT COUNT(*) as c FROM message_likes WHERE message_type = ? AND message_id = ?'
  ).get(messageType, messageId);
  return Number(row?.c) || 0;
}

// Pinning a message: a free perk (no PLUS/PREMIUM/ULTRA gate), capped at 10
// pinned messages per chat so it can't be used as an unlimited workaround
// for the free-tier 24h auto-delete sweep. Same message_type/message_id
// disambiguation as LIKE_TABLES, plus a roomCol so the cap can be counted
// per-thread/channel/group rather than globally.
const PIN_TABLES = {
  dm: { table: 'messages', roomCol: 'thread_id', room: (id) => `thread:${id}` },
  mega: { table: 'server_messages', roomCol: 'channel_id', room: (id) => `channel:${id}` },
  mini: { table: 'group_messages', roomCol: 'group_chat_id', room: (id) => `group:${id}` },
};
const PIN_CAP = 10;

async function getPinCount(messageType, roomCol, table, roomId) {
  const row = await db.prepare(`
    SELECT COUNT(*) as c FROM pinned_messages pm
    JOIN ${table} m ON m.id = pm.message_id
    WHERE pm.message_type = ? AND m.${roomCol} = ?
  `).get(messageType, roomId);
  return Number(row?.c) || 0;
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
      const otherUserRow = await db.prepare('SELECT username FROM users WHERE id = ?').get(otherId);
      const mentioned = otherUserRow && extractMentionedUsernames(trimmed).includes(otherUserRow.username.toLowerCase());
      io.to(`user:${otherId}`).emit('notify:message', {
        threadId: Number(threadId),
        fromUserId: userId,
        fromUsername: socket.user.username,
        preview: trimmed ? trimmed.slice(0, 120) : (imageUrl ? 'Sent an attachment' : ''),
        mentioned: !!mentioned,
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

  // ---- Mega Chats: real-time channel chat ----
  // Same join/leave-room + send/broadcast pattern as DM threads above, just
  // scoped to a channel instead of a thread. Membership is checked on both
  // join and send so someone removed mid-session can't keep reading/posting.
  socket.on('channel:join', async (channelId) => {
    try {
      const channel = await db.prepare('SELECT server_id FROM server_channels WHERE id = ?').get(channelId);
      if (channel && (await isMember(channel.server_id, userId))) {
        socket.join(`channel:${channelId}`);
      }
    } catch (err) {
      console.error('channel:join error', err);
    }
  });

  socket.on('channel:leave', (channelId) => {
    socket.leave(`channel:${channelId}`);
  });

  socket.on('channel-message:send', async ({ channelId, content, imageUrl }, ack) => {
    try {
      const trimmed = (content || '').trim();
      if (!trimmed && !imageUrl) return ack?.({ error: 'Empty message' });

      const channel = await db.prepare('SELECT server_id FROM server_channels WHERE id = ?').get(channelId);
      if (!channel || !(await isMember(channel.server_id, userId))) {
        return ack?.({ error: 'No access' });
      }

      const info = await db.prepare(
        'INSERT INTO server_messages (channel_id, user_id, content, image_url) VALUES (?, ?, ?, ?)'
      ).run(channelId, userId, trimmed, imageUrl || null);

      const row = await loadServerMessageRow(info.lastInsertRowid);
      io.to(`channel:${channelId}`).emit('channel-message:new', { channelId: Number(channelId), message: row });

      ack?.({ ok: true, message: row });
    } catch (err) {
      console.error('channel-message:send error', err);
      ack?.({ error: 'Server error' });
    }
  });

  // ---- Mini Chats: real-time group chat ----
  // Same join/leave-room + send/broadcast pattern as Mega Chat channels
  // above, just scoped to a group_chat_id instead of a channel_id.
  socket.on('group:join', async (groupId) => {
    try {
      if (await isGroupMember(groupId, userId)) socket.join(`group:${groupId}`);
    } catch (err) {
      console.error('group:join error', err);
    }
  });

  socket.on('group:leave', (groupId) => {
    socket.leave(`group:${groupId}`);
  });

  socket.on('group-message:send', async ({ groupId, content, imageUrl }, ack) => {
    try {
      const trimmed = (content || '').trim();
      if (!trimmed && !imageUrl) return ack?.({ error: 'Empty message' });
      if (!(await isGroupMember(groupId, userId))) return ack?.({ error: 'No access' });

      const info = await db.prepare(
        'INSERT INTO group_messages (group_chat_id, user_id, content, image_url) VALUES (?, ?, ?, ?)'
      ).run(groupId, userId, trimmed, imageUrl || null);

      const row = await loadGroupMessageRow(info.lastInsertRowid);
      io.to(`group:${groupId}`).emit('group-message:new', { groupId: Number(groupId), message: row });

      ack?.({ ok: true, message: row });
    } catch (err) {
      console.error('group-message:send error', err);
      ack?.({ error: 'Server error' });
    }
  });

  // MK PREMIUM perk: liking a message. Toggles the current user's like on/off
  // and broadcasts the new total count to everyone in the room; only the
  // liker's own client needs to know whether *they* liked it (returned via
  // the ack), so that part isn't broadcast.
  socket.on('message:like', async ({ messageType, messageId, roomId }, ack) => {
    try {
      const cfg = LIKE_TABLES[messageType];
      if (!cfg) return ack?.({ error: 'Invalid message type' });

      const userRow = await db.prepare('SELECT is_premium, is_ultra FROM users WHERE id = ?').get(userId);
      if (!userRow?.is_premium && !userRow?.is_ultra) return ack?.({ error: 'MK PREMIUM required' });

      const msgRow = await db.prepare(`SELECT id FROM ${cfg.table} WHERE id = ?`).get(messageId);
      if (!msgRow) return ack?.({ error: 'Message not found' });

      const existing = await db.prepare(
        'SELECT id FROM message_likes WHERE message_type = ? AND message_id = ? AND user_id = ?'
      ).get(messageType, messageId, userId);

      let likedByMe;
      if (existing) {
        await db.prepare('DELETE FROM message_likes WHERE id = ?').run(existing.id);
        likedByMe = false;
      } else {
        await db.prepare(
          'INSERT INTO message_likes (message_type, message_id, user_id) VALUES (?, ?, ?)'
        ).run(messageType, messageId, userId);
        likedByMe = true;
      }

      const likeCount = await getMessageLikeCount(messageType, messageId);
      if (roomId) {
        io.to(cfg.room(roomId)).emit('message:like-update', {
          messageType,
          messageId: Number(messageId),
          likeCount,
        });
      }
      ack?.({ ok: true, likeCount, likedByMe });
    } catch (err) {
      console.error('message:like error', err);
      ack?.({ error: 'Server error' });
    }
  });

  // Pinning a message: free for everyone, capped at PIN_CAP (10) pinned
  // messages per chat. Pinned messages are also exempt from the free-tier
  // 24h auto-delete sweep below, so this doubles as "save this message
  // permanently" even in a chat that otherwise wipes itself daily.
  socket.on('message:pin', async ({ messageType, messageId, roomId }, ack) => {
    try {
      const cfg = PIN_TABLES[messageType];
      if (!cfg) return ack?.({ error: 'Invalid message type' });

      const msgRow = await db.prepare(`SELECT id FROM ${cfg.table} WHERE id = ?`).get(messageId);
      if (!msgRow) return ack?.({ error: 'Message not found' });

      const existing = await db.prepare(
        'SELECT id FROM pinned_messages WHERE message_type = ? AND message_id = ?'
      ).get(messageType, messageId);

      let pinned, pinnedBy = null, pinnedByUsername = null;
      if (existing) {
        await db.prepare('DELETE FROM pinned_messages WHERE id = ?').run(existing.id);
        pinned = false;
      } else {
        const count = await getPinCount(messageType, cfg.roomCol, cfg.table, roomId);
        if (count >= PIN_CAP) {
          return ack?.({ error: `This chat already has ${PIN_CAP} pinned messages (max). Unpin one first.` });
        }
        await db.prepare(
          'INSERT INTO pinned_messages (message_type, message_id, pinned_by) VALUES (?, ?, ?)'
        ).run(messageType, messageId, userId);
        pinned = true;
        pinnedBy = userId;
        pinnedByUsername = socket.user.username;
      }

      if (roomId) {
        io.to(cfg.room(roomId)).emit('message:pin-update', {
          messageType,
          messageId: Number(messageId),
          pinned,
          pinnedBy,
          pinnedByUsername,
        });
      }
      ack?.({ ok: true, pinned, pinnedBy, pinnedByUsername });
    } catch (err) {
      console.error('message:pin error', err);
      ack?.({ error: 'Server error' });
    }
  });

  // Free perk: emoji reactions. Toggle-per-emoji, so one user can stack
  // several different reactions on the same message but not double-react
  // with the same one. Returns/broadcasts the full grouped reaction list
  // for the message rather than a delta -- simpler for the client to just
  // replace its local copy wholesale.
  socket.on('message:react', async ({ messageType, messageId, roomId, emoji }, ack) => {
    try {
      const cfg = MESSAGE_TABLES[messageType];
      if (!cfg) return ack?.({ error: 'Invalid message type' });
      if (typeof emoji !== 'string' || !emoji || emoji.length > 8) {
        return ack?.({ error: 'Invalid emoji' });
      }

      const msgRow = await db.prepare(`SELECT id FROM ${cfg.table} WHERE id = ?`).get(messageId);
      if (!msgRow) return ack?.({ error: 'Message not found' });

      const existing = await db.prepare(
        'SELECT id FROM message_reactions WHERE message_type = ? AND message_id = ? AND user_id = ? AND emoji = ?'
      ).get(messageType, messageId, userId, emoji);

      if (existing) {
        await db.prepare('DELETE FROM message_reactions WHERE id = ?').run(existing.id);
      } else {
        await db.prepare(
          'INSERT INTO message_reactions (message_type, message_id, user_id, emoji) VALUES (?, ?, ?, ?)'
        ).run(messageType, messageId, userId, emoji);
      }

      const reactions = await getReactionsFor(messageType, messageId);
      if (roomId) {
        io.to(cfg.room(roomId)).emit('message:reactions-update', {
          messageType,
          messageId: Number(messageId),
          reactions,
        });
      }
      ack?.({ ok: true, reactions });
    } catch (err) {
      console.error('message:react error', err);
      ack?.({ error: 'Server error' });
    }
  });

  // Editing your own message. Ownership is checked server-side (not just
  // hidden client-side) so it can't be spoofed from a modified client.
  // edited_at is set to the current time and surfaced to the client as an
  // "(edited)" tag -- the exact timestamp isn't shown anywhere yet, it's
  // just used as a truthy flag.
  socket.on('message:edit', async ({ messageType, messageId, roomId, content }, ack) => {
    try {
      const cfg = MESSAGE_TABLES[messageType];
      if (!cfg) return ack?.({ error: 'Invalid message type' });

      const trimmed = (content || '').trim();
      if (!trimmed) return ack?.({ error: 'Message cannot be empty' });
      if (trimmed.length > 4000) return ack?.({ error: 'Message is too long' });

      const msgRow = await db.prepare(`SELECT id, user_id FROM ${cfg.table} WHERE id = ?`).get(messageId);
      if (!msgRow) return ack?.({ error: 'Message not found' });
      if (msgRow.user_id !== userId) return ack?.({ error: 'You can only edit your own messages' });

      await db.prepare(
        `UPDATE ${cfg.table} SET content = ?, edited_at = datetime('now') WHERE id = ?`
      ).run(trimmed, messageId);

      const editedRow = await db.prepare(`SELECT edited_at as editedAt FROM ${cfg.table} WHERE id = ?`).get(messageId);

      if (roomId) {
        io.to(cfg.room(roomId)).emit('message:edit-update', {
          messageType,
          messageId: Number(messageId),
          content: trimmed,
          editedAt: editedRow?.editedAt || null,
        });
      }
      ack?.({ ok: true, content: trimmed, editedAt: editedRow?.editedAt || null });
    } catch (err) {
      console.error('message:edit error', err);
      ack?.({ error: 'Server error' });
    }
  });

  // MK ULTRA perk: read receipts for DMs. Tracking (writing dm_read_state)
  // happens for every user regardless of tier, but the "Seen" indicator is
  // only shown client-side when at least one participant has ULTRA -- see
  // the dm_read_state table comment in db.js. last_read_message_id only
  // ever moves forward (MAX(...)) so an out-of-order ack can't rewind it.
  socket.on('thread:mark-read', async ({ threadId, lastMessageId }) => {
    try {
      const thread = await userInThread(userId, threadId);
      if (!thread || !lastMessageId) return;
      await db.prepare(`
        INSERT INTO dm_read_state (thread_id, user_id, last_read_message_id, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(thread_id, user_id) DO UPDATE SET
          last_read_message_id = MAX(last_read_message_id, excluded.last_read_message_id),
          updated_at = excluded.updated_at
      `).run(threadId, userId, lastMessageId);
      socket.to(`thread:${threadId}`).emit('thread:read-update', {
        threadId: Number(threadId),
        userId,
        lastReadMessageId: Number(lastMessageId),
      });
    } catch (err) {
      console.error('thread:mark-read error', err);
    }
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

// ---- Mandatory 24-hour chat wipe for free (non-PLUS/ULTRA) threads ----
// Every thread where neither participant has MK PLUS or MK ULTRA gets its
// messages wiped once last_reset_at is more than 24h old, then
// last_reset_at is bumped so the cycle repeats. This is not an opt-in
// toggle -- it applies to every free-tier thread unconditionally (the old
// `auto_reset_24h` per-thread flag is no longer consulted). Having MK PLUS,
// PREMIUM, or ULTRA on either side of a conversation makes that chat
// permanent (each tier includes every lower tier's perks). Runs on an
// interval rather than per-message so it works even for threads nobody is
// actively viewing.
const AUTO_RESET_SWEEP_MS = 5 * 60 * 1000; // check every 5 minutes
const AUTO_RESET_WINDOW = "24 hours";

async function sweepAutoResetThreads() {
  try {
    // MK PLUS/PREMIUM/ULTRA perk: chats with a paid participant never auto-delete.
    const due = await db.prepare(`
      SELECT dm.id FROM dm_threads dm
      JOIN users ua ON ua.id = dm.user_a_id
      JOIN users ub ON ub.id = dm.user_b_id
      WHERE ua.is_plus = 0 AND ua.is_premium = 0 AND ua.is_ultra = 0
        AND ub.is_plus = 0 AND ub.is_premium = 0 AND ub.is_ultra = 0
        AND (
          dm.last_reset_at IS NULL
          OR datetime(dm.last_reset_at, '+${AUTO_RESET_WINDOW}') <= datetime('now')
        )
    `).all();
    for (const { id: threadId } of due) {
      await db.prepare("DELETE FROM messages WHERE thread_id = ? AND id NOT IN (SELECT message_id FROM pinned_messages WHERE message_type = 'dm')").run(threadId);
      await db.prepare("UPDATE dm_threads SET last_reset_at = datetime('now') WHERE id = ?").run(threadId);
      io.to(`thread:${threadId}`).emit('chat:deleted', { threadId: Number(threadId) });
    }
  } catch (err) {
    console.error('sweepAutoResetThreads error', err);
  }
}

// Same mandatory 24h rule for free-tier Mini Chats -- permanent as soon as
// any single member has MK PLUS, PREMIUM, or ULTRA, otherwise wiped on the
// same cycle as DMs. (MK PREMIUM's own perk description calls this out
// specifically for Mini Chats, but it's really just PLUS's permanent-chat
// perk, which PREMIUM and ULTRA also carry since each tier is a superset
// of the one below it.)
async function sweepAutoResetGroups() {
  try {
    const due = await db.prepare(`
      SELECT g.id FROM group_chats g
      WHERE NOT EXISTS (
        SELECT 1 FROM group_chat_members gm
        JOIN users u ON u.id = gm.user_id
        WHERE gm.group_chat_id = g.id AND (u.is_plus = 1 OR u.is_premium = 1 OR u.is_ultra = 1)
      )
      AND (
        g.last_reset_at IS NULL
        OR datetime(g.last_reset_at, '+${AUTO_RESET_WINDOW}') <= datetime('now')
      )
    `).all();
    for (const { id: groupId } of due) {
      await db.prepare("DELETE FROM group_messages WHERE group_chat_id = ? AND id NOT IN (SELECT message_id FROM pinned_messages WHERE message_type = 'mini')").run(groupId);
      await db.prepare("UPDATE group_chats SET last_reset_at = datetime('now') WHERE id = ?").run(groupId);
      io.to(`group:${groupId}`).emit('group-chat:cleared', { groupId: Number(groupId) });
    }
  } catch (err) {
    console.error('sweepAutoResetGroups error', err);
  }
}

// Mega Chats are a paid, one-time purchase, so by default they're
// permanent -- but a small server (under MEGA_AUTO_RESET_MEMBER_CAP
// members) gets a mandatory 7-day wipe just like free DMs/Mini Chats get a
// 24h one, so an abandoned or tiny server doesn't just accumulate history
// forever with nobody around to prune it. Crossing the member threshold
// (even briefly, at sweep time) is what matters -- there's no tier
// exemption here since the whole server was already paid for.
const MEGA_AUTO_RESET_WINDOW = "7 days";
const MEGA_AUTO_RESET_MEMBER_CAP = 10;

async function sweepAutoResetServers() {
  try {
    const due = await db.prepare(`
      SELECT s.id FROM servers s
      WHERE (SELECT COUNT(*) FROM server_members sm WHERE sm.server_id = s.id) < ${MEGA_AUTO_RESET_MEMBER_CAP}
      AND (
        s.last_reset_at IS NULL
        OR datetime(s.last_reset_at, '+${MEGA_AUTO_RESET_WINDOW}') <= datetime('now')
      )
    `).all();
    for (const { id: serverId } of due) {
      const channels = await db.prepare('SELECT id FROM server_channels WHERE server_id = ?').all(serverId);
      for (const { id: channelId } of channels) {
        await db.prepare(
          "DELETE FROM server_messages WHERE channel_id = ? AND id NOT IN (SELECT message_id FROM pinned_messages WHERE message_type = 'mega')"
        ).run(channelId);
        io.to(`channel:${channelId}`).emit('channel-message:cleared', { channelId: Number(channelId) });
      }
      await db.prepare("UPDATE servers SET last_reset_at = datetime('now') WHERE id = ?").run(serverId);
    }
  } catch (err) {
    console.error('sweepAutoResetServers error', err);
  }
}

setInterval(() => sweepAutoResetThreads(), AUTO_RESET_SWEEP_MS);
setInterval(() => sweepAutoResetGroups(), AUTO_RESET_SWEEP_MS);
setInterval(() => sweepAutoResetServers(), AUTO_RESET_SWEEP_MS);

const PORT = process.env.PORT || 4000;

console.log('[boot] app.js: all imports resolved, calling initSchema()...');

initSchema()
  .then(() => {
    console.log('[boot] app.js: initSchema() done, calling server.listen()...');
    server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
    sweepAutoResetThreads();
    sweepAutoResetGroups();
    sweepAutoResetServers();
  })
  .catch((err) => {
    const msg = `[boot] app.js: Failed to initialize database schema: ${err && err.stack ? err.stack : err}\n`;
    process.stderr.write(msg, () => process.exit(1));
  });
