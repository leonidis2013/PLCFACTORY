'use strict';
/*
 * Lesson grading beyond pass/fail:
 *   correctness 60 % — the lesson objectives
 *   robustness  25 % — the same objectives at a fast and a slow scan, two minutes of random operation
 *                      without damaging the machine, and a safe power-up
 *   simplicity  15 % — program size against the reference solution, and unused variables
 * Robustness is only measured once every objective passes.
 */
const { grade, Harness, Fail } = require('./grader');

const W = { correct: 60, scan: 10, fuzz: 10, power: 5, simple: 15 };

function seeded(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// ---------------------------------------------------------------- robustness
function scanCheck(plants, project, objectives) {
  for (const ms of [10, 100]) {
    const r = grade(plants, project, objectives, { scanMs: ms });
    const bad = r.find(x => !x.pass);
    if (bad) return { pass: false, msg: `At a ${ms} ms scan: “${bad.text}” — ${bad.msg}. Logic that depends on the scan time (counting scans, missing short pulses) breaks when the PLC is loaded or upgraded.` };
  }
  return { pass: true, msg: 'All objectives also pass at 10 ms and 100 ms scan times.' };
}

/** names of outputs that make something move or heat (not lamps, stack lights or horns) */
function motionOutputs(h) {
  const L = (h.rt.def.layout || { components: [] }).components;
  const ind = new Set();
  for (const c of L) {
    if (c.type === 'pilot') ind.add(('Q_' + c.name).toUpperCase());
    if (c.type === 'stacklight') for (const k of ['Red', 'Amber', 'Green', 'Horn']) ind.add(`Q_${c.name}_${k}`.toUpperCase());
  }
  return h.rt.def.actuators.map(a => a[0]).filter(n => !ind.has(n.toUpperCase()));
}

function damage(h) {
  const st = h.rt.st, L = (h.rt.def.layout || { components: [] }).components, o = h.rt.outputs();
  for (const c of L) {
    const s = st.c[c.id];
    if (c.type === 'motor' && s.ol) return `${c.name}'s overload relay tripped (${s.olWhy || 'overload'})`;
    if (c.type === 'tank' && s.overflow) return `${c.name} overflowed`;
    if (c.type === 'pump' && s.dry > 1) return `${c.name} ran dry`;
    if (c.type === 'heater' && st.faults[`${c.id}.burnt`]) return `${c.name} burned out (energised without liquid)`;
    if (c.type === 'conveyor' && s.items.some(i => i.state === 'jam')) return `a part jammed on ${c.name}`;
    if ((c.type === 'motor' || c.type === 'conveyor') && c.props.reversible && o[`Q_${c.name}_Fwd`] && o[`Q_${c.name}_Rev`]) return `${c.name} FWD and REV were energised together`;
  }
  return null;
}

function fuzzCheck(plants, project) {
  const rnd = Math.random;
  Math.random = seeded(4242);
  try {
    const h = new Harness(plants, project);
    const rand = seeded(97);
    const L = (h.rt.def.layout || { components: [] }).components;
    const ctrls = L.filter(c => ['pushbutton', 'selector', 'pot', 'estop'].includes(c.type));
    if (!ctrls.length) return { pass: true, msg: 'No operator controls to exercise.' };
    let why = null, actions = 0;
    const last = [];
    h.watch(() => { if (!why) why = damage(h); });
    for (let t = 0; t < 120 && !why; ) {
      const c = ctrls[Math.floor(rand() * ctrls.length)], p = c.props;
      let what = '';
      if (c.type === 'pushbutton') { const hold = 0.1 + rand() * 1.2; h.press(c.name).run(hold); h.release(c.name); t += hold; what = `${c.name} pressed ${hold.toFixed(1)} s`; }
      else if (c.type === 'selector') { const n = Math.floor(rand() * +p.positions); h.select(c.name, n); what = `${c.name} → ${(p.labels.split(',')[n] || n)}`; }
      else if (c.type === 'pot') { const v = +p.min + rand() * (+p.max - +p.min); h.pot(c.name, v); what = `${c.name} → ${v.toFixed(1)}`; }
      else if (c.type === 'estop') { if (rand() < 0.25) { const on = !h.state(c.name).tripped; h.estop(c.name, on); what = `${c.name} ${on ? 'pressed' : 'released'}`; } else continue; }
      last.push(what); if (last.length > 4) last.shift(); actions++;
      const gap = 0.3 + rand() * 2.5; h.run(gap); t += gap;
    }
    if (why) return { pass: false, msg: `After ${actions} random operator actions, ${why}. Last actions: ${last.join(' · ')}.` };
    return { pass: true, msg: `${actions} random operator actions over two minutes — no damage, no faults.` };
  } catch (e) {
    return { pass: false, msg: e instanceof Fail ? e.message : 'Test error: ' + e.message };
  } finally { Math.random = rnd; }
}

function powerCheck(plants, project, lesson) {
  if (lesson.powerUpOK) return { pass: true, msg: 'This machine is meant to act on its own at power-up (automatic process).' };
  try {
    const h = new Harness(plants, project), names = motionOutputs(h);
    let on = null;
    h.always(() => { const o = h.rt.outputs(); on = names.find(n => o[n] === true || (typeof o[n] === 'number' && o[n] > 0)); return !on; }, 3);
    if (on) return { pass: false, msg: `${on} switched on at power-up with nobody touching anything. Machines must not start by themselves when the PLC starts (EN 60204-1).` };
    return { pass: true, msg: 'Nothing moves at power-up until an operator acts.' };
  } catch (e) { return { pass: false, msg: e instanceof Fail ? e.message : 'Test error: ' + e.message }; }
}

// ---------------------------------------------------------------- simplicity
const DECL_BLOCK = /\b(VAR(?:_GLOBAL|_INPUT|_OUTPUT|_IN_OUT|_TEMP)?|TYPE)\b[\s\S]*?\bEND_(VAR|TYPE)\b/gi;
const stripComments = s => String(s || '').replace(/\(\*[\s\S]*?\*\)/g, ' ').replace(/\/\/[^\n]*/g, ' ');
const TOKEN = /[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])?(?:\.[A-Za-z_][A-Za-z0-9_]*)*|T#[\w.]+|\d+(?:\.\d+)?|:=|<>|<=|>=|[-+*/=<>]/g;

function measure(units) {
  let size = 0, rungs = 0, elements = 0, statements = 0, code = '';
  const decl = [];
  const collectDecl = txt => {
    for (const blk of stripComments(txt).match(/\bVAR(?:_GLOBAL)?\b[\s\S]*?\bEND_VAR\b/gi) || [])
      for (const part of blk.replace(/^\s*VAR(?:_GLOBAL)?\b/i, '').replace(/\bEND_VAR\b\s*$/i, '').split(';')) {
        const m = /^\s*([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*:(?!=)/.exec(part);
        if (m) for (const n of m[1].split(',')) decl.push(n.trim());
      }
  };
  collectDecl(units.globals);
  for (const p of units.pous || []) {
    if (p.lang === 'LD') {
      for (const r of p.rungs || []) {
        rungs++;
        const els = [].concat(...(r.rows || []), r.post || [], r.outs || []);
        elements += els.length;
        for (const e of els) {
          size += e.t === 'ST' ? Math.max(2, Math.ceil((String(e.a).match(TOKEN) || []).length / 3)) : 1;
          code += ' ' + [e.a, e.b, e.c].filter(Boolean).join(' ');
        }
        size += 1;
      }
    } else {
      collectDecl(p.src);
      const body = stripComments(p.src).replace(DECL_BLOCK, ' ');
      const tok = body.match(TOKEN) || [];
      statements += (body.match(/;/g) || []).length;
      size += Math.ceil(tok.length / 3);
      code += ' ' + body;
    }
  }
  return { size, rungs, elements, statements, decl, code };
}

function simplicity(units, lesson) {
  const lang = ((units.pous || [])[0] || {}).lang === 'LD' ? 'LD' : 'ST';
  const ref = measure(lang === 'LD' ? lesson.ld.solution : lesson.solution);
  const starter = measure(lang === 'LD' ? lesson.ld.starter : lesson.starter);
  const me = measure(units);
  const ratio = me.size / Math.max(1, ref.size);
  let score = ratio <= 1.15 ? 100 : Math.max(0, 100 - (ratio - 1.15) * 85);
  const given = new Set(starter.decl.map(n => n.toUpperCase()));
  const unused = [...new Set(me.decl)].filter(n => !given.has(n.toUpperCase()) && !new RegExp(`\\b${n}\\b`, 'i').test(me.code));
  score = Math.max(0, score - 10 * Math.min(3, unused.length));
  const unit = lang === 'LD' ? `${me.rungs} rungs, ${me.elements} instructions` : `${me.statements} statements`;
  const refUnit = lang === 'LD' ? `${ref.rungs} rungs, ${ref.elements} instructions` : `${ref.statements} statements`;
  const notes = [];
  notes.push(`Your program: ${unit} (size ${me.size}). Reference: ${refUnit} (size ${ref.size}).`);
  if (ratio > 1.15) notes.push(ratio >= 1.8 ? 'About twice the size of the reference — look for repeated logic or conditions that can be combined.' : 'A little larger than the reference — fine, but see if any rung or condition is redundant.');
  if (ratio < 0.85) notes.push('Shorter than the reference — nice.');
  if (unused.length) notes.push(`Declared but never used: ${unused.join(', ')} — delete them so the next engineer isn't left guessing.`);
  return { score: Math.round(score), ratio: +ratio.toFixed(2), lang, unused, notes };
}

// ---------------------------------------------------------------- overall
function letter(s) { return s >= 90 ? 'A' : s >= 80 ? 'B' : s >= 70 ? 'C' : s >= 60 ? 'D' : 'F'; }

/** outputs of the machine that no program writes (coil, set/reset, move/math destination, ST assignment) */
function undriven(project, outputs) {
  const written = new Set();
  for (const p of project.pous || []) {
    if (p.lang === 'LD') for (const r of p.rungs || []) for (const o of r.outs || []) {
      if (['COIL', 'NCOIL', 'SET', 'RST'].includes(o.t)) written.add(String(o.a).trim().toUpperCase());
      if (o.t === 'MOV') written.add(String(o.b).trim().toUpperCase());
      if (['ADD', 'SUB', 'MUL', 'DIV'].includes(o.t)) written.add(String(o.c).trim().toUpperCase());
      if (o.t === 'ST') for (const m of String(o.a).matchAll(/([A-Za-z_]\w*)\s*:=/g)) written.add(m[1].toUpperCase());
    } else for (const m of stripComments(p.src).matchAll(/([A-Za-z_]\w*)\s*:=/g)) written.add(m[1].toUpperCase());
  }
  return outputs.filter(n => !written.has(n.toUpperCase()));
}
function evaluate(plants, project, lesson, results) {
  const passed = results.filter(r => r.pass).length, total = results.length, all = passed === total;
  const correct = W.correct * passed / total;
  const simple = simplicity(project, lesson);
  const checks = [];
  if (all) {
    const s1 = scanCheck(plants, project, lesson.objectives), s2 = fuzzCheck(plants, project), s3 = powerCheck(plants, project, lesson);
    checks.push({ id: 'scan', text: 'Works at any scan time', weight: W.scan, ...s1 });
    checks.push({ id: 'fuzz', text: 'Survives random operation', weight: W.fuzz, ...s2 });
    checks.push({ id: 'power', text: 'Safe power-up', weight: W.power, ...s3 });
  }
  const robust = checks.reduce((a, c) => a + (c.pass ? c.weight : 0), 0);
  const simplePts = all ? W.simple * simple.score / 100 : 0;
  const score = Math.round(correct + robust + simplePts);
  let notDriven = [];
  try { const { makeSandbox, normalizeLayout } = require('../plants/sandbox'); const io = (lesson.task.match(/<code>([QA]O?_[A-Za-z0-9_]+)/g) || []).map(x => x.replace('<code>', ''));
    const outs = makeSandbox(normalizeLayout(lesson.layout).layout).actuators.map(a => a[0]).filter(n => lesson.task.includes(n) || io.includes(n));
    notDriven = undriven(project, outs); } catch (e) { notDriven = []; }
  return { notDriven,
    score, grade: all ? letter(score) : null, passed: all,
    parts: {
      correctness: { pts: Math.round(correct), of: W.correct, detail: `${passed} of ${total} objectives` },
      robustness: { pts: Math.round(robust), of: W.scan + W.fuzz + W.power, checks },
      simplicity: { pts: Math.round(simplePts), of: W.simple, ...simple },
    },
  };
}

module.exports = { evaluate, measure, simplicity, letter };
