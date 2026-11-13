'use strict';
/*
 * PLCFACTORY runtime: scan cycle, configurable sensor layer, actuator layer,
 * forces, alarms, events and trend history. One instance runs in the server.
 */
const C = require('./compiler');
const LD = require('./ladder');
const { truthy, num, coerce, defVal, ELEM } = C;

const PANEL_SIGNALS = {
  pb_start: { label: 'Operator panel: START pushbutton pressed', kind: 'bool' },
  pb_stop: { label: 'Operator panel: STOP pushbutton pressed', kind: 'bool' },
  estop: { label: 'Operator panel: E-STOP tripped', kind: 'bool' },
};

const ANALOG_FAULTS = ['none', 'stuck', 'drift', 'noisy', 'fail_low', 'fail_high', 'wire_break'];
const DISCRETE_FAULTS = ['none', 'stuck_off', 'stuck_on', 'wire_break'];
const ACT_FAULTS = ['none', 'stuck_off', 'stuck_on'];

const HIST_MAX = 1200;     // 120 s at 10 Hz
const HIST_EVERY = 100;    // ms

function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

class Runtime {
  constructor(plants) {
    this.plants = plants;          // { id: plantDef }
    this.plc = 'STOP';
    this.fault = '';
    this.scanMs = 50;
    this.scanTime = 0;
    this.scanCount = 0;
    this.firstScan = false;
    this.tags = {};
    this.io = {};
    this.program = null;
    this.loaded = '';
    this.leaves = []; this.leafMap = {}; this.fbs = []; this.fbMap = {};
    this.forces = {};
    this.panel = { pb_start: false, pb_stop: false, estop: false };
    this.alm = {};
    this.events = [];
    this.evVer = 0;
    this.almVer = 0;
    this.tagVer = 0;
    this.projVer = 0;
    this.hist = { t: [], v: {} };
    this.histAcc = 0;
    this.sensorRt = {};
    this.onChange = () => {};
  }

  // ---------- project / scenario ----------
  load(project) {
    const def = this.plants[project.scen];
    if (!def) throw new Error('Unknown scenario ' + project.scen);
    this.def = def;
    this.project = project;
    this.st = def.create();
    this.plc = 'STOP'; this.fault = '';
    this.forces = {};
    this.alm = {}; this.sensorRt = {};
    this.hist = { t: [], v: {} };
    this.buildIo();
    normalizeProject(project);
    const r = this.download(unitsOf(project), false);
    this.log('SYS', `Loaded scenario: ${def.name}${r.ok ? '' : ' (program has errors — fix and download)'}`);
    this.projVer++;
    return r;
  }

  signalCatalog() {
    const sig = {};
    for (const k in PANEL_SIGNALS) sig[k] = PANEL_SIGNALS[k];
    Object.assign(sig, this.def.signals);
    return { signals: sig, probes: this.def.probes || {} };
  }

  buildIo() {
    const io = {};
    const add = (name, type, kind, desc, extra) => {
      const K = name.toUpperCase();
      io[K] = Object.assign({ name, type, base: ELEM[type], kind, desc, v: defVal(ELEM[type]) }, extra || {});
    };
    for (const s of this.project.sensors) {
      if (!s.tag || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(s.tag)) continue;
      let type = 'BOOL', kind = 'DI';
      if (s.type === 'analog') { kind = 'AI'; type = s.scale === 'raw' ? 'INT' : 'REAL'; }
      add(s.tag, type, kind, s.desc || this.sensorDesc(s), { sensor: s.id });
    }
    for (const [name, type, kind, desc] of this.def.actuators) add(name, type, kind, desc);
    add('FirstScan', 'BOOL', 'SYS', 'TRUE during the first scan after the PLC enters RUN');
    io.FIRSTSCAN.kind = 'SYS';
    add('ScanCount', 'DINT', 'SYS', 'Number of scans since RUN');
    io.SCANCOUNT.kind = 'SYS';
    // keep previous values where possible
    for (const K in io) if (this.io[K] && this.io[K].base === io[K].base) io[K].v = this.io[K].v;
    this.io = io;
  }

  sensorDesc(s) {
    const cat = this.signalCatalog();
    const lab = (cat.signals[s.signal] || cat.probes[s.signal] || { label: s.signal }).label;
    switch (s.type) {
      case 'analog': return `${lab} (${s.lo}–${s.hi}${(cat.signals[s.signal] || {}).unit ? ' ' + cat.signals[s.signal].unit : ''}${s.scale === 'mA' ? ', as 4–20 mA' : s.scale === 'raw' ? ', raw 0–27648' : ''})`;
      case 'switch': return `${lab} ${s.op} ${s.sp} (${s.contact})`;
      case 'probe': return `${lab} at ${s.pos} mm (${s.contact})`;
      default: return `${lab} (${s.contact})`;
    }
  }

  setSensors(sensors) {
    this.project.sensors = sensors;
    this.sensorRt = {};
    this.buildIo();
    const r = this.download(unitsOf(this.project), true);
    this.log('SYS', 'I/O configuration changed' + (r.ok ? '' : ' — program no longer compiles, PLC stopped'));
    if (!r.ok && this.plc === 'RUN') this.setMode('STOP');
    this.projVer++;
    return r;
  }

  // ---------- program ----------
  /** units = { types, globals, pous:[{id,name,lang,src|rungs}] } */
  download(units, warm = true, dry = false) {
    units = canonUnits(units);
    const tags = {};
    for (const k in this.io) tags[k] = this.io[k];
    const st = [{ name: 'Data types', kind: 'types', src: units.types || '' }, { name: 'Globals', kind: 'globals', src: units.globals || '' }];
    const maps = {};
    let cur = null;
    try {
      (units.pous || []).forEach((p, i) => {
        cur = p.name;
        if (p.lang === 'LD') { const g = LD.toST(p, i + 1); maps[p.name] = g.map; st.push({ name: p.name, id: p.id, lang: 'LD', src: g.src }); }
        else st.push({ name: p.name, id: p.id, lang: 'ST', src: p.src || '' });
      });
    } catch (e) {
      if (e instanceof LD.LdError) return { ok: false, unit: cur, rung: e.rung, line: 0, msg: `Rung ${e.rung}: ${e.message}` };
      throw e;
    }
    const names = new Set();
    for (const p of units.pous || []) {
      if (!/^[A-Za-z_][A-Za-z0-9_ ]{0,31}$/.test(p.name || '')) return { ok: false, unit: p.name, line: 0, msg: `Program name '${p.name}' must start with a letter (letters, digits, spaces, _)` };
      if (names.has(p.name.toUpperCase())) return { ok: false, unit: p.name, line: 0, msg: `Two programs are called '${p.name}'` };
      names.add(p.name.toUpperCase());
    }
    let res;
    try { res = C.compileUnits(st, tags); }
    catch (e) {
      if (e instanceof C.PlcError) {
        const m = maps[e.unit];
        if (m) { const rung = m[(e.line || 1) - 1] || 0; return { ok: false, unit: e.unit, rung, line: 0, msg: (rung ? `Rung ${rung}: ` : '') + e.message.replace(/_L\d+_/g, '') }; }
        return { ok: false, unit: e.unit, line: e.line, msg: e.message };
      }
      return { ok: false, line: 0, msg: String(e.message || e) };
    }
    if (dry) return { ok: true, vars: res.declared.length };
    if (warm) {
      for (const K of res.declared) {
        const n = tags[K], o = this.tags[K];
        if (!o || o.kind === 'DI' || o.kind === 'AI') continue;
        if (n.kind === 'FB' && o.kind === 'FB' && n.type === o.type) Object.assign(n.fb, o.fb);
        else if (n.kind === 'MEM' && o.kind === 'MEM') n.v = merge(n.t, n.v, o.v);
      }
    }
    this.tags = tags;
    this.types = res.types;
    this.program = res.fn;
    this.buildLeaves();
    for (const k in this.forces) if (!this.leafMap[k]) delete this.forces[k];
    this.loaded = JSON.stringify(units);
    Object.assign(this.project, { types: units.types || '', globals: units.globals || '', pous: units.pous || [] });
    delete this.project.src;
    this.tagVer++;
    return { ok: true, vars: res.declared.length };
  }

  // Flatten every variable into elementary "leaves" (Motor1.Run, Track[2].Bad …) for tags/HMI/alarms/trend/Modbus
  buildLeaves() {
    const leaves = [], fbs = [], map = {}, fbMap = {};
    const LIMIT = 6000;
    const walk = (t, name, key, get, set, kind, desc, top) => {
      if (leaves.length >= LIMIT) return;
      if (t.k === 'e') {
        const leaf = { key, name, type: t.name, base: t.b, kind, desc, get, set, top };
        leaves.push(leaf); map[key] = leaf;
      } else if (t.k === 's') {
        for (const f of t.fields) walk(f.t, `${name}.${f.name}`, `${key}.${f.N}`, () => get()[f.N], v => { get()[f.N] = v; }, kind, '', top);
      } else if (t.k === 'a') {
        for (let i = t.lo; i <= t.hi; i++) { const j = i - t.lo; walk(t.of, `${name}[${i}]`, `${key}[${i}]`, () => get()[j], v => { get()[j] = v; }, kind, '', top); }
      } else if (t.k === 'f') {
        const fb = { key, name, type: t.name, kind: 'FB', desc: C.FB_TYPES[t.name].desc, get, top };
        fbs.push(fb); fbMap[key] = fb;
      }
    };
    for (const K in this.tags) {
      const tag = this.tags[K];
      if (/^_L\d+_/.test(K)) continue;       // ladder internals
      const t = C.tagType(tag);
      walk(t, tag.name, K, tag.kind === 'FB' ? () => tag.fb : () => tag.v, v => { tag.v = v; }, tag.kind === 'FB' ? 'MEM' : tag.kind, tag.desc || '', K);
    }
    this.leaves = leaves; this.leafMap = map; this.fbs = fbs; this.fbMap = fbMap;
  }

  setMode(m) {
    if (m === 'RUN') {
      if (!this.program) return { ok: false, msg: 'No program downloaded' };
      this.plc = 'RUN'; this.fault = ''; this.firstScan = true; this.scanCount = 0;
    } else this.plc = 'STOP';
    this.log('PLC', `PLC → ${this.plc}`);
    return { ok: true };
  }

  faultPlc(msg) {
    this.plc = 'FAULT'; this.fault = msg;
    this.log('FAULT', 'PLC FAULT: ' + msg);
  }

  // ---------- sensors ----------
  sig(key) {
    if (key in this.panel) return this.panel[key];
    return this.def.sig(this.st, key);
  }

  readSensors(dt) {
    const sec = dt / 1000;
    const cat = this.def.signals;
    for (const s of this.project.sensors) {
      const tag = this.io[(s.tag || '').toUpperCase()];
      if (!tag) continue;
      const rt = this.sensorRt[s.id] || (this.sensorRt[s.id] = { state: false, drift: 0, last: null });
      const fault = s.fault || 'none';
      if (s.type === 'analog') {
        const lo = +s.lo, hi = +s.hi, span = (hi - lo) || 1;
        let v = num(this.sig(s.signal));
        const meta = cat[s.signal] || {};
        v += gauss() * span * (+s.noise || 0) / 100;
        if (fault === 'noisy') v += gauss() * span * 0.05;
        if (fault === 'drift') { rt.drift += span * 0.004 * sec; v += rt.drift; } else rt.drift = 0;
        if (fault === 'stuck') { if (rt.last === null) rt.last = v; v = rt.last; } else rt.last = v;
        const frac = (v - lo) / span;
        let out;
        if (s.scale === 'mA') {
          out = Math.min(20.5, Math.max(3.8, 4 + 16 * frac));
          if (fault === 'fail_low') out = 3.6; else if (fault === 'fail_high') out = 21.0; else if (fault === 'wire_break') out = 0;
          out = Math.round(out * 1000) / 1000;
        } else if (s.scale === 'raw') {
          out = Math.round(Math.min(32511, Math.max(-4864, 27648 * frac)));
          if (fault === 'fail_low') out = -4864; else if (fault === 'fail_high' || fault === 'wire_break') out = 32767;
        } else {
          out = Math.min(hi + span * 0.03, Math.max(lo - span * 0.03, v));
          if (fault === 'fail_low' || fault === 'wire_break') out = lo; else if (fault === 'fail_high') out = hi;
          const d = meta.dec != null ? meta.dec + 1 : 3;
          out = Math.round(out * 10 ** d) / 10 ** d;
        }
        tag.v = coerce(tag.base, out);
      } else {
        let phys;
        if (s.type === 'switch') {
          const v = num(this.sig(s.signal)), sp = +s.sp, h = Math.abs(+s.hyst || 0);
          if (s.op === '<=') { if (!rt.state && v <= sp) rt.state = true; else if (rt.state && v > sp + h) rt.state = false; }
          else { if (!rt.state && v >= sp) rt.state = true; else if (rt.state && v < sp - h) rt.state = false; }
          phys = rt.state;
        } else if (s.type === 'probe') {
          phys = !!this.def.probe(this.st, s.signal, +s.pos);
        } else {
          phys = truthy(this.sig(s.signal));
        }
        if (fault === 'stuck_off') phys = false; else if (fault === 'stuck_on') phys = true;
        let out = s.contact === 'NC' ? !phys : phys;
        if (fault === 'wire_break') out = false;
        tag.v = out;
      }
    }
  }

  applyForces() {
    for (const K in this.forces) { const l = this.leafMap[K]; if (l) l.set(coerce(l.base, this.forces[K])); }
  }

  outputs() {
    const out = {}, af = this.project.actFaults || {};
    for (const [name, type] of this.def.actuators) {
      const t = this.io[name.toUpperCase()];
      let v = t.v;
      const f = af[name];
      if (f === 'stuck_off') v = type === 'BOOL' ? false : 0;
      else if (f === 'stuck_on') v = type === 'BOOL' ? true : 100;
      out[name] = v;
    }
    return out;
  }

  // ---------- scan ----------
  scan(dt) {
    this.readSensors(dt);
    this.applyForces();
    this.io.FIRSTSCAN.v = this.plc === 'RUN' && this.firstScan;
    if (this.plc === 'RUN' && this.program) {
      C.RT.dt = dt;
      const t0 = process.hrtime.bigint();
      try { this.program(); }
      catch (e) { this.faultPlc(e instanceof C.RtError ? e.message : 'Runtime error: ' + (e.message || e)); }
      this.scanTime = Number(process.hrtime.bigint() - t0) / 1e6;
      if (this.scanTime > 200) this.faultPlc(`Watchdog: scan took ${this.scanTime.toFixed(0)} ms (limit 200 ms)`);
      this.firstScan = false;
      this.scanCount++;
      this.io.SCANCOUNT.v = this.scanCount;
    }
    if (this.plc !== 'RUN') {
      for (const [name, type] of this.def.actuators) this.io[name.toUpperCase()].v = defVal(ELEM[type]);
    }
    this.applyForces();
    this.def.step(this.st, this.outputs(), dt / 1000, this);
    this.evalAlarms();
    this.histAcc += dt;
    if (this.histAcc >= HIST_EVERY) { this.histAcc = 0; this.sample(); }
  }

  // ---------- tags ----------
  write(name, value) {
    const parse = v => (typeof v === 'string' ? (v === 'true' ? true : v === 'false' ? false : parseFloat(v)) : v);
    const K = normKey(name);
    const l = this.leafMap[K];
    if (l) {
      if (l.kind === 'SYS') return false;
      const v = coerce(l.base, parse(value));
      if (K in this.forces) this.forces[K] = v;
      l.set(v);
      return true;
    }
    const dot = K.lastIndexOf('.');                 // function block input, e.g. TempPID.KP or Loop[1].Pid.KP
    if (dot > 0) {
      const fb = this.fbMap[K.slice(0, dot)], mem = K.slice(dot + 1);
      if (!fb) return false;
      const ty = C.FB_TYPES[fb.type].in[mem];
      if (!ty) return false;
      fb.get()[mem] = coerce(ELEM[ty], parse(value));
      return true;
    }
    return false;
  }
  force(name, value) {
    const K = normKey(name), l = this.leafMap[K];
    if (!l) return false;
    if (value === null || value === undefined) { delete this.forces[K]; this.log('FORCE', `Force removed: ${l.name}`); }
    else { this.forces[K] = coerce(l.base, value); l.set(this.forces[K]); this.log('FORCE', `Forced ${l.name} = ${this.forces[K]}`); }
    return true;
  }
  leafValue(name) {
    const K = normKey(name), l = this.leafMap[K];
    if (l) return l.get();
    const dot = K.lastIndexOf('.');
    if (dot > 0) { const fb = this.fbMap[K.slice(0, dot)]; if (fb) return fb.get()[K.slice(dot + 1)]; }
    return undefined;
  }

  // ---------- alarms ----------
  evalAlarms() {
    const now = Date.now();
    for (const a of this.project.alarms) {
      const tv = this.leafValue(a.tag || '');
      let act = false;
      if (tv !== undefined && typeof tv !== 'object') {
        const v = num(tv), x = parseFloat(a.val);
        switch (a.cond) {
          case 'TRUE': act = truthy(tv); break;
          case 'FALSE': act = !truthy(tv); break;
          case '>': act = v > x; break;
          case '<': act = v < x; break;
          case '>=': act = v >= x; break;
          case '<=': act = v <= x; break;
          case '=': act = v === x; break;
          case '<>': act = v !== x; break;
        }
      }
      let r = this.alm[a.id];
      if (!r) r = this.alm[a.id] = { active: false, acked: true, t: 0 };
      if (act && !r.active) { r.active = true; r.acked = false; r.t = now; this.almVer++; this.log('ALARM', a.msg || a.tag, a.pri); }
      else if (!act && r.active) { r.active = false; r.tc = now; this.almVer++; this.log('CLEAR', a.msg || a.tag, a.pri); }
    }
  }
  ack(id) {
    for (const a of this.project.alarms) {
      if (id !== 'all' && a.id !== id) continue;
      const r = this.alm[a.id];
      if (r && !r.acked) { r.acked = true; this.log('ACK', a.msg || a.tag, a.pri); }
    }
    this.almVer++;
  }
  alarmList() {
    const out = [];
    for (const a of this.project.alarms) {
      const r = this.alm[a.id];
      if (r && (r.active || !r.acked)) out.push({ id: a.id, msg: a.msg || a.tag, pri: a.pri || 'Medium', active: r.active, acked: r.acked, t: r.t });
    }
    const pr = { High: 0, Medium: 1, Low: 2 };
    return out.sort((x, y) => (pr[x.pri] - pr[y.pri]) || (y.t - x.t));
  }

  log(type, msg, pri) {
    this.events.unshift({ t: Date.now(), type, msg, pri: pri || '' });
    if (this.events.length > 300) this.events.length = 300;
    this.evVer++;
  }

  // ---------- history ----------
  sample() {
    const h = this.hist;
    h.t.push(Date.now());
    if (h.t.length > HIST_MAX) h.t.shift();
    const n = Math.min(this.leaves.length, 800);
    for (let i = 0; i < n; i++) {
      const l = this.leaves[i];
      let a = h.v[l.key];
      if (!a) a = h.v[l.key] = [];
      a.push(num(l.get()));
      if (a.length > HIST_MAX) a.shift();
    }
    for (const K in h.v) if (!this.leafMap[K]) delete h.v[K];
  }

  // ---------- snapshots ----------
  tagValues() {
    const v = {}, fb = {};
    for (const l of this.leaves) v[l.key] = l.get();
    for (const f of this.fbs) { const st = f.get(), o = {}; for (const m in st) if (m[0] !== '_') o[m] = st[m]; fb[f.key] = o; }
    return { v, fb };
  }
  tagMeta() {
    const out = this.leaves.map(l => ({ key: l.key, name: l.name, type: l.type, kind: l.kind, desc: l.desc || '', top: l.top, sensor: (this.tags[l.top] || {}).sensor || null }));
    for (const f of this.fbs) out.push({ key: f.key, name: f.name, type: f.type, kind: 'FB', desc: f.desc || '', top: f.top });
    return out;
  }
  typeList() {
    return Object.values(this.types || {}).map(t => ({ name: t.name, kind: t.k, fields: t.k === 's' ? t.fields.map(f => ({ name: f.name, type: f.t.name })) : null, of: t.k === 'a' ? t.name : null }));
  }
  snapshot() {
    const tv = this.tagValues();
    return {
      scen: this.project.scen, plc: this.plc, fault: this.fault, scanTime: this.scanTime, scanMs: this.scanMs, scanCount: this.scanCount,
      tags: tv.v, fb: tv.fb, forces: this.forces, panel: this.panel,
      out: this.outputs(),
      plant: this.def.view(this.st), alarms: this.alarmList(),
      almVer: this.almVer, evVer: this.evVer, tagVer: this.tagVer, projVer: this.projVer, t: Date.now(),
    };
  }
}

function normKey(name) { return String(name).replace(/\s+/g, '').toUpperCase(); }
function merge(t, nv, ov) {
  if (ov === undefined || ov === null) return nv;
  if (t.k === 'e') return typeof ov === 'object' ? nv : C.coerce(t.b, ov);
  if (t.k === 's') { if (typeof ov !== 'object') return nv; for (const f of t.fields) if (f.N in ov) nv[f.N] = merge(f.t, nv[f.N], ov[f.N]); return nv; }
  if (t.k === 'a') { if (!Array.isArray(ov)) return nv; for (let i = 0; i < nv.length && i < ov.length; i++) nv[i] = merge(t.of, nv[i], ov[i]); return nv; }
  if (t.k === 'f') { if (typeof ov === 'object') Object.assign(nv, ov); return nv; }
  return nv;
}
/** Bring old single-program projects up to the multi-unit format. */
function normalizeProject(p) {
  if (!Array.isArray(p.pous)) {
    p.pous = [{ id: 'main', name: 'Main', lang: 'ST', src: p.src || '' }];
    delete p.src;
  }
  if (typeof p.types !== 'string') p.types = '';
  if (typeof p.globals !== 'string') p.globals = '';
  p.pous.forEach((q, i) => { if (!q.id) q.id = 'p' + i + Math.random().toString(36).slice(2, 6); if (!q.lang) q.lang = 'ST'; });
  return p;
}
/** Canonical shape (also mirrored in the client) so "matches the PLC" comparisons are exact. */
function canonUnits(b) {
  const str = (v, max) => String(v == null ? '' : v).slice(0, max);
  const pous = (Array.isArray(b.pous) ? b.pous : []).slice(0, 32).map((p, i) => {
    const o = { id: str(p.id || 'p' + i, 40), name: str(p.name || 'Program' + (i + 1), 32).trim(), lang: p.lang === 'LD' ? 'LD' : 'ST' };
    if (o.lang === 'LD') o.rungs = (Array.isArray(p.rungs) ? p.rungs : []).slice(0, 500).map(r => ({
      comment: str(r.comment, 300),
      rows: (Array.isArray(r.rows) ? r.rows : []).slice(0, 12).map(row => (Array.isArray(row) ? row : []).slice(0, 16).map(el => ({ t: str(el.t, 8), a: str(el.a, 120), b: str(el.b, 120), op: str(el.op, 3) }))),
      outs: (Array.isArray(r.outs) ? r.outs : []).slice(0, 12).map(el => ({ t: str(el.t, 8), a: str(el.a, 200), b: str(el.b, 120), c: str(el.c, 120) })),
    }));
    else o.src = str(p.src, 400000);
    return o;
  });
  return { types: str(b.types, 200000), globals: str(b.globals, 200000), pous };
}
function unitsOf(p) { return { types: p.types, globals: p.globals, pous: p.pous }; }

module.exports = { normalizeProject, unitsOf, canonUnits, Runtime, PANEL_SIGNALS, ANALOG_FAULTS, DISCRETE_FAULTS, ACT_FAULTS };
