'use strict';
const { analog, sw, disc, panelSensors, W, A, clamp, approach, ramp } = require('./common');

const VTOT = 70;                       // vessel total volume, L
const PATM = 1.013;                    // bar abs
const psat = T => PATM * Math.exp(4892 * (1 / 373.15 - 1 / (T + 273.15)));   // water vapour pressure, bar abs

const VALVES = [
  ['xv01', 'Q_XV01_Media', 'XV-01 Media inlet'],
  ['xv02', 'Q_XV02_Inoc', 'XV-02 Inoculum inlet'],
  ['xv03', 'Q_XV03_Harvest', 'XV-03 Harvest outlet'],
  ['xv04', 'Q_XV04_Drain', 'XV-04 Bottom drain'],
  ['xv05', 'Q_XV05_Steam', 'XV-05 Clean steam (SIP)'],
  ['xv06', 'Q_XV06_JacketHot', 'XV-06 Jacket hot water'],
  ['xv07', 'Q_XV07_JacketCold', 'XV-07 Jacket cooling water'],
  ['xv08', 'Q_XV08_Air', 'XV-08 Sparge air'],
  ['xv09', 'Q_XV09_Vent', 'XV-09 Exhaust vent (sterile filter)'],
];

const SRC = `(* =========================================================
   BIOREACTOR BR-01 — batch recipe (example program)
   Phase: 10 charge media, 20 SIP heat + air purge, 25 SIP pressurise,
          30 SIP hold 121 degC, 40 cool down, 50 inoculate,
          60 fermentation (T / pH / DO / foam control), 70 harvest, 80 done
   STOP holds the batch; START resumes it.
   ========================================================= *)
VAR
  HMI_Start, HMI_Stop, HMI_Reset : BOOL;
  Running, Fault : BOOL;
  Phase    : INT;
  ChargeL  : REAL := 40.0;   (* media charge, L *)
  TempSP   : REAL := 37.0;   (* culture temperature, degC *)
  pH_SP    : REAL := 7.0;
  DO_SP    : REAL := 30.0;   (* dissolved oxygen, % *)
  AgitOut, AirOut : REAL;    (* % outputs to agitator VFD and air MFC *)
  DOPID    : PID := (KP := 2.0, TN := 30.0);   (* dissolved-oxygen controller *)
  Hot, Cold, VentHi : BOOL;
  StartEdge : R_TRIG;
  HoldTmr, InocTmr : TON;
  Batches  : INT;
END_VAR

// ===== Safety =====
IF NOT I_EStop OR AI_Pressure > 2.0 THEN Fault := TRUE; END_IF;
IF HMI_Reset AND I_EStop AND AI_Pressure < 1.5 THEN Fault := FALSE; END_IF;

// ===== Start / hold =====
StartEdge(CLK := I_Start OR HMI_Start);
IF StartEdge.Q AND NOT Fault THEN
  Running := TRUE;
  IF Phase = 0 OR Phase = 80 THEN Phase := 10; END_IF;
END_IF;
IF NOT I_Stop OR HMI_Stop OR Fault THEN Running := FALSE; END_IF;

// ===== Recipe =====
HoldTmr(IN := Phase = 30 AND AI_Temp >= 121.0, PT := T#25s);
InocTmr(IN := Phase = 50 AND Running, PT := T#6s);

IF Running THEN
  CASE Phase OF
    10: IF AI_Level >= ChargeL THEN Phase := 20; END_IF;
    20: IF AI_Temp >= 102.0 THEN Phase := 25; END_IF;      (* steam pushes air out of the vent *)
    25: IF AI_Temp >= 121.0 THEN Phase := 30; END_IF;      (* vent closed: pressurise *)
    30: IF HoldTmr.Q THEN Phase := 40; END_IF;             (* sterilisation hold *)
    40: IF AI_Temp <= TempSP + 1.0 THEN Phase := 50; END_IF;
    50: IF InocTmr.Q THEN Phase := 60; END_IF;
    60: IF AI_Glucose < 0.2 AND AI_OD > 5.0 THEN Phase := 70; END_IF;
    70: IF AI_Level < 0.5 THEN Batches := Batches + 1; Phase := 80; END_IF;
  END_CASE;
END_IF;

// ===== Control loops =====
// Jacket temperature: on/off with a small dead band
IF Phase = 40 THEN
  Cold := TRUE; Hot := FALSE;
ELSIF Phase = 50 OR Phase = 60 THEN
  IF AI_Temp > TempSP + 0.3 THEN Cold := TRUE; ELSIF AI_Temp < TempSP THEN Cold := FALSE; END_IF;
  IF AI_Temp < TempSP - 0.3 THEN Hot := TRUE; ELSIF AI_Temp > TempSP THEN Hot := FALSE; END_IF;
ELSE
  Cold := FALSE; Hot := FALSE;
END_IF;

// Dissolved oxygen: one PID, split-range output
//   PID 0-50 %  -> agitator 25-100 %,  PID 50-100 % -> air 20-100 %
DOPID(ACTUAL := AI_DO, SETPOINT := DO_SP, MANUAL := Phase <> 60, Y_MANUAL := 0.0);
IF Phase = 60 THEN
  AgitOut := LIMIT(25.0, 25.0 + DOPID.Y * 1.5, 100.0);
  AirOut  := LIMIT(20.0, 20.0 + (DOPID.Y - 50.0) * 1.6, 100.0);
ELSIF Phase = 40 OR Phase = 50 THEN
  AgitOut := 30.0;
  AirOut  := 100.0;              (* keep positive pressure while steam condenses *)
ELSE
  AgitOut := 30.0;
  AirOut  := 0.0;
END_IF;

// Headspace pressure: vent between 0.3 and 0.5 bar g
IF AI_Pressure > 0.5 THEN VentHi := TRUE; ELSIF AI_Pressure < 0.3 THEN VentHi := FALSE; END_IF;

// ===== Outputs =====
Q_XV01_Media      := Running AND Phase = 10;
Q_XV02_Inoc       := Running AND Phase = 50;
Q_XV03_Harvest    := Running AND Phase = 70;
Q_XV04_Drain      := FALSE;
Q_XV05_Steam      := Running AND (Phase = 20 OR Phase = 25 OR (Phase = 30 AND AI_Temp < 122.5));
Q_XV06_JacketHot  := Running AND Hot;
Q_XV07_JacketCold := Running AND Cold;
Q_XV08_Air        := Running AND Phase >= 40 AND Phase <= 60;
Q_XV09_Vent       := (Running AND (Phase = 10 OR Phase = 20 OR Phase >= 70))
                     OR (Phase >= 40 AND Phase <= 60 AND VentHi)
                     OR AI_Pressure > 1.6;            (* relief before the trip *)
Q_Agitator        := Running AND Phase >= 20 AND Phase <= 60 AND AI_Level > 5.0;
AO_AgitSpeed      := AgitOut;
AO_AirFlow        := AirOut;
Q_P01_Base        := Running AND Phase = 60 AND AI_pH < pH_SP - 0.1;
Q_P02_Acid        := Running AND Phase = 60 AND AI_pH > pH_SP + 0.3;
Q_P03_Antifoam    := Running AND Phase = 60 AND I_Foam;
Q_P04_Feed        := FALSE;                         (* exercise: fed-batch *)
AO_FeedRate       := 0.0;
Q_RunLamp         := Running;
Q_FaultLamp       := Fault;
`;

const signals = {
  level: { label: 'Vessel volume (load cells)', unit: 'L', kind: 'analog', min: 0, max: 70, dec: 1 },
  temp: { label: 'Broth temperature', unit: '°C', kind: 'analog', min: 0, max: 150, dec: 1 },
  jacket_temp: { label: 'Jacket return temperature', unit: '°C', kind: 'analog', min: 0, max: 100, dec: 1 },
  pressure: { label: 'Headspace pressure', unit: 'bar g', kind: 'analog', min: -1, max: 3, dec: 3 },
  ph: { label: 'pH', unit: 'pH', kind: 'analog', min: 2, max: 12, dec: 2 },
  do: { label: 'Dissolved oxygen', unit: '%', kind: 'analog', min: 0, max: 100, dec: 1 },
  od: { label: 'Biomass (optical density OD600)', unit: 'OD', kind: 'analog', min: 0, max: 40, dec: 2 },
  glucose: { label: 'Glucose (online analyser)', unit: 'g/L', kind: 'analog', min: 0, max: 30, dec: 2 },
  titer: { label: 'Product titer (at-line)', unit: 'g/L', kind: 'analog', min: 0, max: 5, dec: 2 },
  foam: { label: 'Foam height above broth', unit: 'cm', kind: 'analog', min: 0, max: 30, dec: 1 },
  agit_rpm: { label: 'Agitator speed (encoder)', unit: 'rpm', kind: 'analog', min: 0, max: 600, dec: 0 },
  air_flow: { label: 'Sparge air flow (MFC)', unit: 'L/min', kind: 'analog', min: 0, max: 100, dec: 1 },
  inoc_left: { label: 'Inoculum remaining in seed vessel', unit: 'L', kind: 'analog', min: 0, max: 2, dec: 2 },
  agit_running: { label: 'Agitator running (VFD feedback)', kind: 'bool' },
};
for (const [k, , label] of VALVES) {
  signals[k + '_open'] = { label: label + ' — open limit switch (ZSO)', kind: 'bool' };
  signals[k + '_closed'] = { label: label + ' — closed limit switch (ZSC)', kind: 'bool' };
}

module.exports = {
  id: 'bioreactor',
  name: 'Bioreactor / fermenter',
  blurb: 'A 70 L jacketed stirred-tank fermenter with 9 automated valves, 4 dosing pumps, agitator and air mass-flow controller. Steam-in-place, inoculation, Monod growth, DO cascade, pH and foam control, harvest.',
  actuators: [
    ...VALVES.map(([, tag, label]) => [tag, 'BOOL', 'DO', label + ' (TRUE = open, 1.2 s travel)']),
    ['Q_Agitator', 'BOOL', 'DO', 'Agitator M-01 run'],
    ['AO_AgitSpeed', 'REAL', 'AO', 'Agitator speed, 0–100 % (0–600 rpm)'],
    ['AO_AirFlow', 'REAL', 'AO', 'Air mass-flow controller setpoint, 0–100 % (0–100 L/min)'],
    ['Q_P01_Base', 'BOOL', 'DO', 'P-01 base (NaOH) dosing pump'],
    ['Q_P02_Acid', 'BOOL', 'DO', 'P-02 acid dosing pump'],
    ['Q_P03_Antifoam', 'BOOL', 'DO', 'P-03 antifoam dosing pump'],
    ['Q_P04_Feed', 'BOOL', 'DO', 'P-04 glucose feed pump (500 g/L)'],
    ['AO_FeedRate', 'REAL', 'AO', 'Feed pump speed, 0–100 %'],
    ['Q_RunLamp', 'BOOL', 'DO', 'Green RUN lamp'],
    ['Q_FaultLamp', 'BOOL', 'DO', 'Red FAULT lamp'],
  ],
  signals,
  valves: VALVES.map(v => ({ key: v[0], tag: v[1], label: v[2] })),
  faults: [['coolingLost', 'Cooling water lost'], ['steamLost', 'Clean steam supply lost'], ['contaminate', 'Contaminated inoculum'], ['airFilter', 'Sparge filter blocked (−80 % air)']],
  actions: [
    { id: 'inoc', label: 'Prepare fresh inoculum (2 L)', kind: 'button' },
    { id: 'reset', label: 'Reset vessel (empty, clean, unsterile)', kind: 'button' },
  ],

  create() {
    const v = {}; for (const [k] of VALVES) v[k] = 0;
    return { v, V: 0, mX: 0, mS: 0, mP: 0, mC: 0, T: 20, Tj: 20, pH: 7, DO: 100, foam: 0, af: 0, pAir: PATM,
      rpm: 0, air: 0, inoc: 2, sterile: false, dose: 0, vac: 0, harvested: 0, ang: 0, mu: 0,
      batch: null, foamOut: false, psv: 0, faults: {}, msgs: [], notes: [] };
  },

  sig(s, k) {
    const V = Math.max(s.V, 0.001);
    switch (k) {
      case 'level': return s.V;
      case 'temp': return s.T;
      case 'jacket_temp': return s.Tj;
      case 'pressure': return s.pAir + psat(s.T) - PATM;
      case 'ph': return s.V > 0.5 ? s.pH : 7.0;
      case 'do': return s.V > 0.5 ? s.DO : 0;
      case 'od': return s.V > 0.5 ? (s.mX + s.mC) / V * 2.5 : 0;
      case 'glucose': return s.V > 0.5 ? s.mS / V : 0;
      case 'titer': return s.V > 0.5 ? s.mP / V : 0;
      case 'foam': return s.foam;
      case 'agit_rpm': return s.rpm;
      case 'air_flow': return s.air;
      case 'inoc_left': return s.inoc;
      case 'agit_running': return s.rpm > 5;
    }
    const m = /^(xv\d\d)_(open|closed)$/.exec(k);
    if (m) return m[2] === 'open' ? s.v[m[1]] > 0.97 : s.v[m[1]] < 0.03;
    return 0;
  },
  doAction(s, id) {
    if (id === 'inoc') s.inoc = 2;
    if (id === 'reset') { const f = s.faults; Object.assign(s, module.exports.create()); s.faults = f; }
  },

  step(s, o, dtAll) {
    const n = Math.max(1, Math.ceil(dtAll / 0.05)), dt = dtAll / n;
    for (let i = 0; i < n; i++) this.sub(s, o, dt);
    const m = [];
    const pg = s.pAir + psat(s.T) - PATM;
    if (pg < -0.05) m.push(`VACUUM in the vessel (${pg.toFixed(2)} bar g) — unsterile air is being pulled in through the seals!`);
    if (s.foamOut) m.push('FOAM-OUT: foam reached the exhaust filter. Filter wetted, sterility lost.');
    if (s.psv > 0) m.push('Safety valve PSV-01 lifted (pressure > 2.5 bar g).');
    if (s.V >= VTOT - 1) m.push('Vessel completely full — liquid entering the exhaust line!');
    if (o.Q_XV05_Steam && s.faults.steamLost) m.push('Steam valve open but no steam supply.');
    if (s.T > 45 && s.mX > 0.01 && !s.sterilising) m.push('Culture is being killed by high temperature.');
    if (s.batch) m.push(s.batch);
    s.msgs = m;
  },

  sub(s, o, dt) {
    const f = s.faults;
    for (const [k, tag] of VALVES) s.v[k] = ramp(s.v[k], o[tag] ? 1 : 0, 1 / 1.2, dt);
    const v = s.v;
    const head0 = Math.max(VTOT - s.V, 1);
    let pg = s.pAir + psat(s.T) - PATM;

    // ---- liquid flows (L/s) ----
    const fMedia = 2.0 * v.xv01 * clamp(1 - pg / 3, 0, 1);
    const fInoc = s.inoc > 0 ? 0.4 * v.xv02 * clamp(1 - pg / 3, 0, 1) : 0;
    const push = clamp(1 + pg * 0.5, 0, 2);
    const fHarv = s.V > 0 ? 1.5 * v.xv03 * push : 0;
    const fDrain = s.V > 0 ? 1.0 * v.xv04 * push : 0;
    const fFeed = o.Q_P04_Feed ? 0.02 * clamp(o.AO_FeedRate, 0, 100) / 100 : 0;
    const fBase = o.Q_P01_Base ? 0.004 : 0, fAcid = o.Q_P02_Acid ? 0.004 : 0, fAF = o.Q_P03_Antifoam ? 0.003 : 0;
    const steamOn = v.xv05 > 0.05 && !f.steamLost;
    const fCond = steamOn ? 0.01 * v.xv05 : 0;
    const Vb = s.V;
    // composition of what leaves
    if (Vb > 0) {
      const out = Math.min(Vb, (fHarv + fDrain) * dt), frac = out / Vb;
      if (fHarv > 0 && out > 0) s.harvested += s.mP * frac * (fHarv / (fHarv + fDrain));
      s.mX -= s.mX * frac; s.mS -= s.mS * frac; s.mP -= s.mP * frac; s.mC -= s.mC * frac;
      s.V -= out;
    }
    const inMedia = fMedia * dt, inInoc = Math.min(s.inoc, fInoc * dt);
    s.inoc -= inInoc;
    const added = inMedia + inInoc + (fFeed + fBase + fAcid + fAF + fCond) * dt;
    if (added > 0) {
      const Vn = s.V + added;
      s.pH = (s.pH * s.V + 7.0 * (added - (fBase + fAcid) * dt)) / Math.max(Vn, 0.001) + (fBase - fAcid) * dt * 300 / Math.max(Vn, 5);
      s.T = (s.T * (s.V + 20) + 20 * (inMedia + inInoc)) / (Vn + 20);
      s.mS += 20 * inMedia + 500 * fFeed * dt;
      s.mX += 10 * inInoc;
      if (inInoc > 0) {
        if (!s.sterile || f.contaminate) s.mC = Math.max(s.mC, 0.002 * Vn) + (f.contaminate ? 0.05 * inInoc : 0);
        s.inoculated = true;
      }
      s.V = Math.min(VTOT, Vn);
    }
    if (fAF > 0) s.af = Math.min(3, s.af + 1.5 * dt);
    if (s.V < 0.01) { s.V = 0; s.mX = s.mS = s.mP = s.mC = 0; s.pH = 7; }
    if (s.V > 0.5 && !s.sterile && s.mC < 0.0005 * s.V) s.mC = 0.0005 * s.V;   // unsterile vessel is never truly empty of bugs

    // headspace compression / expansion
    const head1 = Math.max(VTOT - s.V, 1);
    s.pAir *= head0 / head1;

    // ---- gas ----
    s.air = approach(s.air, v.xv08 > 0.5 ? clamp(o.AO_AirFlow, 0, 100) * (f.airFilter ? 0.2 : 1) : 0, 2, dt);
    s.pAir += (s.air / 60) * PATM / head1 * dt;
    pg = s.pAir + psat(s.T) - PATM;
    const kv = 3 * v.xv09;
    if (kv > 0) {
      const ptot = s.pAir + psat(s.T);
      if (pg > 0) s.pAir -= kv * pg * (s.pAir / ptot) * dt;
      else s.pAir += kv * (-pg) * dt;                  // sterile air drawn in through the vent filter
    }
    pg = s.pAir + psat(s.T) - PATM;
    if (pg > 2.5) { s.pAir -= (pg - 2.3); s.psv = 5; }
    s.psv = Math.max(0, s.psv - dt);
    s.pAir = Math.max(0, s.pAir);

    // ---- thermal ----
    const cold = v.xv07 > 0.05 && !f.coolingLost, hot = v.xv06 > 0.05;
    let tjT = s.T, rj = 0.05;
    if (hot && cold) { tjT = 45; rj = 0.5; } else if (hot) { tjT = 85; rj = 0.5 * v.xv06; } else if (cold) { tjT = 5; rj = 0.5 * v.xv07; }
    s.Tj = approach(s.Tj, tjT, rj, dt);
    const Ct = s.V + 20;
    const X = s.V > 0.5 ? s.mX / s.V : 0, XC = s.V > 0.5 ? s.mC / s.V : 0, S = s.V > 0.5 ? s.mS / s.V : 0;
    let gen = 0;
    const steamHeat = steamOn ? 6 * v.xv05 * Math.max(0, 128 - s.T) : 0;
    s.sterilising = s.T > 60;
    // ---- biology ----
    s.rpm = ramp(s.rpm, o.Q_Agitator ? clamp(o.AO_AgitSpeed, 0, 100) * 6 : 0, 200, dt);
    if (s.V > 0.5) {
      const fT = Math.exp(-(((s.T - 37) / 6) ** 2)), fpH = Math.exp(-(((s.pH - 7) / 0.9) ** 2)), fDO = s.DO / (s.DO + 8);
      const mu = 0.025 * S / (0.5 + S) * fT * fpH * fDO;
      const muC = 0.04 * S / (0.5 + S) * Math.exp(-(((s.T - 32) / 10) ** 2)) * Math.exp(-(((s.pH - 6) / 2) ** 2)) * (0.3 + 0.7 * fDO);
      const kd = s.T > 45 ? 0.05 + 0.03 * (s.T - 45) : 0.0005;
      s.mu = mu;
      const dX = (mu - kd) * s.mX * dt, dC = (muC - kd) * s.mC * dt;
      const useS = Math.min(s.mS, (mu * s.mX + muC * s.mC) / 0.5 * dt);
      s.mX = Math.max(0, s.mX + dX); s.mC = Math.max(0, s.mC + dC); s.mS = Math.max(0, s.mS - useS);
      s.mP += 0.15 * mu * s.mX * dt;
      gen = 40 * (mu * X + muC * XC) * s.V / 50;
      // oxygen
      const airEff = s.air / 100;
      const kla = (s.air > 0.5 ? 0.6 * Math.pow(s.rpm / 600, 1.4) * (0.15 + 0.85 * Math.sqrt(airEff)) + 0.01 * airEff : 0.02 * s.rpm / 600) * (1 - 0.1 * Math.min(1, s.af));
      const our = 60 * (mu * X + muC * XC);
      s.DO = clamp(s.DO + (kla * (100 - s.DO) - our) * dt, 0, 100);
      if (s.T > 90) s.DO = Math.max(0, s.DO - 5 * dt);
      // pH
      s.pH = clamp(s.pH - (0.12 * mu * X + 0.5 * muC * XC) * dt, 2.5, 11);
      // foam
      const foamGen = airEff * (0.4 + 0.25 * X + 1.5 * XC) * (s.rpm > 50 ? 1 : 0.5);
      s.foam = Math.max(0, s.foam + (foamGen - 0.15 * s.foam - 3 * s.af) * dt);
    } else { s.foam = Math.max(0, s.foam - s.foam * 0.5 * dt); s.DO = approach(s.DO, 100, 0.2, dt); s.mu = 0; }
    s.af = Math.max(0, s.af - 0.08 * dt);
    s.T += ((s.Tj - s.T) * 2 * (s.V > 2 ? 1 : 0.3) + steamHeat + gen + (20 - s.T) * 0.1) / Ct * dt;
    if (s.rpm > 5) s.ang = (s.ang + s.rpm * 6 * dt * 0.25) % 360;

    // ---- sterility (the truth) ----
    pg = s.pAir + psat(s.T) - PATM;
    s.vac = pg < -0.05 ? s.vac + dt : 0;
    if (s.foam >= 20) s.foamOut = true;
    if (s.T >= 121) {
      s.dose += dt;
      if (s.dose >= 20) { s.sterile = true; s.mC = 0; s.mX = 0; s.foamOut = false; s.lostWhy = ''; }
    } else if (s.T < 110) s.dose = 0;
    if (s.sterile && (s.vac > 1 || s.foamOut)) { s.sterile = false; s.lostWhy = s.foamOut ? 'foam-out' : 'vacuum'; }
    // harvest result
    if (Vb < 0.5 && fMedia > 0) { s.harvested = 0; s.wasContam = false; s.batch = null; s.batchDone = false; }   // new batch
    if (s.V > 0.5 && s.mC / s.V > 0.05) s.wasContam = true;
    if (s.V < 0.5 && s.harvested > 0.01 && !s.batchDone) {
      s.batch = `Batch harvested: ${s.harvested.toFixed(1)} g product` + (s.wasContam ? ' — CONTAMINATED, batch rejected.' : ' — clean batch.');
      s.batchDone = true;
    }
  },

  view(s) {
    const V = Math.max(s.V, 0.001);
    return { V: s.V, T: s.T, Tj: s.Tj, pH: s.pH, DO: s.DO, foam: s.foam, p: s.pAir + psat(s.T) - PATM, rpm: s.rpm, air: s.air,
      X: s.V > 0.5 ? s.mX / V : 0, C: s.V > 0.5 ? s.mC / V : 0, S: s.V > 0.5 ? s.mS / V : 0, P: s.V > 0.5 ? s.mP / V : 0,
      v: s.v, ang: s.ang, sterile: s.sterile, dose: s.dose, inoc: s.inoc, mu: s.mu, harvested: s.harvested,
      contam: !!s.wasContam, lostWhy: s.lostWhy || '', faults: s.faults, msgs: s.msgs };
  },

  defaults() {
    return {
      src: SRC,
      sensors: [
        ...panelSensors(),
        analog('AI_Level', 'level', 0, 70, { desc: 'Load cells WT-01 as volume, 0–70 L' }),
        analog('AI_Temp', 'temp', 0, 150, { desc: 'Broth temperature TT-01, 0–150 °C' }),
        analog('AI_JacketTemp', 'jacket_temp', 0, 100, { desc: 'Jacket return TT-02, 0–100 °C' }),
        analog('AI_Pressure', 'pressure', -1, 3, { noise: 0.05, desc: 'Headspace PT-01, −1…3 bar g' }),
        analog('AI_pH', 'ph', 2, 12, { noise: 0.05, desc: 'pH probe AT-01' }),
        analog('AI_DO', 'do', 0, 100, { desc: 'Dissolved oxygen AT-02, 0–100 %' }),
        analog('AI_OD', 'od', 0, 40, { desc: 'Biomass probe AT-03 (OD600)' }),
        analog('AI_Glucose', 'glucose', 0, 30, { noise: 0.05, desc: 'Online glucose analyser AT-04, g/L' }),
        sw('I_Foam', 'foam', '>=', 5, { hyst: 1, desc: 'Foam probe LSH-02 (conductance), trips at 5 cm' }),
        disc('I_SteamClosed', 'xv05_closed', 'NO', { desc: 'XV-05 steam valve closed limit switch (ZSC)' }),
      ],
      hmi: [
        W('label', 20, 8, 560, 36, { label: 'BIOREACTOR BR-01 — BATCH RECIPE', size: 20 }),
        W('bar', 20, 50, 80, 300, { tag: 'AI_Level', label: 'Volume', min: 0, max: 70, unit: 'L', vert: true, color: 'blue' }),
        W('value', 110, 50, 140, 64, { tag: 'AI_Temp', label: 'TT-01 Temp', unit: '°C', dec: 1 }),
        W('value', 260, 50, 140, 64, { tag: 'AI_Pressure', label: 'PT-01 Press.', unit: 'bar', dec: 2 }),
        W('value', 410, 50, 120, 64, { tag: 'AI_pH', label: 'pH', dec: 2 }),
        W('value', 540, 50, 120, 64, { tag: 'AI_DO', label: 'DO', unit: '%', dec: 1 }),
        W('value', 670, 50, 110, 64, { tag: 'AI_OD', label: 'OD600', dec: 2 }),
        W('value', 110, 124, 140, 64, { tag: 'Phase', label: 'Phase', dec: 0 }),
        W('value', 260, 124, 140, 64, { tag: 'AI_Glucose', label: 'Glucose', unit: 'g/L', dec: 2 }),
        W('value', 410, 124, 120, 64, { tag: 'AgitOut', label: 'Agitator', unit: '%', dec: 0 }),
        W('value', 540, 124, 120, 64, { tag: 'AirOut', label: 'Air MFC', unit: '%', dec: 0 }),
        W('lamp', 670, 124, 110, 64, { tag: 'I_Foam', label: 'Foam', color: 'amber' }),
        W('valve', 110, 198, 74, 72, { tag: 'Q_XV01_Media', label: 'XV-01' }),
        W('valve', 188, 198, 74, 72, { tag: 'Q_XV02_Inoc', label: 'XV-02' }),
        W('valve', 266, 198, 74, 72, { tag: 'Q_XV03_Harvest', label: 'XV-03' }),
        W('valve', 344, 198, 74, 72, { tag: 'Q_XV04_Drain', label: 'XV-04' }),
        W('valve', 422, 198, 74, 72, { tag: 'Q_XV05_Steam', label: 'XV-05' }),
        W('valve', 500, 198, 74, 72, { tag: 'Q_XV06_JacketHot', label: 'XV-06' }),
        W('valve', 578, 198, 74, 72, { tag: 'Q_XV07_JacketCold', label: 'XV-07' }),
        W('valve', 656, 198, 60, 72, { tag: 'Q_XV08_Air', label: 'XV-08' }),
        W('valve', 720, 198, 60, 72, { tag: 'Q_XV09_Vent', label: 'XV-09' }),
        W('setpoint', 110, 280, 140, 64, { tag: 'TempSP', label: 'Temp SP', unit: '°C', dec: 1 }),
        W('setpoint', 260, 280, 140, 64, { tag: 'pH_SP', label: 'pH SP', dec: 2 }),
        W('setpoint', 410, 280, 120, 64, { tag: 'DO_SP', label: 'DO SP', unit: '%', dec: 0 }),
        W('motor', 540, 280, 120, 64, { tag: 'Q_Agitator', label: 'M-01' }),
        W('value', 670, 280, 110, 64, { tag: 'Batches', label: 'Batches', dec: 0 }),
        W('button', 20, 360, 170, 50, { tag: 'HMI_Start', label: 'START / RESUME', color: 'green' }),
        W('button', 200, 360, 170, 50, { tag: 'HMI_Stop', label: 'HOLD', color: 'red' }),
        W('button', 380, 360, 170, 50, { tag: 'HMI_Reset', label: 'RESET', color: 'blue' }),
        W('lamp', 560, 360, 105, 50, { tag: 'Running', label: 'Run', color: 'green' }),
        W('lamp', 675, 360, 105, 50, { tag: 'Fault', label: 'Fault', color: 'red' }),
        W('alarms', 20, 420, 760, 50, {}),
      ],
      alarms: [
        A('I_EStop', 'FALSE', '', 'Emergency stop pressed', 'High'),
        A('AI_Pressure', '>', 1.8, 'Vessel pressure high-high', 'High'),
        A('AI_Pressure', '<', -0.03, 'Vessel under vacuum — sterility at risk', 'High'),
        A('AI_Temp', '>', 40, 'Broth temperature high (culture phase)', 'Medium'),
        A('AI_DO', '<', 10, 'Dissolved oxygen low', 'Medium'),
        A('I_Foam', 'TRUE', '', 'Foam detected', 'Low'),
        A('Fault', 'TRUE', '', 'Bioreactor fault — reset required', 'High'),
      ],
      pens: [{ tag: 'AI_Temp', min: 0, max: 130 }, { tag: 'AI_Pressure', min: -1, max: 2 }, { tag: 'AI_DO', min: 0, max: 100 }, { tag: 'AgitOut', min: 0, max: 100 }],
    };
  },
};
