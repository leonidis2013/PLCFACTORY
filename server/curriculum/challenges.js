'use strict';
/* Troubleshooting challenges: a working plant with a planted fault, a work order, root-cause selection, scoring. */

const sensor = (p, tag) => p.sensors.find(s => s.tag.toUpperCase() === tag.toUpperCase());
function patchSrc(p, from, to) {
  for (const u of p.pous) if (u.src && u.src.includes(from)) { u.src = u.src.replace(from, to); return; }
  throw new Error('challenge patch not applied: ' + from);
}
const fail = (c, m) => (c ? true : m);
const start = h => { h.write('HMI_Start', true).run(0.3); h.write('HMI_Start', false).run(0.2); return h; };

const CAUSES = {
  conveyor: [
    ['stop_contact', 'Stop pushbutton input configured with the wrong contact type (NO vs NC)'],
    ['estop', 'E-stop circuit open'],
    ['height_sensor', 'Height sensor HT-2 failed'],
    ['pe_sort', 'Sort photoeye PE-2 failed'],
    ['sensor_position', 'Sort sensors mounted in the wrong position'],
    ['air', 'Pusher air supply lost'],
    ['code', 'PLC program logic error'],
  ],
  tank: [
    ['lsh_failed', 'High level switch LSH-101 failed'],
    ['lsl_failed', 'Low level switch LSL-101 failed'],
    ['valve_solenoid', 'Inlet valve XV-101 solenoid / actuator failed'],
    ['code_heater', 'PLC program: heater interlock written wrong'],
    ['tuning', 'Temperature loop badly tuned'],
    ['scaling', 'Temperature transmitter signal configured with the wrong format'],
    ['heater_burnt', 'Heater element burned out'],
    ['pump', 'Outlet pump failed'],
  ],
  vialfiller: [
    ['preact', 'Fill pre-act (early stop) setting wrong'],
    ['tubing', 'Pump tubing worn'],
    ['loadcell', 'Load cell failed'],
    ['sterility', 'Isolator not sterile'],
    ['stoppers', 'Stopper hopper empty'],
  ],
  bioreactor: [
    ['vacuum', 'Vessel pulled a vacuum during cool-down (no air / vent)'],
    ['steam', 'Steam supply too short — SIP never reached 121 °C'],
    ['inoculum', 'Contaminated inoculum'],
    ['foam', 'Foam-out wetted the exhaust filter'],
    ['ph', 'pH control dosing the wrong pump'],
  ],
};

const CHALLENGES = [
  {
    id: 'C01', plant: 'conveyor', title: "Line won't start after maintenance", difficulty: 'Easy', par: 240,
    ticket: '<p><b>Work order 4471 · Conveyor C-1</b></p><p>"Electrician replaced the local STOP pushbutton this morning. Since then the line won\'t start — not from the panel and not from the HMI. No alarms except the usual. Please get us running."</p>',
    cause: 'stop_contact',
    setup(p) { sensor(p, 'I_Stop').contact = 'NO'; },
    hints: ['Watch I_Stop in the Tags tab while nobody touches anything. What should a healthy stop circuit read?', 'A stop button is wired NC, so I_Stop must be TRUE when it is NOT pressed. Check its contact type in the I/O tab.'],
    objectives: [
      { id: 'start', text: 'The line starts from the HMI', test: h => { start(h).run(1); return fail(h.out('Q_Conveyor'), 'Conveyor still does not start'); } },
      { id: 'stop', text: 'The local STOP button still stops it', test: h => { start(h).run(1); h.panel('pb_stop', true).run(0.4); h.panel('pb_stop', false).run(0.2); return fail(!h.out('Q_Conveyor'), 'STOP no longer stops the line — that is dangerous'); } },
    ],
  },
  {
    id: 'C02', plant: 'conveyor', title: 'Tall boxes ending up in bin A', difficulty: 'Easy', par: 300,
    ticket: '<p><b>Work order 4502 · Conveyor C-1</b></p><p>"Shipping says tall boxes are arriving in bin A with the short ones. The pusher never seems to fire. Started some time last shift."</p>',
    cause: 'height_sensor', hidden: { sensors: { I_TALL: 'stuck_off' } },
    hints: ['Trend I_PE_Sort, I_Tall and Q_Divert while a tall box passes.', 'I_PE_Sort sees the box but I_Tall never turns on, even for tall boxes. Replace the height sensor.'],
    objectives: [{ id: 'sort', text: 'Tall boxes go to bin B, none to bin A', test: h => { start(h).run(90); const c = h.plant().cnt; return fail(c.bT >= 4 && c.aT === 0, `bin B tall ${c.bT}, bin A tall ${c.aT}`); } }],
  },
  {
    id: 'C03', plant: 'conveyor', title: 'Pusher keeps jamming', difficulty: 'Medium', par: 420,
    ticket: '<p><b>Work order 4519 · Conveyor C-1</b></p><p>"After the belt was replaced the pusher crushes the corner of tall boxes and jams. Mechanics say the pusher itself is fine. Short boxes are OK."</p>',
    cause: 'sensor_position',
    setup(p) { sensor(p, 'I_PE_Sort').pos = 1950; sensor(p, 'I_Tall').pos = 1900; },
    hints: ['Watch where the box stops relative to the pusher plate in the 2D view.', 'The sort photoeye and height sensor were remounted upstream. Check their positions in the I/O tab against the pusher at 2000 mm.'],
    objectives: [{ id: 'nojam', text: 'No jams, tall boxes in bin B', test: h => { start(h); const ok = h.always(() => h.plant().cnt.jam === 0, 90); const c = h.plant().cnt; return fail(ok && c.bT >= 4, ok ? `only ${c.bT} tall boxes sorted` : 'A box jammed'); } }],
  },
  {
    id: 'C04', plant: 'tank', title: 'Tank overflowed overnight', difficulty: 'Easy', par: 300,
    ticket: '<p><b>Incident 1187 · Tank T-101</b></p><p>"Night shift found water all over the floor. The tank kept filling and never moved on to heating. Cleaned up and reset — please find the cause before we run again."</p>',
    cause: 'lsh_failed', hidden: { sensors: { I_LSH: 'stuck_off' } },
    hints: ['Which input ends the fill step? Watch it while the level passes 90 %.', 'AI_Level reads > 90 % but I_LSH stays FALSE. Replace LSH-101.'],
    objectives: [{ id: 'fill', text: 'Fill stops at the high switch and heating starts — no overflow', test: h => { start(h); const ok = h.always(() => !h.plant().overflow, 60); return fail(ok && h.tag('Step') >= 20, ok ? 'Never moved to heating' : 'Tank overflowed'); } }],
  },
  {
    id: 'C05', plant: 'tank', title: 'Batch stuck in fill', difficulty: 'Easy', par: 300,
    ticket: '<p><b>Work order 4533 · Tank T-101</b></p><p>"Operator pressed START, the HMI shows step 10 (fill) and the valve symbol is green, but the level hasn\'t moved in 10 minutes."</p>',
    cause: 'valve_solenoid', hidden: { acts: { Q_InletValve: 'stuck_off' } },
    hints: ['The PLC output Q_InletValve is TRUE. Is the valve actually moving? Add a position-feedback sensor, or check the plant view.', 'The command is there but the valve doesn\'t open: the solenoid/actuator has failed. Repair Q_InletValve.'],
    objectives: [{ id: 'fill', text: 'Tank fills and the batch reaches heating', test: h => { start(h); return fail(h.until(() => h.tag('Step') >= 20, 60) >= 0, 'Still stuck in fill'); } }],
  },
  {
    id: 'C06', plant: 'tank', title: 'Heater never comes on', difficulty: 'Medium', par: 420,
    ticket: '<p><b>Work order 4540 · Tank T-101</b></p><p>"Since the programmer\'s \'small change\' yesterday, batches fill fine but sit in step 20 forever. Heater power stays at zero. The heater checks OK with a meter."</p>',
    cause: 'code_heater',
    setup(p) { patchSrc(p, 'Q_Heater     := Step = 20 AND I_LSL;', 'Q_Heater     := Step = 20 AND NOT I_LSL;'); },
    hints: ['Compare the heater contactor output with the conditions in the program.', 'Look at the line that writes Q_Heater. Should the heater run when the low level switch is made, or when it isn\'t?'],
    objectives: [{ id: 'batch', text: 'A full batch completes', test: h => { start(h); return fail(h.until(() => h.tag('BatchCount') >= 1, 150) >= 0, 'No batch completed'); } }],
  },
  {
    id: 'C07', plant: 'tank', title: 'Temperature swings', difficulty: 'Hard', par: 600,
    ticket: '<p><b>Work order 4561 · Tank T-101</b></p><p>"Temperature overshoots and swings up and down during the hold, and the batch never finishes. A contractor \'optimised\' the controller."</p>',
    cause: 'tuning',
    setup(p) { patchSrc(p, 'TempPID     : PID := (KP := 8.0, TN := 60.0, TV := 0.0);', 'TempPID     : PID := (KP := 40.0, TN := 1.5, TV := 0.0);'); },
    hints: ['Trend AI_Temp, TempSP and TempPID.Y. What does the output look like?', 'Very high gain plus a very short integral time makes the loop oscillate. Try KP ≈ 8, TN ≈ 60 — tune live on the PID faceplate, then fix the initial values and do a Cold download.'],
    objectives: [{ id: 'batch', text: 'Batch completes (temperature holds within ±1 °C for 10 s)', test: h => { start(h); return fail(h.until(() => h.tag('BatchCount') >= 1, 160) >= 0, 'No batch completed'); } }],
  },
  {
    id: 'C08', plant: 'tank', title: 'HMI shows 5000 °C', difficulty: 'Medium', par: 360,
    ticket: '<p><b>Work order 4577 · Tank T-101</b></p><p>"New temperature transmitter card fitted. HMI now shows thousands of degrees and the heater won\'t run. The transmitter itself was calibrated on the bench and is fine."</p>',
    cause: 'scaling',
    setup(p) { sensor(p, 'AI_Temp').scale = 'raw'; },
    hints: ['Look at AI_Temp in Tags. Is that a temperature?', 'The I/O tab shows AI_Temp is configured to deliver raw counts (0–27648). The program expects engineering units.'],
    objectives: [{ id: 'temp', text: 'AI_Temp reads a sensible temperature and a batch completes', test: h => { start(h); if (h.until(() => h.tag('BatchCount') >= 1, 150) < 0) return 'No batch completed'; return fail(h.tag('AI_Temp') < 100, 'AI_Temp still not in °C'); } }],
  },
  {
    id: 'C09', plant: 'vialfiller', title: 'Every vial rejected', difficulty: 'Medium', par: 480,
    ticket: '<p><b>Deviation DV-2207 · Filling line ISO-1</b></p><p>"Line runs, environment is green, but every vial goes to reject. QA weighed some: all around 1.7 g against a 2.0 g target. Pump tubing was replaced last week."</p>',
    cause: 'preact',
    setup(p) { patchSrc(p, 'Preact     : REAL := 0.03;', 'Preact     : REAL := 0.30;'); },
    hints: ['Trend AI_FillWeight. Where does the pump stop relative to FillSP?', 'The pump stops at FillSP − Preact. Preact is 10× too big.'],
    objectives: [{ id: 'good', text: 'Good vials are accepted (≥ 5) with none rejected for weight', test: h => {
      h.write('HMI_Decon', true).run(0.3); h.write('HMI_Decon', false);
      if (h.until(() => h.tag('Sterile'), 200) < 0) return 'Decon did not finish';
      start(h).run(120); const c = h.plant().cnt; return fail(c.good >= 5 && c.rejGood === 0 && c.rejBad === 0, `good ${c.good}, rejected ${c.rejGood + c.rejBad}`); } }],
  },
  {
    id: 'C10', plant: 'bioreactor', title: 'Every batch contaminated', difficulty: 'Hard', par: 720,
    ticket: '<p><b>Deviation DV-2231 · Bioreactor BR-01</b></p><p>"Three batches in a row contaminated. SIP charts show 121 °C held for the full time. The recipe was \'streamlined\' to save compressed air."</p>',
    cause: 'vacuum',
    setup(p) { patchSrc(p, '  AirOut  := 100.0;              (* keep positive pressure while steam condenses *)', '  AirOut  := 0.0;'); },
    hints: ['Trend AI_Pressure and AI_Temp through SIP and cool-down. Does anything look wrong after the hold?', 'As steam condenses the vessel goes below atmospheric pressure and sucks in unsterile air. Sparge air (or an open vent filter) must keep positive pressure during phases 40–50.'],
    objectives: [{ id: 'clean', text: 'A batch is harvested clean', test: h => { start(h); if (h.until(() => h.tag('Batches') >= 1, 700) < 0) return 'Batch did not complete'; return fail(!h.plant().wasContam, 'Batch was contaminated'); } }],
  },
];

module.exports = { CHALLENGES, CAUSES };
