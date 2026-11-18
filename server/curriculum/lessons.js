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
    theory: `<p>Stop buttons are wired <b>normally closed (NC)</b>. With nothing pressed, current flows and the input is <b>TRUE</b>. Pressing the button <i>opens</i> the circuit, and so does a broken wire, a loose terminal or a blown fuse. Either way the input goes <b>FALSE</b>.</p>
      <p>That's why stop logic is written as "allowed to run while the stop input is TRUE". A broken wire then stops the machine instead of silently disabling the stop button.</p>
      <p><b>E-stops</b> are NC too, but an emergency stop is a <i>safety function</i>: it must work even if the PLC has crashed or been programmed wrong. So an E-stop is not just another PLC input — it is wired through a <b>safety relay</b> that removes power directly. That gets its own lesson after the seal-in.</p>`,
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
    id: 'L16', unit: 'Discrete logic', title: 'E-stop and the safety relay', minutes: 15,
    summary: 'Work alongside a hardwired, monitored E-stop circuit — and never restart on your own.',
    theory: `<p>A standard PLC is not a safety device: a program bug, a forced output or a crashed CPU could keep a motor running. So the <b>emergency stop</b> (ISO 13850, IEC 60204-1) is built as a separate, <b>monitored</b> circuit, rated by ISO 13849-1:</p>
      <ul><li>The E-stop has <b>two NC contacts</b> wired to two channels of a <b>safety relay</b>. The relay checks that both channels open and close together. A short across one channel (a <i>cross-fault</i>) or a welded contact shows up as a <b>discrepancy</b>, and the relay refuses to switch on again until it is fixed.</li>
      <li>The safety relay's output contacts sit in series with the contactor coils, so pressing the E-stop removes power <b>directly</b> — whatever the PLC is doing.</li>
      <li>After the E-stop is released, power stays off until someone presses the blue <b>reset</b> button. The reset is <b>monitored</b>: it acts when the button is <i>released</i>, so a jammed or taped-down button can't reset the circuit.</li></ul>
      <p>The PLC only reads a <b>status contact</b> from the safety relay (<code>I_SR1_OK</code>), plus a fault output. Its job is the standard control around the safety function:</p>
      <ul><li>Drop the run latches when the safety circuit opens. Otherwise the motor would jump back into life the moment someone resets — an <b>unexpected restart</b>, which the standards forbid. Restart must always need a new, deliberate Start.</li>
      <li>Tell the operator what to do: a reset-required lamp, and a fault lamp for wiring problems.</li></ul>
      <pre>Run := (I_Start OR Run) AND I_Stop AND I_SR1_OK;</pre>`,
    task: `Run <b>M1</b> with <b>Start</b>/<b>Stop</b> as in the seal-in lesson, but only while the safety relay <b>SR1</b> is OK. When the E-stop <b>ES1</b> is pressed the relay cuts power on its own — your run latch must drop too, so that after the E-stop is released and <b>Reset</b> is pressed, M1 stays off until <b>Start</b> is pressed again. Light <b>ResetLamp</b> while the relay is off and waiting for a reset, and <b>FaultLamp</b> while the relay reports a fault.` +
      IO_NOTE([['I_Start / I_Stop', 'Start (NO), Stop (NC)'], ['I_SR1_OK', 'Safety relay status contact: TRUE = safety outputs on'], ['I_SR1_Fault', 'Safety relay fault (channel discrepancy)'], ['I_M1_Running', 'M1 aux contact'], ['Q_M1_Run', 'M1 contactor (powered through the safety relay)'], ['Q_ResetLamp / Q_FaultLamp', 'Blue reset-required lamp, red fault lamp']]) +
      `<p class="small muted">The E-stop and the Reset button are wired to the safety relay, not to the PLC. The relay starts switched off, so press Reset once after power-up.</p>`,
    layout: { components: [C('st', 'pushbutton', 'Start', -1.8, -1.2, { color: 'green' }), C('sp', 'pushbutton', 'Stop', -1.2, -1.2, { color: 'red' }),
      C('es', 'estop', 'ES1', -0.5, -1.2), C('rs', 'pushbutton', 'Reset', 0.15, -1.2, { color: 'blue' }),
      C('rl', 'pilot', 'ResetLamp', 0.8, -1.2, { color: 'blue' }), C('fl', 'pilot', 'FaultLamp', 1.4, -1.2, { color: 'red' }),
      C('sr', 'safetyrelay', 'SR1', -0.5, 0.2, { estop: 'es', reset: 'rs', mode: 'manual' }), C('m1', 'motor', 'M1', 1, 0.6, { amps: 12 })] },
    sensors: [DI('I_Start', 'st.pressed'), DI('I_Stop', 'sp.pressed', 'NC'), DI('I_SR1_OK', 'sr.ok', 'NO', 'Safety relay SR1 status'), DI('I_SR1_Fault', 'sr.fault', 'NO', 'Safety relay SR1 fault'), DI('I_M1_Running', 'm1.running')],
    starter: ST('(* E-stop lesson — standard control around a safety relay *)\nVAR\n  Run : BOOL;\nEND_VAR\n\n'),
    solution: ST('VAR\n  Run : BOOL;\nEND_VAR\n(* the run latch drops whenever the safety circuit opens: no restart without a new Start *)\nRun := (I_Start OR Run) AND I_Stop AND I_SR1_OK;\nQ_M1_Run := Run;\nQ_ResetLamp := NOT I_SR1_OK AND NOT I_SR1_Fault;\nQ_FaultLamp := I_SR1_Fault;\n'),
    hints: ['Start from the seal-in: Run := (I_Start OR Run) AND I_Stop; — then add the safety relay status in series.', 'Run := (I_Start OR Run) AND I_Stop AND I_SR1_OK;  ResetLamp := NOT I_SR1_OK AND NOT I_SR1_Fault;'],
    objectives: [
      { id: 'power', text: 'After power-up: ResetLamp on; after Reset, Start runs M1', test: h => {
        h.run(0.3); if (!h.out('Q_ResetLamp')) return 'ResetLamp is off although the safety relay needs a reset';
        h.tap('Reset').run(0.3); if (h.out('Q_ResetLamp')) return 'ResetLamp still on after Reset';
        h.tap('Start').run(1.5); return fail(h.out('Q_M1_Run') && h.sig('m1.running'), 'M1 did not run after Reset and Start'); } },
      { id: 'drop', text: 'E-stop stops M1 and drops the run command', test: h => {
        h.tap('Reset').tap('Start').run(1.5); if (!h.sig('m1.running')) return 'M1 never started';
        h.estop('ES1', true).run(1); if (h.sig('m1.running')) return 'Test setup: M1 still running';
        return fail(!h.out('Q_M1_Run'), 'Q_M1_Run stayed TRUE — the run latch did not drop when the safety circuit opened'); } },
      { id: 'norestart', text: 'No restart after E-stop release + reset — only a new Start runs M1', test: h => {
        h.tap('Reset').tap('Start').run(1.5); h.estop('ES1', true).run(0.5); h.estop('ES1', false).run(0.3); h.tap('Reset');
        if (!h.always(() => !h.sig('m1.running'), 3)) return 'M1 restarted by itself after the reset — unexpected restart!';
        h.tap('Start').run(1.5); return fail(h.sig('m1.running'), 'Start did not restart M1'); } },
      { id: 'blocked', text: 'Start pressed during the E-stop is ignored', test: h => {
        h.tap('Reset').run(0.2); h.estop('ES1', true).run(0.3); h.tap('Start'); h.estop('ES1', false).run(0.3); h.tap('Reset');
        return fail(h.always(() => !h.sig('m1.running'), 3), 'M1 started after reset because of a Start pressed during the E-stop'); } },
      { id: 'fault', text: 'Cross-fault: FaultLamp on, ResetLamp off', test: h => {
        h.tap('Reset').run(0.2); h.fault('sr.weld'); h.estop('ES1', true).run(0.5);
        if (!h.sig('sr.fault')) return 'Test setup: relay did not detect the discrepancy';
        return fail(h.out('Q_FaultLamp') && !h.out('Q_ResetLamp'), 'Expected FaultLamp on and ResetLamp off during a relay fault'); } },
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
    id: 'L09', powerUpOK: true, tabs: ['io'], unit: 'Analog & process', title: 'Analog scaling: 4–20 mA', minutes: 15,
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
    id: 'L10', tabs: ['trend'], unit: 'Analog & process', title: 'Compare: level control with hysteresis', minutes: 12,
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
    id: 'L11', tabs: ['trend'], unit: 'Analog & process', title: 'Sequencing: a batch mixer state machine', minutes: 20,
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
    id: 'L15', powerUpOK: true, tabs: ['trend'], unit: 'Closed-loop control', title: 'PID: tank temperature', minutes: 25,
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


/* ───────────── Ladder versions: starter, reference solution and ladder-specific hints ───────────── */
const NO = a => ({ t: 'NO', a }), NC = a => ({ t: 'NC', a }), PE_ = a => ({ t: 'P', a }), NE_ = a => ({ t: 'N', a });
const CMP = (a, op, b) => ({ t: 'CMP', a, op, b });
const O = (t, a, b, c) => Object.assign({ t, a }, b !== undefined ? { b } : {}, c !== undefined ? { c } : {});
const R = (comment, rows, outs) => ({ comment, rows, outs });
const LDU = (globals, rungs, types = '') => ({ types, globals: globals ? `VAR_GLOBAL\n${globals}\nEND_VAR\n` : '', pous: [{ id: 'main', name: 'Main', lang: 'LD', rungs }] });

const LADDER = {
  L01: { starter: LDU('', []), solution: LDU('', [R('PL1 follows PB1', [[NO('I_PB1')]], [O('COIL', 'Q_PL1')])]),
    hints: ['Add a rung: a normally-open contact I_PB1 driving a coil Q_PL1.', 'An NO contact passes power while its tag is TRUE.'] },
  L02: { starter: LDU('', []), solution: LDU('', [R('NC stop wiring: the input is TRUE while healthy', [[NO('I_Stop')]], [O('COIL', 'Q_Ready')])]),
    hints: ['Watch I_Stop in the Tags tab. It is TRUE when nobody presses Stop.', 'Use a normally-OPEN contact on I_Stop — the field wiring already inverts it. An NC contact here would be a double negative.'] },
  L03: { starter: LDU('  Run : BOOL;', []), solution: null,
    hints: ['Two branches in parallel: I_Start, and a Run contact (the seal-in). Put I_Stop in series on both branches. Drive coil Run.', 'Then a rung Run → Q_M1_Run, and a rung I_M1_Running → Q_RunLamp.'] },
  L16: { starter: LDU('  Run : BOOL;', []),
    solution: LDU('  Run : BOOL;', [
      R('Seal-in, only while the safety relay is on — the latch drops when it opens', [[NO('I_Start'), NO('I_Stop'), NO('I_SR1_OK')], [NO('Run'), NO('I_Stop'), NO('I_SR1_OK')]], [O('COIL', 'Run')]),
      R('', [[NO('Run')]], [O('COIL', 'Q_M1_Run')]),
      R('Reset required', [[NC('I_SR1_OK'), NC('I_SR1_Fault')]], [O('COIL', 'Q_ResetLamp')]),
      R('Safety relay fault', [[NO('I_SR1_Fault')]], [O('COIL', 'Q_FaultLamp')])]),
    hints: ['Start from the seal-in rung and add an NO contact on I_SR1_OK in series on both branches.', 'ResetLamp: NC I_SR1_OK and NC I_SR1_Fault in series. FaultLamp: NO I_SR1_Fault.'] },
  L04: { starter: LDU('  Fwd, Rev : BOOL;', []),
    solution: LDU('  Fwd, Rev : BOOL;', [
      R('Forward seal-in, interlocked with reverse', [[NO('I_Fwd'), NO('I_Stop'), NC('Rev')], [NO('Fwd'), NO('I_Stop'), NC('Rev')]], [O('COIL', 'Fwd')]),
      R('Reverse seal-in, interlocked with forward', [[NO('I_Rev'), NO('I_Stop'), NC('Fwd')], [NO('Rev'), NO('I_Stop'), NC('Fwd')]], [O('COIL', 'Rev')]),
      R('', [[NO('Fwd')]], [O('COIL', 'Q_M1_Fwd')]),
      R('', [[NO('Rev')]], [O('COIL', 'Q_M1_Rev')])]),
    hints: ['Build two seal-in rungs, one per direction (coils Fwd and Rev).', 'Add an NC contact of the other direction in series on each branch: NC Rev in the Fwd rung, NC Fwd in the Rev rung.'] },
  L05: { starter: LDU('  StartReq : BOOL;\n  Warn     : TON;', []),
    solution: LDU('  StartReq : BOOL;\n  Warn     : TON;', [
      R('Start request (seal-in)', [[NO('I_Start'), NO('I_Stop')], [NO('StartReq'), NO('I_Stop')]], [O('COIL', 'StartReq')]),
      R('3 s warning timer', [[NO('StartReq')]], [O('TON', 'Warn', 'T#3s')]),
      R('Horn and amber during the warning', [[NO('StartReq'), NC('Warn.Q')]], [O('COIL', 'Q_SL_Horn'), O('COIL', 'Q_SL_Amber')]),
      R('Run after the warning', [[NO('Warn.Q')]], [O('COIL', 'Q_C1_Run'), O('COIL', 'Q_SL_Green')])]),
    hints: ['Rung 1: seal-in coil StartReq. Rung 2: StartReq drives a TON box with instance Warn, preset T#3s.', 'Horn/amber: StartReq AND NC Warn.Q. Conveyor/green: NO Warn.Q.'] },
  L06: { starter: LDU('  RunOn : TOF;', []),
    solution: LDU('  RunOn : TOF;', [
      R('Heater lamp and fan run-on timer', [[NO('I_Heat_P1')]], [O('COIL', 'Q_HeaterLamp'), O('TOF', 'RunOn', 'T#10s')]),
      R('', [[NO('RunOn.Q')]], [O('COIL', 'Q_Fan_Run')])]),
    hints: ['One rung with I_Heat_P1 can drive several outputs: the lamp coil and a TOF box (instance RunOn, preset T#10s).', 'Second rung: NO RunOn.Q → Q_Fan_Run.'] },
  L07: { starter: LDU('  Run   : BOOL;\n  Batch : CTU;', []),
    solution: LDU('  Run   : BOOL;\n  Batch : CTU;', [
      R('Count parts', [[NO('I_PE')]], [O('CTU', 'Batch', '5')]),
      R('Reset the batch', [[NO('I_Reset')]], [O('RES', 'Batch')]),
      R('Run until the batch is complete', [[NO('I_Start'), NO('I_Stop'), NC('Batch.Q')], [NO('Run'), NO('I_Stop'), NC('Batch.Q')]], [O('COIL', 'Run')]),
      R('', [[NO('Run')]], [O('COIL', 'Q_C1_Run')]),
      R('', [[NO('Batch.Q')]], [O('COIL', 'Q_Done')])]),
    hints: ['A CTU box (instance Batch, preset 5) driven by an NO contact I_PE counts each rising edge.', 'Reset with a RES instruction on Batch from I_Reset, and put NC Batch.Q in series in your seal-in.'] },
  L08: { starter: LDU('  On      : BOOL;\n  OneShot : BOOL;', []),
    solution: LDU('  On      : BOOL;\n  OneShot : BOOL;', [
      R('One-shot: TRUE for a single scan per press', [[PE_('I_Toggle')]], [O('COIL', 'OneShot')]),
      R('Flip-flop: the one-shot inverts On', [[NO('OneShot'), NC('On')], [NC('OneShot'), NO('On')]], [O('COIL', 'On')]),
      R('', [[NO('On')]], [O('COIL', 'Q_Lamp')])]),
    hints: ['A P (positive transition) contact on I_Toggle into a coil OneShot gives one scan per press.', 'Classic flip-flop rung: (OneShot AND NC On) OR (NC OneShot AND On) → coil On.'] },
  L09: { starter: LDU('  Level   : REAL;   (* % *)\n  TxFault : BOOL;', []),
    solution: LDU('  Level   : REAL;\n  TxFault : BOOL;', [
      R('Wire break below 3.8 mA', [[CMP('AI_T1_mA', '<', '3.8')]], [O('COIL', 'TxFault')]),
      R('Scale 4–20 mA to 0–100 % (100 / 16 = 6.25)', [], [O('SUB', 'AI_T1_mA', '4.0', 'Level'), O('MUL', 'Level', '6.25', 'Level')]),
      R('Fill to 75 %', [[NC('TxFault'), CMP('Level', '<', '75.0')]], [O('COIL', 'Q_Fill_Open')]),
      R('High level', [[CMP('Level', '>', '80.0'), NC('TxFault')]], [O('COIL', 'Q_High')])]),
    hints: ['A rung with no contacts is always true. Use SUB (mA − 4.0 → Level) then MUL (Level × 6.25 → Level).', 'Compare contacts: AI_T1_mA < 3.8 → TxFault; NC TxFault + Level < 75.0 → Q_Fill_Open.'] },
  L10: { starter: LDU('  Filling : BOOL;', [R('Given: outlet follows demand', [[NO('I_Demand_P1')]], [O('COIL', 'Q_Out_Open')])]),
    solution: LDU('  Filling : BOOL;', [
      R('Given: outlet follows demand', [[NO('I_Demand_P1')]], [O('COIL', 'Q_Out_Open')]),
      R('Start filling at the low limit', [[CMP('AI_Level', '<=', '40.0')]], [O('SET', 'Filling')]),
      R('Stop filling at the high limit', [[CMP('AI_Level', '>=', '60.0')]], [O('RST', 'Filling')]),
      R('', [[NO('Filling')]], [O('COIL', 'Q_Fill_Open')]),
      R('Low-low', [[CMP('AI_Level', '<', '20.0')]], [O('COIL', 'Q_LowLow')])]),
    hints: ['Use a SET (latch) coil on Filling at ≤ 40 % and a RST (unlatch) coil at ≥ 60 %.', 'Then NO Filling → Q_Fill_Open.'] },
  L11: { starter: LDU('  Step   : INT;\n  MixTmr : TON;', []),
    solution: LDU('  Step   : INT;\n  MixTmr : TON;', [
      R('Stop aborts to idle', [[NC('I_Stop')]], [O('MOV', '0', 'Step')]),
      R('Mix timer runs in step 20', [[CMP('Step', '=', '20')]], [O('TON', 'MixTmr', 'T#10s')]),
      R('0 → 10: start', [[CMP('Step', '=', '0'), NO('I_Start'), NO('I_Stop')]], [O('MOV', '10', 'Step')]),
      R('10 → 20: full', [[CMP('Step', '=', '10'), CMP('AI_Level', '>=', '70.0')]], [O('MOV', '20', 'Step')]),
      R('20 → 30: mixed', [[CMP('Step', '=', '20'), NO('MixTmr.Q')]], [O('MOV', '30', 'Step')]),
      R('30 → 0: empty', [[CMP('Step', '=', '30'), CMP('AI_Level', '<=', '5.0')]], [O('MOV', '0', 'Step')]),
      R('Outputs from the step number', [[CMP('Step', '=', '10')]], [O('COIL', 'Q_Fill_Open')]),
      R('', [[CMP('Step', '=', '20'), CMP('AI_Level', '>', '20.0')]], [O('COIL', 'Q_Mixer_Run')]),
      R('', [[CMP('Step', '=', '30')]], [O('COIL', 'Q_Drain_Run')]),
      R('', [[CMP('Step', '<>', '0')]], [O('COIL', 'Q_Busy')])]),
    hints: ['One rung per transition: compare Step = n AND the condition → MOV the next step number into Step.', 'Then one rung per output: Step = 10 → Q_Fill_Open, and so on. Stop: NC I_Stop → MOV 0 to Step.'] },
  L12: { starter: LDU('  HiActive, HiUnack, Flash : BOOL;\n  Blink : TON;', []),
    solution: LDU('  HiActive, HiUnack, Flash : BOOL;\n  Blink : TON;', [
      R('Activate above 90 %', [[CMP('AI_Level', '>', '90.0')]], [O('SET', 'HiActive')]),
      R('Clear below 85 % (deadband)', [[CMP('AI_Level', '<', '85.0')]], [O('RST', 'HiActive')]),
      R('Each new activation is unacknowledged', [[PE_('HiActive')]], [O('SET', 'HiUnack')]),
      R('Acknowledge', [[NO('I_Ack')]], [O('RST', 'HiUnack')]),
      R('0.5 s pulse generator', [[NC('Blink.Q')]], [O('TON', 'Blink', 'T#500ms')]),
      R('Flasher flip-flop', [[NO('Blink.Q'), NC('Flash')], [NC('Blink.Q'), NO('Flash')]], [O('COIL', 'Flash')]),
      R('Red: flash while unacknowledged, steady while active', [[NO('HiUnack'), NO('Flash')], [NO('HiActive'), NC('HiUnack')]], [O('COIL', 'Q_SL_Red')]),
      R('Horn until acknowledged', [[NO('HiUnack')]], [O('COIL', 'Q_SL_Horn')])]),
    hints: ['SET HiActive above 90 %, RST below 85 %. A P contact on HiActive SETs HiUnack; I_Ack RSTs it.', 'Pulse: NC Blink.Q → TON Blink T#500ms. Flip-flop rung toggles Flash on each pulse.', 'Red: (HiUnack AND Flash) OR (HiActive AND NC HiUnack).'] },
  L13: { starter: LDU('  Run  : BOOL;\n  Fifo : ARRAY[0..9] OF BOOL;\n  N    : INT;', []),
    solution: LDU('  Run       : BOOL;\n  Fifo      : ARRAY[0..9] OF BOOL;\n  N         : INT;\n  MetalSeen : BOOL;\n  Reject    : BOOL;\n  St        : INT;   (* 0 conveying, 10 extend, 20 retract *)', [
      R('Belt seal-in', [[NO('I_Start'), NO('I_Stop')], [NO('Run'), NO('I_Stop')]], [O('COIL', 'Run')]),
      R('Remember metal while the part is at the detector', [[NO('I_PE_Det'), NO('I_Metal')]], [O('SET', 'MetalSeen')]),
      R('Part leaves the detector: push the result into the FIFO', [[NE_('I_PE_Det'), CMP('N', '<=', '9')]], [O('ST', 'Fifo[N] := MetalSeen'), O('ADD', 'N', '1', 'N'), O('RST', 'MetalSeen')]),
      R('Part arrives at the pusher: take the oldest result', [[PE_('I_PE_Rej'), CMP('N', '>', '0')]], [O('MOV', 'Fifo[0]', 'Reject'), O('BSR', 'Fifo', 'FALSE'), O('SUB', 'N', '1', 'N')]),
      R('Metal → start a push', [[NO('Reject'), CMP('St', '=', '0')]], [O('MOV', '10', 'St'), O('RST', 'Reject')]),
      R('Extended → retract', [[CMP('St', '=', '10'), NO('I_Rej_Ext')]], [O('MOV', '20', 'St')]),
      R('Retracted → done', [[CMP('St', '=', '20'), NO('I_Rej_Ret')]], [O('MOV', '0', 'St')]),
      R('Belt stops while pushing', [[NO('Run'), CMP('St', '=', '0')]], [O('COIL', 'Q_C1_Run')]),
      R('', [[CMP('St', '=', '10')]], [O('COIL', 'Q_Rej_Ext')])]),
    hints: ['SET MetalSeen while I_PE_Det AND I_Metal. On the N (falling edge) of I_PE_Det: an ST box "Fifo[N] := MetalSeen", ADD N + 1 → N, RST MetalSeen.', 'On the P edge of I_PE_Rej: MOV Fifo[0] → Reject, BSR Fifo, SUB N − 1 → N. (MOV before BSR!)', 'A small step number St runs the pusher; the belt runs only while St = 0.'] },
  L14: { starter: { types: '(* Lesson 14 — declare PumpCtl here *)\nTYPE\nEND_TYPE\n', globals: 'VAR_GLOBAL\nEND_VAR\n', pous: [{ id: 'main', name: 'Main', lang: 'LD', rungs: [] }] },
    solution: Object.assign(LDU('  Pumps : ARRAY[1..3] OF PumpCtl;', [
      R('Pump 1 at demand ≥ 0.5', [[CMP('AI_Demand', '>=', '0.5')]], [O('COIL', 'Pumps[1].Cmd'), O('COIL', 'Q_P1_Run')]),
      R('Pump 2 at demand ≥ 1.5', [[CMP('AI_Demand', '>=', '1.5')]], [O('COIL', 'Pumps[2].Cmd'), O('COIL', 'Q_P2_Run')]),
      R('Pump 3 at demand ≥ 2.5', [[CMP('AI_Demand', '>=', '2.5')]], [O('COIL', 'Pumps[3].Cmd'), O('COIL', 'Q_P3_Run')]),
      R('Running feedback', [[NO('I_P1_Running')]], [O('COIL', 'Pumps[1].Running')]),
      R('', [[NO('I_P2_Running')]], [O('COIL', 'Pumps[2].Running')]),
      R('', [[NO('I_P3_Running')]], [O('COIL', 'Pumps[3].Running')]),
      R('Count starts', [[PE_('Pumps[1].Running')]], [O('ADD', 'Pumps[1].Starts', '1', 'Pumps[1].Starts')]),
      R('', [[PE_('Pumps[2].Running')]], [O('ADD', 'Pumps[2].Starts', '1', 'Pumps[2].Starts')]),
      R('', [[PE_('Pumps[3].Running')]], [O('ADD', 'Pumps[3].Starts', '1', 'Pumps[3].Starts')])]),
      { types: 'TYPE\n  PumpCtl : STRUCT\n    Cmd, Running : BOOL;\n    Starts       : INT;\n  END_STRUCT;\nEND_TYPE\n' }),
    hints: ['Data types: TYPE PumpCtl : STRUCT Cmd, Running : BOOL; Starts : INT; END_STRUCT; END_TYPE. Globals: Pumps : ARRAY[1..3] OF PumpCtl;', 'Contacts and coils accept member paths like Pumps[2].Cmd. Compare AI_Demand >= 1.5 → coils Pumps[2].Cmd and Q_P2_Run.', 'Count starts with a P contact on Pumps[i].Running driving ADD Pumps[i].Starts + 1 → Pumps[i].Starts.'] },
  L15: { starter: LDU('  TempSP : REAL := 45.0;', [R('Given: cold water flows through', [], [O('COIL', 'Q_In_Open'), O('COIL', 'Q_Out_Open')])]),
    solution: LDU('  TempSP : REAL := 45.0;\n  TIC    : PID := (KP := 12.0, TN := 40.0);', [
      R('Given: cold water flows through', [], [O('COIL', 'Q_In_Open'), O('COIL', 'Q_Out_Open')]),
      R('Temperature loop', [], [O('COIL', 'Q_H1_On'), O('ST', 'TIC(ACTUAL := AI_Temp, SETPOINT := TempSP)'), O('MOV', 'TIC.Y', 'AO_H1_Power')])]),
    hints: ['Declare TIC : PID := (KP := 10.0, TN := 40.0); in Globals. Ladder has no PID box here — call it from an ST instruction: TIC(ACTUAL := AI_Temp, SETPOINT := TempSP).', 'Then MOV TIC.Y → AO_H1_Power and a coil Q_H1_On on an always-true rung (a rung with no contacts).', 'Overshooting? Lower KP or lengthen TN. Slow? Raise KP.'] },
};
/* ───────────── Ladder versions of the background text (shown when a lesson is in Ladder) ───────────── */
const LDP = s => `<pre class="ldx">${s.replace(/^\n/, '')}</pre>`;
const LD_THEORY = {
  L01: `<p>A PLC reads every <b>input</b> into memory, runs your program top to bottom, then writes every <b>output</b>. That's one <i>scan</i>, repeated every few milliseconds. In ladder the program is a list of <b>rungs</b> between two power rails, solved left to right, top to bottom.</p>
    <p>A <b>normally open (NO)</b> contact <code>] [</code> passes power while its tag is TRUE. A pushbutton with an NO contact is TRUE while you hold it. A <b>coil</b> <code>( )</code> writes TRUE to its tag while power reaches it, and FALSE when it doesn't.</p>
    ${LDP(`
 |    I_Button                          Q_Light  |
 |----] [-------------------------------( )------|`)}
    <p>In the editor: <b>+ Rung</b>, click the contact to set its tag, and set the coil's tag on the right.</p>`,
  L02: `<p>Stop buttons are wired <b>normally closed (NC)</b>. With nothing pressed, current flows and the input is <b>TRUE</b>. Pressing the button <i>opens</i> the circuit, and so does a broken wire, a loose terminal or a blown fuse. Either way the input goes <b>FALSE</b>.</p>
    <p>Watch out for the double negative. The ladder <b>contact type</b> describes how the <i>PLC</i> looks at the tag, not how the field device is wired. An NC-wired stop button is TRUE when healthy, so you examine it with an <b>NO contact</b> <code>] [</code>: power flows while the button is not pressed.</p>
    ${LDP(`
 |    I_Stop   (NC-wired, TRUE = healthy)    Q_Ready  |
 |----] [------------------------------------( )------|`)}
    <p>Using an NC contact <code>]/[</code> here would light Ready only when the button is pressed or the wire is broken — the opposite of fail-safe.</p>
    <p><b>E-stops</b> are NC too, but an emergency stop is a <i>safety function</i>: it must work even if the PLC has crashed or been programmed wrong. So an E-stop is wired through a <b>safety relay</b> that removes power directly. That gets its own lesson after the seal-in.</p>`,
  L03: `<p>A momentary Start button must keep a motor running after it's released. The motor's own run bit is used as a contact in a <b>branch in parallel</b> with Start. That's the <b>seal-in</b> (holding) contact:</p>
    ${LDP(`
 |    I_Start        I_Stop                     Run  |
 |--+--] [--+--------] [-----------------------( )--|
 |  |  Run  |
 |  +--] [--+`)}
    <p>In the editor: put <code>I_Start</code> on the first row, add a <b>branch</b> with <code>Run</code>, then use the <b>＋</b> to the right of the branches to add <code>I_Stop</code> in series after them. Stop is in series with every path, so <b>Stop always wins</b>. (A latch <code>(S)</code> on Start with an unlatch <code>(R)</code> from Stop also works — but a seal-in drops out by itself on a power loss, which is why it is the standard.)</p>
    <p>The output turns on the contactor, but that doesn't prove the motor runs. An overload relay can trip. Use the starter's <b>auxiliary contact</b> (running feedback) for status lights.</p>`,
  L16: null,   // filled from the ST text below with a ladder rung
  L04: `<p>A reversing starter swaps two phases with a second contactor. If <b>FWD and REV</b> close together, the result is a phase-to-phase short. Real panels use a mechanical interlock, auxiliary-contact interlocks <i>and</i> PLC interlocks.</p>
    <p>Each direction gets its own seal-in rung, plus an <b>NC contact of the other direction</b> in series, so it can't start while the other is on:</p>
    ${LDP(`
 |    I_Fwd      I_Stop    Rev                 Fwd  |
 |--+--] [--+----] [------]/[-----------------( )--|
 |  |  Fwd  |
 |  +--] [--+
 |    I_Rev      I_Stop    Fwd                 Rev  |
 |--+--] [--+----] [------]/[-----------------( )--|
 |  |  Rev  |
 |  +--] [--+`)}
    <p>The operator must press Stop before reversing.</p>`,
  L05: `<p>An <b>on-delay timer (TON)</b> box turns its done bit <code>.Q</code> on after its rung has been TRUE for the preset time. If the rung goes FALSE, it resets. The elapsed time is in <code>.ET</code>.</p>
    ${LDP(`
 |    StartReq                       +-- TON ------+  |
 |----] [----------------------------| Timer: Warn |--|
 |                                   | Preset: T#3s|  |
 |                                   +-------------+  |
 |    Warn.Q                                Q_Conveyor |
 |----] [-----------------------------------( )-------|`)}
    <p>The timer rung must be solved <b>every scan</b> — don't put conditions in front of it that you don't mean as the timer's input. Use <code>Warn.Q</code> as a contact anywhere else. Pre-start warnings are required by safety standards on equipment that can start automatically.</p>`,
  L06: `<p>An <b>off-delay timer (TOF)</b> box turns <code>.Q</code> on immediately when its rung goes TRUE. When the rung goes FALSE, it keeps <code>.Q</code> on for the preset, then switches it off. That's the classic "run-on" for fans, lubrication pumps and conveyors clearing product.</p>
    ${LDP(`
 |    I_Heat                         +-- TOF --------+  |
 |----] [-------------+--------------| Timer: RunOn  |--|
 |                    |              | Preset: T#10s |  |
 |                    |              +---------------+  |
 |                    |                  Q_HeaterLamp   |
 |                    +--------------------( )----------|
 |    RunOn.Q                                  Q_Fan   |
 |----] [--------------------------------------( )-----|`)}
    <p>One rung can drive several outputs: add them with <b>+ output</b>.</p>`,
  L07: `<p>An <b>up counter (CTU)</b> box adds 1 to <code>.CV</code> each time its rung goes from FALSE to TRUE (a <b>rising edge</b>), and sets <code>.Q</code> when <code>CV ≥ preset</code>. A <b>RES</b> instruction on another rung resets it to zero.</p>
    ${LDP(`
 |    I_PE                           +-- CTU ---------+  |
 |----] [----------------------------| Counter: Batch |--|
 |                                   | Preset: 5      |  |
 |    I_Reset                        +----------------+  |
 |----] [------------------------------------( RES Batch )|`)}
    <p>A photoeye stays TRUE while a part blocks it. The counter only counts the edge, so one part counts as one. Use <code>Batch.Q</code> as an NC contact in the run rung to stop when the batch is complete.</p>`,
  L08: `<p>An input stays TRUE for many scans while a button is held. A <b>one-shot</b> — the <b>P</b> (positive transition) contact <code>]P[</code> — passes power for <b>exactly one scan</b> when its tag goes from FALSE to TRUE. Use it whenever an action must happen once per press: toggling, counting, stepping a sequence.</p>
    <p>The classic ladder toggle is a one-shot followed by a <b>flip-flop</b> rung:</p>
    ${LDP(`
 |    I_Button                                OneShot |
 |----]P[-------------------------------------( )-----|
 |    OneShot     Lamp                           Lamp |
 |--+--] [-------]/[--+--------------------------( )--|
 |  |  OneShot     Lamp |
 |  +--]/[-------] [--+`)}
    <p>Without the one-shot, the lamp would flicker on and off every scan while the button is held.</p>`,
  L09: `<p>Most transmitters send <b>4–20 mA</b>: 4 mA is 0 % of range, 20 mA is 100 %. The live zero at 4 mA lets you tell "empty" (4 mA) from a <b>broken wire</b> (0 mA). Under NAMUR NE43, below 3.6–3.8 mA means a fault.</p>
    <p>In ladder, scaling uses <b>math boxes</b> on an always-true rung (a rung with no contacts), and <b>compare contacts</b> for limits:</p>
    ${LDP(`
 |                      +-- SUB ------+   +-- MUL --------+  |
 |----------------------| mA - 4.0    |---| Level × 6.25  |--|
 |                      | → Level     |   | → Level       |  |
 |                      +-------------+   +---------------+  |
 |    [ mA < 3.8 ]                                   TxFault |
 |----] [------------------------------------------( )-------|`)}
    <p>(16 mA span → 100 %, so the factor is 100 / 16 = 6.25.) On a fault the controller must fail <b>safe</b>: here, stop filling, because the level is unknown.</p>`,
  L10: `<p>Opening a valve at "level &lt; 50" and closing it at "level ≥ 50" makes it cycle on every ripple. That's called <b>chattering</b>, and it wears out valves. Use two thresholds (<b>hysteresis</b>, a deadband): start filling at the low limit and stop at the high limit.</p>
    <p>In ladder that's a <b>latch / unlatch</b> pair driven by compare contacts:</p>
    ${LDP(`
 |    [ Level <= 40.0 ]                        Filling |
 |----] [------------------------------------( S )------|
 |    [ Level >= 60.0 ]                        Filling |
 |----] [------------------------------------( R )------|
 |    Filling                                Q_Fill   |
 |----] [------------------------------------( )--------|`)}`,
  L11: `<p>Machines run in <b>steps</b>. Keep the step number in an INT and give every transition its own rung: <b>compare</b> the current step, AND the transition condition, then <b>MOV</b> the next step number in. Outputs get their own rungs, driven from the step number. That makes the logic easy to read and to troubleshoot (the HMI can show "Step 20").</p>
    ${LDP(`
 |    [ Step = 0 ]   I_Start                 +-- MOV ----+  |
 |----] [------------] [---------------------| 10 → Step |--|
 |                                           +-----------+  |
 |    [ Step = 10 ]  [ Level >= 70.0 ]       +-- MOV ----+  |
 |----] [------------] [---------------------| 20 → Step |--|
 |                                           +-----------+  |
 |    [ Step = 10 ]                                 Q_Fill |
 |----] [-------------------------------------------( )----|`)}
    <p>A timer that belongs to a step goes on its own rung with the compare as its input, e.g. <code>[ Step = 20 ] → TON MixTmr</code>. Watch the rung order: a transition taken early in the scan is seen by the rungs below it in the same scan.</p>`,
  L12: `<p>An alarm has two independent states: <b>active</b> (the condition is true now) and <b>unacknowledged</b> (no operator has seen it yet). The standard light sequence is:</p>
    <ul><li><b>Flashing</b>: new and unacknowledged.</li><li><b>Steady</b>: active and acknowledged.</li><li><b>Off</b>: cleared and acknowledged.</li></ul>
    <p>A <b>deadband</b> (latch above the limit, unlatch a little below) stops the alarm from toggling. A <code>]P[</code> one-shot on the active bit latches "unacknowledged"; the Ack button unlatches it. The horn follows "unacknowledged".</p>
    <p>A <b>flasher</b> is a timer that resets itself, plus a flip-flop:</p>
    ${LDP(`
 |    Blink.Q                         +-- TON ---------+  |
 |----]/[-----------------------------| Timer: Blink   |--|
 |                                    | Preset: T#500ms|  |
 |                                    +----------------+  |
 |    Blink.Q     Flash                           Flash   |
 |--+--] [-------]/[--+---------------------------( )-----|
 |  |  Blink.Q     Flash |
 |  +--]/[-------] [--+`)}`,
  L13: `<p>A sensor rarely sits where the action happens. Here a metal detector is 1.85 m upstream of the reject pusher, with several parts in between. The PLC must remember each part's result and use it when <i>that</i> part arrives: this is <b>tracking</b>.</p>
    <p>When parts are counted at both ends, a <b>FIFO</b> made from a BOOL array does it. In ladder:</p>
    <ul><li>Part <b>leaves</b> the detector — a <code>]N[</code> (falling edge) on its photoeye: store the result with an <b>ST</b> instruction <code>Fifo[N] := MetalSeen</code>, then <b>ADD</b> N + 1 → N.</li>
    <li>Part <b>arrives</b> at the pusher — a <code>]P[</code> on that photoeye: <b>MOV</b> <code>Fifo[0]</code> → Reject, then <b>BSR</b> on Fifo (shifts every element one place toward index 0), then <b>SUB</b> N − 1 → N.</li></ul>
    ${LDP(`
 |    I_PE_Rej    [ N > 0 ]      +-- MOV -----------+ +-- BSR ----+ +-- SUB -------+  |
 |----]P[---------] [------------| Fifo[0] → Reject |-| Fifo      |-| N - 1 → N    |--|
 |                               +------------------+ +-----------+ +--------------+  |`)}
    <p>Order matters: MOV before BSR. For fixed-pitch (indexing) machines, a <b>BSL</b> on every index does the same job.</p>`,
  L14: `<p>A <b>user-defined type (UDT)</b> groups everything about one piece of equipment, so three pumps are an <code>ARRAY[1..3] OF PumpCtl</code> instead of a dozen loose tags. HMIs, alarms and code all use the same shape.</p>
    <pre>TYPE PumpCtl : STRUCT
  Cmd, Running : BOOL;
  Starts       : INT;
END_STRUCT; END_TYPE</pre>
    <p>The type goes in <b>Data types</b> and the array in <b>Globals</b> — declarations are text in every IEC 61131-3 tool, ladder included. In the rungs, contacts, coils and boxes accept member paths:</p>
    ${LDP(`
 |    [ AI_Demand >= 1.5 ]                    Pumps[2].Cmd |
 |----] [------------------------------+------( )----------|
 |                                     |       Q_P2_Run    |
 |                                     +------( )----------|
 |    Pumps[2].Running            +-- ADD ---------------+  |
 |----]P[-------------------------| Pumps[2].Starts + 1  |--|
 |                                +----------------------+  |`)}
    <p>Ladder has no FOR loop, so you write one rung per pump (or call an ST routine for the loop).</p>`,
  L15: `<p>On/off control overshoots and cycles. A <b>PID</b> controller sets a continuous output from the error:</p>
    <ul><li><b>P</b> reacts to the error now.</li><li><b>I</b> removes the steady offset.</li><li><b>D</b> damps fast changes.</li></ul>
    <p>This ladder editor has no PID box, so the loop is called from an <b>ST</b> instruction on an always-true rung — the same as a PIDE/PID instruction in a real ladder routine — and the output is moved to the analog output:</p>
    ${LDP(`
 |                      +-- ST ----------------------------------------+  |
 |----------------------| TIC(ACTUAL := AI_Temp, SETPOINT := TempSP)  |--|
 |                      +----------------------------------------------+  |
 |                      +-- MOV --------------------+                     |
 |----------------------| TIC.Y → AO_H1_Power       |---------------------|
 |                      +---------------------------+                     |`)}
    <p>Tuning workflow:</p>
    <ol><li>Start with P only and raise <code>KP</code> until the response is quick but not oscillating.</li><li>Add integral: start <code>TN</code> around the process time constant and shorten it until the offset goes away without overshoot.</li></ol>
    <p>Use the Trend tab (pens <code>AI_Temp</code>, <code>TempSP</code>, <code>TIC.Y</code>). In this tank, cold water flows through constantly, so the heater must work all the time.</p>`,
};

for (const x of LESSONS) {
  const l = LADDER[x.id];
  x.ld = { starter: l.starter, solution: l.solution || (x.solution.pous[0].lang === 'LD' ? x.solution : null), hints: l.hints };
  x.ld.theory = LD_THEORY[x.id] || (x.id === 'L16' ? x.theory.replace('<pre>Run := (I_Start OR Run) AND I_Stop AND I_SR1_OK;</pre>', LDP(`
 |    I_Start      I_Stop    I_SR1_OK                 Run  |
 |--+--] [--+------] [-------] [----------------------( )--|
 |  |  Run  |
 |  +--] [--+`)) : x.theory);
  if (x.solution.pous[0].lang === 'LD') {       // L03: the main solution is ladder — give ST learners an ST one
    x.ld.solution = x.solution;
    x.solution = ST('VAR\n  Run : BOOL;\nEND_VAR\nRun := (I_Start OR Run) AND I_Stop;\nQ_M1_Run := Run;\nQ_RunLamp := I_M1_Running;   (* aux contact, not the command *)\n');
  }
}

module.exports = { LESSONS };
