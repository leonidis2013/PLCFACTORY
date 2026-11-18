'use strict';
/* Network & rack builder (free play). Devices on an Ethernet network, cables through switches,
   and controller / remote I/O chassis with I/O modules. "Verify" checks it like a configuration tool would. */
const NET = (() => {
  const TYPES = {
    plc: { label: 'Controller', short: 'PLC', ports: 1, rack: true, slot0: 'CPU', w: 150, color: '#0a6ebd' },
    rio: { label: 'Remote I/O rack', short: 'RIO', ports: 2, rack: true, slot0: 'ADPT', w: 150, color: '#2f9e44' },
    sw: { label: 'Ethernet switch', short: 'SW', ports: 8, w: 170, color: '#56606b' },
    hmi: { label: 'HMI panel', short: 'HMI', ports: 1, w: 120, color: '#7048e8' },
    scada: { label: 'SCADA / engineering PC', short: 'PC', ports: 1, w: 130, color: '#c2255c' },
    vfd: { label: 'Drive (VFD)', short: 'VFD', ports: 1, w: 110, color: '#e8590c' },
  };
  const MODS = {
    '': { label: 'Empty', ch: 0 }, DI16: { label: '16-pt DC input', ch: 16, k: 'DI' }, DO16: { label: '16-pt DC output', ch: 16, k: 'DO' },
    AI8: { label: '8-ch analog in (4–20 mA)', ch: 8, k: 'AI' }, AO4: { label: '4-ch analog out', ch: 4, k: 'AO' }, ENET: { label: 'Ethernet module (+1 port)', ch: 0, k: 'NET' },
    CPU: { label: 'Controller CPU (embedded Ethernet)', ch: 0 }, ADPT: { label: 'Ethernet adapter', ch: 0 },
  };
  const H = 64;
  let host = null, o = null, net = null, sel = null, selLink = null, connectFrom = null, drag = null, saveT = 0, issues = null;
  const uid = () => 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const clone = x => JSON.parse(JSON.stringify(x));
  const dev = id => net.devices.find(d => d.id === id);
  const ports = d => TYPES[d.type].ports + (d.rack ? d.rack.filter(m => m === 'ENET').length : 0);
  const used = d => net.links.filter(l => l.a === d.id || l.b === d.id).length;

  function nextIp() { const have = new Set(net.devices.map(d => d.ip)); for (let i = 10; i < 250; i++) { const ip = '192.168.1.' + i; if (!have.has(ip)) return ip; } return ''; }
  function add(type, x, y) {
    const t = TYPES[type], n = net.devices.filter(d => d.type === type).length + 1;
    const d = { id: uid(), type, name: `${t.short}${n}`, x: x == null ? 60 + (net.devices.length % 5) * 180 : x, y: y == null ? 60 + Math.floor(net.devices.length / 5) * 120 : y, ip: type === 'sw' ? '' : nextIp() };
    if (t.rack) d.rack = type === 'plc' ? ['CPU', 'DI16', 'DO16', '', ''] : ['ADPT', 'DI16', 'DO16', ''];
    net.devices.push(d); sel = d.id; selLink = null; changed();
  }
  function starter() {
    net = { devices: [], links: [] };
    add('plc', 40, 50); add('sw', 260, 50); add('hmi', 500, 10); add('scada', 500, 120); add('rio', 260, 230);
    const [p, s, h, c, r] = net.devices; net.links.push({ a: p.id, b: s.id }, { a: s.id, b: h.id }, { a: s.id, b: c.id }, { a: s.id, b: r.id });
    p.ip = '192.168.1.10'; sel = p.id; changed();
  }

  // ---------- verify ----------
  function verify() {
    const E = [], W = [], info = [];
    const plcs = net.devices.filter(d => d.type === 'plc');
    if (!plcs.length) E.push('No controller on the network — add a PLC.');
    const ipOk = ip => /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(ip) && ip.split('.').every(n => +n <= 255) && !/\.(0|255)$/.test(ip);
    const seen = {};
    for (const d of net.devices) {
      if (d.type === 'sw') continue;
      if (!ipOk(d.ip || '')) E.push(`${d.name}: "${d.ip || '(none)'}" is not a valid host address.`);
      else if (seen[d.ip]) E.push(`Duplicate IP ${d.ip}: ${seen[d.ip]} and ${d.name}. Both devices will drop off the network.`); else seen[d.ip] = d.name;
      if (plcs[0] && ipOk(d.ip || '') && ipOk(plcs[0].ip || '') && d.ip.split('.').slice(0, 3).join('.') !== plcs[0].ip.split('.').slice(0, 3).join('.'))
        E.push(`${d.name} (${d.ip}) is on a different subnet from ${plcs[0].name} (${plcs[0].ip}, /24). It can't be reached without a router.`);
    }
    for (const d of net.devices) if (used(d) > ports(d)) E.push(`${d.name} has ${used(d)} cables but only ${ports(d)} port${ports(d) > 1 ? 's' : ''}${d.rack ? ' — add an ENET module' : ''}.`);
    // reachability through the cable graph
    const adj = {}; net.devices.forEach(d => (adj[d.id] = [])); net.links.forEach(l => { if (adj[l.a] && adj[l.b]) { adj[l.a].push(l.b); adj[l.b].push(l.a); } });
    if (plcs[0]) {
      const reach = new Set([plcs[0].id]), q = [plcs[0].id];
      while (q.length) for (const n of adj[q.shift()]) if (!reach.has(n)) { reach.add(n); q.push(n); }
      for (const d of net.devices) if (!reach.has(d.id)) (d.type === 'rio' ? E : W).push(`${d.name} is not connected to ${plcs[0].name}${d.type === 'rio' ? ' — its I/O will show a connection fault' : ''}.`);
    }
    // loops between switches (no ring protocol configured) → broadcast storm
    const swIds = new Set(net.devices.filter(d => d.type === 'sw').map(d => d.id)), swLinks = net.links.filter(l => swIds.has(l.a) && swIds.has(l.b));
    const parent = {}; const f = x => (parent[x] === undefined || parent[x] === x ? (parent[x] = x) : (parent[x] = f(parent[x])));
    for (const l of swLinks) { const a = f(l.a), b = f(l.b); if (a === b) { W.push('Switches are cabled in a loop. Without a ring protocol (DLR/RSTP) that causes a broadcast storm.'); break; } parent[a] = b; }
    const pairs = new Set(); for (const l of net.links) { const k = [l.a, l.b].sort().join(); if (pairs.has(k)) W.push(`Two cables between ${dev(l.a).name} and ${dev(l.b).name}.`); pairs.add(k); }
    if (plcs.length > 1) W.push('More than one controller: each owns its own I/O; only the first one is checked against this project.');
    // I/O capacity vs the project's I/O
    const cap = { DI: 0, DO: 0, AI: 0, AO: 0 };
    for (const d of net.devices) if (d.rack) for (const m of d.rack) { const k = (MODS[m] || {}).k; if (cap[k] !== undefined) cap[k] += MODS[m].ch; }
    const sens = (S.info && S.info.project && S.info.project.sensors) || [], outs = Object.keys((S.snap && S.snap.out) || {});
    const need = { DI: sens.filter(s => s.type !== 'analog').length, AI: sens.filter(s => s.type === 'analog').length, DO: outs.filter(n => /^Q_/i.test(n)).length, AO: outs.filter(n => /^AO_/i.test(n)).length };
    for (const k of ['DI', 'DO', 'AI', 'AO']) { info.push(`${k}: ${need[k]} used of ${cap[k]}`); if (need[k] > cap[k]) E.push(`Not enough ${k} channels: this machine uses ${need[k]}, the racks provide ${cap[k]}.`); }
    for (const d of net.devices) if (d.rack && d.rack.slice(1).every(m => !m)) W.push(`${d.name}'s chassis has no I/O modules.`);
    return { E, W, info };
  }

  // ---------- drawing ----------
  function portPos(d, i) { const t = TYPES[d.type], n = ports(d); return [d.x + (t.w / (n + 1)) * (i + 1), d.y + H]; }
  function linkEnds(l) {
    const a = dev(l.a), b = dev(l.b); if (!a || !b) return null;
    const ia = net.links.filter(x => x.a === a.id || x.b === a.id).indexOf(l), ib = net.links.filter(x => x.a === b.id || x.b === b.id).indexOf(l);
    return [portPos(a, Math.min(ia, ports(a) - 1)), portPos(b, Math.min(ib, ports(b) - 1))];
  }
  function svg() {
    const maxX = Math.max(700, ...net.devices.map(d => d.x + TYPES[d.type].w + 40)), maxY = Math.max(420, ...net.devices.map(d => d.y + H + 60));
    const links = net.links.map((l, i) => { const e = linkEnds(l); if (!e) return ''; const [[x1, y1], [x2, y2]] = e, my = Math.max(y1, y2) + 26;
      return `<path d="M${x1} ${y1} C${x1} ${my} ${x2} ${my} ${x2} ${y2}" class="cable${selLink === i ? ' sel' : ''}" data-link="${i}"/>`; }).join('');
    const devs = net.devices.map(d => { const t = TYPES[d.type], n = ports(d);
      const pts = Array.from({ length: n }, (_, i) => { const [px, py] = portPos(d, i); return `<rect x="${px - 5}" y="${py - 5}" width="10" height="8" rx="1" class="port${i < used(d) ? ' used' : ''}"/>`; }).join('');
      const rack = d.rack ? `<g>${d.rack.map((m, i) => `<rect x="${d.x + 8 + i * 13}" y="${d.y + 34}" width="11" height="20" class="slot ${m ? 'm-' + m : 'empty'}"/>`).join('')}</g>` : '';
      return `<g class="dev${sel === d.id ? ' sel' : ''}${connectFrom === d.id ? ' from' : ''}" data-dev="${d.id}">
        <rect x="${d.x}" y="${d.y}" width="${t.w}" height="${H}" rx="4" class="body"/><rect x="${d.x}" y="${d.y}" width="5" height="${H}" fill="${t.color}"/>
        <text x="${d.x + 12}" y="${d.y + 17}" class="nm">${esc(d.name)}</text><text x="${d.x + t.w - 8}" y="${d.y + 17}" class="ty" text-anchor="end">${t.short}</text>
        ${d.type !== 'sw' ? `<text x="${d.x + 12}" y="${d.y + (d.rack ? 27 : 36)}" class="ip">${esc(d.ip || 'no IP')}</text>` : `<text x="${d.x + 12}" y="${d.y + 36}" class="ip">${used(d)}/${n} ports</text>`}${rack}${pts}</g>`; }).join('');
    return `<svg class="netsvg" viewBox="0 0 ${maxX} ${maxY}">${links}${devs}</svg>`;
  }
  function props() {
    if (selLink !== null && net.links[selLink]) { const l = net.links[selLink]; return `<div class="netprops"><b>Cable</b> ${esc(dev(l.a).name)} ↔ ${esc(dev(l.b).name)}<button data-act="dellink" class="danger">Delete cable</button></div>`; }
    const d = sel && dev(sel); if (!d) return '<div class="netprops muted small">Select a device to edit it. Use <b>Connect</b>, then click two devices to run a cable.</div>';
    const t = TYPES[d.type];
    const rack = d.rack ? `<div class="chassis"><div class="ch-h">Chassis · ${d.rack.length} slots <span class="row"><button data-act="slots-">−</button><button data-act="slots+">＋ slot</button></span></div><div class="ch-slots">${d.rack.map((m, i) => `<label class="chs ${m ? 'm-' + m : 'empty'}"><span>Slot ${i}</span>${i === 0 ? `<b>${t.slot0}</b><small>${MODS[t.slot0].label}</small>` : `<select data-slot="${i}" ${o.editable ? '' : 'disabled'}>${Object.entries(MODS).filter(([k]) => k !== 'CPU' && k !== 'ADPT').map(([k, v]) => `<option value="${k}" ${k === m ? 'selected' : ''}>${k || '—'} ${v.label}</option>`).join('')}</select>`}</label>`).join('')}</div></div>` : '';
    return `<div class="netprops"><span class="chipk">${t.label}</span><label>Name <input data-f="name" value="${esc(d.name)}" maxlength="20"></label>${d.type !== 'sw' ? `<label>IP address <input data-f="ip" value="${esc(d.ip || '')}" maxlength="15" inputmode="decimal"></label><span class="small muted">/24</span>` : ''}<button data-act="del" class="danger">Delete device</button></div>${rack}`;
  }
  function issuesHtml() {
    if (!issues) return '';
    const { E, W, info } = issues;
    return `<div class="netver ${E.length ? 'bad' : 'good'}"><b>${E.length ? `${E.length} error${E.length > 1 ? 's' : ''}` : 'Verified — no errors'}${W.length ? `, ${W.length} warning${W.length > 1 ? 's' : ''}` : ''}</b>
      <ul>${E.map(x => `<li class="e">✕ ${esc(x)}</li>`).join('')}${W.map(x => `<li class="w">⚠ ${esc(x)}</li>`).join('')}</ul><div class="small muted">I/O capacity — ${info.join(' · ')}</div></div>`;
  }
  function render() {
    if (!host) return;
    host.innerHTML = `<div class="nettools"><span class="small muted">Add</span>${Object.entries(TYPES).map(([k, t]) => `<button data-add="${k}" ${o.editable ? '' : 'disabled'}>＋ ${t.label}</button>`).join('')}
      <span class="grow"></span><button id="netConn" class="${connectFrom !== null ? 'on' : ''}" ${o.editable ? '' : 'disabled'}>${connectFrom ? 'Click the other device…' : '⌁ Connect'}</button><button id="netVer" class="primary">✓ Verify</button>
      ${net.devices.length ? '' : `<button id="netStart" ${o.editable ? '' : 'disabled'}>Start from a typical layout</button>`}</div>
      <div class="netwrap">${net.devices.length ? svg() : '<p class="muted" style="padding:30px;text-align:center">No network yet. Add a controller, a switch and devices, or start from a typical layout.</p>'}</div>${props()}${issuesHtml()}`;
    host.querySelectorAll('[data-add]').forEach(b => b.onclick = () => add(b.dataset.add));
    const st = host.querySelector('#netStart'); if (st) st.onclick = starter;
    host.querySelector('#netConn').onclick = () => { connectFrom = connectFrom === null ? (sel || '') : null; render(); };
    host.querySelector('#netVer').onclick = () => { issues = verify(); render(); };
    host.querySelectorAll('[data-link]').forEach(p => p.addEventListener('pointerdown', e => { e.stopPropagation(); selLink = +p.dataset.link; sel = null; render(); }));
    host.querySelectorAll('[data-dev]').forEach(g => g.addEventListener('pointerdown', e => down(e, g.dataset.dev)));
    host.querySelectorAll('[data-f]').forEach(inp => inp.onchange = () => { const d = dev(sel); d[inp.dataset.f] = inp.value.trim(); changed(); });
    host.querySelectorAll('[data-slot]').forEach(s => s.onchange = () => { dev(sel).rack[+s.dataset.slot] = s.value; changed(); });
    host.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
      const a = b.dataset.act, d = sel && dev(sel);
      if (a === 'dellink') { net.links.splice(selLink, 1); selLink = null; }
      if (a === 'del' && d) { net.devices = net.devices.filter(x => x !== d); net.links = net.links.filter(l => l.a !== d.id && l.b !== d.id); sel = null; }
      if (a === 'slots+' && d && d.rack.length < 17) d.rack.push('');
      if (a === 'slots-' && d && d.rack.length > 2) d.rack.pop();
      changed();
    });
  }
  function down(e, id) {
    e.preventDefault();
    if (connectFrom !== null) {
      if (!connectFrom) { connectFrom = id; sel = id; render(); return; }
      if (connectFrom !== id) { net.links.push({ a: connectFrom, b: id }); connectFrom = null; changed(); } return;
    }
    sel = id; selLink = null;
    const svgEl = host.querySelector('.netsvg'), pt = svgEl.createSVGPoint(), d = dev(id);
    const toSvg = ev => { pt.x = ev.clientX; pt.y = ev.clientY; return pt.matrixTransform(svgEl.getScreenCTM().inverse()); };
    const p0 = toSvg(e); drag = { id, dx: p0.x - d.x, dy: p0.y - d.y, moved: false };
    const mv = ev => { if (!drag || !o.editable) return; const p = toSvg(ev); d.x = Math.max(0, Math.round((p.x - drag.dx) / 10) * 10); d.y = Math.max(0, Math.round((p.y - drag.dy) / 10) * 10); drag.moved = true;
      const g = host.querySelector(`[data-dev="${id}"]`); if (g) { const nh = document.createElement('div'); nh.innerHTML = svg(); svgEl.innerHTML = nh.firstChild.innerHTML; } };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); const m = drag && drag.moved; drag = null; if (m) changed(); else render(); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  }
  function changed() {
    issues = issues ? verify() : null; render();
    if (!o.editable) return;
    clearTimeout(saveT);
    saveT = setTimeout(async () => { const r = await o.api('PUT', '/api/network', { network: net }); if (!r.ok) o.toast(r.msg || 'Could not save the network', true); }, 400);
  }
  function mount(el, opts) {
    const same = host === el && o && o.ws === opts.ws;
    host = el; o = opts;
    if (!same || !net) { net = clone(opts.network || { devices: [], links: [] }); sel = null; selLink = null; connectFrom = null; issues = null; }
    render();
  }
  return { mount, open() { const b = document.querySelector('[data-bsw="net"]'); if (b) b.click(); }, verifyOf(n) { const keep = net; net = n; try { return verify(); } finally { net = keep; } } };
})();
