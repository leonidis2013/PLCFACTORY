'use strict';
const { disc, probe, panelSensors, W, A, clamp } = require('./common');

// Internal units: px along the belt (1 px = 5 mm). Belt runs from x=20 to x=722.
const MM = 5, BELT_Y = 190, X_SORT = 400, X_END = 722, SPEED = 90;
const toPx = mm => mm / MM;

const GLOBALS = `(* Global variables shared by the Sorter (ST) and Control (LD) programs *)
VAR_GLOBAL
  HMI_Start, HMI_Stop, HMI_Reset : BOOL;   (* momentary HMI buttons *)
  Running, Fault : BOOL;
  State      : INT;                         (* 0 conveying, 10 settle, 20 extend, 30 retract *)
  TallCount  : INT;
  ShortCount : INT;
  JamTmr     : TON;                         (* used in ladder rung 9 *)
  ExitCount  : CTU;                         (* boxes leaving at PE-3 *)
END_VAR
`;

const SORTER = `(* =========================================================
   SORTER (Structured Text) — tall boxes are pushed into bin B,
   short boxes ride to the end into bin A.
   Start/stop, faults and outputs are in the ladder program "Control".
   ========================================================= *)
VAR
  SortEdge  : R_TRIG;
  SettleTmr : TON;
  StrokeTmr : TON;      (* watchdog on the pusher stroke *)
END_VAR

SortEdge(CLK := I_PE_Sort);
SettleTmr(IN := State = 10, PT := T#200ms);
StrokeTmr(IN := State = 20 OR State = 30, PT := T#2s);

CASE State OF
  0:  IF SortEdge.Q THEN                 (* box arrived at the sort station *)
        IF I_Tall THEN
          State := 10;                   (* stop the belt, then push *)
        ELSE
          ShortCount := ShortCount + 1;  (* short box: let it ride *)
        END_IF;
      END_IF;
  10: IF SettleTmr.Q THEN State := 20; END_IF;
  20: IF I_DivExtended THEN State := 30; END_IF;
  30: IF I_DivRetracted THEN
        TallCount := TallCount + 1;
        State := 0;
      END_IF;
END_CASE;

IF StrokeTmr.Q THEN Fault := TRUE; END_IF;   (* pusher never finished its stroke *)
`;

const NO = a => ({ t: 'NO', a }), NC = a => ({ t: 'NC', a }), PE = a => ({ t: 'P', a }), CMP = (a, op, b) => ({ t: 'CMP', a, op, b });
const CONTROL_RUNGS = [
  { comment: 'E-stop (NC contact) latches a fault', rows: [[NC('I_EStop')]], outs: [{ t: 'SET', a: 'Fault' }] },
  { comment: 'Reset clears the fault once the E-stop is released', rows: [[NO('HMI_Reset'), NO('I_EStop')]], outs: [{ t: 'RST', a: 'Fault' }, { t: 'MOV', a: '0', b: 'State' }] },
  { comment: 'Start (local button or HMI) — rising edge, only without a fault', rows: [[PE('I_Start'), NC('Fault')], [PE('HMI_Start'), NC('Fault')]], outs: [{ t: 'SET', a: 'Running' }] },
  { comment: 'Stop: local STOP is wired NC, so the contact is NC too', rows: [[NC('I_Stop')], [NO('HMI_Stop')], [NO('Fault')]], outs: [{ t: 'RST', a: 'Running' }] },
  { comment: 'Belt runs while running and the sorter is idle', rows: [[NO('Running'), CMP('State', '=', '0')]], outs: [{ t: 'COIL', a: 'Q_Conveyor' }] },
  { comment: 'Pusher', rows: [[CMP('State', '=', '20'), NC('Fault')]], outs: [{ t: 'COIL', a: 'Q_Divert' }] },
  { comment: 'Lamps', rows: [[NO('Running')]], outs: [{ t: 'COIL', a: 'Q_RunLamp' }] },
  { comment: '', rows: [[NO('Fault')]], outs: [{ t: 'COIL', a: 'Q_FaultLamp' }] },
  { comment: 'Jam detection: sort photoeye blocked for 3 s while the belt runs', rows: [[NO('I_PE_Sort'), NO('Q_Conveyor')]], outs: [{ t: 'TON', a: 'JamTmr', b: 'T#3s' }] },
  { comment: '', rows: [[NO('JamTmr.Q')]], outs: [{ t: 'SET', a: 'Fault' }] },
  { comment: 'Count boxes leaving the belt (reset with HMI reset)', rows: [[NO('I_PE_Exit')]], outs: [{ t: 'CTU', a: 'ExitCount', b: '9999' }] },
  { comment: '', rows: [[NO('HMI_Reset')]], outs: [{ t: 'RES', a: 'ExitCount' }] },
];

module.exports = {
  id: 'conveyor',
  name: 'Conveyor: box sorter',
  blurb: 'A 3.5 m belt conveyor with photoeyes, a height sensor and a pneumatic pusher. Learn edge detection, state machines, counters and timing.',
  actuators: [
    ['Q_Conveyor', 'BOOL', 'DO', 'Conveyor motor M-1 run (0.45 m/s)'],
    ['Q_Divert', 'BOOL', 'DO', 'Pusher solenoid valve (TRUE = extend, 0.5 s stroke)'],
    ['Q_RunLamp', 'BOOL', 'DO', 'Green RUN lamp'],
    ['Q_FaultLamp', 'BOOL', 'DO', 'Red FAULT lamp'],
  ],
  signals: {
    div_ext: { label: 'Pusher extended (limit switch)', kind: 'bool' },
    div_ret: { label: 'Pusher retracted (limit switch)', kind: 'bool' },
    motor_running: { label: 'Conveyor motor running (aux contact)', kind: 'bool' },
    jam: { label: 'Jam present (jam detector)', kind: 'bool' },
    div_pos: { label: 'Pusher position', unit: '%', kind: 'analog', min: 0, max: 100, dec: 0 },
    belt_speed: { label: 'Belt speed (encoder)', unit: 'm/s', kind: 'analog', min: 0, max: 1, dec: 2 },
    count_a: { label: 'Boxes in bin A (scale count)', unit: 'pcs', kind: 'analog', min: 0, max: 1000, dec: 0 },
  },
  probes: {
    box: { label: 'Photoeye — any box', min: 150, max: 3550 },
    tall: { label: 'Height sensor — tall box', min: 150, max: 3550 },
    short: { label: 'Low-mounted sensor — short box only', min: 150, max: 3550 },
  },
  faults: [['airLost', 'Pusher air supply lost'], ['tallOnly', 'Feed tall boxes only'], ['shortOnly', 'Feed short boxes only']],
  actions: [
    { id: 'feed', label: 'Infeed running', kind: 'toggle' },
    { id: 'rate', label: 'Feed rate', kind: 'select', options: [['5', 'Slow'], ['3', 'Normal'], ['1.6', 'Fast']] },
    { id: 'clear', label: 'Clear jams', kind: 'button' },
    { id: 'reset', label: 'Reset plant', kind: 'button' },
  ],

  create() { return { boxes: [], p: 0, ph: 0, feed: true, rate: '3', spawnT: 2.5, n: 0, run: false, cnt: { aS: 0, aT: 0, bS: 0, bT: 0, jam: 0 }, faults: {}, msgs: [] }; },

  sig(s, k) {
    switch (k) {
      case 'div_ext': return s.p >= 0.97;
      case 'div_ret': return s.p <= 0.03;
      case 'motor_running': return s.run;
      case 'jam': return s.boxes.some(b => b.s === 'jam');
      case 'div_pos': return s.p * 100;
      case 'belt_speed': return s.run ? SPEED * MM / 1000 : 0;
      case 'count_a': return s.cnt.aS + s.cnt.aT;
    }
    return 0;
  },
  probe(s, k, mm) {
    const x = toPx(mm);
    return s.boxes.some(b => Math.abs(b.x - x) < 20 && Math.abs(b.y - BELT_Y) < 30 && (k === 'box' || (k === 'tall' && b.tall) || (k === 'short' && !b.tall)));
  },
  doAction(s, id, v) {
    if (id === 'feed') s.feed = !!v;
    else if (id === 'rate') s.rate = String(v);
    else if (id === 'clear') s.boxes = s.boxes.filter(b => b.s !== 'jam');
    else if (id === 'reset') { s.boxes = []; s.p = 0; s.cnt = { aS: 0, aT: 0, bS: 0, bT: 0, jam: 0 }; }
  },
  actionState(s) { return { feed: s.feed, rate: s.rate }; },

  step(s, o, dt) {
    s.run = !!o.Q_Conveyor;
    const v = s.run ? SPEED : 0;
    s.ph = (s.ph + v * dt) % 30;
    const pPrev = s.p;
    const ext = o.Q_Divert && !s.faults.airLost;
    s.p = clamp(s.p + (ext ? 1 : -1) * dt / 0.5, 0, 1);
    if (s.feed) {
      s.spawnT += dt;
      if (s.spawnT >= parseFloat(s.rate) && !s.boxes.some(b => b.x < 80 && Math.abs(b.y - BELT_Y) < 36)) {
        s.spawnT = 0;
        const tall = s.faults.tallOnly ? true : s.faults.shortOnly ? false : Math.random() < 0.4;
        s.boxes.push({ id: ++s.n, x: 40, y: BELT_Y, tall, s: 'belt', pm: 0 });
      }
    }
    if (v > 0) {
      const bs = s.boxes.filter(b => b.s === 'belt').sort((a, b) => b.x - a.x);
      for (const b of bs) {
        let nx = b.x + v * dt;
        for (const q of s.boxes) if (q !== b && q.x > b.x && Math.abs(q.y - b.y) < 36) nx = Math.min(nx, q.x - 38);
        b.x = Math.max(b.x, nx);
        if (b.x > X_END) { b.s = 'binA'; s.cnt[b.tall ? 'aT' : 'aS']++; }
      }
    }
    for (const b of s.boxes) {
      const dx = b.x - X_SORT;
      if (b.s === 'belt' && s.p > 0.05 && Math.abs(dx) < 40) {
        if (Math.abs(dx) <= 22 && s.p > pPrev) { b.s = 'push'; b.pm = s.p; }
        else { b.s = 'jam'; s.cnt.jam++; }
      }
      if (b.s === 'push') {
        if (s.p >= b.pm) {
          b.pm = s.p; b.y = BELT_Y + s.p * 80;
          if (s.p >= 0.97) { b.s = 'binB'; s.cnt[b.tall ? 'bT' : 'bS']++; }
        } else if (s.p < b.pm - 0.05) {
          if (b.y - BELT_Y > 40) { b.s = 'binB'; s.cnt[b.tall ? 'bT' : 'bS']++; }
          else { b.s = 'jam'; s.cnt.jam++; }
        }
      }
    }
    s.boxes = s.boxes.filter(b => b.s !== 'binA' && b.s !== 'binB');
    const m = [];
    if (s.boxes.some(b => b.s === 'jam')) m.push('JAM at the pusher — a box was caught by the pusher plate. Use "Clear jams".');
    if (s.faults.airLost && o.Q_Divert) m.push('Pusher solenoid is energised but there is no air pressure.');
    s.msgs = m;
  },

  view(s) {
    return { boxes: s.boxes.map(b => ({ x: b.x, y: b.y, tall: b.tall, s: b.s, id: b.id })), p: s.p, ph: s.ph, run: s.run, cnt: s.cnt,
      faults: s.faults, msgs: s.msgs, act: { feed: s.feed, rate: s.rate } };
  },

  defaults() {
    return {
      globals: GLOBALS,
      pous: [
        { id: 'sorter', name: 'Sorter', lang: 'ST', src: SORTER },
        { id: 'control', name: 'Control', lang: 'LD', rungs: JSON.parse(JSON.stringify(CONTROL_RUNGS)) },
      ],
      sensors: [
        ...panelSensors(),
        probe('I_PE_Entry', 'box', 500, { desc: 'Photoeye PE-1 at the infeed' }),
        probe('I_PE_Sort', 'box', 2000, { desc: 'Photoeye PE-2 at the sort station' }),
        probe('I_Tall', 'tall', 2000, { desc: 'Height sensor HT-2 at the sort station (TRUE = tall box)' }),
        probe('I_PE_Exit', 'box', 3400, { desc: 'Photoeye PE-3 near the end of the belt' }),
        disc('I_DivExtended', 'div_ext', 'NO', { desc: 'Pusher extended limit switch' }),
        disc('I_DivRetracted', 'div_ret', 'NO', { desc: 'Pusher retracted limit switch' }),
      ],
      hmi: [
        W('label', 20, 10, 520, 40, { label: 'CONVEYOR C-1 — BOX SORTER', size: 22 }),
        W('motor', 30, 70, 130, 120, { tag: 'Q_Conveyor', label: 'M-1 Conveyor' }),
        W('lamp', 180, 70, 160, 50, { tag: 'I_PE_Entry', label: 'PE-1 Infeed', color: 'amber' }),
        W('lamp', 180, 130, 160, 50, { tag: 'I_PE_Sort', label: 'PE-2 Sort', color: 'amber' }),
        W('lamp', 180, 190, 160, 50, { tag: 'I_Tall', label: 'HT-2 Tall', color: 'amber' }),
        W('lamp', 180, 250, 160, 50, { tag: 'I_PE_Exit', label: 'PE-3 Exit', color: 'amber' }),
        W('lamp', 30, 210, 130, 50, { tag: 'Q_Divert', label: 'Pusher', color: 'blue' }),
        W('value', 360, 70, 150, 70, { tag: 'State', label: 'State', dec: 0 }),
        W('value', 360, 150, 150, 70, { tag: 'TallCount', label: 'Tall → B', dec: 0 }),
        W('value', 360, 230, 150, 70, { tag: 'ShortCount', label: 'Short → A', dec: 0 }),
        W('value', 360, 310, 150, 70, { tag: 'ExitCount.CV', label: 'Exit count', dec: 0 }),
        W('button', 540, 70, 230, 70, { tag: 'HMI_Start', label: 'START', color: 'green' }),
        W('button', 540, 150, 230, 70, { tag: 'HMI_Stop', label: 'STOP', color: 'red' }),
        W('button', 540, 230, 230, 60, { tag: 'HMI_Reset', label: 'RESET FAULT', color: 'blue' }),
        W('lamp', 540, 300, 230, 50, { tag: 'Running', label: 'Running', color: 'green' }),
        W('lamp', 540, 360, 230, 50, { tag: 'Fault', label: 'Fault', color: 'red' }),
        W('alarms', 20, 425, 760, 45, {}),
      ],
      alarms: [
        A('I_EStop', 'FALSE', '', 'Emergency stop pressed', 'High'),
        A('Fault', 'TRUE', '', 'Conveyor fault — reset required', 'High'),
      ],
      pens: [{ tag: 'Q_Conveyor', min: 0, max: 1 }, { tag: 'I_PE_Sort', min: 0, max: 1 }, { tag: 'Q_Divert', min: 0, max: 1 }, { tag: 'State', min: 0, max: 40 }],
    };
  },
};
