'use strict';
const { analog, disc, probe, panelSensors, W, A, clamp, approach, ramp } = require('./common');

// Internal units: mm along the vial track. Pockets every 70 mm on an indexing belt.
const PITCH = 70, X_FILL = 210, X_STOP = 350, X_REJ = 490, X_END = 630, SPEED = 60;
const TARGET = 2.0, TOL = 0.05;

const SRC = `(* =========================================================
   ASEPTIC VIAL FILLER — isolator with VHP bio-decontamination
   Production: index -> fill (load cell) -> stopper -> reject/accept
   Decon:      0 idle, 10 gassing, 20 dwell, 30 aeration
   Run a decon cycle (HMI_Decon) before production can start.
   ========================================================= *)
VAR
  HMI_Start, HMI_Stop, HMI_Reset, HMI_Decon : BOOL;
  Running, Fault, Sterile, EnvOK, EnvLost : BOOL;
  FillSP     : REAL := 2.0;    (* target fill, g *)
  FillTol    : REAL := 0.05;   (* +/- tolerance, g *)
  Preact     : REAL := 0.03;   (* stop the pump early to allow for run-down *)
  FanSP      : REAL := 85.0;   (* HEPA fan speed, % *)
  Step       : INT;            (* production sequence *)
  Decon      : INT;            (* decontamination sequence *)
  LastWeight : REAL;
  BadAtFill, BadAtStopper, BadAtReject : BOOL;  (* shift register: one bit per pocket *)
  Good, Rejected : INT;
  StartEdge, DeconEdge, InPosEdge : R_TRIG;
  SettleTmr, DwellTmr, LowDPTmr : TON;
END_VAR

// ===== Faults =====
IF NOT I_EStop THEN Fault := TRUE; END_IF;
IF HMI_Reset AND I_EStop THEN Fault := FALSE; END_IF;

// ===== Environment (EU GMP Annex 1, Grade A) =====
Q_HEPAFan   := TRUE;                  (* the isolator fan always runs *)
AO_FanSpeed := FanSP;
LowDPTmr(IN := AI_DP < 5.0, PT := T#3s);
IF NOT I_DoorClosed OR LowDPTmr.Q THEN
  Sterile := FALSE;                   (* barrier breached *)
END_IF;
EnvOK := Sterile AND AI_Airflow >= 0.36 AND AI_DP >= 10.0
         AND AI_Particles <= 3520.0 AND AI_H2O2 <= 1.0;

// ===== VHP bio-decontamination =====
DeconEdge(CLK := HMI_Decon);
DwellTmr(IN := Decon = 20 AND AI_H2O2 >= 250.0, PT := T#35s);
CASE Decon OF
  0:  IF DeconEdge.Q AND NOT Running AND I_DoorClosed AND NOT Fault THEN
        Sterile := FALSE;
        Decon := 10;
      END_IF;
  10: IF AI_H2O2 >= 300.0 THEN Decon := 20; END_IF;          (* gassing *)
  20: IF DwellTmr.Q THEN Decon := 30; END_IF;                (* dwell *)
  30: IF AI_H2O2 <= 0.5 THEN                                 (* aeration *)
        Sterile := TRUE;
        Decon := 0;
      END_IF;
END_CASE;
IF Fault OR NOT I_DoorClosed THEN Decon := 0; END_IF;
Q_H2O2Gen  := Decon = 10 OR (Decon = 20 AND AI_H2O2 < 290.0);
Q_Aeration := Decon = 30;

// ===== Start / stop =====
StartEdge(CLK := I_Start OR HMI_Start);
IF StartEdge.Q AND NOT Fault AND Decon = 0 THEN Running := TRUE; END_IF;
IF NOT I_Stop OR HMI_Stop OR Fault THEN Running := FALSE; END_IF;

// ===== Production sequence =====
InPosEdge(CLK := I_InPos);
SettleTmr(IN := Step = 23, PT := T#300ms);

CASE Step OF
  0:  IF Running AND EnvOK AND I_NeedleUp AND I_StopperUp THEN Step := 10; END_IF;
  10: IF InPosEdge.Q THEN Step := 20; END_IF;                 (* index one pocket *)
  20: EnvLost := FALSE;
      IF I_VialAtFill THEN Step := 21;
      ELSE BadAtFill := FALSE; Step := 30; END_IF;
  21: IF I_NeedleDown THEN Step := 22; END_IF;                (* needles down *)
  22: IF AI_FillWeight >= FillSP - Preact THEN Step := 23; END_IF;   (* fill to weight *)
  23: IF SettleTmr.Q THEN                                     (* let the scale settle *)
        LastWeight := AI_FillWeight;
        BadAtFill := ABS(LastWeight - FillSP) > FillTol OR EnvLost;
        Step := 24;
      END_IF;
  24: IF I_NeedleUp THEN Step := 30; END_IF;
  30: IF I_VialAtStopper THEN
        IF NOT I_StopperAvail THEN BadAtStopper := TRUE; END_IF;
        Step := 31;
      ELSE
        Step := 40;
      END_IF;
  31: IF I_StopperDown THEN Step := 32; END_IF;
  32: IF I_StopperUp THEN Step := 40; END_IF;
  40: IF I_VialAtReject AND BadAtReject THEN
        Step := 41;
      ELSE
        IF I_VialAtReject THEN Good := Good + 1; END_IF;
        Step := 50;
      END_IF;
  41: IF I_RejectOut THEN Step := 42; END_IF;
  42: IF NOT I_RejectOut THEN Rejected := Rejected + 1; Step := 50; END_IF;
  50: BadAtReject  := BadAtStopper;                           (* shift tracking data *)
      BadAtStopper := BadAtFill;
      BadAtFill    := FALSE;
      IF Running AND EnvOK THEN Step := 10; ELSE Step := 0; END_IF;
END_CASE;
IF Step >= 21 AND Step <= 23 AND NOT EnvOK THEN EnvLost := TRUE; END_IF;
IF Fault THEN Step := 0; END_IF;

// ===== Outputs =====
Q_Index      := Step = 10 AND NOT Fault;
Q_NeedleDown := Step >= 21 AND Step <= 23 AND NOT Fault;
Q_FillPump   := Step = 22 AND I_NeedleDown AND NOT Fault;
Q_Stopper    := Step = 31 AND NOT Fault;
Q_Reject     := Step = 41 AND NOT Fault;
Q_DoorLock   := Running OR Decon <> 0 OR AI_H2O2 > 1.0;
Q_RunLamp    := Running;
Q_FaultLamp  := Fault;
`;

function envTruth(s) { return s.sterile && s.air >= 0.36 && s.dp >= 10 && s.part <= 3520 && s.h2o2 <= 1; }

module.exports = {
  id: 'vialfiller',
  name: 'Aseptic vial filler (isolator)',
  blurb: 'A 4-station indexing vial filler inside a Grade A isolator: HEPA laminar flow, overpressure, particle counting and a VHP (H₂O₂) decontamination cycle. Every vial is graded: in spec, stoppered and truly sterile — or not.',
  actuators: [
    ['Q_Index', 'BOOL', 'DO', 'Index belt drive (60 mm/s, pockets every 70 mm)'],
    ['Q_NeedleDown', 'BOOL', 'DO', 'Fill needle carriage down (0.4 s travel)'],
    ['Q_FillPump', 'BOOL', 'DO', 'Peristaltic fill pump (≈1.0 g/s)'],
    ['Q_Stopper', 'BOOL', 'DO', 'Stopper press down (0.3 s travel)'],
    ['Q_Reject', 'BOOL', 'DO', 'Reject kicker extend (0.25 s)'],
    ['Q_HEPAFan', 'BOOL', 'DO', 'Isolator HEPA supply fan run'],
    ['AO_FanSpeed', 'REAL', 'AO', 'HEPA fan speed reference, 0–100 %'],
    ['Q_H2O2Gen', 'BOOL', 'DO', 'VHP generator: inject vaporised H₂O₂'],
    ['Q_Aeration', 'BOOL', 'DO', 'Catalytic aeration (breaks down H₂O₂)'],
    ['Q_DoorLock', 'BOOL', 'DO', 'Isolator door lock solenoid'],
    ['Q_RunLamp', 'BOOL', 'DO', 'Green RUN lamp'],
    ['Q_FaultLamp', 'BOOL', 'DO', 'Red FAULT lamp'],
  ],
  signals: {
    fill_weight: { label: 'Load cell under fill station (net)', unit: 'g', kind: 'analog', min: 0, max: 5, dec: 3 },
    dp: { label: 'Isolator differential pressure', unit: 'Pa', kind: 'analog', min: -10, max: 60, dec: 1 },
    airflow: { label: 'Unidirectional airflow velocity', unit: 'm/s', kind: 'analog', min: 0, max: 1, dec: 2 },
    particles: { label: 'Particle counter ≥0.5 µm', unit: '/m³', kind: 'analog', min: 0, max: 100000, dec: 0 },
    h2o2: { label: 'H₂O₂ concentration', unit: 'ppm', kind: 'analog', min: 0, max: 500, dec: 1 },
    product: { label: 'Product bag level', unit: '%', kind: 'analog', min: 0, max: 100, dec: 1 },
    stoppers: { label: 'Stoppers in hopper', unit: 'pcs', kind: 'analog', min: 0, max: 200, dec: 0 },
    in_pos: { label: 'Index belt in position (cam switch)', kind: 'bool' },
    needle_up: { label: 'Needles up (limit switch)', kind: 'bool' },
    needle_down: { label: 'Needles down (limit switch)', kind: 'bool' },
    stopper_up: { label: 'Stopper press up', kind: 'bool' },
    stopper_down: { label: 'Stopper press down', kind: 'bool' },
    stopper_avail: { label: 'Stopper available in chute', kind: 'bool' },
    reject_ext: { label: 'Reject kicker extended', kind: 'bool' },
    door_closed: { label: 'Isolator door closed (safety switch)', kind: 'bool' },
    door_locked: { label: 'Isolator door locked (lock feedback)', kind: 'bool' },
    belt_jam: { label: 'Machine jammed (torque limiter)', kind: 'bool' },
    fan_running: { label: 'HEPA fan running', kind: 'bool' },
  },
  probes: {
    vial: { label: 'Vial present', min: 70, max: 620 },
    stoppered: { label: 'Stoppered vial (camera)', min: 70, max: 620 },
    filled: { label: 'Filled vial (fill level camera)', min: 70, max: 620 },
  },
  faults: [['tubingWear', 'Pump tubing worn (−30 % flow)'], ['gloveBreach', 'Glove port breach'], ['hepaLoaded', 'HEPA filter loaded (−40 % airflow)'],
    ['infeedEmpty', 'Infeed out of vials'], ['gaps', 'Missing vials in pockets']],
  actions: [
    { id: 'door', label: 'Isolator door open', kind: 'toggle' },
    { id: 'product', label: 'Refill product bag', kind: 'button' },
    { id: 'stoppers', label: 'Refill stoppers', kind: 'button' },
    { id: 'clear', label: 'Clear jam / replace needles', kind: 'button' },
    { id: 'reset', label: 'Reset plant', kind: 'button' },
  ],

  create() {
    return { belt: 0, vials: [], n: 0, needle: 0, stopper: 0, kick: 0, flow: 0, jam: false, needleBent: false,
      air: 0, dp: 0, part: 40000, h2o2: 0, dose: 0, sterile: false, door: false, locked: false, lowDp: 0,
      product: 500, hopper: 120, fan: 0, streak: 0,
      cnt: { good: 0, badAcc: 0, rejBad: 0, rejGood: 0, broken: 0, spill: 0, exposures: 0 }, faults: {}, msgs: [], note: '' };
  },

  sig(s, k) {
    const atFill = s.vials.find(v => Math.abs(v.x - X_FILL) < 10);
    switch (k) {
      case 'fill_weight': return atFill ? atFill.w : 0;
      case 'dp': return s.dp;
      case 'airflow': return s.air;
      case 'particles': return s.part;
      case 'h2o2': return s.h2o2;
      case 'product': return s.product / 5;
      case 'stoppers': return s.hopper;
      case 'in_pos': { const r = ((s.belt % PITCH) + PITCH) % PITCH; return r < 2.5 || r > PITCH - 2.5; }
      case 'needle_up': return s.needle <= 0.03;
      case 'needle_down': return s.needle >= 0.97;
      case 'stopper_up': return s.stopper <= 0.03;
      case 'stopper_down': return s.stopper >= 0.97;
      case 'stopper_avail': return s.hopper > 0;
      case 'reject_ext': return s.kick >= 0.9;
      case 'door_closed': return !s.door;
      case 'door_locked': return s.locked;
      case 'belt_jam': return s.jam;
      case 'fan_running': return s.fan > 1;
    }
    return 0;
  },
  probe(s, k, mm) {
    return s.vials.some(v => Math.abs(v.x - mm) < 8 && (k === 'vial' || (k === 'stoppered' && v.stoppered) || (k === 'filled' && v.w > 0.5)));
  },
  doAction(s, id, val, rt) {
    if (id === 'door') {
      if (val && s.locked) { s.note = 'Door is locked by the PLC (Q_DoorLock).'; return; }
      s.door = !!val; s.note = '';
    } else if (id === 'product') s.product = 500;
    else if (id === 'stoppers') s.hopper = 120;
    else if (id === 'clear') { s.jam = false; s.needleBent = false; }
    else if (id === 'reset') { const f = s.faults; Object.assign(s, module.exports.create()); s.faults = f; }
  },
  actionState(s) { return { door: s.door }; },

  step(s, o, dt) {
    const f = s.faults;
    // ---- mechanics ----
    const moving = o.Q_Index && !s.jam;
    s.needle = ramp(s.needle, o.Q_NeedleDown ? (s.needleBent ? 0.3 : 1) : 0, 1 / 0.4, dt);
    s.stopper = ramp(s.stopper, o.Q_Stopper ? 1 : 0, 1 / 0.3, dt);
    s.kick = ramp(s.kick, o.Q_Reject ? 1 : 0, 1 / 0.25, dt);
    const breakVial = (v, why) => { v.broken = true; s.cnt.broken++; s.part += 30000; s.lastBreak = why; };
    if (moving) {
      const dx = SPEED * dt, before = Math.floor(s.belt / PITCH);
      s.belt += dx;
      for (const v of s.vials) v.x += dx;
      if (Math.floor(s.belt / PITCH) > before && !f.infeedEmpty && !(f.gaps && Math.random() < 0.2)) {
        s.vials.push({ id: ++s.n, x: PITCH + (s.belt % PITCH), w: 0, stoppered: false, contam: false, broken: false, h2o2: false });
      }
      if (s.needle > 0.15 || s.stopper > 0.15) {
        s.jam = true;
        if (s.needle > 0.15) s.needleBent = true;
        for (const v of s.vials) if ((s.needle > 0.15 && Math.abs(v.x - X_FILL) < 35) || (s.stopper > 0.15 && Math.abs(v.x - X_STOP) < 35)) breakVial(v, 'indexed with tooling down');
      }
    }
    // needles descending onto a misaligned vial
    for (const v of s.vials) {
      const dF = Math.abs(v.x - X_FILL), dS = Math.abs(v.x - X_STOP);
      if (s.needle > 0.4 && dF > 6 && dF < 25 && !v.broken) { breakVial(v, 'needles hit a misaligned vial'); s.needleBent = true; s.jam = true; }
      if (s.stopper > 0.5 && dS > 6 && dS < 25 && !v.broken) { breakVial(v, 'stopper press crushed a misaligned vial'); s.jam = true; }
    }
    // pump
    const target = o.Q_FillPump && s.product > 0 ? (f.tubingWear ? 0.7 : 1.0) : 0;
    s.flow = ramp(s.flow, target, 20, dt);
    s.env = envTruth(s);
    if (s.flow > 0) {
      const g = s.flow * dt;
      s.product = Math.max(0, s.product - g);
      const v = s.vials.find(q => !q.broken && Math.abs(q.x - X_FILL) <= 6);
      if (v && s.needle > 0.8) { v.w += g; if (!s.env) v.contam = true; if (v.w > 3.2) { s.cnt.spill += g; } }
      else s.cnt.spill += g;
    }
    // stopper press
    if (s.stopper >= 0.95) {
      const v = s.vials.find(q => !q.broken && Math.abs(q.x - X_STOP) <= 6);
      if (v && !v.stoppered && !s.pressed && s.hopper > 0) { v.stoppered = true; s.hopper--; }
      s.pressed = true;
    } else if (s.stopper < 0.5) s.pressed = false;
    // open product exposed to a bad environment or H2O2
    for (const v of s.vials) {
      if (v.w > 0.05 && !v.stoppered) { if (!s.env) v.contam = true; if (s.h2o2 > 1) v.h2o2 = true; }
    }
    // reject kicker and outfeed
    const grade = v => !v.broken && v.stoppered && Math.abs(v.w - TARGET) <= TOL && !v.contam && !v.h2o2;
    for (const v of s.vials) {
      if (v.broken) { v.gone = true; continue; }
      if (s.kick >= 0.9 && Math.abs(v.x - X_REJ) <= 15) { v.gone = true; s.cnt[grade(v) ? 'rejGood' : 'rejBad']++; }
      else if (v.x >= X_END) { v.gone = true; if (grade(v)) s.cnt.good++; else { s.cnt.badAcc++; s.lastBad = why(v); } }
    }
    s.vials = s.vials.filter(v => !v.gone);

    // ---- isolator environment ----
    s.locked = !!o.Q_DoorLock;
    s.fan = ramp(s.fan, o.Q_HEPAFan ? clamp(o.AO_FanSpeed, 0, 100) : 0, 40, dt);
    const airT = s.fan / 100 * 0.55 * (f.hepaLoaded ? 0.6 : 1);
    s.air = approach(s.air, airT, 1.0, dt);
    const dpT = s.air * 60 - (s.door ? 40 : 0) - (f.gloveBreach ? 6 : 0);
    s.dp = approach(s.dp, Math.max(-5, dpT), 0.8, dt);
    const clean = s.air >= 0.3 && !s.door;
    const partT = (clean ? 120 : 40000) + (f.gloveBreach ? 6000 : 0);
    s.part = Math.max(0, approach(s.part, partT, partT > s.part ? 0.08 : 0.25, dt));
    if (o.Q_H2O2Gen && !s.door) s.h2o2 = Math.min(450, s.h2o2 + 12 * dt);
    s.h2o2 -= s.h2o2 * (s.door ? 0.3 : o.Q_Aeration ? 0.18 : 0.004) * dt;
    if (s.h2o2 < 0.01) s.h2o2 = 0;
    // sterility (the truth the PLC can't see directly)
    s.lowDp = s.dp < 2 ? s.lowDp + dt : 0;
    if (s.door || f.gloveBreach || s.lowDp > 3) { if (s.sterile) s.sterilityLost = s.door ? 'door opened' : f.gloveBreach ? 'glove breach' : 'loss of overpressure'; s.sterile = false; s.dose = 0; }
    else if (s.h2o2 >= 250) { s.dose += dt; if (s.dose >= 30 && !s.sterile) { s.sterile = true; s.sterilityLost = ''; } }
    if (s.door && s.h2o2 > 1) { if (!s.exposing) s.cnt.exposures++; s.exposing = true; } else s.exposing = false;
    s.streak = (s.streak + dt * s.air * 300) % 400;

    const m = [];
    if (s.note) m.push(s.note);
    if (s.jam) m.push(`MACHINE JAM — ${s.lastBreak || 'tooling crash'}. ${s.needleBent ? 'Needles are bent. ' : ''}Use "Clear jam".`);
    if (s.exposing) m.push(`⚠ Operator exposed to ${s.h2o2.toFixed(0)} ppm H₂O₂ — door opened before aeration finished!`);
    if (s.flow > 0 && !s.vials.some(q => Math.abs(q.x - X_FILL) <= 6 && s.needle > 0.8)) m.push('Product is being pumped onto the machine (no vial / needles up).');
    if (s.product <= 0) m.push('Product bag empty.');
    if (s.hopper <= 0) m.push('Stopper hopper empty.');
    if (!s.sterile) m.push('Isolator is NOT sterile' + (s.sterilityLost ? ` (${s.sterilityLost})` : '') + ' — run a decon cycle.');
    s.msgs = m;
  },

  view(s) {
    return { belt: s.belt, vials: s.vials.map(v => ({ id: v.id, x: v.x, w: v.w, st: v.stoppered })), needle: s.needle, stopper: s.stopper, kick: s.kick,
      flow: s.flow, jam: s.jam, bent: s.needleBent, air: s.air, dp: s.dp, part: s.part, h2o2: s.h2o2, sterile: s.sterile, dose: s.dose,
      door: s.door, locked: s.locked, fan: s.fan, product: s.product / 5, hopper: s.hopper, streak: s.streak, env: !!s.env,
      cnt: s.cnt, faults: s.faults, msgs: s.msgs, act: { door: s.door } };
  },

  defaults() {
    return {
      src: SRC,
      sensors: [
        ...panelSensors(),
        disc('I_InPos', 'in_pos', 'NO', { desc: 'Index belt in position (cam)' }),
        probe('I_VialAtFill', 'vial', X_FILL, { desc: 'Vial present at fill station' }),
        probe('I_VialAtStopper', 'vial', X_STOP, { desc: 'Vial present at stopper station' }),
        probe('I_VialAtReject', 'vial', X_REJ, { desc: 'Vial present at reject station' }),
        disc('I_NeedleUp', 'needle_up'), disc('I_NeedleDown', 'needle_down'),
        disc('I_StopperUp', 'stopper_up'), disc('I_StopperDown', 'stopper_down'),
        disc('I_StopperAvail', 'stopper_avail', 'NO', { desc: 'Stopper available in the chute' }),
        disc('I_RejectOut', 'reject_ext', 'NO', { desc: 'Reject kicker extended' }),
        disc('I_DoorClosed', 'door_closed', 'NO', { desc: 'Isolator door closed (safety switch)' }),
        analog('AI_FillWeight', 'fill_weight', 0, 5, { noise: 0.1, desc: 'Load cell WT-1 under fill station, 0–5 g' }),
        analog('AI_DP', 'dp', -10, 60, { desc: 'Isolator ΔP PDT-1, −10…60 Pa' }),
        analog('AI_Airflow', 'airflow', 0, 1, { desc: 'Airflow velocity FT-1, 0–1 m/s' }),
        analog('AI_Particles', 'particles', 0, 100000, { noise: 0.05, desc: 'Particle counter PC-1 ≥0.5 µm, counts/m³' }),
        analog('AI_H2O2', 'h2o2', 0, 500, { noise: 0, desc: 'H₂O₂ sensor AT-1, 0–500 ppm' }),
      ],
      hmi: [
        W('label', 20, 8, 560, 36, { label: 'ASEPTIC FILLING LINE — ISOLATOR ISO-1', size: 20 }),
        W('value', 20, 50, 140, 64, { tag: 'AI_DP', label: 'ΔP', unit: 'Pa', dec: 1 }),
        W('value', 170, 50, 140, 64, { tag: 'AI_Airflow', label: 'Airflow', unit: 'm/s', dec: 2 }),
        W('value', 320, 50, 160, 64, { tag: 'AI_Particles', label: 'Particles ≥0.5µm', unit: '/m³', dec: 0 }),
        W('value', 490, 50, 140, 64, { tag: 'AI_H2O2', label: 'H₂O₂', unit: 'ppm', dec: 1 }),
        W('lamp', 640, 50, 140, 30, { tag: 'Sterile', label: 'Sterile', color: 'green' }),
        W('lamp', 640, 84, 140, 30, { tag: 'EnvOK', label: 'Grade A OK', color: 'green' }),
        W('value', 20, 124, 140, 64, { tag: 'Decon', label: 'Decon step', dec: 0 }),
        W('button', 170, 124, 140, 64, { tag: 'HMI_Decon', label: 'START DECON', color: 'blue' }),
        W('lamp', 320, 124, 160, 30, { tag: 'Q_H2O2Gen', label: 'VHP gassing', color: 'amber' }),
        W('lamp', 320, 158, 160, 30, { tag: 'Q_Aeration', label: 'Aeration', color: 'blue' }),
        W('lamp', 490, 124, 140, 30, { tag: 'Q_DoorLock', label: 'Door locked', color: 'amber' }),
        W('lamp', 490, 158, 140, 30, { tag: 'I_DoorClosed', label: 'Door closed', color: 'green' }),
        W('setpoint', 640, 124, 140, 64, { tag: 'FanSP', label: 'Fan speed', unit: '%', dec: 0 }),
        W('value', 20, 200, 140, 64, { tag: 'Step', label: 'Fill step', dec: 0 }),
        W('value', 170, 200, 140, 64, { tag: 'LastWeight', label: 'Last fill', unit: 'g', dec: 3 }),
        W('setpoint', 320, 200, 160, 64, { tag: 'FillSP', label: 'Fill target', unit: 'g', dec: 2 }),
        W('value', 490, 200, 140, 64, { tag: 'Good', label: 'Good', dec: 0 }),
        W('value', 640, 200, 140, 64, { tag: 'Rejected', label: 'Rejected', dec: 0 }),
        W('bar', 20, 276, 290, 40, { tag: 'AI_FillWeight', label: 'Fill weight', min: 0, max: 2.5, unit: 'g', color: 'blue' }),
        W('lamp', 320, 276, 160, 40, { tag: 'Q_FillPump', label: 'Fill pump', color: 'green' }),
        W('lamp', 490, 276, 140, 40, { tag: 'Q_Index', label: 'Indexing', color: 'green' }),
        W('lamp', 640, 276, 140, 40, { tag: 'Q_Reject', label: 'Reject', color: 'red' }),
        W('button', 20, 330, 180, 70, { tag: 'HMI_Start', label: 'START', color: 'green' }),
        W('button', 210, 330, 180, 70, { tag: 'HMI_Stop', label: 'STOP', color: 'red' }),
        W('button', 400, 330, 180, 70, { tag: 'HMI_Reset', label: 'RESET', color: 'blue' }),
        W('lamp', 590, 330, 190, 32, { tag: 'Running', label: 'Running', color: 'green' }),
        W('lamp', 590, 368, 190, 32, { tag: 'Fault', label: 'Fault', color: 'red' }),
        W('alarms', 20, 420, 760, 50, {}),
      ],
      alarms: [
        A('I_EStop', 'FALSE', '', 'Emergency stop pressed', 'High'),
        A('AI_DP', '<', 10, 'Isolator overpressure below 10 Pa', 'High'),
        A('AI_Particles', '>', 3520, 'Grade A particle limit exceeded (≥0.5 µm > 3520/m³)', 'High'),
        A('AI_Airflow', '<', 0.36, 'Unidirectional airflow below 0.36 m/s', 'Medium'),
        A('AI_H2O2', '>', 1, 'H₂O₂ above 1 ppm', 'Low'),
        A('Sterile', 'FALSE', '', 'Isolator not sterile — decon required', 'Low'),
        A('Fault', 'TRUE', '', 'Filler fault — reset required', 'High'),
      ],
      pens: [{ tag: 'AI_H2O2', min: 0, max: 400 }, { tag: 'AI_DP', min: -10, max: 60 }, { tag: 'AI_FillWeight', min: 0, max: 2.5 }, { tag: 'Step', min: 0, max: 50 }],
    };
  },
};

function why(v) {
  if (!v.stoppered) return 'not stoppered';
  if (v.contam) return 'filled/held open in a non-sterile environment';
  if (v.h2o2) return 'open product exposed to H₂O₂';
  return `fill weight ${v.w.toFixed(3)} g out of spec`;
}
