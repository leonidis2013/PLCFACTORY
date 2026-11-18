'use strict';
// Live network: I/O wired to racks; an unplugged cable / powered-off rack faults its I/O.
const { Runtime } = require('../server/engine/runtime');
const plants = require('../server/plants');
const { LESSONS } = require('../server/curriculum/lessons');
const L = LESSONS.find(x => x.id === 'F02');   // Start / Stop(NC) / Jog → M1
const ok = (c, m) => { if (!c) { console.log('FAIL network:', m); process.exit(1); } console.log('ok   network:', m); };
const sol = JSON.parse(JSON.stringify(L.solution));
sol.pous[0].src += 'Q_Alarm := NOT NET_RIO1_OK;\n';   // the program can watch the rack's connection
const rt = new Runtime(plants);
const proj = Object.assign({ scen: 'sandbox', layout: L.layout, sensors: L.sensors, hmi: [], alarms: [], pens: [], actFaults: {} }, sol);
proj.layout = JSON.parse(JSON.stringify(proj.layout)); proj.layout.components.push({ id: 'al', type: 'pilot', name: 'Alarm', x: 1, y: -1, rot: 0, props: { color: 'red' } });
ok(!rt.load(proj).ok, 'NET_RIO1_OK unknown without a network');
// controller with only an ENET-less CPU + DO module locally; inputs live on a remote rack
const net = { devices: [
  { id: 'p', type: 'plc', name: 'PLC1', x: 0, y: 0, ip: '192.168.1.10', rack: ['CPU', 'DO16'] },
  { id: 's', type: 'sw', name: 'SW1', x: 0, y: 0, ip: '' },
  { id: 'r', type: 'rio', name: 'RIO1', x: 0, y: 0, ip: '192.168.1.20', rack: ['ADPT', 'DI16'] },
  { id: 'c', type: 'scada', name: 'PC1', x: 0, y: 0, ip: '192.168.1.50' }],
  links: [{ a: 'p', b: 's' }, { a: 's', b: 'r' }, { a: 's', b: 'c' }] };
const r = rt.setNetwork(net); ok(r.ok, 'program compiles once the network defines NET_RIO1_OK');
ok(rt.net.assign.I_Start === 'RIO1:1:I.0' && rt.net.assign.Q_M1_Run === 'PLC1:1:O.0', `wiring ${rt.net.assign.I_Start}, ${rt.net.assign.Q_M1_Run}`);
rt.setMode('RUN');
const run = s => { for (let t = 0; t < s * 1000; t += 50) rt.scan(50); };
rt.def.doAction(rt.st, 'ctl:st:press', true); run(0.3); rt.def.doAction(rt.st, 'ctl:st:press', false); run(0.5);
ok(rt.outputs().Q_M1_Run === true, 'Start on the remote rack runs M1');
net.links[1].down = true; rt.setNetwork(JSON.parse(JSON.stringify(net))); run(0.3);
ok(rt.io.I_STOP.v === false && rt.outputs().Q_M1_Run === false, 'unplugging the rack: inputs read 0, the NC Stop drops the seal-in (fail-safe)');
ok(rt.io.NET_RIO1_OK.v === false && rt.outputs().Q_Alarm === true, 'connection bit FALSE, program raises its alarm');
delete net.links[1].down; net.devices[2].off = true; rt.setNetwork(JSON.parse(JSON.stringify(net))); run(0.3);
ok(rt.net.why.r === 'powered off', 'powered-off rack is offline');
delete net.devices[2].off; net.devices[2].ip = '192.168.2.20'; rt.setNetwork(JSON.parse(JSON.stringify(net)));
ok(rt.net.why.r === 'different subnet', 'wrong subnet is offline');
net.devices[2].ip = '192.168.1.20'; net.devices[0].rack = ['CPU']; rt.setNetwork(JSON.parse(JSON.stringify(net)));
ok(/not wired/.test(rt.net.bad.Q_M1_Run), 'no output module: the contactor is not wired');
net.devices[0].rack = ['CPU', 'DO16']; net.links[2].down = true; rt.setNetwork(JSON.parse(JSON.stringify(net)));
ok(rt.net.scada === false && rt.net.online.r === true, 'unplugged PC: SCADA offline, rack still online');
