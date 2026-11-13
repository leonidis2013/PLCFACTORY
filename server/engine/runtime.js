'use strict';
/*
 * PLCFACTORY runtime: scan cycle, configurable sensor layer, actuator layer,
 * forces, alarms, events and trend history. One instance runs in the server.
 */
const C = require('./compiler');
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
    this.loadedSrc = '';
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
    const r = this.download(project.src || '', false);
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
    const r = this.download(this.project.src, true);
    this.log('SYS', 'I/O configuration changed' + (r.ok ? '' : ' — program no longer compiles, PLC stopped'));
    if (!r.ok && this.plc === 'RUN') this.setMode('STOP');
    this.projVer++;
    return r;
  }

  // ---------- program ----------
  download(src, warm = true) {
    const tags = {};
    for (const k in this.io) tags[k] = this.io[k];
    let res;
    try { res = C.compile(src, tags); }
    catch (e) {
      if (e instanceof C.PlcError) return { ok: false, line: e.line, msg: e.message };
      return { ok: false, line: 0, msg: String(e.message || e) };
    }
    if (warm) {
      for (const K of res.declared) {
        const n = tags[K], o = this.tags[K];
        if (!o) continue;
        if (n.kind === 'MEM' && o.kind === 'MEM' && n.base === o.base) n.v = o.v;
        else if (n.kind === 'FB' && o.kind === 'FB' && n.type === o.type) Object.assign(n.fb, o.fb);
      }
    }
    for (const k in this.forces) if (!tags[k] || tags[k].kind === 'FB') delete this.forces[k];
    this.tags = tags;
    this.program = res.fn;
    this.loadedSrc = src;
    this.project.src = src;
    this.tagVer++;
    return { ok: true, vars: res.declared.length };
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
    for (const K in this.forces) { const t = this.tags[K]; if (t) t.v = coerce(t.base, this.forces[K]); }
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
    if (String(name).includes('.')) {          // function block input, e.g. TempPID.KP
      const [fbName, mem] = String(name).toUpperCase().split('.');
      const t = this.tags[fbName];
      if (!t || t.kind !== 'FB') return false;
      const ty = C.FB_TYPES[t.type].in[mem];
      if (!ty) return false;
      t.fb[mem] = coerce(ELEM[ty], parse(value));
      return true;
    }
    const K = String(name).toUpperCase(), t = this.tags[K];
    if (!t || t.kind === 'FB' || t.kind === 'SYS') return false;
    const v = coerce(t.base, typeof value === 'string' ? (value === 'true' ? true : value === 'false' ? false : parseFloat(value)) : value);
    if (K in this.forces) this.forces[K] = v;
    t.v = v;
    return true;
  }
  force(name, value) {
    const K = String(name).toUpperCase(), t = this.tags[K];
    if (!t || t.kind === 'FB') return false;
    if (value === null || value === undefined) { delete this.forces[K]; this.log('FORCE', `Force removed: ${t.name}`); }
    else { this.forces[K] = coerce(t.base, value); t.v = this.forces[K]; this.log('FORCE', `Forced ${t.name} = ${this.forces[K]}`); }
    return true;
  }

  // ---------- alarms ----------
  evalAlarms() {
    const now = Date.now();
    for (const a of this.project.alarms) {
      const t = this.tags[(a.tag || '').toUpperCase()];
      let act = false;
      if (t && t.kind !== 'FB') {
        const v = num(t.v), x = parseFloat(a.val);
        switch (a.cond) {
          case 'TRUE': act = truthy(t.v); break;
          case 'FALSE': act = !truthy(t.v); break;
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
    for (const K in this.tags) {
      const t = this.tags[K];
      if (t.kind === 'FB') continue;
      let a = h.v[K];
      if (!a) a = h.v[K] = [];
      a.push(num(t.v));
      if (a.length > HIST_MAX) a.shift();
    }
    for (const K in h.v) if (!this.tags[K]) delete h.v[K];
  }

  // ---------- snapshots ----------
  tagValues() {
    const v = {}, fb = {};
    for (const K in this.tags) {
      const t = this.tags[K];
      if (t.kind === 'FB') { const o = {}; for (const m in t.fb) if (m[0] !== '_') o[m] = t.fb[m]; fb[K] = o; }
      else v[K] = t.v;
    }
    return { v, fb };
  }
  tagMeta() {
    return Object.keys(this.tags).map(K => {
      const t = this.tags[K];
      return { key: K, name: t.name, type: t.type, kind: t.kind, desc: t.desc || '', sensor: t.sensor || null };
    });
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

module.exports = { Runtime, PANEL_SIGNALS, ANALOG_FAULTS, DISCRETE_FAULTS, ACT_FAULTS };
