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
const { Workspaces, kindOf } = require('./workspaces');
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
const wsm = new Workspaces(DATA, plants, log);
let saveT = null;
function writeSettings() {
  try { fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 1)); } catch (e) { log('Could not save settings: ' + e.message); }
}
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    try {
      wsm.save(rt.project);
      Object.assign(settings, { ws: rt.project.ws, scanMs: rt.scanMs });
      writeSettings();
    } catch (e) { log('Save failed: ' + e.message); }
  }, 300);
}

const access = new Access(settings.access, s => { settings.access = s; writeSettings(); });
const auth = new Auth(DATA, log, access);
const rt = new Runtime(plants);
rt.scanMs = settings.scanMs;
{
  const first = settings.ws || settings.scen || 'tank';
  try { const r0 = rt.load(wsm.load(wsm.valid(first) ? first : 'tank')); if (r0.ok) rt.setMode('RUN'); } catch (e) { log('Could not load workspace ' + first + ': ' + e.message); rt.load(wsm.fresh('tank')); }
}
function switchTo(ws, user) {
  if (!wsm.valid(ws)) return { ok: false, msg: 'Unknown workspace' };
  try { wsm.save(rt.project); } catch (e) { log('Save failed: ' + e.message); }
  const r = rt.load(wsm.load(ws, user));
  if (r.ok) rt.setMode('RUN');          // like a PLC powering up with its key switch in RUN
  save();
  return Object.assign({ ok: true, compiled: r.ok, ws }, r.ok ? {} : { msg: r.msg });
}
const inChallenge = () => !!(rt.project.challenge && !rt.project.challenge.done);
/* In a work order the I/O list is part physical installation, part PLC configuration.
   Physical changes (wiring, contact type, mounting position, switch setpoints, adding/removing devices) need a lockout;
   PLC-side configuration (tag names, descriptions, signal format/scaling, transmitter range) can be changed online;
   simulation properties (noise, injected faults) are locked. Returns a reason string when the change is not allowed. */
const PHYSICAL = { type: 'sensor type', signal: 'what the sensor is wired to', contact: 'contact wiring (NO/NC)', pos: 'mounting position', op: 'switch action', sp: 'switch setpoint', hyst: 'switch differential' };
function fieldChange(prev, next) {
  const P = Object.fromEntries(prev.map(x => [x.id, x])), N = Object.fromEntries(next.map(x => [x.id, x]));
  const lock = !!rt.loto;
  for (const x of next) {
    const o = P[x.id];
    if (!o) { if (!lock) return 'Installing a new field device is physical work — lock out the machine first (Mission → Lockout).'; continue; }
    for (const k of ['noise', 'fault']) if (String(o[k] ?? '') !== String(x[k] ?? '')) return `'${k}' is a property of the simulation and is locked during a work order.`;
    if (!lock) for (const k in PHYSICAL) if (String(o[k] ?? '') !== String(x[k] ?? '')) return `${o.tag}: changing the ${PHYSICAL[k]} is field work — lock out the machine first (Mission → Lockout). Tag name, scaling and range can be changed online.`;
  }
  if (!lock) for (const o of prev) if (!N[o.id]) return 'Removing a field device is physical work — lock out the machine first (Mission → Lockout).';
  return null;
}

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
function wsTitle() {
  const m = wsm.mission(rt.project, '-');
  return m.kind === 'lesson' ? `Lesson ${m.index} · ${m.title}` : m.kind === 'challenge' ? `${m.id} · ${m.title}` : m.name;
}
function projectInfo() {
  const d = rt.def;
  return {
    version: pkg.version,
    scen: rt.project.scen,
    ws: rt.project.ws, kind: kindOf(rt.project.ws), wsName: wsTitle(), tabs: wsm.lessonTabs(rt.project.ws),
    project: Object.assign({}, rt.project, { challenge: undefined }),
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
  'POST /api/scenario': 'engineer', 'POST /api/workspace': 'engineer', 'POST /api/sandbox/new': 'engineer', 'POST /api/lang': 'engineer', 'POST /api/sandbox/delete': 'engineer',
  'POST /api/sandbox/rename': 'engineer', 'PUT /api/layout': 'engineer', 'POST /api/grade': 'engineer', 'POST /api/hint': 'engineer', 'POST /api/solution': 'engineer',
  'POST /api/challenge/replace': 'engineer', 'POST /api/challenge/loto': 'engineer', 'POST /api/challenge/submit': 'engineer', 'POST /api/progress/reset': 'engineer', 'POST /api/reset-project': 'engineer', 'POST /api/import': 'engineer', 'GET /api/export': 'engineer',
  'GET /api/users': 'admin', 'GET /api/settings': 'admin', 'PUT /api/settings': 'admin', 'POST /api/users': 'admin', 'POST /api/users/delete': 'admin',
};
const PUBLIC = new Set(['/login.html', '/js/login.js', '/setup.html', '/js/setup.js', '/js/theme.js', '/css/app.css', '/healthz', '/api/login', '/api/setup']);
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
    if (inChallenge() && rt.plc === 'RUN' && b.cold) return { ok: false, line: 0, online: true, msg: 'A full (cold) download needs the PLC in STOP (program mode). In a live plant that stops production — STOP the PLC first if you really need it.' };
    const r = rt.download(cleanUnits(b), b.cold ? false : true, false, { online: inChallenge() && rt.plc === 'RUN' });
    if (r.ok && inChallenge() && rt.plc === 'RUN') rt.log('PLC', 'Online edit accepted');
    if (r.ok) { rt.log('PLC', b.cold ? 'Program downloaded (cold start: memory reset)' : 'Program downloaded (warm: values kept)'); delete rt.project.draft; save(); }
    return r;
  },
  'PUT /api/source': b => { rt.project.draft = cleanUnits(b); save(); return { ok: true }; },
  'POST /api/mode': b => {
    const was = rt.plc, r = rt.setMode(b.mode === 'RUN' ? 'RUN' : 'STOP');
    if (inChallenge() && was === 'RUN' && rt.plc === 'STOP') { rt.project.challenge.stops = (rt.project.challenge.stops || 0) + 1; rt.log('MAINT', 'PLC stopped — production is down'); save(); }
    return r;
  },
  'POST /api/scan': b => { rt.scanMs = Math.min(500, Math.max(10, +b.ms || 50)); startLoop(); save(); return { ok: true }; },
  'POST /api/write': b => ({ ok: rt.write(b.tag, b.value) }),
  'POST /api/force': b => ({ ok: rt.force(b.tag, b.value === undefined ? null : b.value) }),
  'POST /api/panel': b => { if (b.key in rt.panel) rt.panel[b.key] = !!b.value; return { ok: true }; },
  'POST /api/plant': (b, me) => {
    if (b.fault && !auth.can(me, 'engineer')) return { ok: false, msg: 'Fault injection needs the engineer role' };
    if (b.fault && inChallenge()) return { ok: false, msg: 'Fault injection is disabled during a challenge' };
    const st = rt.st;
    if (b.fault) { st.faults[b.fault] = !!b.value; rt.log('SIM', `Process fault ${b.value ? 'ON' : 'off'}: ${b.fault}`); }
    else if (b.action && inChallenge() && /^(reset|slug)$/.test(b.action)) return { ok: false, msg: 'Not available on a real plant during a work order' };
    else if (b.action && inChallenge() && b.action === 'clear' && !rt.loto) return { ok: false, msg: 'Clearing a jam means reaching into the machine — lock it out first (LOTO).' };
    else if (b.action && rt.def.doAction) { rt.def.doAction(st, b.action, b.value, rt); rt.log('SIM', `Plant: ${b.action}${b.value !== undefined ? ' = ' + b.value : ''}`); }
    return { ok: true };
  },
  'PUT /api/sensors': b => {
    const next = Array.isArray(b.sensors) ? b.sensors : [];
    if (inChallenge()) { const why = fieldChange(rt.project.sensors, next); if (why) return { ok: false, msg: why }; }
    const prev = JSON.parse(JSON.stringify(rt.project.sensors)), wasRun = rt.plc === 'RUN';
    const r = rt.setSensors(next);
    if (!r.ok && inChallenge()) {      // a running plant refuses an edit that would break the program
      rt.setSensors(prev); if (wasRun) rt.setMode('RUN');
      return { ok: false, msg: `Change refused: the program would no longer compile (${r.msg}). Online edits that break the running program are rejected.` };
    }
    save(); return r;
  },
  'PUT /api/actfaults': b => {
    if (inChallenge()) return { ok: false, msg: 'Fault injection is disabled during a challenge' }; rt.project.actFaults = b.actFaults || {}; rt.log('SIM', 'Actuator faults updated'); rt.projVer++; save(); return { ok: true }; },
  'PUT /api/sensorfault': b => {
    const s = rt.project.sensors.find(x => x.id === b.id);
    if (!s) return { ok: false };
    if (inChallenge()) return { ok: false, msg: 'Fault injection is disabled during a challenge' };
    s.fault = b.fault || 'none'; rt.log('SIM', `Sensor fault on ${s.tag}: ${s.fault}`); save(); return { ok: true };
  },
  'PUT /api/hmitheme': b => { rt.project.hmiTheme = b.theme === 'dark' ? 'dark' : 'hp'; rt.projVer++; save(); return { ok: true }; },
  'PUT /api/hmi': b => { rt.project.hmi = b.hmi || []; rt.projVer++; save(); return { ok: true }; },
  'PUT /api/alarms': b => { rt.project.alarms = b.alarms || []; rt.alm = {}; rt.almVer++; rt.projVer++; save(); return { ok: true }; },
  'PUT /api/pens': b => { rt.project.pens = b.pens || []; save(); return { ok: true }; },
  'POST /api/ack': b => { rt.ack(b.id || 'all'); return { ok: true }; },
  'POST /api/scenario': (b, me) => switchTo(String(b.id || ''), me.username),
  'POST /api/workspace': (b, me) => switchTo(String(b.id || ''), me.username),
  'GET /api/workspaces': (b, me) => Object.assign({ ok: true, current: rt.project.ws }, wsm.list(me.username)),
  'GET /api/mission': (b, me) => Object.assign({ ok: true }, wsm.mission(rt.project, me.username)),
  'GET /api/catalog': () => Object.assign({ ok: true }, require('./plants/sandbox').catalog()),
  'POST /api/sandbox/new': (b, me) => { const ws = wsm.newSandbox(b.name, b.template, b.lang || wsm.lang(me.username)); return switchTo(ws, me.username); },
  'POST /api/lang': (b, me) => {
    const lang = b.lang === 'LD' ? 'LD' : 'ST';
    if (kindOf(rt.project.ws) !== 'lesson' || !b.lesson) { wsm.setDefaultLang(me.username, lang); return { ok: true, lang }; }
    const units = wsm.setLessonLang(rt.project, me.username, lang);
    delete rt.project.draft;
    const r = rt.download(unitsOf(units), false);
    Object.assign(rt.project, unitsOf(units)); rt.projVer++;
    rt.log('LEARN', `Lesson switched to ${lang === 'LD' ? 'Ladder Diagram' : 'Structured Text'}`);
    save(); return Object.assign({ lang }, r);
  },
  'POST /api/sandbox/delete': b => {
    const id = String(b.id || '');
    if (id === rt.project.ws) switchTo('tank');
    return { ok: wsm.deleteSandbox(id) };
  },
  'POST /api/sandbox/rename': b => {
    const name = String(b.name || '').trim().slice(0, 48);
    if (!name) return { ok: false, msg: 'Name required' };
    if (b.id === rt.project.ws) { rt.project.name = name; rt.projVer++; save(); return { ok: true }; }
    if (kindOf(String(b.id)) !== 'sandbox' || !wsm.valid(b.id)) return { ok: false, msg: 'Unknown machine' };
    const p = wsm.load(b.id); p.name = name; wsm.save(p); return { ok: true };
  },
  'PUT /api/layout': b => {
    if (kindOf(rt.project.ws) !== 'sandbox') return { ok: false, msg: 'Only your own machines (sandbox) can be rebuilt' };
    const r = rt.setLayout(b.layout || {});
    if (Array.isArray(b.addSensorsFor) && b.addSensorsFor.length) {
      const have = new Set(rt.project.sensors.map(s => s.tag.toUpperCase())), add = [];
      for (const c of rt.project.layout.components) if (b.addSensorsFor.includes(c.id)) for (const s of rt.def.suggest(c)) {
        if (have.has(s.tag.toUpperCase())) continue;
        have.add(s.tag.toUpperCase()); add.push(Object.assign({ id: 's' + Date.now().toString(36) + add.length }, s));
      }
      if (add.length) Object.assign(r, rt.setSensors(rt.project.sensors.concat(add)), { added: add.map(s => s.tag) });
    }
    save(); return r;
  },
  'POST /api/grade': (b, me) => {
    if (kindOf(rt.project.ws) !== 'lesson') return { ok: false, msg: 'Not a lesson' };
    if (!rt.program) return { ok: false, msg: 'Download a program that compiles first' };
    const r = wsm.gradeLesson(rt.project, me.username);
    rt.log('LEARN', `Check: ${r.passed}/${r.total} objectives passed`);
    save(); return r;
  },
  'POST /api/hint': () => { const r = wsm.hint(rt.project); save(); return r; },
  'POST /api/solution': () => { const r = wsm.solution(rt.project); save(); return r; },
  'POST /api/challenge/loto': b => {
    const c = rt.project.challenge; if (!c || c.done) return { ok: false, msg: 'No active work order' };
    c.loto = !!b.on; rt.loto = c.loto;
    rt.log('MAINT', c.loto ? 'Machine locked out and tagged — all outputs de-energised' : 'Lock removed — machine returned to service');
    rt.projVer++; save(); return { ok: true, loto: c.loto };
  },
  'POST /api/challenge/replace': b => {
    const r = wsm.replace(rt.project, b.what);
    if (r.ok) { rt.hidden = rt.project.challenge.hidden; rt.log('MAINT', `Replaced ${String(b.what).replace(/^s:/, 'sensor ').replace(/^a:/, 'actuator ')}`); }
    save(); return { ok: r.ok, msg: r.msg };
  },
  'POST /api/challenge/submit': (b, me) => {
    if (kindOf(rt.project.ws) !== 'challenge') return { ok: false, msg: 'Not a challenge' };
    if (!rt.program) return { ok: false, msg: 'The PLC has no valid program' };
    if (rt.project.challenge.loto) return { ok: false, msg: 'Remove your lock first — hand the machine back to production before closing the work order.' };
    if (Object.keys(rt.forces).length) return { ok: false, msg: `Remove all forces first (${Object.keys(rt.forces).length} active). Never hand a plant back with I/O forced.` };
    if (rt.plc !== 'RUN') return { ok: false, msg: 'Put the PLC back in RUN before closing the work order.' };
    const r = wsm.submit(rt.project, me.username, String(b.cause || ''));
    rt.log('MAINT', r.pass ? `Work order closed — score ${r.score}` : 'Work order rejected: the fault is still there');
    save(); return r;
  },
  'POST /api/progress/reset': (b, me) => { wsm.resetProgress(me.username); return { ok: true }; },
  'POST /api/reset-project': b => {
    const d = wsm.fresh(rt.project.ws, { lang: kindOf(rt.project.ws) === 'lesson' ? (rt.project.mission || {}).lang : (rt.project.pous[0] || {}).lang, name: rt.project.name });
    const keep = b.part && b.part !== 'all' ? b.part : null;
    if (keep === 'src') { delete rt.project.draft; rt.download(unitsOf(d), false); Object.assign(rt.project, unitsOf(d)); rt.projVer++; }
    else if (keep) { rt.project[keep] = d[keep]; if (keep === 'sensors') rt.setSensors(d.sensors); rt.projVer++; }
    else { const r = rt.load(d); if (r.ok) rt.setMode('RUN'); }
    save(); return { ok: true };
  },
  'POST /api/plant-reset': () => {
    if (inChallenge()) return { ok: false, msg: 'Not available on a real plant during a work order' }; const f = rt.st.faults; rt.st = rt.def.create(); rt.st.faults = f; rt.log('SIM', 'Plant reset'); return { ok: true }; },
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
    if (!p || !(plants[p.scen] || p.scen === 'sandbox')) return { ok: false, msg: 'Not a PLCFACTORY project file' };
    let ws = p.ws || p.scen;
    if (p.scen === 'sandbox' && kindOf(ws) !== 'sandbox') ws = wsm.newSandbox(p.name || 'Imported machine');
    if (kindOf(ws) === 'challenge') return { ok: false, msg: 'Challenge workspaces cannot be imported' };
    p.ws = ws; delete p.challenge;
    wsm.save(p);
    return switchTo(ws);
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
      if (['/setup.html', '/js/setup.js', '/js/theme.js', '/css/app.css', '/healthz'].includes(url.pathname)) { /* serve below */ }
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
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="plcfactory-${rt.project.ws}.json"` });
      return res.end(JSON.stringify(Object.assign({}, rt.project, { challenge: undefined }), null, 1));
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

const shutdown = () => { try { wsm.save(rt.project); } catch {} process.exit(0); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
