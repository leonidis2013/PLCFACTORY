'use strict';
/* Cert-prep learning path. Each lesson: a purpose-built sandbox machine, I/O, starter + solution, hints, graded objectives. */

const C = (id, type, name, x, y, props = {}, rot = 0) => ({ id, type, name, x, y, rot, props });
const DI = (tag, signal, contact = 'NO', desc = '') => ({ id: 's_' + tag, tag, type: 'discrete', signal, contact, fault: 'none', desc });
const AI = (tag, signal, lo, hi, extra = {}) => Object.assign({ id: 's_' + tag, tag, type: 'analog', signal, lo, hi, scale: 'eng', noise: 0.1, fault: 'none' }, extra);
const PE = (tag, signal, pos, desc = '') => ({ id: 's_' + tag, tag, type: 'probe', signal, pos, contact: 'NO', fault: 'none', desc });
const ST = (src, extra = {}) => Object.assign({ types: '', globals: '', pous: [{ id: 'main', name: 'Main', lang: 'ST', src }] }, extra);
const fail = (cond, msg) => (cond ? true : msg);
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const IO_NOTE = io => `<table class="io"><tr><th>Tag</th><th>Meaning</th></tr>${io.map(([t, d]) => `<tr><td><code>${t}</code></td><td>${d}</td></tr>`).join('')}</table>`;

const LESSONS = [
  // ───────────────────────── 1 · Discrete logic ─────────────────────────
  {
    id: 'L01', unit: 'Discrete logic', title: 'Inputs, outputs and the scan', minutes: 5,
    summary: 'Make a pilot light follow a pushbutton.',
    theory: `<p>A PLC reads every <b>input</b> into memory, runs your program top to bottom, then writes every <b>output</b>. That's one <i>scan</i>, repeated every few milliseconds.</p>
      <p>A <b>normally open (NO)</b> pushbutton contact closes when pressed, so its input is TRUE while you hold it. In ST, an assignment copies a value: <code>Q_Light := I_Button;</code>. In ladder, the same thing is one rung with an NO contact and a coil.</p>`,
    task: `Make pilot light <b>PL1</b> light while pushbutton <b>PB1</b> is held, and go out when it's released.` +
      IO_NOTE([['I_PB1', 'PB1 pressed (NO contact)'], ['Q_PL1', 'PL1 pilot light']]),
    layout: { components: [C('pb1', 'pushbutton', 'PB1', -0.6, 0, { color: 'green' }), C('pl1', 'pilot', 'PL1', 0.6, 0, { color: 'green' })] },
    sensors: [DI('I_PB1', 'pb1.pressed', 'NO', 'PB1 pushbutton')],
    starter: ST('(* Lesson 1 — make PL1 follow PB1 *)\n\n'),
    solution: ST('(* Lesson 1 — solution *)\nQ_PL1 := I_PB1;\n'),
    hints: ['Outputs are written from your program every scan. What should Q_PL1 equal?', 'One line: Q_PL1 := I_PB1;'],
    objectives: [
      { id: 'on', text: 'PL1 lights while PB1 is held', test: h => { h.press('PB1').run(0.3); return fail(h.out('Q_PL1') === true, 'PL1 stayed off while PB1 was pressed'); } },
      { id: 'off', text: 'PL1 goes out when PB1 is released', test: h => { h.press('PB1').run(0.3); if (!h.out('Q_PL1')) return 'PL1 never lit'; h.release('PB1').run(0.3); return fail(h.out('Q_PL1') === false, 'PL1 stayed on after release'); } },
    ],
  },
  {
    id: 'L02', unit: 'Discrete logic', title: 'NC contacts and fail-safe wiring', minutes: 8,
    summary: 'Use a normally-closed stop button the safe way.',
    theory: `<p>Stop buttons and E-stops are wired <b>normally closed (NC)</b>. With nothing pressed, current flows and the input is <b>TRUE</b>. Pressing the button <i>opens</i> the circuit, and so does a broken wire, a loose terminal or a blown fuse. Either way the input goes <b>FALSE</b>.</p>
      <p>That's why stop logic is written as "allowed to run while the stop input is TRUE". A broken wire then stops the machine instead of silently disabling the stop button.</p>`,
    task: `Light <b>Ready</b> while the stop circuit is healthy. It must go out when <b>Stop</b> is pressed <i>and</i> when the Stop wire breaks.` +
      IO_NOTE([['I_Stop', 'Stop button, NC contact: TRUE = healthy, not pressed'], ['Q_Ready', 'Ready pilot light']]),
    layout: { components: [C('pb', 'pushbutton', 'Stop', -0.6, 0, { color: 'red' }), C('pl', 'pilot', 'Ready', 0.6, 0, { color: 'white' })] },
    sensors: [DI('I_Stop', 'pb.pressed', 'NC', 'Stop pushbutton (NC)')],
    starter: ST('(* Lesson 2 — Ready light from an NC stop button *)\n\n'),
    solution: ST('Q_Ready := I_Stop;   (* NC: TRUE while healthy *)\n'),
    hints: ['Watch I_Stop in the Tags tab while you press Stop. What value does it have when nothing is pressed?', 'Q_Ready := I_Stop; — no NOT needed, the NC wiring already does the inverting.'],
    objectives: [
      { id: 'idle', text: 'Ready is ON while nothing is pressed', test: h => { h.run(0.3); return fail(h.out('Q_Ready') === true, 'Ready is off with the stop circuit healthy'); } },
      { id: 'press', text: 'Ready goes OFF while Stop is pressed', test: h => { h.run(0.2); h.press('Stop').run(0.3); return fail(h.out('Q_Ready') === false, 'Ready stayed on with Stop pressed'); } },
      { id: 'wire', text: 'Ready goes OFF if the Stop wire breaks', test: h => { h.run(0.2); h.sensorFault('I_Stop', 'wire_break'); h.run(0.3); return fail(h.out('Q_Ready') === false, 'A broken stop wire left Ready on — that is not fail-safe'); } },
    ],
  },
  {
    id: 'L03', unit: 'Discrete logic', title: '3-wire start/stop (seal-in)', minutes: 12,
    summary: 'The most important rung in industry: a latching motor starter.',
    theory: `<p>A momentary Start button must keep a motor running after it's released. The motor's own run bit is fed back in parallel with Start. That's the <b>seal-in</b> (holding) contact:</p>
      <pre>Run := (I_Start OR Run) AND I_Stop;</pre>
      <p>In ladder: Start and a <i>Run</i> contact in parallel, then the NC Stop in series, driving the Run coil. Stop is in series after the parallel branch, so <b>Stop always wins</b>.</p>
      <p>The output turns on the contactor, but that doesn't prove the motor runs. An overload relay can trip. Use the starter's <b>auxiliary contact</b> (running feedback) for status lights.</p>`,
    task: `Start <b>M1</b> with <b>Start</b>; it must keep running after release. <b>Stop</b> stops it and wins if both are pressed. A broken Stop wire must stop it. <b>RunLamp</b> shows the motor is <i>really</i> running (aux contact), not just commanded.` +
      IO_NOTE([['I_Start', 'Start (NO)'], ['I_Stop', 'Stop (NC)'], ['I_M1_Running', 'M1 auxiliary contact: TRUE when actually running'], ['Q_M1_Run', 'M1 contactor'], ['Q_RunLamp', 'Run pilot light']]),
    layout: { components: [C('st', 'pushbutton', 'Start', -1.2, -1, { color: 'green' }), C('sp', 'pushbutton', 'Stop', -0.6, -1, { color: 'red' }),
      C('pl', 'pilot', 'RunLamp', 0, -1, { color: 'green' }), C('m1', 'motor', 'M1', 1, 0.6, { amps: 12 })] },
    sensors: [DI('I_Start', 'st.pressed'), DI('I_Stop', 'sp.pressed', 'NC'), DI('I_M1_Running', 'm1.running')],
    starter: ST('(* Lesson 3 — 3-wire start/stop *)\nVAR\n  Run : BOOL;\nEND_VAR\n\n'),
    solution: { types: '', globals: 'VAR_GLOBAL\n  Run : BOOL;\nEND_VAR\n', pous: [{ id: 'main', name: 'Main', lang: 'LD', rungs: [
      { comment: 'Seal-in: Start OR Run, then the NC stop in series', rows: [[{ t: 'NO', a: 'I_Start' }, { t: 'NO', a: 'I_Stop' }], [{ t: 'NO', a: 'Run' }, { t: 'NO', a: 'I_Stop' }]], outs: [{ t: 'COIL', a: 'Run' }] },
      { comment: '', rows: [[{ t: 'NO', a: 'Run' }]], outs: [{ t: 'COIL', a: 'Q_M1_Run' }] },
      { comment: 'Status from the aux contact, not from the command', rows: [[{ t: 'NO', a: 'I_M1_Running' }]], outs: [{ t: 'COIL', a: 'Q_RunLamp' }] },
    ] }] },
    hints: ['Run := (I_Start OR Run) AND I_Stop;', 'For the lamp, use I_M1_Running — try the "jammed" fault on M1 in the plant panel to see why.'],
    objectives: [
      { id: 'seal', text: 'Start starts M1 and it keeps running after release', test: h => { h.tap('Start').run(1); return fail(h.out('Q_M1_Run') === true, 'M1 is not running after Start was released'); } },
      { id: 'stop', text: 'Stop stops M1 and it stays stopped', test: h => { h.tap('Start').run(0.5); h.tap('Stop').run(1); return fail(h.out('Q_M1_Run') === false, 'M1 kept running after Stop'); } },
      { id: 'wins', text: 'Stop wins when both buttons are pressed', test: h => { h.press('Start').press('Stop').run(0.5); return fail(h.out('Q_M1_Run') === false, 'M1 ran with Stop held'); } },
      { id: 'wire', text: 'A broken Stop wire stops M1', test: h => { h.tap('Start').run(0.5); h.sensorFault('I_Stop', 'wire_break'); h.run(0.3); return fail(h.out('Q_M1_Run') === false, 'M1 kept running with the Stop wire broken'); } },
      { id: 'aux', text: 'RunLamp shows real running — it goes out when the overload trips', test: h => {
        h.tap('Start').run(2); if (!h.out('Q_RunLamp')) return 'RunLamp is off while M1 runs';
        h.fault('m1.jam'); h.run(5); if (!h.sig('m1.ol')) return 'Test setup: overload did not trip';
        return fail(h.out('Q_RunLamp') === false, 'RunLamp stayed on although the overload tripped (use the aux contact)'); } },
    ],
  },
  {
    id: 'L04', unit: 'Discrete logic', title: 'Interlocks: forward/reverse motor', minutes: 12,
    summary: 'Never energise both contactors of a reversing starter.',
    theory: `<p>A reversing starter swaps two phases with a second contactor. If <b>FWD and REV</b> close together, the result is a phase-to-phase short. Real panels use a mechanical interlock, auxiliary-contact interlocks <i>and</i> PLC interlocks.</p>
      <p>Each direction gets its own seal-in, plus "<code>AND NOT</code> the other direction" so it can't start while the other is running. The operator must stop before reversing.</p>`,
    task: `<b>Fwd</b> runs <b>M1</b> forward and <b>Rev</b> runs it in reverse; each seals in. Pressing the other direction while running does nothing: press <b>Stop</b> first. Q_M1_Fwd and Q_M1_Rev must <b>never</b> be on in the same scan, even if both buttons are pressed together.` +
      IO_NOTE([['I_Fwd', 'Forward (NO)'], ['I_Rev', 'Reverse (NO)'], ['I_Stop', 'Stop (NC)'], ['Q_M1_Fwd', 'Forward contactor'], ['Q_M1_Rev', 'Reverse contactor']]),
    layout: { components: [C('f', 'pushbutton', 'Fwd', -1.4, -1, { color: 'green' }), C('r', 'pushbutton', 'Rev', -0.8, -1, { color: 'blue' }), C('s', 'pushbutton', 'Stop', -0.2, -1, { color: 'red' }),
      C('m1', 'motor', 'M1', 1, 0.6, { reversible: true })] },
    sensors: [DI('I_Fwd', 'f.pressed'), DI('I_Rev', 'r.pressed'), DI('I_Stop', 's.pressed', 'NC')],
    starter: ST('(* Lesson 4 — forward/reverse with interlocks *)\nVAR\n  Fwd, Rev : BOOL;\nEND_VAR\n\n'),
    solution: ST('VAR\n  Fwd, Rev : BOOL;\nEND_VAR\nFwd := (I_Fwd OR Fwd) AND I_Stop AND NOT Rev;\nRev := (I_Rev OR Rev) AND I_Stop AND NOT Fwd;\nQ_M1_Fwd := Fwd;\nQ_M1_Rev := Rev;\n'),
    hints: ['Two seal-in circuits, one per direction.', 'Add AND NOT Rev to the forward line and AND NOT Fwd to the reverse line.'],
    objectives: [
      { id: 'fwd', text: 'Fwd runs M1 forward (and seals in)', test: h => { h.tap('Fwd').run(2); return fail(h.out('Q_M1_Fwd') && !h.out('Q_M1_Rev') && h.sig('m1.speed') > 50, 'M1 is not running forward'); } },
      { id: 'rev', text: 'Rev runs M1 in reverse', test: h => { h.tap('Rev').run(2); return fail(h.out('Q_M1_Rev') && !h.out('Q_M1_Fwd') && h.sig('m1.speed') < -50, 'M1 is not running in reverse'); } },
      { id: 'lock', text: 'Pressing Rev while running forward is ignored', test: h => { h.tap('Fwd').run(1); h.tap('Rev').run(1); return fail(h.out('Q_M1_Fwd') && !h.out('Q_M1_Rev'), 'Direction changed (or stopped) without pressing Stop'); } },
      { id: 'stoprev', text: 'Stop, then Rev, reverses the motor', test: h => { h.tap('Fwd').run(1); h.tap('Stop').run(1); h.tap('Rev').run(2); return fail(h.out('Q_M1_Rev') && !h.out('Q_M1_Fwd'), 'Could not reverse after stopping'); } },
      { id: 'never', text: 'FWD and REV are never on together (even both buttons at once)', test: h => {
        const ok = () => !(h.out('Q_M1_Fwd') && h.out('Q_M1_Rev'));
        h.press('Fwd').press('Rev'); if (!h.always(ok, 1)) return 'Both contactors were energised — short circuit!';
        h.release('Fwd').release('Rev'); if (!h.always(ok, 1)) return 'Both contactors were energised';
        h.tap('Rev'); if (!h.always(ok, 1)) return 'Both contactors were energised';
        return fail(!h.sig('m1.ol'), 'The motor tripped (short circuit)'); } },
    ],
  },
  // ───────────────────────── 2 · Timers, counters, edges ─────────────────────────
  {
    id: 'L05', unit: 'Timers, counters & edges', title: 'TON: warning horn before start', minutes: 12,
    summary: 'Sound a horn for 3 s before a conveyor moves.',
    theory: `<p>An <b>on-delay timer (TON)</b> turns its output <code>Q</code> on after its input <code>IN</code> has been TRUE for the preset time <code>PT</code>. If <code>IN</code> goes FALSE, it resets.</p>
      <pre>Warn(IN := StartReq, PT := T#3s);
Q_Conveyor := Warn.Q;</pre>
      <p>Call the timer <b>every scan</b> (not inside an IF), or it stops counting. Pre-start warnings are required by safety standards on equipment that can start automatically.</p>`,
    task: `Press <b>Start</b>: the <b>horn</b> and <b>amber</b> light come on for 3 s, then conveyor <b>C1</b> starts with the <b>green</b> light and the horn stops. <b>Stop</b> stops everything at any time, including during the warning.` +
      IO_NOTE([['I_Start', 'Start (NO)'], ['I_Stop', 'Stop (NC)'], ['Q_C1_Run', 'Conveyor drive'], ['Q_SL_Horn / Q_SL_Amber / Q_SL_Green', 'Stack light']]),
    layout: { components: [C('st', 'pushbutton', 'Start', -1.6, -1.2, { color: 'green' }), C('sp', 'pushbutton', 'Stop', -1.0, -1.2, { color: 'red' }),
      C('sl', 'stacklight', 'SL', -0.2, -1.2), C('c1', 'conveyor', 'C1', -1.5, 0.5, { length: 3, speed: 0.3, interval: 3 })] },
    sensors: [DI('I_Start', 'st.pressed'), DI('I_Stop', 'sp.pressed', 'NC')],
    starter: ST('(* Lesson 5 — pre-start warning *)\nVAR\n  StartReq : BOOL;\n  Warn     : TON;\nEND_VAR\n\n'),
    solution: ST(`VAR
  StartReq : BOOL;
  Warn     : TON;
END_VAR
StartReq := (I_Start OR StartReq) AND I_Stop;
Warn(IN := StartReq, PT := T#3s);
Q_SL_Horn  := StartReq AND NOT Warn.Q;
Q_SL_Amber := Q_SL_Horn;
Q_C1_Run   := Warn.Q;
Q_SL_Green := Warn.Q;
`),
    hints: ['A seal-in "StartReq" from Start/Stop, then Warn(IN := StartReq, PT := T#3s);', 'Horn := StartReq AND NOT Warn.Q;   Conveyor := Warn.Q;'],
    objectives: [
      { id: 'horn', text: 'Horn and amber come on right after Start', test: h => { h.tap('Start'); return fail(h.out('Q_SL_Horn') && h.out('Q_SL_Amber'), 'No horn/amber after Start'); } },
      { id: 'delay', text: 'C1 starts 3 s (±0.3 s) after Start — not before', test: h => { h.press('Start'); const t = h.until(() => h.out('Q_C1_Run'), 6); h.release('Start'); if (t < 0) return 'C1 never started'; return fail(near(t, 3, 0.3), `C1 started after ${t.toFixed(2)} s`); } },
      { id: 'run', text: 'Once running: horn off, green on', test: h => { h.tap('Start').run(4); return fail(h.out('Q_C1_Run') && !h.out('Q_SL_Horn') && h.out('Q_SL_Green'), 'Expected C1 running, horn off, green on'); } },
      { id: 'abort', text: 'Stop during the warning cancels the start', test: h => { h.tap('Start').run(1); h.tap('Stop').run(3); return fail(!h.out('Q_C1_Run') && !h.out('Q_SL_Horn'), 'C1 started or the horn kept sounding after Stop'); } },
      { id: 'stop', text: 'Stop stops a running conveyor', test: h => { h.tap('Start').run(4); h.tap('Stop').run(0.5); return fail(!h.out('Q_C1_Run'), 'C1 kept running'); } },
    ],
  },
  {
    id: 'L06', unit: 'Timers, counters & edges', title: 'TOF: fan run-on', minutes: 8,
    summary: 'Keep a cooling fan running after a heater switches off.',
    theory: `<p>An <b>off-delay timer (TOF)</b> turns <code>Q</code> on immediately when <code>IN</code> goes TRUE. When <code>IN</code> goes FALSE, it keeps <code>Q</code> on for <code>PT</code>, then switches it off. That's the classic "run-on" for fans, lubrication pumps and conveyors clearing product.</p>`,
    task: `When selector <b>Heat</b> is ON, the <b>HeaterLamp</b> and fan <b>Fan</b> run. When Heat is switched OFF, the lamp goes out immediately but the fan keeps running for <b>10 s</b>. If Heat comes back on during the run-on, the fan must not stop.` +
      IO_NOTE([['I_Heat_P1', 'Selector in ON position'], ['Q_HeaterLamp', 'Heater indication'], ['Q_Fan_Run', 'Fan motor']]),
    layout: { components: [C('sw', 'selector', 'Heat', -0.8, -1, { positions: '2', labels: 'OFF,ON' }), C('pl', 'pilot', 'HeaterLamp', 0, -1, { color: 'amber' }), C('fan', 'motor', 'Fan', 1, 0.6, { amps: 3 })] },
    sensors: [DI('I_Heat_P1', 'sw.p1')],
    starter: ST('(* Lesson 6 — fan run-on *)\nVAR\n  RunOn : TOF;\nEND_VAR\n\n'),
    solution: ST('VAR\n  RunOn : TOF;\nEND_VAR\nQ_HeaterLamp := I_Heat_P1;\nRunOn(IN := I_Heat_P1, PT := T#10s);\nQ_Fan_Run := RunOn.Q;\n'),
    hints: ['RunOn(IN := I_Heat_P1, PT := T#10s);', 'Q_Fan_Run := RunOn.Q;'],
    objectives: [
      { id: 'on', text: 'Heater lamp and fan on with Heat ON', test: h => { h.select('Heat', 1).run(0.5); return fail(h.out('Q_HeaterLamp') && h.out('Q_Fan_Run'), 'Lamp and fan should both be on'); } },
      { id: 'runon', text: 'Fan keeps running ~10 s after Heat OFF, lamp off immediately', test: h => {
        h.select('Heat', 1).run(2); h.select('Heat', 0).run(0.3); if (h.out('Q_HeaterLamp')) return 'Heater lamp stayed on';
        if (!h.out('Q_Fan_Run')) return 'Fan stopped immediately';
        const t = h.until(() => !h.out('Q_Fan_Run'), 15); return fail(t > 0 && near(t + 0.3, 10, 0.5), t < 0 ? 'Fan never stopped' : `Fan stopped after ${(t + 0.3).toFixed(1)} s`); } },
      { id: 'retrig', text: 'Heat back ON during run-on keeps the fan running', test: h => { h.select('Heat', 1).run(1); h.select('Heat', 0).run(5); h.select('Heat', 1); return fail(h.always(() => h.out('Q_Fan_Run'), 12), 'The fan stopped while Heat was ON'); } },
    ],
  },
  {
    id: 'L07', unit: 'Timers, counters & edges', title: 'CTU: count a batch', minutes: 12,
    summary: 'Count parts and stop after a batch of 5.',
    theory: `<p>An <b>up counter (CTU)</b> adds 1 to <code>CV</code> on each <b>rising edge</b> of <code>CU</code>, and sets <code>Q</code> when <code>CV ≥ PV</code>. <code>R</code> resets it to zero.</p>
      <pre>Batch(CU := I_PE, R := I_Reset, PV := 5);</pre>
      <p>A photoeye stays TRUE while a part blocks it. The counter only counts the edge, so one part counts as one.</p>`,
    task: `<b>Start</b> runs conveyor <b>C1</b>. Count parts passing photoeye <b>I_PE</b> near the end. After <b>5</b>, stop the conveyor and light <b>Done</b>. <b>Reset</b> clears the count and Done (it doesn't start the belt); Start then runs a new batch.` +
      IO_NOTE([['I_Start / I_Stop / I_Reset', 'Buttons (Stop is NC)'], ['I_PE', 'Photoeye at 2.85 m'], ['Q_C1_Run', 'Conveyor'], ['Q_Done', 'Batch done light']]),
    layout: { components: [C('st', 'pushbutton', 'Start', -1.8, -1.2, { color: 'green' }), C('sp', 'pushbutton', 'Stop', -1.2, -1.2, { color: 'red' }), C('rs', 'pushbutton', 'Reset', -0.6, -1.2, { color: 'blue' }),
      C('dn', 'pilot', 'Done', 0.1, -1.2, { color: 'amber' }), C('c1', 'conveyor', 'C1', -1.5, 0.5, { length: 3, speed: 0.4, interval: 2 })] },
    sensors: [DI('I_Start', 'st.pressed'), DI('I_Stop', 'sp.pressed', 'NC'), DI('I_Reset', 'rs.pressed'), PE('I_PE', 'c1.part', 2850, 'End photoeye')],
    starter: ST('(* Lesson 7 — batch counter *)\nVAR\n  Run   : BOOL;\n  Batch : CTU;\nEND_VAR\n\n'),
    solution: ST('VAR\n  Run   : BOOL;\n  Batch : CTU;\nEND_VAR\nBatch(CU := I_PE, R := I_Reset, PV := 5);\nRun := (I_Start OR Run) AND I_Stop AND NOT Batch.Q;\nQ_C1_Run := Run;\nQ_Done := Batch.Q;\n'),
    hints: ['Batch(CU := I_PE, R := I_Reset, PV := 5);', 'Add AND NOT Batch.Q to your seal-in so the belt stops when the batch is complete.'],
    objectives: [
      { id: 'run', text: 'Start runs the conveyor', test: h => { h.tap('Start').run(0.5); return fail(h.out('Q_C1_Run'), 'C1 not running'); } },
      { id: 'five', text: 'Stops with Done lit after exactly 5 parts pass the photoeye', test: h => {
        let n = 0, last = false; h.watch(() => { const v = h.tag('I_PE'); if (v && !last) n++; last = v; });
        h.tap('Start'); const t = h.until(() => !h.out('Q_C1_Run'), 60); if (t < 0) return 'Conveyor never stopped';
        h.run(1); return fail(n === 5 && h.out('Q_Done'), `${n} parts passed the photoeye${h.out('Q_Done') ? '' : ' and Done is off'}`); } },
      { id: 'reset', text: 'Reset clears Done; Start runs a new batch', test: h => {
        h.tap('Start'); if (h.until(() => h.out('Q_Done'), 60) < 0) return 'First batch never completed';
        h.tap('Reset'); if (h.out('Q_Done')) return 'Done still on after Reset'; if (h.out('Q_C1_Run')) return 'Reset started the belt';
        h.tap('Start').run(0.5); return fail(h.out('Q_C1_Run'), 'A new batch did not start'); } },
    ],
  },
  {
    id: 'L08', unit: 'Timers, counters & edges', title: 'Edge detection: one-button toggle', minutes: 8,
    summary: 'Use R_TRIG so one press equals one action.',
    theory: `<p>An input stays TRUE for many scans while a button is held. <b>R_TRIG</b> (rising edge, a "one-shot") is TRUE for <b>exactly one scan</b> when its input goes from FALSE to TRUE. Use it whenever an action must happen once per press: toggling, counting, stepping a sequence.</p>
      <pre>Edge(CLK := I_Button);
IF Edge.Q THEN Lamp := NOT Lamp; END_IF;</pre>
      <p>Without the edge, the lamp would flicker on and off every scan while the button is held.</p>`,
    task: `Each press of <b>Toggle</b> switches <b>Lamp</b> on, then off, then on… Holding the button must not make it flicker.` + IO_NOTE([['I_Toggle', 'Toggle button (NO)'], ['Q_Lamp', 'Lamp']]),
    layout: { components: [C('pb', 'pushbutton', 'Toggle', -0.6, 0, { color: 'white' }), C('pl', 'pilot', 'Lamp', 0.6, 0, { color: 'amber' })] },
    sensors: [DI('I_Toggle', 'pb.pressed')],
    starter: ST('(* Lesson 8 — toggle *)\nVAR\n  Edge : R_TRIG;\n  On   : BOOL;\nEND_VAR\n\n'),
    solution: ST('VAR\n  Edge : R_TRIG;\n  On   : BOOL;\nEND_VAR\nEdge(CLK := I_Toggle);\nIF Edge.Q THEN On := NOT On; END_IF;\nQ_Lamp := On;\n'),
    hints: ['Edge(CLK := I_Toggle); gives Edge.Q for one scan per press.', 'IF Edge.Q THEN On := NOT On; END_IF;'],
    objectives: [
      { id: 'on', text: 'First press turns the lamp on', test: h => { h.tap('Toggle'); return fail(h.out('Q_Lamp') === true, 'Lamp is off after one press'); } },
      { id: 'hold', text: 'Holding the button does not flicker', test: h => { h.press('Toggle').run(0.1); const v = h.out('Q_Lamp'); if (!v) return 'Lamp did not turn on'; return fail(h.always(() => h.out('Q_Lamp') === v, 2), 'Lamp changed while the button was held'); } },
      { id: 'off', text: 'Second press turns it off; four presses leave it off', test: h => { h.tap('Toggle').tap('Toggle'); if (h.out('Q_Lamp')) return 'Still on after 2 presses'; h.tap('Toggle').tap('Toggle'); return fail(!h.out('Q_Lamp'), 'On after 4 presses'); } },
    ],
  },
  // ───────────────────────── 3 · Analog & process ─────────────────────────
  {
    id: 'L09', unit: 'Analog & process', title: 'Analog scaling: 4–20 mA', minutes: 15,
    summary: 'Scale a current loop to engineering units and detect a broken wire.',
    theory: `<p>Most transmitters send <b>4–20 mA</b>: 4 mA is 0 % of range, 20 mA is 100 %. The live zero at 4 mA lets you tell "empty" (4 mA) from a <b>broken wire</b> (0 mA). Under NAMUR NE43, below 3.6–3.8 mA means a fault.</p>
      <pre>Level := (mA - 4.0) / 16.0 * 100.0;      (* 0–100 % *)
TxFault := mA < 3.8;</pre>
      <p>On a fault the controller must fail <b>safe</b>: here, stop filling, because the level is unknown.</p>`,
    task: `<b>AI_T1_mA</b> is the tank level as 4–20 mA. Calculate <code>Level</code> (REAL, %) and <code>TxFault</code> (BOOL, below 3.8 mA). Fill the tank with valve <b>Fill</b> until 75 %. Light <b>High</b> above 80 %. On TxFault, close Fill and don't show High.` +
      IO_NOTE([['AI_T1_mA', 'Level transmitter, mA (REAL)'], ['Q_Fill_Open', 'Fill valve'], ['Q_High', 'High level light'], ['Level, TxFault', 'Variables you declare']]),
    layout: { components: [C('t1', 'tank', 'T1', 0.4, 0.4, { capacity: 1000, level: 0 }), C('fv', 'valve', 'Fill', -1, 0.4, { from: '@supply', to: 't1', flow: 600 }),
      C('hi', 'pilot', 'High', -0.6, -1.2, { color: 'red' })] },
    sensors: [AI('AI_T1_mA', 't1.level', 0, 100, { scale: 'mA', noise: 0, desc: 'LT-1 level transmitter, 4–20 mA' })],
    starter: ST('(* Lesson 9 — 4–20 mA scaling *)\nVAR\n  Level   : REAL;   (* % *)\n  TxFault : BOOL;\nEND_VAR\n\n'),
    solution: ST('VAR\n  Level   : REAL;\n  TxFault : BOOL;\nEND_VAR\nTxFault := AI_T1_mA < 3.8;\nLevel := (AI_T1_mA - 4.0) / 16.0 * 100.0;\nQ_Fill_Open := NOT TxFault AND Level < 75.0;\nQ_High := Level > 80.0 AND NOT TxFault;\n'),
    hints: ['Level := (AI_T1_mA - 4.0) / 16.0 * 100.0;', 'Q_Fill_Open := NOT TxFault AND Level < 75.0;'],
    objectives: [
      { id: 'scale', text: 'Level matches the tank within 1 % at 0, 50 and 100 %', test: h => {
        for (const v of [0, 50, 100]) { h.ctl('T1', 'fill', v).run(0.2); const l = h.tag('Level'); if (!near(l, v, 1)) return `At ${v} % your Level is ${(+l).toFixed(1)}`; } return true; } },
      { id: 'fill', text: 'Fills to about 75 % and stops (no overflow)', test: h => { h.ctl('T1', 'fill', 0).run(120); const l = h.sig('t1.level'); return fail(l >= 72 && l <= 79 && !h.out('Q_Fill_Open'), `Level ended at ${l.toFixed(1)} %`); } },
      { id: 'high', text: 'High light above 80 %, off at 60 %', test: h => { h.ctl('T1', 'fill', 90).run(0.3); if (!h.out('Q_High')) return 'High is off at 90 %'; h.ctl('T1', 'fill', 60).run(0.3); return fail(!h.out('Q_High'), 'High is on at 60 %'); } },
      { id: 'wire', text: 'Wire break: TxFault TRUE, Fill closed, no false High', test: h => { h.ctl('T1', 'fill', 30); h.sensorFault('AI_T1_mA', 'wire_break'); h.run(0.5); return fail(h.tag('TxFault') === true && !h.out('Q_Fill_Open') && !h.out('Q_High'), 'Wire break not handled safely'); } },
    ],
  },
  {
    id: 'L10', unit: 'Analog & process', title: 'Compare: level control with hysteresis', minutes: 12,
    summary: 'Keep a tank between two levels without chattering the valve.',
    theory: `<p>Opening a valve at "level &lt; 50" and closing it at "level ≥ 50" makes it cycle on every ripple. That's called <b>chattering</b>, and it wears out valves. Use two thresholds (<b>hysteresis</b>, a deadband): start filling at the low limit and stop at the high limit.</p>
      <pre>IF Level <= 40.0 THEN Filling := TRUE;
ELSIF Level >= 60.0 THEN Filling := FALSE; END_IF;</pre>`,
    task: `Copy selector <b>Demand</b> to the outlet valve (already in the starter). Keep tank <b>T1</b> between <b>40 %</b> and <b>60 %</b> using inlet valve <b>Fill</b>: open at ≤ 40 %, close at ≥ 60 %. Light <b>LowLow</b> below 20 %.` +
      IO_NOTE([['AI_Level', 'Tank level %'], ['I_Demand_P1', 'Demand selector ON'], ['Q_Fill_Open', 'Inlet valve'], ['Q_Out_Open', 'Outlet valve'], ['Q_LowLow', 'Low-low light']]),
    layout: { components: [C('t1', 'tank', 'T1', 0.3, 0.4, { capacity: 500, level: 50 }), C('fv', 'valve', 'Fill', -1, 0.4, { from: '@supply', to: 't1', flow: 300 }),
      C('ov', 'valve', 'Out', 1.6, 0.4, { from: 't1', to: '@drain', flow: 150 }), C('sw', 'selector', 'Demand', -1.2, -1.2, { positions: '2', labels: 'OFF,ON' }), C('ll', 'pilot', 'LowLow', -0.4, -1.2, { color: 'red' })] },
    sensors: [AI('AI_Level', 't1.level', 0, 100, { noise: 0.3 }), DI('I_Demand_P1', 'sw.p1')],
    starter: ST('(* Lesson 10 — level control with hysteresis *)\nVAR\n  Filling : BOOL;\nEND_VAR\nQ_Out_Open := I_Demand_P1;   (* given *)\n\n'),
    solution: ST('VAR\n  Filling : BOOL;\nEND_VAR\nQ_Out_Open := I_Demand_P1;\nIF AI_Level <= 40.0 THEN Filling := TRUE;\nELSIF AI_Level >= 60.0 THEN Filling := FALSE; END_IF;\nQ_Fill_Open := Filling;\nQ_LowLow := AI_Level < 20.0;\n'),
    hints: ['A BOOL "Filling" set at ≤ 40 and reset at ≥ 60.', 'IF AI_Level <= 40.0 THEN Filling := TRUE; ELSIF AI_Level >= 60.0 THEN Filling := FALSE; END_IF;'],
    objectives: [
      { id: 'band', text: 'With demand ON, level stays between 35 and 65 % for 4 minutes', test: h => { h.select('Demand', 1); return fail(h.always(() => { const l = h.sig('t1.level'); return l > 35 && l < 65; }, 240), `Level left the band (${h.sig('t1.level').toFixed(1)} %)`); } },
      { id: 'chatter', text: 'Fill valve cycles calmly (2–14 times in 4 min, no chattering)', test: h => { let n = 0, last = false; h.watch(() => { const v = !!h.out('Q_Fill_Open'); if (v && !last) n++; last = v; }); h.select('Demand', 1).run(240); return fail(n >= 2 && n <= 14, `Fill valve opened ${n} times`); } },
      { id: 'idle', text: 'No demand at 50 %: valve stays closed', test: h => { return fail(h.always(() => !h.out('Q_Fill_Open'), 20), 'Fill valve opened with no demand above 40 %'); } },
      { id: 'll', text: 'LowLow light below 20 %', test: h => { h.ctl('T1', 'fill', 10).run(0.3); return fail(h.out('Q_LowLow'), 'LowLow is off at 10 %'); } },
    ],
  },
  {
    id: 'L11', unit: 'Analog & process', title: 'Sequencing: a batch mixer state machine', minutes: 20,
    summary: 'Fill → mix → drain with a CASE state machine.',
    theory: `<p>Machines run in <b>steps</b>. Keep the step in an integer and use <code>CASE</code>: each step waits for its <b>transition condition</b>, and outputs are written <i>outside</i> the CASE from the step number. That makes the logic easy to read and to troubleshoot (the HMI can show "Step 20").</p>
      <pre>CASE Step OF
  0:  IF Start THEN Step := 10; END_IF;   (* idle *)
  10: IF Level >= 70.0 THEN Step := 20; END_IF;   (* fill *)
  …
END_CASE;
Q_Fill := Step = 10;</pre>
      <p>Timers used by a step are called every scan with <code>IN := Step = 20</code>.</p>`,
    task: `On <b>Start</b>: fill <b>T1</b> with <b>Fill</b> to 70 % → run <b>Mixer</b> for 10 s → drain with pump <b>Drain</b> to 5 % → idle. <b>Busy</b> is lit while a batch runs. <b>Stop</b> aborts to idle with everything off. The mixer may only run above 20 %.` +
      IO_NOTE([['I_Start / I_Stop', 'Buttons (Stop NC)'], ['AI_Level', 'Level %'], ['Q_Fill_Open', 'Fill valve'], ['Q_Mixer_Run', 'Mixer'], ['Q_Drain_Run', 'Drain pump'], ['Q_Busy', 'Busy light']]),
    layout: { components: [C('t1', 'tank', 'T1', 0.3, 0.5, { capacity: 400, level: 0 }), C('fv', 'valve', 'Fill', -1, 0.5, { from: '@supply', to: 't1', flow: 400 }),
      C('mx', 'motor', 'Mixer', 0.3, 0.5, { attach: 't1', amps: 5 }), C('dp', 'pump', 'Drain', 1.6, 0.5, { from: 't1', to: '@drain', flow: 300 }),
      C('st', 'pushbutton', 'Start', -1.4, -1.2, { color: 'green' }), C('sp', 'pushbutton', 'Stop', -0.8, -1.2, { color: 'red' }), C('bz', 'pilot', 'Busy', -0.1, -1.2, { color: 'amber' })] },
    sensors: [DI('I_Start', 'st.pressed'), DI('I_Stop', 'sp.pressed', 'NC'), AI('AI_Level', 't1.level', 0, 100)],
    starter: ST('(* Lesson 11 — batch sequence *)\nVAR\n  Step   : INT;\n  MixTmr : TON;\nEND_VAR\n\nCASE Step OF\n  0: ;\nEND_CASE;\n'),
    solution: ST(`VAR
  Step   : INT;
  MixTmr : TON;
END_VAR
IF NOT I_Stop THEN Step := 0; END_IF;
MixTmr(IN := Step = 20, PT := T#10s);
CASE Step OF
  0:  IF I_Start AND I_Stop THEN Step := 10; END_IF;
  10: IF AI_Level >= 70.0 THEN Step := 20; END_IF;
  20: IF MixTmr.Q THEN Step := 30; END_IF;
  30: IF AI_Level <= 5.0 THEN Step := 0; END_IF;
END_CASE;
Q_Fill_Open := Step = 10;
Q_Mixer_Run := Step = 20 AND AI_Level > 20.0;
Q_Drain_Run := Step = 30;
Q_Busy      := Step <> 0;
`),
    hints: ['Steps: 0 idle, 10 fill, 20 mix, 30 drain.', 'Write the outputs after END_CASE: Q_Fill_Open := Step = 10; …', 'Stop: IF NOT I_Stop THEN Step := 0; END_IF;'],
    objectives: [
      { id: 'fill', text: 'Start opens Fill only', test: h => { h.tap('Start'); return fail(h.out('Q_Fill_Open') && !h.out('Q_Mixer_Run') && !h.out('Q_Drain_Run') && h.out('Q_Busy'), 'Expected only the fill valve (and Busy)'); } },
      { id: 'mix', text: 'Fill stops at 70 % (±3) and the mixer starts', test: h => { h.tap('Start'); if (h.until(() => !h.out('Q_Fill_Open'), 90) < 0) return 'Fill never stopped'; h.run(2); const l = h.sig('t1.level'); return fail(near(l, 71, 3) && h.out('Q_Mixer_Run'), `Level ${l.toFixed(1)} %, mixer ${h.out('Q_Mixer_Run') ? 'on' : 'off'}`); } },
      { id: 'time', text: 'Mixer runs for 10 s, then the drain pump starts', test: h => { h.tap('Start'); if (h.until(() => h.out('Q_Mixer_Run'), 90) < 0) return 'Mixer never started'; const t = h.until(() => !h.out('Q_Mixer_Run'), 20); return fail(near(t, 10, 0.6) && h.out('Q_Drain_Run'), `Mixed ${t.toFixed(1)} s, drain ${h.out('Q_Drain_Run') ? 'on' : 'off'}`); } },
      { id: 'drain', text: 'Drains to ≤ 5 %, then everything off', test: h => { h.tap('Start'); if (h.until(() => h.out('Q_Drain_Run'), 120) < 0) return 'Drain never started'; if (h.until(() => !h.out('Q_Drain_Run'), 90) < 0) return 'Drain never stopped'; h.run(1); const l = h.sig('t1.level'); return fail(l <= 7 && !h.out('Q_Busy') && !h.out('Q_Fill_Open'), `Ended at ${l.toFixed(1)} %, Busy ${h.out('Q_Busy') ? 'on' : 'off'}`); } },
      { id: 'abort', text: 'Stop aborts; Start begins a new batch', test: h => { h.tap('Start').run(5); h.tap('Stop').run(0.5); if (h.out('Q_Fill_Open') || h.out('Q_Busy')) return 'Outputs still on after Stop'; h.tap('Start'); return fail(h.out('Q_Fill_Open'), 'Did not restart'); } },
    ],
  },
  {
    id: 'L12', unit: 'Analog & process', title: 'Alarms: latch, acknowledge, flash', minutes: 18,
    summary: 'Build ISA-18.2-style alarm handling by hand.',
    theory: `<p>An alarm has two independent states: <b>active</b> (the condition is true now) and <b>unacknowledged</b> (no operator has seen it yet). The standard light sequence is:</p>
      <ul><li><b>Flashing</b>: new and unacknowledged.</li><li><b>Steady</b>: active and acknowledged.</li><li><b>Off</b>: cleared and acknowledged.</li></ul>
      <p>A <b>deadband</b> stops the alarm from toggling around the limit. The horn sounds until it's acknowledged. A flasher is a self-resetting TON: <code>Blink(IN := NOT Blink.Q, PT := T#500ms)</code>.</p>`,
    task: `High level alarm on <b>T1</b>: <code>HiActive</code> becomes TRUE above 90 % and clears below 85 %. Each new activation sets <code>HiUnack</code>. <b>Ack</b> clears HiUnack. The <b>horn</b> sounds while unacknowledged. The <b>red</b> light flashes while unacknowledged, is steady while active and acknowledged, and is off otherwise.` +
      IO_NOTE([['AI_Level', 'Level %'], ['I_Ack', 'Acknowledge button'], ['Q_SL_Red / Q_SL_Horn', 'Stack light red / horn'], ['HiActive, HiUnack', 'Variables you declare']]),
    layout: { components: [C('t1', 'tank', 'T1', 0.6, 0.5, { capacity: 200, level: 50 }), C('ak', 'pushbutton', 'Ack', -1, -1.2, { color: 'amber' }), C('sl', 'stacklight', 'SL', -0.3, -1.2)] },
    sensors: [AI('AI_Level', 't1.level', 0, 100, { noise: 0 }), DI('I_Ack', 'ak.pressed')],
    starter: ST('(* Lesson 12 — alarm handling *)\nVAR\n  HiActive, HiUnack : BOOL;\n  HiEdge : R_TRIG;\n  Blink  : TON;\n  Flash  : BOOL;\nEND_VAR\n\n'),
    solution: ST(`VAR
  HiActive, HiUnack : BOOL;
  HiEdge : R_TRIG;
  Blink  : TON;
  Flash  : BOOL;
END_VAR
IF AI_Level > 90.0 THEN HiActive := TRUE; ELSIF AI_Level < 85.0 THEN HiActive := FALSE; END_IF;
HiEdge(CLK := HiActive);
IF HiEdge.Q THEN HiUnack := TRUE; END_IF;
IF I_Ack THEN HiUnack := FALSE; END_IF;
Blink(IN := NOT Blink.Q, PT := T#500ms);
IF Blink.Q THEN Flash := NOT Flash; END_IF;
Q_SL_Red  := (HiUnack AND Flash) OR (HiActive AND NOT HiUnack);
Q_SL_Horn := HiUnack;
`),
    hints: ['Activation with deadband: set above 90, reset below 85.', 'Use R_TRIG on HiActive to set HiUnack; the Ack button resets it.', 'Red := (HiUnack AND Flash) OR (HiActive AND NOT HiUnack);'],
    objectives: [
      { id: 'act', text: 'Above 90 %: HiActive and horn', test: h => { h.ctl('T1', 'fill', 95).run(0.5); return fail(h.tag('HiActive') === true && h.out('Q_SL_Horn'), 'Alarm/horn not active at 95 %'); } },
      { id: 'flash', text: 'Red flashes while unacknowledged', test: h => { h.ctl('T1', 'fill', 95).run(0.3); let n = 0, last = h.out('Q_SL_Red'); h.watch(() => { const v = h.out('Q_SL_Red'); if (v !== last) n++; last = v; }); h.run(3); return fail(n >= 4, `Red changed ${n} times in 3 s`); } },
      { id: 'ack', text: 'Ack silences the horn; red goes steady', test: h => { h.ctl('T1', 'fill', 95).run(1); h.tap('Ack'); if (h.out('Q_SL_Horn')) return 'Horn still on after Ack'; return fail(h.always(() => h.out('Q_SL_Red') === true, 2), 'Red is not steady'); } },
      { id: 'db', text: 'Deadband: still active at 88 %, clears at 80 %', test: h => { h.ctl('T1', 'fill', 95).run(0.5); h.tap('Ack'); h.ctl('T1', 'fill', 88).run(0.5); if (!h.tag('HiActive')) return 'Cleared at 88 % (no deadband)'; h.ctl('T1', 'fill', 80).run(0.5); return fail(!h.tag('HiActive') && !h.out('Q_SL_Red'), 'Did not clear at 80 %'); } },
      { id: 'rtn', text: 'Cleared before Ack: horn continues until acknowledged', test: h => { h.ctl('T1', 'fill', 95).run(0.5); h.ctl('T1', 'fill', 80).run(0.5); if (h.tag('HiActive')) return 'Still active at 80 %'; if (!h.out('Q_SL_Horn')) return 'Horn stopped before Ack'; h.tap('Ack').run(1); return fail(!h.out('Q_SL_Horn') && !h.out('Q_SL_Red'), 'Not all off after Ack'); } },
    ],
  },
  // ───────────────────────── 4 · Data & tracking ─────────────────────────
  {
    id: 'L13', unit: 'Data & tracking', title: 'Shift registers: reject tracking', minutes: 25,
    summary: 'Track metal parts from a detector to a reject pusher with an array FIFO.',
    theory: `<p>A sensor rarely sits where the action happens. Here a metal detector is 1.85 m upstream of the reject pusher, with several parts in between. The PLC must remember each part's result and use it when <i>that</i> part arrives: this is <b>tracking</b>.</p>
      <p>When parts are counted at both ends, a <b>FIFO</b> made from an array does it. Push the result in when a part leaves the detector, and pull the oldest out when a part reaches the pusher:</p>
      <pre>Fifo[N] := MetalSeen;  N := N + 1;     (* part leaves detector *)
Reject := Fifo[0];  BSR(Fifo, FALSE);  N := N - 1;   (* part at pusher *)</pre>
      <p><code>BSR</code> shifts every element one place toward index 0. For fixed-pitch (indexing) machines use <code>BSL</code> on every index, or <code>SHL</code> on a word.</p>`,
    task: `Reject every <b>metal</b> part with pusher <b>Rej</b>; non-metal parts ride to the end. A part at the detector shows on <b>I_PE_Det</b>; metal shows on <b>I_Metal</b>, a short window in the middle. A part at the pusher shows on <b>I_PE_Rej</b>. Stop the belt while pushing: extend until <b>I_Rej_Ext</b>, retract until <b>I_Rej_Ret</b>.` +
      IO_NOTE([['I_Start / I_Stop', 'Buttons (Stop NC)'], ['I_PE_Det, I_Metal', 'Detector station photoeye + inductive prox (0.8 m)'], ['I_PE_Rej', 'Photoeye at the pusher (2.65 m)'], ['I_Rej_Ext / I_Rej_Ret', 'Pusher reed switches'], ['Q_C1_Run, Q_Rej_Ext', 'Belt, pusher solenoid']]),
    layout: { components: [C('c1', 'conveyor', 'C1', -1.8, 0.5, { length: 3.6, speed: 0.3, interval: 2.2, tallPct: 0, metalPct: 40 }),
      C('rej', 'cylinder', 'Rej', 0, 0, { conveyor: 'c1', pos: 2.6, mode: 'push', stroke: 0.4 }),
      C('st', 'pushbutton', 'Start', -1.6, -1.2, { color: 'green' }), C('sp', 'pushbutton', 'Stop', -1.0, -1.2, { color: 'red' })] },
    sensors: [DI('I_Start', 'st.pressed'), DI('I_Stop', 'sp.pressed', 'NC'), PE('I_PE_Det', 'c1.part', 800), PE('I_Metal', 'c1.metal', 800), PE('I_PE_Rej', 'c1.part', 2650),
      DI('I_Rej_Ext', 'rej.ext'), DI('I_Rej_Ret', 'rej.ret')],
    starter: ST('(* Lesson 13 — reject tracking *)\nVAR\n  Run   : BOOL;\n  Fifo  : ARRAY[0..9] OF BOOL;\n  N     : INT;\nEND_VAR\n\n'),
    solution: ST(`VAR
  Run       : BOOL;
  Fifo      : ARRAY[0..9] OF BOOL;
  N         : INT;
  MetalSeen : BOOL;
  DetOut    : F_TRIG;
  AtRej     : R_TRIG;
  Reject    : BOOL;
  St        : INT;     (* 0 conveying, 10 extend, 20 retract *)
END_VAR
Run := (I_Start OR Run) AND I_Stop;
(* detector: remember metal while the part is in front of it *)
IF I_PE_Det AND I_Metal THEN MetalSeen := TRUE; END_IF;
DetOut(CLK := I_PE_Det);
IF DetOut.Q AND N <= 9 THEN Fifo[N] := MetalSeen; N := N + 1; MetalSeen := FALSE; END_IF;
(* pusher station *)
AtRej(CLK := I_PE_Rej);
IF AtRej.Q AND N > 0 THEN
  Reject := BSR(Fifo, FALSE);
  N := N - 1;
  IF Reject THEN St := 10; END_IF;
END_IF;
CASE St OF
  10: IF I_Rej_Ext THEN St := 20; END_IF;
  20: IF I_Rej_Ret THEN St := 0; END_IF;
END_CASE;
Q_C1_Run  := Run AND St = 0;
Q_Rej_Ext := St = 10;
`),
    hints: ['Latch MetalSeen while I_PE_Det AND I_Metal; on the falling edge of I_PE_Det, store it in Fifo[N] and N := N + 1.', 'On the rising edge of I_PE_Rej: Reject := BSR(Fifo, FALSE); N := N - 1; (BSR returns the element that falls out of index 0.)', 'Stop the belt while St <> 0; extend in step 10, retract in step 20.'],
    objectives: [
      { id: 'run', text: 'Start runs the belt', test: h => { h.tap('Start').run(0.5); return fail(h.out('Q_C1_Run'), 'Belt not running'); } },
      { id: 'metal', text: 'Every metal part is rejected', test: h => { h.tap('Start').run(90); const r = h.state('Rej').bin; return fail(r.metal >= 4 && r.metal === r.n, `Reject bin: ${r.n} parts, ${r.metal} metal`); } },
      { id: 'plain', text: 'Non-metal parts reach the end', test: h => { h.tap('Start').run(90); const e = h.state('C1').bin; return fail(e.n >= 4 && e.metal === 0, `End bin: ${e.n} parts, ${e.metal} metal`); } },
      { id: 'jam', text: 'No jams', test: h => { h.tap('Start'); return fail(h.always(() => !h.state('C1').items.some(i => i.state === 'jam'), 90), 'A part jammed at the pusher'); } },
      { id: 'array', text: 'Uses an ARRAY for tracking', test: h => fail(Object.values(h.rt.tags).some(t => t.t && t.t.k === 'a' && !/^_L/.test(t.name)), 'No ARRAY variable found') },
    ],
  },
  {
    id: 'L14', unit: 'Data & tracking', title: 'UDTs: one data type, three pumps', minutes: 20,
    summary: 'Model equipment with a STRUCT and loop over an array of them.',
    theory: `<p>A <b>user-defined type (UDT)</b> groups everything about one piece of equipment, so three pumps are an <code>ARRAY[1..3] OF PumpCtl</code> instead of a dozen loose tags. HMIs, alarms and code all use the same shape. Function blocks can live inside a UDT too:</p>
      <pre>TYPE PumpCtl : STRUCT
  Cmd, Running : BOOL;
  Starts       : INT;
  StartEdge    : R_TRIG;
END_STRUCT; END_TYPE</pre>
      <p>Put the type in <b>Data types</b> and the array in <b>Globals</b>. Then <code>FOR i := 1 TO 3 DO … Pumps[i] … END_FOR;</code></p>`,
    task: `Declare <code>Pumps : ARRAY[1..3] OF PumpCtl</code> with members <code>Cmd</code>, <code>Running</code> and <code>Starts</code>. Potentiometer <b>Demand</b> (0–3) sets how many pumps run: pump <i>i</i> runs when Demand ≥ i − 0.5. Copy each pump's aux contact into <code>Pumps[i].Running</code>, and count every start in <code>Pumps[i].Starts</code>.` +
      IO_NOTE([['AI_Demand', 'Demand pot, 0–3'], ['I_P1_Running … I_P3_Running', 'Aux contacts'], ['Q_P1_Run … Q_P3_Run', 'Pump starters']]),
    layout: { components: [C('t1', 'tank', 'T1', 0, 0.6, { capacity: 5000, level: 60 }),
      C('p1', 'pump', 'P1', 1.4, 0.0, { from: 't1', to: '@drain', flow: 100 }), C('p2', 'pump', 'P2', 1.4, 0.6, { from: 't1', to: '@drain', flow: 100 }), C('p3', 'pump', 'P3', 1.4, 1.2, { from: 't1', to: '@drain', flow: 100 }),
      C('pot', 'pot', 'Demand', -1, -1.2, { min: 0, max: 3, unit: 'pumps' })] },
    sensors: [AI('AI_Demand', 'pot.value', 0, 3, { noise: 0 }), DI('I_P1_Running', 'p1.running'), DI('I_P2_Running', 'p2.running'), DI('I_P3_Running', 'p3.running')],
    starter: { types: '(* Lesson 14 — declare PumpCtl here *)\nTYPE\nEND_TYPE\n', globals: 'VAR_GLOBAL\nEND_VAR\n', pous: [{ id: 'main', name: 'Main', lang: 'ST', src: '(* Lesson 14 — pumps *)\n' }] },
    solution: {
      types: 'TYPE\n  PumpCtl : STRUCT\n    Cmd, Running : BOOL;\n    Starts       : INT;\n    StartEdge    : R_TRIG;\n  END_STRUCT;\nEND_TYPE\n',
      globals: 'VAR_GLOBAL\n  Pumps : ARRAY[1..3] OF PumpCtl;\n  i     : INT;\nEND_VAR\n',
      pous: [{ id: 'main', name: 'Main', lang: 'ST', src: `FOR i := 1 TO 3 DO
  Pumps[i].Cmd := AI_Demand >= INT_TO_REAL(i) - 0.5;
END_FOR;
Q_P1_Run := Pumps[1].Cmd;
Q_P2_Run := Pumps[2].Cmd;
Q_P3_Run := Pumps[3].Cmd;
Pumps[1].Running := I_P1_Running;
Pumps[2].Running := I_P2_Running;
Pumps[3].Running := I_P3_Running;
FOR i := 1 TO 3 DO
  Pumps[i].StartEdge(CLK := Pumps[i].Running);
  IF Pumps[i].StartEdge.Q THEN Pumps[i].Starts := Pumps[i].Starts + 1; END_IF;
END_FOR;
` }] },
    hints: ['Data types: TYPE PumpCtl : STRUCT Cmd, Running : BOOL; Starts : INT; StartEdge : R_TRIG; END_STRUCT; END_TYPE', 'Globals: VAR_GLOBAL Pumps : ARRAY[1..3] OF PumpCtl; i : INT; END_VAR', 'Outputs aren\'t an array, so write Q_P1_Run := Pumps[1].Cmd; etc.'],
    objectives: [
      { id: 'udt', text: 'Pumps is an ARRAY[1..3] of a STRUCT with Cmd, Running, Starts', test: h => { for (const n of ['Pumps[1].Cmd', 'Pumps[3].Running', 'Pumps[2].Starts']) if (!h.has(n)) return `${n} not found`; return true; } },
      { id: 'demand', text: 'Demand 2 runs P1 and P2 only', test: h => { h.pot('Demand', 2).run(1); return fail(h.out('Q_P1_Run') && h.out('Q_P2_Run') && !h.out('Q_P3_Run'), 'Wrong pumps running for demand 2'); } },
      { id: 'fb', text: 'Pumps[i].Running follows the aux contacts', test: h => { h.pot('Demand', 3).run(2); if (!(h.tag('Pumps[1].Running') && h.tag('Pumps[3].Running'))) return 'Running not set while pumps run'; h.pot('Demand', 0).run(2); return fail(!h.tag('Pumps[2].Running'), 'Running still TRUE after stop'); } },
      { id: 'starts', text: 'Starts counts each start', test: h => { for (let k = 0; k < 2; k++) { h.pot('Demand', 1).run(2); h.pot('Demand', 0).run(2); } return fail(h.tag('Pumps[1].Starts') === 2 && h.tag('Pumps[2].Starts') === 0, `Starts = ${h.tag('Pumps[1].Starts')} / ${h.tag('Pumps[2].Starts')}`); } },
    ],
  },
  // ───────────────────────── 5 · Control ─────────────────────────
  {
    id: 'L15', unit: 'Closed-loop control', title: 'PID: tank temperature', minutes: 25,
    summary: 'Tune a PID loop to hold temperature against a cooling load.',
    theory: `<p>On/off control overshoots and cycles. A <b>PID</b> controller sets a continuous output from the error:</p>
      <ul><li><b>P</b> reacts to the error now.</li><li><b>I</b> removes the steady offset.</li><li><b>D</b> damps fast changes.</li></ul>
      <pre>TIC(ACTUAL := AI_Temp, SETPOINT := TempSP);
AO_H1_Power := TIC.Y;</pre>
      <p>Tuning workflow:</p>
      <ol><li>Start with P only and raise <code>KP</code> until the response is quick but not oscillating.</li><li>Add integral: start <code>TN</code> around the process time constant and shorten it until the offset goes away without overshoot.</li></ol>
      <p>Use the Trend tab (pens <code>AI_Temp</code>, <code>TempSP</code>, <code>TIC.Y</code>). In this tank, cold water flows through constantly, so the heater must work all the time.</p>`,
    task: `Hold <b>T1</b> at <code>TempSP</code> (REAL, default 45 °C) with the SCR heater <b>H1</b> using a <code>PID</code>. Reach ±1 °C of setpoint within 90 s, overshoot no more than 3 °C, hold within ±0.7 °C, and follow a setpoint change to 55 °C. Valves In/Out must stay open (given in the starter).` +
      IO_NOTE([['AI_Temp', 'Temperature °C'], ['Q_H1_On', 'Heater contactor'], ['AO_H1_Power', 'Heater power 0–100 %'], ['Q_In_Open / Q_Out_Open', 'Flow-through valves (keep open)'], ['TempSP', 'Variable you declare']]),
    layout: { components: [C('t1', 'tank', 'T1', 0.2, 0.5, { capacity: 200, level: 80, temp: 20 }), C('h1', 'heater', 'H1', 0.2, 0.5, { tank: 't1', rate: 1.2, scr: true }),
      C('in', 'valve', 'In', -1.1, 0.5, { from: '@supply', to: 't1', flow: 20 }), C('out', 'valve', 'Out', 1.5, 0.5, { from: 't1', to: '@drain', flow: 20 })] },
    sensors: [AI('AI_Temp', 't1.temp', 0, 100, { noise: 0.1 })],
    starter: ST('(* Lesson 15 — PID temperature *)\nVAR\n  TempSP : REAL := 45.0;\nEND_VAR\nQ_In_Open  := TRUE;   (* given: cold water flows through *)\nQ_Out_Open := TRUE;\n\n'),
    solution: ST('VAR\n  TempSP : REAL := 45.0;\n  TIC    : PID := (KP := 12.0, TN := 40.0);\nEND_VAR\nQ_In_Open  := TRUE;\nQ_Out_Open := TRUE;\nTIC(ACTUAL := AI_Temp, SETPOINT := TempSP);\nQ_H1_On := TRUE;\nAO_H1_Power := TIC.Y;\n'),
    hints: ['Declare TIC : PID := (KP := 10.0, TN := 40.0); and call TIC(ACTUAL := AI_Temp, SETPOINT := TempSP); every scan.', 'Q_H1_On := TRUE; AO_H1_Power := TIC.Y;', 'Overshooting? Lower KP or lengthen TN. Slow? Raise KP.'],
    objectives: [
      { id: 'reach', text: 'Reaches 45 ±1 °C within 90 s', test: h => { const t = h.until(() => near(h.sig('t1.temp'), 45, 1), 90); return fail(t >= 0, `Temperature only reached ${h.sig('t1.temp').toFixed(1)} °C`); } },
      { id: 'over', text: 'Overshoot ≤ 3 °C', test: h => { let mx = 0; h.watch(() => { mx = Math.max(mx, h.sig('t1.temp')); }); h.run(150); return fail(mx <= 48, `Peaked at ${mx.toFixed(1)} °C`); } },
      { id: 'hold', text: 'Holds within ±0.7 °C (after 150 s)', test: h => { h.run(150); return fail(h.always(() => near(h.sig('t1.temp'), 45, 0.7), 30), `Wandered to ${h.sig('t1.temp').toFixed(2)} °C`); } },
      { id: 'step', text: 'Follows a setpoint change to 55 °C within 90 s', test: h => { h.run(150); h.write('TempSP', 55); const t = h.until(() => near(h.sig('t1.temp'), 55, 1), 90); return fail(t >= 0, `Only reached ${h.sig('t1.temp').toFixed(1)} °C`); } },
    ],
  },
];

module.exports = { LESSONS };
