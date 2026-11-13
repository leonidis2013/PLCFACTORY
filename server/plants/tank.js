'use strict';
const { analog, sw, disc, panelSensors, W, A, clamp, ramp, approach } = require('./common');

const CAP = 200; // litres

const SRC = `(* =========================================================
   TANK T-101 — fill, heat & drain batch (example program)
   Sequence: 0 Idle -> 10 Fill -> 20 Heat & mix -> 30 Drain -> 10 ...
   ========================================================= *)
VAR
  HMI_Start   : BOOL;           (* momentary HMI buttons *)
  HMI_Stop    : BOOL;
  HMI_Reset   : BOOL;
  Running     : BOOL;
  Fault       : BOOL;
  TempSP      : REAL := 45.0;   (* heat setpoint, degC *)
  TempPID     : PID := (KP := 8.0, TN := 60.0, TV := 0.0);   (* tune me! *)
  DrainSpeed  : REAL := 80.0;   (* outlet pump speed, % *)
  Step        : INT;
  BatchCount  : INT;
  StartEdge   : R_TRIG;
  HoldTimer   : TON;            (* hold at temperature *)
END_VAR

// ---- Faults: E-stop latches a fault, operator resets it ----
IF NOT I_EStop THEN
  Fault := TRUE;
END_IF;
IF HMI_Reset AND I_EStop THEN
  Fault := FALSE;
END_IF;

// ---- Start / stop seal-in ----
StartEdge(CLK := I_Start OR HMI_Start);
IF StartEdge.Q AND NOT Fault THEN
  Running := TRUE;
END_IF;
IF NOT I_Stop OR HMI_Stop OR Fault THEN   (* I_Stop is an NC contact *)
  Running := FALSE;
END_IF;

// ---- Batch sequence ----
IF NOT Running THEN
  Step := 0;
END_IF;

// Call timers every scan (not inside CASE) so they reset properly
HoldTimer(IN := Step = 20 AND ABS(AI_Temp - TempSP) <= 1.0, PT := T#10s);   (* within 1 degC for 10 s *)

// Temperature PID: active while heating, held reset (output 0 %, integral cleared) otherwise
TempPID(ACTUAL := AI_Temp, SETPOINT := TempSP, RESET := Step <> 20);

CASE Step OF
  0:  IF Running THEN Step := 10; END_IF;
  10: IF I_LSH THEN Step := 20; END_IF;            (* fill until high switch *)
  20: IF HoldTimer.Q THEN Step := 30; END_IF;      (* heat & hold *)
  30: IF NOT I_LSL THEN                            (* drain until low switch clears *)
        BatchCount := BatchCount + 1;
        Step := 10;
      END_IF;
END_CASE;

// ---- Outputs ----
Q_InletValve := Step = 10;
Q_Mixer      := (Step = 20 OR Step = 30) AND I_LSL;
Q_Heater     := Step = 20 AND I_LSL;          (* interlock: never heat a dry tank *)
AO_HeaterPower := TempPID.Y;                  (* SCR power 0-100 % *)
Q_OutletPump := Step = 30;
AO_PumpSpeed := DrainSpeed;
Q_RunLamp    := Running;
Q_FaultLamp  := Fault;
`;

module.exports = {
  id: 'tank',
  name: 'Tank: fill, heat & drain',
  blurb: 'A 200 L process tank with inlet valve, VFD outlet pump, mixer and heater. Learn seal-in circuits, sequences, analog values and interlocks.',
  actuators: [
    ['Q_InletValve', 'BOOL', 'DO', 'Inlet valve XV-101 (TRUE = open, 1.5 s travel)'],
    ['Q_OutletPump', 'BOOL', 'DO', 'Outlet pump P-101 run command'],
    ['AO_PumpSpeed', 'REAL', 'AO', 'Outlet pump VFD speed reference, 0–100 %'],
    ['Q_Mixer', 'BOOL', 'DO', 'Mixer motor M-101 run command'],
    ['Q_Heater', 'BOOL', 'DO', 'Heater H-101 contactor (heats only when level > 10 %)'],
    ['AO_HeaterPower', 'REAL', 'AO', 'Heater SCR power, 0–100 % (needs Q_Heater TRUE)'],
    ['Q_RunLamp', 'BOOL', 'DO', 'Green RUN lamp on operator panel'],
    ['Q_FaultLamp', 'BOOL', 'DO', 'Red FAULT lamp on operator panel'],
  ],
  signals: {
    level: { label: 'Tank level', unit: '%', kind: 'analog', min: 0, max: 100, dec: 1 },
    volume: { label: 'Tank volume', unit: 'L', kind: 'analog', min: 0, max: CAP, dec: 1 },
    temp: { label: 'Liquid temperature (RTD in thermowell, ~3 s lag)', unit: '°C', kind: 'analog', min: 0, max: 100, dec: 1 },
    temp_fast: { label: 'Liquid temperature (bare RTD, no lag)', unit: '°C', kind: 'analog', min: 0, max: 100, dec: 1 },
    heater_power: { label: 'Heater power (power meter)', unit: '%', kind: 'analog', min: 0, max: 100, dec: 0 },
    inflow: { label: 'Inlet flow', unit: 'L/min', kind: 'analog', min: 0, max: 900, dec: 0 },
    outflow: { label: 'Outlet flow', unit: 'L/min', kind: 'analog', min: 0, max: 700, dec: 0 },
    valve_pos: { label: 'Inlet valve position', unit: '%', kind: 'analog', min: 0, max: 100, dec: 0 },
    pump_speed: { label: 'Pump actual speed', unit: '%', kind: 'analog', min: 0, max: 100, dec: 0 },
    valve_open: { label: 'Inlet valve fully open (limit switch ZSO)', kind: 'bool' },
    valve_closed: { label: 'Inlet valve fully closed (limit switch ZSC)', kind: 'bool' },
    pump_running: { label: 'Pump running (VFD run feedback)', kind: 'bool' },
    mixer_running: { label: 'Mixer running (contactor aux contact)', kind: 'bool' },
    heater_current: { label: 'Heater drawing current (current switch)', kind: 'bool' },
    overflow: { label: 'Tank overflowing (spill sensor)', kind: 'bool' },
  },
  faults: [['supplyLost', 'Inlet supply lost (valve opens, no flow)'], ['heaterBurned', 'Heater element burned out'], ['pumpCavitate', 'Pump worn (half flow)']],
  actions: [
    { id: 'slug', label: 'Disturbance: dump 10 L of 5 °C water in', kind: 'button' },
    { id: 'reset', label: 'Reset plant (refill to 25 %, 20 °C, repair heater)', kind: 'button' },
  ],

  create() { return { level: 25, temp: 20, tMeas: 20, hp: 0, valve: 0, pumpSpd: 0, ang: 0, ph: 0, dry: 0, overflow: false, qin: 0, qout: 0, faults: {}, msgs: [] }; },

  sig(s, k) {
    switch (k) {
      case 'level': return s.level;
      case 'volume': return s.level * CAP / 100;
      case 'temp': return s.tMeas;
      case 'temp_fast': return s.temp;
      case 'heater_power': return s.hp;
      case 'inflow': return s.qin * CAP / 100 * 60;
      case 'outflow': return s.qout * CAP / 100 * 60;
      case 'valve_pos': return s.valve * 100;
      case 'pump_speed': return s.pumpSpd;
      case 'valve_open': return s.valve > 0.97;
      case 'valve_closed': return s.valve < 0.03;
      case 'pump_running': return s.pumpSpd > 1;
      case 'mixer_running': return !!s.mixOn;
      case 'heater_current': return !!s.heating;
      case 'overflow': return s.overflow;
    }
    return 0;
  },

  doAction(s, id) {
    if (id === 'reset') { Object.assign(s, { level: 25, temp: 20, tMeas: 20, hp: 0, dry: 0, overflow: false }); s.faults.heaterBurned = false; }
    if (id === 'slug') { const add = Math.min(5, 100 - s.level); s.temp = (s.temp * s.level + 5 * add) / Math.max(s.level + add, 1); s.level += add; }
  },

  step(s, o, dt) {
    const f = s.faults;
    s.valve = ramp(s.valve, o.Q_InletValve ? 1 : 0, 1 / 1.5, dt);
    s.pumpSpd = ramp(s.pumpSpd, o.Q_OutletPump ? clamp(o.AO_PumpSpeed, 0, 100) : 0, 50, dt);
    s.mixOn = !!o.Q_Mixer;
    s.qin = f.supplyLost ? 0 : 6 * s.valve;                 // %/s
    s.qout = s.level > 0 ? 5 * s.pumpSpd / 100 * (f.pumpCavitate ? 0.5 : 1) : 0;
    const prev = s.level;
    s.level += (s.qin - s.qout) * dt;
    if (s.level >= 100) { s.level = 100; s.overflow = s.qin > s.qout; } else s.overflow = false;
    if (s.level < 0) s.level = 0;
    if (s.qin > 0) s.temp += (12 - s.temp) * s.qin * dt / Math.max(prev, 5);
    s.heating = o.Q_Heater && !f.heaterBurned && o.AO_HeaterPower > 0.5;
    s.hp = approach(s.hp, s.heating ? clamp(o.AO_HeaterPower, 0, 100) : 0, 1 / 4, dt);   // element thermal lag
    if (s.hp > 0.5) {
      if (s.level > 10) { s.temp += 120 / Math.max(s.level, 20) * (s.mixOn ? 1 : 0.5) * s.hp / 100 * dt; s.dry = 0; }
      else { s.dry += dt; if (s.dry > 3) { f.heaterBurned = true; s.burnMsg = true; } }
    } else s.dry = 0;
    s.temp += (20 - s.temp) * 0.01 * dt;
    s.temp = Math.min(s.temp, 100);
    s.tMeas = approach(s.tMeas, s.temp, 1 / 3, dt);                                         // thermowell lag
    if (s.mixOn) s.ang = (s.ang + 540 * dt) % 360;
    s.ph = (s.ph + dt * 40) % 1000;
    const m = [];
    if (s.overflow) m.push('Tank T-101 is overflowing!');
    if (f.heaterBurned) m.push('Heater H-101 burned out' + (s.burnMsg ? ' — it was energised with level below 10 % (dry fire). Use Reset plant to repair.' : '.'));
    if (o.Q_Heater && !f.heaterBurned && s.level <= 10) m.push('Heater energised in an empty tank — element overheating!');
    if (o.Q_OutletPump && s.level <= 0.5) m.push('Pump P-101 is running dry.');
    s.msgs = m;
  },

  view(s) {
    return { level: s.level, temp: s.temp, valve: s.valve, pumpSpd: s.pumpSpd, mix: s.mixOn, ang: s.ang, ph: s.ph,
      heating: s.heating, hp: s.hp, tMeas: s.tMeas, burned: !!s.faults.heaterBurned, overflow: s.overflow, qin: s.qin, qout: s.qout, faults: s.faults, msgs: s.msgs };
  },

  defaults() {
    return {
      src: SRC,
      sensors: [
        ...panelSensors(),
        sw('I_LSH', 'level', '>=', 90, { desc: 'Level switch high LSH-101 (TRUE at ≥ 90 %)' }),
        sw('I_LSL', 'level', '>=', 10, { desc: 'Level switch low LSL-101 (TRUE at ≥ 10 %)' }),
        analog('AI_Level', 'level', 0, 100, { desc: 'Level transmitter LT-101, 0–100 %' }),
        analog('AI_Temp', 'temp', 0, 100, { desc: 'Temperature transmitter TT-101, 0–100 °C' }),
      ],
      hmi: [
        W('label', 20, 10, 560, 40, { label: 'TANK T-101 — BATCH HEATING', size: 22 }),
        W('bar', 20, 60, 90, 350, { tag: 'AI_Level', label: 'LT-101', min: 0, max: 100, unit: '%', vert: true, color: 'blue' }),
        W('valve', 120, 60, 120, 100, { tag: 'Q_InletValve', label: 'XV-101 Inlet' }),
        W('motor', 120, 170, 120, 110, { tag: 'Q_Mixer', label: 'M-101 Mixer' }),
        W('motor', 120, 290, 120, 120, { tag: 'Q_OutletPump', label: 'P-101 Pump' }),
        W('value', 250, 60, 160, 64, { tag: 'AI_Temp', label: 'TT-101 Temp', unit: '°C', dec: 1 }),
        W('setpoint', 250, 132, 160, 64, { tag: 'TempSP', label: 'Temp setpoint', unit: '°C', dec: 1 }),
        W('setpoint', 250, 204, 160, 64, { tag: 'DrainSpeed', label: 'Pump speed', unit: '%', dec: 0 }),
        W('bar', 250, 276, 160, 60, { tag: 'AO_HeaterPower', label: 'Heater power', min: 0, max: 100, unit: '%', color: 'amber' }),
        W('value', 250, 344, 76, 66, { tag: 'Step', label: 'Step', dec: 0 }),
        W('value', 334, 344, 76, 66, { tag: 'BatchCount', label: 'Batches', dec: 0 }),
        W('pid', 420, 60, 200, 350, { tag: 'TempPID', label: 'TIC-101 TempPID', min: 0, max: 100, unit: '°C' }),
        W('button', 630, 60, 150, 64, { tag: 'HMI_Start', label: 'START', color: 'green' }),
        W('button', 630, 132, 150, 64, { tag: 'HMI_Stop', label: 'STOP', color: 'red' }),
        W('button', 630, 204, 150, 64, { tag: 'HMI_Reset', label: 'RESET', color: 'blue' }),
        W('lamp', 630, 290, 150, 50, { tag: 'Running', label: 'Running', color: 'green' }),
        W('lamp', 630, 350, 150, 50, { tag: 'Fault', label: 'Fault', color: 'red' }),
        W('alarms', 20, 425, 760, 45, {}),
      ],
      alarms: [
        A('AI_Level', '>', 97, 'LT-101 tank level high-high', 'High'),
        A('AI_Temp', '>', 70, 'TT-101 temperature high', 'High'),
        A('I_EStop', 'FALSE', '', 'Emergency stop pressed', 'High'),
        A('Fault', 'TRUE', '', 'System fault — reset required', 'Medium'),
      ],
      pens: [{ tag: 'AI_Temp', min: 0, max: 100 }, { tag: 'TempSP', min: 0, max: 100 }, { tag: 'AO_HeaterPower', min: 0, max: 100 }, { tag: 'AI_Level', min: 0, max: 100 }],
    };
  },
};
