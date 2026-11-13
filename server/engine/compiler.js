'use strict';
/*
 * PLCFACTORY — IEC 61131-3 Structured Text compiler (subset)
 * Compiles ST source into JavaScript closures bound directly to tag objects.
 *
 * Supported: TYPE/STRUCT (UDTs), ARRAY[lo..hi] OF, VAR/VAR_GLOBAL blocks, BOOL/INT/DINT/REAL/LREAL/TIME,
 * member/index/bit access (Motor.Tmr.Q, Track[i].Bad, Word.3), BSL/BSR array shift registers,
 * SHL/SHR/ROL/ROR, bitwise AND/OR/XOR/NOT on integers, FB_RESET,
 * :=, IF/ELSIF/ELSE, CASE (lists + ranges), FOR, WHILE, REPEAT, EXIT, RETURN,
 * AND/OR/XOR/NOT/&, = <> < > <= >=, + - * / MOD, T#.. time literals,
 * function blocks TON TOF TP CTU CTD CTUD R_TRIG F_TRIG SR RS,
 * functions ABS SQRT MIN MAX LIMIT SEL TRUNC SIN COS EXP LN and X_TO_Y conversions.
 */

class PlcError extends Error { constructor(line, msg) { super(msg); this.line = line; } }
class RtError extends Error {}
const EXIT = { exit: true }, RETURN = { ret: true };

const KW = new Set(('PROGRAM END_PROGRAM VAR VAR_GLOBAL END_VAR TYPE END_TYPE STRUCT END_STRUCT ARRAY IF THEN ELSIF ELSE END_IF CASE OF END_CASE ' +
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
    if ('+-*/()=<>;:,.&[]'.includes(c)) { toks.push({ t: 'op', v: c, line }); i++; continue; }
    throw new PlcError(line, `Unexpected character '${c}'`);
  }
  toks.push({ t: 'eof', v: '', line });
  return toks;
}

const seqf = ss => { if (!ss.length) return () => {}; if (ss.length === 1) return ss[0]; return () => { for (let i = 0; i < ss.length; i++) ss[i](); }; };
const arithTy = (a, b) => (a === 'REAL' || b === 'REAL') ? 'REAL' : (a === 'TIME' || b === 'TIME') ? 'TIME' : 'INT';
const MAX_ARRAY = 2000;

// ---------- type system ----------
// elementary {k:'e', b, name} · struct {k:'s', name, fields:[{name,N,t,init}]} · array {k:'a', lo, hi, of, name} · fb {k:'f', name}
const ET = {};
for (const n of Object.keys(ELEM)) ET[n] = { k: 'e', b: ELEM[n], name: n };
const BOOLT = ET.BOOL;
const elemT = b => ({ BOOL: ET.BOOL, INT: ET.DINT, REAL: ET.REAL, TIME: ET.TIME })[b] || ET.REAL;
function tagType(tag) {
  if (tag.t) return tag.t;
  if (tag.kind === 'FB') return { k: 'f', name: tag.type };
  return ET[tag.type] || elemT(tag.base);
}
function makeVal(t, init) {
  switch (t.k) {
    case 'e': return init !== undefined ? coerce(t.b, init) : defVal(t.b);
    case 's': { const o = {}; for (const f of t.fields) o[f.N] = makeVal(f.t, init && init[f.N] !== undefined ? init[f.N] : f.init); return o; }
    case 'a': { const a = []; for (let i = 0; i <= t.hi - t.lo; i++) a.push(makeVal(t.of, Array.isArray(init) ? init[i] : t.init ? t.init[i] : undefined)); return a; }
    case 'f': return Object.assign(newFb(t.name), t.init || {}, init || {});
  }
}
function clone(t, v) {
  switch (t.k) {
    case 'e': return v;
    case 's': { const o = {}; for (const f of t.fields) o[f.N] = clone(f.t, v[f.N]); return o; }
    case 'a': return v.map(x => clone(t.of, x));
    case 'f': return Object.assign({}, v);
  }
}
function sameType(a, b) {
  if (!a || !b || a.k !== b.k) return false;
  if (a.k === 'e') return a.b === b.b;
  if (a.k === 'a') return a.hi - a.lo === b.hi - b.lo && sameType(a.of, b.of);
  return a === b || a.name === b.name;
}
function fbReset(st, T) {
  const d = FB_TYPES[T];
  for (const k in d.out) st[k] = defVal(d.out[k]);
  st._p = false; st._p2 = false; st.I = st.I !== undefined && T === 'PID' ? 0 : st.I;
  if (T === 'CTD' || T === 'CTUD') st.CV = 0;
}

class Parser {
  constructor(toks, ctx) { this.t = toks; this.i = 0; this.ctx = ctx; this.tags = ctx.tags; }
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
    if (!tag) throw new PlcError(id.line, `Undeclared variable '${id.v}'. Declare it in a VAR ... END_VAR block (or in Globals).`);
    return tag;
  }

  // ---------- top level ----------
  unit() {
    const body = [];
    if (this.accKw('PROGRAM')) this.expId();
    while (!(this.peek().t === 'eof' || this.isKw('END_PROGRAM'))) {
      if (this.isKw('VAR') || this.isKw('VAR_GLOBAL')) this.varBlock();
      else if (this.isKw('TYPE')) this.typeBlock();
      else body.push(this.stmt());
    }
    this.accKw('END_PROGRAM');
    const b = seqf(body);
    return () => { try { b(); } catch (e) { if (e !== RETURN) throw e; } };
  }

  // ---------- types ----------
  typeSpec() {
    if (this.accKw('ARRAY')) {
      this.expOp('[');
      const lo = this.constInt(), _ = this.expOp('..'), hi = this.constInt();
      const line = this.peek().line;
      if (this.isOp(',')) throw new PlcError(line, 'Multi-dimensional arrays are not supported — use an array of a STRUCT, or an ARRAY OF ARRAY type');
      this.expOp(']');
      this.expKw('OF');
      const of = this.typeSpec();
      if (hi < lo) throw new PlcError(line, `Array upper bound ${hi} is below lower bound ${lo}`);
      if (hi - lo + 1 > MAX_ARRAY) throw new PlcError(line, `Arrays are limited to ${MAX_ARRAY} elements`);
      return { k: 'a', lo, hi, of, name: `ARRAY[${lo}..${hi}] OF ${of.name}` };
    }
    const id = this.expId(), T = id.v.toUpperCase();
    if (ET[T]) return ET[T];
    if (FB_TYPES[T]) return { k: 'f', name: T };
    if (this.ctx.types[T]) return this.ctx.types[T];
    throw new PlcError(id.line, `Unknown type '${id.v}'. Use BOOL, INT, DINT, REAL, TIME, ARRAY[..] OF, a function block (TON, CTU, PID…) or a TYPE you declared`);
  }
  constInt() {
    const neg = this.accOp('-');
    const p = this.peek();
    if (p.t === 'num') { this.i++; return neg ? -p.v : p.v; }
    if (p.t === 'id' && this.tags[p.v.toUpperCase()] && this.tags[p.v.toUpperCase()].constant) { this.i++; const v = this.tags[p.v.toUpperCase()].v; return neg ? -v : v; }
    this.fail('Expected a whole number');
  }
  typeBlock() {
    this.expKw('TYPE');
    while (!this.accKw('END_TYPE')) {
      if (this.peek().t === 'eof') this.fail('Expected END_TYPE');
      const nameTok = this.expId(), N = nameTok.v.toUpperCase();
      if (this.ctx.types[N] || ET[N] || FB_TYPES[N]) throw new PlcError(nameTok.line, `Type '${nameTok.v}' is already defined`);
      this.expOp(':');
      if (this.accKw('STRUCT')) {
        const t = { k: 's', name: nameTok.v, fields: [] };
        this.ctx.types[N] = t;            // allows arrays of itself? no — but lets later types refer to it
        while (!this.accKw('END_STRUCT')) {
          if (this.peek().t === 'eof') this.fail('Expected END_STRUCT');
          const names = [this.expId()];
          while (this.accOp(',')) names.push(this.expId());
          this.expOp(':');
          const ft = this.typeSpec();
          if (ft === t) throw new PlcError(names[0].line, 'A STRUCT cannot contain itself');
          let init;
          if (this.accOp(':=')) init = this.initValue(ft);
          this.expOp(';');
          for (const n of names) {
            const FN = n.v.toUpperCase();
            if (t.fields.some(f => f.N === FN)) throw new PlcError(n.line, `Duplicate member '${n.v}'`);
            t.fields.push({ name: n.v, N: FN, t: ft, init });
          }
        }
        if (!t.fields.length) throw new PlcError(nameTok.line, `STRUCT '${nameTok.v}' has no members`);
      } else {
        const alias = this.typeSpec();
        this.ctx.types[N] = Object.assign({}, alias, { name: nameTok.v });
      }
      this.accOp(';');
    }
    this.accOp(';');
  }
  // constant initialisers: 5 · (A := 1, B := TRUE) · [1, 2, 3]
  initValue(t) {
    if (t.k === 'e') return coerce(t.b, this.expr().f());
    if (t.k === 'a') {
      this.expOp('[', ' — initialise an array like  := [1, 2, 3]');
      const a = [];
      if (!this.isOp(']')) do { a.push(this.initValue(t.of)); } while (this.accOp(','));
      this.expOp(']');
      return a;
    }
    this.expOp('(', ` — initialise a ${t.name} like  := (NAME := value, ...)`);
    const o = {};
    if (!this.isOp(')')) {
      do {
        const pn = this.expId(), P = pn.v.toUpperCase();
        let ft;
        if (t.k === 'f') { const d = FB_TYPES[t.name]; if (!(P in d.in)) throw new PlcError(pn.line, `${t.name} has no input '${pn.v}'. Inputs: ${Object.keys(d.in).join(', ')}`); ft = ET[d.in[P]] || elemT(ELEM[d.in[P]]); }
        else { const f = t.fields.find(x => x.N === P); if (!f) throw new PlcError(pn.line, `${t.name} has no member '${pn.v}'`); ft = f.t; }
        this.expOp(':=');
        o[P] = this.initValue(ft);
      } while (this.accOp(','));
    }
    this.expOp(')');
    return o;
  }

  varBlock() {
    this.next();   // VAR or VAR_GLOBAL
    let constant = false;
    const p0 = this.peek();
    if (p0.t === 'id' && /^(RETAIN|PERSISTENT|CONSTANT)$/i.test(p0.v)) { constant = /^CONSTANT$/i.test(p0.v); this.i++; }
    while (!this.accKw('END_VAR')) {
      if (this.peek().t === 'eof') this.fail('Expected END_VAR');
      const names = [this.expId()];
      while (this.accOp(',')) names.push(this.expId());
      this.expOp(':');
      const t = this.typeSpec();
      let init;
      if (this.accOp(':=')) init = this.initValue(t);
      this.expOp(';');
      for (const n of names) {
        const K = n.v.toUpperCase();
        if (this.tags[K]) {
          const o = this.tags[K];
          throw new PlcError(n.line, `'${n.v}' is already declared${o.kind !== 'MEM' && o.kind !== 'FB' ? ' (it is a built-in I/O or system tag)' : ''}`);
        }
        if (this.ctx.types[K]) throw new PlcError(n.line, `'${n.v}' is the name of a TYPE — pick another variable name`);
        let tag;
        if (t.k === 'f') { const st = makeVal(t, init); tag = { name: n.v, type: t.name, kind: 'FB', fb: st, v: st, t, desc: FB_TYPES[t.name].desc }; }
        else if (t.k === 'e') tag = { name: n.v, type: t.name, base: t.b, kind: 'MEM', v: makeVal(t, init), t, desc: '', constant };
        else tag = { name: n.v, type: t.name, kind: 'MEM', v: makeVal(t, init), t, desc: '' };
        this.tags[K] = tag;
        this.ctx.declared.push(K);
      }
    }
    this.accOp(';');
  }

  // ---------- access paths: Var · Var.Member · Var[i] · Var.3 (bit) · FbInst.Q ----------
  path(id) {
    const tag = this.ref(id);
    let t = tagType(tag), name = id.v, readonly = tag.kind === 'SYS' || tag.constant, fbOut = false;
    let get = tag.kind === 'FB' ? () => tag.fb : () => tag.v;
    let set = tag.kind === 'FB' ? null : v => { tag.v = v; };
    let depth = 0;
    for (;;) {
      if (this.isOp('.')) {
        this.i++;
        const m = this.next();
        const g = get, s = set;
        if (t.k === 's' && m.t === 'id') {
          const f = t.fields.find(x => x.N === m.v.toUpperCase());
          if (!f) throw new PlcError(m.line, `${t.name} has no member '${m.v}'. Members: ${t.fields.map(x => x.name).join(', ')}`);
          const F = f.N;
          get = () => g()[F]; set = v => { g()[F] = v; }; t = f.t; name += '.' + f.name;
        } else if (t.k === 'f' && m.t === 'id') {
          const d = FB_TYPES[t.name], M = m.v.toUpperCase(), ty = d.in[M] || d.out[M];
          if (!ty) throw new PlcError(m.line, `${t.name} has no member '${m.v}'. Members: ${[...Object.keys(d.in), ...Object.keys(d.out)].join(', ')}`);
          fbOut = !(M in d.in);
          get = () => g()[M]; set = v => { g()[M] = v; }; t = ET[ty] || elemT(ELEM[ty]); name += '.' + M;
        } else if (t.k === 'e' && t.b === 'INT' && m.t === 'num' && Number.isInteger(m.v) && m.v >= 0 && m.v < 32) {
          const n = m.v;
          get = () => ((g() >>> n) & 1) === 1;
          set = v => { s(v ? (g() | (1 << n)) : (g() & ~(1 << n))); };
          t = BOOLT; name += '.' + n;
        } else if (t.k === 'e' && m.t === 'num') {
          throw new PlcError(m.line, `Bit access needs an integer variable and a bit number 0–31 (e.g. Word.3)`);
        } else throw new PlcError(m.line, `'${name}' has no members`);
      } else if (this.isOp('[')) {
        if (t.k !== 'a') throw new PlcError(this.peek().line, `'${name}' is not an array`);
        const line = this.peek().line;
        this.i++;
        const e = this.expr(); this.expOp(']');
        this.elem(e, line);
        const lo = t.lo, hi = t.hi, g = get, ef = e.f;
        const idx = () => { const i = Math.trunc(num(ef())); if (!(i >= lo && i <= hi)) throw new RtError(`Array index ${i} out of range [${lo}..${hi}] for ${name} (line ${line})`); return i - lo; };
        get = () => g()[idx()]; set = v => { g()[idx()] = v; }; t = t.of; name += '[]';
      } else break;
      depth++;
    }
    return { t, get, set, name, tag, readonly: readonly && depth === 0, fbOut, line: id.line };
  }
  elem(e, line) {
    if (e.ty === 'ANY') throw new PlcError(line || this.peek().line, `A ${e.t ? e.t.name : 'structure'} can't be used in an expression — pick one of its members`);
    return e;
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
        case 'VAR': case 'VAR_GLOBAL': case 'TYPE': throw new PlcError(p.line, `${p.v} blocks must be at the top level, not inside a statement`);
      }
      throw new PlcError(p.line, `Unexpected '${p.v}' (check for a missing or extra END_IF / END_CASE / semicolon)`);
    }
    if (p.t === 'id') {
      // procedure-style call of a function (BSL(...), FB_RESET(...)): not a variable
      if (this.peek(1).t === 'op' && this.peek(1).v === '(' && !this.tags[p.v.toUpperCase()]) {
        this.i++;
        const e = this.funcCall(p);
        this.expOp(';', ' at end of statement');
        const f = e.f; return () => { f(); };
      }
      this.i++;
      const pa = this.path(p);
      if (this.isOp('(')) return this.fbCall(pa);
      if (this.isOp('=')) this.fail("Expected ':=' (use := for assignment, = is a comparison)");
      this.expOp(':=');
      const e = this.expr();
      this.expOp(';', ' at end of statement');
      return this.assign(pa, e);
    }
    this.fail('Expected a statement');
  }
  assign(pa, e) {
    if (pa.readonly) throw new PlcError(pa.line, `'${pa.name}' is read-only`);
    if (pa.fbOut) throw new PlcError(pa.line, `'${pa.name}' is a function block output and can't be written`);
    const t = pa.t, set = pa.set;
    if (t.k === 'f' || !set) throw new PlcError(pa.line, `Can't assign to a function block instance. Call it instead: ${pa.name}(...);`);
    if (t.k === 'e') { this.elem(e, pa.line); const f = e.f, b = t.b; return () => { set(coerce(b, f())); }; }
    if (!e.t || !sameType(t, e.t)) throw new PlcError(pa.line, `Type mismatch: '${pa.name}' is ${t.name}${e.t ? ', value is ' + e.t.name : ''}`);
    const f = e.f; return () => { set(clone(t, f())); };
  }

  fbCall(pa) {
    if (pa.t.k !== 'f') throw new PlcError(pa.line, `'${pa.name}' is not a function block instance, so it can't be called`);
    const T = pa.t.name, def = FB_TYPES[T], get = pa.get, sets = [], outs = [];
    this.expOp('(');
    if (!this.isOp(')')) {
      do {
        const pn = this.expId(), P = pn.v.toUpperCase();
        if (this.accOp(':=')) {
          if (!(P in def.in)) throw new PlcError(pn.line, `${T} has no input '${pn.v}'. Inputs: ${Object.keys(def.in).join(', ')}`);
          const e = this.elem(this.expr(), pn.line), ty = ELEM[def.in[P]], f = e.f;
          sets.push(st => { st[P] = coerce(ty, f()); });
        } else if (this.accOp('=>')) {
          if (!(P in def.out)) throw new PlcError(pn.line, `${T} has no output '${pn.v}'. Outputs: ${Object.keys(def.out).join(', ')}`);
          const tgt = this.expId();
          const lp = this.path(tgt);
          const ty = ET[def.out[P]] || elemT(ELEM[def.out[P]]);
          let cur;
          const asg = this.assign(lp, { ty: ty.b, t: ty, f: () => cur[P] });
          outs.push(st => { cur = st; asg(); });
        } else this.fail(`Expected ':=' after parameter '${pn.v}'`);
      } while (this.accOp(','));
    }
    this.expOp(')');
    this.expOp(';', ' at end of statement');
    const run = def.run;
    return () => {
      const st = get();
      for (let i = 0; i < sets.length; i++) sets[i](st);
      run(st, RT.dt);
      for (let i = 0; i < outs.length; i++) outs[i](st);
    };
  }

  ifStmt() {
    this.expKw('IF');
    const branches = [];
    let c = this.elem(this.expr()); this.expKw('THEN');
    branches.push([c.f, this.block(['ELSIF', 'ELSE', 'END_IF'])]);
    let els = null;
    for (;;) {
      if (this.accKw('ELSIF')) { c = this.elem(this.expr()); this.expKw('THEN'); branches.push([c.f, this.block(['ELSIF', 'ELSE', 'END_IF'])]); }
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
    const sel = this.elem(this.expr()); this.expKw('OF');
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
    if (tag.kind !== 'MEM' || !tag.base || tag.base === 'BOOL') throw new PlcError(id.line, 'FOR loop variable must be a declared INT/DINT variable');
    this.expOp(':=');
    const a = this.elem(this.expr()); this.expKw('TO');
    const b = this.elem(this.expr());
    let st = { f: () => 1 };
    if (this.accKw('BY')) st = this.elem(this.expr());
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
    const c = this.elem(this.expr()); this.expKw('DO');
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
    const c = this.elem(this.expr()); this.expKw('END_REPEAT'); this.accOp(';');
    const f = c.f;
    return () => {
      let n = 0;
      try {
        do { body(); if (++n > LOOP_MAX) throw new RtError(`REPEAT loop ran ${LOOP_MAX} times in one scan — infinite loop? (line ${line})`); } while (!truthy(f()));
      } catch (e) { if (e !== EXIT) throw e; }
    };
  }

  // ---------- expressions ----------
  expr() { return this.orE(); }
  bin(next, ops, mk) {
    let l = next.call(this);
    for (;;) {
      const p = this.peek();
      if (!((p.t === 'op' || p.t === 'kw') && ops.includes(p.v))) return l;
      this.i++;
      const r = next.call(this);
      this.elem(l, p.line); this.elem(r, p.line);
      l = mk(p.v, l, r, p.line);
    }
  }
  // AND/OR/XOR: logical on BOOL, bitwise on integers
  logic(op, a, b) {
    const f = a.f, g = b.f;
    if (a.ty === 'INT' && b.ty === 'INT') {
      if (op === 'OR') return { ty: 'INT', f: () => num(f()) | num(g()) };
      if (op === 'XOR') return { ty: 'INT', f: () => num(f()) ^ num(g()) };
      return { ty: 'INT', f: () => num(f()) & num(g()) };
    }
    if (op === 'OR') return { ty: 'BOOL', f: () => truthy(f()) || truthy(g()) };
    if (op === 'XOR') return { ty: 'BOOL', f: () => truthy(f()) !== truthy(g()) };
    return { ty: 'BOOL', f: () => truthy(f()) && truthy(g()) };
  }
  orE() { return this.bin(this.xorE, ['OR'], (o, a, b) => this.logic('OR', a, b)); }
  xorE() { return this.bin(this.andE, ['XOR'], (o, a, b) => this.logic('XOR', a, b)); }
  andE() { return this.bin(this.eqE, ['AND', '&'], (o, a, b) => this.logic('AND', a, b)); }
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
    if (p.t === 'kw' && p.v === 'NOT') {
      this.i++; const a = this.elem(this.unary(), p.line), f = a.f;
      if (a.ty === 'INT') return { ty: 'INT', f: () => ~num(f()) };
      return { ty: 'BOOL', f: () => !truthy(f()) };
    }
    if (p.t === 'op' && p.v === '-') { this.i++; const a = this.elem(this.unary(), p.line), f = a.f; return { ty: a.ty === 'BOOL' ? 'INT' : a.ty, f: () => -num(f()) }; }
    if (p.t === 'op' && p.v === '+') { this.i++; return this.unary(); }
    return this.primary();
  }
  primary() {
    const p = this.next();
    if (p.t === 'num') { const v = p.v; return { ty: p.time ? 'TIME' : p.real ? 'REAL' : 'INT', f: () => v }; }
    if (p.t === 'kw' && (p.v === 'TRUE' || p.v === 'FALSE')) { const v = p.v === 'TRUE'; return { ty: 'BOOL', f: () => v }; }
    if (p.t === 'op' && p.v === '(') { const e = this.expr(); this.expOp(')'); return e; }
    if (p.t === 'id') {
      if (this.isOp('(') && !this.tags[p.v.toUpperCase()]) return this.funcCall(p);
      const pa = this.path(p);
      if (this.isOp('(')) throw new PlcError(p.line, `Function block calls must be a statement on their own: ${pa.name}(...);`);
      if (pa.t.k === 'e') return { ty: pa.t.b, t: pa.t, f: pa.get };
      if (pa.t.k === 'f') {
        const o = Object.keys(FB_TYPES[pa.t.name].out)[0];
        throw new PlcError(p.line, `'${pa.name}' is a ${pa.t.name}; read one of its outputs, e.g. ${pa.name}.${o}`);
      }
      return { ty: 'ANY', t: pa.t, f: pa.get, path: pa };
    }
    this.i--;
    this.fail('Expected a value or expression');
  }
  funcCall(id) {
    const N = id.v.toUpperCase();
    this.expOp('(');
    const args = [];
    if (!this.isOp(')')) { do { args.push(this.expr()); } while (this.accOp(',')); }
    this.expOp(')');
    const need = n => { if (args.length !== n) throw new PlcError(id.line, `${id.v} expects ${n} argument(s), got ${args.length}`); };
    // ---- array / structure built-ins ----
    if (N === 'BSL' || N === 'BSR') {
      need(2);
      const arr = args[0];
      if (!arr.t || arr.t.k !== 'a') throw new PlcError(id.line, `${N}: the first argument must be an ARRAY (e.g. ${N}(Track, NewBit))`);
      const et = arr.t.of, inp = args[1];
      let getIn;
      if (et.k === 'e') { this.elem(inp, id.line); const f = inp.f, b = et.b; getIn = () => coerce(b, f()); }
      else {
        if (!inp.t || !sameType(et, inp.t)) throw new PlcError(id.line, `${N}: the value shifted in must be a ${et.name}`);
        const f = inp.f; getIn = () => clone(et, f());
      }
      const ga = arr.f, left = N === 'BSL';
      return { ty: et.k === 'e' ? et.b : 'ANY', t: et, f: () => {
        const a = ga(), v = getIn(), n = a.length;
        let out;
        if (left) { out = a[n - 1]; for (let i = n - 1; i > 0; i--) a[i] = a[i - 1]; a[0] = v; }
        else { out = a[0]; for (let i = 0; i < n - 1; i++) a[i] = a[i + 1]; a[n - 1] = v; }
        return out;
      } };
    }
    if (N === 'LOWER_BOUND' || N === 'UPPER_BOUND') {
      if (args.length < 1 || !args[0].t || args[0].t.k !== 'a') throw new PlcError(id.line, `${N}(array, 1) needs an ARRAY`);
      const v = N === 'LOWER_BOUND' ? args[0].t.lo : args[0].t.hi; return { ty: 'INT', f: () => v };
    }
    if (N === 'FB_RESET') {
      need(1);
      const a = args[0];
      const pa = a.path;
      if (!pa) {
        // FB instances are rejected by primary(); re-parse isn't possible, so FB_RESET takes the instance via a path marker
        throw new PlcError(id.line, 'FB_RESET needs a function block instance, e.g. FB_RESET(MyTimer)');
      }
      throw new PlcError(id.line, 'FB_RESET needs a function block instance');
    }
    const fs = args.map(a => this.elem(a, id.line).f);
    const m = /^[A-Z]+_TO_([A-Z]+)$/.exec(N);
    if (m && ELEM[m[1]]) { need(1); const b = ELEM[m[1]], f = fs[0]; return { ty: b, f: () => coerce(b, f()) }; }
    const real1 = fn => { need(1); const f = fs[0]; return { ty: 'REAL', f: () => fn(num(f())) }; };
    const sh = fn => { need(2); const [a, b] = fs; return { ty: 'INT', f: () => fn(num(a()) | 0, Math.max(0, Math.min(31, num(b()) | 0))) }; };
    switch (N) {
      case 'ABS': { need(1); const f = fs[0]; return { ty: args[0].ty, f: () => Math.abs(num(f())) }; }
      case 'SQRT': return real1(Math.sqrt);
      case 'SIN': return real1(Math.sin);
      case 'COS': return real1(Math.cos);
      case 'EXP': return real1(Math.exp);
      case 'LN': return real1(Math.log);
      case 'TRUNC': { need(1); const f = fs[0]; return { ty: 'INT', f: () => Math.trunc(num(f())) }; }
      case 'SHL': return sh((x, n) => (x << n) | 0);
      case 'SHR': return sh((x, n) => (x >>> n) | 0);
      case 'ROL': return sh((x, n) => ((x << n) | (x >>> (32 - n))) | 0);
      case 'ROR': return sh((x, n) => ((x >>> n) | (x << (32 - n))) | 0);
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

// FB_RESET(instance) is handled before expression parsing, because FB instances are not values.
const _stmt = Parser.prototype.stmt;
Parser.prototype.stmt = function () {
  const p = this.peek();
  if (p.t === 'id' && p.v.toUpperCase() === 'FB_RESET' && this.peek(1).t === 'op' && this.peek(1).v === '(') {
    this.i += 2;
    const id = this.expId();
    const pa = this.path(id);
    if (pa.t.k !== 'f') throw new PlcError(id.line, `FB_RESET needs a function block instance; '${pa.name}' is ${pa.t.name}`);
    this.expOp(')'); this.expOp(';', ' at end of statement');
    const g = pa.get, T = pa.t.name;
    return () => { fbReset(g(), T); };
  }
  return _stmt.call(this);
};

/**
 * Compile a project: an ordered list of units [{name, src}] sharing one tag table and type registry.
 * Returns { fn, declared, types }. Throws PlcError with .unit set.
 */
function compileUnits(units, tags) {
  const ctx = { tags, types: {}, declared: [] };
  const fns = [];
  for (const u of units) {
    try {
      const p = new Parser(tokenize(u.src || ''), ctx);
      fns.push(p.unit());
    } catch (e) {
      if (e instanceof PlcError) e.unit = u.name;
      throw e;
    }
  }
  const fn = () => { for (let i = 0; i < fns.length; i++) fns[i](); };
  return { fn, declared: ctx.declared, types: ctx.types };
}
function compile(src, tags) { return compileUnits([{ name: 'Main', src }], tags); }

module.exports = { compile, compileUnits, PlcError, RtError, FB_TYPES, ELEM, ET, RT, truthy, num, coerce, defVal, newFb, makeVal, tagType, clone };
