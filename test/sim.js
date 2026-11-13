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
