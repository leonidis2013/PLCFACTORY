'use strict';
/*
 * Sandbox plant: a machine assembled from components (layout → plant definition).
 * Liquids (tanks, valves, control valves, pumps, heaters), motion (motors, conveyors with part feeders,
 * pneumatic cylinders) and an operator panel (pushbuttons, selector switches, e-stops, pots, pilot lights,
 * stack lights). Sensors come from the regular I/O configuration using each component's signals.
 */
const { clamp, approach, ramp } = require('./common');

const AMBIENT = 20, SUPPLY_T = 15;
const COLORS = ['green', 'red', 'amber', 'blue', 'white', 'black'];

// Property schema shown in the builder. t: num | bool | sel | ref | text
const TYPES = {
  tank: { label: 'Tank', cat: 'Process', icon: 'tank',
    props: { capacity: { t: 'num', def: 200, min: 1, max: 100000, unit: 'L', label: 'Capacity' }, level: { t: 'num', def: 25, min: 0, max: 100, unit: '%', label: 'Initial level' },
      temp: { t: 'num', def: 20, min: 0, max: 100, unit: '°C', label: 'Initial temperature' } } },
  valve: { label: 'On/off valve', cat: 'Process', icon: 'valve',
    props: { from: { t: 'ref', of: ['@supply', 'tank'], def: '@supply', label: 'From' }, to: { t: 'ref', of: ['tank', '@drain'], def: '@drain', label: 'To' },
      flow: { t: 'num', def: 120, min: 1, max: 100000, unit: 'L/min', label: 'Flow when open' }, travel: { t: 'num', def: 1.5, min: 0.1, max: 30, unit: 's', label: 'Stroke time' } } },
  cvalve: { label: 'Control valve', cat: 'Process', icon: 'cvalve',
    props: { from: { t: 'ref', of: ['@supply', 'tank'], def: '@supply', label: 'From' }, to: { t: 'ref', of: ['tank', '@drain'], def: '@drain', label: 'To' },
      flow: { t: 'num', def: 120, min: 1, max: 100000, unit: 'L/min', label: 'Flow at 100 %' }, travel: { t: 'num', def: 4, min: 0.1, max: 60, unit: 's', label: 'Full-stroke time' } } },
  pump: { label: 'Pump', cat: 'Process', icon: 'pump',
    props: { from: { t: 'ref', of: ['@supply', 'tank'], def: '@supply', label: 'Suction from' }, to: { t: 'ref', of: ['tank', '@drain'], def: '@drain', label: 'Discharge to' },
      flow: { t: 'num', def: 150, min: 1, max: 100000, unit: 'L/min', label: 'Rated flow' }, vfd: { t: 'bool', def: false, label: 'Variable speed (VFD)' } } },
  heater: { label: 'Heater', cat: 'Process', icon: 'heater',
    props: { tank: { t: 'ref', of: ['tank'], def: '', label: 'In tank' }, rate: { t: 'num', def: 1.2, min: 0.01, max: 50, unit: '°C/s @100 L', label: 'Heating rate' },
      scr: { t: 'bool', def: false, label: 'Power control (SCR, 0–100 %)' } } },
  motor: { label: 'Motor', cat: 'Motion', icon: 'motor',
    props: { reversible: { t: 'bool', def: false, label: 'Reversing starter (FWD/REV)' }, vfd: { t: 'bool', def: false, label: 'Variable speed (VFD)' },
      ramp: { t: 'num', def: 1, min: 0, max: 30, unit: 's', label: 'Accel time' }, amps: { t: 'num', def: 8, min: 0.1, max: 500, unit: 'A', label: 'Full-load current' },
      attach: { t: 'ref', of: ['', 'tank'], def: '', label: 'Mixer in tank (optional)' } } },
  conveyor: { label: 'Conveyor', cat: 'Motion', icon: 'conveyor',
    props: { length: { t: 'num', def: 3, min: 0.5, max: 30, unit: 'm', label: 'Length' }, speed: { t: 'num', def: 0.3, min: 0.02, max: 3, unit: 'm/s', label: 'Belt speed' },
      reversible: { t: 'bool', def: false, label: 'Reversible (FWD/REV)' },
      feeder: { t: 'bool', def: true, label: 'Part feeder at start' }, interval: { t: 'num', def: 3, min: 0.3, max: 120, unit: 's', label: 'Feed interval' },
      tallPct: { t: 'num', def: 40, min: 0, max: 100, unit: '%', label: 'Tall parts' }, metalPct: { t: 'num', def: 30, min: 0, max: 100, unit: '%', label: 'Metal parts' } } },
  cylinder: { label: 'Pneumatic cylinder', cat: 'Motion', icon: 'cylinder',
    props: { conveyor: { t: 'ref', of: ['conveyor'], def: '', label: 'On conveyor' }, pos: { t: 'num', def: 1.5, min: 0, max: 30, unit: 'm', label: 'Position from start' },
      mode: { t: 'sel', opts: [['push', 'Pusher → side bin'], ['stop', 'Stopper (blocks parts)']], def: 'push', label: 'Function' },
      stroke: { t: 'num', def: 0.5, min: 0.05, max: 10, unit: 's', label: 'Stroke time' } } },
  pushbutton: { label: 'Pushbutton', cat: 'Operator panel', icon: 'pb',
    props: { color: { t: 'sel', opts: COLORS.map(c => [c, c]), def: 'green', label: 'Colour' }, latch: { t: 'bool', def: false, label: 'Maintained (push-on/push-off)' } } },
  selector: { label: 'Selector switch', cat: 'Operator panel', icon: 'selector',
    props: { positions: { t: 'sel', opts: [['2', '2-position'], ['3', '3-position']], def: '2', label: 'Positions' }, labels: { t: 'text', def: 'OFF,ON', label: 'Position labels' } } },
  estop: { label: 'E-stop', cat: 'Operator panel', icon: 'estop', props: {} },
  safetyrelay: { label: 'Safety relay', cat: 'Safety', icon: 'sr',
    props: { estop: { t: 'ref', of: ['estop', ''], def: '', label: 'E-stop (dual channel)' }, reset: { t: 'ref', of: ['pushbutton', ''], def: '', label: 'Reset button' },
      mode: { t: 'sel', opts: [['manual', 'Monitored manual reset'], ['auto', 'Automatic reset (not for E-stops)']], def: 'manual', label: 'Reset mode' } } },
  pot: { label: 'Potentiometer', cat: 'Operator panel', icon: 'pot',
    props: { min: { t: 'num', def: 0, label: 'Min' }, max: { t: 'num', def: 100, label: 'Max' }, unit: { t: 'text', def: '%', label: 'Unit' } } },
  pilot: { label: 'Pilot light', cat: 'Operator panel', icon: 'pilot', props: { color: { t: 'sel', opts: COLORS.map(c => [c, c]), def: 'green', label: 'Colour' } } },
  stacklight: { label: 'Stack light + horn', cat: 'Operator panel', icon: 'stack', props: {} },
};
const REF_KINDS = { '@supply': 'Water supply', '@drain': 'Drain' };

const tagName = s => String(s || '').replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1').slice(0, 24) || 'X';
function propsOf(c) {
  const t = TYPES[c.type], p = {};
  for (const k in t.props) p[k] = c.props && c.props[k] !== undefined ? c.props[k] : t.props[k].def;
  return p;
}

/** Validate/normalise a layout. Returns { layout, errors[] } */
function normalizeLayout(raw) {
  const errors = [], comps = [];
  const ids = new Set(), names = new Set();
  for (const c of (raw && Array.isArray(raw.components) ? raw.components : []).slice(0, 80)) {
    if (!TYPES[c.type]) continue;
    const id = String(c.id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) || ('c' + comps.length);
    if (ids.has(id)) continue;
    let name = tagName(c.name || id);
    while (names.has(name.toUpperCase())) name += '_';
    ids.add(id); names.add(name.toUpperCase());
    const o = { id, type: c.type, name, x: clamp(+c.x || 0, -50, 50), y: clamp(+c.y || 0, -50, 50), rot: [0, 90, 180, 270].includes(+c.rot) ? +c.rot : 0, props: {} };
    const t = TYPES[c.type];
    for (const k in t.props) {
      const d = t.props[k];
      let v = c.props && c.props[k] !== undefined ? c.props[k] : d.def;
      if (d.t === 'num') { v = +v; if (!Number.isFinite(v)) v = d.def; if (d.min !== undefined) v = Math.max(d.min, v); if (d.max !== undefined) v = Math.min(d.max, v); }
      else if (d.t === 'bool') v = !!v;
      else if (d.t === 'sel') { if (!d.opts.some(([x]) => x === String(v))) v = d.def; v = String(v); }
      else v = String(v == null ? '' : v).slice(0, 60);
      o.props[k] = v;
    }
    comps.push(o);
  }
  const byId = Object.fromEntries(comps.map(c => [c.id, c]));
  for (const c of comps) {
    const t = TYPES[c.type];
    for (const k in t.props) {
      const d = t.props[k];
      if (d.t !== 'ref') continue;
      const v = c.props[k];
      const ok = v === '' ? d.of.includes('') || false : (v.startsWith('@') ? d.of.includes(v) : (byId[v] && d.of.includes(byId[v].type)));
      if (!ok) { if (v !== '') errors.push(`${c.name}: '${d.label}' points to something that doesn't exist`); c.props[k] = d.of.includes('') ? '' : (d.of.find(x => x.startsWith('@')) || ''); }
    }
  }
  return { layout: { components: comps }, errors };
}

function makeSandbox(rawLayout) {
  const { layout } = normalizeLayout(rawLayout);
  const comps = layout.components;
  const byId = Object.fromEntries(comps.map(c => [c.id, c]));
  const actuators = [], signals = {}, probes = {}, faults = [], actions = [];
  const sigKey = (c, k) => `${c.id}.${k}`;
  const A = (c, suffix, type, kind, desc) => { const n = `${kind === 'AO' ? 'AO' : 'Q'}_${c.name}${suffix ? '_' + suffix : ''}`; actuators.push([n, type, kind, desc]); return n; };
  const S = (c, k, label, kind, extra) => { signals[sigKey(c, k)] = Object.assign({ label: `${c.name} — ${label}`, kind, comp: c.id }, extra || {}); };
  const out = {};   // compId → { key: actuatorName }
  for (const c of comps) {
    const p = c.props, o = out[c.id] = {};
    switch (c.type) {
      case 'tank':
        S(c, 'level', 'level', 'analog', { unit: '%', min: 0, max: 100, dec: 1 });
        S(c, 'volume', 'volume', 'analog', { unit: 'L', min: 0, max: p.capacity, dec: 1 });
        S(c, 'temp', 'temperature', 'analog', { unit: '°C', min: 0, max: 100, dec: 1 });
        S(c, 'overflow', 'overflowing (spill sensor)', 'bool');
        actions.push({ id: `ctl:${c.id}:fill`, label: `${c.name}: set level`, kind: 'level', comp: c.id });
        break;
      case 'valve':
        o.open = A(c, 'Open', 'BOOL', 'DO', `${c.name} solenoid (TRUE = open)`);
        S(c, 'zso', 'open limit switch (ZSO)', 'bool'); S(c, 'zsc', 'closed limit switch (ZSC)', 'bool');
        S(c, 'pos', 'position', 'analog', { unit: '%', min: 0, max: 100, dec: 0 }); S(c, 'flow', 'flow', 'analog', { unit: 'L/min', min: 0, max: p.flow * 1.2, dec: 0 });
        faults.push([`${c.id}.leak`, `${c.name} leaks when closed (10 %)`]);
        break;
      case 'cvalve':
        o.pos = A(c, 'Pos', 'REAL', 'AO', `${c.name} position demand, 0–100 %`);
        S(c, 'pos', 'position feedback', 'analog', { unit: '%', min: 0, max: 100, dec: 1 }); S(c, 'flow', 'flow', 'analog', { unit: 'L/min', min: 0, max: p.flow * 1.2, dec: 1 });
        faults.push([`${c.id}.sticky`, `${c.name} sticky (moves in 10 % jumps)`]);
        break;
      case 'pump':
        o.run = A(c, 'Run', 'BOOL', 'DO', `${c.name} run`);
        if (p.vfd) o.spd = A(c, 'Speed', 'REAL', 'AO', `${c.name} VFD speed, 0–100 %`);
        S(c, 'running', 'running (aux contact)', 'bool'); S(c, 'flow', 'flow', 'analog', { unit: 'L/min', min: 0, max: p.flow * 1.2, dec: 0 });
        S(c, 'dry', 'running dry (no suction)', 'bool');
        faults.push([`${c.id}.worn`, `${c.name} worn impeller (half flow)`]);
        break;
      case 'heater':
        o.on = A(c, 'On', 'BOOL', 'DO', `${c.name} contactor`);
        if (p.scr) o.pwr = A(c, 'Power', 'REAL', 'AO', `${c.name} SCR power, 0–100 %`);
        S(c, 'current', 'drawing current (current switch)', 'bool'); S(c, 'power', 'power', 'analog', { unit: '%', min: 0, max: 100, dec: 0 });
        faults.push([`${c.id}.burnt`, `${c.name} element burned out`]);
        break;
      case 'motor':
        if (p.reversible) { o.fwd = A(c, 'Fwd', 'BOOL', 'DO', `${c.name} forward contactor`); o.rev = A(c, 'Rev', 'BOOL', 'DO', `${c.name} reverse contactor`); }
        else o.run = A(c, 'Run', 'BOOL', 'DO', `${c.name} run`);
        if (p.vfd) o.spd = A(c, 'Speed', 'REAL', 'AO', `${c.name} VFD speed, 0–100 %`);
        S(c, 'running', 'running (aux contact)', 'bool'); S(c, 'speed', 'speed', 'analog', { unit: '%', min: -100, max: 100, dec: 0 });
        S(c, 'current', 'current', 'analog', { unit: 'A', min: 0, max: p.amps * 3, dec: 1 }); S(c, 'ol', 'overload relay tripped', 'bool');
        faults.push([`${c.id}.jam`, `${c.name} mechanically jammed (overloads)`]);
        actions.push({ id: `ctl:${c.id}:reset`, label: `${c.name}: reset overload relay`, kind: 'button', comp: c.id });
        break;
      case 'conveyor':
        if (p.reversible) { o.fwd = A(c, 'Fwd', 'BOOL', 'DO', `${c.name} forward`); o.rev = A(c, 'Rev', 'BOOL', 'DO', `${c.name} reverse`); }
        else o.run = A(c, 'Run', 'BOOL', 'DO', `${c.name} drive run`);
        S(c, 'running', 'drive running', 'bool'); S(c, 'count', 'parts off the end', 'analog', { unit: 'pcs', min: 0, max: 10000, dec: 0 });
        probes[`${c.id}.part`] = { label: `${c.name} — photoeye (any part)`, min: 0, max: Math.round(p.length * 1000), comp: c.id };
        probes[`${c.id}.tall`] = { label: `${c.name} — height sensor (tall part)`, min: 0, max: Math.round(p.length * 1000), comp: c.id };
        probes[`${c.id}.metal`] = { label: `${c.name} — inductive prox (metal part)`, min: 0, max: Math.round(p.length * 1000), comp: c.id };
        faults.push([`${c.id}.empty`, `${c.name} feeder empty`]);
        actions.push({ id: `ctl:${c.id}:feed`, label: `${c.name}: feeder on`, kind: 'toggle', comp: c.id });
        actions.push({ id: `ctl:${c.id}:clear`, label: `${c.name}: clear jams / remove parts`, kind: 'button', comp: c.id });
        break;
      case 'cylinder':
        o.ext = A(c, 'Ext', 'BOOL', 'DO', `${c.name} solenoid (TRUE = extend)`);
        S(c, 'ext', 'extended reed switch', 'bool'); S(c, 'ret', 'retracted reed switch', 'bool');
        faults.push([`${c.id}.air`, `${c.name} air supply lost`]);
        break;
      case 'pushbutton': S(c, 'pressed', p.latch ? 'maintained, ON' : 'pressed', 'bool', { panel: true }); break;
      case 'selector': {
        const n = +p.positions;
        S(c, 'pos', 'position number', 'analog', { unit: '', min: 0, max: n - 1, dec: 0, panel: true });
        for (let i = 0; i < n; i++) S(c, 'p' + i, `in position ${i} (${(p.labels.split(',')[i] || i).trim()})`, 'bool', { panel: true });
        break;
      }
      case 'estop': S(c, 'tripped', 'tripped (latched)', 'bool', { panel: true }); break;
      case 'safetyrelay':
        S(c, 'ok', 'safety outputs ON (status contact)', 'bool'); S(c, 'fault', 'channel discrepancy / fault', 'bool');
        S(c, 'ch1', 'E-stop channel 1 closed', 'bool'); S(c, 'ch2', 'E-stop channel 2 closed', 'bool');
        faults.push([`${c.id}.weld`, `${c.name}: E-stop channel 2 shorted (cross-fault)`]);
        break;
      case 'pot': S(c, 'value', 'value', 'analog', { unit: p.unit, min: +p.min, max: +p.max, dec: 2, panel: true }); break;
      case 'pilot': o.on = A(c, '', 'BOOL', 'DO', `${c.name} pilot light (${p.color})`); break;
      case 'stacklight':
        o.red = A(c, 'Red', 'BOOL', 'DO', `${c.name} red`); o.amber = A(c, 'Amber', 'BOOL', 'DO', `${c.name} amber`);
        o.green = A(c, 'Green', 'BOOL', 'DO', `${c.name} green`); o.horn = A(c, 'Horn', 'BOOL', 'DO', `${c.name} horn`);
        break;
    }
  }
  actions.push({ id: 'reset', label: 'Reset plant to initial state', kind: 'button' });

  // ---------------- state ----------------
  function create() {
    const s = { c: {}, faults: {}, msgs: [], t: 0, n: 0 };
    for (const c of comps) {
      const p = c.props, st = s.c[c.id] = {};
      if (c.type === 'tank') Object.assign(st, { vol: p.capacity * p.level / 100, temp: p.temp, overflow: false, spill: 0 });
      if (c.type === 'valve' || c.type === 'cvalve') Object.assign(st, { pos: 0, q: 0 });
      if (c.type === 'pump') Object.assign(st, { spd: 0, q: 0, dry: 0, dryT: 0 });
      if (c.type === 'heater') Object.assign(st, { pwr: 0, dry: 0 });
      if (c.type === 'motor') Object.assign(st, { spd: 0, amps: 0, ol: false, olT: 0, ang: 0 });
      if (c.type === 'conveyor') Object.assign(st, { v: 0, items: [], feed: !!p.feeder, feedT: p.interval * 0.6, count: 0, bin: { n: 0, tall: 0, metal: 0 }, phase: 0 });
      if (c.type === 'cylinder') Object.assign(st, { x: 0, bin: { n: 0, tall: 0, metal: 0 } });
      if (c.type === 'pushbutton') st.on = false;
      if (c.type === 'selector') st.pos = 0;
      if (c.type === 'estop') st.tripped = false;
      if (c.type === 'safetyrelay') Object.assign(st, { ok: false, fault: false, ch1: true, ch2: true, prevR: false });
      if (c.type === 'pot') st.value = +p.min;
    }
    return s;
  }
  const endpoint = (s, ref) => (ref && !ref.startsWith('@') && byId[ref] && byId[ref].type === 'tank') ? s.c[ref] : null;

  function sig(s, key) {
    const dot = key.indexOf('.');
    const c = byId[key.slice(0, dot)], k = key.slice(dot + 1);
    if (!c) return 0;
    const st = s.c[c.id], p = c.props;
    switch (c.type) {
      case 'tank': return { level: st.vol / p.capacity * 100, volume: st.vol, temp: st.temp, overflow: st.overflow }[k];
      case 'valve': return { zso: st.pos > 0.97, zsc: st.pos < 0.03, pos: st.pos * 100, flow: st.q * 60 }[k];
      case 'cvalve': return { pos: st.pos * 100, flow: st.q * 60 }[k];
      case 'pump': return { running: st.spd > 0.05, flow: st.q * 60, dry: st.dry > 0 }[k];
      case 'heater': return { current: st.pwr > 0.01, power: st.pwr * 100 }[k];
      case 'motor': return { running: Math.abs(st.spd) > 0.05, speed: st.spd * 100, current: st.amps, ol: st.ol }[k];
      case 'conveyor': return { running: Math.abs(st.v) > 0.001, count: st.count }[k];
      case 'cylinder': return { ext: st.x >= 0.97, ret: st.x <= 0.03 }[k];
      case 'pushbutton': return st.on;
      case 'selector': return k === 'pos' ? st.pos : st.pos === +k.slice(1);
      case 'estop': return st.tripped;
      case 'pot': return st.value;
      case 'safetyrelay': return { ok: st.ok, fault: st.fault, ch1: st.ch1, ch2: st.ch2 }[k];
    }
    return 0;
  }
  function probe(s, key, mm) {
    const dot = key.indexOf('.');
    const c = byId[key.slice(0, dot)], k = key.slice(dot + 1);
    if (!c || c.type !== 'conveyor') return false;
    const x = mm / 1000, win = k === 'metal' ? 0.05 : 0.1;
    return s.c[c.id].items.some(it => it.state !== 'out' && Math.abs(it.pos - x) < win && (k === 'part' || (k === 'tall' && it.tall) || (k === 'metal' && it.metal)));
  }

  function doAction(s, id, val) {
    if (id === 'reset') { const f = s.faults; Object.assign(s, create()); s.faults = f; return; }
    const m = /^ctl:([^:]+):(\w+)$/.exec(id);
    if (!m || !byId[m[1]]) return;
    const c = byId[m[1]], st = s.c[c.id], what = m[2];
    if (c.type === 'pushbutton') {
      if (what === 'press') { if (c.props.latch) { if (val) st.on = !st.on; } else st.on = !!val; }
    } else if (c.type === 'selector' && what === 'set') st.pos = clamp(Math.round(+val || 0), 0, +c.props.positions - 1);
    else if (c.type === 'estop' && what === 'set') st.tripped = !!val;
    else if (c.type === 'pot' && what === 'set') st.value = clamp(+val || 0, Math.min(+c.props.min, +c.props.max), Math.max(+c.props.min, +c.props.max));
    else if (c.type === 'motor' && what === 'reset') { st.ol = false; st.olT = 0; }
    else if (c.type === 'conveyor' && what === 'feed') st.feed = !!val;
    else if (c.type === 'conveyor' && what === 'clear') st.items = [];
    else if (c.type === 'tank' && what === 'fill') { st.vol = c.props.capacity * clamp(+val || 0, 0, 100) / 100; st.overflow = false; }
  }
  function actionState(s) {
    const a = {};
    for (const c of comps) if (c.type === 'conveyor') a[`ctl:${c.id}:feed`] = s.c[c.id].feed;
    return a;
  }

  // ---------------- physics ----------------
  /* Safety relays: dual-channel E-stop monitoring with cross-fault detection and monitored manual reset (on release).
     While any safety relay is off, power to every actuator is removed in hardware — the PLC cannot override it.
     Indication (pilot lights, stack lights) runs on the control circuit and stays powered. */
  const POWERED = new Set(['valve', 'cvalve', 'pump', 'heater', 'motor', 'conveyor', 'cylinder']);
  function safety(s) {
    let cut = false;
    for (const c of comps) {
      if (c.type !== 'safetyrelay') continue;
      const st = s.c[c.id], p = c.props, es = byId[p.estop], rb = byId[p.reset];
      const tripped = es && es.type === 'estop' ? s.c[es.id].tripped : false;
      st.ch1 = !tripped; st.ch2 = !tripped || !!s.faults[`${c.id}.weld`];
      if (st.ch1 !== st.ch2) st.fault = true;
      else if (!st.ch1 && !st.ch2) st.fault = false;         // both channels open together again: discrepancy cleared
      if (!st.ch1 || !st.ch2 || st.fault) st.ok = false;
      const r = rb && rb.type === 'pushbutton' ? !!s.c[rb.id].on : false;
      if (st.ch1 && st.ch2 && !st.fault && (p.mode === 'auto' || (st.prevR && !r))) st.ok = true;
      st.prevR = r;
      if (!st.ok) cut = true;
    }
    return cut;
  }
  function step(s, o, dtAll) {
    if (safety(s)) {
      o = Object.assign({}, o);
      for (const c of comps) if (POWERED.has(c.type)) for (const name of Object.values(out[c.id] || {})) o[name] = typeof o[name] === 'boolean' ? false : 0;
    }
    const n = Math.max(1, Math.ceil(dtAll / 0.05)), dt = dtAll / n;
    for (let i = 0; i < n; i++) sub(s, o, dt);
    const msgs = [];
    for (const c of comps) {
      const st = s.c[c.id];
      if (c.type === 'tank' && st.overflow) msgs.push(`${c.name} is overflowing.`);
      if (c.type === 'motor' && st.ol) msgs.push(`${c.name}: overload relay tripped — fix the cause, then reset it.`);
      if (c.type === 'pump' && st.dry > 0) msgs.push(`${c.name} is running dry.`);
      if (c.type === 'heater' && s.faults[`${c.id}.burnt`] && st.burnMsg) msgs.push(`${c.name} burned out (energised without enough liquid).`);
      if (c.type === 'conveyor' && st.items.some(it => it.state === 'jam')) msgs.push(`${c.name}: part jammed at a cylinder — clear it.`);
      if (c.type === 'safetyrelay' && !st.ok) msgs.push(`${c.name}: safety circuit open — ${st.fault ? 'channel discrepancy: check the E-stop wiring, then press and release the E-stop' : !(st.ch1 && st.ch2) ? 'E-stop pressed' : 'press and release the reset button'}. Power to the machine is off.`);
    }
    s.msgs = msgs;
  }
  function sub(s, o, dt) {
    s.t += dt;
    const F = s.faults;
    // --- motors ---
    for (const c of comps) {
      if (c.type !== 'motor') continue;
      const st = s.c[c.id], p = c.props, oc = out[c.id];
      let dir = 0;
      if (p.reversible) {
        const f = !!o[oc.fwd], r = !!o[oc.rev];
        if (f && r) { st.ol = true; st.olWhy = 'FWD and REV energised together — short circuit'; }
        dir = f && !r ? 1 : r && !f ? -1 : 0;
      } else dir = o[oc.run] ? 1 : 0;
      if (st.ol) dir = 0;
      const sp = p.vfd ? clamp(+o[oc.spd] || 0, 0, 100) / 100 : 1;
      const target = dir * sp;
      st.spd = p.ramp > 0 ? ramp(st.spd, target, 1 / p.ramp, dt) : target;
      const jam = F[`${c.id}.jam`];
      const accel = Math.abs(target - st.spd) > 0.02 ? 2.5 : 1;
      st.amps = Math.abs(st.spd) > 0.01 || (jam && dir !== 0) ? p.amps * (jam ? 2.6 : 0.35 + 0.65 * Math.abs(st.spd)) * accel : 0;
      if (jam && dir !== 0) { st.spd = ramp(st.spd, 0, 3, dt); st.olT += dt; if (st.olT > 3) { st.ol = true; st.olWhy = 'overload — motor jammed'; } } else st.olT = 0;
      st.ang = (st.ang + st.spd * dt * 720) % 360;
    }
    // --- valves / pumps: flow ---
    const flows = [];
    for (const c of comps) {
      const st = s.c[c.id], p = c.props, oc = out[c.id];
      if (c.type === 'valve') { st.pos = ramp(st.pos, o[oc.open] ? 1 : 0, 1 / p.travel, dt); const leak = F[`${c.id}.leak`] ? 0.1 : 0; flows.push([c, Math.max(st.pos, leak) * p.flow / 60]); }
      if (c.type === 'cvalve') {
        let dem = clamp(+o[oc.pos] || 0, 0, 100) / 100;
        if (F[`${c.id}.sticky`]) dem = Math.round(dem * 10) / 10;
        st.pos = ramp(st.pos, dem, 1 / p.travel, dt); flows.push([c, st.pos * p.flow / 60]);
      }
      if (c.type === 'pump') {
        const run = !!o[oc.run], sp = p.vfd ? clamp(+o[oc.spd] || 0, 0, 100) / 100 : 1;
        st.spd = ramp(st.spd, run ? sp : 0, 2, dt);
        flows.push([c, st.spd * p.flow / 60 * (F[`${c.id}.worn`] ? 0.5 : 1)]);
      }
    }
    for (const [c, qWant] of flows) {
      const st = s.c[c.id], src = endpoint(s, c.props.from), dst = endpoint(s, c.props.to);
      let q = qWant;
      if (src) q = Math.min(q, src.vol / dt);
      if (c.type === 'pump') { st.dry = st.spd > 0.05 && src && src.vol < 0.5 ? st.dry + dt : 0; }
      st.q = q;
      const vol = q * dt;
      if (vol <= 0) continue;
      const tIn = src ? src.temp : SUPPLY_T;
      if (src) src.vol -= vol;
      if (dst) {
        const cap = byId[c.props.to].props.capacity;
        dst.temp = (dst.temp * dst.vol + tIn * vol) / Math.max(dst.vol + vol, 1e-6);
        dst.vol += vol;
        if (dst.vol > cap) { dst.spill += dst.vol - cap; dst.vol = cap; dst.overflow = true; }
      }
    }
    // --- heaters & tanks ---
    for (const c of comps) {
      const st = s.c[c.id], p = c.props, oc = out[c.id];
      if (c.type === 'heater') {
        const t = endpoint(s, p.tank);
        const on = !!o[oc.on] && !F[`${c.id}.burnt`];
        st.pwr = approach(st.pwr, on ? (p.scr ? clamp(+o[oc.pwr] || 0, 0, 100) / 100 : 1) : 0, 1 / 3, dt);
        if (t && st.pwr > 0.01) {
          const cap = byId[p.tank].props.capacity;
          if (t.vol > cap * 0.1) { t.temp += p.rate * st.pwr * 100 / Math.max(t.vol, 10) * dt; st.dry = 0; }
          else if (on) { st.dry += dt; if (st.dry > 3) { F[`${c.id}.burnt`] = true; st.burnMsg = true; } }
        }
      }
      if (c.type === 'tank') {
        st.temp += (AMBIENT - st.temp) * 0.004 * dt;
        st.temp = Math.min(st.temp, 100);
        if (st.vol < p.capacity * 0.995) st.overflow = false;
        if (st.vol < 0) st.vol = 0;
      }
    }
    // --- cylinders ---
    for (const c of comps) {
      if (c.type !== 'cylinder') continue;
      const st = s.c[c.id], p = c.props;
      const ext = !!o[out[c.id].ext] && !F[`${c.id}.air`];
      st.prev = st.x;
      st.x = ramp(st.x, ext ? 1 : 0, 1 / p.stroke, dt);
    }
    // --- conveyors & parts ---
    for (const c of comps) {
      if (c.type !== 'conveyor') continue;
      const st = s.c[c.id], p = c.props, oc = out[c.id];
      let dir = p.reversible ? ((o[oc.fwd] && !o[oc.rev]) ? 1 : (o[oc.rev] && !o[oc.fwd]) ? -1 : 0) : (o[oc.run] ? 1 : 0);
      // a conveyor can be driven by a separate motor only through its own output; keep it simple
      st.v = ramp(st.v, dir * p.speed, p.speed * 4, dt);
      st.phase = (st.phase + st.v * dt) % 0.2;
      if (st.feed && !F[`${c.id}.empty`]) {
        st.feedT += dt;
        if (st.feedT >= p.interval && !st.items.some(it => it.state === 'belt' && it.pos < 0.3)) {
          st.feedT = 0;
          st.items.push({ id: ++s.n, pos: 0.12, tall: Math.random() * 100 < p.tallPct, metal: Math.random() * 100 < p.metalPct, state: 'belt', lat: 0 });
        }
      }
      const cyls = comps.filter(x => x.type === 'cylinder' && x.props.conveyor === c.id);
      const belt = st.items.filter(it => it.state === 'belt').sort((a, b) => st.v >= 0 ? b.pos - a.pos : a.pos - b.pos);
      for (const it of belt) {
        if (Math.abs(st.v) < 1e-4) continue;
        let np = it.pos + st.v * dt;
        for (const q of st.items) if (q !== it && q.state !== 'out' && q.state !== 'binned' && Math.abs(q.lat) < 0.15) {
          if (st.v > 0 && q.pos > it.pos) np = Math.min(np, q.pos - 0.22);
          if (st.v < 0 && q.pos < it.pos) np = Math.max(np, q.pos + 0.22);
        }
        for (const cy of cyls) {
          if (cy.props.mode !== 'stop') continue;
          const x = s.c[cy.id].x, cp = cy.props.pos;
          if (x > 0.5) { if (st.v > 0 && it.pos <= cp - 0.1 + 1e-6) np = Math.min(np, cp - 0.1); if (st.v < 0 && it.pos >= cp + 0.1 - 1e-6) np = Math.max(np, cp + 0.1); }
        }
        it.pos = st.v > 0 ? Math.max(it.pos, np) : Math.min(it.pos, np);
        if (it.pos > p.length) { it.state = 'out'; st.count++; st.bin.n++; if (it.tall) st.bin.tall++; if (it.metal) st.bin.metal++; }
        if (it.pos < 0) { it.state = 'out'; }
      }
      for (const cy of cyls) {
        if (cy.props.mode !== 'push') continue;
        const cs = s.c[cy.id], cp = cy.props.pos;
        for (const it of st.items) {
          const d = Math.abs(it.pos - cp);
          if (it.state === 'belt' && cs.x > 0.05) {
            if (d <= 0.09 && cs.x > (cs.prev || 0)) { it.state = 'push'; it.cyl = cy.id; }
            else if (d < 0.15) it.state = 'jam';   // plate (0.1 m) clips a 0.16 m part
          }
          if (it.state === 'push' && it.cyl === cy.id) {
            it.lat = Math.max(it.lat, cs.x);
            if (cs.x >= 0.95) { it.state = 'binned'; cs.bin.n++; if (it.tall) cs.bin.tall++; if (it.metal) cs.bin.metal++; }
            else if (cs.x < it.lat - 0.05) it.state = it.lat > 0.5 ? (cs.bin.n++, it.tall && cs.bin.tall++, it.metal && cs.bin.metal++, 'binned') : 'jam';
          }
        }
      }
      st.items = st.items.filter(it => it.state !== 'out' && it.state !== 'binned');
    }
  }

  function view(s) {
    const cs = {};
    for (const c of comps) {
      const st = s.c[c.id];
      const v = Object.assign({}, st);
      if (c.type === 'conveyor') v.items = st.items.map(it => ({ id: it.id, pos: it.pos, tall: it.tall, metal: it.metal, state: it.state, lat: it.lat }));
      cs[c.id] = v;
    }
    return { layout, c: cs, faults: s.faults, msgs: s.msgs, act: actionState(s), out: null };
  }

  /** Suggested sensors for a freshly added component */
  function suggest(c) {
    const S2 = (type, signal, extra) => Object.assign({ type, signal, fault: 'none' }, extra);
    const n = c.name;
    switch (c.type) {
      case 'tank': return [S2('analog', `${c.id}.level`, { tag: `AI_${n}_Level`, lo: 0, hi: 100, scale: 'eng', noise: 0.2 })];
      case 'valve': return [S2('discrete', `${c.id}.zso`, { tag: `I_${n}_ZSO`, contact: 'NO' }), S2('discrete', `${c.id}.zsc`, { tag: `I_${n}_ZSC`, contact: 'NO' })];
      case 'pump': case 'motor': return [S2('discrete', `${c.id}.running`, { tag: `I_${n}_Running`, contact: 'NO' })].concat(c.type === 'motor' ? [S2('discrete', `${c.id}.ol`, { tag: `I_${n}_OL`, contact: 'NC' })] : []);
      case 'cylinder': return [S2('discrete', `${c.id}.ext`, { tag: `I_${n}_Ext`, contact: 'NO' }), S2('discrete', `${c.id}.ret`, { tag: `I_${n}_Ret`, contact: 'NO' })];
      case 'pushbutton': return [S2('discrete', `${c.id}.pressed`, { tag: `I_${n}`, contact: 'NO' })];
      case 'estop': return [S2('discrete', `${c.id}.tripped`, { tag: `I_${n}`, contact: 'NC' })];
      case 'safetyrelay': return [S2('discrete', `${c.id}.ok`, { tag: `I_${n}_OK`, contact: 'NO' }), S2('discrete', `${c.id}.fault`, { tag: `I_${n}_Fault`, contact: 'NO' })];
      case 'selector': return Array.from({ length: +c.props.positions }, (_, i) => S2('discrete', `${c.id}.p${i}`, { tag: `I_${n}_P${i}`, contact: 'NO' })).slice(1);
      case 'pot': return [S2('analog', `${c.id}.value`, { tag: `AI_${n}`, lo: +c.props.min, hi: +c.props.max, scale: 'eng', noise: 0 })];
      case 'conveyor': return [S2('probe', `${c.id}.part`, { tag: `I_${n}_PE_End`, pos: Math.round(c.props.length * 1000 - 150), contact: 'NO' })];
    }
    return [];
  }

  return {
    id: 'sandbox', name: 'Sandbox', blurb: 'Your own machine.', sandbox: true, layout,
    actuators, signals, probes, faults, actions, create, sig, probe, step, view, doAction, actionState, suggest,
    defaults: () => ({ src: '', sensors: [], hmi: [], alarms: [], pens: [] }),
  };
}

function catalog() {
  return { types: TYPES, refs: REF_KINDS };
}

module.exports = { makeSandbox, normalizeLayout, catalog, TYPES };
