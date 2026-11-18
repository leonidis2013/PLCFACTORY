'use strict';
/* 3.0 curriculum additions. Each lesson carries ST and ladder versions directly (st*, ld*). Theory is
   language-neutral prose plus a short per-language tip, so the guidance always matches the editor. */

const C = (id, type, name, x, y, props = {}, rot = 0) => ({ id, type, name, x, y, rot, props });
const DI = (tag, signal, contact = 'NO', desc = '') => ({ id: 's_' + tag, tag, type: 'discrete', signal, contact, fault: 'none', desc });
const AI = (tag, signal, lo, hi, extra = {}) => Object.assign({ id: 's_' + tag, tag, type: 'analog', signal, lo, hi, scale: 'eng', noise: 0.1, fault: 'none' }, extra);
const PE = (tag, signal, pos, desc = '') => ({ id: 's_' + tag, tag, type: 'probe', signal, pos, contact: 'NO', fault: 'none', desc });
const ST = (src, globals = '') => ({ types: '', globals, pous: [{ id: 'main', name: 'Main', lang: 'ST', src }] });
const fail = (cond, msg) => (cond ? true : msg);
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const IO_NOTE = io => `<table class="io"><tr><th>Tag</th><th>Meaning</th></tr>${io.map(([t, d]) => `<tr><td><code>${t}</code></td><td>${d}</td></tr>`).join('')}</table>`;

const NO = a => ({ t: 'NO', a }), NC = a => ({ t: 'NC', a }), PE_ = a => ({ t: 'P', a }), NE_ = a => ({ t: 'N', a });
const CMP = (a, op, b) => ({ t: 'CMP', a, op, b });
const O = (t, a, b, c) => Object.assign({ t, a }, b !== undefined ? { b } : {}, c !== undefined ? { c } : {});
const R = (comment, rows, outs) => ({ comment, rows, outs });
const VG = s => (s ? `VAR_GLOBAL\n${s}\nEND_VAR\n` : '');
const LDU = (globals, rungs, types = '') => ({ types, globals: VG(globals), pous: [{ id: 'main', name: 'Main', lang: 'LD', rungs }] });
const tip = (st, ld) => ({ st: `<p class="tip"><b>In Structured Text:</b> ${st}</p>`, ld: `<p class="tip"><b>In ladder:</b> ${ld}</p>` });
const edges = (h, fn, sec) => { let n = 0, last = !!fn(); h.watch(() => { const v = !!fn(); if (v && !last) n++; last = v; }); h.run(sec); return n; };

/* A lesson: { id, module, title, minutes, summary, theory, tips, task, layout, sensors, objectives,
     st: { starter, solution, hints }, ld: { starter, solution, hints }, capstone?, powerUpOK?, tabs? } */
const NEW = [
  // ═════════════════════════ Fundamentals ═════════════════════════
  {
    id: 'F01', module: 'fund', title: 'Logic gates: a two-way light switch', minutes: 8,
    summary: 'AND, OR and XOR from two switches, the way a hallway light works.',
    theory: `<p>Every PLC decision is built from three operations: <b>AND</b> (all conditions true), <b>OR</b> (any condition true) and <b>NOT</b> (invert). <b>XOR</b> (exclusive OR) is true when exactly one input is true. It's the logic of a hallway light with a switch at each end: flipping <i>either</i> switch changes the light.</p>
      <p>A <b>maintained</b> switch stays where you put it, unlike a momentary pushbutton that springs back.</p>`,
    tips: tip('<code>Q_Hall := I_SW1 XOR I_SW2;</code> — AND, OR and NOT work the same way.',
      'Contacts in <b>series</b> make AND, contacts in <b>parallel</b> (a branch) make OR, and an <b>NC (XIO)</b> contact makes NOT. XOR is two branches: SW1 AND NOT SW2, or NOT SW1 AND SW2.'),
    task: `Two maintained switches <b>SW1</b> and <b>SW2</b>. The <b>Hall</b> light toggles whenever either switch is flipped (XOR). <b>Both</b> lights when both switches are on (AND). <b>Any</b> lights when at least one is on (OR).` +
      IO_NOTE([['I_SW1, I_SW2', 'Maintained switches (TRUE = on)'], ['Q_Hall', 'Hall light (XOR)'], ['Q_Both', 'Both on (AND)'], ['Q_Any', 'Any on (OR)']]),
    layout: { components: [C('s1', 'pushbutton', 'SW1', -1.4, -1, { color: 'white', latch: true }), C('s2', 'pushbutton', 'SW2', -0.8, -1, { color: 'white', latch: true }),
      C('hl', 'pilot', 'Hall', 0, -1, { color: 'amber' }), C('bl', 'pilot', 'Both', 0.6, -1, { color: 'green' }), C('al', 'pilot', 'Any', 1.2, -1, { color: 'blue' })] },
    sensors: [DI('I_SW1', 's1.pressed'), DI('I_SW2', 's2.pressed')],
    st: { starter: ST('(* Two-way switch *)\n\n'),
      solution: ST('Q_Hall := I_SW1 XOR I_SW2;\nQ_Both := I_SW1 AND I_SW2;\nQ_Any  := I_SW1 OR I_SW2;\n'),
      hints: ['Three assignments, one per light.', 'Q_Hall := I_SW1 XOR I_SW2;  Q_Both := I_SW1 AND I_SW2;  Q_Any := I_SW1 OR I_SW2;'] },
    ld: { starter: LDU('', []),
      solution: LDU('', [
        R('XOR: exactly one switch on', [[NO('I_SW1'), NC('I_SW2')], [NC('I_SW1'), NO('I_SW2')]], [O('COIL', 'Q_Hall')]),
        R('AND: series', [[NO('I_SW1'), NO('I_SW2')]], [O('COIL', 'Q_Both')]),
        R('OR: parallel', [[NO('I_SW1')], [NO('I_SW2')]], [O('COIL', 'Q_Any')])]),
      hints: ['Series contacts = AND, a branch = OR. Use one rung per light.', 'Hall: branch 1 = NO SW1 + NC SW2, branch 2 = NC SW1 + NO SW2.'] },
    objectives: [
      { id: 'off', text: 'All lights off with both switches off', test: h => { h.run(0.3); return fail(!h.out('Q_Hall') && !h.out('Q_Both') && !h.out('Q_Any'), 'A light is on with both switches off'); } },
      { id: 'one', text: 'One switch on: Hall and Any on, Both off', test: h => { h.tap('SW2'); return fail(h.out('Q_Hall') && h.out('Q_Any') && !h.out('Q_Both'), 'Expected Hall + Any on, Both off'); } },
      { id: 'two', text: 'Both switches on: Hall off, Both and Any on', test: h => { h.tap('SW1').tap('SW2'); return fail(!h.out('Q_Hall') && h.out('Q_Any') && h.out('Q_Both'), 'Expected Hall off, Both + Any on'); } },
      { id: 'toggle', text: 'Flipping either switch always toggles the Hall light', test: h => {
        let ok = true, last = !!h.run(0.2).out('Q_Hall');
        for (const s of ['SW1', 'SW2', 'SW2', 'SW1', 'SW2']) { h.tap(s); const v = !!h.out('Q_Hall'); if (v === last) ok = false; last = v; }
        return fail(ok, 'The Hall light did not change on one of the flips'); } },
    ],
  },
  {
    id: 'F02', module: 'fund', title: 'Jog versus run', minutes: 10,
    summary: 'A jog button that moves the motor only while held — and never seals in.',
    theory: `<p>Maintenance and setup need to <b>jog</b> a machine: move it only while a button is held. A jog must <b>never seal in</b>. If it did, letting go of Jog would leave the machine running, which is exactly what the operator didn't expect.</p>
      <p>The trick is to seal in on an internal <b>run</b> bit fed only by Start, and drive the motor from <i>run OR jog</i>. Never seal in on the output itself.</p>`,
    tips: tip('<code>Run := (I_Start OR Run) AND I_Stop;</code> then <code>Q_M1_Run := Run OR (I_Jog AND I_Stop);</code>',
      'Rung 1: the usual seal-in on an internal bit <code>Run</code>. Rung 2: a branch of NO <code>Run</code> and (NO <code>I_Jog</code> + NO <code>I_Stop</code>) drives the motor coil.'),
    task: `<b>Start</b> runs M1 and it keeps running. <b>Jog</b> runs M1 only while held. <b>Stop</b> stops it and also blocks jogging.` +
      IO_NOTE([['I_Start', 'Start (NO)'], ['I_Stop', 'Stop (NC): TRUE = not pressed'], ['I_Jog', 'Jog (NO)'], ['Q_M1_Run', 'M1 contactor']]),
    layout: { components: [C('st', 'pushbutton', 'Start', -1.6, -1.2, { color: 'green' }), C('sp', 'pushbutton', 'Stop', -1.0, -1.2, { color: 'red' }),
      C('jg', 'pushbutton', 'Jog', -0.4, -1.2, { color: 'black' }), C('m1', 'motor', 'M1', 1, 0.6, { amps: 6 })] },
    sensors: [DI('I_Start', 'st.pressed'), DI('I_Stop', 'sp.pressed', 'NC'), DI('I_Jog', 'jg.pressed')],
    st: { starter: ST('(* Jog and run *)\nVAR\n  Run : BOOL;\nEND_VAR\n\n'),
      solution: ST('VAR\n  Run : BOOL;\nEND_VAR\nRun := (I_Start OR Run) AND I_Stop;\nQ_M1_Run := Run OR (I_Jog AND I_Stop);\n'),
      hints: ['Seal in on Run, not on Q_M1_Run.', 'Q_M1_Run := Run OR (I_Jog AND I_Stop);'] },
    ld: { starter: LDU('  Run : BOOL;', []),
      solution: LDU('  Run : BOOL;', [
        R('Run seal-in (Start only)', [[NO('I_Start'), NO('I_Stop')], [NO('Run'), NO('I_Stop')]], [O('COIL', 'Run')]),
        R('Motor: run, or jog while held', [[NO('Run')], [NO('I_Jog'), NO('I_Stop')]], [O('COIL', 'Q_M1_Run')])]),
      hints: ['Rung 1: seal-in on Run (Start in parallel with Run, Stop in series).', 'Rung 2: NO Run in parallel with (NO I_Jog, NO I_Stop) → Q_M1_Run.'] },
    objectives: [
      { id: 'jog', text: 'Jog runs M1 only while held', test: h => { h.press('Jog').run(0.6); if (!h.out('Q_M1_Run')) return 'M1 did not run while Jog was held'; h.release('Jog').run(0.4); return fail(!h.out('Q_M1_Run'), 'M1 kept running after Jog was released — the jog sealed in'); } },
      { id: 'start', text: 'Start runs M1 continuously', test: h => { h.tap('Start'); return fail(h.always(() => h.out('Q_M1_Run'), 3), 'M1 stopped by itself'); } },
      { id: 'stop', text: 'Stop stops M1', test: h => { h.tap('Start').run(1).tap('Stop'); return fail(!h.out('Q_M1_Run'), 'M1 kept running'); } },
      { id: 'jogstop', text: 'Jog does nothing while Stop is held', test: h => { h.press('Stop').press('Jog').run(0.5); const on = h.out('Q_M1_Run'); h.release('Jog').release('Stop'); return fail(!on, 'M1 jogged with Stop pressed'); } },
    ],
  },
  {
    id: 'F03', module: 'fund', capstone: true, title: 'Capstone: conveyor drive station', minutes: 20,
    summary: 'Start/stop, jog, running lamp from the aux contact, overload trip and no auto-restart.',
    theory: `<p>A real motor starter combines everything from this module:</p>
      <ul><li>A <b>seal-in</b> for run, plus a <b>jog</b> that never seals.</li><li>An <b>auxiliary contact</b> on the contactor that proves the motor really runs. The run lamp shows that, not the PLC command.</li>
      <li>A <b>thermal overload relay</b>. Its NC contact is wired to the PLC (TRUE = healthy). When it trips, the motor stops and the run latch must drop. After the overload is reset by hand, the motor must <b>not</b> restart until someone presses Start again.</li></ul>`,
    tips: tip('Put <code>I_M1_OL</code> in series with both the seal-in and the jog.', 'Add an NO <code>I_M1_OL</code> contact (healthy = TRUE) in series in the Run rung and in the jog branch; an NC <code>I_M1_OL</code> drives the fault lamp.'),
    task: `Build the drive station for motor <b>M1</b>: <b>Start</b>/<b>Stop</b> seal-in, <b>Jog</b> while held, <b>RunLamp</b> from the aux contact, <b>Fault</b> lamp while the overload is tripped. An overload stops M1, and after the overload is reset M1 stays off until Start.` +
      IO_NOTE([['I_Start / I_Stop / I_Jog', 'Buttons (Stop NC)'], ['I_M1_Running', 'Aux contact: TRUE = really running'], ['I_M1_OL', 'Overload relay NC contact: TRUE = healthy'], ['Q_M1_Run', 'M1 contactor'], ['Q_RunLamp / Q_Fault', 'Green and red pilots']]) +
      `<p class="small muted">To test: use the Plant tab's fault list to jam M1, then reset its overload relay.</p>`,
    layout: { components: [C('st', 'pushbutton', 'Start', -1.8, -1.2, { color: 'green' }), C('sp', 'pushbutton', 'Stop', -1.2, -1.2, { color: 'red' }),
      C('jg', 'pushbutton', 'Jog', -0.6, -1.2, { color: 'black' }), C('rl', 'pilot', 'RunLamp', 0.1, -1.2, { color: 'green' }), C('fl', 'pilot', 'Fault', 0.7, -1.2, { color: 'red' }),
      C('m1', 'motor', 'M1', 1, 0.6, { amps: 10 })] },
    sensors: [DI('I_Start', 'st.pressed'), DI('I_Stop', 'sp.pressed', 'NC'), DI('I_Jog', 'jg.pressed'), DI('I_M1_Running', 'm1.running'), DI('I_M1_OL', 'm1.ol', 'NC', 'Overload relay (NC)')],
    st: { starter: ST('(* Capstone — conveyor drive station *)\nVAR\n  Run : BOOL;\nEND_VAR\n\n'),
      solution: ST('VAR\n  Run : BOOL;\nEND_VAR\nRun := (I_Start OR Run) AND I_Stop AND I_M1_OL;\nQ_M1_Run := (Run OR I_Jog) AND I_Stop AND I_M1_OL;\nQ_RunLamp := I_M1_Running;\nQ_Fault := NOT I_M1_OL;\n'),
      hints: ['Start from F02 and add I_M1_OL in series — both in the seal-in and the motor output.', 'Q_RunLamp := I_M1_Running;  Q_Fault := NOT I_M1_OL;'] },
    ld: { starter: LDU('  Run : BOOL;', []),
      solution: LDU('  Run : BOOL;', [
        R('Run seal-in, dropped by Stop or overload', [[NO('I_Start')], [NO('Run')]], [O('COIL', 'Run')]),
        R('Motor: run or jog', [[NO('Run')], [NO('I_Jog')]], [O('COIL', 'Q_M1_Run')]),
        R('Running lamp from the aux contact', [[NO('I_M1_Running')]], [O('COIL', 'Q_RunLamp')]),
        R('Overload lamp', [[NC('I_M1_OL')]], [O('COIL', 'Q_Fault')])].map((r, i) => (i < 2 ? Object.assign(r, { post: [NO('I_Stop'), NO('I_M1_OL')] }) : r))),
      hints: ['Branches on the left (Start OR Run; Run OR Jog), then Stop and the overload in series after the branch.', 'RunLamp: NO I_M1_Running. Fault: NC I_M1_OL.'] },
    objectives: [
      { id: 'run', text: 'Start runs M1; RunLamp comes from the aux contact', test: h => { h.tap('Start').run(1.5); return fail(h.out('Q_M1_Run') && h.out('Q_RunLamp'), 'M1 or RunLamp not on'); } },
      { id: 'jog', text: 'Jog runs M1 only while held', test: h => { h.press('Jog').run(0.5); const a = h.out('Q_M1_Run'); h.release('Jog').run(0.3); return fail(a && !h.out('Q_M1_Run'), 'Jog did not work or it sealed in'); } },
      { id: 'stop', text: 'Stop stops M1', test: h => { h.tap('Start').run(1).tap('Stop'); return fail(!h.out('Q_M1_Run'), 'M1 kept running'); } },
      { id: 'ol', text: 'Overload: M1 stops and Fault lights', test: h => { h.tap('Start').run(1); h.fault('m1.jam').run(5); return fail(!h.out('Q_M1_Run') && h.out('Q_Fault'), 'Expected M1 off and Fault on after the overload tripped'); } },
      { id: 'norestart', text: 'After the overload is reset, M1 stays off until Start', test: h => {
        h.tap('Start').run(1); h.fault('m1.jam').run(5); h.fault('m1.jam', false); h.ctl('M1', 'reset').run(0.2);
        if (!h.always(() => !h.out('Q_M1_Run'), 3)) return 'M1 restarted by itself after the overload reset';
        if (h.out('Q_Fault')) return 'Fault lamp still on after reset';
        h.tap('Start').run(1); return fail(h.out('Q_M1_Run'), 'Start did not restart M1'); } },
    ],
  },

  // ═════════════════════════ Ladder & ST core ═════════════════════════
  {
    id: 'K01', module: 'core', title: 'TP: a fixed lubrication shot', minutes: 8,
    summary: 'A pulse timer gives exactly 2 s of pump, however long the button is held.',
    theory: `<p>A <b>pulse timer (TP)</b> switches <code>Q</code> on at a rising edge of its input and keeps it on for exactly the preset time, no matter what the input does meanwhile. Holding the button longer doesn't stretch the pulse, and pressing again mid-pulse doesn't restart it.</p>
      <p>Typical uses: lubrication shots, a fixed-length horn, pulsing a solenoid.</p>`,
    tips: tip('<code>Shot(IN := I_Lube, PT := T#2s);</code> — then use <code>Shot.Q</code>.', 'A <b>TP</b> box on the rung with NO <code>I_Lube</code> (instance Shot, preset T#2s); NO <code>Shot.Q</code> drives the pump and lamp.'),
    task: `Each press of <b>Lube</b> runs the pump <b>LubePump</b> for exactly <b>2 s</b>, and the <b>Busy</b> lamp shows it. Holding the button longer doesn't extend the shot.` +
      IO_NOTE([['I_Lube', 'Lube button (NO)'], ['Q_LubePump_Run', 'Lubrication pump'], ['Q_Busy', 'Busy lamp']]),
    layout: { components: [C('lb', 'pushbutton', 'Lube', -1.2, -1.2, { color: 'blue' }), C('bz', 'pilot', 'Busy', -0.5, -1.2, { color: 'amber' }), C('lp', 'motor', 'LubePump', 1, 0.6, { amps: 1.5 })] },
    sensors: [DI('I_Lube', 'lb.pressed')],
    st: { starter: ST('(* Lubrication shot *)\nVAR\n  Shot : TP;\nEND_VAR\n\n'),
      solution: ST('VAR\n  Shot : TP;\nEND_VAR\nShot(IN := I_Lube, PT := T#2s);\nQ_LubePump_Run := Shot.Q;\nQ_Busy := Shot.Q;\n'),
      hints: ['Call the TP every scan: Shot(IN := I_Lube, PT := T#2s);', 'Q_LubePump_Run := Shot.Q;  Q_Busy := Shot.Q;'] },
    ld: { starter: LDU('  Shot : TP;', []),
      solution: LDU('  Shot : TP;', [R('2 s pulse per press', [[NO('I_Lube')]], [O('TP', 'Shot', 'T#2s')]), R('', [[NO('Shot.Q')]], [O('COIL', 'Q_LubePump_Run'), O('COIL', 'Q_Busy')])]),
      hints: ['A TP box (instance Shot, preset T#2s) on NO I_Lube.', 'NO Shot.Q drives both coils.'] },
    objectives: [
      { id: 'tap', text: 'A short press gives a 2 s (±0.2 s) shot', test: h => { h.press('Lube').run(0.2); if (!h.out('Q_LubePump_Run')) return 'Pump did not start'; h.release('Lube'); const t = h.until(() => !h.out('Q_LubePump_Run'), 5); return fail(t > 0 && near(t + 0.2, 2, 0.2), t < 0 ? 'Pump never stopped' : `Shot lasted ${(t + 0.2).toFixed(2)} s`); } },
      { id: 'hold', text: 'Holding Lube for 5 s still gives only 2 s', test: h => { h.press('Lube').run(3); const on = h.out('Q_LubePump_Run'); h.release('Lube'); return fail(!on, 'Pump was still running 3 s into a held press'); } },
      { id: 'busy', text: 'Busy lamp shows the shot', test: h => { h.tap('Lube'); return fail(h.out('Q_Busy'), 'Busy off during the shot'); } },
    ],
  },
  {
    id: 'K02', module: 'core', title: 'Flasher: two timers in a loop', minutes: 10,
    summary: 'Make a 1 Hz alarm beacon from two on-delay timers that reset each other.',
    theory: `<p>Many PLCs have no flasher instruction. The classic recipe is two <b>TON</b>s in a loop: timer A runs while timer B is <i>not</i> done. When A finishes it starts B. When B finishes it resets A, which in turn resets B, and the cycle repeats. The lamp follows "A not done", so it's on for A's time and off for B's.</p>`,
    tips: tip('<code>TOn(IN := I_Alarm_P1 AND NOT TOff.Q, PT := T#500ms); TOff(IN := TOn.Q, PT := T#500ms);</code>', 'Rung 1: NO Alarm + NC <code>TOff.Q</code> → TON TOn. Rung 2: NO <code>TOn.Q</code> → TON TOff. Rung 3: NO Alarm + NC <code>TOn.Q</code> → beacon.'),
    task: `While selector <b>Alarm</b> is ON, the red <b>Beacon</b> flashes 0.5 s on / 0.5 s off. While it's OFF, the beacon is dark and the green <b>Normal</b> lamp is on.` +
      IO_NOTE([['I_Alarm_P1', 'Alarm selector ON'], ['Q_Beacon', 'Red beacon'], ['Q_Normal', 'Green lamp']]),
    layout: { components: [C('sw', 'selector', 'Alarm', -1, -1, { positions: '2', labels: 'OFF,ON' }), C('bc', 'pilot', 'Beacon', -0.2, -1, { color: 'red' }), C('nm', 'pilot', 'Normal', 0.4, -1, { color: 'green' })] },
    sensors: [DI('I_Alarm_P1', 'sw.p1')],
    st: { starter: ST('(* Flasher *)\nVAR\n  TOn  : TON;\n  TOff : TON;\nEND_VAR\n\n'),
      solution: ST('VAR\n  TOn  : TON;\n  TOff : TON;\nEND_VAR\nTOn(IN := I_Alarm_P1 AND NOT TOff.Q, PT := T#500ms);\nTOff(IN := TOn.Q, PT := T#500ms);\nQ_Beacon := I_Alarm_P1 AND NOT TOn.Q;\nQ_Normal := NOT I_Alarm_P1;\n'),
      hints: ['TOn runs while the alarm is on and TOff is not done; TOff runs while TOn is done.', 'Q_Beacon := I_Alarm_P1 AND NOT TOn.Q;'] },
    ld: { starter: LDU('  TOn  : TON;\n  TOff : TON;', []),
      solution: LDU('  TOn  : TON;\n  TOff : TON;', [
        R('On-time timer, reset by the off-time timer', [[NO('I_Alarm_P1'), NC('TOff.Q')]], [O('TON', 'TOn', 'T#500ms')]),
        R('Off-time timer', [[NO('TOn.Q')]], [O('TON', 'TOff', 'T#500ms')]),
        R('Beacon on during the on-time', [[NO('I_Alarm_P1'), NC('TOn.Q')]], [O('COIL', 'Q_Beacon')]),
        R('', [[NC('I_Alarm_P1')]], [O('COIL', 'Q_Normal')])]),
      hints: ['Two TON boxes. The first is blocked by an NC contact of the second\'s .Q.', 'Beacon: NO I_Alarm_P1 + NC TOn.Q.'] },
    objectives: [
      { id: 'rate', text: 'Beacon flashes about once per second (8–11 flashes in 10 s)', test: h => { h.select('Alarm', 1); const n = edges(h, () => h.out('Q_Beacon'), 10); return fail(n >= 8 && n <= 11, `${n} flashes in 10 s`); } },
      { id: 'duty', text: 'Roughly equal on and off time', test: h => { h.select('Alarm', 1); let on = 0, all = 0; h.watch(() => { all++; if (h.out('Q_Beacon')) on++; }); h.run(10); const d = on / all; return fail(d > 0.35 && d < 0.65, `On ${(d * 100).toFixed(0)} % of the time`); } },
      { id: 'off', text: 'Alarm OFF: beacon dark, Normal on', test: h => { h.select('Alarm', 1).run(3).select('Alarm', 0); return fail(h.always(() => !h.out('Q_Beacon') && h.out('Q_Normal'), 3), 'Beacon lit or Normal off with the alarm OFF'); } },
    ],
  },
  {
    id: 'K03', module: 'core', title: 'Counting up and down: a car park', minutes: 14,
    summary: 'Edge-triggered ADD and SUB keep a live count with a full sign.',
    theory: `<p>Counting with math instructions gives full control: add one on the <b>rising edge</b> of the entry sensor, subtract one on the rising edge of the exit sensor, and guard against going below zero. Without the edge, a car standing on the sensor would be counted on every scan, 20 times a second.</p>`,
    tips: tip('Use two <code>R_TRIG</code> blocks, then <code>IF InEdge.Q THEN Count := Count + 1; END_IF;</code>', 'A <b>P</b> (positive transition) contact on the sensor in front of an <b>ADD</b> box (Count + 1 → Count). For the exit, add a compare contact <code>Count &gt; 0</code> before the SUB.'),
    task: `The car park has <b>5</b> spaces. Each car passing <b>In</b> adds one, each passing <b>Out</b> subtracts one (never below 0). <b>Full</b> (red) is on with 5 or more cars, <b>Free</b> (green) otherwise. Keep the count in an INT named <code>Count</code>.` +
      IO_NOTE([['I_In', 'Entry loop sensor (TRUE while a car is on it)'], ['I_Out', 'Exit loop sensor'], ['Q_Full / Q_Free', 'Signs']]),
    layout: { components: [C('in', 'pushbutton', 'In', -1.4, -1, { color: 'white' }), C('ou', 'pushbutton', 'Out', -0.8, -1, { color: 'white' }), C('fu', 'pilot', 'Full', 0, -1, { color: 'red' }), C('fr', 'pilot', 'Free', 0.6, -1, { color: 'green' })] },
    sensors: [DI('I_In', 'in.pressed'), DI('I_Out', 'ou.pressed')],
    st: { starter: ST('(* Car park *)\nVAR\n  Count : INT;\nEND_VAR\n\n'),
      solution: ST('VAR\n  Count : INT;\n  InEdge, OutEdge : R_TRIG;\nEND_VAR\nInEdge(CLK := I_In);\nOutEdge(CLK := I_Out);\nIF InEdge.Q THEN Count := Count + 1; END_IF;\nIF OutEdge.Q AND Count > 0 THEN Count := Count - 1; END_IF;\nQ_Full := Count >= 5;\nQ_Free := NOT Q_Full;\n'),
      hints: ['R_TRIG gives a one-scan pulse on each rising edge.', 'IF OutEdge.Q AND Count > 0 THEN Count := Count - 1; END_IF;  Q_Full := Count >= 5;'] },
    ld: { starter: LDU('  Count : INT;', []),
      solution: LDU('  Count : INT;', [
        R('Car in', [[PE_('I_In')]], [O('ADD', 'Count', '1', 'Count')]),
        R('Car out (never below zero)', [[PE_('I_Out'), CMP('Count', '>', '0')]], [O('SUB', 'Count', '1', 'Count')]),
        R('Signs', [[CMP('Count', '>=', '5')]], [O('COIL', 'Q_Full'), O('NCOIL', 'Q_Free')])]),
      hints: ['P contact on I_In → ADD Count + 1 → Count.', 'P on I_Out and a compare Count > 0 → SUB. A compare Count >= 5 drives Q_Full (COIL) and Q_Free (NCOIL).'] },
    objectives: [
      { id: 'count', text: '4 cars in: Free; the 5th makes it Full', test: h => { for (let i = 0; i < 4; i++) h.tap('In'); if (!h.out('Q_Free') || h.out('Q_Full')) return 'Expected Free after 4 cars'; h.tap('In'); return fail(h.out('Q_Full') && !h.out('Q_Free'), 'Not Full after 5 cars'); } },
      { id: 'hold', text: 'A car standing on the sensor counts once', test: h => { h.press('In').run(3).release('In').run(0.2); return fail(h.tag('Count') === 1, `Count = ${h.tag('Count')} after one long press`); } },
      { id: 'out', text: 'A car leaving frees a space', test: h => { for (let i = 0; i < 5; i++) h.tap('In'); h.tap('Out'); return fail(h.out('Q_Free') && h.tag('Count') === 4, 'Not Free / Count ≠ 4 after one car left'); } },
      { id: 'zero', text: 'Count never goes below 0', test: h => { for (let i = 0; i < 3; i++) h.tap('Out'); return fail(h.tag('Count') === 0, `Count = ${h.tag('Count')}`); } },
    ],
  },
  {
    id: 'K04', module: 'core', capstone: true, title: 'Capstone: traffic light with walk request', minutes: 25,
    summary: 'A timed sequence, a latched request and a safe default state.',
    theory: `<p>A sequence is a set of <b>steps</b>, each held in an integer, and <b>transitions</b> between them (a timer done, a sensor). Every output is simply "in step X". This module's tools all come together: timers for each phase, a latch for a request that arrives at any time, and a reset of that latch at a defined moment.</p>
      <p>A traffic light's safe state is <b>red</b>. When the controller is switched off, the light shows red, never green.</p>`,
    tips: tip('A <code>Step</code> INT and one TON per timed step; <code>CASE Step OF</code> or IF chains for the transitions.', 'Step transitions are rungs with a compare contact (<code>Step = 1</code>) and a timer done bit, driving <b>MOV</b> (new step → Step). Outputs are compare contacts driving coils.'),
    task: `With <b>Run</b> ON, cycle the light <b>TL</b>: <b>green 5 s → amber 2 s → red 5 s</b>, then green again. With Run OFF, show steady red. Pressing <b>Walk</b> at any time lights the <b>WalkLamp</b> during the next red phase. The request clears at the end of that red phase.` +
      IO_NOTE([['I_Run_P1', 'Run selector ON'], ['I_Walk', 'Pedestrian button'], ['Q_TL_Green / Q_TL_Amber / Q_TL_Red', 'Traffic light'], ['Q_WalkLamp', 'Walk signal']]),
    layout: { components: [C('sw', 'selector', 'Run', -1.6, -1, { positions: '2', labels: 'OFF,ON' }), C('wk', 'pushbutton', 'Walk', -0.9, -1, { color: 'white' }),
      C('tl', 'stacklight', 'TL', 0, -1), C('wl', 'pilot', 'WalkLamp', 0.8, -1, { color: 'white' })] },
    sensors: [DI('I_Run_P1', 'sw.p1'), DI('I_Walk', 'wk.pressed')],
    st: { starter: ST('(* Capstone — traffic light *)\nVAR\n  Step : INT;   (* 0 off, 1 green, 2 amber, 3 red *)\nEND_VAR\n\n'),
      solution: ST(`VAR
  Step : INT;   (* 0 off, 1 green, 2 amber, 3 red *)
  TG, TA, TR : TON;
  Req  : BOOL;
END_VAR
TG(IN := Step = 1, PT := T#5s);
TA(IN := Step = 2, PT := T#2s);
TR(IN := Step = 3, PT := T#5s);
IF I_Walk THEN Req := TRUE; END_IF;
IF NOT I_Run_P1 THEN Step := 0;
ELSIF Step = 0 THEN Step := 1;
ELSIF Step = 1 AND TG.Q THEN Step := 2;
ELSIF Step = 2 AND TA.Q THEN Step := 3;
ELSIF Step = 3 AND TR.Q THEN Step := 1; Req := FALSE;
END_IF;
Q_TL_Green := Step = 1;
Q_TL_Amber := Step = 2;
Q_TL_Red   := Step = 3 OR Step = 0;
Q_WalkLamp := Step = 3 AND Req;
`),
      hints: ['One timer per timed step: TG(IN := Step = 1, PT := T#5s); … Then IF/ELSIF transitions.', 'Latch Req on I_Walk; clear it in the transition 3 → 1. Q_WalkLamp := Step = 3 AND Req;'] },
    ld: { starter: LDU('  Step : INT;   (* 0 off, 1 green, 2 amber, 3 red *)', []),
      solution: LDU('  Step : INT;\n  TG   : TON;\n  TA   : TON;\n  TR   : TON;\n  Req  : BOOL;', [
        R('Phase timers', [[CMP('Step', '=', '1')]], [O('TON', 'TG', 'T#5s')]),
        R('', [[CMP('Step', '=', '2')]], [O('TON', 'TA', 'T#2s')]),
        R('', [[CMP('Step', '=', '3')]], [O('TON', 'TR', 'T#5s')]),
        R('Walk request', [[NO('I_Walk')]], [O('SET', 'Req')]),
        R('0 → 1', [[CMP('Step', '=', '0'), NO('I_Run_P1')]], [O('MOV', '1', 'Step')]),
        R('1 → 2', [[CMP('Step', '=', '1'), NO('TG.Q')]], [O('MOV', '2', 'Step')]),
        R('2 → 3', [[CMP('Step', '=', '2'), NO('TA.Q')]], [O('MOV', '3', 'Step')]),
        R('3 → 1, request served', [[CMP('Step', '=', '3'), NO('TR.Q')]], [O('MOV', '1', 'Step'), O('RST', 'Req')]),
        R('Run off → safe state', [[NC('I_Run_P1')]], [O('MOV', '0', 'Step')]),
        R('Lights', [[CMP('Step', '=', '1')]], [O('COIL', 'Q_TL_Green')]),
        R('', [[CMP('Step', '=', '2')]], [O('COIL', 'Q_TL_Amber')]),
        R('', [[CMP('Step', '=', '3')], [CMP('Step', '=', '0')]], [O('COIL', 'Q_TL_Red')]),
        R('', [[CMP('Step', '=', '3'), NO('Req')]], [O('COIL', 'Q_WalkLamp')])]),
      hints: ['Timer rungs: compare Step = 1 → TON TG (5 s), etc. Transition rungs: compare + done bit → MOV new step.', 'SET Req on I_Walk; RST Req in the 3 → 1 rung. Red = Step 3 OR Step 0.'] },
    objectives: [
      { id: 'off', text: 'Run OFF: steady red only', test: h => fail(h.always(() => h.out('Q_TL_Red') && !h.out('Q_TL_Green') && !h.out('Q_TL_Amber'), 2), 'Expected red only with Run OFF') },
      { id: 'seq', text: 'Green 5 s → amber 2 s → red 5 s → green (±0.3 s)', test: h => {
        h.select('Run', 1).run(0.2); if (!h.out('Q_TL_Green')) return 'Not green right after Run';
        const a = h.until(() => h.out('Q_TL_Amber'), 8); if (!near(a + 0.2, 5, 0.3)) return `Green lasted ${(a + 0.2).toFixed(1)} s`;
        const r = h.until(() => h.out('Q_TL_Red'), 5); if (!near(r, 2, 0.3)) return `Amber lasted ${r.toFixed(1)} s`;
        const g = h.until(() => h.out('Q_TL_Green'), 8); return fail(near(g, 5, 0.3), `Red lasted ${g.toFixed(1)} s`); } },
      { id: 'one', text: 'Only one colour at a time', test: h => { h.select('Run', 1); return fail(h.always(() => [h.out('Q_TL_Green'), h.out('Q_TL_Amber'), h.out('Q_TL_Red')].filter(Boolean).length === 1, 25), 'Two colours were on together (or none)'); } },
      { id: 'walk', text: 'Walk lights in the next red only', test: h => {
        h.select('Run', 1).run(1).tap('Walk'); if (h.until(() => h.out('Q_TL_Red'), 10) < 0) return 'Never reached red';
        h.run(0.3); if (!h.out('Q_WalkLamp')) return 'WalkLamp off during red after a request';
        h.until(() => h.out('Q_TL_Green'), 8); h.until(() => h.out('Q_TL_Red'), 10); h.run(0.3);
        return fail(!h.out('Q_WalkLamp'), 'WalkLamp lit again without a new request'); } },
      { id: 'stop', text: 'Run OFF mid-cycle returns to red', test: h => { h.select('Run', 1).run(3).select('Run', 0).run(0.3); return fail(h.out('Q_TL_Red') && !h.out('Q_TL_Green'), 'Not red after Run OFF'); } },
    ],
  },

  // ═════════════════════════ Process & analog ═════════════════════════
  {
    id: 'P01', module: 'proc', title: 'Duty/standby: alternate two pumps', minutes: 18, tabs: ['trend'],
    summary: 'Share wear between two pumps and call both when the level is very low.',
    theory: `<p>Stations with two pumps <b>alternate</b> the lead pump on every cycle, so both wear evenly and a seized standby pump is found early. If the level keeps falling, the <b>assist</b> (lag) pump joins in.</p>
      <p>The alternation happens on an <b>edge</b>, here the end of each fill cycle. Toggling on a level would flip the lead pump on every scan.</p>`,
    tips: tip('<code>EndFill(CLK := Fill);</code> (F_TRIG), then <code>IF EndFill.Q THEN Lead2 := NOT Lead2; END_IF;</code>', 'An <b>N</b> (negative transition) contact on <code>Fill</code> into a one-shot coil, then a flip-flop rung toggles <code>Lead2</code> (like the one-button toggle lesson).'),
    task: `Keep tank <b>T1</b> between <b>30 %</b> and <b>70 %</b> (start at ≤ 30, stop at ≥ 70) with pumps <b>P1</b>/<b>P2</b>. Only the lead pump runs, and the lead swaps after every fill. Below <b>15 %</b> both pumps run. The outlet valve follows the <b>Demand</b> selector.` +
      IO_NOTE([['AI_Level', 'T1 level %'], ['I_Demand_P1', 'Demand selector ON'], ['Q_P1_Run / Q_P2_Run', 'Pumps'], ['Q_Out_Open', 'Outlet valve']]),
    layout: { components: [C('t1', 'tank', 'T1', 0.4, 0.4, { capacity: 400, level: 50 }), C('p1', 'pump', 'P1', -1.2, 0, { from: '@supply', to: 't1', flow: 400 }),
      C('p2', 'pump', 'P2', -1.2, 0.9, { from: '@supply', to: 't1', flow: 400 }), C('ov', 'valve', 'Out', 1.7, 0.4, { from: 't1', to: '@drain', flow: 200 }),
      C('sw', 'selector', 'Demand', -1.4, -1.2, { positions: '2', labels: 'OFF,ON' })] },
    sensors: [AI('AI_Level', 't1.level', 0, 100, { noise: 0.2 }), DI('I_Demand_P1', 'sw.p1')],
    st: { starter: ST('(* Duty / standby *)\nVAR\n  Fill  : BOOL;\n  Lead2 : BOOL;   (* TRUE = P2 leads *)\nEND_VAR\nQ_Out_Open := I_Demand_P1;   (* given *)\n\n'),
      solution: ST(`VAR
  Fill    : BOOL;
  Lead2   : BOOL;
  EndFill : F_TRIG;
END_VAR
Q_Out_Open := I_Demand_P1;
IF AI_Level <= 30.0 THEN Fill := TRUE; ELSIF AI_Level >= 70.0 THEN Fill := FALSE; END_IF;
EndFill(CLK := Fill);
IF EndFill.Q THEN Lead2 := NOT Lead2; END_IF;
Q_P1_Run := Fill AND (NOT Lead2 OR AI_Level < 15.0);
Q_P2_Run := Fill AND (Lead2 OR AI_Level < 15.0);
`),
      hints: ['Fill latch with hysteresis as in L10. Toggle Lead2 on the falling edge of Fill (F_TRIG).', 'Q_P1_Run := Fill AND (NOT Lead2 OR AI_Level < 15.0);'] },
    ld: { starter: LDU('  Fill  : BOOL;\n  Lead2 : BOOL;   (* TRUE = P2 leads *)', [R('Given: outlet follows demand', [[NO('I_Demand_P1')]], [O('COIL', 'Q_Out_Open')])]),
      solution: LDU('  Fill  : BOOL;\n  Lead2 : BOOL;\n  Swap  : BOOL;', [
        R('Given: outlet follows demand', [[NO('I_Demand_P1')]], [O('COIL', 'Q_Out_Open')]),
        R('Start filling at 30 %', [[CMP('AI_Level', '<=', '30.0')]], [O('SET', 'Fill')]),
        R('Stop at 70 %', [[CMP('AI_Level', '>=', '70.0')]], [O('RST', 'Fill')]),
        R('End of a fill: one-shot', [[NE_('Fill')]], [O('COIL', 'Swap')]),
        R('Swap the lead pump', [[NO('Swap'), NC('Lead2')], [NC('Swap'), NO('Lead2')]], [O('COIL', 'Lead2')]),
        R('P1 leads, or assist', [[NO('Fill'), NC('Lead2')], [NO('Fill'), CMP('AI_Level', '<', '15.0')]], [O('COIL', 'Q_P1_Run')]),
        R('P2 leads, or assist', [[NO('Fill'), NO('Lead2')], [NO('Fill'), CMP('AI_Level', '<', '15.0')]], [O('COIL', 'Q_P2_Run')])]),
      hints: ['SET Fill at ≤ 30, RST at ≥ 70. An N contact on Fill → coil Swap (one scan).', 'Flip-flop: (Swap AND NC Lead2) OR (NC Swap AND Lead2) → Lead2. P1: Fill AND NC Lead2, or Fill AND level < 15.'] },
    objectives: [
      { id: 'band', text: 'With demand, level stays between 25 and 75 % for 4 min', test: h => { h.select('Demand', 1); return fail(h.always(() => { const l = h.sig('t1.level'); return l > 25 && l < 75; }, 240), `Level left the band (${h.sig('t1.level').toFixed(1)} %)`); } },
      { id: 'alt', text: 'The pumps take turns', test: h => { h.select('Demand', 1); let a = 0, b = 0, la = false, lb = false; h.watch(() => { const x = !!h.out('Q_P1_Run'), y = !!h.out('Q_P2_Run'); if (x && !la) a++; if (y && !lb) b++; la = x; lb = y; }); h.run(300); return fail(a >= 1 && b >= 1 && Math.abs(a - b) <= 1, `P1 started ${a}×, P2 ${b}×`); } },
      { id: 'one', text: 'Above 15 %, never both pumps together', test: h => { h.select('Demand', 1); return fail(h.always(() => !(h.out('Q_P1_Run') && h.out('Q_P2_Run')) || h.sig('t1.level') < 16, 240), 'Both pumps ran above 15 %'); } },
      { id: 'assist', text: 'Below 15 %: both pumps run', test: h => { h.ctl('T1', 'fill', 10).run(0.5); return fail(h.out('Q_P1_Run') && h.out('Q_P2_Run'), 'Not both pumps at 10 %'); } },
    ],
  },
  {
    id: 'P02', module: 'proc', title: 'Temperature on/off with a low-level interlock', minutes: 14, tabs: ['trend'],
    summary: 'Hold a tank at 45–50 °C and protect the heater from running dry.',
    theory: `<p>Most heaters are simple <b>on/off</b> loads controlled with a deadband, like the level lesson. Every heater also needs an <b>interlock</b>: an element switched on without liquid around it overheats and burns out in seconds. The interlock sits in series with the control logic, so no setpoint or operator action can bypass it.</p>`,
    tips: tip('A deadband latch <code>Heating</code>, then <code>Q_H1_On := Heating AND I_Heat_P1 AND AI_Level >= 25.0;</code>', 'SET/RST <code>Heating</code> with compare contacts, then a rung with NO Heating, NO I_Heat_P1 and compare <code>AI_Level &gt;= 25.0</code> in series.'),
    task: `With selector <b>Heat</b> ON, keep tank <b>T1</b> between <b>45</b> and <b>50 °C</b> with heater <b>H1</b> (on at ≤ 45, off at ≥ 50). The heater must never run below <b>25 %</b> level, and <b>LowLevel</b> lights then. The <b>DrainBtn</b> opens the drain valve while held (given).` +
      IO_NOTE([['AI_Temp / AI_Level', 'Temperature °C, level %'], ['I_Heat_P1', 'Heat selector ON'], ['I_DrainBtn', 'Drain button (given)'], ['Q_H1_On', 'Heater contactor'], ['Q_LowLevel', 'Low level lamp'], ['Q_Drain_Open', 'Drain valve']]),
    layout: { components: [C('t1', 'tank', 'T1', 0.3, 0.4, { capacity: 200, level: 60, temp: 20 }), C('h1', 'heater', 'H1', 0.3, 1.1, { tank: 't1', rate: 1.2 }),
      C('dv', 'valve', 'Drain', 1.6, 0.6, { from: 't1', to: '@drain', flow: 60 }), C('sw', 'selector', 'Heat', -1.4, -1.2, { positions: '2', labels: 'OFF,ON' }),
      C('db', 'pushbutton', 'DrainBtn', -0.7, -1.2, { color: 'black' }), C('ll', 'pilot', 'LowLevel', 0, -1.2, { color: 'amber' })] },
    sensors: [AI('AI_Temp', 't1.temp', 0, 100), AI('AI_Level', 't1.level', 0, 100), DI('I_Heat_P1', 'sw.p1'), DI('I_DrainBtn', 'db.pressed')],
    st: { starter: ST('(* Temperature on/off *)\nVAR\n  Heating : BOOL;\nEND_VAR\nQ_Drain_Open := I_DrainBtn;   (* given *)\n\n'),
      solution: ST('VAR\n  Heating : BOOL;\nEND_VAR\nQ_Drain_Open := I_DrainBtn;\nIF AI_Temp <= 45.0 THEN Heating := TRUE; ELSIF AI_Temp >= 50.0 THEN Heating := FALSE; END_IF;\nQ_H1_On := Heating AND I_Heat_P1 AND AI_Level >= 25.0;\nQ_LowLevel := AI_Level < 25.0;\n'),
      hints: ['IF AI_Temp <= 45.0 THEN Heating := TRUE; ELSIF AI_Temp >= 50.0 THEN Heating := FALSE; END_IF;', 'Q_H1_On := Heating AND I_Heat_P1 AND AI_Level >= 25.0;'] },
    ld: { starter: LDU('  Heating : BOOL;', [R('Given: drain while held', [[NO('I_DrainBtn')]], [O('COIL', 'Q_Drain_Open')])]),
      solution: LDU('  Heating : BOOL;', [
        R('Given: drain while held', [[NO('I_DrainBtn')]], [O('COIL', 'Q_Drain_Open')]),
        R('Heat at ≤ 45 °C', [[CMP('AI_Temp', '<=', '45.0')]], [O('SET', 'Heating')]),
        R('Stop at ≥ 50 °C', [[CMP('AI_Temp', '>=', '50.0')]], [O('RST', 'Heating')]),
        R('Heater with low-level interlock', [[NO('Heating'), NO('I_Heat_P1'), CMP('AI_Level', '>=', '25.0')]], [O('COIL', 'Q_H1_On')]),
        R('', [[CMP('AI_Level', '<', '25.0')]], [O('COIL', 'Q_LowLevel')])]),
      hints: ['SET Heating at ≤ 45, RST at ≥ 50.', 'Heater rung: NO Heating + NO I_Heat_P1 + compare AI_Level >= 25.0.'] },
    objectives: [
      { id: 'warm', text: 'Heats up and holds 42–53 °C for 2 min', test: h => { h.select('Heat', 1); if (h.until(() => h.sig('t1.temp') >= 45, 90) < 0) return 'Never reached 45 °C'; return fail(h.always(() => { const t = h.sig('t1.temp'); return t > 42 && t < 53; }, 120), `Temperature left the band (${h.sig('t1.temp').toFixed(1)} °C)`); } },
      { id: 'off', text: 'Heat OFF: heater off', test: h => { h.select('Heat', 1).run(3).select('Heat', 0).run(0.5); return fail(!h.out('Q_H1_On'), 'Heater still on'); } },
      { id: 'low', text: 'Below 25 %: heater off and LowLevel on', test: h => { h.select('Heat', 1).run(2); h.ctl('T1', 'fill', 20).run(0.5); return fail(!h.out('Q_H1_On') && h.out('Q_LowLevel'), 'Heater on (or no lamp) at 20 % level'); } },
      { id: 'drain', text: 'Draining the tank never burns the heater', test: h => { h.select('Heat', 1).press('DrainBtn').run(150); return fail(!h.plant().faults['h1.burnt'], 'H1 burned out'); } },
    ],
  },
  {
    id: 'P03', module: 'proc', title: 'Analog alarms and trips', minutes: 16, tabs: ['trend'],
    summary: 'H/L alarms, an HH trip that stops overfilling and an LL trip that protects the pump.',
    theory: `<p>A process value usually has four limits. <b>H</b> and <b>L</b> are <i>alarms</i>: they tell the operator. <b>HH</b> and <b>LL</b> are <i>trips</i>: the PLC acts on its own. Here HH closes the inlet before the tank overflows, and LL stops the pump before it runs dry (a dry-running pump destroys its seal in seconds).</p>
      <p>A trip needs <b>hysteresis</b> too. Otherwise the valve chatters right at the limit. Release the HH trip only below 85 %, and the LL trip only above 15 %.</p>`,
    tips: tip('Two latches with IF/ELSIF, then the outputs: <code>Q_Fill_Open := I_Fill_P1 AND NOT HiTrip;</code>', 'SET/RST pairs with compare contacts for <code>HiTrip</code> and <code>LoTrip</code>, then NC trip contacts in series with the operator selectors.'),
    task: `Operators open inlet <b>Fill</b> and run pump <b>P1</b> with selectors. Add: <b>AlmH</b> lamp at ≥ 80 %, <b>AlmL</b> at ≤ 20 %. <b>HH trip</b>: at ≥ 90 % close Fill until the level is below 85 %. <b>LL trip</b>: at ≤ 10 % stop P1 until the level is above 15 %.` +
      IO_NOTE([['AI_Level', 'Level %'], ['I_Fill_P1 / I_Pump_P1', 'Operator selectors'], ['Q_Fill_Open / Q_P1_Run', 'Inlet valve, pump'], ['Q_AlmH / Q_AlmL', 'Alarm lamps']]),
    layout: { components: [C('t1', 'tank', 'T1', 0.3, 0.4, { capacity: 300, level: 50 }), C('fv', 'valve', 'Fill', -1, 0.4, { from: '@supply', to: 't1', flow: 200 }),
      C('p1', 'pump', 'P1', 1.6, 0.6, { from: 't1', to: '@drain', flow: 150 }), C('s1', 'selector', 'FillSel', -1.6, -1.2, { positions: '2', labels: 'OFF,ON' }),
      C('s2', 'selector', 'PumpSel', -0.9, -1.2, { positions: '2', labels: 'OFF,ON' }), C('ah', 'pilot', 'AlmH', -0.1, -1.2, { color: 'amber' }), C('al', 'pilot', 'AlmL', 0.5, -1.2, { color: 'amber' })] },
    sensors: [AI('AI_Level', 't1.level', 0, 100, { noise: 0.2 }), DI('I_Fill_P1', 's1.p1'), DI('I_Pump_P1', 's2.p1')],
    st: { starter: ST('(* Alarms and trips *)\nVAR\n  HiTrip : BOOL;\n  LoTrip : BOOL;\nEND_VAR\n\n'),
      solution: ST(`VAR
  HiTrip : BOOL;
  LoTrip : BOOL;
END_VAR
IF AI_Level >= 90.0 THEN HiTrip := TRUE; ELSIF AI_Level < 85.0 THEN HiTrip := FALSE; END_IF;
IF AI_Level <= 10.0 THEN LoTrip := TRUE; ELSIF AI_Level > 15.0 THEN LoTrip := FALSE; END_IF;
Q_Fill_Open := I_Fill_P1 AND NOT HiTrip;
Q_P1_Run    := I_Pump_P1 AND NOT LoTrip;
Q_AlmH := AI_Level >= 80.0;
Q_AlmL := AI_Level <= 20.0;
`),
      hints: ['IF AI_Level >= 90.0 THEN HiTrip := TRUE; ELSIF AI_Level < 85.0 THEN HiTrip := FALSE; END_IF;  (and the same for LoTrip)', 'Q_Fill_Open := I_Fill_P1 AND NOT HiTrip;  Q_AlmH := AI_Level >= 80.0;'] },
    ld: { starter: LDU('  HiTrip : BOOL;\n  LoTrip : BOOL;', []),
      solution: LDU('  HiTrip : BOOL;\n  LoTrip : BOOL;', [
        R('HH trip at 90 %', [[CMP('AI_Level', '>=', '90.0')]], [O('SET', 'HiTrip')]),
        R('… released below 85 %', [[CMP('AI_Level', '<', '85.0')]], [O('RST', 'HiTrip')]),
        R('LL trip at 10 %', [[CMP('AI_Level', '<=', '10.0')]], [O('SET', 'LoTrip')]),
        R('… released above 15 %', [[CMP('AI_Level', '>', '15.0')]], [O('RST', 'LoTrip')]),
        R('Inlet', [[NO('I_Fill_P1'), NC('HiTrip')]], [O('COIL', 'Q_Fill_Open')]),
        R('Pump', [[NO('I_Pump_P1'), NC('LoTrip')]], [O('COIL', 'Q_P1_Run')]),
        R('Alarms', [[CMP('AI_Level', '>=', '80.0')]], [O('COIL', 'Q_AlmH')]),
        R('', [[CMP('AI_Level', '<=', '20.0')]], [O('COIL', 'Q_AlmL')])]),
      hints: ['Four rungs of compare → SET/RST for the two trips.', 'Inlet: NO I_Fill_P1 + NC HiTrip. Pump: NO I_Pump_P1 + NC LoTrip.'] },
    objectives: [
      { id: 'hh', text: 'Fill ON: never overfills, stops near 90 %', test: h => { h.select('FillSel', 1); if (!h.always(() => h.sig('t1.level') < 93, 120)) return `Level reached ${h.sig('t1.level').toFixed(1)} %`; return fail(!h.out('Q_Fill_Open'), 'Inlet still open at the top'); } },
      { id: 'll', text: 'Pump ON: stops near 10 %, never runs dry', test: h => { h.select('PumpSel', 1); if (!h.always(() => !h.sig('p1.dry') && h.sig('t1.level') > 6, 120)) return 'The pump ran the tank dry'; return fail(!h.out('Q_P1_Run'), 'Pump still running at the bottom'); } },
      { id: 'alarm', text: 'AlmH at ≥ 80 %, AlmL at ≤ 20 %', test: h => { h.ctl('T1', 'fill', 84).run(0.5); if (!h.out('Q_AlmH') || h.out('Q_AlmL')) return 'Wrong lamps at 84 %'; h.ctl('T1', 'fill', 16).run(0.5); return fail(h.out('Q_AlmL') && !h.out('Q_AlmH'), 'Wrong lamps at 16 %'); } },
      { id: 'hyst', text: 'Trips release with hysteresis (no chatter at the limit)', test: h => { h.select('FillSel', 1); let n = 0, last = true; h.watch(() => { const v = !!h.out('Q_Fill_Open'); if (v && !last) n++; last = v; }); h.select('PumpSel', 1).run(240); return fail(n <= 8, `Inlet re-opened ${n} times in 4 min`); } },
    ],
  },
  {
    id: 'P04', module: 'proc', capstone: true, title: 'Capstone: batch heat and transfer', minutes: 30, tabs: ['trend'],
    summary: 'Fill, heat with mixing, hold, transfer — a full batch sequence with interlocks.',
    theory: `<p>Batch processes (ISA-88) run a <b>recipe</b> as a sequence of phases. This capstone combines a state machine, analog compares, a hold timer and protective interlocks:</p>
      <ol><li><b>Fill</b> to 60 %.</li><li><b>Heat</b> to 50 °C with the mixer running.</li><li><b>Hold</b> for 10 s, still heating as needed.</li><li><b>Transfer</b>: pump out until the level is ≤ 5 %. Never run the pump dry.</li><li><b>Done</b> lamp until the next Start.</li></ol>
      <p>Stop aborts to idle from any phase and switches everything off.</p>`,
    tips: tip('A <code>Step</code> INT with CASE; outputs as compares on Step; a TON for the hold.', 'Rungs of compare (Step = n) + condition → MOV. Use separate rungs for the outputs, e.g. <code>Step = 20</code> OR <code>Step = 30</code> → mixer.'),
    task: `<b>Start</b> runs one batch in tank <b>T1</b>: open <b>Fill</b> to 60 %, then heat with <b>H1</b> and mixer <b>Mix</b> to 50 °C, hold 10 s (heater on below 50 °C), then pump out with <b>P1</b> until ≤ 5 %. Then light <b>Done</b>. <b>Stop</b> aborts to idle at any time.` +
      IO_NOTE([['I_Start / I_Stop', 'Buttons (Stop NC)'], ['AI_Level / AI_Temp', 'T1 level %, temperature °C'], ['Q_Fill_Open', 'Inlet valve'], ['Q_H1_On / Q_Mix_Run / Q_P1_Run', 'Heater, mixer, transfer pump'], ['Q_Done', 'Batch complete lamp']]),
    layout: { components: [C('t1', 'tank', 'T1', 0.3, 0.4, { capacity: 200, level: 0, temp: 20 }), C('fv', 'valve', 'Fill', -1, 0.4, { from: '@supply', to: 't1', flow: 200 }),
      C('h1', 'heater', 'H1', 0.3, 1.1, { tank: 't1', rate: 2 }), C('mx', 'motor', 'Mix', 0.3, -0.4, { amps: 4, attach: 't1' }),
      C('p1', 'pump', 'P1', 1.6, 0.6, { from: 't1', to: '@drain', flow: 200 }),
      C('st', 'pushbutton', 'Start', -1.6, -1.2, { color: 'green' }), C('sp', 'pushbutton', 'Stop', -1.0, -1.2, { color: 'red' }), C('dn', 'pilot', 'Done', -0.3, -1.2, { color: 'green' })] },
    sensors: [DI('I_Start', 'st.pressed'), DI('I_Stop', 'sp.pressed', 'NC'), AI('AI_Level', 't1.level', 0, 100), AI('AI_Temp', 't1.temp', 0, 100)],
    st: { starter: ST('(* Capstone — batch *)\nVAR\n  Step : INT;   (* 0 idle, 10 fill, 20 heat, 30 hold, 40 transfer *)\n  Done : BOOL;\nEND_VAR\n\n'),
      solution: ST(`VAR
  Step : INT;   (* 0 idle, 10 fill, 20 heat, 30 hold, 40 transfer *)
  Done : BOOL;
  Hold : TON;
END_VAR
Hold(IN := Step = 30, PT := T#10s);
IF NOT I_Stop THEN Step := 0;
ELSIF Step = 0 AND I_Start THEN Step := 10; Done := FALSE;
ELSIF Step = 10 AND AI_Level >= 60.0 THEN Step := 20;
ELSIF Step = 20 AND AI_Temp >= 50.0 THEN Step := 30;
ELSIF Step = 30 AND Hold.Q THEN Step := 40;
ELSIF Step = 40 AND AI_Level <= 5.0 THEN Step := 0; Done := TRUE;
END_IF;
Q_Fill_Open := Step = 10;
Q_Mix_Run   := Step = 20 OR Step = 30;
Q_H1_On     := (Step = 20 OR Step = 30) AND AI_Temp < 50.0 AND AI_Level >= 20.0;
Q_P1_Run    := Step = 40;
Q_Done      := Done;
`),
      hints: ['IF NOT I_Stop THEN Step := 0; ELSIF Step = 0 AND I_Start THEN Step := 10; … one ELSIF per transition.', 'Q_H1_On := (Step = 20 OR Step = 30) AND AI_Temp < 50.0 AND AI_Level >= 20.0;  Hold(IN := Step = 30, PT := T#10s);'] },
    ld: { starter: LDU('  Step : INT;   (* 0 idle, 10 fill, 20 heat, 30 hold, 40 transfer *)\n  Done : BOOL;', []),
      solution: LDU('  Step : INT;\n  Done : BOOL;\n  Hold : TON;', [
        R('Hold timer', [[CMP('Step', '=', '30')]], [O('TON', 'Hold', 'T#10s')]),
        R('0 → 10 Start', [[CMP('Step', '=', '0'), NO('I_Start')]], [O('MOV', '10', 'Step'), O('RST', 'Done')]),
        R('10 → 20 full', [[CMP('Step', '=', '10'), CMP('AI_Level', '>=', '60.0')]], [O('MOV', '20', 'Step')]),
        R('20 → 30 hot', [[CMP('Step', '=', '20'), CMP('AI_Temp', '>=', '50.0')]], [O('MOV', '30', 'Step')]),
        R('30 → 40 held', [[CMP('Step', '=', '30'), NO('Hold.Q')]], [O('MOV', '40', 'Step')]),
        R('40 → 0 empty', [[CMP('Step', '=', '40'), CMP('AI_Level', '<=', '5.0')]], [O('MOV', '0', 'Step'), O('SET', 'Done')]),
        R('Stop aborts', [[NC('I_Stop')]], [O('MOV', '0', 'Step')]),
        R('Fill', [[CMP('Step', '=', '10')]], [O('COIL', 'Q_Fill_Open')]),
        R('Mixer', [[CMP('Step', '=', '20')], [CMP('Step', '=', '30')]], [O('COIL', 'Q_Mix_Run')]),
        R('Heater with interlocks', [[CMP('Step', '=', '20')], [CMP('Step', '=', '30')]], [O('COIL', 'Q_H1_On')]),
        R('Transfer', [[CMP('Step', '=', '40')]], [O('COIL', 'Q_P1_Run')]),
        R('', [[NO('Done')]], [O('COIL', 'Q_Done')])].map(r => (r.comment === 'Heater with interlocks' ? Object.assign(r, { post: [CMP('AI_Temp', '<', '50.0'), CMP('AI_Level', '>=', '20.0')] }) : r))),
      hints: ['Transition rungs: compare Step = n + condition → MOV next step. Put the Stop rung after them so it wins.', 'Heater: branch (Step = 20 OR Step = 30), then compares Temp < 50 and Level ≥ 20 in series after the branch.'] },
    objectives: [
      { id: 'fill', text: 'Start fills to 60 % (±4)', test: h => { h.tap('Start'); if (!h.out('Q_Fill_Open')) return 'Fill did not open'; if (h.until(() => !h.out('Q_Fill_Open'), 60) < 0) return 'Fill never closed'; h.run(3); return fail(near(h.sig('t1.level'), 60, 4), `Filled to ${h.sig('t1.level').toFixed(1)} %`); } },
      { id: 'heat', text: 'Heats to 50 °C with the mixer before transfer', test: h => { h.tap('Start'); let bad = false; h.watch(() => { if (h.out('Q_H1_On') && !h.out('Q_Mix_Run')) bad = true; }); if (h.until(() => h.out('Q_P1_Run'), 120) < 0) return 'Transfer never started'; if (bad) return 'Heater ran without the mixer'; return fail(h.sig('t1.temp') >= 48.5, `Transfer started at ${h.sig('t1.temp').toFixed(1)} °C`); } },
      { id: 'hold', text: 'Holds at least 10 s at temperature', test: h => { h.tap('Start'); if (h.until(() => h.sig('t1.temp') >= 50, 120) < 0) return 'Never reached 50 °C'; const t = h.until(() => h.out('Q_P1_Run'), 30); return fail(t >= 9.5, `Transfer started ${t.toFixed(1)} s after reaching 50 °C`); } },
      { id: 'done', text: 'Pumps out to ≤ 8 % without running dry, then Done', test: h => { h.tap('Start'); if (h.until(() => h.out('Q_Done'), 200) < 0) return 'Done never lit'; return fail(h.sig('t1.level') <= 8 && !h.out('Q_P1_Run'), `Ended at ${h.sig('t1.level').toFixed(1)} % with the pump ${h.out('Q_P1_Run') ? 'on' : 'off'}`); } },
      { id: 'stop', text: 'Stop during heating switches everything off', test: h => { h.tap('Start'); h.until(() => h.out('Q_H1_On'), 60); h.run(2).tap('Stop').run(0.3); return fail(!h.out('Q_H1_On') && !h.out('Q_Mix_Run') && !h.out('Q_Fill_Open') && !h.out('Q_P1_Run'), 'Something kept running after Stop'); } },
    ],
  },

  // ═════════════════════════ Data & motion ═════════════════════════
  {
    id: 'D01', module: 'motion', title: 'Pneumatic cylinder with a motion timeout', minutes: 18,
    summary: 'Cycle a cylinder on its reed switches and catch a move that never finishes.',
    theory: `<p>Never trust that an actuator moved: <b>confirm it</b> with its end-of-stroke sensor (reed switches on a cylinder). If the confirmation doesn't arrive within a reasonable time (lost air, a stuck rod, a broken switch), raise a <b>motion timeout</b> fault and stop the sequence. The fault stays <b>latched</b> until a person resets it, even if the cause disappears on its own.</p>`,
    tips: tip('Steps 10/20/30/40 in a CASE, a <code>Dwell</code> TON for the waits and a <code>Watch</code> TON that runs during steps 10 and 30.', 'Step transitions with MOV, a TON Dwell on (Step = 20 OR Step = 40), a TON Watch on (Step = 10 OR Step = 30), and SET Fault from Watch.Q.'),
    task: `With <b>Cycle</b> ON, repeat: extend <b>Cyl</b> until <b>I_Cyl_Ext</b>, wait 1 s, retract until <b>I_Cyl_Ret</b>, wait 1 s. If a move takes longer than <b>2 s</b>, latch <b>Fault</b>, de-energise the solenoid and stop cycling until <b>Reset</b> is pressed.` +
      IO_NOTE([['I_Cycle_P1', 'Cycle selector ON'], ['I_Reset', 'Reset button'], ['I_Cyl_Ext / I_Cyl_Ret', 'Reed switches'], ['Q_Cyl_Ext', 'Solenoid (TRUE = extend)'], ['Q_Fault', 'Fault lamp']]) +
      `<p class="small muted">To test: inject "Cyl air supply lost" on the Plant tab.</p>`,
    layout: { components: [C('cy', 'cylinder', 'Cyl', 0.4, 0.4, { stroke: 0.6 }), C('sw', 'selector', 'Cycle', -1.4, -1.2, { positions: '2', labels: 'OFF,ON' }),
      C('rs', 'pushbutton', 'Reset', -0.7, -1.2, { color: 'blue' }), C('fl', 'pilot', 'Fault', 0, -1.2, { color: 'red' })] },
    sensors: [DI('I_Cycle_P1', 'sw.p1'), DI('I_Reset', 'rs.pressed'), DI('I_Cyl_Ext', 'cy.ext'), DI('I_Cyl_Ret', 'cy.ret')],
    st: { starter: ST('(* Cylinder with motion timeout *)\nVAR\n  Step  : INT;   (* 0 idle, 10 extending, 20 dwell out, 30 retracting, 40 dwell in *)\n  Fault : BOOL;\nEND_VAR\n\n'),
      solution: ST(`VAR
  Step  : INT;   (* 0 idle, 10 extending, 20 dwell out, 30 retracting, 40 dwell in *)
  Fault : BOOL;
  Dwell : TON;
  Watch : TON;
END_VAR
IF I_Reset THEN Fault := FALSE; END_IF;
IF Fault OR NOT I_Cycle_P1 THEN Step := 0; END_IF;
CASE Step OF
  0:  IF I_Cycle_P1 AND NOT Fault AND I_Cyl_Ret THEN Step := 10; END_IF;
  10: IF I_Cyl_Ext THEN Step := 20; END_IF;
  20: IF Dwell.Q THEN Step := 30; END_IF;
  30: IF I_Cyl_Ret THEN Step := 40; END_IF;
  40: IF Dwell.Q THEN Step := 10; END_IF;
END_CASE;
Dwell(IN := Step = 20 OR Step = 40, PT := T#1s);
Watch(IN := Step = 10 OR Step = 30, PT := T#2s);
IF Watch.Q THEN Fault := TRUE; END_IF;
Q_Cyl_Ext := Step = 10 OR Step = 20;
Q_Fault := Fault;
`),
      hints: ['CASE Step OF 10: IF I_Cyl_Ext THEN Step := 20; END_IF; … and Watch(IN := Step = 10 OR Step = 30, PT := T#2s);', 'IF Watch.Q THEN Fault := TRUE; END_IF; and send Step to 0 while Fault is set. Q_Cyl_Ext := Step = 10 OR Step = 20;'] },
    ld: { starter: LDU('  Step  : INT;   (* 0 idle, 10 extending, 20 dwell out, 30 retracting, 40 dwell in *)\n  Fault : BOOL;', []),
      solution: LDU('  Step  : INT;\n  Fault : BOOL;\n  Dwell : TON;\n  Watch : TON;', [
        R('Reset', [[NO('I_Reset')]], [O('RST', 'Fault')]),
        R('Fault or Cycle off → idle', [[NO('Fault')], [NC('I_Cycle_P1')]], [O('MOV', '0', 'Step')]),
        R('0 → 10 extend', [[CMP('Step', '=', '0'), NO('I_Cycle_P1'), NC('Fault'), NO('I_Cyl_Ret')]], [O('MOV', '10', 'Step')]),
        R('10 → 20 extended', [[CMP('Step', '=', '10'), NO('I_Cyl_Ext')]], [O('MOV', '20', 'Step')]),
        R('20 → 30 dwell done', [[CMP('Step', '=', '20'), NO('Dwell.Q')]], [O('MOV', '30', 'Step')]),
        R('30 → 40 retracted', [[CMP('Step', '=', '30'), NO('I_Cyl_Ret')]], [O('MOV', '40', 'Step')]),
        R('40 → 10 dwell done', [[CMP('Step', '=', '40'), NO('Dwell.Q')]], [O('MOV', '10', 'Step')]),
        R('Dwell timer', [[CMP('Step', '=', '20')], [CMP('Step', '=', '40')]], [O('TON', 'Dwell', 'T#1s')]),
        R('Motion watchdog', [[CMP('Step', '=', '10')], [CMP('Step', '=', '30')]], [O('TON', 'Watch', 'T#2s')]),
        R('', [[NO('Watch.Q')]], [O('SET', 'Fault')]),
        R('Solenoid', [[CMP('Step', '=', '10')], [CMP('Step', '=', '20')]], [O('COIL', 'Q_Cyl_Ext')]),
        R('', [[NO('Fault')]], [O('COIL', 'Q_Fault')])]),
      hints: ['One MOV rung per transition, then the Dwell and Watch TON rungs (branches of compares).', 'SET Fault from Watch.Q; NO Fault (or NC Cycle) → MOV 0 → Step; RST Fault from I_Reset.'] },
    objectives: [
      { id: 'cycle', text: 'Cycles about every 3.2 s (5–7 strokes in 20 s)', test: h => { h.select('Cycle', 1); const n = edges(h, () => h.sig('cy.ext'), 20); return fail(n >= 5 && n <= 7, `${n} strokes in 20 s`); } },
      { id: 'dwell', text: 'Waits about 1 s at each end', test: h => { h.select('Cycle', 1); if (h.until(() => h.sig('cy.ext'), 3) < 0) return 'Never extended'; const t = h.until(() => !h.sig('cy.ext'), 4); return fail(t > 0.9 && t < 1.6, `Stayed extended ${t.toFixed(2)} s`); } },
      { id: 'timeout', text: 'Lost air: Fault within 2 s (±0.3) and solenoid off', test: h => { h.fault('cy.air'); h.select('Cycle', 1); const t = h.until(() => h.out('Q_Fault'), 5); if (t < 0) return 'No fault'; h.run(0.2); return fail(near(t, 2, 0.35) && !h.out('Q_Cyl_Ext'), t > 0 ? `Fault after ${t.toFixed(2)} s, solenoid ${h.out('Q_Cyl_Ext') ? 'on' : 'off'}` : ''); } },
      { id: 'latch', text: 'Fault stays until Reset, then cycling resumes', test: h => {
        h.fault('cy.air'); h.select('Cycle', 1).run(4); h.fault('cy.air', false);
        if (!h.always(() => h.out('Q_Fault') && !h.out('Q_Cyl_Ext'), 3)) return 'Fault cleared or motion resumed without Reset';
        h.tap('Reset'); return fail(h.until(() => h.sig('cy.ext'), 3) >= 0 && !h.out('Q_Fault'), 'No motion after Reset'); } },
      { id: 'stop', text: 'Cycle OFF retracts the cylinder', test: h => { h.select('Cycle', 1).run(0.4).select('Cycle', 0).run(1.5); return fail(!h.out('Q_Cyl_Ext') && h.sig('cy.ret'), 'Cylinder did not retract'); } },
    ],
  },
  {
    id: 'D02', module: 'motion', title: 'VFD speed reference and at-speed', minutes: 14,
    summary: 'Send a clamped speed reference to a drive and confirm it got there.',
    theory: `<p>A <b>variable frequency drive (VFD)</b> takes a run command plus an analog <b>speed reference</b> (0–100 %). The PLC should:</p>
      <ul><li><b>Clamp</b> the reference to a safe minimum while running. Many motors overheat or lose torque below about 20 %.</li><li>Send <b>0</b> when stopped, so the drive never starts at an old speed.</li>
      <li>Report <b>at speed</b> when the feedback matches the reference within a tolerance. Downstream equipment waits for that.</li></ul>`,
    tips: tip('<code>AO_M1_Speed := LIMIT(20.0, AI_Speed, 100.0);</code> and <code>ABS(AI_M1_Speed - AO_M1_Speed) &lt; 5.0</code>', 'MOV the pot to the AO, then a compare <code>AI_Speed &lt; 20.0</code> → MOV 20.0. For at-speed: SUB feedback − reference → Err, then compares <code>Err &lt; 5.0</code> and <code>Err &gt; -5.0</code> in series.'),
    task: `<b>Start</b>/<b>Stop</b> run motor <b>M1</b> (seal-in). While running, send the <b>Speed</b> pot value as the reference, clamped to <b>20–100 %</b>. Send 0 when stopped. Light <b>AtSpeed</b> while running and the feedback is within ±5 % of the reference.` +
      IO_NOTE([['I_Start / I_Stop', 'Buttons (Stop NC)'], ['AI_Speed', 'Speed pot 0–100 %'], ['AI_M1_Speed', 'Drive speed feedback %'], ['Q_M1_Run', 'Drive run'], ['AO_M1_Speed', 'Speed reference %'], ['Q_AtSpeed', 'At-speed lamp']]),
    layout: { components: [C('m1', 'motor', 'M1', 1, 0.6, { amps: 15, vfd: true, ramp: 2 }), C('st', 'pushbutton', 'Start', -1.8, -1.2, { color: 'green' }), C('sp', 'pushbutton', 'Stop', -1.2, -1.2, { color: 'red' }),
      C('pt', 'pot', 'Speed', -0.5, -1.2, { min: 0, max: 100, unit: '%' }), C('as', 'pilot', 'AtSpeed', 0.3, -1.2, { color: 'green' })] },
    sensors: [DI('I_Start', 'st.pressed'), DI('I_Stop', 'sp.pressed', 'NC'), AI('AI_Speed', 'pt.value', 0, 100, { noise: 0 }), AI('AI_M1_Speed', 'm1.speed', -100, 100, { noise: 0.1 })],
    st: { starter: ST('(* VFD speed *)\nVAR\n  Run : BOOL;\nEND_VAR\n\n'),
      solution: ST('VAR\n  Run : BOOL;\nEND_VAR\nRun := (I_Start OR Run) AND I_Stop;\nQ_M1_Run := Run;\nIF Run THEN AO_M1_Speed := LIMIT(20.0, AI_Speed, 100.0); ELSE AO_M1_Speed := 0.0; END_IF;\nQ_AtSpeed := Run AND ABS(AI_M1_Speed - AO_M1_Speed) < 5.0;\n'),
      hints: ['IF Run THEN AO_M1_Speed := LIMIT(20.0, AI_Speed, 100.0); ELSE AO_M1_Speed := 0.0; END_IF;', 'Q_AtSpeed := Run AND ABS(AI_M1_Speed - AO_M1_Speed) < 5.0;'] },
    ld: { starter: LDU('  Run : BOOL;', []),
      solution: LDU('  Run : BOOL;\n  Err : REAL;', [
        R('Run seal-in', [[NO('I_Start'), NO('I_Stop')], [NO('Run'), NO('I_Stop')]], [O('COIL', 'Run'), O('COIL', 'Q_M1_Run')]),
        R('Reference from the pot', [[NO('Run')]], [O('MOV', 'AI_Speed', 'AO_M1_Speed')]),
        R('… clamped at 20 %', [[NO('Run'), CMP('AI_Speed', '<', '20.0')]], [O('MOV', '20.0', 'AO_M1_Speed')]),
        R('0 when stopped', [[NC('Run')]], [O('MOV', '0.0', 'AO_M1_Speed')]),
        R('Speed error', [], [O('SUB', 'AI_M1_Speed', 'AO_M1_Speed', 'Err')]),
        R('At speed within ±5 %', [[NO('Run'), CMP('Err', '<', '5.0'), CMP('Err', '>', '-5.0')]], [O('COIL', 'Q_AtSpeed')])]),
      hints: ['MOV AI_Speed → AO_M1_Speed while running; a second rung with compare AI_Speed < 20.0 → MOV 20.0; NC Run → MOV 0.0.', 'A rung with no contacts runs every scan: SUB AI_M1_Speed − AO_M1_Speed → Err; then Run + Err < 5.0 + Err > -5.0 → Q_AtSpeed.'] },
    objectives: [
      { id: 'ref', text: 'Running at pot 60 %: reference 60 %', test: h => { h.pot('Speed', 60).tap('Start').run(0.5); return fail(h.out('Q_M1_Run') && near(h.out('AO_M1_Speed'), 60, 0.5), `Reference ${(+h.out('AO_M1_Speed')).toFixed(1)} %`); } },
      { id: 'min', text: 'Pot at 5 %: reference clamped to 20 %', test: h => { h.pot('Speed', 5).tap('Start').run(0.5); return fail(near(h.out('AO_M1_Speed'), 20, 0.5), `Reference ${(+h.out('AO_M1_Speed')).toFixed(1)} %`); } },
      { id: 'zero', text: 'Stopped: reference 0', test: h => { h.pot('Speed', 70).tap('Start').run(1).tap('Stop').run(0.3); return fail(!h.out('Q_M1_Run') && h.out('AO_M1_Speed') === 0, 'Drive still running or reference ≠ 0'); } },
      { id: 'at', text: 'AtSpeed only once the drive has caught up', test: h => {
        h.pot('Speed', 50).tap('Start').run(4); if (!h.out('Q_AtSpeed')) return 'AtSpeed off at steady speed';
        h.pot('Speed', 95).run(0.3); if (h.out('Q_AtSpeed')) return 'AtSpeed stayed on during a speed change';
        h.run(4); return fail(h.out('Q_AtSpeed'), 'AtSpeed off after reaching 95 %'); } },
    ],
  },
  {
    id: 'D03', module: 'motion', capstone: true, title: 'Capstone: sort tall parts and count a batch', minutes: 35,
    summary: 'FIFO tracking, a pusher sequence, a batch counter and a clean restart.',
    theory: `<p>This capstone joins tracking and counting. A height sensor sits upstream of a pusher, with parts in between, so each result goes into a <b>FIFO</b> (the shift-register lesson). Good (short) parts are counted at the end of the belt. When the batch is complete the line stops and waits for a new Start.</p>`,
    tips: tip('Reuse the L13 FIFO pattern with <code>I_Tall</code>. Count with an R_TRIG on <code>I_PE_End</code> or a CTU; <code>Start</code> resets the count.', 'Reuse the L13 rungs with <code>I_Tall</code>. A CTU box on <code>I_PE_End</code> (preset 5) and an NC <code>Batch.Q</code> in the belt rung; RES Batch on Start.'),
    task: `Run conveyor <b>C1</b> with <b>Start</b>/<b>Stop</b>. Push every <b>tall</b> part off with <b>Rej</b>. Short parts ride to the end. After <b>5</b> short parts pass the end photoeye, stop the belt and light <b>Done</b>. Start begins a new batch.` +
      IO_NOTE([['I_Start / I_Stop', 'Buttons (Stop NC)'], ['I_PE_Det, I_Tall', 'Detector photoeye + height sensor (0.8 m)'], ['I_PE_Rej', 'Photoeye at the pusher (2.65 m)'], ['I_PE_End', 'End photoeye (3.45 m)'],
        ['I_Rej_Ext / I_Rej_Ret', 'Pusher reed switches'], ['Q_C1_Run / Q_Rej_Ext', 'Belt, pusher'], ['Q_Done', 'Batch complete']]),
    layout: { components: [C('c1', 'conveyor', 'C1', -1.8, 0.5, { length: 3.6, speed: 0.3, interval: 2.4, tallPct: 40, metalPct: 0 }),
      C('rej', 'cylinder', 'Rej', 0, 0, { conveyor: 'c1', pos: 2.6, mode: 'push', stroke: 0.4 }),
      C('st', 'pushbutton', 'Start', -1.6, -1.2, { color: 'green' }), C('sp', 'pushbutton', 'Stop', -1.0, -1.2, { color: 'red' }), C('dn', 'pilot', 'Done', -0.3, -1.2, { color: 'green' })] },
    sensors: [DI('I_Start', 'st.pressed'), DI('I_Stop', 'sp.pressed', 'NC'), PE('I_PE_Det', 'c1.part', 800), PE('I_Tall', 'c1.tall', 800), PE('I_PE_Rej', 'c1.part', 2650), PE('I_PE_End', 'c1.part', 3450),
      DI('I_Rej_Ext', 'rej.ext'), DI('I_Rej_Ret', 'rej.ret')],
    st: { starter: ST('(* Capstone — sort and count *)\nVAR\n  Run  : BOOL;\n  Fifo : ARRAY[0..9] OF BOOL;\n  N    : INT;\nEND_VAR\n\n'),
      solution: ST(`VAR
  Run      : BOOL;
  Fifo     : ARRAY[0..9] OF BOOL;
  N        : INT;
  TallSeen : BOOL;
  DetOut   : F_TRIG;
  AtRej    : R_TRIG;
  St       : INT;     (* 0 conveying, 10 extend, 20 retract *)
  Batch    : CTU;
END_VAR
Run := (I_Start OR Run) AND I_Stop AND NOT Batch.Q;
Batch(CU := I_PE_End, R := I_Start, PV := 5);
IF I_PE_Det AND I_Tall THEN TallSeen := TRUE; END_IF;
DetOut(CLK := I_PE_Det);
IF DetOut.Q AND N <= 9 THEN Fifo[N] := TallSeen; N := N + 1; TallSeen := FALSE; END_IF;
AtRej(CLK := I_PE_Rej);
IF AtRej.Q AND N > 0 THEN
  IF BSR(Fifo, FALSE) THEN St := 10; END_IF;
  N := N - 1;
END_IF;
CASE St OF
  10: IF I_Rej_Ext THEN St := 20; END_IF;
  20: IF I_Rej_Ret THEN St := 0; END_IF;
END_CASE;
Q_C1_Run  := Run AND St = 0;
Q_Rej_Ext := St = 10;
Q_Done    := Batch.Q;
`),
      hints: ['Copy the L13 FIFO with I_Tall instead of I_Metal.', 'Batch(CU := I_PE_End, R := I_Start, PV := 5); and put AND NOT Batch.Q in the Run seal-in. Q_Done := Batch.Q;'] },
    ld: { starter: LDU('  Run  : BOOL;\n  Fifo : ARRAY[0..9] OF BOOL;\n  N    : INT;', []),
      solution: LDU('  Run      : BOOL;\n  Fifo     : ARRAY[0..9] OF BOOL;\n  N        : INT;\n  TallSeen : BOOL;\n  Reject   : BOOL;\n  St       : INT;\n  Batch    : CTU;', [
        R('New batch on Start', [[NO('I_Start')]], [O('RES', 'Batch')]),
        R('Belt seal-in, stops when the batch is done', [[NO('I_Start'), NO('I_Stop'), NC('Batch.Q')], [NO('Run'), NO('I_Stop'), NC('Batch.Q')]], [O('COIL', 'Run')]),
        R('Count short parts at the end', [[NO('I_PE_End')]], [O('CTU', 'Batch', '5')]),
        R('Remember tall while at the detector', [[NO('I_PE_Det'), NO('I_Tall')]], [O('SET', 'TallSeen')]),
        R('Part leaves the detector → FIFO', [[NE_('I_PE_Det'), CMP('N', '<=', '9')]], [O('ST', 'Fifo[N] := TallSeen'), O('ADD', 'N', '1', 'N'), O('RST', 'TallSeen')]),
        R('Part at the pusher ← FIFO', [[PE_('I_PE_Rej'), CMP('N', '>', '0')]], [O('MOV', 'Fifo[0]', 'Reject'), O('BSR', 'Fifo', 'FALSE'), O('SUB', 'N', '1', 'N')]),
        R('Tall → push', [[NO('Reject'), CMP('St', '=', '0')]], [O('MOV', '10', 'St'), O('RST', 'Reject')]),
        R('Extended → retract', [[CMP('St', '=', '10'), NO('I_Rej_Ext')]], [O('MOV', '20', 'St')]),
        R('Retracted → done', [[CMP('St', '=', '20'), NO('I_Rej_Ret')]], [O('MOV', '0', 'St')]),
        R('Belt', [[NO('Run'), CMP('St', '=', '0')]], [O('COIL', 'Q_C1_Run')]),
        R('', [[CMP('St', '=', '10')]], [O('COIL', 'Q_Rej_Ext')]),
        R('', [[NO('Batch.Q')]], [O('COIL', 'Q_Done')])]),
      hints: ['Start from your L13 rungs, with I_Tall.', 'CTU Batch (preset 5) on NO I_PE_End; RES Batch on I_Start; NC Batch.Q in the seal-in.'] },
    objectives: [
      { id: 'tall', text: 'Every tall part is pushed off', test: h => { h.tap('Start').run(80); const r = h.state('Rej').bin; return fail(r.n >= 2 && r.tall === r.n, `Reject bin: ${r.n} parts, ${r.tall} tall`); } },
      { id: 'short', text: 'Only short parts reach the end', test: h => { h.tap('Start').run(80); const e = h.state('C1').bin; return fail(e.n >= 3 && e.tall === 0, `End bin: ${e.n} parts, ${e.tall} tall`); } },
      { id: 'batch', text: 'Belt stops after exactly 5 short parts pass the end eye', test: h => {
        h.tap('Start'); const n0 = h.state('C1').bin.n; let n = 0, last = false; h.watch(() => { const v = !!h.tag('I_PE_End'); if (v && !last) n++; last = v; });
        if (h.until(() => h.out('Q_Done'), 150) < 0) return 'Done never lit'; h.run(1);
        return fail(n === 5 && !h.out('Q_C1_Run'), `${n} parts passed, belt ${h.out('Q_C1_Run') ? 'running' : 'stopped'}${n0 ? '' : ''}`); } },
      { id: 'restart', text: 'Start begins a new batch', test: h => { h.tap('Start'); if (h.until(() => h.out('Q_Done'), 150) < 0) return 'Done never lit'; h.tap('Start').run(0.5); return fail(!h.out('Q_Done') && h.out('Q_C1_Run'), 'New batch did not start'); } },
      { id: 'jam', text: 'No jams', test: h => { h.tap('Start'); return fail(h.always(() => !h.state('C1').items.some(i => i.state === 'jam'), 80), 'A part jammed at the pusher'); } },
    ],
  },

  // ═════════════════════════ Safety & diagnostics ═════════════════════════
  {
    id: 'S01', module: 'safety', title: 'Fail-to-start and fail-to-stop', minutes: 16,
    summary: 'Use the aux contact to catch a motor that ignores its command.',
    theory: `<p>A contactor can fail in two ways. It doesn't pull in (burnt coil, tripped breaker): the PLC thinks the motor runs, but it doesn't. Or it <b>welds</b> shut: the motor keeps running after Stop. Compare the command against the <b>auxiliary contact</b>:</p>
      <ul><li><b>Fail to start</b>: commanded ON, aux still OFF after 2 s. Drop the command and latch a fault.</li><li><b>Fail to stop</b>: commanded OFF, aux still ON after 3 s. Latch a fault so someone isolates the motor upstream.</li></ul>`,
    tips: tip('Two TONs: <code>TStart(IN := Run AND NOT I_M1_Running, PT := T#2s);</code> and the mirror for stop.', 'TON TStart on NO Run + NC I_M1_Running; TON TStop on NC Run + NO I_M1_Running; each .Q SETs its fault. NC FailStart sits in the Run seal-in.'),
    task: `<b>Start</b>/<b>Stop</b> run <b>M1</b>. Latch <b>Fault</b> if M1 doesn't confirm running within <b>2 s</b> (and drop the run command), or keeps running <b>3 s</b> after a stop. <b>Reset</b> clears the faults. After a fail-to-start, M1 needs Reset and a new Start.` +
      IO_NOTE([['I_Start / I_Stop / I_Reset', 'Buttons (Stop NC)'], ['I_M1_Running', 'Aux contact'], ['Q_M1_Run', 'Contactor'], ['Q_Fault', 'Fault lamp']]) +
      `<p class="small muted">To test: on the I/O tab, set the I_M1_Running sensor fault to stuck_off or stuck_on.</p>`,
    layout: { components: [C('st', 'pushbutton', 'Start', -1.8, -1.2, { color: 'green' }), C('sp', 'pushbutton', 'Stop', -1.2, -1.2, { color: 'red' }), C('rs', 'pushbutton', 'Reset', -0.6, -1.2, { color: 'blue' }),
      C('fl', 'pilot', 'Fault', 0.1, -1.2, { color: 'red' }), C('m1', 'motor', 'M1', 1, 0.6, { amps: 8 })] },
    sensors: [DI('I_Start', 'st.pressed'), DI('I_Stop', 'sp.pressed', 'NC'), DI('I_Reset', 'rs.pressed'), DI('I_M1_Running', 'm1.running')],
    st: { starter: ST('(* Fail-to-start / fail-to-stop *)\nVAR\n  Run       : BOOL;\n  FailStart : BOOL;\n  FailStop  : BOOL;\nEND_VAR\n\n'),
      solution: ST(`VAR
  Run       : BOOL;
  FailStart : BOOL;
  FailStop  : BOOL;
  TStart    : TON;
  TStop     : TON;
END_VAR
IF I_Reset THEN FailStart := FALSE; FailStop := FALSE; END_IF;
Run := (I_Start OR Run) AND I_Stop AND NOT FailStart;
TStart(IN := Run AND NOT I_M1_Running, PT := T#2s);
TStop(IN := NOT Run AND I_M1_Running, PT := T#3s);
IF TStart.Q THEN FailStart := TRUE; Run := FALSE; END_IF;
IF TStop.Q THEN FailStop := TRUE; END_IF;
Q_M1_Run := Run;
Q_Fault := FailStart OR FailStop;
`),
      hints: ['TStart(IN := Run AND NOT I_M1_Running, PT := T#2s); IF TStart.Q THEN FailStart := TRUE; Run := FALSE; END_IF;', 'Mirror it for the stop: TStop(IN := NOT Run AND I_M1_Running, PT := T#3s);'] },
    ld: { starter: LDU('  Run       : BOOL;\n  FailStart : BOOL;\n  FailStop  : BOOL;', []),
      solution: LDU('  Run       : BOOL;\n  FailStart : BOOL;\n  FailStop  : BOOL;\n  TStart    : TON;\n  TStop     : TON;', [
        R('Reset faults', [[NO('I_Reset')]], [O('RST', 'FailStart'), O('RST', 'FailStop')]),
        R('Run seal-in, dropped by a fail-to-start', [[NO('I_Start'), NO('I_Stop'), NC('FailStart')], [NO('Run'), NO('I_Stop'), NC('FailStart')]], [O('COIL', 'Run')]),
        R('Commanded but not running', [[NO('Run'), NC('I_M1_Running')]], [O('TON', 'TStart', 'T#2s')]),
        R('Stopped but still running', [[NC('Run'), NO('I_M1_Running')]], [O('TON', 'TStop', 'T#3s')]),
        R('', [[NO('TStart.Q')]], [O('SET', 'FailStart'), O('RST', 'Run')]),
        R('', [[NO('TStop.Q')]], [O('SET', 'FailStop')]),
        R('Outputs', [[NO('Run')]], [O('COIL', 'Q_M1_Run')]),
        R('', [[NO('FailStart')], [NO('FailStop')]], [O('COIL', 'Q_Fault')])]),
      hints: ['TON TStart on (NO Run, NC I_M1_Running); TON TStop on (NC Run, NO I_M1_Running).', 'TStart.Q → SET FailStart and RST Run; put NC FailStart in the seal-in.'] },
    objectives: [
      { id: 'run', text: 'Normal start and stop without faults', test: h => { for (let i = 0; i < 2; i++) { h.tap('Start').run(3); if (!h.sig('m1.running')) return 'M1 did not run'; h.tap('Stop').run(4); } return fail(!h.out('Q_Fault'), 'False fault'); } },
      { id: 'fts', text: 'Aux never makes: Fault in ~2 s and M1 command drops', test: h => { h.sensorFault('I_M1_Running', 'stuck_off'); h.tap('Start'); const t = h.until(() => h.out('Q_Fault'), 5); if (t < 0) return 'No fault'; return fail(t + 0.5 > 1.6 && t + 0.5 < 2.6 && !h.out('Q_M1_Run'), `Fault after ${(t + 0.5).toFixed(1)} s, command ${h.out('Q_M1_Run') ? 'still on' : 'off'}`); } },
      { id: 'latch', text: 'Fail-to-start stays latched; Reset + Start restarts', test: h => {
        h.sensorFault('I_M1_Running', 'stuck_off'); h.tap('Start').run(3); h.sensorFault('I_M1_Running', 'none'); h.tap('Start').run(1);
        if (h.out('Q_M1_Run') || !h.out('Q_Fault')) return 'Start worked without Reset';
        h.tap('Reset').tap('Start').run(1.5); return fail(h.out('Q_M1_Run') && !h.out('Q_Fault'), 'Did not restart after Reset + Start'); } },
      { id: 'ftp', text: 'Aux stays on after Stop: Fault within ~3 s', test: h => { h.tap('Start').run(2); h.sensorFault('I_M1_Running', 'stuck_on'); h.tap('Stop'); const t = h.until(() => h.out('Q_Fault'), 6); return fail(t > 2.3 && t < 3.6, t < 0 ? 'No fault' : `Fault after ${t.toFixed(1)} s`); } },
    ],
  },
  {
    id: 'S02', module: 'safety', title: 'First-out trip indication', minutes: 14,
    summary: 'When several trips cascade, show which one came first.',
    theory: `<p>When one fault trips a machine, others usually follow within milliseconds. Low oil pressure causes high temperature, then vibration. Plain alarm lamps show all three lit, and the operator can't tell the cause. A <b>first-out</b> panel latches only the <b>first</b> trip and ignores the rest until someone resets it.</p>
      <p>The trick: each first-out latch is only allowed to set while <b>no other</b> first-out latch is set.</p>`,
    tips: tip('Inside <code>IF NOT (FO1 OR FO2 OR FO3) THEN … END_IF</code>, latch the inputs with priority.', 'Three SET rungs: NO trip input + NC of the other two first-out bits. One RST rung with three RST coils on Reset.'),
    task: `Motor <b>M1</b> runs with <b>Start</b>/<b>Stop</b>, but only while none of the three trip switches (<b>LowOil</b>, <b>HighTemp</b>, <b>Vib</b>) is on. Any trip stops it. Light only the <b>first</b> trip's lamp (<b>OilFO</b>, <b>TempFO</b>, <b>VibFO</b>) and keep it until <b>Reset</b>.` +
      IO_NOTE([['I_LowOil / I_HighTemp / I_Vib', 'Trip switches (maintained, TRUE = tripped)'], ['I_Start / I_Stop / I_Reset', 'Buttons (Stop NC)'], ['Q_M1_Run', 'Motor'], ['Q_OilFO / Q_TempFO / Q_VibFO', 'First-out lamps']]),
    layout: { components: [C('t1', 'pushbutton', 'LowOil', -1.8, -1.3, { color: 'amber', latch: true }), C('t2', 'pushbutton', 'HighTemp', -1.2, -1.3, { color: 'amber', latch: true }),
      C('t3', 'pushbutton', 'Vib', -0.6, -1.3, { color: 'amber', latch: true }), C('l1', 'pilot', 'OilFO', 0.1, -1.3, { color: 'red' }), C('l2', 'pilot', 'TempFO', 0.6, -1.3, { color: 'red' }),
      C('l3', 'pilot', 'VibFO', 1.1, -1.3, { color: 'red' }), C('st', 'pushbutton', 'Start', -1.8, -0.6, { color: 'green' }), C('sp', 'pushbutton', 'Stop', -1.2, -0.6, { color: 'red' }),
      C('rs', 'pushbutton', 'Reset', -0.6, -0.6, { color: 'blue' }), C('m1', 'motor', 'M1', 1, 0.6, { amps: 20 })] },
    sensors: [DI('I_LowOil', 't1.pressed'), DI('I_HighTemp', 't2.pressed'), DI('I_Vib', 't3.pressed'), DI('I_Start', 'st.pressed'), DI('I_Stop', 'sp.pressed', 'NC'), DI('I_Reset', 'rs.pressed')],
    st: { starter: ST('(* First-out *)\nVAR\n  Run : BOOL;\n  FO1, FO2, FO3 : BOOL;   (* oil, temp, vibration *)\nEND_VAR\n\n'),
      solution: ST(`VAR
  Run : BOOL;
  FO1, FO2, FO3 : BOOL;   (* oil, temp, vibration *)
END_VAR
IF I_Reset THEN FO1 := FALSE; FO2 := FALSE; FO3 := FALSE; END_IF;
IF NOT (FO1 OR FO2 OR FO3) THEN
  FO1 := I_LowOil;
  FO2 := I_HighTemp AND NOT FO1;
  FO3 := I_Vib AND NOT FO1 AND NOT FO2;
END_IF;
Run := (I_Start OR Run) AND I_Stop AND NOT (I_LowOil OR I_HighTemp OR I_Vib);
Q_M1_Run := Run;
Q_OilFO := FO1;
Q_TempFO := FO2;
Q_VibFO := FO3;
`),
      hints: ['Only latch while none is latched: IF NOT (FO1 OR FO2 OR FO3) THEN FO1 := I_LowOil; FO2 := I_HighTemp AND NOT FO1; … END_IF;', 'Run := (I_Start OR Run) AND I_Stop AND NOT (I_LowOil OR I_HighTemp OR I_Vib);'] },
    ld: { starter: LDU('  Run : BOOL;\n  FO1 : BOOL;\n  FO2 : BOOL;\n  FO3 : BOOL;', []),
      solution: LDU('  Run : BOOL;\n  FO1 : BOOL;\n  FO2 : BOOL;\n  FO3 : BOOL;', [
        R('Reset', [[NO('I_Reset')]], [O('RST', 'FO1'), O('RST', 'FO2'), O('RST', 'FO3')]),
        R('First-out: oil', [[NO('I_LowOil'), NC('FO2'), NC('FO3')]], [O('SET', 'FO1')]),
        R('First-out: temperature', [[NO('I_HighTemp'), NC('FO1'), NC('FO3')]], [O('SET', 'FO2')]),
        R('First-out: vibration', [[NO('I_Vib'), NC('FO1'), NC('FO2')]], [O('SET', 'FO3')]),
        R('Run, dropped by any trip', [[NO('I_Start')], [NO('Run')]], [O('COIL', 'Run'), O('COIL', 'Q_M1_Run')]),
        R('Lamps', [[NO('FO1')]], [O('COIL', 'Q_OilFO')]),
        R('', [[NO('FO2')]], [O('COIL', 'Q_TempFO')]),
        R('', [[NO('FO3')]], [O('COIL', 'Q_VibFO')])].map(r => (r.comment === 'Run, dropped by any trip' ? Object.assign(r, { post: [NO('I_Stop'), NC('I_LowOil'), NC('I_HighTemp'), NC('I_Vib')] }) : r))),
      hints: ['Each SET rung: NO its trip input + NC the other two first-out bits.', 'Run: (Start OR Run) then Stop and NC of all three trips in series.'] },
    objectives: [
      { id: 'trip', text: 'A trip stops M1', test: h => { h.tap('Start').run(1).tap('Vib'); return fail(!h.out('Q_M1_Run'), 'M1 kept running'); } },
      { id: 'first', text: 'Only the first trip lights', test: h => { h.tap('Start').run(1).tap('HighTemp').run(0.5).tap('LowOil').tap('Vib'); return fail(h.out('Q_TempFO') && !h.out('Q_OilFO') && !h.out('Q_VibFO'), 'Wrong first-out lamps'); } },
      { id: 'hold', text: 'First-out stays after the trip clears', test: h => { h.tap('LowOil').run(0.3).tap('LowOil'); return fail(h.always(() => h.out('Q_OilFO'), 2), 'OilFO went out without Reset'); } },
      { id: 'reset', text: 'Reset clears; the next trip becomes first-out', test: h => { h.tap('LowOil').tap('LowOil').tap('Reset').run(0.3); if (h.out('Q_OilFO')) return 'OilFO still on'; h.tap('Vib'); return fail(h.out('Q_VibFO') && !h.out('Q_OilFO'), 'VibFO did not light'); } },
      { id: 'block', text: 'M1 can\'t start while a trip is present', test: h => { h.tap('HighTemp').tap('Start'); return fail(!h.out('Q_M1_Run'), 'M1 started with a trip'); } },
    ],
  },
  {
    id: 'S03', module: 'safety', title: 'Valve position discrepancy', minutes: 14,
    summary: 'Compare command and limit switches, with a travel allowance.',
    theory: `<p>Automated valves have <b>limit switches</b>: ZSO (open) and ZSC (closed). A <b>discrepancy</b> alarm compares them with the command: commanded open but ZSO not made, or commanded closed but ZSC not made. A valve takes time to stroke, so the alarm only raises after a <b>delay</b> longer than the travel time. The alarm latches until reset, but a reset can't clear it while the discrepancy is still there.</p>`,
    tips: tip('<code>Disc(IN := (I_Open_P1 AND NOT I_V1_ZSO) OR (NOT I_Open_P1 AND NOT I_V1_ZSC), PT := T#3s);</code>', 'A TON on two branches: (NO Open + NC ZSO) OR (NC Open + NC ZSC). SET Fault from Disc.Q; RST from Reset with NC Disc.Q in series.'),
    task: `Selector <b>Open</b> commands valve <b>V1</b> (travel 1.5 s). <b>Opened</b>/<b>Closed</b> lamps show its limit switches. If the position doesn't match the command for <b>3 s</b>, latch <b>ValveFault</b>. <b>Reset</b> clears it only once the valve agrees again.` +
      IO_NOTE([['I_Open_P1', 'Open selector'], ['I_V1_ZSO / I_V1_ZSC', 'Limit switches'], ['I_Reset', 'Reset'], ['Q_V1_Open', 'Solenoid'], ['Q_Opened / Q_Closed / Q_ValveFault', 'Lamps']]),
    layout: { components: [C('v1', 'valve', 'V1', 0.4, 0.4, { from: '@supply', to: '@drain', flow: 100, travel: 1.5 }), C('sw', 'selector', 'Open', -1.6, -1.2, { positions: '2', labels: 'CLOSE,OPEN' }),
      C('rs', 'pushbutton', 'Reset', -0.9, -1.2, { color: 'blue' }), C('lo', 'pilot', 'Opened', -0.2, -1.2, { color: 'green' }), C('lc', 'pilot', 'Closed', 0.4, -1.2, { color: 'white' }),
      C('lf', 'pilot', 'ValveFault', 1.0, -1.2, { color: 'red' })] },
    sensors: [DI('I_Open_P1', 'sw.p1'), DI('I_Reset', 'rs.pressed'), DI('I_V1_ZSO', 'v1.zso'), DI('I_V1_ZSC', 'v1.zsc')],
    st: { starter: ST('(* Valve discrepancy *)\nVAR\n  Fault : BOOL;\nEND_VAR\n\n'),
      solution: ST('VAR\n  Fault : BOOL;\n  Disc  : TON;\nEND_VAR\nQ_V1_Open := I_Open_P1;\nDisc(IN := (I_Open_P1 AND NOT I_V1_ZSO) OR (NOT I_Open_P1 AND NOT I_V1_ZSC), PT := T#3s);\nIF Disc.Q THEN Fault := TRUE; ELSIF I_Reset THEN Fault := FALSE; END_IF;\nQ_ValveFault := Fault;\nQ_Opened := I_V1_ZSO;\nQ_Closed := I_V1_ZSC;\n'),
      hints: ['The discrepancy condition is (Open AND NOT ZSO) OR (NOT Open AND NOT ZSC), delayed by a 3 s TON.', 'IF Disc.Q THEN Fault := TRUE; ELSIF I_Reset THEN Fault := FALSE; END_IF;'] },
    ld: { starter: LDU('  Fault : BOOL;', []),
      solution: LDU('  Fault : BOOL;\n  Disc  : TON;', [
        R('Command', [[NO('I_Open_P1')]], [O('COIL', 'Q_V1_Open')]),
        R('Position disagrees with the command', [[NO('I_Open_P1'), NC('I_V1_ZSO')], [NC('I_Open_P1'), NC('I_V1_ZSC')]], [O('TON', 'Disc', 'T#3s')]),
        R('', [[NO('Disc.Q')]], [O('SET', 'Fault')]),
        R('Reset only when healthy', [[NO('I_Reset'), NC('Disc.Q')]], [O('RST', 'Fault')]),
        R('Lamps', [[NO('Fault')]], [O('COIL', 'Q_ValveFault')]),
        R('', [[NO('I_V1_ZSO')]], [O('COIL', 'Q_Opened')]),
        R('', [[NO('I_V1_ZSC')]], [O('COIL', 'Q_Closed')])]),
      hints: ['TON Disc on two branches: (NO Open, NC ZSO) and (NC Open, NC ZSC).', 'SET Fault from Disc.Q; RST Fault from NO I_Reset + NC Disc.Q.'] },
    objectives: [
      { id: 'normal', text: 'Normal open/close: no fault during travel', test: h => { h.select('Open', 1); if (!h.always(() => !h.out('Q_ValveFault'), 5)) return 'Fault while opening'; if (!h.out('Q_Opened')) return 'Opened lamp off'; h.select('Open', 0); return fail(h.always(() => !h.out('Q_ValveFault'), 5) && h.out('Q_Closed'), 'Fault while closing or Closed lamp off'); } },
      { id: 'stuck', text: 'ZSO never makes: fault after ~3 s', test: h => { h.sensorFault('I_V1_ZSO', 'stuck_off'); h.select('Open', 1); const t = h.until(() => h.out('Q_ValveFault'), 6); return fail(t > 2.6 && t < 3.6, t < 0 ? 'No fault' : `Fault after ${t.toFixed(1)} s`); } },
      { id: 'closed', text: 'ZSC lost while closed: fault', test: h => { h.run(1); h.sensorFault('I_V1_ZSC', 'stuck_off'); return fail(h.until(() => h.out('Q_ValveFault'), 5) > 0, 'No fault'); } },
      { id: 'latch', text: 'Reset ignored while still wrong; clears once healthy', test: h => {
        h.sensorFault('I_V1_ZSO', 'stuck_off'); h.select('Open', 1).run(4); h.tap('Reset').run(0.3); if (!h.out('Q_ValveFault')) return 'Reset cleared the fault although the valve still disagrees';
        h.sensorFault('I_V1_ZSO', 'none'); h.run(1); if (!h.out('Q_ValveFault')) return 'Fault cleared on its own'; h.tap('Reset'); return fail(!h.out('Q_ValveFault'), 'Reset did not clear'); } },
    ],
  },
  {
    id: 'S04', module: 'safety', capstone: true, title: 'Capstone: guarded machine with diagnostics', minutes: 30,
    summary: 'Safety relay, fail-to-start, a stack light and an acknowledged horn.',
    theory: `<p>A production machine's control layer around the safety relay usually has:</p>
      <ul><li>A run latch that drops when the safety circuit opens (no unexpected restart).</li><li>Fail-to-start monitoring on the contactor.</li>
      <li>A <b>stack light</b> as standard: <b>green</b> running, <b>amber</b> needs attention (here: safety reset required), <b>red</b> fault.</li>
      <li>A <b>horn</b> that sounds when a new fault appears and stops when the operator <b>acknowledges</b> it, while the red light stays until the fault is reset.</li></ul>`,
    tips: tip('Reuse L16 and S01. The horn is its own latch: set on the rising edge of the fault, reset by Ack.', 'Reuse your L16 and S01 rungs. Horn: a P contact on FailStart SETs Horn; NO I_Ack RSTs it.'),
    task: `Run <b>M1</b> with <b>Start</b>/<b>Stop</b> through safety relay <b>SR1</b> (E-stop <b>ES1</b>, blue <b>Reset</b> wired to the relay). Latch <b>FailStart</b> if M1 doesn't confirm within 2 s. Stack light <b>SL</b>: green = M1 running (aux), amber = safety reset required, red = FailStart or relay fault. The horn sounds when FailStart latches, until <b>Ack</b>. <b>Ack</b> also clears FailStart once M1 isn't commanded.` +
      IO_NOTE([['I_Start / I_Stop / I_Ack', 'Buttons (Stop NC)'], ['I_SR1_OK / I_SR1_Fault', 'Safety relay status / fault'], ['I_M1_Running', 'Aux contact'], ['Q_M1_Run', 'Contactor (through SR1)'], ['Q_SL_Green / Amber / Red / Horn', 'Stack light']]) +
      `<p class="small muted">Press Reset once after power-up: the relay starts switched off.</p>`,
    layout: { components: [C('st', 'pushbutton', 'Start', -1.8, -1.2, { color: 'green' }), C('sp', 'pushbutton', 'Stop', -1.2, -1.2, { color: 'red' }), C('ak', 'pushbutton', 'Ack', -0.6, -1.2, { color: 'white' }),
      C('es', 'estop', 'ES1', 0.0, -1.2), C('rs', 'pushbutton', 'Reset', 0.6, -1.2, { color: 'blue' }), C('sl', 'stacklight', 'SL', 1.3, -1.2),
      C('sr', 'safetyrelay', 'SR1', -0.5, 0.2, { estop: 'es', reset: 'rs', mode: 'manual' }), C('m1', 'motor', 'M1', 1, 0.6, { amps: 12 })] },
    sensors: [DI('I_Start', 'st.pressed'), DI('I_Stop', 'sp.pressed', 'NC'), DI('I_Ack', 'ak.pressed'), DI('I_SR1_OK', 'sr.ok'), DI('I_SR1_Fault', 'sr.fault'), DI('I_M1_Running', 'm1.running')],
    st: { starter: ST('(* Capstone — guarded machine *)\nVAR\n  Run       : BOOL;\n  FailStart : BOOL;\n  Horn      : BOOL;\nEND_VAR\n\n'),
      solution: ST(`VAR
  Run       : BOOL;
  FailStart : BOOL;
  Horn      : BOOL;
  TStart    : TON;
  NewFault  : R_TRIG;
END_VAR
IF I_Ack THEN Horn := FALSE; FailStart := FailStart AND Run; END_IF;
Run := (I_Start OR Run) AND I_Stop AND I_SR1_OK AND NOT FailStart;
TStart(IN := Run AND NOT I_M1_Running, PT := T#2s);
IF TStart.Q THEN FailStart := TRUE; Run := FALSE; END_IF;
NewFault(CLK := FailStart);
IF NewFault.Q THEN Horn := TRUE; END_IF;
Q_M1_Run   := Run;
Q_SL_Green := I_M1_Running;
Q_SL_Amber := NOT I_SR1_OK AND NOT I_SR1_Fault;
Q_SL_Red   := FailStart OR I_SR1_Fault;
Q_SL_Horn  := Horn;
`),
      hints: ['Run := (I_Start OR Run) AND I_Stop AND I_SR1_OK AND NOT FailStart; plus the S01 timer.', 'NewFault(CLK := FailStart); IF NewFault.Q THEN Horn := TRUE; END_IF; and Ack clears Horn (and FailStart).'] },
    ld: { starter: LDU('  Run       : BOOL;\n  FailStart : BOOL;\n  Horn      : BOOL;', []),
      solution: LDU('  Run       : BOOL;\n  FailStart : BOOL;\n  Horn      : BOOL;\n  TStart    : TON;', [
        R('Acknowledge', [[NO('I_Ack')]], [O('RST', 'Horn')]),
        R('… and clear the fault when not commanded', [[NO('I_Ack'), NC('Run')]], [O('RST', 'FailStart')]),
        R('Run latch: safety circuit and fault in series', [[NO('I_Start')], [NO('Run')]], [O('COIL', 'Run')]),
        R('Fail-to-start timer', [[NO('Run'), NC('I_M1_Running')]], [O('TON', 'TStart', 'T#2s')]),
        R('', [[NO('TStart.Q')]], [O('SET', 'FailStart'), O('RST', 'Run')]),
        R('Horn on a new fault', [[PE_('FailStart')]], [O('SET', 'Horn')]),
        R('Outputs', [[NO('Run')]], [O('COIL', 'Q_M1_Run')]),
        R('', [[NO('I_M1_Running')]], [O('COIL', 'Q_SL_Green')]),
        R('', [[NC('I_SR1_OK'), NC('I_SR1_Fault')]], [O('COIL', 'Q_SL_Amber')]),
        R('', [[NO('FailStart')], [NO('I_SR1_Fault')]], [O('COIL', 'Q_SL_Red')]),
        R('', [[NO('Horn')]], [O('COIL', 'Q_SL_Horn')])].map(r => (r.comment.startsWith('Run latch') ? Object.assign(r, { post: [NO('I_Stop'), NO('I_SR1_OK'), NC('FailStart')] }) : r))),
      hints: ['Seal-in branch (Start OR Run), then Stop, SR1_OK and NC FailStart in series.', 'A P contact on FailStart SETs Horn; NO I_Ack RSTs Horn; NO I_Ack + NC Run RSTs FailStart.'] },
    objectives: [
      { id: 'run', text: 'After Reset, Start runs M1 with green', test: h => { h.tap('Reset').tap('Start').run(1.5); return fail(h.sig('m1.running') && h.out('Q_SL_Green') && !h.out('Q_SL_Amber'), 'M1 not running / wrong lights'); } },
      { id: 'estop', text: 'E-stop: M1 stops, amber after release, no restart', test: h => {
        h.tap('Reset').tap('Start').run(1.5); h.estop('ES1', true).run(0.5); h.estop('ES1', false).run(0.3);
        if (!h.out('Q_SL_Amber')) return 'No amber while the safety relay needs a reset';
        h.tap('Reset'); return fail(h.always(() => !h.sig('m1.running'), 3), 'M1 restarted after the E-stop reset'); } },
      { id: 'fts', text: 'Fail-to-start: red + horn, motor command dropped', test: h => { h.tap('Reset'); h.sensorFault('I_M1_Running', 'stuck_off'); h.tap('Start').run(3); return fail(h.out('Q_SL_Red') && h.out('Q_SL_Horn') && !h.out('Q_M1_Run'), 'Expected red + horn and the command off'); } },
      { id: 'ack', text: 'Ack silences the horn and clears the fault', test: h => { h.tap('Reset'); h.sensorFault('I_M1_Running', 'stuck_off'); h.tap('Start').run(3); h.sensorFault('I_M1_Running', 'none'); h.tap('Ack'); if (h.out('Q_SL_Horn')) return 'Horn still on'; if (h.out('Q_SL_Red')) return 'Red still on'; h.tap('Start').run(1.5); return fail(h.sig('m1.running'), 'M1 did not start after Ack'); } },
      { id: 'cross', text: 'Relay cross-fault shows red', test: h => { h.tap('Reset').run(0.2); h.fault('sr.weld'); h.estop('ES1', true).run(0.5); return fail(h.out('Q_SL_Red') && !h.out('Q_SL_Amber'), 'Expected red, no amber'); } },
    ],
  },

  // ═════════════════════════ Comms & SCADA ═════════════════════════
  {
    id: 'X01', module: 'scada', title: 'HMI command bits and a status word', minutes: 14,
    summary: 'Handle momentary HMI buttons the way SCADA systems really write them.',
    theory: `<p>An HMI or SCADA system talks to the PLC through <b>tags</b>, usually over Ethernet (Modbus TCP, EtherNet/IP, OPC UA). A button on a screen typically <b>sets</b> a BOOL and leaves it set. The PLC acts on it and then <b>clears it itself</b>, so a lost "release" message over a network can't leave a command stuck on.</p>
      <p>The other direction is a <b>status word</b>: one INT the HMI turns into text and colour (0 stopped, 1 running, 2 faulted).</p>`,
    tips: tip('<code>IF HMI_Start THEN Run := TRUE; HMI_Start := FALSE; END_IF;</code>', 'NO <code>HMI_Start</code> → SET Run and RST HMI_Start on the same rung. Status: MOV rungs in priority order, the last one wins.'),
    task: `There are no buttons, only the HMI. <b>HMI_Start</b> and <b>HMI_Stop</b> are set by the HMI. Act on them and clear them. Run <b>M1</b>. Write <b>Status</b>: 0 stopped, 1 running (aux contact), 2 overload. An overload drops the run command.` +
      IO_NOTE([['HMI_Start / HMI_Stop', 'BOOL, written by the HMI (given in Globals)'], ['Status', 'INT for the HMI (given)'], ['I_M1_Running', 'Aux contact'], ['I_M1_OL', 'Overload NC: TRUE = healthy'], ['Q_M1_Run', 'Contactor']]) +
      `<p class="small muted">Try it on the Tags tab: write TRUE to HMI_Start and watch it reset.</p>`,
    layout: { components: [C('m1', 'motor', 'M1', 1, 0.6, { amps: 10 })] },
    sensors: [DI('I_M1_Running', 'm1.running'), DI('I_M1_OL', 'm1.ol', 'NC')],
    st: { starter: ST('(* HMI command bits *)\nVAR\n  Run : BOOL;\nEND_VAR\n\n', VG('  HMI_Start : BOOL;\n  HMI_Stop  : BOOL;\n  Status    : INT;')),
      solution: ST('VAR\n  Run : BOOL;\nEND_VAR\nIF HMI_Start THEN Run := TRUE; HMI_Start := FALSE; END_IF;\nIF HMI_Stop OR NOT I_M1_OL THEN Run := FALSE; HMI_Stop := FALSE; END_IF;\nQ_M1_Run := Run;\nIF NOT I_M1_OL THEN Status := 2; ELSIF I_M1_Running THEN Status := 1; ELSE Status := 0; END_IF;\n', VG('  HMI_Start : BOOL;\n  HMI_Stop  : BOOL;\n  Status    : INT;')),
      hints: ['IF HMI_Start THEN Run := TRUE; HMI_Start := FALSE; END_IF;  (and the same for Stop, plus the overload)', 'IF NOT I_M1_OL THEN Status := 2; ELSIF I_M1_Running THEN Status := 1; ELSE Status := 0; END_IF;'] },
    ld: { starter: LDU('  HMI_Start : BOOL;\n  HMI_Stop  : BOOL;\n  Status    : INT;\n  Run       : BOOL;', []),
      solution: LDU('  HMI_Start : BOOL;\n  HMI_Stop  : BOOL;\n  Status    : INT;\n  Run       : BOOL;', [
        R('HMI start: act, then clear the bit', [[NO('HMI_Start')]], [O('SET', 'Run'), O('RST', 'HMI_Start')]),
        R('HMI stop or overload', [[NO('HMI_Stop')], [NC('I_M1_OL')]], [O('RST', 'Run'), O('RST', 'HMI_Stop')]),
        R('', [[NO('Run')]], [O('COIL', 'Q_M1_Run')]),
        R('Status word: last rung wins', [], [O('MOV', '0', 'Status')]),
        R('', [[NO('I_M1_Running')]], [O('MOV', '1', 'Status')]),
        R('', [[NC('I_M1_OL')]], [O('MOV', '2', 'Status')])]),
      hints: ['NO HMI_Start → SET Run, RST HMI_Start.', 'Status: an empty rung MOV 0, then NO I_M1_Running → MOV 1, then NC I_M1_OL → MOV 2.'] },
    objectives: [
      { id: 'start', text: 'HMI_Start runs M1 and is cleared', test: h => { h.write('HMI_Start', true).run(0.5); return fail(h.out('Q_M1_Run') && h.tag('HMI_Start') === false, `M1 ${h.out('Q_M1_Run') ? 'on' : 'off'}, HMI_Start = ${h.tag('HMI_Start')}`); } },
      { id: 'stop', text: 'HMI_Stop stops M1 and is cleared', test: h => { h.write('HMI_Start', true).run(1).write('HMI_Stop', true).run(0.5); return fail(!h.out('Q_M1_Run') && h.tag('HMI_Stop') === false, 'M1 still on or HMI_Stop not cleared'); } },
      { id: 'status', text: 'Status 0 stopped, 1 running', test: h => { h.run(0.5); if (h.tag('Status') !== 0) return `Status ${h.tag('Status')} while stopped`; h.write('HMI_Start', true).run(1.5); return fail(h.tag('Status') === 1, `Status ${h.tag('Status')} while running`); } },
      { id: 'ol', text: 'Overload: Status 2, M1 off, no restart after reset', test: h => {
        h.write('HMI_Start', true).run(1); h.fault('m1.jam').run(5); if (h.tag('Status') !== 2 || h.out('Q_M1_Run')) return `Status ${h.tag('Status')}, M1 ${h.out('Q_M1_Run') ? 'on' : 'off'}`;
        h.fault('m1.jam', false); h.ctl('M1', 'reset'); return fail(h.always(() => !h.out('Q_M1_Run'), 2), 'M1 restarted after the overload reset'); } },
    ],
  },
  {
    id: 'X02', module: 'scada', title: 'Local / Remote control', minutes: 14,
    summary: 'One selector decides who is in charge — and the local stop always works.',
    theory: `<p>Field equipment usually has a <b>Local/Remote</b> selector. In <b>Local</b> the panel buttons work and HMI commands are ignored. That protects someone working at the machine from a start in the control room. In <b>Remote</b> it's the other way round. Two rules hold in every mode:</p>
      <ul><li>The local <b>Stop</b> always works.</li><li>HMI command bits are <b>cleared every scan</b>, even when ignored. Otherwise a Start pressed on the HMI while in Local would sit there and fire the moment someone switches to Remote.</li></ul>`,
    tips: tip('Start conditions per mode, then <code>HMI_Start := FALSE; HMI_Stop := FALSE;</code> at the end of every scan.', 'SET Run from two branches (Local + I_Start, Remote + HMI_Start); RST Run from NC I_Stop or Remote + HMI_Stop; an empty rung with RST HMI_Start and RST HMI_Stop.'),
    task: `Pump <b>P1</b> starts from the panel <b>Start</b> in <b>Local</b>, or from <b>HMI_Start</b> in <b>Remote</b> (selector <b>Mode</b>). <b>HMI_Stop</b> stops it in Remote. The panel <b>Stop</b> always stops it. Clear the HMI bits every scan. The <b>RemoteLamp</b> shows Remote mode.` +
      IO_NOTE([['I_Mode_P1', 'Mode selector: TRUE = Remote'], ['I_Start / I_Stop', 'Panel buttons (Stop NC)'], ['HMI_Start / HMI_Stop', 'BOOL from the HMI (given)'], ['Q_P1_Run', 'Pump'], ['Q_RemoteLamp', 'Remote indicator']]),
    layout: { components: [C('md', 'selector', 'Mode', -1.8, -1.2, { positions: '2', labels: 'LOCAL,REMOTE' }), C('st', 'pushbutton', 'Start', -1.1, -1.2, { color: 'green' }),
      C('sp', 'pushbutton', 'Stop', -0.5, -1.2, { color: 'red' }), C('rl', 'pilot', 'RemoteLamp', 0.2, -1.2, { color: 'blue' }), C('p1', 'pump', 'P1', 1, 0.5, { from: '@supply', to: '@drain', flow: 100 })] },
    sensors: [DI('I_Mode_P1', 'md.p1'), DI('I_Start', 'st.pressed'), DI('I_Stop', 'sp.pressed', 'NC')],
    st: { starter: ST('(* Local / Remote *)\nVAR\n  Run : BOOL;\nEND_VAR\n\n', VG('  HMI_Start : BOOL;\n  HMI_Stop  : BOOL;')),
      solution: ST(`VAR
  Run : BOOL;
END_VAR
IF (I_Start AND NOT I_Mode_P1) OR (HMI_Start AND I_Mode_P1) THEN Run := TRUE; END_IF;
IF NOT I_Stop OR (HMI_Stop AND I_Mode_P1) THEN Run := FALSE; END_IF;
HMI_Start := FALSE;
HMI_Stop := FALSE;
Q_P1_Run := Run;
Q_RemoteLamp := I_Mode_P1;
`, VG('  HMI_Start : BOOL;\n  HMI_Stop  : BOOL;')),
      hints: ['IF (I_Start AND NOT I_Mode_P1) OR (HMI_Start AND I_Mode_P1) THEN Run := TRUE; END_IF;', 'The panel Stop works in both modes; clear HMI_Start and HMI_Stop unconditionally at the end.'] },
    ld: { starter: LDU('  HMI_Start : BOOL;\n  HMI_Stop  : BOOL;\n  Run       : BOOL;', []),
      solution: LDU('  HMI_Start : BOOL;\n  HMI_Stop  : BOOL;\n  Run       : BOOL;', [
        R('Start: panel in Local, HMI in Remote', [[NO('I_Start'), NC('I_Mode_P1')], [NO('HMI_Start'), NO('I_Mode_P1')]], [O('SET', 'Run')]),
        R('Stop: panel always, HMI in Remote', [[NC('I_Stop')], [NO('HMI_Stop'), NO('I_Mode_P1')]], [O('RST', 'Run')]),
        R('Clear HMI commands every scan', [], [O('RST', 'HMI_Start'), O('RST', 'HMI_Stop')]),
        R('', [[NO('Run')]], [O('COIL', 'Q_P1_Run')]),
        R('', [[NO('I_Mode_P1')]], [O('COIL', 'Q_RemoteLamp')])]),
      hints: ['SET Run from two branches: (Start, NC Mode) and (HMI_Start, NO Mode).', 'An empty rung (always true) with RST HMI_Start and RST HMI_Stop.'] },
    objectives: [
      { id: 'local', text: 'Local: panel works, HMI ignored', test: h => { h.tap('Start'); if (!h.out('Q_P1_Run')) return 'Panel Start did not work in Local'; h.write('HMI_Stop', true).run(0.3); if (!h.out('Q_P1_Run')) return 'HMI_Stop worked in Local'; h.tap('Stop').write('HMI_Start', true).run(0.5); return fail(!h.out('Q_P1_Run'), 'HMI_Start worked in Local'); } },
      { id: 'remote', text: 'Remote: HMI works, panel Start ignored', test: h => { h.select('Mode', 1).tap('Start'); if (h.out('Q_P1_Run')) return 'Panel Start worked in Remote'; h.write('HMI_Start', true).run(0.5); if (!h.out('Q_P1_Run')) return 'HMI_Start did not work'; h.write('HMI_Stop', true).run(0.5); return fail(!h.out('Q_P1_Run'), 'HMI_Stop did not work'); } },
      { id: 'stop', text: 'Panel Stop works in Remote', test: h => { h.select('Mode', 1).write('HMI_Start', true).run(0.5).tap('Stop'); return fail(!h.out('Q_P1_Run'), 'Pump kept running'); } },
      { id: 'stale', text: 'An HMI Start sent in Local doesn\'t fire after switching to Remote', test: h => { h.write('HMI_Start', true).run(1).select('Mode', 1); return fail(h.always(() => !h.out('Q_P1_Run'), 2), 'The stale HMI command started the pump'); } },
      { id: 'lamp', text: 'RemoteLamp follows the selector', test: h => { h.run(0.2); if (h.out('Q_RemoteLamp')) return 'Lamp on in Local'; h.select('Mode', 1).run(0.2); return fail(h.out('Q_RemoteLamp'), 'Lamp off in Remote'); } },
    ],
  },
  {
    id: 'X03', module: 'scada', title: 'Validating an HMI setpoint', minutes: 14, tabs: ['trend'], powerUpOK: true,
    summary: 'Never trust a number typed into a screen: clamp it, use it, and report back.',
    theory: `<p>Anything written from an HMI may be out of range: a typo, a wrong unit, a script bug. The PLC <b>validates</b> it. It clamps the value to safe engineering limits, uses only the clamped copy, and tells the HMI it did so. The operator then sees the setpoint actually in use, not just what they typed.</p>`,
    tips: tip('<code>SP := LIMIT(20.0, HMI_SP, 80.0);  Q_SPLimit := HMI_SP &lt;&gt; SP;</code>', 'MOV HMI_SP → SP on an empty rung, then compares that MOV 20.0 or 80.0 into SP. SUB/ADD give the switching points SP − 2 and SP + 2 for the deadband.'),
    task: `Keep tank <b>T1</b> at the HMI setpoint <b>HMI_SP</b> (%) with inlet <b>Fill</b>: open at ≤ SP − 2, close at ≥ SP + 2. Clamp the setpoint to <b>20–80 %</b> into <b>SP</b> and light <b>SPLimit</b> while clamping. The outlet follows <b>Demand</b>.` +
      IO_NOTE([['HMI_SP', 'REAL from the HMI (given, starts at 50)'], ['SP', 'REAL, the setpoint in use (given)'], ['AI_Level', 'Level %'], ['I_Demand_P1', 'Demand selector'], ['Q_Fill_Open / Q_Out_Open', 'Valves'], ['Q_SPLimit', 'Setpoint clamped lamp']]),
    layout: { components: [C('t1', 'tank', 'T1', 0.3, 0.4, { capacity: 300, level: 30 }), C('fv', 'valve', 'Fill', -1, 0.4, { from: '@supply', to: 't1', flow: 300 }),
      C('ov', 'valve', 'Out', 1.6, 0.4, { from: 't1', to: '@drain', flow: 150 }), C('sw', 'selector', 'Demand', -1.2, -1.2, { positions: '2', labels: 'OFF,ON' }), C('sl', 'pilot', 'SPLimit', -0.4, -1.2, { color: 'amber' })] },
    sensors: [AI('AI_Level', 't1.level', 0, 100, { noise: 0.2 }), DI('I_Demand_P1', 'sw.p1')],
    st: { starter: ST('(* HMI setpoint *)\nVAR\n  Filling : BOOL;\nEND_VAR\nQ_Out_Open := I_Demand_P1;   (* given *)\n\n', VG('  HMI_SP : REAL := 50.0;\n  SP     : REAL;')),
      solution: ST('VAR\n  Filling : BOOL;\nEND_VAR\nQ_Out_Open := I_Demand_P1;\nSP := LIMIT(20.0, HMI_SP, 80.0);\nQ_SPLimit := HMI_SP <> SP;\nIF AI_Level <= SP - 2.0 THEN Filling := TRUE; ELSIF AI_Level >= SP + 2.0 THEN Filling := FALSE; END_IF;\nQ_Fill_Open := Filling;\n', VG('  HMI_SP : REAL := 50.0;\n  SP     : REAL;')),
      hints: ['SP := LIMIT(20.0, HMI_SP, 80.0);  Q_SPLimit := HMI_SP <> SP;', 'IF AI_Level <= SP - 2.0 THEN Filling := TRUE; ELSIF AI_Level >= SP + 2.0 THEN Filling := FALSE; END_IF;'] },
    ld: { starter: LDU('  HMI_SP  : REAL := 50.0;\n  SP      : REAL;\n  Filling : BOOL;', [R('Given: outlet follows demand', [[NO('I_Demand_P1')]], [O('COIL', 'Q_Out_Open')])]),
      solution: LDU('  HMI_SP  : REAL := 50.0;\n  SP      : REAL;\n  Filling : BOOL;\n  Lo      : REAL;\n  Hi      : REAL;', [
        R('Given: outlet follows demand', [[NO('I_Demand_P1')]], [O('COIL', 'Q_Out_Open')]),
        R('Take the HMI value…', [], [O('MOV', 'HMI_SP', 'SP')]),
        R('… clamp low', [[CMP('HMI_SP', '<', '20.0')]], [O('MOV', '20.0', 'SP')]),
        R('… clamp high', [[CMP('HMI_SP', '>', '80.0')]], [O('MOV', '80.0', 'SP')]),
        R('Tell the HMI', [[CMP('HMI_SP', '<>', 'SP')]], [O('COIL', 'Q_SPLimit')]),
        R('Deadband ±2 %', [], [O('SUB', 'SP', '2.0', 'Lo'), O('ADD', 'SP', '2.0', 'Hi')]),
        R('', [[CMP('AI_Level', '<=', 'Lo')]], [O('SET', 'Filling')]),
        R('', [[CMP('AI_Level', '>=', 'Hi')]], [O('RST', 'Filling')]),
        R('', [[NO('Filling')]], [O('COIL', 'Q_Fill_Open')])]),
      hints: ['MOV HMI_SP → SP, then compare HMI_SP < 20.0 → MOV 20.0 → SP (and the same for 80).', 'Compare HMI_SP <> SP → Q_SPLimit. SUB SP − 2.0 → Lo, ADD SP + 2.0 → Hi, then SET/RST Filling.'] },
    objectives: [
      { id: 'track', text: 'Setpoint 60 with demand: level holds 55–65 %', test: h => { h.write('HMI_SP', 60).select('Demand', 1).run(90); return fail(h.always(() => { const l = h.sig('t1.level'); return l > 55 && l < 65; }, 120), `Level ${h.sig('t1.level').toFixed(1)} %`); } },
      { id: 'hi', text: 'HMI_SP 95 → SP 80 and SPLimit on', test: h => { h.write('HMI_SP', 95).run(0.3); return fail(near(h.tag('SP'), 80, 0.01) && h.out('Q_SPLimit'), `SP = ${h.tag('SP')}`); } },
      { id: 'lo', text: 'HMI_SP 5 → SP 20; back to 40 → lamp off', test: h => { h.write('HMI_SP', 5).run(0.3); if (!near(h.tag('SP'), 20, 0.01) || !h.out('Q_SPLimit')) return `SP = ${h.tag('SP')}`; h.write('HMI_SP', 40).run(0.3); return fail(near(h.tag('SP'), 40, 0.01) && !h.out('Q_SPLimit'), 'SP not 40 or lamp still on'); } },
      { id: 'clamped', text: 'An out-of-range setpoint can\'t overfill the tank', test: h => { h.write('HMI_SP', 150).run(120); return fail(h.sig('t1.level') < 86, `Level ${h.sig('t1.level').toFixed(1)} %`); } },
    ],
  },
  {
    id: 'X04', module: 'scada', capstone: true, title: 'Capstone: remote pump station', minutes: 30, tabs: ['trend'],
    summary: 'Local/Remote, HMI commands, a validated setpoint and a status word, all together.',
    theory: `<p>A typical unmanned pump station that a SCADA system supervises combines this module:</p>
      <ul><li>An <b>Auto</b> enable from the panel (Local) or from SCADA (Remote). HMI bits are cleared every scan, and the local Stop always works.</li>
      <li>Level control on a <b>validated</b> setpoint.</li><li>A <b>status word</b> for the SCADA screen.</li></ul>`,
    tips: tip('Reuse X02 for the enable and X03 for the setpoint; add the status IF/ELSIF.', 'Reuse your X02 and X03 rungs; status by MOV rungs in priority order.'),
    task: `<b>Auto</b> is enabled from the panel <b>Start</b> in Local, or <b>HMI_Start</b> in Remote, and disabled by panel <b>Stop</b> (any mode) or <b>HMI_Stop</b> (Remote). In Auto, pump <b>P1</b> keeps tank <b>T1</b> at the clamped setpoint <b>SP</b> = LIMIT(20, HMI_SP, 80), ±3 %. Write <b>Status</b>: 0 off, 1 Auto waiting, 2 Auto pumping. Outlet follows <b>Demand</b>.` +
      IO_NOTE([['I_Mode_P1', 'TRUE = Remote'], ['I_Start / I_Stop', 'Panel (Stop NC)'], ['HMI_Start / HMI_Stop / HMI_SP', 'From SCADA (given)'], ['SP / Status', 'To SCADA (given)'], ['AI_Level', 'Level %'], ['I_Demand_P1', 'Demand'], ['Q_P1_Run / Q_Out_Open / Q_AutoLamp', 'Pump, outlet, Auto lamp']]),
    layout: { components: [C('t1', 'tank', 'T1', 0.3, 0.4, { capacity: 300, level: 30 }), C('p1', 'pump', 'P1', -1.1, 0.5, { from: '@supply', to: 't1', flow: 300 }),
      C('ov', 'valve', 'Out', 1.6, 0.4, { from: 't1', to: '@drain', flow: 150 }), C('md', 'selector', 'Mode', -1.9, -1.2, { positions: '2', labels: 'LOCAL,REMOTE' }),
      C('st', 'pushbutton', 'Start', -1.2, -1.2, { color: 'green' }), C('sp', 'pushbutton', 'Stop', -0.6, -1.2, { color: 'red' }),
      C('dm', 'selector', 'Demand', 0.1, -1.2, { positions: '2', labels: 'OFF,ON' }), C('al', 'pilot', 'AutoLamp', 0.8, -1.2, { color: 'green' })] },
    sensors: [AI('AI_Level', 't1.level', 0, 100, { noise: 0.2 }), DI('I_Mode_P1', 'md.p1'), DI('I_Start', 'st.pressed'), DI('I_Stop', 'sp.pressed', 'NC'), DI('I_Demand_P1', 'dm.p1')],
    st: { starter: ST('(* Capstone — remote pump station *)\nVAR\n  Auto    : BOOL;\n  Filling : BOOL;\nEND_VAR\nQ_Out_Open := I_Demand_P1;   (* given *)\n\n', VG('  HMI_Start : BOOL;\n  HMI_Stop  : BOOL;\n  HMI_SP    : REAL := 50.0;\n  SP        : REAL;\n  Status    : INT;')),
      solution: ST(`VAR
  Auto    : BOOL;
  Filling : BOOL;
END_VAR
Q_Out_Open := I_Demand_P1;
IF (I_Start AND NOT I_Mode_P1) OR (HMI_Start AND I_Mode_P1) THEN Auto := TRUE; END_IF;
IF NOT I_Stop OR (HMI_Stop AND I_Mode_P1) THEN Auto := FALSE; END_IF;
HMI_Start := FALSE;
HMI_Stop := FALSE;
SP := LIMIT(20.0, HMI_SP, 80.0);
IF AI_Level <= SP - 3.0 THEN Filling := TRUE; ELSIF AI_Level >= SP + 3.0 THEN Filling := FALSE; END_IF;
Q_P1_Run := Auto AND Filling;
Q_AutoLamp := Auto;
IF Q_P1_Run THEN Status := 2; ELSIF Auto THEN Status := 1; ELSE Status := 0; END_IF;
`, VG('  HMI_Start : BOOL;\n  HMI_Stop  : BOOL;\n  HMI_SP    : REAL := 50.0;\n  SP        : REAL;\n  Status    : INT;')),
      hints: ['Enable Auto exactly like Run in X02; clamp SP like X03 with a ±3 % deadband.', 'Q_P1_Run := Auto AND Filling;  IF Q_P1_Run THEN Status := 2; ELSIF Auto THEN Status := 1; ELSE Status := 0; END_IF;'] },
    ld: { starter: LDU('  HMI_Start : BOOL;\n  HMI_Stop  : BOOL;\n  HMI_SP    : REAL := 50.0;\n  SP        : REAL;\n  Status    : INT;\n  Auto      : BOOL;\n  Filling   : BOOL;', [R('Given: outlet follows demand', [[NO('I_Demand_P1')]], [O('COIL', 'Q_Out_Open')])]),
      solution: LDU('  HMI_Start : BOOL;\n  HMI_Stop  : BOOL;\n  HMI_SP    : REAL := 50.0;\n  SP        : REAL;\n  Status    : INT;\n  Auto      : BOOL;\n  Filling   : BOOL;\n  Lo        : REAL;\n  Hi        : REAL;', [
        R('Given: outlet follows demand', [[NO('I_Demand_P1')]], [O('COIL', 'Q_Out_Open')]),
        R('Enable: panel in Local, SCADA in Remote', [[NO('I_Start'), NC('I_Mode_P1')], [NO('HMI_Start'), NO('I_Mode_P1')]], [O('SET', 'Auto')]),
        R('Disable: panel Stop always, SCADA in Remote', [[NC('I_Stop')], [NO('HMI_Stop'), NO('I_Mode_P1')]], [O('RST', 'Auto')]),
        R('Clear SCADA commands', [], [O('RST', 'HMI_Start'), O('RST', 'HMI_Stop')]),
        R('Validated setpoint', [], [O('MOV', 'HMI_SP', 'SP')]),
        R('', [[CMP('HMI_SP', '<', '20.0')]], [O('MOV', '20.0', 'SP')]),
        R('', [[CMP('HMI_SP', '>', '80.0')]], [O('MOV', '80.0', 'SP')]),
        R('Deadband ±3 %', [], [O('SUB', 'SP', '3.0', 'Lo'), O('ADD', 'SP', '3.0', 'Hi')]),
        R('', [[CMP('AI_Level', '<=', 'Lo')]], [O('SET', 'Filling')]),
        R('', [[CMP('AI_Level', '>=', 'Hi')]], [O('RST', 'Filling')]),
        R('Pump', [[NO('Auto'), NO('Filling')]], [O('COIL', 'Q_P1_Run')]),
        R('', [[NO('Auto')]], [O('COIL', 'Q_AutoLamp')]),
        R('Status: last rung wins', [], [O('MOV', '0', 'Status')]),
        R('', [[NO('Auto')]], [O('MOV', '1', 'Status')]),
        R('', [[NO('Q_P1_Run')]], [O('MOV', '2', 'Status')])]),
      hints: ['Reuse the X02 enable rungs (on Auto) and the X03 setpoint rungs (±3).', 'Pump: NO Auto + NO Filling. Status: empty rung MOV 0, NO Auto → MOV 1, NO Q_P1_Run → MOV 2.'] },
    objectives: [
      { id: 'local', text: 'Local Start: Auto holds the level at SP 50 (±6)', test: h => { h.tap('Start').select('Demand', 1).run(60); if (!h.out('Q_AutoLamp')) return 'Auto not enabled'; return fail(h.always(() => near(h.sig('t1.level'), 50, 6), 90), `Level ${h.sig('t1.level').toFixed(1)} %`); } },
      { id: 'remote', text: 'Remote: SCADA enables/disables, panel Start ignored', test: h => { h.select('Mode', 1).tap('Start').run(0.3); if (h.out('Q_AutoLamp')) return 'Panel Start worked in Remote'; h.write('HMI_Start', true).run(0.3); if (!h.out('Q_AutoLamp')) return 'HMI_Start did not enable Auto'; h.write('HMI_Stop', true).run(0.3); return fail(!h.out('Q_AutoLamp'), 'HMI_Stop did not disable Auto'); } },
      { id: 'stale', text: 'Stale SCADA command ignored; panel Stop always works', test: h => { h.write('HMI_Start', true).run(1).select('Mode', 1).run(1); if (h.out('Q_AutoLamp')) return 'Stale HMI_Start enabled Auto'; h.write('HMI_Start', true).run(0.5).tap('Stop'); return fail(!h.out('Q_AutoLamp') && !h.out('Q_P1_Run'), 'Panel Stop did not disable Auto'); } },
      { id: 'sp', text: 'Setpoint 95 is clamped to 80: no overfill', test: h => { h.write('HMI_SP', 95).tap('Start').run(120); return fail(near(h.tag('SP'), 80, 0.01) && h.sig('t1.level') < 86, `SP ${h.tag('SP')}, level ${h.sig('t1.level').toFixed(1)} %`); } },
      { id: 'status', text: 'Status 0 off, 2 pumping, 1 waiting', test: h => { h.run(0.3); if (h.tag('Status') !== 0) return `Status ${h.tag('Status')} when off`; h.tap('Start').run(0.5); if (h.tag('Status') !== 2) return `Status ${h.tag('Status')} while pumping`; h.until(() => !h.out('Q_P1_Run'), 60); h.run(0.3); return fail(h.tag('Status') === 1, `Status ${h.tag('Status')} while waiting`); } },
    ],
  },
];

module.exports = { NEW };
