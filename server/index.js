'use strict';
/*
 * PLCFACTORY server — zero dependencies.
 * Runs the soft PLC + plant simulation continuously and serves the web
 * engineering station / HMI. State is pushed to browsers with Server-Sent Events.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Runtime, ANALOG_FAULTS, DISCRETE_FAULTS, ACT_FAULTS, normalizeProject, unitsOf, canonUnits } = require('./engine/runtime');
const C = require('./engine/compiler');
const plants = require('./plants');
const modbus = require('./modbus');
const { Auth, ROLES } = require('./auth');
const { Access } = require('./access');
const pkg = require('../package.json');

const PORT = +process.env.PORT || 8080;
const MODBUS_PORT = +process.env.MODBUS_PORT || 5020;
const DATA = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const PUB = path.join(__dirname, '..', 'public');
const log = m => console.log(new Date().toISOString(), m);

fs.mkdirSync(path.join(DATA, 'projects'), { recursive: true });
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const settingsFile = path.join(DATA, 'settings.json');
const settings = Object.assign({ scen: 'tank', scanMs: 50 }, readJson(settingsFile, {}));
const projFile = id => path.join(DATA, 'projects', id + '.json');

function defaultProject(id) { return normalizeProject(Object.assign({ scen: id, actFaults: {} }, plants[id].defaults())); }
function loadProject(id) {
  const p = readJson(projFile(id), null);
  if (!p) return defaultProject(id);
  const d = defaultProject(id);
  if (p.pous === undefined && p.src === undefined) { p.pous = d.pous; p.types = d.types; p.globals = d.globals; }
  for (const k of ['sensors', 'hmi', 'alarms', 'pens', 'actFaults']) if (p[k] === undefined) p[k] = d[k];
  normalizeProject(p);
  p.scen = id;
  return p;
}
let saveT = null;
function writeSettings() {
  try { fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 1)); } catch (e) { log('Could not save settings: ' + e.message); }
}
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    try {
      fs.writeFileSync(projFile(rt.project.scen), JSON.stringify(rt.project, null, 1));
      Object.assign(settings, { scen: rt.project.scen, scanMs: rt.scanMs });
      writeSettings();
    } catch (e) { log('Save failed: ' + e.message); }
  }, 300);
}

const access = new Access(settings.access, s => { settings.access = s; writeSettings(); });
const auth = new Auth(DATA, log, access);
const rt = new Runtime(plants);
rt.scanMs = settings.scanMs;
rt.load(loadProject(plants[settings.scen] ? settings.scen : 'tank'));

// ---------- scan loop ----------
let last = Date.now(), timer = null;
function startLoop() {
  clearInterval(timer);
  timer = setInterval(() => {
    const now = Date.now();
    const dt = Math.min(250, Math.max(1, now - last));
    last = now;
    try { rt.scan(dt); } catch (e) { rt.faultPlc('Internal error: ' + e.message); log(e.stack); }
  }, rt.scanMs);
}
startLoop();

// ---------- Modbus ----------
let mb = null;
function applyModbus() {
  const want = !!access.get('modbusEnabled');
  if (want && !mb) mb = modbus.start(rt, MODBUS_PORT, log, access);
  else if (!want && mb) { mb.stop(); mb = null; }
}
applyModbus();

// ---------- SSE ----------
const clients = new Set();
let lastEv = -1;
setInterval(() => {
  if (!clients.size) return;
  const snap = rt.snapshot();
  if (rt.evVer !== lastEv) { snap.events = rt.events.slice(0, 60); lastEv = rt.evVer; }
  const msg = `data: ${JSON.stringify(snap)}\n\n`;
  for (const res of clients) res.write(msg);
}, 50);
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 15000);

// ---------- helpers ----------
const cleanUnits = b => canonUnits(b);
function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(body);
}
function body(req) {
  return new Promise((ok, bad) => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 5e6) { bad(new Error('too large')); req.destroy(); } });
    req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { bad(e); } });
  });
}
function projectInfo() {
  const d = rt.def;
  return {
    version: pkg.version,
    scen: rt.project.scen,
    project: rt.project,
    loaded: rt.loaded,
    types: rt.typeList(),
    hasProgram: !!rt.program,
    scanMs: rt.scanMs,
    plant: { id: d.id, name: d.name, blurb: d.blurb, actuators: d.actuators, faults: d.faults, actions: d.actions, valves: d.valves || null },
    catalog: rt.signalCatalog(),
    tags: rt.tagMeta(),
    modbus: mb ? { port: MODBUS_PORT, map: mb.describe() } : null,
    projVer: rt.projVer, tagVer: rt.tagVer,
  };
}
// minimum role per API route (GET routes not listed need 'viewer')
const PERM = {
  'POST /api/write': 'operator', 'POST /api/panel': 'operator', 'POST /api/ack': 'operator', 'POST /api/plant': 'operator',
  'POST /api/plant-reset': 'operator', 'PUT /api/pens': 'operator',
  'POST /api/check': 'engineer', 'POST /api/download': 'engineer', 'PUT /api/source': 'engineer', 'POST /api/mode': 'engineer',
  'POST /api/scan': 'engineer', 'POST /api/force': 'engineer', 'PUT /api/sensors': 'engineer', 'PUT /api/actfaults': 'engineer',
  'PUT /api/sensorfault': 'engineer', 'PUT /api/hmitheme': 'engineer', 'PUT /api/hmi': 'engineer', 'PUT /api/alarms': 'engineer',
  'POST /api/scenario': 'engineer', 'POST /api/reset-project': 'engineer', 'POST /api/import': 'engineer', 'GET /api/export': 'engineer',
  'GET /api/users': 'admin', 'GET /api/settings': 'admin', 'PUT /api/settings': 'admin', 'POST /api/users': 'admin', 'POST /api/users/delete': 'admin',
};
const PUBLIC = new Set(['/login.html', '/js/login.js', '/setup.html', '/js/setup.js', '/css/app.css', '/healthz', '/api/login', '/api/setup']);
function secHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
}
const sameOrigin = req => access.sameOrigin(req);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

// ---------- routes ----------
const routes = {
  'GET /api/meta': () => ({
    version: pkg.version,
    scenarios: Object.values(plants).map(p => ({ id: p.id, name: p.name, blurb: p.blurb })),
    fbTypes: Object.fromEntries(Object.entries(C.FB_TYPES).map(([k, v]) => [k, { in: v.in, out: v.out, desc: v.desc }])),
    analogFaults: ANALOG_FAULTS, discreteFaults: DISCRETE_FAULTS, actFaults: ACT_FAULTS,
  }),
  'GET /api/project': () => projectInfo(),
  'GET /api/history': () => rt.hist,
  'GET /api/events': () => rt.events,
  'POST /api/check': b => rt.download(cleanUnits(b), true, true),
  'POST /api/download': b => {
    const r = rt.download(cleanUnits(b), b.cold ? false : true);
    if (r.ok) { rt.log('PLC', b.cold ? 'Program downloaded (cold start: memory reset)' : 'Program downloaded (warm: values kept)'); delete rt.project.draft; save(); }
    return r;
  },
  'PUT /api/source': b => { rt.project.draft = cleanUnits(b); save(); return { ok: true }; },
  'POST /api/mode': b => rt.setMode(b.mode === 'RUN' ? 'RUN' : 'STOP'),
  'POST /api/scan': b => { rt.scanMs = Math.min(500, Math.max(10, +b.ms || 50)); startLoop(); save(); return { ok: true }; },
  'POST /api/write': b => ({ ok: rt.write(b.tag, b.value) }),
  'POST /api/force': b => ({ ok: rt.force(b.tag, b.value === undefined ? null : b.value) }),
  'POST /api/panel': b => { if (b.key in rt.panel) rt.panel[b.key] = !!b.value; return { ok: true }; },
  'POST /api/plant': (b, me) => {
    if (b.fault && !auth.can(me, 'engineer')) return { ok: false, msg: 'Fault injection needs the engineer role' };
    const st = rt.st;
    if (b.fault) { st.faults[b.fault] = !!b.value; rt.log('SIM', `Process fault ${b.value ? 'ON' : 'off'}: ${b.fault}`); }
    else if (b.action && rt.def.doAction) { rt.def.doAction(st, b.action, b.value, rt); rt.log('SIM', `Plant: ${b.action}${b.value !== undefined ? ' = ' + b.value : ''}`); }
    return { ok: true };
  },
  'PUT /api/sensors': b => { const r = rt.setSensors(Array.isArray(b.sensors) ? b.sensors : []); save(); return r; },
  'PUT /api/actfaults': b => { rt.project.actFaults = b.actFaults || {}; rt.log('SIM', 'Actuator faults updated'); rt.projVer++; save(); return { ok: true }; },
  'PUT /api/sensorfault': b => {
    const s = rt.project.sensors.find(x => x.id === b.id);
    if (!s) return { ok: false };
    s.fault = b.fault || 'none'; rt.log('SIM', `Sensor fault on ${s.tag}: ${s.fault}`); save(); return { ok: true };
  },
  'PUT /api/hmitheme': b => { rt.project.hmiTheme = b.theme === 'dark' ? 'dark' : 'hp'; rt.projVer++; save(); return { ok: true }; },
  'PUT /api/hmi': b => { rt.project.hmi = b.hmi || []; rt.projVer++; save(); return { ok: true }; },
  'PUT /api/alarms': b => { rt.project.alarms = b.alarms || []; rt.alm = {}; rt.almVer++; rt.projVer++; save(); return { ok: true }; },
  'PUT /api/pens': b => { rt.project.pens = b.pens || []; save(); return { ok: true }; },
  'POST /api/ack': b => { rt.ack(b.id || 'all'); return { ok: true }; },
  'POST /api/scenario': b => {
    if (!plants[b.id]) return { ok: false, msg: 'unknown scenario' };
    fs.writeFileSync(projFile(rt.project.scen), JSON.stringify(rt.project, null, 1));
    const r = rt.load(loadProject(b.id)); save(); return r;
  },
  'POST /api/reset-project': b => {
    const d = defaultProject(rt.project.scen);
    const keep = b.part && b.part !== 'all' ? b.part : null;
    if (keep === 'src') { delete rt.project.draft; rt.download(unitsOf(d), false); rt.projVer++; }
    else if (keep) { rt.project[keep] = d[keep]; if (keep === 'sensors') rt.setSensors(d.sensors); rt.projVer++; }
    else rt.load(d);
    save(); return { ok: true };
  },
  'POST /api/plant-reset': () => { const f = rt.st.faults; rt.st = rt.def.create(); rt.st.faults = f; rt.log('SIM', 'Plant reset'); return { ok: true }; },
  'GET /api/me': (b, me) => ({ ok: true, username: me.username, role: me.role, mustChange: !!me.mustChange, noAuth: !!me.noAuth, roles: ROLES }),
  'GET /api/users': () => ({ ok: true, users: auth.list() }),
  'GET /api/settings': (b, me, req) => Object.assign({ ok: true, diag: access.diag(req), modbus: { running: !!mb, port: MODBUS_PORT, clients: mb ? mb.clients() : 0 }, version: pkg.version }, access.view()),
  'PUT /api/settings': (b, me) => {
    const r = access.update(b || {});
    if (r.ok) { applyModbus(); log(`Settings changed by ${me.username}: ${Object.keys(b || {}).join(', ')}`); rt.log('SYS', `External access settings changed by ${me.username}`); }
    return r;
  },
  'POST /api/users': (b, me) => auth.upsert(me, b),
  'POST /api/users/delete': (b, me) => auth.remove(me, b),
  'POST /api/import': b => {
    const p = b.project;
    if (!p || !plants[p.scen]) return { ok: false, msg: 'Not a PLCFACTORY project file' };
    fs.writeFileSync(projFile(p.scen), JSON.stringify(p, null, 1));
    const r = rt.load(loadProject(p.scen)); save(); return r;
  },
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const key = `${req.method} ${url.pathname}`;
  secHeaders(res);
  try {
    if (url.pathname !== '/healthz' && !access.hostAllowed(req)) return send(res, 421, { ok: false, msg: `Host '${access.host(req)}' is not in the allowed hosts list (Settings → External access)` });
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      // CSRF defence: same-origin JSON only (plus SameSite=Strict cookies)
      if (!sameOrigin(req) || !String(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 403, { ok: false, msg: 'Cross-site request refused' });
    }
    if (key === 'POST /api/login') {
      if (!auth.enabled) return send(res, 200, { ok: true });
      const r = auth.login(req, res, await body(req));
      return send(res, r.status, r.body);
    }
    if (key === 'POST /api/logout') return send(res, 200, auth.logout(req, res));
    // ---- first-run setup ----
    if (key === 'GET /api/setup') return send(res, 200, auth.setupInfo(req));
    if (key === 'POST /api/setup') { const r = auth.setup(req, res, await body(req)); return send(res, r.status, r.body); }
    if (auth.setupMode) {
      if (url.pathname === '/setup.html' || url.pathname === '/js/setup.js' || url.pathname === '/css/app.css' || url.pathname === '/healthz') { /* serve below */ }
      else if (url.pathname.startsWith('/api/')) return send(res, 503, { ok: false, setup: true, msg: 'First-run setup is not finished' });
      else { res.writeHead(302, { Location: '/setup.html' }); return res.end(); }
    } else if (url.pathname === '/setup.html') { res.writeHead(302, { Location: '/' }); return res.end(); }
    const me = auth.user(req);
    if (!me && !PUBLIC.has(url.pathname)) {
      if (url.pathname.startsWith('/api/')) return send(res, 401, { ok: false, msg: 'Not logged in' });
      res.writeHead(302, { Location: '/login.html' + (url.pathname === '/' ? '' : '?next=' + encodeURIComponent(url.pathname)) });
      return res.end();
    }
    if (me && url.pathname === '/login.html' && !me.noAuth) { res.writeHead(302, { Location: '/' }); return res.end(); }
    if (key === 'POST /api/password') {
      if (me.noAuth) return send(res, 200, { ok: false, msg: 'Authentication is turned off (AUTH=off)' });
      return send(res, 200, auth.changePassword(req, me, await body(req)));
    }
    if (url.pathname.startsWith('/api/') && key !== 'GET /api/me') {
      if (me.mustChange && req.method !== 'GET') return send(res, 403, { ok: false, msg: 'Change your password first' });
      const need = PERM[key] || (req.method === 'GET' ? 'viewer' : 'admin');
      if (!auth.can(me, need)) return send(res, 403, { ok: false, msg: `Your role (${me.role}) can't do that — needs ${need}` });
    }
    if (key === 'GET /api/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 2000\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (key === 'GET /api/export') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="plcfactory-${rt.project.scen}.json"` });
      return res.end(JSON.stringify(rt.project, null, 1));
    }
    if (key === 'GET /healthz') return send(res, 200, { ok: true });
    if (routes[key]) {
      const b = req.method === 'GET' ? {} : await body(req);
      const out = routes[key](b, me, req) || { ok: true };
      return send(res, 200, out);
    }
    if (req.method !== 'GET') return send(res, 404, { ok: false, msg: 'not found' });
    let p = decodeURIComponent(url.pathname);
    if (p === '/') p = '/index.html';
    const f = path.normalize(path.join(PUB, p));
    if (!f.startsWith(PUB)) return send(res, 403, { ok: false });
    fs.readFile(f, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  } catch (e) {
    send(res, 400, { ok: false, msg: e.message });
  }
});
server.listen(PORT, () => log(`PLCFACTORY ${pkg.version} on http://0.0.0.0:${PORT}  (data: ${DATA})`));

const shutdown = () => { try { fs.writeFileSync(projFile(rt.project.scen), JSON.stringify(rt.project, null, 1)); } catch {} process.exit(0); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
