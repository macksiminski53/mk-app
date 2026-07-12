import { createClient } from '@libsql/client';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// If TURSO_DATABASE_URL is set, connect to hosted Turso (persists across
// deploys). Otherwise fall back to a local SQLite file for local dev.
const url = process.env.TURSO_DATABASE_URL || `file:${path.join(__dirname, 'data.sqlite')}`;
const authToken = process.env.TURSO_AUTH_TOKEN;

const client = createClient(authToken ? { url, authToken } : { url });

// Thin async wrapper matching the shape our route files already use
// (db.prepare(sql).run/get/all(...params)), but every call now returns a
// Promise since a networked database can't be queried synchronously.
export const db = {
  exec: async (sql) => {
    await client.execute(sql);
  },
  prepare: (sql) => ({
    run: async (...params) => {
      const result = await client.execute({ sql, args: params });
      return {
        lastInsertRowid: result.lastInsertRowid !== undefined ? Number(result.lastInsertRowid) : undefined,
        changes: result.rowsAffected,
      };
    },
    get: async (...params) => {
      const result = await client.execute({ sql, args: params });
      return result.rows[0];
    },
    all: async (...params) => {
      const result = await client.execute({ sql, args: params });
      return result.rows;
    },
  }),
  // Not currently used for a multi-statement atomic operation, kept simple.
  transaction: (fn) => {
    return async (...args) => fn(...args);
  },
};

export async function initSchema() {
  await client.execute(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  avatar_color TEXT NOT NULL,
  avatar_url TEXT,
  status_text TEXT,
  status_updated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

  await client.execute(`
CREATE TABLE IF NOT EXISTS friend_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(from_id, to_id)
)`);

  await client.execute(`
CREATE TABLE IF NOT EXISTS dm_threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_a_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_a_id, user_b_id)
)`);

  await client.execute(`
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id INTEGER NOT NULL REFERENCES dm_threads(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  reply_to_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
  image_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

  await client.execute('CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id)');
  await client.execute('CREATE INDEX IF NOT EXISTS idx_friend_requests_to ON friend_requests(to_id)');

  // "bio" was added after the users table already existed in production, so
  // CREATE TABLE IF NOT EXISTS above won't add it to existing databases --
  // ALTER TABLE is needed instead. Ignore the error if it already exists.
  try {
    await client.execute('ALTER TABLE users ADD COLUMN bio TEXT');
  } catch (e) {
    if (!/duplicate column/i.test(e.message || '')) throw e;
  }

  // Mutual-consent "delete chat" votes -- one flag per participant, reset to
  // 0/0 once both are set (which triggers the actual message wipe).
  try {
    await client.execute('ALTER TABLE dm_threads ADD COLUMN delete_vote_a INTEGER NOT NULL DEFAULT 0');
  } catch (e) {
    if (!/duplicate column/i.test(e.message || '')) throw e;
  }
  try {
    await client.execute('ALTER TABLE dm_threads ADD COLUMN delete_vote_b INTEGER NOT NULL DEFAULT 0');
  } catch (e) {
    if (!/duplicate column/i.test(e.message || '')) throw e;
  }

  // Custom per-user ringtones (base64 data URIs, same persistence trick as
  // avatars). NULL means "use the bundled default sound".
  try {
    await client.execute('ALTER TABLE users ADD COLUMN ringtone_outgoing_url TEXT');
  } catch (e) {
    if (!/duplicate column/i.test(e.message || '')) throw e;
  }
  try {
    await client.execute('ALTER TABLE users ADD COLUMN ringtone_incoming_url TEXT');
  } catch (e) {
    if (!/duplicate column/i.test(e.message || '')) throw e;
  }

  // Per-chat "auto-reset every 24h" setting -- when enabled, a periodic
  // sweep (see index.js) wipes the thread's messages once last_reset_at
  // is more than 24h old, then bumps last_reset_at so the cycle repeats.
  try {
    await client.execute('ALTER TABLE dm_threads ADD COLUMN auto_reset_24h INTEGER NOT NULL DEFAULT 0');
  } catch (e) {
    if (!/duplicate column/i.test(e.message || '')) throw e;
  }
  try {
    await client.execute('ALTER TABLE dm_threads ADD COLUMN last_reset_at TEXT');
  } catch (e) {
    if (!/duplicate column/i.test(e.message || '')) throw e;
  }

  // MK ULTRA -- a one-time $1 purchase (Stripe) that permanently unlocks:
  // chats exempt from the 24h auto-reset sweep, GIF avatars, a custom UI
  // accent color, and a badge next to the username.
  try {
    await client.execute('ALTER TABLE users ADD COLUMN is_ultra INTEGER NOT NULL DEFAULT 0');
  } catch (e) {
    if (!/duplicate column/i.test(e.message || '')) throw e;
  }
  try {
    await client.execute('ALTER TABLE users ADD COLUMN ultra_color TEXT');
  } catch (e) {
    if (!/duplicate column/i.test(e.message || '')) throw e;
  }

  // MK PLUS/MK ULTRA split: the original $1 MK ULTRA tier was renamed to
  // MK PLUS (same perks, same price); MK ULTRA is now a separate, pricier
  // ($5) tier with its own extra perks on top of everything PLUS gets. This
  // migration only ever runs the moment is_plus is first added to the
  // table -- existing is_ultra=1 accounts (the old $1 purchasers) become
  // is_plus=1 and are reset to is_ultra=0, since they bought what is now
  // called PLUS, not the new premium ULTRA tier.
  try {
    await client.execute('ALTER TABLE users ADD COLUMN is_plus INTEGER NOT NULL DEFAULT 0');
    await client.execute("UPDATE users SET is_plus = 1, is_ultra = 0 WHERE is_ultra = 1");
  } catch (e) {
    if (!/duplicate column/i.test(e.message || '')) throw e;
  }

  // MK PREMIUM: a second three-way split. MK PREMIUM ($2.50) takes over
  // what MK ULTRA used to grant (free Mega Chat creation, permanent Mini
  // Chats/DMs whenever a member has PREMIUM or higher, an emoji picker,
  // and the ability to like messages). MK ULTRA is now repriced to $5 and
  // sits above PREMIUM with its own extra perks (name color, avatar
  // border, profile banner, message pinning, read receipts, a raised Mini
  // Chat member cap, and personal custom emoji). Same one-time migration
  // trick as the PLUS split above: only fires the moment is_premium is
  // first added -- existing is_ultra=1 accounts (the old $5 purchasers)
  // become is_premium=1 and are reset to is_ultra=0, since they bought
  // what's now called PREMIUM, not the new top ULTRA tier. ULTRA is a
  // superset of PREMIUM, which is a superset of PLUS -- perk checks
  // throughout the app treat is_ultra as implying is_premium and is_plus.
  try {
    await client.execute('ALTER TABLE users ADD COLUMN is_premium INTEGER NOT NULL DEFAULT 0');
    await client.execute("UPDATE users SET is_premium = 1, is_ultra = 0 WHERE is_ultra = 1");
  } catch (e) {
    if (!/duplicate column/i.test(e.message || '')) throw e;
  }

  // MK ULTRA's new cosmetic/utility perks: a custom name color in chat
  // (distinct from the shared accent-color perk), a profile banner image,
  // and one personal custom emoji, all stored as base64 data URIs same as
  // avatars/group pictures.
  try {
    await client.execute('ALTER TABLE users ADD COLUMN name_color TEXT');
  } catch (e) {
    if (!/duplicate column/i.test(e.message || '')) throw e;
  }
  try {
    await client.execute('ALTER TABLE users ADD COLUMN banner_url TEXT');
  } catch (e) {
    if (!/duplicate column/i.test(e.message || '')) throw e;
  }
  try {
    await client.execute('ALTER TABLE users ADD COLUMN custom_emoji_url TEXT');
  } catch (e) {
    if (!/duplicate column/i.test(e.message || '')) throw e;
  }

  // A free, optional display name shown throughout the UI instead of the
  // account's username. The username itself never changes (it's still what
  // you log in with and how friends find/add you) -- this is purely a
  // cosmetic override for how your name is *shown* to others.
  try {
    await client.execute('ALTER TABLE users ADD COLUMN display_name TEXT');
  } catch (e) {
    if (!/duplicate column/i.test(e.message || '')) throw e;
  }

  // Distinguishes a status set by the MusicToDiscord reporter script
  // ('music') from any other write to status_text ('manual'/NULL). The
  // "Playing" card UI only renders for source='music', so a hand-typed
  // status never gets shown as a fake now-playing card.
  try {
    await client.execute('ALTER TABLE users ADD COLUMN status_source TEXT');
  } catch (e) {
    if (!/duplicate column/i.test(e.message || '')) throw e;
  }

  await client.execute(`
CREATE TABLE IF NOT EXISTS ultra_purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_session_id TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);
  // 'plus' ($1) or 'ultra' ($5) -- which tier this purchase row grants.
  // Older rows predate the PLUS/ULTRA split and have no tier value; the
  // webhook treats a missing/unrecognized tier as 'plus' for backwards
  // compatibility.
  try {
    await client.execute("ALTER TABLE ultra_purchases ADD COLUMN tier TEXT NOT NULL DEFAULT 'plus'");
  } catch (e) {
    if (!/duplicate column/i.test(e.message || '')) throw e;
  }

  // Account tokens let a user log in on a second device without typing their
  // username/password again -- a long random string generated once at
  // register time (older accounts get one lazily the first time it's
  // needed). Plain ALTER TABLE ... UNIQUE isn't reliably enforced by SQLite,
  // so uniqueness is a separate partial index instead.
  try {
    await client.execute('ALTER TABLE users ADD COLUMN account_token TEXT');
  } catch (e) {
    if (!/duplicate column/i.test(e.message || '')) throw e;
  }
  await client.execute(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_account_token ON users(account_token) WHERE account_token IS NOT NULL'
  );

  // The 24h auto-delete sweep (see app.js) now applies to every free-tier
  // thread unconditionally, not just ones that had the old opt-in toggle
  // enabled. For threads that never set last_reset_at (NULL reads as "due
  // immediately" in the sweep query), start their 24h clock now instead of
  // wiping their history on the very next sweep. Only touches threads where
  // neither participant is ULTRA; safe to run on every boot since it's a
  // no-op once last_reset_at is set.
  try {
    await client.execute(`
      UPDATE dm_threads
      SET last_reset_at = datetime('now')
      WHERE last_reset_at IS NULL
        AND id IN (
          SELECT dm.id FROM dm_threads dm
          JOIN users ua ON ua.id = dm.user_a_id
          JOIN users ub ON ub.id = dm.user_b_id
          WHERE ua.is_plus = 0 AND ua.is_premium = 0 AND ua.is_ultra = 0
            AND ub.is_plus = 0 AND ub.is_premium = 0 AND ub.is_ultra = 0
        )
    `);
  } catch (e) {
    console.error('Failed to backfill last_reset_at for mandatory 24h auto-delete:', e.message);
  }

  // ---- Mega Chats -- Discord-style paid servers with channels ----
  // $1 to create (50c with MK ULTRA), unlimited members, added by username.
  // Flat permissions: the owner can create channels, add/remove members,
  // and delete the whole server; every other member is equal.
  await client.execute(`
CREATE TABLE IF NOT EXISTS servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  icon_color TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

  // A small Mega Chat (under 10 members) gets a 7-day auto-delete sweep,
  // same last_reset_at mechanism as dm_threads/group_chats -- see
  // sweepAutoResetServers in app.js. Added after servers already existed in
  // production, so ALTER TABLE (not CREATE TABLE IF NOT EXISTS) is needed.
  try {
    await client.execute('ALTER TABLE servers ADD COLUMN last_reset_at TEXT');
  } catch (e) {
    if (!/duplicate column/i.test(e.message || '')) throw e;
  }

  await client.execute(`
CREATE TABLE IF NOT EXISTS server_members (
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (server_id, user_id)
)`);

  await client.execute(`
CREATE TABLE IF NOT EXISTS server_channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

  await client.execute(`
CREATE TABLE IF NOT EXISTS server_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER NOT NULL REFERENCES server_channels(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  image_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

  await client.execute(`
CREATE TABLE IF NOT EXISTS mega_chat_purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_session_id TEXT UNIQUE NOT NULL,
  pending_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

  await client.execute('CREATE INDEX IF NOT EXISTS idx_server_members_user ON server_members(user_id)');
  await client.execute('CREATE INDEX IF NOT EXISTS idx_server_channels_server ON server_channels(server_id)');
  await client.execute('CREATE INDEX IF NOT EXISTS idx_server_messages_channel ON server_messages(channel_id)');

  // Same backfill reasoning as the dm_threads one above: a server that's
  // never had last_reset_at set reads as "due immediately" in the sweep
  // query, which would wipe every small pre-existing Mega Chat on the next
  // sweep after this migration runs. Start the 7-day clock from now
  // instead. Only matters for servers currently under the 10-member
  // threshold; safe to run on every boot since it's a no-op once set.
  try {
    await client.execute(`
      UPDATE servers
      SET last_reset_at = datetime('now')
      WHERE last_reset_at IS NULL
        AND id IN (
          SELECT s.id FROM servers s
          WHERE (SELECT COUNT(*) FROM server_members sm WHERE sm.server_id = s.id) < 10
        )
    `);
  } catch (e) {
    console.error('Failed to backfill last_reset_at for Mega Chat auto-delete:', e.message);
  }

  // ---- Mini Chats -- free group chats, capped at 15 members ----
  // No channels, no owner/roles: any member can add another member (up to
  // the cap) or leave. Same free-tier 24h auto-delete rule as DMs (permanent
  // once any member has MK ULTRA) -- see sweepAutoResetThreads in app.js,
  // which now also sweeps these.
  await client.execute(`
CREATE TABLE IF NOT EXISTS group_chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_reset_at TEXT
)`);

  await client.execute(`
CREATE TABLE IF NOT EXISTS group_chat_members (
  group_chat_id INTEGER NOT NULL REFERENCES group_chats(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (group_chat_id, user_id)
)`);

  await client.execute(`
CREATE TABLE IF NOT EXISTS group_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_chat_id INTEGER NOT NULL REFERENCES group_chats(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  image_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

  await client.execute('CREATE INDEX IF NOT EXISTS idx_group_chat_members_user ON group_chat_members(user_id)');
  await client.execute('CREATE INDEX IF NOT EXISTS idx_group_messages_group ON group_messages(group_chat_id)');

  // Lets the creator (and only the creator -- Mini Chats otherwise have no
  // roles) set a group picture. Stored as a base64 data URI in the DB, same
  // as user avatars, since Render's disk doesn't survive redeploys.
  try {
    await client.execute('ALTER TABLE group_chats ADD COLUMN created_by INTEGER REFERENCES users(id)');
  } catch (e) {
    if (!/duplicate column/i.test(e.message || '')) throw e;
  }
  try {
    await client.execute('ALTER TABLE group_chats ADD COLUMN avatar_url TEXT');
  } catch (e) {
    if (!/duplicate column/i.test(e.message || '')) throw e;
  }

  // MK PREMIUM perk: liking a message. One row per (message, liker); the
  // message_type column disambiguates ids across the three separate message
  // tables (DMs, Mega Chat channels, Mini Chats) since they don't share an
  // id space.
  await client.execute(`
CREATE TABLE IF NOT EXISTS message_likes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_type TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(message_type, message_id, user_id)
)`);
  await client.execute('CREATE INDEX IF NOT EXISTS idx_message_likes_msg ON message_likes(message_type, message_id)');

  // MK ULTRA perk: pinning a message. Same message_type + message_id
  // disambiguation pattern as message_likes above. pinned_by is who pinned
  // it (for display -- "Pinned by X"), not who can unpin (anyone with
  // ULTRA can unpin any pin in a chat they're in).
  await client.execute(`
CREATE TABLE IF NOT EXISTS pinned_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_type TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  pinned_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(message_type, message_id)
)`);
  await client.execute('CREATE INDEX IF NOT EXISTS idx_pinned_messages_msg ON pinned_messages(message_type, message_id)');

  // MK ULTRA perk: read receipts for DMs. One row per (thread, user) --
  // last_read_message_id is the highest message id that user has seen in
  // that thread. Only meaningful/shown when at least one side has ULTRA
  // (checked at query time, not enforced here).
  await client.execute(`
CREATE TABLE IF NOT EXISTS dm_read_state (
  thread_id INTEGER NOT NULL REFERENCES dm_threads(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_message_id INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (thread_id, user_id)
)`);

  // Admin role: a small set of trusted operator accounts (granted manually,
  // e.g. via scripts/grant-admin.js) with full moderation access -- listing
  // every user, granting/revoking tiers without needing Turso env vars in a
  // terminal, removing accounts, and deleting any message in any DM/Mega
  // Chat/Mini Chat. Gated server-side on every admin route (see
  // requireAdmin in auth.js), never trusted from the client alone.
  try {
    await client.execute('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');
  } catch (e) {
    if (!/duplicate column/i.test(e.message || '')) throw e;
  }

  // Free perk: emoji reactions on any message. Same message_type +
  // message_id disambiguation pattern as message_likes/pinned_messages
  // (the three message tables don't share an id space). Unlike the single
  // heart-shaped message_likes table, a user can react with several
  // different emoji on the same message, just not the same emoji twice.
  await client.execute(`
CREATE TABLE IF NOT EXISTS message_reactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_type TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(message_type, message_id, user_id, emoji)
)`);
  await client.execute('CREATE INDEX IF NOT EXISTS idx_message_reactions_msg ON message_reactions(message_type, message_id)');

  // Message editing: one nullable timestamp per message table, added after
  // the fact via ALTER TABLE (same idempotent try/catch pattern as the
  // other post-hoc columns above) since CREATE TABLE IF NOT EXISTS won't
  // touch tables that already exist in production.
  for (const table of ['messages', 'server_messages', 'group_messages']) {
    try {
      await client.execute(`ALTER TABLE ${table} ADD COLUMN edited_at TEXT`);
    } catch (e) {
      if (!/duplicate column/i.test(e.message || '')) throw e;
    }
  }

  // Default profile picture: instead of a colored circle + initials, every
  // account gets a random cable/connector illustration (see
  // client/src/components/ObjectAvatars.jsx -- the ids below must match its
  // OBJECT_AVATARS keys exactly, since only the id string is ever stored/
  // sent here, not image data). Added after the fact via ALTER TABLE like
  // the other post-hoc columns above, so every existing row starts out
  // NULL -- the UPDATE right after backfills those in one pass. The "OR
  // avatar_icon NOT IN (...)" half makes this self-healing: if the id list
  // ever changes again (like it already did once, from an earlier
  // everyday-object set to this cable set), any row still holding a
  // now-unrecognized id gets swept up and reassigned too, not just NULLs --
  // still cheap to re-run every boot since a matching row is a no-op.
  try {
    await client.execute('ALTER TABLE users ADD COLUMN avatar_icon TEXT');
  } catch (e) {
    if (!/duplicate column/i.test(e.message || '')) throw e;
  }
  await client.execute(`
UPDATE users SET avatar_icon = CASE ABS(RANDOM()) % 10
  WHEN 0 THEN 'usb-a'
  WHEN 1 THEN 'usb-c'
  WHEN 2 THEN 'firewire'
  WHEN 3 THEN 'lightning'
  WHEN 4 THEN 'micro-usb'
  WHEN 5 THEN 'hdmi'
  WHEN 6 THEN 'ethernet'
  WHEN 7 THEN 'displayport'
  WHEN 8 THEN 'aux'
  ELSE 'vga'
END
WHERE avatar_icon IS NULL
   OR avatar_icon NOT IN ('usb-a', 'usb-c', 'firewire', 'lightning', 'micro-usb', 'hdmi', 'ethernet', 'displayport', 'aux', 'vga')`);
}

export default db;
