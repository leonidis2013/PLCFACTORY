'use strict';
/*
 * PLCFACTORY — IEC 61131-3 Structured Text compiler (subset)
 * Compiles ST source into JavaScript closures bound directly to tag objects.
 *
 * Supported: VAR blocks, BOOL/INT/DINT/REAL/LREAL/TIME (+ integer aliases),
 * :=, IF/ELSIF/ELSE, CASE (lists + ranges), FOR, WHILE, REPEAT, EXIT, RETURN,
 * AND/OR/XOR/NOT/&, = <> < > <= >=, + - * / MOD, T#.. time literals,
 * function blocks TON TOF TP CTU CTD CTUD R_TRIG F_TRIG SR RS,
 * functions ABS SQRT MIN MAX LIMIT SEL TRUNC SIN COS EXP LN and X_TO_Y conversions.
 */

class PlcError extends Error { constructor(line, msg) { super(msg); this.line = line; } }
class RtError extends Error {}
const EXIT = { exit: true }, RETURN = { ret: true };

const KW = new Set(('PROGRAM END_PROGRAM VAR END_VAR IF THEN ELSIF ELSE END_IF CASE OF END_CASE ' +
  'FOR TO BY DO END_FOR WHILE END_WHILE REPEAT UNTIL END_REPEAT AND OR XOR NOT MOD TRUE FALSE EXIT RETURN').split(' '));

const ELEM = { BOOL: 'BOOL', INT: 'INT', DINT: 'INT', SINT: 'INT', LINT: 'INT', UINT: 'INT', UDINT: 'INT', USINT: 'INT',
  WORD: 'INT', DWORD: 'INT', BYTE: 'INT', REAL: 'REAL', LREAL: 'REAL', TIME: 'TIME' };

const LOOP_MAX = 100000;
const RT = { dt: 0 };

const truthy = v => v === true || (typeof v === 'number' && v !== 0);
const num = v => (typeof v === 'boolean' ? (v ? 1 : 0) : v);
const defVal = b => (b === 'BOOL' ? false : 0);
function coerce(b, v) {
  switch (b) {
    case 'BOOL': return truthy(v);
    case 'INT': { const n = Math.trunc(num(v)); return Number.isFinite(n) ? n : 0; }
    case 'TIME': { const n = Math.round(num(v)); return Number.isFinite(n) ? n : 0; }
    default: { const n = num(v); return Number.isFinite(n) ? n : 0; }
  }
}

const FB_TYPES = {
  TON: { in: { IN: 'BOOL', PT: 'TIME' }, out: { Q: 'BOOL', ET: 'TIME' }, desc: 'On-delay timer',
    run(s, dt) { if (s.IN) { s.ET = Math.min(s.PT, s.ET + dt); s.Q = s.ET >= s.PT; } else { s.ET = 0; s.Q = false; } } },
  TOF: { in: { IN: 'BOOL', PT: 'TIME' }, out: { Q: 'BOOL', ET: 'TIME' }, desc: 'Off-delay timer',
    run(s, dt) { if (s.IN) { s.Q = true; s.ET = 0; } else if (s.Q) { s.ET = Math.min(s.PT, s.ET + dt); if (s.ET >= s.PT) s.Q = false; } } },
  TP: { in: { IN: 'BOOL', PT: 'TIME' }, out: { Q: 'BOOL', ET: 'TIME' }, desc: 'Pulse timer',
    run(s, dt) {
      if (!s.Q && s.IN && !s._p && s.ET === 0) s.Q = true;
      if (s.Q) { s.ET = Math.min(s.PT, s.ET + dt); if (s.ET >= s.PT) s.Q = false; }
      if (!s.IN && !s.Q) s.ET = 0;
      s._p = s.IN;
    } },
  CTU: { in: { CU: 'BOOL', R: 'BOOL', PV: 'INT' }, out: { Q: 'BOOL', CV: 'INT' }, desc: 'Up counter',
    run(s) { if (s.R) s.CV = 0; else if (s.CU && !s._p) s.CV++; s._p = s.CU; s.Q = s.CV >= s.PV; } },
  CTD: { in: { CD: 'BOOL', LD: 'BOOL', PV: 'INT' }, out: { Q: 'BOOL', CV: 'INT' }, desc: 'Down counter',
    run(s) { if (s.LD) s.CV = s.PV; else if (s.CD && !s._p) s.CV--; s._p = s.CD; s.Q = s.CV <= 0; } },
  CTUD: { in: { CU: 'BOOL', CD: 'BOOL', R: 'BOOL', LD: 'BOOL', PV: 'INT' }, out: { QU: 'BOOL', QD: 'BOOL', CV: 'INT' }, desc: 'Up/down counter',
    run(s) {
      if (s.R) s.CV = 0; else if (s.LD) s.CV = s.PV;
      else { if (s.CU && !s._p) s.CV++; if (s.CD && !s._p2) s.CV--; }
      s._p = s.CU; s._p2 = s.CD; s.QU = s.CV >= s.PV; s.QD = s.CV <= 0;
    } },
  R_TRIG: { in: { CLK: 'BOOL' }, out: { Q: 'BOOL' }, desc: 'Rising edge detector',
    run(s) { s.Q = s.CLK && !s._p; s._p = s.CLK; } },
  F_TRIG: { in: { CLK: 'BOOL' }, out: { Q: 'BOOL' }, desc: 'Falling edge detector',
    run(s) { s.Q = !s.CLK && s._p; s._p = s.CLK; } },
  SR: { in: { S1: 'BOOL', R: 'BOOL' }, out: { Q1: 'BOOL' }, desc: 'Set-dominant latch',
    run(s) { s.Q1 = s.S1 || (s.Q1 && !s.R); } },
  RS: { in: { S: 'BOOL', R1: 'BOOL' }, out: { Q1: 'BOOL' }, desc: 'Reset-dominant latch',
    run(s) { s.Q1 = !s.R1 && (s.S || s.Q1); } },
  PID: {
    in: { ACTUAL: 'REAL', SETPOINT: 'REAL', KP: 'REAL', TN: 'REAL', TV: 'REAL', Y_MIN: 'REAL', Y_MAX: 'REAL',
      MANUAL: 'BOOL', Y_MANUAL: 'REAL', RESET: 'BOOL', REVERSE: 'BOOL', DEADBAND: 'REAL' },
    out: { Y: 'REAL', E: 'REAL', P: 'REAL', I: 'REAL', D: 'REAL', LIMITS_ACTIVE: 'BOOL' },
    init: { KP: 1, TN: 0, TV: 0, Y_MIN: 0, Y_MAX: 100 },
    desc: 'PID controller (ideal form: Y = KP·(e + 1/TN·∫e dt + TV·de/dt)), TN/TV in seconds',
    run(s, dtMs) {
      const dt = Math.max(dtMs, 1) / 1000;
      const lo = Math.min(s.Y_MIN, s.Y_MAX), hi = Math.max(s.Y_MIN, s.Y_MAX);
      let e = s.REVERSE ? s.ACTUAL - s.SETPOINT : s.SETPOINT - s.ACTUAL;
      if (Math.abs(e) < Math.abs(s.DEADBAND)) e = 0;
      s.E = e;
      if (s._pv === undefined) s._pv = s.ACTUAL;
      // derivative on measurement, first-order filtered (avoids setpoint kick)
      const dpv = (s.ACTUAL - s._pv) / dt * (s.REVERSE ? -1 : 1);
      s._pv = s.ACTUAL;
      const dRaw = -s.KP * s.TV * dpv;
      const a = s.TV > 0 ? dt / (dt + s.TV / 8) : 1;
      s.D = s.TV > 0 ? s.D + a * (dRaw - s.D) : 0;
      s.P = s.KP * e;
      if (s.RESET) { s.I = 0; s.D = 0; s.Y = Math.min(hi, Math.max(lo, 0)); s.LIMITS_ACTIVE = false; return; }
      if (s.MANUAL) {
        s.Y = Math.min(hi, Math.max(lo, s.Y_MANUAL));
        s.I = s.Y - s.P - s.D;                     // bumpless transfer back to auto
        s.LIMITS_ACTIVE = s.Y <= lo || s.Y >= hi;
        return;
      }
      if (s.TN > 0) {
        // anti-windup: conditional integration + integral clamped to the output range
        const iNew = s.I + s.KP * e * dt / s.TN, y = s.P + iNew + s.D;
        if (!((y > hi && e * s.KP > 0) || (y < lo && e * s.KP < 0))) s.I = iNew;
        s.I = Math.min(hi, Math.max(lo, s.I));
      } else s.I = 0;
      const yc = Math.min(hi, Math.max(lo, s.P + s.I + s.D));
      s.Y = yc;
      s.LIMITS_ACTIVE = yc <= lo || yc >= hi;
    } },
};

function newFb(T) {
  const d = FB_TYPES[T], s = { _p: false, _p2: false };
  for (const k in d.in) s[k] = defVal(d.in[k]);
  for (const k in d.out) s[k] = defVal(d.out[k]);
  if (d.init) Object.assign(s, d.init);
  return s;
}

function parseTime(s, line) {
  const str = s.replace(/_/g, '').toLowerCase();
  const re = /(\d+(?:\.\d+)?)(ms|d|h|m|s)/y;
  const mult = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };
  let i = 0, ms = 0;
  if (!str) throw new PlcError(line, 'Empty TIME literal');
  while (i < str.length) {
    re.lastIndex = i;
    const m = re.exec(str);
    if (!m) throw new PlcError(line, `Bad TIME literal 'T#${s}'. Examples: T#500ms, T#5s, T#1m30s`);
    ms += parseFloat(m[1]) * mult[m[2]];
    i = re.lastIndex;
  }
  return Math.round(ms);
}

function tokenize(src) {
  const toks = [];
  let i = 0, line = 1;
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (src.startsWith('(*', i)) {
      const e = src.indexOf('*)', i + 2);
      const end = e < 0 ? src.length : e + 2;
      for (let k = i; k < end; k++) if (src[k] === '\n') line++;
      i = end; continue;
    }
    if (src.startsWith('//', i)) { while (i < src.length && src[i] !== '\n') i++; continue; }
    const rest = src.slice(i, i + 200);
    let m;
    if ((m = /^(?:T|TIME)#([0-9a-zA-Z_.]+)/i.exec(rest))) {
      toks.push({ t: 'num', v: parseTime(m[1], line), time: true, line }); i += m[0].length; continue;
    }
    if ((m = /^[0-9][0-9_]*(\.[0-9]+)?([eE][+-]?[0-9]+)?/.exec(rest))) {
      toks.push({ t: 'num', v: parseFloat(m[0].replace(/_/g, '')), real: !!(m[1] || m[2]), line }); i += m[0].length; continue;
    }
    if ((m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest))) {
      const up = m[0].toUpperCase();
      toks.push(KW.has(up) ? { t: 'kw', v: up, line } : { t: 'id', v: m[0], line });
      i += m[0].length; continue;
    }
    const two = src.substr(i, 2);
    if ([':=', '<=', '>=', '<>', '=>', '..'].includes(two)) { toks.push({ t: 'op', v: two, line }); i += 2; continue; }
    if ('+-*/()=<>;:,.&'.includes(c)) { toks.push({ t: 'op', v: c, line }); i++; continue; }
    throw new PlcError(line, `Unexpected character '${c}'`);
  }
  toks.push({ t: 'eof', v: '', line });
  return toks;
}

const seqf = ss => { if (!ss.length) return () => {}; if (ss.length === 1) return ss[0]; return () => { for (let i = 0; i < ss.length; i++) ss[i](); }; };
const arithTy = (a, b) => (a === 'REAL' || b === 'REAL') ? 'REAL' : (a === 'TIME' || b === 'TIME') ? 'TIME' : 'INT';

class Parser {
  constructor(toks, tags) { this.t = toks; this.i = 0; this.tags = tags; this.declared = []; }
  peek(o = 0) { return this.t[Math.min(this.i + o, this.t.length - 1)]; }
  next() { return this.t[this.i++]; }
  isKw(v) { const p = this.peek(); return p.t === 'kw' && p.v === v; }
  isOp(v) { const p = this.peek(); return p.t === 'op' && p.v === v; }
  accKw(v) { if (this.isKw(v)) { this.i++; return true; } return false; }
  accOp(v) { if (this.isOp(v)) { this.i++; return true; } return false; }
  fail(msg) {
    const p = this.peek();
    throw new PlcError(p.line, msg + (p.t === 'eof' ? ' but reached the end of the program' : ` but found '${p.v}'`));
  }
  expKw(v) { if (!this.accKw(v)) this.fail(`Expected ${v}`); }
  expOp(v, hint = '') { if (!this.accOp(v)) this.fail(`Expected '${v}'${hint}`); }
  expId() { const p = this.peek(); if (p.t !== 'id') this.fail('Expected a name'); this.i++; return p; }
  ref(id) {
    const tag = this.tags[id.v.toUpperCase()];
    if (!tag) throw new PlcError(id.line, `Undeclared variable '${id.v}'. Declare it in a VAR ... END_VAR block.`);
    return tag;
  }

  program() {
    const body = [];
    if (this.accKw('PROGRAM')) this.expId();
    while (!(this.peek().t === 'eof' || this.isKw('END_PROGRAM'))) {
      if (this.isKw('VAR')) this.varBlock(); else body.push(this.stmt());
    }
    this.accKw('END_PROGRAM');
    const b = seqf(body);
    return () => { try { b(); } catch (e) { if (e !== RETURN) throw e; } };
  }

  varBlock() {
    this.expKw('VAR');
    const p0 = this.peek();
    if (p0.t === 'id' && /^(RETAIN|PERSISTENT|CONSTANT)$/i.test(p0.v)) this.i++;
    while (!this.accKw('END_VAR')) {
      if (this.peek().t === 'eof') this.fail('Expected END_VAR');
      const names = [this.expId()];
      while (this.accOp(',')) names.push(this.expId());
      this.expOp(':');
      const tp = this.expId();
      const T = tp.v.toUpperCase();
      let init, fbInit = null;
      if (this.accOp(':=')) {
        if (FB_TYPES[T]) {
          // structured initial values: Tmr : TON := (PT := T#5s);
          fbInit = {};
          this.expOp('(', ` — initialise a ${T} like  := (NAME := value, ...)`);
          if (!this.isOp(')')) {
            do {
              const pn = this.expId(), P = pn.v.toUpperCase(), def = FB_TYPES[T];
              if (!(P in def.in)) throw new PlcError(pn.line, `${T} has no input '${pn.v}'. Inputs: ${Object.keys(def.in).join(', ')}`);
              this.expOp(':=');
              fbInit[P] = coerce(ELEM[def.in[P]], this.expr().f());
            } while (this.accOp(','));
          }
          this.expOp(')');
        } else init = this.expr().f();
      }
      this.expOp(';');
      for (const n of names) {
        const K = n.v.toUpperCase();
        if (this.tags[K]) {
          const o = this.tags[K];
          throw new PlcError(n.line, `'${n.v}' is already declared${o.kind !== 'MEM' && o.kind !== 'FB' ? ' (it is a built-in I/O or system tag)' : ''}`);
        }
        let tag;
        if (FB_TYPES[T]) tag = { name: n.v, type: T, kind: 'FB', fb: Object.assign(newFb(T), fbInit || {}), desc: FB_TYPES[T].desc };
        else if (ELEM[T]) tag = { name: n.v, type: T, base: ELEM[T], kind: 'MEM', v: init !== undefined ? coerce(ELEM[T], init) : defVal(ELEM[T]), desc: '' };
        else throw new PlcError(tp.line, `Unknown type '${tp.v}'. Use BOOL, INT, DINT, REAL, TIME or a function block (TON, CTU, R_TRIG ...)`);
        this.tags[K] = tag;
        this.declared.push(K);
      }
    }
    this.accOp(';');
  }

  block(ends) {
    const ss = [];
    while (!(this.peek().t === 'kw' && ends.includes(this.peek().v))) {
      if (this.peek().t === 'eof') this.fail(`Expected ${ends[ends.length - 1]}`);
      ss.push(this.stmt());
    }
    return seqf(ss);
  }

  stmt() {
    const p = this.peek();
    if (p.t === 'op' && p.v === ';') { this.i++; return () => {}; }
    if (p.t === 'kw') {
      switch (p.v) {
        case 'IF': return this.ifStmt();
        case 'CASE': return this.caseStmt();
        case 'FOR': return this.forStmt();
        case 'WHILE': return this.whileStmt();
        case 'REPEAT': return this.repeatStmt();
        case 'EXIT': this.i++; this.accOp(';'); return () => { throw EXIT; };
        case 'RETURN': this.i++; this.accOp(';'); return () => { throw RETURN; };
        case 'VAR': throw new PlcError(p.line, 'VAR blocks must be at the top level, not inside a statement');
      }
      throw new PlcError(p.line, `Unexpected '${p.v}' (check for a missing or extra END_IF / END_CASE / semicolon)`);
    }
    if (p.t === 'id') {
      if (this.peek(1).t === 'op' && this.peek(1).v === '(') return this.fbCall();
      const lv = this.lvalue();
      if (this.isOp('=')) this.fail("Expected ':=' (use := for assignment, = is a comparison)");
      this.expOp(':=');
      const e = this.expr();
      this.expOp(';', ' at end of statement');
      return lv.assign(e);
    }
    this.fail('Expected a statement');
  }

  lvalue() {
    const id = this.expId();
    const tag = this.ref(id);
    if (this.accOp('.')) {
      const m = this.expId();
      if (tag.kind !== 'FB') throw new PlcError(m.line, `'${id.v}' is not a function block`);
      const M = m.v.toUpperCase(), def = FB_TYPES[tag.type];
      if (!(M in def.in)) throw new PlcError(m.line, `${tag.type}.${m.v} is not a writable input. Inputs: ${Object.keys(def.in).join(', ')}`);
      const ty = ELEM[def.in[M]];
      return { assign: e => { const f = e.f, st = tag.fb; return () => { st[M] = coerce(ty, f()); }; } };
    }
    if (tag.kind === 'FB') throw new PlcError(id.line, `Can't assign to function block '${id.v}'. Call it instead: ${id.v}(...);`);
    if (tag.kind === 'SYS') throw new PlcError(id.line, `'${id.v}' is a read-only system tag`);
    const b = tag.base;
    return { assign: e => { const f = e.f; return () => { tag.v = coerce(b, f()); }; } };
  }

  fbCall() {
    const id = this.expId();
    const tag = this.ref(id);
    if (tag.kind !== 'FB') throw new PlcError(id.line, `'${id.v}' is not a function block instance, so it can't be called`);
    const def = FB_TYPES[tag.type], st = tag.fb, sets = [], outs = [];
    this.expOp('(');
    if (!this.isOp(')')) {
      do {
        const pn = this.expId(), P = pn.v.toUpperCase();
        if (this.accOp(':=')) {
          if (!(P in def.in)) throw new PlcError(pn.line, `${tag.type} has no input '${pn.v}'. Inputs: ${Object.keys(def.in).join(', ')}`);
          const e = this.expr(), ty = ELEM[def.in[P]], f = e.f;
          sets.push(() => { st[P] = coerce(ty, f()); });
        } else if (this.accOp('=>')) {
          if (!(P in def.out)) throw new PlcError(pn.line, `${tag.type} has no output '${pn.v}'. Outputs: ${Object.keys(def.out).join(', ')}`);
          const lv = this.lvalue();
          outs.push(lv.assign({ f: () => st[P] }));
        } else this.fail(`Expected ':=' after parameter '${pn.v}'`);
      } while (this.accOp(','));
    }
    this.expOp(')');
    this.expOp(';', ' at end of statement');
    const run = def.run;
    return () => {
      for (let i = 0; i < sets.length; i++) sets[i]();
      run(st, RT.dt);
      for (let i = 0; i < outs.length; i++) outs[i]();
    };
  }

  ifStmt() {
    this.expKw('IF');
    const branches = [];
    let c = this.expr(); this.expKw('THEN');
    branches.push([c.f, this.block(['ELSIF', 'ELSE', 'END_IF'])]);
    let els = null;
    for (;;) {
      if (this.accKw('ELSIF')) { c = this.expr(); this.expKw('THEN'); branches.push([c.f, this.block(['ELSIF', 'ELSE', 'END_IF'])]); }
      else if (this.accKw('ELSE')) { els = this.block(['END_IF']); }
      else { this.expKw('END_IF'); break; }
    }
    this.accOp(';');
    return () => {
      for (let i = 0; i < branches.length; i++) if (truthy(branches[i][0]())) { branches[i][1](); return; }
      if (els) els();
    };
  }

  caseNum() {
    const neg = this.accOp('-');
    const p = this.peek();
    if (p.t !== 'num') this.fail('Expected a CASE label (a number)');
    this.i++;
    return neg ? -p.v : p.v;
  }
  caseArmEnd() {
    const p = this.peek();
    if (p.t === 'eof') this.fail('Expected END_CASE');
    return p.t === 'num' || (p.t === 'kw' && (p.v === 'ELSE' || p.v === 'END_CASE')) ||
      (p.t === 'op' && p.v === '-' && this.peek(1).t === 'num');
  }
  caseStmt() {
    this.expKw('CASE');
    const sel = this.expr(); this.expKw('OF');
    const arms = []; let els = null;
    for (;;) {
      if (this.accKw('ELSE')) { els = this.block(['END_CASE']); this.expKw('END_CASE'); break; }
      if (this.accKw('END_CASE')) break;
      const labels = [];
      do {
        const a = this.caseNum();
        if (this.accOp('..')) labels.push([a, this.caseNum()]); else labels.push([a, a]);
      } while (this.accOp(','));
      this.expOp(':');
      const ss = [];
      while (!this.caseArmEnd()) ss.push(this.stmt());
      arms.push([labels, seqf(ss)]);
    }
    this.accOp(';');
    const f = sel.f;
    return () => {
      const v = num(f());
      for (const [labels, body] of arms) for (const [a, b] of labels) if (v >= a && v <= b) { body(); return; }
      if (els) els();
    };
  }

  forStmt() {
    this.expKw('FOR');
    const id = this.expId(), tag = this.ref(id);
    if (tag.kind !== 'MEM') throw new PlcError(id.line, 'FOR loop variable must be a declared INT variable');
    this.expOp(':=');
    const a = this.expr(); this.expKw('TO');
    const b = this.expr();
    let st = { f: () => 1 };
    if (this.accKw('BY')) st = this.expr();
    this.expKw('DO');
    const body = this.block(['END_FOR']); this.expKw('END_FOR'); this.accOp(';');
    const line = id.line;
    return () => {
      const step = num(st.f()), end = num(b.f());
      if (step === 0) throw new RtError(`FOR loop step is 0 (line ${line})`);
      tag.v = coerce(tag.base, a.f());
      let n = 0;
      try {
        while (step > 0 ? tag.v <= end : tag.v >= end) {
          body();
          tag.v = coerce(tag.base, tag.v + step);
          if (++n > LOOP_MAX) throw new RtError(`FOR loop ran ${LOOP_MAX} times in one scan (line ${line})`);
        }
      } catch (e) { if (e !== EXIT) throw e; }
    };
  }

  whileStmt() {
    const line = this.peek().line;
    this.expKw('WHILE');
    const c = this.expr(); this.expKw('DO');
    const body = this.block(['END_WHILE']); this.expKw('END_WHILE'); this.accOp(';');
    const f = c.f;
    return () => {
      let n = 0;
      try {
        while (truthy(f())) { body(); if (++n > LOOP_MAX) throw new RtError(`WHILE loop ran ${LOOP_MAX} times in one scan — infinite loop? (line ${line})`); }
      } catch (e) { if (e !== EXIT) throw e; }
    };
  }

  repeatStmt() {
    const line = this.peek().line;
    this.expKw('REPEAT');
    const body = this.block(['UNTIL']); this.expKw('UNTIL');
    const c = this.expr(); this.expKw('END_REPEAT'); this.accOp(';');
    const f = c.f;
    return () => {
      let n = 0;
      try {
        do { body(); if (++n > LOOP_MAX) throw new RtError(`REPEAT loop ran ${LOOP_MAX} times in one scan — infinite loop? (line ${line})`); } while (!truthy(f()));
      } catch (e) { if (e !== EXIT) throw e; }
    };
  }

  // ---- expressions ----
  expr() { return this.orE(); }
  bin(next, ops, mk) {
    let l = next.call(this);
    for (;;) {
      const p = this.peek();
      if (!((p.t === 'op' || p.t === 'kw') && ops.includes(p.v))) return l;
      this.i++;
      const r = next.call(this);
      l = mk(p.v, l, r, p.line);
    }
  }
  orE() { return this.bin(this.xorE, ['OR'], (o, a, b) => { const f = a.f, g = b.f; return { ty: 'BOOL', f: () => truthy(f()) || truthy(g()) }; }); }
  xorE() { return this.bin(this.andE, ['XOR'], (o, a, b) => { const f = a.f, g = b.f; return { ty: 'BOOL', f: () => truthy(f()) !== truthy(g()) }; }); }
  andE() { return this.bin(this.eqE, ['AND', '&'], (o, a, b) => { const f = a.f, g = b.f; return { ty: 'BOOL', f: () => truthy(f()) && truthy(g()) }; }); }
  eqE() {
    return this.bin(this.relE, ['=', '<>'], (o, a, b) => {
      const f = a.f, g = b.f;
      return o === '=' ? { ty: 'BOOL', f: () => num(f()) === num(g()) } : { ty: 'BOOL', f: () => num(f()) !== num(g()) };
    });
  }
  relE() {
    return this.bin(this.addE, ['<', '>', '<=', '>='], (o, a, b) => {
      const f = a.f, g = b.f;
      switch (o) {
        case '<': return { ty: 'BOOL', f: () => num(f()) < num(g()) };
        case '>': return { ty: 'BOOL', f: () => num(f()) > num(g()) };
        case '<=': return { ty: 'BOOL', f: () => num(f()) <= num(g()) };
        default: return { ty: 'BOOL', f: () => num(f()) >= num(g()) };
      }
    });
  }
  addE() {
    return this.bin(this.mulE, ['+', '-'], (o, a, b) => {
      const f = a.f, g = b.f, ty = arithTy(a.ty, b.ty);
      return o === '+' ? { ty, f: () => num(f()) + num(g()) } : { ty, f: () => num(f()) - num(g()) };
    });
  }
  mulE() {
    return this.bin(this.unary, ['*', '/', 'MOD'], (o, a, b, line) => {
      const f = a.f, g = b.f, ty = arithTy(a.ty, b.ty);
      if (o === '*') return { ty, f: () => num(f()) * num(g()) };
      if (o === 'MOD') return { ty: 'INT', f: () => { const d = Math.trunc(num(g())); if (d === 0) throw new RtError(`Division by zero in MOD (line ${line})`); return Math.trunc(num(f())) % d; } };
      if (ty === 'REAL') return { ty, f: () => { const d = num(g()); if (d === 0) throw new RtError(`Division by zero (line ${line})`); return num(f()) / d; } };
      return { ty, f: () => { const d = num(g()); if (d === 0) throw new RtError(`Division by zero (line ${line})`); return Math.trunc(num(f()) / d); } };
    });
  }
  unary() {
    const p = this.peek();
    if (p.t === 'kw' && p.v === 'NOT') { this.i++; const a = this.unary(), f = a.f; return { ty: 'BOOL', f: () => !truthy(f()) }; }
    if (p.t === 'op' && p.v === '-') { this.i++; const a = this.unary(), f = a.f; return { ty: a.ty === 'BOOL' ? 'INT' : a.ty, f: () => -num(f()) }; }
    if (p.t === 'op' && p.v === '+') { this.i++; return this.unary(); }
    return this.primary();
  }
  primary() {
    const p = this.next();
    if (p.t === 'num') { const v = p.v; return { ty: p.time ? 'TIME' : p.real ? 'REAL' : 'INT', f: () => v }; }
    if (p.t === 'kw' && (p.v === 'TRUE' || p.v === 'FALSE')) { const v = p.v === 'TRUE'; return { ty: 'BOOL', f: () => v }; }
    if (p.t === 'op' && p.v === '(') { const e = this.expr(); this.expOp(')'); return e; }
    if (p.t === 'id') {
      if (this.isOp('(')) return this.funcCall(p);
      const tag = this.ref(p);
      if (this.accOp('.')) {
        const m = this.expId();
        if (tag.kind !== 'FB') throw new PlcError(m.line, `'${p.v}' is not a function block, so it has no members`);
        const M = m.v.toUpperCase(), def = FB_TYPES[tag.type];
        const ty = def.in[M] || def.out[M];
        if (!ty) throw new PlcError(m.line, `${tag.type} has no member '${m.v}'. Members: ${[...Object.keys(def.in), ...Object.keys(def.out)].join(', ')}`);
        const st = tag.fb;
        return { ty: ELEM[ty], f: () => st[M] };
      }
      if (tag.kind === 'FB') {
        const o = Object.keys(FB_TYPES[tag.type].out)[0];
        throw new PlcError(p.line, `'${p.v}' is a ${tag.type}; read one of its outputs, e.g. ${p.v}.${o}`);
      }
      return { ty: tag.base, f: () => tag.v };
    }
    this.i--;
    this.fail('Expected a value or expression');
  }
  funcCall(id) {
    const N = id.v.toUpperCase();
    if (this.tags[N] && this.tags[N].kind === 'FB') throw new PlcError(id.line, `Function block calls must be a statement on their own: ${id.v}(...);`);
    this.expOp('(');
    const args = [];
    if (!this.isOp(')')) { do { args.push(this.expr()); } while (this.accOp(',')); }
    this.expOp(')');
    const fs = args.map(a => a.f);
    const need = n => { if (args.length !== n) throw new PlcError(id.line, `${id.v} expects ${n} argument(s), got ${args.length}`); };
    const m = /^[A-Z]+_TO_([A-Z]+)$/.exec(N);
    if (m && ELEM[m[1]]) { need(1); const b = ELEM[m[1]], f = fs[0]; return { ty: b, f: () => coerce(b, f()) }; }
    const real1 = fn => { need(1); const f = fs[0]; return { ty: 'REAL', f: () => fn(num(f())) }; };
    switch (N) {
      case 'ABS': { need(1); const f = fs[0]; return { ty: args[0].ty, f: () => Math.abs(num(f())) }; }
      case 'SQRT': return real1(Math.sqrt);
      case 'SIN': return real1(Math.sin);
      case 'COS': return real1(Math.cos);
      case 'EXP': return real1(Math.exp);
      case 'LN': return real1(Math.log);
      case 'TRUNC': { need(1); const f = fs[0]; return { ty: 'INT', f: () => Math.trunc(num(f())) }; }
      case 'MIN': case 'MAX': {
        if (args.length < 2) throw new PlcError(id.line, `${id.v} needs at least 2 arguments`);
        const ty = args.reduce((t, a) => arithTy(t, a.ty), 'INT'), fn = N === 'MIN' ? Math.min : Math.max;
        return { ty, f: () => { let r = num(fs[0]()); for (let i = 1; i < fs.length; i++) r = fn(r, num(fs[i]())); return r; } };
      }
      case 'LIMIT': { need(3); const [mn, v, mx] = fs; return { ty: args[1].ty, f: () => Math.min(num(mx()), Math.max(num(mn()), num(v()))) }; }
      case 'SEL': { need(3); const [g, a, b] = fs; return { ty: args[1].ty, f: () => (truthy(g()) ? b() : a()) }; }
    }
    throw new PlcError(id.line, `Unknown function '${id.v}'`);
  }
}

/** Compile ST source. `tags` is mutated: declared variables are added to it. */
function compile(src, tags) {
  const p = new Parser(tokenize(src), tags);
  const fn = p.program();
  return { fn, declared: p.declared };
}

module.exports = { compile, PlcError, RtError, FB_TYPES, ELEM, RT, truthy, num, coerce, defVal, newFb };
