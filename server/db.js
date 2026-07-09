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
}

export default db;
