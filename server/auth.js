'use strict';
/*
 * PLCFACTORY authentication — no dependencies.
 * - users in DATA_DIR/users.json, passwords hashed with scrypt (random salt per user)
 * - random session tokens in an HttpOnly, SameSite=Strict cookie; only a SHA-256 of
 *   each token is stored (DATA_DIR/sessions.json) so sessions survive restarts
 * - login throttling per client IP and per username
 * Roles (each includes the ones below it): admin > engineer > operator > viewer
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROLES = ['viewer', 'operator', 'engineer', 'admin'];
const rank = r => ROLES.indexOf(r);
const COOKIE = 'plcf_session';
const SESSION_DAYS = +process.env.SESSION_DAYS || 7;
const MAX_FAILS_USER = 5, MAX_FAILS_IP = 20, LOCK_MS = 15 * 60 * 1000;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(pw), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$${salt.toString('base64')}$${h.toString('base64')}`;
}
function verifyPassword(pw, stored) {
  try {
    const [alg, N, salt, hash] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const exp = Buffer.from(hash, 'base64');
    const got = crypto.scryptSync(String(pw), Buffer.from(salt, 'base64'), exp.length, { N: +N, r: 8, p: 1 });
    return crypto.timingSafeEqual(exp, got);
  } catch { return false; }
}
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const validName = u => /^[A-Za-z0-9_.-]{2,32}$/.test(u || '');
const pwProblem = pw => (typeof pw !== 'string' || pw.length < 10) ? 'Password must be at least 10 characters' : pw.length > 200 ? 'Password too long' : null;

class Auth {
  constructor(dataDir, log) {
    this.log = log;
    this.usersFile = path.join(dataDir, 'users.json');
    this.sessFile = path.join(dataDir, 'sessions.json');
    this.enabled = String(process.env.AUTH || 'on').toLowerCase() !== 'off';
    this.trustProxy = /^(1|true|yes)$/i.test(process.env.TRUST_PROXY || '');
    this.users = this.read(this.usersFile, []);
    this.sessions = new Map(Object.entries(this.read(this.sessFile, {})));
    this.fails = new Map();
    this.bootstrap();
    setInterval(() => this.prune(), 60 * 60 * 1000).unref();
  }
  read(f, d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } }
  maybeReload() {   // pick up changes made with auth-cli.js while running
    try { const m = fs.statSync(this.usersFile).mtimeMs; if (this._m && m !== this._m) this.users = this.read(this.usersFile, this.users); this._m = m; } catch {}
  }
  saveUsers() { fs.writeFileSync(this.usersFile, JSON.stringify(this.users, null, 1), { mode: 0o600 }); try { this._m = fs.statSync(this.usersFile).mtimeMs; } catch {} }
  saveSessions() { try { fs.writeFileSync(this.sessFile, JSON.stringify(Object.fromEntries(this.sessions)), { mode: 0o600 }); } catch (e) { this.log('Could not save sessions: ' + e.message); } }
  prune() { const now = Date.now(); let ch = false; for (const [k, s] of this.sessions) if (s.exp < now) { this.sessions.delete(k); ch = true; } if (ch) this.saveSessions(); }

  bootstrap() {
    if (!this.enabled) { this.log('WARNING: AUTH=off — anyone who can reach this server has full control. Use only on a private LAN.'); return; }
    if (this.users.length) return;
    const name = validName(process.env.ADMIN_USER) ? process.env.ADMIN_USER : 'admin';
    let pw = process.env.ADMIN_PASSWORD;
    let generated = false;
    if (!pw || pwProblem(pw)) { pw = crypto.randomBytes(12).toString('base64url'); generated = true; }
    this.users.push({ username: name, hash: hashPassword(pw), role: 'admin', created: new Date().toISOString(), mustChange: generated });
    this.saveUsers();
    if (generated) this.log(`\n============================================================\n  First start: created admin user '${name}'\n  Temporary password: ${pw}\n  Log in and change it (menu ⋯ → Change password).\n============================================================`);
    else this.log(`First start: created admin user '${name}' from ADMIN_USER/ADMIN_PASSWORD.`);
  }

  clientIp(req) {
    if (this.trustProxy && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
    return req.socket.remoteAddress || '?';
  }
  isHttps(req) { return !!req.socket.encrypted || (this.trustProxy && String(req.headers['x-forwarded-proto'] || '').startsWith('https')) || /^(1|true|yes)$/i.test(process.env.COOKIE_SECURE || ''); }
  cookieToken(req) {
    const c = req.headers.cookie || '';
    const m = c.split(/;\s*/).find(x => x.startsWith(COOKIE + '='));
    return m ? decodeURIComponent(m.slice(COOKIE.length + 1)) : null;
  }
  setCookie(req, res, token, maxAgeS) {
    const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeS}`];
    if (this.isHttps(req)) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
  }

  /** Returns {username, role} or null. */
  user(req) {
    if (!this.enabled) return { username: 'local', role: 'admin', noAuth: true };
    const t = this.cookieToken(req);
    if (!t) return null;
    this.maybeReload();
    const s = this.sessions.get(sha(t));
    if (!s || s.exp < Date.now()) return null;
    const u = this.users.find(x => x.username === s.username);
    if (!u) return null;
    // sliding expiry (refresh at most once an hour)
    if (s.exp - Date.now() < (SESSION_DAYS * 864e5 - 36e5)) { s.exp = Date.now() + SESSION_DAYS * 864e5; this.saveSessions(); }
    return { username: u.username, role: u.role, mustChange: !!u.mustChange };
  }
  can(user, minRole) { return !!user && rank(user.role) >= rank(minRole); }

  throttleKey(req, username) { return [this.clientIp(req), 'u:' + String(username || '').toLowerCase()]; }
  locked(keys) {
    const now = Date.now();
    for (const k of keys) { const f = this.fails.get(k); if (f && f.until > now) return Math.ceil((f.until - now) / 60000); }
    return 0;
  }
  fail(keys) {
    for (const k of keys) {
      const f = this.fails.get(k) || { n: 0, until: 0 };
      f.n++; if (f.n >= (k.startsWith('u:') ? MAX_FAILS_USER : MAX_FAILS_IP)) { f.until = Date.now() + LOCK_MS; f.n = 0; }
      this.fails.set(k, f);
    }
  }

  login(req, res, b) {
    const keys = this.throttleKey(req, b.username);
    this.maybeReload();
    const mins = this.locked(keys);
    if (mins) return { status: 429, body: { ok: false, msg: `Too many failed attempts. Try again in ${mins} min.` } };
    const u = this.users.find(x => x.username.toLowerCase() === String(b.username || '').toLowerCase());
    // always run scrypt so timing doesn't reveal whether the user exists
    const ok = verifyPassword(b.password || '', u ? u.hash : 'scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86));
    if (!u || !ok) {
      this.fail(keys);
      this.log(`Login failed for '${String(b.username || '').slice(0, 40)}' from ${this.clientIp(req)}`);
      return { status: 401, body: { ok: false, msg: 'Wrong username or password' } };
    }
    for (const k of keys) this.fails.delete(k);
    const token = crypto.randomBytes(32).toString('base64url');
    this.sessions.set(sha(token), { username: u.username, exp: Date.now() + SESSION_DAYS * 864e5, created: Date.now(), ip: this.clientIp(req) });
    this.saveSessions();
    this.setCookie(req, res, token, SESSION_DAYS * 86400);
    this.log(`Login: ${u.username} (${u.role}) from ${this.clientIp(req)}`);
    return { status: 200, body: { ok: true, username: u.username, role: u.role, mustChange: !!u.mustChange } };
  }
  logout(req, res) {
    const t = this.cookieToken(req);
    if (t) { this.sessions.delete(sha(t)); this.saveSessions(); }
    this.setCookie(req, res, '', 0);
    return { ok: true };
  }
  dropSessions(username, exceptToken) {
    const keep = exceptToken ? sha(exceptToken) : null;
    for (const [k, s] of this.sessions) if (s.username === username && k !== keep) this.sessions.delete(k);
    this.saveSessions();
  }
  changePassword(req, me, b) {
    const u = this.users.find(x => x.username === me.username);
    if (!u || !verifyPassword(b.old || '', u.hash)) return { ok: false, msg: 'Current password is wrong' };
    const p = pwProblem(b.new); if (p) return { ok: false, msg: p };
    u.hash = hashPassword(b.new); u.mustChange = false; this.saveUsers();
    this.dropSessions(u.username, this.cookieToken(req));          // sign out other devices
    this.log(`Password changed: ${u.username}`);
    return { ok: true };
  }
  // ---- admin ----
  list() { return this.users.map(u => ({ username: u.username, role: u.role, created: u.created, mustChange: !!u.mustChange })); }
  upsert(me, b) {
    const name = String(b.username || '');
    if (!validName(name)) return { ok: false, msg: 'Username: 2–32 letters, digits, . _ -' };
    if (!ROLES.includes(b.role)) return { ok: false, msg: 'Unknown role' };
    let u = this.users.find(x => x.username.toLowerCase() === name.toLowerCase());
    if (!u) {
      const p = pwProblem(b.password); if (p) return { ok: false, msg: p };
      u = { username: name, hash: hashPassword(b.password), role: b.role, created: new Date().toISOString(), mustChange: true };
      this.users.push(u);
      this.log(`User added: ${name} (${b.role}) by ${me.username}`);
    } else {
      if (u.role === 'admin' && b.role !== 'admin' && this.users.filter(x => x.role === 'admin').length === 1) return { ok: false, msg: 'There must be at least one admin' };
      u.role = b.role;
      if (b.password) { const p = pwProblem(b.password); if (p) return { ok: false, msg: p }; u.hash = hashPassword(b.password); u.mustChange = true; this.dropSessions(u.username); }
      this.log(`User updated: ${u.username} (${u.role}) by ${me.username}`);
    }
    this.saveUsers();
    return { ok: true };
  }
  remove(me, b) {
    const u = this.users.find(x => x.username === b.username);
    if (!u) return { ok: false, msg: 'No such user' };
    if (u.username === me.username) return { ok: false, msg: "You can't delete yourself" };
    if (u.role === 'admin' && this.users.filter(x => x.role === 'admin').length === 1) return { ok: false, msg: 'There must be at least one admin' };
    this.users = this.users.filter(x => x !== u); this.saveUsers(); this.dropSessions(u.username);
    this.log(`User deleted: ${u.username} by ${me.username}`);
    return { ok: true };
  }
  resetPassword(username, pw) {
    const u = this.users.find(x => x.username === username);
    if (!u) return 'No such user';
    const p = pwProblem(pw); if (p) return p;
    u.hash = hashPassword(pw); u.mustChange = true; this.saveUsers(); this.dropSessions(username);
    return null;
  }
}

module.exports = { Auth, ROLES, hashPassword, verifyPassword };
