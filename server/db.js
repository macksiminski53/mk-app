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

  await client.execute(`
CREATE TABLE IF NOT EXISTS ultra_purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_session_id TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

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
          WHERE ua.is_ultra = 0 AND ub.is_ultra = 0
        )
    `);
  } catch (e) {
    console.error('Failed to backfill last_reset_at for mandatory 24h auto-delete:', e.message);
  }
}

export default db;
