'use strict';
/*
 * PLCFACTORY server — zero dependencies.
 * Runs the soft PLC + plant simulation continuously and serves the web
 * engineering station / HMI. State is pushed to browsers with Server-Sent Events.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Runtime, ANALOG_FAULTS, DISCRETE_FAULTS, ACT_FAULTS } = require('./engine/runtime');
const C = require('./engine/compiler');
const plants = require('./plants');
const modbus = require('./modbus');
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

function defaultProject(id) { return Object.assign({ scen: id, actFaults: {} }, plants[id].defaults()); }
function loadProject(id) {
  const p = readJson(projFile(id), null);
  if (!p) return defaultProject(id);
  const d = defaultProject(id);
  for (const k of ['src', 'sensors', 'hmi', 'alarms', 'pens', 'actFaults']) if (p[k] === undefined) p[k] = d[k];
  p.scen = id;
  return p;
}
let saveT = null;
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    try {
      fs.writeFileSync(projFile(rt.project.scen), JSON.stringify(rt.project, null, 1));
      fs.writeFileSync(settingsFile, JSON.stringify({ scen: rt.project.scen, scanMs: rt.scanMs }));
    } catch (e) { log('Save failed: ' + e.message); }
  }, 300);
}

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
const mb = process.env.MODBUS === 'off' ? null : modbus.start(rt, MODBUS_PORT, log);

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
    loadedSrc: rt.loadedSrc,
    hasProgram: !!rt.program,
    scanMs: rt.scanMs,
    plant: { id: d.id, name: d.name, blurb: d.blurb, actuators: d.actuators, faults: d.faults, actions: d.actions, valves: d.valves || null },
    catalog: rt.signalCatalog(),
    tags: rt.tagMeta(),
    modbus: mb ? { port: MODBUS_PORT, map: mb.describe() } : null,
    projVer: rt.projVer, tagVer: rt.tagVer,
  };
}
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
  'POST /api/check': b => {
    const tags = {}; for (const k in rt.io) tags[k] = Object.assign({}, rt.io[k]);
    try { const r = C.compile(String(b.src || ''), tags); return { ok: true, vars: r.declared.length }; }
    catch (e) { return { ok: false, line: e.line || 0, msg: e.message }; }
  },
  'POST /api/download': b => {
    const r = rt.download(String(b.src || ''), b.cold ? false : true);
    if (r.ok) { rt.log('PLC', b.cold ? 'Program downloaded (cold start: memory reset)' : 'Program downloaded (warm: values kept)'); save(); }
    return r;
  },
  'PUT /api/source': b => { rt.project.draft = String(b.src || ''); save(); return { ok: true }; },
  'POST /api/mode': b => rt.setMode(b.mode === 'RUN' ? 'RUN' : 'STOP'),
  'POST /api/scan': b => { rt.scanMs = Math.min(500, Math.max(10, +b.ms || 50)); startLoop(); save(); return { ok: true }; },
  'POST /api/write': b => ({ ok: rt.write(b.tag, b.value) }),
  'POST /api/force': b => ({ ok: rt.force(b.tag, b.value === undefined ? null : b.value) }),
  'POST /api/panel': b => { if (b.key in rt.panel) rt.panel[b.key] = !!b.value; return { ok: true }; },
  'POST /api/plant': b => {
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
    if (keep) { rt.project[keep] = d[keep]; if (keep === 'sensors') rt.setSensors(d.sensors); else if (keep === 'src') rt.download(d.src, false); rt.projVer++; }
    else rt.load(d);
    save(); return { ok: true };
  },
  'POST /api/plant-reset': () => { const f = rt.st.faults; rt.st = rt.def.create(); rt.st.faults = f; rt.log('SIM', 'Plant reset'); return { ok: true }; },
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
  try {
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
    if (key === 'GET /healthz') return send(res, 200, { ok: true, plc: rt.plc });
    if (routes[key]) {
      const b = req.method === 'GET' ? {} : await body(req);
      return send(res, 200, routes[key](b) || { ok: true });
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
