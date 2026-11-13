'use strict';
/* Learning content */
const LEARN = (() => {
  const EX = {
    tank: `<h3>Exercises — Tank</h3><ol>
      <li><b>Fill timeout.</b> Add a <code>TON</code> that faults the system if step 10 lasts more than 30 s. Test it with the process fault <i>Inlet supply lost</i>.</li>
      <li><b>Backup high-high.</b> Set the I/O fault <i>stuck_off</i> on <code>I_LSH</code>. The tank overflows. Add an independent trip on <code>AI_Level &gt; 95</code>.</li>
      <li><b>Valve feedback.</b> In the I/O tab, add discrete sensors for <i>Inlet valve fully open</i> and <i>fully closed</i>. Raise a "valve failed to open" alarm when the command and the feedback disagree for more than 3 s. Test it with the actuator fault <i>stuck_off</i> on <code>Q_InletValve</code>.</li>
      <li><b>4–20 mA.</b> Change <code>AI_Level</code> to the <i>4–20 mA</i> format. Scale it yourself to % in your program, and detect a wire break (&lt; 3.8 mA). Try the <i>wire_break</i> fault.</li>
      <li><b>Tune the temperature loop</b> (see "PID tuning" below). Use the disturbance button to dump 10 L of cold water in. How fast does your loop recover?</li>
      <li><b>Auto/Manual.</b> Add an HMI switch <code>HMI_Manual</code> plus buttons that run the valve and pump by hand, with interlocks still active.</li></ol>`,
    conveyor: `<h3>Exercises — Conveyor</h3><ol>
      <li><b>Count with a CTU.</b> Count boxes leaving at <code>I_PE_Exit</code> using an <code>R_TRIG</code> and a <code>CTU</code>. Show the count on the HMI with a reset button.</li>
      <li><b>Jam detection.</b> Fault if <code>I_PE_Sort</code> stays blocked for more than 3 s while the belt runs.</li>
      <li><b>Move a sensor.</b> In the I/O tab, drag the PE-2 / HT-2 position 150 mm downstream and see what breaks. Then fix the program (or add a delay) without moving it back.</li>
      <li><b>Lost air.</b> Turn on <i>Pusher air supply lost</i>. The stroke watchdog should catch it. Make the fault message say <i>which</i> limit switch never made.</li>
      <li><b>Accumulate.</b> Stop the infeed when 3 boxes are waiting between PE-1 and PE-2. You need a counter that counts up and down.</li></ol>`,
    vialfiller: `<h3>Exercises — Aseptic vial filler</h3>
      <p>Start-up: press <b>START DECON</b> on the HMI and wait for gassing → dwell → aeration (~2 min). Then press <b>START</b>. The scoreboard grades every vial. A bad vial that gets <i>accepted</i> is the worst outcome in a sterile plant.</p><ol>
      <li><b>Sterility loss rejects the line.</b> Open the isolator door (after aeration) while vials are on the belt, then decon and restart. Some open, filled vials get <i>accepted</i> even though they were exposed. After any loss of sterility, mark every vial in the machine bad.</li>
      <li><b>Pump wear.</b> Turn on <i>Pump tubing worn</i>. The fill-to-weight loop still works but gets slower. Add an alarm when a fill takes more than 3 s. Then try filling by time instead of weight and see why weight control matters.</li>
      <li><b>Preact learning.</b> Calculate the overshoot of each fill (<code>LastWeight − FillSP</code>) and adapt <code>Preact</code> automatically, e.g. Preact := Preact + 0.2 × overshoot.</li>
      <li><b>Scan time matters.</b> In the menu, set the PLC cycle to 200 ms. The belt overshoots the in-position cam and the needles hit misaligned vials. Find a fix: slow down near position, or use a different sensor.</li>
      <li><b>Glove breach.</b> Turn on <i>Glove port breach</i>. Which signals tell you? Write a pressure-decay "leak test" step that runs before production.</li>
      <li><b>Door interlock.</b> Prove the door can't be opened while H₂O₂ &gt; 1 ppm. What happens if you force <code>Q_DoorLock</code> FALSE? (Don't do that on a real machine.)</li></ol>`,
    bioreactor: `<h3>Exercises — Bioreactor</h3>
      <p>Press <b>START</b>. The recipe charges media, runs steam-in-place (SIP) at 121 °C, cools, inoculates, ferments and harvests. A full batch takes about 7 minutes.</p><ol>
      <li><b>The vacuum trap.</b> In phase 40, comment out the air and run a batch. As the steam condenses the vessel goes under vacuum, pulls unsterile air in, and the culture gets contaminated (watch pH and OD at harvest). Fix it with air or the vent filter.</li>
      <li><b>Valve feedback.</b> Add ZSO/ZSC sensors (I/O tab → discrete → XV-05 …) for the steam and harvest valves. Fault the recipe if a valve doesn't reach position within 3 s. Test with actuator faults.</li>
      <li><b>Temperature PID.</b> Replace the on/off jacket control with a PID and split-range output (0–50 % cold valve, 50–100 % hot valve). Since the valves are on/off, use time-proportioning: a 4 s cycle.</li>
      <li><b>Tune the DO loop.</b> Raise <code>DO_SP</code> to 50 % in the middle of the batch and compare KP/TN settings on the trend (pens <code>AI_DO</code>, <code>DOPID.Y</code>).</li>
      <li><b>Fed-batch.</b> When glucose drops below 2 g/L, feed with <code>Q_P04_Feed</code>/<code>AO_FeedRate</code> to hold it at 1 g/L. Compare harvested product with the plain batch.</li>
      <li><b>Foam.</b> Antifoam currently doses while the probe is wet. Change it to a 2 s pulse followed by a 10 s wait (<code>TP</code> + <code>TON</code>) and see if foam still stays below the probe.</li></ol>`,
  };

  function html(info, meta) {
    const scen = info ? info.scen : 'tank';
    return `
<h2>Welcome to PLCFACTORY</h2>
<p>This is a soft PLC running IEC 61131-3 <b>Structured Text</b> against simulated plants. It runs on the server, so it keeps running when you close the browser, and every browser you connect sees the same live PLC. You write the program, build the HMI, configure the sensors, and the plant reacts physically.</p>
<ol><li><b>Program</b>: edit, then <b>Download</b>. Compile errors point at the line.</li>
<li>Press <b>▶ RUN</b> in the header. In STOP every output is forced off.</li>
<li>Use the <b>HMI</b> or the <b>Plant</b> operator panel (START / STOP / E-STOP) to operate.</li>
<li>Watch the <b>Trend</b>, acknowledge <b>Alarms</b>, poke values in <b>Tags</b>, and break things in <b>I/O</b>.</li></ol>

<h2>The scan cycle</h2>
<p>Every cycle (default 50 ms) the PLC does three things in order:</p>
<ol><li><b>Reads inputs</b> into the input image: the sensors you configured.</li>
<li><b>Executes your program</b> top to bottom, once.</li>
<li><b>Writes outputs</b> to the plant: motors, valves, pumps.</li></ol>
<p>Nothing happens "in between". If you write <code>Q_Pump := TRUE;</code> and later in the same scan <code>Q_Pump := FALSE;</code>, the pump never starts: the last write wins. Timers advance by the scan time. Edge detectors (<code>R_TRIG</code>) are TRUE for exactly one scan.</p>

<h2>Tags</h2>
<table><tr><th>Prefix</th><th>Kind</th><th>Comes from</th></tr>
<tr><td><code>I_…</code></td><td>Digital input (DI)</td><td>Your sensor list (I/O tab)</td></tr>
<tr><td><code>AI_…</code></td><td>Analog input (AI)</td><td>Your sensor list (I/O tab)</td></tr>
<tr><td><code>Q_…</code></td><td>Digital output (DO)</td><td>Fixed: wired to the plant</td></tr>
<tr><td><code>AO_…</code></td><td>Analog output (AO)</td><td>Fixed: wired to the plant</td></tr>
<tr><td>anything else</td><td>Memory</td><td>Your <code>VAR … END_VAR</code> declarations</td></tr></table>
<p>HMI buttons should write <b>memory</b> tags (like <code>HMI_Start</code>), never inputs. Inputs are overwritten from the field every scan.</p>

<h2>Normally-closed contacts: why STOP is FALSE when pressed</h2>
<p>Stop buttons and E-stops are wired <b>NC</b> (normally closed). The PLC input is TRUE while everything is healthy and goes FALSE when the button is pressed. It also goes FALSE when a wire breaks. That makes the circuit <b>fail-safe</b>: a cut wire stops the machine instead of silently disabling the stop button. Try the <i>wire_break</i> fault on <code>I_Stop</code> in the I/O tab.</p>

<h2>Flexible sensors (I/O tab)</h2>
<ul><li><b>Analog transmitter</b>: pick the measured variable, range, noise and output format. <i>Engineering</i> gives REAL in units. <i>4–20 mA</i> gives REAL mA, and you scale it: <code>PV := (mA − 4) / 16 × span + low</code>. <i>Raw</i> gives INT 0–27648 like a Siemens analog card.</li>
<li><b>Switch</b>: a level, pressure or temperature switch on any analog value, with setpoint and hysteresis.</li>
<li><b>Discrete</b>: limit switches, aux contacts, door switches and valve position feedback (ZSO/ZSC).</li>
<li><b>Position sensor</b>: photoeyes and cameras placed anywhere along a line, in mm.</li>
<li><b>Faults</b>: stuck, drift, noisy, fail low/high and wire break. They apply live, so you can test whether your logic notices.</li></ul>

<h2>Structured Text cheat sheet</h2>
<pre>VAR
  Count   : INT := 0;
  Speed   : REAL := 50.0;
  Delay   : TON := (PT := T#5s);        (* function block with initial values *)
  Loop1   : PID := (KP := 2.0, TN := 30.0);
END_VAR

Motor := Start OR (Motor AND NOT Stop);   // seal-in
Delay(IN := Motor, PT := T#3s);           // call FBs every scan
IF Delay.Q THEN Lamp := TRUE; END_IF;

CASE Step OF
  0:      IF Start THEN Step := 10; END_IF;
  10, 11: Step := Step + 1;
  20..29: ;                              // ranges and empty statements
ELSE
  Step := 0;
END_CASE;

FOR i := 1 TO 10 BY 1 DO Sum := Sum + i; END_FOR;
Out := LIMIT(0.0, In * 2.0, 100.0);
Pct := INT_TO_REAL(Raw) / 27648.0 * 100.0;</pre>
<p>Operators: <code>:=</code> assign · <code>= &lt;&gt; &lt; &gt; &lt;= &gt;=</code> · <code>AND OR XOR NOT</code> · <code>+ - * / MOD</code>. Time literals: <code>T#500ms</code>, <code>T#2s</code>, <code>T#1m30s</code>. Comments: <code>(* … *)</code> and <code>// …</code>.</p>
<p>Function blocks: ${meta ? Object.keys(meta.fbTypes).map(k => `<code>${k}</code>`).join(' ') : ''}. Functions: <code>ABS SQRT MIN MAX LIMIT SEL TRUNC SIN COS EXP LN</code> and conversions like <code>REAL_TO_INT</code>. System tags: <code>FirstScan</code>, <code>ScanCount</code>.</p>
<p><b>Warm vs cold download:</b> <i>Download</i> keeps variable and timer values (online change). <i>Cold</i> resets everything to the initial values in your VAR block. Use cold after changing an initial value such as a PID's KP.</p>

<h2>PID tuning</h2>
<p><code>PID</code> uses the ideal form: <b>Y = KP · ( e + (1/TN)·∫e dt + TV · de/dt )</b>, with e = SETPOINT − ACTUAL (or reversed with <code>REVERSE := TRUE</code>). TN and TV are in seconds; TN = 0 turns integral action off. The derivative acts on the measurement (no setpoint kick) and is filtered. The integral stops winding up when the output is limited (anti-windup). <code>MANUAL := TRUE</code> holds <code>Y_MANUAL</code> and switching back to auto is bumpless. <code>RESET := TRUE</code> clears the integral.</p>
<p><b>Tune live:</b> add a <i>PID faceplate</i> to the HMI (Edit → PID faceplate → tag = your PID name). Then edit KP/TN/TV while watching the Trend. Pens can show the PID's internals, e.g. <code>TempPID.Y</code>, <code>TempPID.P</code>, <code>TempPID.I</code>. Don't pass KP/TN/TV in the PID call, or the program overwrites your tuning every scan.</p>
<h3>Method 1: open-loop step test (lambda / IMC)</h3>
<ol><li>Put the PID in <b>MAN</b> and let the process settle.</li>
<li>Step the output, e.g. 20 % → 40 % (ΔY = 20 %).</li>
<li>On the trend, measure the <b>dead time θ</b> (from the step until the PV starts moving), the <b>time constant τ</b> (until 63 % of the final change), and the <b>process gain K = ΔPV / ΔY</b>.</li>
<li>Pick a closed-loop time constant λ (start with λ = τ for a calm loop, λ = θ for an aggressive one). Then <b>TN = τ</b> and <b>KP = τ / (K · (λ + θ))</b>.</li></ol>
<p>If the process keeps rising after a step instead of levelling off (an integrating process, like a heated tank with little loss), measure the slope instead. With slope r = ΔPV/s per % of ΔY, use KP ≈ 1 / (r · (λ + θ)) and TN ≈ 2λ + θ.</p>
<h3>Method 2: Ziegler–Nichols ultimate gain</h3>
<ol><li>Set TN = 0 and TV = 0 (P only), in AUTO.</li>
<li>Raise KP until the PV oscillates with a constant amplitude. That KP is <b>Ku</b>; the oscillation period is <b>Pu</b>.</li>
<li>Then use PI: KP = 0.45 Ku, TN = Pu / 1.2. For PID: KP = 0.6 Ku, TN = Pu / 2, TV = Pu / 8.</li></ol>
<p>Ziegler–Nichols is deliberately aggressive (¼ decay ratio). For process plants, back KP off 30–50 %.</p>
<h3>Reading the trend</h3>
<ul><li>Slow, sluggish approach with no overshoot: raise KP or shorten TN.</li>
<li>Overshoot that rings: lower KP or lengthen TN.</li>
<li>Fast, small oscillation: too much KP or TV, often amplified by measurement noise.</li>
<li>A steady offset with TN = 0 is normal for P-only control. That is what the integral term removes.</li>
<li>The output sits at 0 % or 100 % (<code>LIMITS_ACTIVE</code>): the loop can't do any more. Check the actuator, not the tuning.</li></ul>
<p>Good loops to practise on: <b>Tank</b> <code>TempPID</code> (heater power, ~3 s sensor lag plus heater lag; use the cold-water disturbance button) and <b>Bioreactor</b> <code>DOPID</code> (split-range agitator/air; the load rises as the culture grows).</p>

${EX[scen] || ''}

<h2>SCADA: connect real software</h2>
<p>The container runs a <b>Modbus TCP server</b>. The address map is in the I/O tab. Point any Modbus client at the server's IP on port 502 (as published by the compose file), for example Ignition, FUXA, Node-RED, Codesys as a Modbus master, or a phone Modbus app. Then build a "real" SCADA screen against your simulated PLC. Coils are writable, so your SCADA can press <code>HMI_Start</code>.</p>

<h2>How this maps to real PLCs</h2>
<ul><li><b>Codesys</b> (and Beckhoff TwinCAT, Schneider, WAGO…) uses the same IEC 61131-3 ST syntax. Most of what you write here pastes straight in.</li>
<li><b>Siemens TIA Portal SCL</b> is very close. Variables are written <code>"Tag"</code> or <code>#Local</code>, timers are <code>IEC_TIMER</code> instances, and analog cards give 0–27648 (try the <i>raw</i> format).</li>
<li><b>Rockwell Studio 5000</b> Structured Text is similar. Timers are <code>TONR</code>/<code>TON</code> with <code>.PRE</code>/<code>.ACC</code>/<code>.DN</code>, and PID is <code>PIDE</code>.</li>
<li><b>Arduino Opta / Arduino PLC IDE</b> uses IEC 61131-3 including ST and ladder, so these exercises carry over directly.</li></ul>
<p>Ladder logic is the same logic drawn differently: <code>Motor := (Start OR Motor) AND NOT Stop;</code> is one rung with a seal-in contact.</p>`;
  }
  return { html };
})();
