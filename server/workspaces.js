'use strict';
/*
 * Workspaces & learning modes.
 *   practice : <plantId>          — the built-in plants (tank, conveyor, vialfiller, bioreactor)
 *   lesson   : lesson-<Lxx>       — guided learning path (sandbox machine + objectives)
 *   challenge: chal-<Cxx>         — troubleshooting with planted faults, timer and score
 *   sandbox  : sb-<slug>          — the learner's own machines
 * Each workspace keeps its own project file in DATA/projects/<ws>.json.
 */
const fs = require('fs');
const path = require('path');
const { normalizeProject } = require('./engine/runtime');
const { grade } = require('./engine/grader');
const { evaluate } = require('./engine/quality');
const { LESSONS, COURSES, MODULES } = require('./curriculum/lessons');
/** Difficulty: what the learner may lean on. easy = everything, moderate = earn hints by checking, realistic = plant-floor rules */
const DIFFS = {
  easy: { label: 'Easy', hints: 'always', solution: 'always', force: true, sim: true },
  moderate: { label: 'Moderate', hints: 'per-check', solution: 'after-3', force: true, sim: true },
  realistic: { label: 'Realistic', hints: 'none', solution: 'none', force: false, sim: false },
};
const { CHALLENGES, CAUSES } = require('./curriculum/challenges');
const { catalog } = require('./plants/sandbox');

const clone = o => JSON.parse(JSON.stringify(o));
const L = Object.fromEntries(LESSONS.map(x => [x.id, x]));
const CH = Object.fromEntries(CHALLENGES.map(x => [x.id, x]));

const TEMPLATES = {
  blank: { name: 'Blank machine', layout: { components: [] }, sensors: [] },
  starter: {
    name: 'Motor starter kit',
    layout: { components: [
      { id: 'start', type: 'pushbutton', name: 'Start', x: -1.2, y: -1, props: { color: 'green' } },
      { id: 'stop', type: 'pushbutton', name: 'Stop', x: -0.6, y: -1, props: { color: 'red' } },
      { id: 'run', type: 'pilot', name: 'RunLamp', x: 0, y: -1, props: { color: 'green' } },
      { id: 'm1', type: 'motor', name: 'M1', x: 1, y: 0.6, props: {} }] },
    sensors: [
      { id: 's1', tag: 'I_Start', type: 'discrete', signal: 'start.pressed', contact: 'NO', fault: 'none' },
      { id: 's2', tag: 'I_Stop', type: 'discrete', signal: 'stop.pressed', contact: 'NC', fault: 'none' },
      { id: 's3', tag: 'I_M1_Running', type: 'discrete', signal: 'm1.running', contact: 'NO', fault: 'none' }],
  },
  process: {
    name: 'Tank + pump skid',
    layout: { components: [
      { id: 't1', type: 'tank', name: 'T1', x: 0, y: 0.5, props: { capacity: 500, level: 20 } },
      { id: 'xv1', type: 'valve', name: 'XV1', x: -1.3, y: 0.5, props: { from: '@supply', to: 't1', flow: 200 } },
      { id: 'p1', type: 'pump', name: 'P1', x: 1.3, y: 0.5, props: { from: 't1', to: '@drain', flow: 150 } },
      { id: 'h1', type: 'heater', name: 'H1', x: 0, y: 0.5, props: { tank: 't1', scr: true } },
      { id: 'pot', type: 'pot', name: 'SP', x: -1, y: -1.2, props: { min: 0, max: 100, unit: '%' } }] },
    sensors: [
      { id: 's1', tag: 'AI_T1_Level', type: 'analog', signal: 't1.level', lo: 0, hi: 100, scale: 'eng', noise: 0.2, fault: 'none' },
      { id: 's2', tag: 'AI_T1_Temp', type: 'analog', signal: 't1.temp', lo: 0, hi: 100, scale: 'eng', noise: 0.1, fault: 'none' },
      { id: 's3', tag: 'AI_SP', type: 'analog', signal: 'pot.value', lo: 0, hi: 100, scale: 'eng', noise: 0, fault: 'none' }],
  },
  line: {
    name: 'Sorting conveyor',
    layout: { components: [
      { id: 'c1', type: 'conveyor', name: 'C1', x: -1.8, y: 0.5, props: { length: 3.6, speed: 0.3, interval: 2.5 } },
      { id: 'push', type: 'cylinder', name: 'Push', x: 0, y: 0, props: { conveyor: 'c1', pos: 2.4, mode: 'push' } },
      { id: 'start', type: 'pushbutton', name: 'Start', x: -1.6, y: -1.2, props: { color: 'green' } },
      { id: 'stop', type: 'pushbutton', name: 'Stop', x: -1, y: -1.2, props: { color: 'red' } },
      { id: 'sl', type: 'stacklight', name: 'SL', x: -0.3, y: -1.2, props: {} }] },
    sensors: [
      { id: 's1', tag: 'I_Start', type: 'discrete', signal: 'start.pressed', contact: 'NO', fault: 'none' },
      { id: 's2', tag: 'I_Stop', type: 'discrete', signal: 'stop.pressed', contact: 'NC', fault: 'none' },
      { id: 's3', tag: 'I_PE_Sort', type: 'probe', signal: 'c1.part', pos: 2450, contact: 'NO', fault: 'none' },
      { id: 's4', tag: 'I_Tall', type: 'probe', signal: 'c1.tall', pos: 2450, contact: 'NO', fault: 'none' }],
  },
};

const kindOf = ws => (ws.startsWith('lesson-') ? 'lesson' : ws.startsWith('chal-') ? 'challenge' : ws.startsWith('sb-') ? 'sandbox' : 'practice');
const slugify = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'machine';

class Workspaces {
  constructor(dataDir, plants, log) {
    this.dir = path.join(dataDir, 'projects');
    this.progFile = path.join(dataDir, 'progress.json');
    this.plants = plants;
    this.log = log;
    try { this.progress = JSON.parse(fs.readFileSync(this.progFile, 'utf8')); } catch { this.progress = {}; }
  }
  file(ws) { return path.join(this.dir, ws + '.json'); }
  valid(ws) {
    const k = kindOf(ws);
    if (k === 'practice') return !!this.plants[ws];
    if (k === 'lesson') return !!L[ws.slice(7)];
    if (k === 'challenge') return !!CH[ws.slice(5)];
    return /^sb-[a-z0-9-]{1,32}$/.test(ws) && fs.existsSync(this.file(ws));
  }

  // ---------- project construction ----------
  fresh(ws, opts = {}) {
    const k = kindOf(ws);
    const base = { ws, actFaults: {}, hmi: [], alarms: [], pens: [] };
    if (k === 'practice') return normalizeProject(Object.assign(base, { scen: ws }, this.plants[ws].defaults()));
    if (k === 'lesson') {
      const x = L[ws.slice(7)];
      const lang = opts.lang === 'LD' ? 'LD' : 'ST';
      return normalizeProject(Object.assign(base, { scen: 'sandbox', layout: clone(x.layout), sensors: clone(x.sensors), mission: { hints: 0, solution: false, lang } }, clone(lang === 'LD' ? x.ld.starter : x.starter)));
    }
    if (k === 'challenge') {
      const x = CH[ws.slice(5)];
      const p = normalizeProject(Object.assign(base, { scen: x.plant }, this.plants[x.plant].defaults()));
      if (x.setup) x.setup(p);
      const hidden = clone(x.hidden || {});
      p.challenge = { id: x.id, hidden: { sensors: hidden.sensors || {}, acts: hidden.acts || {} }, planted: [...Object.keys(hidden.sensors || {}).map(t => 's:' + t), ...Object.keys(hidden.acts || {}).map(a => 'a:' + a)],
        startedAt: Date.now(), hints: 0, replaced: [], attempts: 0, done: false, score: 0, loto: false, stops: 0 };
      return p;
    }
    const t = TEMPLATES[opts.template] || TEMPLATES.blank;
    return normalizeProject(Object.assign(base, { scen: 'sandbox', name: opts.name || t.name, layout: clone(t.layout), sensors: clone(t.sensors), types: '', globals: '',
      pous: [opts.lang === 'LD' ? { id: 'main', name: 'Main', lang: 'LD', rungs: [] } : { id: 'main', name: 'Main', lang: 'ST', src: '(* ' + (opts.name || t.name) + ' *)\n' }] }));
  }
  load(ws, user) {
    let p = null;
    try { p = JSON.parse(fs.readFileSync(this.file(ws), 'utf8')); } catch {}
    if (!p) return this.fresh(ws, { lang: user ? this.lang(user) : 'ST' });
    const k = kindOf(ws);
    if (k === 'practice') {
      // migrate 1.x project files
      const d = this.fresh(ws);
      if (p.pous === undefined && p.src === undefined) { p.pous = d.pous; p.types = d.types; p.globals = d.globals; }
      for (const key of ['sensors', 'hmi', 'alarms', 'pens', 'actFaults']) if (p[key] === undefined) p[key] = d[key];
      p.scen = ws;
    }
    if (k === 'lesson' || k === 'sandbox') p.scen = 'sandbox';
    if (k === 'lesson') p.layout = clone(L[ws.slice(7)].layout);   // the lesson machine is fixed
    p.ws = ws;
    for (const key of ['hmi', 'alarms', 'pens']) if (!Array.isArray(p[key])) p[key] = [];
    if (!p.actFaults) p.actFaults = {};
    if (!Array.isArray(p.sensors)) p.sensors = [];
    return normalizeProject(p);
  }
  save(p) { fs.writeFileSync(this.file(p.ws), JSON.stringify(p, null, 1)); }

  // ---------- sandboxes ----------
  sandboxes() {
    let names = [];
    try { names = fs.readdirSync(this.dir).filter(f => /^sb-.*\.json$/.test(f)); } catch {}
    return names.map(f => {
      const ws = f.slice(0, -5);
      let name = ws.slice(3), n = 0, at = 0;
      try { const p = JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8')); name = p.name || name; n = ((p.layout || {}).components || []).length; at = fs.statSync(path.join(this.dir, f)).mtimeMs; } catch {}
      return { id: ws, name, components: n, updated: at };
    }).sort((a, b) => b.updated - a.updated);
  }
  newSandbox(name, template, lang) {
    const base = 'sb-' + slugify(name);
    let ws = base, i = 2;
    while (fs.existsSync(this.file(ws))) ws = `${base}-${i++}`;
    const p = this.fresh(ws, { name: String(name || '').slice(0, 48) || undefined, template, lang });
    this.save(p);
    return ws;
  }
  deleteSandbox(ws) { if (kindOf(ws) !== 'sandbox') return false; try { fs.unlinkSync(this.file(ws)); return true; } catch { return false; } }

  // ---------- progress ----------
  prog(user) { return (this.progress[user] = this.progress[user] || { lessons: {}, challenges: {} }); }
  writeProgress() { try { fs.writeFileSync(this.progFile, JSON.stringify(this.progress, null, 1)); } catch (e) { this.log('Could not save progress: ' + e.message); } }
  lang(user) { return (this.progress[user] || {}).lang === 'LD' ? 'LD' : 'ST'; }
  diff(user) { const d = (this.progress[user] || {}).diff; return DIFFS[d] ? d : 'easy'; }
  setDiff(user, d) { if (!DIFFS[d]) return false; this.prog(user).diff = d; this.writeProgress(); return true; }
  /** what the current lesson allows right now */
  allow(p, user) {
    const d = this.diff(user), D = DIFFS[d], m = p.mission || {}, x = L[(p.ws || '').slice(7)];
    const H = x ? (m.lang === 'LD' ? x.ld.hints : x.hints).length : 0, checks = m.checks || 0;
    const hints = D.hints === 'always' ? H : D.hints === 'per-check' ? Math.min(H, checks) : 0;
    const solution = D.solution === 'always' || (D.solution === 'after-3' && checks >= 3);
    return { diff: d, label: D.label, hints, solution, force: D.force, sim: D.sim, checks };
  }
  setDefaultLang(user, lang) { this.prog(user).lang = lang === 'LD' ? 'LD' : 'ST'; this.writeProgress(); }
  /** switch a lesson to the other language: returns the starter units in that language */
  setLessonLang(p, user, lang) {
    lang = lang === 'LD' ? 'LD' : 'ST';
    const x = L[p.ws.slice(7)];
    p.mission = p.mission || { hints: 0, solution: false };
    p.mission.lang = lang; p.mission.results = null;
    this.setDefaultLang(user, lang);
    return clone(lang === 'LD' ? x.ld.starter : x.starter);
  }
  resetProgress(user) { delete this.progress[user]; this.writeProgress(); }

  // ---------- listing ----------
  list(user) {
    const pr = this.prog(user);
    return {
      practice: Object.values(this.plants).map(p => ({ id: p.id, name: p.name, blurb: p.blurb })),
      courses: COURSES, modules: MODULES.map(m => ({ id: m.id, course: m.course, title: m.title, lessons: m.lessons })), diff: this.diff(user), diffs: Object.entries(DIFFS).map(([id, v]) => ({ id, label: v.label })),
      lessons: LESSONS.map(x => ({ id: x.id, ws: 'lesson-' + x.id, unit: x.unit, module: x.module, course: x.course, capstone: !!x.capstone, real: !!(pr.lessons[x.id] || {}).real, title: x.title, summary: x.summary, minutes: x.minutes, objectives: x.objectives.length,
        done: !!(pr.lessons[x.id] || {}).done, best: (pr.lessons[x.id] || {}).passed || 0, grade: (pr.lessons[x.id] || {}).grade || null, score: (pr.lessons[x.id] || {}).score || 0, started: fs.existsSync(this.file('lesson-' + x.id)) })),
      challenges: CHALLENGES.map(x => ({ id: x.id, ws: 'chal-' + x.id, title: x.title, difficulty: x.difficulty, plant: x.plant, par: x.par,
        best: (pr.challenges[x.id] || {}).best || 0, done: !!(pr.challenges[x.id] || {}).best, started: fs.existsSync(this.file('chal-' + x.id)) })),
      sandboxes: this.sandboxes(), lang: this.lang(user),
      templates: Object.entries(TEMPLATES).map(([id, t]) => ({ id, name: t.name })),
    };
  }

  /** tabs a lesson needs (the rest are tucked under "More") */
  lessonTabs(ws) {
    if (kindOf(ws) !== 'lesson') return null;
    const x = L[ws.slice(7)];
    return ['mission', 'program', 'plant', 'tags', 'learn'].concat(x.tabs || []);
  }
  // ---------- missions ----------
  mission(p, user) {
    const k = kindOf(p.ws);
    if (k === 'lesson') {
      const x = L[p.ws.slice(7)], m = p.mission || (p.mission = { hints: 0, solution: false });
      const i = LESSONS.indexOf(x);
      return { kind: 'lesson', id: x.id, unit: x.unit, title: x.title, summary: x.summary, theory: m.lang === 'LD' ? x.ld.theory : x.theory, task: x.task, minutes: x.minutes,
        objectives: x.objectives.map(o => ({ id: o.id, text: o.text })), results: m.results || null, quality: m.quality || null,
        bestGrade: (this.prog(user).lessons[x.id] || {}).grade || null, bestScore: (this.prog(user).lessons[x.id] || {}).score || 0, lang: m.lang === 'LD' ? 'LD' : 'ST',
        hints: (m.lang === 'LD' ? x.ld.hints : x.hints).slice(0, m.hints), hintCount: (m.lang === 'LD' ? x.ld.hints : x.hints).length,
        allow: this.allow(p, user), module: x.module, capstone: !!x.capstone, real: !!(this.prog(user).lessons[x.id] || {}).real,
        solutionViewed: !!m.solution, done: !!(this.prog(user).lessons[x.id] || {}).done, index: i + 1, total: LESSONS.length,
        prev: i > 0 ? 'lesson-' + LESSONS[i - 1].id : null, next: i < LESSONS.length - 1 ? 'lesson-' + LESSONS[i + 1].id : null };
    }
    if (k === 'challenge') {
      const x = CH[p.ws.slice(5)], c = p.challenge;
      return { kind: 'challenge', id: x.id, title: x.title, difficulty: x.difficulty, plant: x.plant, ticket: x.ticket, par: x.par,
        objectives: x.objectives.map(o => ({ id: o.id, text: o.text })), causes: CAUSES[x.plant].map(([id, text]) => ({ id, text })),
        startedAt: c.startedAt, elapsed: Math.round(((c.done ? c.doneAt : Date.now()) - c.startedAt) / 1000), hints: x.hints.slice(0, c.hints), hintCount: x.hints.length,
        replaced: c.replaced, attempts: c.attempts, loto: !!c.loto, stops: c.stops || 0, done: c.done, score: c.score, breakdown: c.breakdown || null, results: c.results || null, rootCause: c.done ? x.cause : null,
        best: (this.prog(user).challenges[x.id] || {}).best || 0 };
    }
    if (k === 'sandbox') return { kind: 'sandbox', name: p.name || p.ws.slice(3), catalog: catalog() };
    return { kind: 'practice', name: this.plants[p.scen].name };
  }

  /** grade the program that is in the PLC (not the editor draft) */
  gradeLesson(p, user) {
    const x = L[p.ws.slice(7)];
    const proj = clone(p);
    delete proj.draft; delete proj.challenge;
    proj.actFaults = {};
    for (const s of proj.sensors) s.fault = 'none';
    const res = grade(this.plants, proj, x.objectives);
    const passed = res.filter(r => r.pass).length;
    const q = evaluate(this.plants, proj, x, res);
    p.mission = p.mission || { hints: 0, solution: false };
    p.mission.results = res; p.mission.quality = q; p.mission.checks = (p.mission.checks || 0) + 1;
    const pr = this.prog(user), e = pr.lessons[x.id] || (pr.lessons[x.id] = {});
    e.passed = Math.max(e.passed || 0, passed);
    if (passed === res.length && !e.done) { e.done = true; e.at = Date.now(); e.hints = p.mission.hints; e.solution = !!p.mission.solution; }
    if (passed === res.length && this.diff(user) === 'realistic') e.real = true;
    if (q.passed && q.score > (e.score || 0)) { e.score = q.score; e.grade = q.grade; e.gradeLang = q.parts.simplicity.lang; }
    this.writeProgress();
    return { ok: true, results: res, passed, total: res.length, done: passed === res.length, quality: q };
  }
  hint(p, user) {
    const k = kindOf(p.ws);
    if (k === 'lesson' && user) { const a = this.allow(p, user); if ((p.mission || {}).hints >= a.hints) return { ok: false, msg: a.diff === 'realistic' ? 'Realistic mode: no hints — on the plant floor you have the manual and the I/O list.' : 'Moderate mode: each Check unlocks the next hint.' }; }
    if (k === 'lesson') { const x = L[p.ws.slice(7)]; p.mission = p.mission || { hints: 0 }; const H = p.mission.lang === 'LD' ? x.ld.hints : x.hints; p.mission.hints = Math.min(H.length, (p.mission.hints || 0) + 1); return { ok: true, hints: H.slice(0, p.mission.hints) }; }
    if (k === 'challenge') { const x = CH[p.ws.slice(5)], c = p.challenge; if (c.done) return { ok: false, msg: 'Challenge finished' }; c.hints = Math.min(x.hints.length, c.hints + 1); return { ok: true, hints: x.hints.slice(0, c.hints) }; }
    return { ok: false, msg: 'No hints here' };
  }
  solution(p, user) {
    if (kindOf(p.ws) !== 'lesson') return { ok: false, msg: 'Only lessons have a reference solution' };
    if (user && !this.allow(p, user).solution) return { ok: false, msg: this.diff(user) === 'realistic' ? 'Realistic mode: no reference solution.' : 'Moderate mode: the solution unlocks after 3 Checks.' };
    p.mission = p.mission || { hints: 0 }; p.mission.solution = true;
    const x = L[p.ws.slice(7)];
    return { ok: true, units: clone(p.mission.lang === 'LD' ? x.ld.solution : x.solution) };
  }

  // ---------- challenge maintenance & submission ----------
  replace(p, what) {
    const c = p.challenge; if (!c || c.done) return { ok: false, msg: 'No active challenge' };
    if (!c.loto) return { ok: false, msg: 'Lock out the machine first — field devices are only replaced with the energy isolated (LOTO).' };
    const [kind, name] = String(what || '').split(':');
    if (!name || !['s', 'a'].includes(kind)) return { ok: false, msg: 'Bad request' };
    const key = kind + ':' + name;
    if (c.replaced.includes(key)) return { ok: false, msg: 'Already replaced' };
    c.replaced.push(key);
    const H = kind === 's' ? c.hidden.sensors : c.hidden.acts;
    const K = Object.keys(H).find(k => k.toUpperCase() === name.toUpperCase());
    if (K) delete H[K];
    return { ok: true, fixedSomething: !!K };
  }
  submit(p, user, cause) {
    const x = CH[p.ws.slice(5)], c = p.challenge;
    if (!c || c.done) return { ok: false, msg: 'No active challenge' };
    c.attempts++;
    const proj = clone(p);
    delete proj.draft;
    proj.actFaults = {};
    for (const s of proj.sensors) s.fault = 'none';
    const res = grade(this.plants, proj, x.objectives, { hidden: c.hidden });
    c.results = res;
    if (!res.every(r => r.pass)) return { ok: true, pass: false, results: res };
    const elapsed = Math.round((Date.now() - c.startedAt) / 1000);
    const unneeded = c.replaced.filter(k => !c.planted.includes(k)).length;
    const b = { base: 1000, time: -Math.min(500, Math.max(0, elapsed - x.par)), hints: -100 * c.hints, parts: -150 * unneeded, stops: -75 * (c.stops || 0), cause: cause === x.cause ? 0 : -200, retries: -50 * Math.max(0, c.attempts - 1) };
    const score = Math.max(100, Object.values(b).reduce((a, v) => a + v, 0));
    Object.assign(c, { done: true, doneAt: Date.now(), score, breakdown: Object.assign(b, { elapsed, unneeded, causeOk: cause === x.cause, chosen: cause }) });
    const pr = this.prog(user), e = pr.challenges[x.id] || (pr.challenges[x.id] = {});
    if (score > (e.best || 0)) { e.best = score; e.at = Date.now(); }
    this.writeProgress();
    return { ok: true, pass: true, results: res, score, breakdown: c.breakdown, rootCause: x.cause };
  }
}

module.exports = { Workspaces, kindOf, LESSONS, CHALLENGES, TEMPLATES };
