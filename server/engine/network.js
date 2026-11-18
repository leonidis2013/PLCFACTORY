'use strict';
/* Network & racks, live. When a project has a network with a controller, every I/O point is wired to a
   module channel (local chassis first, then remote racks, in order). A module whose rack is not
   reachable — unplugged cable, switch or rack powered off, bad / duplicate / wrong-subnet IP, too
   few ports — is faulted: its inputs read 0 and its outputs go to their safe state (off). */

const PORTS = { plc: 1, rio: 2, sw: 8, hmi: 1, scada: 1, vfd: 1 };
const CH = { DI16: ['DI', 16], DO16: ['DO', 16], AI8: ['AI', 8], AO4: ['AO', 4] };
const ipOk = ip => /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(ip || '') && ip.split('.').every(n => +n <= 255) && !/\.(0|255)$/.test(ip);
const net24 = ip => ip.split('.').slice(0, 3).join('.');
const sysName = d => 'NET_' + String(d.name || d.id).replace(/[^A-Za-z0-9_]/g, '_') + '_OK';

/** points: [{ tag, k: 'DI'|'AI'|'DO'|'AO' }] in wiring order */
function evaluate(network, points) {
  const n = network || {}, devices = Array.isArray(n.devices) ? n.devices : [], links = Array.isArray(n.links) ? n.links : [];
  const plc = devices.find(d => d.type === 'plc');
  const res = { active: !!plc, online: {}, why: {}, assign: {}, bad: {}, sys: {}, hmi: null, scada: null };
  if (!plc) return res;
  // which cables are actually usable: plugged in, and within each end's port count (first come, first served)
  const nPorts = d => (PORTS[d.type] || 1) + (Array.isArray(d.rack) ? d.rack.filter(m => m === 'ENET').length : 0);
  const byId = Object.fromEntries(devices.map(d => [d.id, d])), usedP = {};
  const adj = {}; devices.forEach(d => (adj[d.id] = []));
  for (const l of links) {
    const a = byId[l.a], b = byId[l.b]; if (!a || !b || l.down) continue;
    usedP[a.id] = (usedP[a.id] || 0) + 1; usedP[b.id] = (usedP[b.id] || 0) + 1;
    if (usedP[a.id] > nPorts(a) || usedP[b.id] > nPorts(b)) continue;
    if (a.off || b.off) continue;
    adj[a.id].push(b.id); adj[b.id].push(a.id);
  }
  // addressing
  const ipCount = {}; devices.forEach(d => { if (d.type !== 'sw' && ipOk(d.ip)) ipCount[d.ip] = (ipCount[d.ip] || 0) + 1; });
  const addrErr = d => {
    if (d.type === 'sw') return '';
    if (!ipOk(d.ip)) return 'invalid IP address';
    if (ipCount[d.ip] > 1) return `duplicate IP ${d.ip}`;
    if (d !== plc && ipOk(plc.ip) && net24(d.ip) !== net24(plc.ip)) return 'different subnet';
    return '';
  };
  const plcErr = plc.off ? 'controller powered off' : addrErr(plc);
  const reach = new Set();
  if (!plc.off) { reach.add(plc.id); const q = [plc.id]; while (q.length) for (const x of adj[q.shift()]) if (!reach.has(x)) { reach.add(x); q.push(x); } }
  for (const d of devices) {
    let why = '';
    if (d === plc) why = plcErr && plcErr !== 'controller powered off' ? plcErr : '';
    else if (d.off) why = 'powered off';
    else if (!reach.has(d.id)) why = 'no network path to the controller';
    else if (plcErr) why = 'controller ' + plcErr;
    else why = addrErr(d);
    res.online[d.id] = !why; if (why) res.why[d.id] = why;
    if (d.type !== 'sw' && d !== plc) res.sys[sysName(d)] = !why;
  }
  // wiring: the local chassis never loses its own I/O; remote racks only while online
  const racks = [plc, ...devices.filter(d => d.type === 'rio')];
  const free = { DI: [], DO: [], AI: [], AO: [] };
  for (const d of racks) (Array.isArray(d.rack) ? d.rack : []).forEach((m, slot) => { const c = CH[m]; if (c) for (let ch = 0; ch < c[1]; ch++) free[c[0]].push({ dev: d.id, name: d.name, slot, ch, mod: m }); });
  for (const p of points) {
    const at = free[p.k] && free[p.k].shift();
    if (!at) { res.bad[p.tag] = 'not wired — no free channel'; continue; }
    res.assign[p.tag] = `${at.name}:${at.slot}:${p.k[1] === 'I' ? 'I' : 'O'}.${at.ch}`;
    const d = byId[at.dev];
    if (d !== plc && !res.online[d.id]) res.bad[p.tag] = `${d.name} offline (${res.why[d.id]})`;
    else if (d === plc && plc.off) res.bad[p.tag] = 'controller powered off';
  }
  const anyOn = t => { const ds = devices.filter(d => d.type === t); return ds.length ? ds.some(d => res.online[d.id]) : null; };
  res.hmi = anyOn('hmi'); res.scada = anyOn('scada');
  return res;
}

module.exports = { evaluate, sysName };
