// auth.js — users, password hashing and token sessions.
//
// The web UI gets an httpOnly cookie; the Android app gets the same kind of
// token back from /api/auth/login and sends it as "Authorization: Bearer".
// Tokens are stored hashed, so a leaked database/backup can't be used to log in.

import crypto from 'crypto';
import { Router } from 'express';
import { getDb } from './db.js';
import { config } from './config.js';

export const COOKIE_NAME = 'mylib_token';
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60 * 1000;

// ── Password hashing (scrypt, built into Node) ───────────────────────────────
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function createToken(userId, { name = null, kind = 'session' } = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  getDb()
    .prepare('INSERT INTO tokens (user_id, token_hash, name, kind) VALUES (?, ?, ?, ?)')
    .run(userId, sha256(token), name, kind);
  return token;
}

function userForToken(token) {
  if (!token) return null;
  const db = getDb();
  const row = db
    .prepare(`SELECT t.id AS token_id, t.last_used_at, u.id, u.username, u.is_admin
              FROM tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?`)
    .get(sha256(token));
  if (!row) return null;
  // Only write last_used_at about once an hour to avoid a write on every request.
  const last = row.last_used_at ? Date.parse(row.last_used_at + 'Z') : 0;
  if (Date.now() - last > 60 * 60 * 1000) {
    db.prepare("UPDATE tokens SET last_used_at = datetime('now') WHERE id = ?").run(row.token_id);
  }
  return { id: row.id, username: row.username, is_admin: !!row.is_admin, token_id: row.token_id };
}

function tokenFromRequest(req) {
  const header = req.get('authorization') || '';
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  return req.cookies?.[COOKIE_NAME] || null;
}

const userCount = () => getDb().prepare('SELECT COUNT(*) AS n FROM users').get().n;

// ── Middleware ───────────────────────────────────────────────────────────────
export function requireAuth(req, res, next) {
  if (config.authDisabled) {
    req.user = { id: 0, username: 'local', is_admin: true };
    return next();
  }
  const user = userForToken(tokenFromRequest(req));
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  req.user = user;
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user?.is_admin) return res.status(403).json({ error: 'Admin only' });
  next();
}

// ── Simple login rate limiting (per IP, in memory) ───────────────────────────
const attempts = new Map();
function tooManyAttempts(ip) {
  const now = Date.now();
  const entry = attempts.get(ip) || { count: 0, first: now };
  if (now - entry.first > 15 * 60 * 1000) {
    entry.count = 0;
    entry.first = now;
  }
  attempts.set(ip, entry);
  return entry.count >= 10;
}
const recordFailure = (ip) => {
  const entry = attempts.get(ip);
  if (entry) entry.count++;
};

function setCookie(req, res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  });
}

function validateCredentials(username, password) {
  if (!username || !/^[\w.@-]{2,40}$/.test(username)) {
    return 'Username must be 2-40 characters (letters, numbers, . _ @ -)';
  }
  if (!password || password.length < 6) return 'Password must be at least 6 characters';
  return null;
}

// ── Routes: /api/auth ────────────────────────────────────────────────────────
export const authRouter = Router();

authRouter.get('/status', (req, res) => {
  if (config.authDisabled) {
    return res.json({ setupRequired: false, authDisabled: true, user: { username: 'local', is_admin: true } });
  }
  const user = userForToken(tokenFromRequest(req));
  res.json({
    setupRequired: userCount() === 0,
    authDisabled: false,
    user: user ? { id: user.id, username: user.username, is_admin: user.is_admin } : null,
  });
});

// First run: create the admin account. Only works while there are no users.
authRouter.post('/setup', (req, res) => {
  if (userCount() > 0) return res.status(400).json({ error: 'Setup already completed' });
  const { username, password } = req.body || {};
  const problem = validateCredentials(username, password);
  if (problem) return res.status(400).json({ error: problem });
  const info = getDb()
    .prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)')
    .run(username.trim(), hashPassword(password));
  const token = createToken(info.lastInsertRowid, { name: 'Web browser' });
  setCookie(req, res, token);
  res.json({ user: { id: Number(info.lastInsertRowid), username: username.trim(), is_admin: true } });
});

// Body: { username, password, device? }. When "device" is given (Android app)
// the token is returned in the response body instead of only as a cookie.
authRouter.post('/login', (req, res) => {
  const ip = req.ip;
  if (tooManyAttempts(ip)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  const { username, password, device } = req.body || {};
  const user = getDb().prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim());
  if (!user || !verifyPassword(String(password || ''), user.password_hash)) {
    recordFailure(ip);
    return res.status(401).json({ error: 'Wrong username or password' });
  }
  attempts.delete(ip);
  const token = createToken(user.id, {
    name: device ? String(device).slice(0, 80) : (req.get('user-agent') || 'Web browser').slice(0, 80),
    kind: device ? 'device' : 'session',
  });
  setCookie(req, res, token);
  const body = { user: { id: user.id, username: user.username, is_admin: !!user.is_admin } };
  if (device) body.token = token;
  res.json(body);
});

authRouter.post('/logout', (req, res) => {
  const token = tokenFromRequest(req);
  if (token) getDb().prepare('DELETE FROM tokens WHERE token_hash = ?').run(sha256(token));
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

// Everything below needs a logged-in user.
authRouter.use(requireAuth);

authRouter.put('/password', (req, res) => {
  const { current, password } = req.body || {};
  const user = getDb().prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user || !verifyPassword(String(current || ''), user.password_hash)) {
    return res.status(400).json({ error: 'Current password is wrong' });
  }
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  getDb().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), user.id);
  res.json({ ok: true });
});

// Logged-in browsers and phones for the current user
authRouter.get('/sessions', (req, res) => {
  const rows = getDb()
    .prepare('SELECT id, name, kind, created_at, last_used_at FROM tokens WHERE user_id = ? ORDER BY created_at DESC')
    .all(req.user.id);
  res.json({ sessions: rows.map((r) => ({ ...r, current: r.id === req.user.token_id })) });
});

authRouter.delete('/sessions/:id', (req, res) => {
  getDb().prepare('DELETE FROM tokens WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// ── Routes: /api/users (admin) ───────────────────────────────────────────────
export const usersRouter = Router();
usersRouter.use(requireAuth, requireAdmin);

usersRouter.get('/', (_req, res) => {
  const users = getDb().prepare('SELECT id, username, is_admin, created_at FROM users ORDER BY id').all();
  res.json({ users: users.map((u) => ({ ...u, is_admin: !!u.is_admin })) });
});

usersRouter.post('/', (req, res) => {
  const { username, password, is_admin } = req.body || {};
  const problem = validateCredentials(username, password);
  if (problem) return res.status(400).json({ error: problem });
  try {
    const info = getDb()
      .prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)')
      .run(username.trim(), hashPassword(password), is_admin ? 1 : 0);
    res.json({ id: Number(info.lastInsertRowid) });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return res.status(400).json({ error: 'That username is taken' });
    throw err;
  }
});

usersRouter.put('/:id', (req, res) => {
  const { password, is_admin } = req.body || {};
  const db = getDb();
  const id = Number(req.params.id);
  if (password != null) {
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), id);
  }
  if (is_admin != null) {
    if (!is_admin && id === req.user.id) return res.status(400).json({ error: "You can't remove your own admin rights" });
    db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(is_admin ? 1 : 0, id);
  }
  res.json({ ok: true });
});

usersRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: "You can't delete yourself" });
  getDb().prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
});
