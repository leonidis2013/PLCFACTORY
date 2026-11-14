'use strict';
// Each challenge: broken state must fail; repaired state (no setup, no hidden faults) must pass.
const plants = require('../server/plants');
const { grade } = require('../server/engine/grader');
const { CHALLENGES } = require('../server/curriculum/challenges');
const { normalizeProject } = require('../server/engine/runtime');
let bad = 0;
for (const c of CHALLENGES) {
  const base = () => normalizeProject(Object.assign({ scen: c.plant, actFaults: {} }, plants[c.plant].defaults()));
  const broken = base(); if (c.setup) c.setup(broken);
  const r1 = grade(plants, broken, c.objectives, { hidden: c.hidden || { sensors: {}, acts: {} } });
  const r2 = grade(plants, base(), c.objectives, { hidden: { sensors: {}, acts: {} } });
  const ok = r1.some(r => !r.pass) && r2.every(r => r.pass);
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${c.id} ${c.title.padEnd(36)} broken ${r1.filter(r => r.pass).length}/${r1.length}  fixed ${r2.filter(r => r.pass).length}/${r2.length}`, r2.filter(r => !r.pass).map(r => r.msg).join('; '), '|', r1.map(r => r.msg).join('; '));
}
if (bad) process.exit(1);
