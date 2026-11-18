'use strict';
/*
 * Ladder Diagram → Structured Text.
 *
 * A rung is { comment, rows: [[input…], …], post: [input…], outs: [output…] }:
 *   rows are parallel branches (OR), each row is contacts in series (AND);
 *   post (optional) are contacts in series after the branches, e.g. (Start OR Run) AND Stop.
 *   Every output is driven by the rung result (outputs in parallel).
 *
 * Inputs:  NO a · NC a · P a (rising edge) · N a (falling edge) · ONS a=storage bit (one-shot of the rung so far) · CMP a op b
 * Outputs: COIL a · NCOIL a · SET a · RST a
 *          TON/TOF/TP a=instance b=preset · CTU/CTD a=instance b=preset · RES a=instance
 *          MOV a→b · ADD/SUB/MUL/DIV a,b→c · BSL/BSR a=array b=bit/value (on rung rising edge)
 *          ST a = one ST statement executed while the rung is true
 */
const INPUTS = ['NO', 'NC', 'P', 'N', 'ONS', 'CMP'];
const OUTPUTS = ['COIL', 'NCOIL', 'SET', 'RST', 'TON', 'TOF', 'TP', 'CTU', 'CTD', 'RES', 'MOV', 'ADD', 'SUB', 'MUL', 'DIV', 'BSL', 'BSR', 'ST'];
const CMP_OPS = ['=', '<>', '>', '>=', '<', '<='];

class LdError extends Error { constructor(rung, msg) { super(msg); this.rung = rung; } }

function operand(v, rung, what) {
  const s = String(v == null ? '' : v).trim();
  if (!s) throw new LdError(rung, `${what} is empty`);
  if (/[;\n\r]|\(\*|\*\)|\/\//.test(s)) throw new LdError(rung, `${what} '${s}' contains characters that aren't allowed`);
  return s;
}

function toST(pou, uidx) {
  const P = `_L${uidx}_`;
  const lines = [], map = [];
  const decl = [`${P}R : BOOL;`];
  let edge = 0;
  const emit = (s, r) => { lines.push(s); map.push(r); };
  const rungs = Array.isArray(pou.rungs) ? pou.rungs : [];
  const body = [];
  rungs.forEach((rung, ri) => {
    const r = ri + 1;
    const out = [];
    const pre = [];
    const rows = (rung.rows || []).filter(row => row && row.length);
    const contact = el => {
      if (!INPUTS.includes(el.t)) throw new LdError(r, `'${el.t}' can't be used as an input contact`);
      if (el.t === 'NO') return operand(el.a, r, 'Contact tag');
      if (el.t === 'NC') return `NOT ${operand(el.a, r, 'Contact tag')}`;
      if (el.t === 'P' || el.t === 'N') {
        const n = `${P}E${++edge}`;
        decl.push(`${n} : ${el.t === 'P' ? 'R_TRIG' : 'F_TRIG'};`);
        pre.push(`${n}(CLK := ${operand(el.a, r, 'Edge contact tag')});`);
        return `${n}.Q`;
      }
      if (!CMP_OPS.includes(el.op)) throw new LdError(r, `Unknown compare '${el.op}'`);
      return `(${operand(el.a, r, 'Compare A')} ${el.op} ${operand(el.b, r, 'Compare B')})`;
    };
    // series evaluation left to right; ONS turns "the rung so far" into a one-scan pulse (storage bit keeps last state)
    const series = (els, start) => {
      let acc = start;
      for (const el of els) {
        if (el.t === 'ONS') {
          const st = operand(el.a, r, 'ONS storage bit'), n = `${P}O${++edge}`, prefix = acc || 'TRUE';
          decl.push(`${n} : BOOL;`);
          pre.push(`${n} := (${prefix}) AND NOT ${st};`, `${st} := (${prefix});`);
          acc = n;
        } else { const c = `(${contact(el)})`; acc = acc ? `${acc} AND ${c}` : c; }
      }
      return acc;
    };
    const terms = rows.map(row => series(row, null));
    let cond = terms.length ? terms.map(t => `(${t})`).join(' OR ') : 'TRUE';
    if ((rung.post || []).length) cond = series(rung.post, `(${cond})`);
    pre.forEach(s => out.push(s));
    out.push(`${P}R := ${cond};`);
    for (const o of rung.outs || []) {
      const R = `${P}R`;
      switch (o.t) {
        case 'COIL': out.push(`${operand(o.a, r, 'Coil tag')} := ${R};`); break;
        case 'NCOIL': out.push(`${operand(o.a, r, 'Coil tag')} := NOT ${R};`); break;
        case 'SET': out.push(`IF ${R} THEN ${operand(o.a, r, 'Set coil tag')} := TRUE; END_IF;`); break;
        case 'RST': out.push(`IF ${R} THEN ${operand(o.a, r, 'Reset coil tag')} := FALSE; END_IF;`); break;
        case 'TON': case 'TOF': case 'TP':
          out.push(`${operand(o.a, r, 'Timer instance')}(IN := ${R}, PT := ${operand(o.b || 'T#1s', r, 'Timer preset')});`); break;
        case 'CTU': out.push(`${operand(o.a, r, 'Counter instance')}(CU := ${R}, PV := ${operand(o.b || '10', r, 'Counter preset')});`); break;
        case 'CTD': out.push(`${operand(o.a, r, 'Counter instance')}(CD := ${R}, PV := ${operand(o.b || '10', r, 'Counter preset')});`); break;
        case 'RES': out.push(`IF ${R} THEN FB_RESET(${operand(o.a, r, 'Reset target')}); END_IF;`); break;
        case 'MOV': out.push(`IF ${R} THEN ${operand(o.b, r, 'MOV destination')} := ${operand(o.a, r, 'MOV source')}; END_IF;`); break;
        case 'ADD': case 'SUB': case 'MUL': case 'DIV': {
          const op = { ADD: '+', SUB: '-', MUL: '*', DIV: '/' }[o.t];
          out.push(`IF ${R} THEN ${operand(o.c, r, o.t + ' destination')} := ${operand(o.a, r, o.t + ' A')} ${op} ${operand(o.b, r, o.t + ' B')}; END_IF;`); break;
        }
        case 'BSL': case 'BSR': {
          const n = `${P}E${++edge}`;
          decl.push(`${n} : R_TRIG;`);
          out.push(`${n}(CLK := ${R});`);
          out.push(`IF ${n}.Q THEN ${o.t}(${operand(o.a, r, 'Shift array')}, ${operand(o.b, r, 'Shift-in value')}); END_IF;`); break;
        }
        case 'ST': out.push(`IF ${R} THEN ${operand(o.a, r, 'ST statement').replace(/;?\s*$/, ';')} END_IF;`.replace(/;;/g, ';')); break;
        default: throw new LdError(r, `'${o.t}' can't be used as an output`);
      }
    }
    if (!(rung.outs || []).length) throw new LdError(r, 'Rung has no output (add a coil or an instruction on the right)');
    body.push({ r, lines: out, comment: rung.comment });
  });
  emit(`(* ${pou.name} — generated from ladder *)`, 0);
  emit('VAR', 0);
  decl.forEach(d => emit('  ' + d, 0));
  emit('END_VAR', 0);
  for (const b of body) {
    emit(`(* Rung ${b.r}${b.comment ? ': ' + String(b.comment).replace(/\*\)/g, '') : ''} *)`, b.r);
    for (const l of b.lines) emit(l, b.r);
  }
  return { src: lines.join('\n'), map };
}

module.exports = { toST, LdError, INPUTS, OUTPUTS, CMP_OPS };
