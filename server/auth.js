import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { db } from './db.js';

// SECURITY: this used to fall back to a hardcoded string
// ('dev-secret-change-me') when JWT_SECRET wasn't set in the environment.
// That meant anyone who read this (public) source file could forge a valid
// login token for any account on a deployment that forgot to configure
// JWT_SECRET. Now, if it's missing, a fresh random secret is generated once
// per process boot instead -- still secure, just means every login token
// issued before that boot becomes invalid (everyone gets logged out) the
// next time the server restarts without JWT_SECRET set. That's a strictly
// safer failure mode than a guessable secret. Set JWT_SECRET as a real env
// var on Render (Settings > Environment) to avoid the logout-on-restart
// side effect -- a long random string, e.g. `openssl rand -hex 32`.
const JWT_SECRET = process.env.JWT_SECRET || (() => {
  console.warn(
    '[auth] WARNING: JWT_SECRET is not set. Using a random secret generated ' +
    'for this process only -- all logged-in users will be signed out the ' +
    'next time the server restarts. Set JWT_SECRET in your environment to fix this.'
  );
  return crypto.randomBytes(32).toString('hex');
})();

export function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function verifySocketToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

// Must run after requireAuth (needs req.user.id). The JWT itself only ever
// carries id/username -- admin status is looked up fresh from the DB on
// every request, the same pattern used elsewhere for tier checks (e.g.
// message:like's MK PREMIUM check), so a revoked admin loses access
// immediately rather than whenever their 30-day token happens to expire.
export async function requireAdmin(req, res, next) {
  try {
    const row = await db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.user.id);
    if (!row?.is_admin) return res.status(403).json({ error: 'Admin access required' });
    next();
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
}

// ---- Lightweight in-memory rate limiting for login/register/token-login ----
// Deliberately not a full library (no new dependency to install) -- a
// sliding window per IP+route is more than enough to stop naive brute-force
// scripts against a small app like this. Resets naturally as old entries
// age out; nothing persists across a restart, which is fine for this use
// case (a restart is a rare enough event that losing rate-limit history
// isn't a real risk).
const attempts = new Map(); // key -> array of timestamps (ms)

export function rateLimit({ windowMs = 60_000, max = 8 } = {}) {
  return (req, res, next) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
    const key = `${req.baseUrl}${req.path}:${ip}`;
    const now = Date.now();
    const recent = (attempts.get(key) || []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      const retryAfterSec = Math.ceil((windowMs - (now - recent[0])) / 1000);
      res.set('Retry-After', String(retryAfterSec));
      return res.status(429).json({ error: 'Too many attempts. Please wait and try again.' });
    }
    recent.push(now);
    attempts.set(key, recent);
    next();
  };
}

// Sweep stale entries every 10 minutes so the Map doesn't grow forever on a
// long-running server.
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamps] of attempts) {
    const recent = timestamps.filter((t) => now - t < 10 * 60_000);
    if (recent.length === 0) attempts.delete(key);
    else attempts.set(key, recent);
  }
}, 10 * 60_000).unref();
