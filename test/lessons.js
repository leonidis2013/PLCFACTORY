'use strict';
// Every lesson's solution must pass all objectives; its starter must fail at least one.
const plants = require('../server/plants');
const { grade } = require('../server/engine/grader');
const { LESSONS } = require('../server/curriculum/lessons');
let bad = 0;
const proj = (L, units) => Object.assign({ scen: 'sandbox', layout: L.layout, sensors: L.sensors, hmi: [], alarms: [], pens: [], actFaults: {} }, JSON.parse(JSON.stringify(units)));
for (const L of LESSONS) {
  const sol = grade(plants, proj(L, L.solution), L.objectives);
  const st = grade(plants, proj(L, L.starter), L.objectives);
  const solOk = sol.every(r => r.pass), stFails = st.some(r => !r.pass);
  if (!solOk || !stFails) bad++;
  console.log(`${solOk && stFails ? 'ok  ' : 'FAIL'} ${L.id} ${L.title.padEnd(42)} solution ${sol.filter(r => r.pass).length}/${sol.length}  starter ${st.filter(r => r.pass).length}/${st.length}`);
  for (const r of sol) if (!r.pass) console.log('       ✗', r.text, '—', r.msg);
}
if (bad) process.exit(1);
