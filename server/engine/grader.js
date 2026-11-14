'use strict';
/*
 * Auto-grader: runs a project in a private, fast-forward copy of the runtime and checks objectives.
 * Tests are functions (h) => true | string(failure message) written in the lesson/challenge files.
 */
const { Runtime } = require('./runtime');

class Fail extends Error {}

function seeded(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

class Harness {
  constructor(plants, project, hidden) {
    this.rt = new Runtime(plants);
    this.rt.log = () => {};
    const p = JSON.parse(JSON.stringify(project));
    if (hidden) p.challenge = Object.assign({}, p.challenge, { hidden: JSON.parse(JSON.stringify(hidden)) });
    const r = this.rt.load(p);
    if (!r.ok) throw new Fail(`Your program doesn't compile${r.unit ? ' (' + r.unit + ')' : ''}: ${r.msg}`);
    this.rt.setMode('RUN');
    this.t = 0;
    this.watchers = [];
  }
  // ---- time ----
  scan() {
    this.rt.scan(50); this.t += 0.05;
    if (this.rt.plc === 'FAULT') throw new Fail('The PLC faulted: ' + this.rt.fault);
    for (const w of this.watchers) w();
  }
  run(sec) { const n = Math.round(sec / 0.05); for (let i = 0; i < n; i++) this.scan(); return this; }
  /** run until fn() is true (checked every scan) or maxSec elapses; returns seconds taken or -1 */
  until(fn, maxSec) { const t0 = this.t, n = Math.round(maxSec / 0.05); for (let i = 0; i < n; i++) { if (fn()) return this.t - t0; this.scan(); } return fn() ? this.t - t0 : -1; }
  /** run sec seconds, calling fn every scan; returns false as soon as fn returns false */
  always(fn, sec) { const n = Math.round(sec / 0.05); for (let i = 0; i < n; i++) { this.scan(); if (!fn()) return false; } return true; }
  watch(fn) { this.watchers.push(fn); }
  // ---- inputs ----
  comp(name) { const c = (this.rt.def.layout ? this.rt.def.layout.components : []).find(x => x.name.toUpperCase() === String(name).toUpperCase() || x.id === name); if (!c) throw new Fail(`Component ${name} is missing from the machine`); return c; }
  press(name) { this.rt.def.doAction(this.rt.st, `ctl:${this.comp(name).id}:press`, true); return this; }
  release(name) { this.rt.def.doAction(this.rt.st, `ctl:${this.comp(name).id}:press`, false); return this; }
  tap(name, sec = 0.3) { this.press(name).run(sec); return this.release(name).run(0.2); }
  select(name, pos) { this.rt.def.doAction(this.rt.st, `ctl:${this.comp(name).id}:set`, pos); return this; }
  estop(name, on) { this.rt.def.doAction(this.rt.st, `ctl:${this.comp(name).id}:set`, on); return this; }
  pot(name, v) { this.rt.def.doAction(this.rt.st, `ctl:${this.comp(name).id}:set`, v); return this; }
  action(id, v) { this.rt.def.doAction(this.rt.st, id, v); return this; }
  ctl(name, what, v) { this.rt.def.doAction(this.rt.st, `ctl:${this.comp(name).id}:${what}`, v); return this; }
  panel(key, v) { this.rt.panel[key] = !!v; return this; }
  fault(key, v = true) { this.rt.st.faults[key] = !!v; return this; }
  sensorFault(tag, f) { const s = this.rt.project.sensors.find(x => x.tag.toUpperCase() === tag.toUpperCase()); if (!s) throw new Fail(`Sensor ${tag} is missing`); s.fault = f; return this; }
  write(tag, v) { if (!this.rt.write(tag, v)) throw new Fail(`Tag ${tag} doesn't exist in your program`); return this; }
  // ---- observations ----
  out(name) { return this.rt.outputs()[name]; }
  tag(name) { const v = this.rt.leafValue(name); if (v === undefined) throw new Fail(`Tag ${name} doesn't exist — declare it with exactly this name`); return v; }
  has(name) { return this.rt.leafValue(name) !== undefined; }
  sig(key) { return this.rt.def.sig(this.rt.st, key); }
  state(id) { return this.rt.st.c ? this.rt.st.c[this.comp(id).id] : this.rt.st; }
  plant() { return this.rt.st; }
  type(name) { const t = this.rt.tags[String(name).toUpperCase()]; return t ? t.type : null; }
}

/** objectives: [{ id, text, test(h) → true | string }] */
function grade(plants, project, objectives, opts = {}) {
  const results = [];
  const rnd = Math.random;
  try {
    for (const o of objectives) {
      Math.random = seeded(1234 + results.length * 77);
      let pass = false, msg = '';
      try {
        const h = new Harness(plants, project, opts.hidden);
        const r = o.test(h);
        pass = r === true; msg = r === true ? '' : (typeof r === 'string' ? r : 'Not met');
      } catch (e) {
        pass = false; msg = e instanceof Fail ? e.message : 'Test error: ' + (e.message || e);
      }
      results.push({ id: o.id, text: o.text, pass, msg });
    }
  } finally { Math.random = rnd; }
  return results;
}

module.exports = { grade, Harness, Fail };
