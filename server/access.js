'use strict';
/*
 * External-access settings (reverse proxy, public URL, cookies, allowed hosts, sessions, Modbus exposure).
 * Saved in DATA_DIR/settings.json under "access". Environment variables, when set, override and lock a field.
 */
const net = require('net');

const DEFAULTS = {
  publicUrl: '',            // e.g. https://plc.example.com
  trustProxy: false,        // honour X-Forwarded-For / -Proto / -Host …
  trustedProxies: 'private',// … but only from these peers ("private" = LAN ranges, or a list of IPs/CIDRs)
  cookieSecure: 'auto',     // auto | always | never
  allowedHosts: '',         // comma list of hostnames; empty = any. IP addresses and localhost are always allowed
  sessionDays: 7,
  modbusEnabled: true,
  modbusWrite: true,
  modbusAllow: 'private',   // "private", "any", or a list of IPs/CIDRs
};

const bool = v => /^(1|true|yes|on)$/i.test(String(v));
const ENV = {
  publicUrl: () => process.env.PUBLIC_URL,
  trustProxy: () => process.env.TRUST_PROXY !== undefined ? bool(process.env.TRUST_PROXY) : undefined,
  trustedProxies: () => process.env.TRUSTED_PROXIES,
  cookieSecure: () => process.env.COOKIE_SECURE !== undefined ? (bool(process.env.COOKIE_SECURE) ? 'always' : /^(0|false|no|off)$/i.test(process.env.COOKIE_SECURE) ? 'never' : 'auto') : undefined,
  allowedHosts: () => process.env.ALLOWED_HOSTS,
  sessionDays: () => process.env.SESSION_DAYS !== undefined ? +process.env.SESSION_DAYS : undefined,
  modbusEnabled: () => process.env.MODBUS !== undefined ? !/^(0|false|no|off)$/i.test(process.env.MODBUS) : undefined,
  modbusWrite: () => process.env.MODBUS_WRITE !== undefined ? bool(process.env.MODBUS_WRITE) : undefined,
  modbusAllow: () => process.env.MODBUS_ALLOW,
};

// ---------- IP helpers ----------
function v4(ip) { const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip); return m ? ((+m[1] << 24) | (+m[2] << 16) | (+m[3] << 8) | +m[4]) >>> 0 : null; }
const norm = ip => String(ip || '').trim().replace(/^::ffff:/i, '').replace(/^\[|\]$/g, '').toLowerCase();
function isPrivate(ip) {
  ip = norm(ip);
  return ip === '::1' || /^127\./.test(ip) || /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    /^169\.254\./.test(ip) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip) || /^f[cd][0-9a-f]{2}:/.test(ip) || /^fe[89ab][0-9a-f]:/.test(ip);
}
function inList(ip, list) {
  ip = norm(ip);
  const s = String(list || '').trim().toLowerCase();
  if (!s) return false;
  if (s === 'any' || s === '*') return true;
  for (const raw of s.split(/[\s,]+/).filter(Boolean)) {
    if (raw === 'private') { if (isPrivate(ip)) return true; continue; }
    const [base, bits] = raw.split('/');
    if (net.isIPv4(base) && net.isIPv4(ip)) {
      const n = bits === undefined ? 32 : +bits, mask = n === 0 ? 0 : (~0 << (32 - n)) >>> 0;
      if (((v4(ip) & mask) >>> 0) === ((v4(base) & mask) >>> 0)) return true;
    } else if (norm(base) === ip) return true;
  }
  return false;
}
function validList(s) {
  for (const raw of String(s || '').trim().toLowerCase().split(/[\s,]+/).filter(Boolean)) {
    if (raw === 'private' || raw === 'any' || raw === '*') continue;
    const [base, bits] = raw.split('/');
    if (!net.isIP(norm(base))) return `'${raw}' is not an IP address or CIDR range`;
    if (bits !== undefined && !(net.isIPv4(base) && /^\d+$/.test(bits) && +bits <= 32)) return `'${raw}' has an invalid prefix length`;
  }
  return null;
}

class Access {
  constructor(saved, onSave) {
    this.saved = Object.assign({}, DEFAULTS, saved || {});
    this.onSave = onSave;
    this.compute();
  }
  compute() {
    const c = Object.assign({}, this.saved), locked = {};
    for (const k in ENV) { const v = ENV[k](); if (v !== undefined && v !== '' && !(typeof v === 'number' && !Number.isFinite(v))) { c[k] = v; locked[k] = true; } }
    this.cfg = c; this.locked = locked;
  }
  get(k) { return this.cfg[k]; }
  view() { return { settings: this.cfg, locked: this.locked, defaults: DEFAULTS }; }
  update(b) {
    const s = Object.assign({}, this.saved);
    const errs = [];
    if ('publicUrl' in b) {
      const u = String(b.publicUrl || '').trim().replace(/\/+$/, '');
      if (u && !/^https?:\/\/[^\s/?#]+(:\d+)?$/i.test(u)) errs.push('Public URL must look like https://plc.example.com (no path)');
      s.publicUrl = u;
    }
    if ('trustProxy' in b) s.trustProxy = !!b.trustProxy;
    if ('trustedProxies' in b) { const e = validList(b.trustedProxies); if (e) errs.push('Trusted proxies: ' + e); s.trustedProxies = String(b.trustedProxies || '').trim() || 'private'; }
    if ('cookieSecure' in b) s.cookieSecure = ['auto', 'always', 'never'].includes(b.cookieSecure) ? b.cookieSecure : 'auto';
    if ('allowedHosts' in b) {
      const h = String(b.allowedHosts || '').split(/[\s,]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
      for (const x of h) if (!/^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(x)) errs.push(`Allowed hosts: '${x}' is not a hostname`);
      s.allowedHosts = h.join(', ');
    }
    if ('sessionDays' in b) { const d = Math.round(+b.sessionDays); if (!(d >= 1 && d <= 365)) errs.push('Session lifetime must be 1–365 days'); s.sessionDays = d; }
    if ('modbusEnabled' in b) s.modbusEnabled = !!b.modbusEnabled;
    if ('modbusWrite' in b) s.modbusWrite = !!b.modbusWrite;
    if ('modbusAllow' in b) { const e = validList(b.modbusAllow); if (e) errs.push('Modbus clients: ' + e); s.modbusAllow = String(b.modbusAllow || '').trim() || 'private'; }
    if (errs.length) return { ok: false, msg: errs.join(' · ') };
    this.saved = s; this.compute(); this.onSave(s);
    return { ok: true };
  }

  // ---------- request helpers ----------
  peer(req) { return norm(req.socket.remoteAddress); }
  proxyTrusted(req) { return !!this.cfg.trustProxy && inList(this.peer(req), this.cfg.trustedProxies); }
  clientIp(req) {
    if (this.proxyTrusted(req)) {
      const cf = req.headers['cf-connecting-ip'];
      if (cf) return norm(cf);
      const xff = req.headers['x-forwarded-for'];
      if (xff) { const hops = String(xff).split(',').map(norm).filter(Boolean); if (hops.length) return hops[0]; }
      if (req.headers['x-real-ip']) return norm(req.headers['x-real-ip']);
    }
    return this.peer(req);
  }
  isHttps(req) {
    const m = this.cfg.cookieSecure;
    if (m === 'always') return true;
    if (m === 'never') return false;
    if (req.socket.encrypted) return true;
    if (this.proxyTrusted(req) && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase() === 'https') return true;
    return false;
  }
  host(req) {
    let h = req.headers.host || '';
    if (this.proxyTrusted(req) && req.headers['x-forwarded-host']) h = String(req.headers['x-forwarded-host']).split(',')[0].trim();
    return h.toLowerCase();
  }
  hostAllowed(req) {
    const list = String(this.cfg.allowedHosts || '').split(/[\s,]+/).filter(Boolean);
    if (!list.length) return true;
    const h = this.host(req).replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    if (!h || h === 'localhost' || net.isIP(h)) return true;          // never lock yourself out of the LAN address
    const pub = this.cfg.publicUrl ? new URL(this.cfg.publicUrl).hostname.toLowerCase() : null;
    return h === pub || list.some(x => x === h || (x.startsWith('*.') && h.endsWith(x.slice(1))));
  }
  sameOrigin(req) {
    const o = req.headers.origin;
    if (!o) return true;
    let oh;
    try { oh = new URL(o).host.toLowerCase(); } catch { return false; }
    if (oh === String(req.headers.host || '').toLowerCase() || oh === this.host(req)) return true;
    if (this.cfg.publicUrl) { try { if (oh === new URL(this.cfg.publicUrl).host.toLowerCase()) return true; } catch {} }
    return false;
  }
  isLocal(req) {
    const proxied = !!(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.headers['forwarded'] || req.headers['cf-connecting-ip']);
    if (proxied && !this.proxyTrusted(req)) return false;
    return isPrivate(this.clientIp(req));
  }
  diag(req) {
    const H = k => req.headers[k] || null;
    return {
      peer: this.peer(req), clientIp: this.clientIp(req), proxyTrusted: this.proxyTrusted(req), https: this.isHttps(req),
      host: this.host(req), hostAllowed: this.hostAllowed(req), local: this.isLocal(req),
      headers: { host: H('host'), 'x-forwarded-for': H('x-forwarded-for'), 'x-forwarded-proto': H('x-forwarded-proto'), 'x-forwarded-host': H('x-forwarded-host'),
        'x-real-ip': H('x-real-ip'), 'cf-connecting-ip': H('cf-connecting-ip'), forwarded: H('forwarded') },
    };
  }
}

module.exports = { Access, inList, isPrivate, DEFAULTS };
