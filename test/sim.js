'use strict';
// Headless check: run each scenario's example program and report what the plant did.
const { Runtime } = require('../server/engine/runtime');
const plants = require('../server/plants');

function run(id, seconds, script) {
  const rt = new Runtime(plants);
  const d = plants[id].defaults();
  const r = rt.load(Object.assign({ scen: id, actFaults: {} }, d));
  if (!r.ok) { console.log(id, 'COMPILE ERROR', r); process.exit(1); }
  rt.setMode('RUN');
  const dt = 50;
  for (let t = 0; t < seconds * 1000; t += dt) {
    if (script) script(rt, t / 1000);
    rt.scan(dt);
    if (rt.plc === 'FAULT') { console.log(id, 'PLC FAULT', rt.fault); break; }
  }
  return rt;
}
const pulse = (rt, tag, t, at) => { if (Math.abs(t - at) < 0.01) rt.write(tag, true); if (Math.abs(t - at - 0.3) < 0.01) rt.write(tag, false); };
const T = (rt, n) => rt.tags[n.toUpperCase()].v;

// Tank
{
  const rt = run('tank', 240, (rt, t) => pulse(rt, 'HMI_Start', t, 1));
  console.log('tank: batches', T(rt, 'BatchCount'), 'step', T(rt, 'Step'), 'level', rt.st.level.toFixed(1), 'temp', rt.st.temp.toFixed(1), 'msgs', rt.st.msgs);
}
// Conveyor
{
  const rt = run('conveyor', 120, (rt, t) => pulse(rt, 'HMI_Start', t, 1));
  console.log('conveyor: counts', rt.st.cnt, 'tall', T(rt, 'TallCount'), 'short', T(rt, 'ShortCount'), 'fault', T(rt, 'Fault'));
}
// Vial filler
{
  const rt = run('vialfiller', 300, (rt, t) => { pulse(rt, 'HMI_Decon', t, 5); pulse(rt, 'HMI_Start', t, 150); });
  const s = rt.st;
  console.log('vial: sterile', s.sterile, 'decon', T(rt, 'Decon'), 'step', T(rt, 'Step'), 'cnt', s.cnt, 'good(plc)', T(rt, 'Good'), 'rej', T(rt, 'Rejected'),
    'h2o2', s.h2o2.toFixed(2), 'dp', s.dp.toFixed(1), 'part', s.part.toFixed(0), 'lastW', T(rt, 'LastWeight'), 'msgs', s.msgs, s.lastBad || '');
}
// Bioreactor
{
  let log = [];
  const rt = run('bioreactor', 700, (rt, t) => {
    pulse(rt, 'HMI_Start', t, 1);
    if (Math.abs(t % 20) < 0.025) {
      const v = rt.def.view(rt.st);
      log.push(`t=${t.toFixed(0)} ph=${T(rt, 'Phase')} V=${v.V.toFixed(1)} T=${v.T.toFixed(1)} p=${v.p.toFixed(2)} DO=${v.DO.toFixed(0)} pH=${v.pH.toFixed(2)} X=${v.X.toFixed(2)} S=${v.S.toFixed(2)} C=${v.C.toFixed(4)} foam=${v.foam.toFixed(1)} ster=${v.sterile}`);
    }
  });
  console.log(log.join('\n'));
  console.log('bio:', rt.st.msgs, 'batches', T(rt, 'Batches'));
}

// Language features: UDTs, arrays, shift registers, bit access, ladder
{
  const C = require('../server/engine/compiler');
  const LD = require('../server/engine/ladder');
  const tags = {};
  const ld = LD.toST({ name: 'L', rungs: [
    { rows: [[{ t: 'NO', a: 'In' }]], outs: [{ t: 'BSL', a: 'Reg', b: 'Bit' }, { t: 'CTU', a: 'Cnt', b: '3' }] },
    { rows: [[{ t: 'NO', a: 'Cnt.Q' }], [{ t: 'CMP', a: 'Reg[2]', op: '=', b: 'TRUE' }]], outs: [{ t: 'COIL', a: 'Out' }] },
  ] }, 1);
  const r = C.compileUnits([
    { name: 'Data types', src: 'TYPE Rec : STRUCT A : BOOL; N : INT; END_STRUCT; END_TYPE' },
    { name: 'Globals', src: 'VAR_GLOBAL In, Bit, Out : BOOL; Reg : ARRAY[0..3] OF BOOL; Cnt : CTU; W : DINT; R : ARRAY[1..3] OF Rec; END_VAR' },
    { name: 'ST', src: 'W := SHL(W, 1); W.0 := Bit; R[1].N := R[1].N + 1; BSL(R, R[1]);' },
    { name: 'L', src: ld.src },
  ], tags);
  C.RT.dt = 50;
  const seq = [[1, 1], [0, 0], [1, 0], [0, 0], [1, 1], [0, 0]];
  for (const [i, b] of seq) { tags.IN.v = !!i; tags.BIT.v = !!b; r.fn(); }
  const ok = JSON.stringify(tags.REG.v) === '[true,false,true,false]' && tags.CNT.fb.CV === 3 && tags.OUT.v === true && tags.W.v === 34 && tags.R.v[2].N === 5;
  console.log('language:', ok ? 'OK' : 'FAIL', JSON.stringify({ reg: tags.REG.v, cv: tags.CNT.fb.CV, out: tags.OUT.v, w: tags.W.v, r: tags.R.v.map(x => x.N) }));
  if (!ok) process.exit(1);
}
