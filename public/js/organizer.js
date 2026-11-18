'use strict';
/* Controller Organizer (Studio 5000-style project tree) + status bar.
   Reads the shared app state (S) and drives the existing tabs; it owns no state of its own. */
const ORG = (() => {
  let key = '', open = {};
  try { open = JSON.parse(localStorage.getItem('plcf.org') || '{}'); } catch (e) {}
  const I = {
    ctl: '<svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="1"/><path d="M5 6h6M5 9h3"/></svg>',
    fold: '<svg viewBox="0 0 16 16"><path d="M1.5 4.5h5l1.5 1.5h6.5v7h-13z"/></svg>',
    task: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.2l2 1.3"/></svg>',
    prog: '<svg viewBox="0 0 16 16"><rect x="2.5" y="2.5" width="11" height="11" rx="1"/><path d="M5 6h6M5 8.5h6M5 11h4"/></svg>',
    ld: '<svg viewBox="0 0 16 16"><path d="M3 2v12M13 2v12M3 6h3M10 6h3M6 4.5v3M10 4.5v3M3 11h10"/></svg>',
    st: '<svg viewBox="0 0 16 16"><path d="M3 4h10M3 7h7M3 10h9M3 13h5"/></svg>',
    tag: '<svg viewBox="0 0 16 16"><path d="M2.5 2.5h6l5 5-6 6-5-5z"/><circle cx="5.5" cy="5.5" r="1"/></svg>',
    type: '<svg viewBox="0 0 16 16"><path d="M3 3h10v3H3zM3 8h4v5H3zM9 8h4v5H9z"/></svg>',
    io: '<svg viewBox="0 0 16 16"><rect x="2" y="3" width="4" height="10"/><rect x="7" y="3" width="3" height="10"/><rect x="11" y="3" width="3" height="10"/></svg>',
    hmi: '<svg viewBox="0 0 16 16"><rect x="1.5" y="2.5" width="13" height="9" rx="1"/><path d="M5.5 14h5M8 11.5V14"/></svg>',
    alm: '<svg viewBox="0 0 16 16"><path d="M8 2l6.5 11.5h-13z"/><path d="M8 6.5v3.2M8 11.5v.1"/></svg>',
    trend: '<svg viewBox="0 0 16 16"><path d="M1.5 13.5h13M2.5 11l3.5-4 3 2.5 4.5-6"/></svg>',
    net: '<svg viewBox="0 0 16 16"><rect x="6" y="1.5" width="4" height="3"/><rect x="1.5" y="11.5" width="4" height="3"/><rect x="10.5" y="11.5" width="4" height="3"/><path d="M8 4.5V8M3.5 11.5V8h9v3.5"/></svg>',
    mis: '<svg viewBox="0 0 16 16"><path d="M3 2v12M3 2.5h9l-2 3 2 3H3"/></svg>',
    build: '<svg viewBox="0 0 16 16"><path d="M2 14h12M4 14V8h3v6M9 14V4h3v10"/></svg>',
  };
  const node = (id, icon, label, attrs, kids, extra = '') => {
    const has = kids !== undefined, isOpen = open[id] !== false;
    return `<li class="${has ? 'br' : ''}${isOpen ? ' open' : ''}" data-node="${id}"><div class="nd" ${attrs || ''}>${has ? '<span class="tw"></span>' : '<span class="tw0"></span>'}<span class="ic">${I[icon]}</span><span class="lb">${label}</span>${extra}</div>${has ? `<ul>${kids}</ul>` : ''}</li>`;
  };
  function netTree() {
    const n = (S.info.project || {}).network || { devices: [] }, live = (S.snap && S.snap.net) || { online: {} };
    const lamp = d => `<i class="lamp ${live.online[d.id] ? 'g' : 'r blink'}" style="margin-left:6px"></i>`;
    const slots = d => (d.rack || []).map((m, i) => node('s-' + d.id + i, 'io', `${i} · ${m || 'Empty'}`, 'data-go="net"')).join('');
    const plc = n.devices.find(d => d.type === 'plc');
    const others = n.devices.filter(d => d !== plc && d.type !== 'sw');
    return [plc ? node('n-' + plc.id, 'ctl', `${esc(plc.name)} local chassis`, 'data-go="net"', slots(plc)) : '',
      node('eth', 'net', 'Ethernet', 'data-go="net"', others.map(d => node('n-' + d.id, d.type === 'rio' ? 'io' : d.type === 'hmi' ? 'hmi' : 'net', `${esc(d.name)} <small>${esc(d.ip || '')}</small>${lamp(d)}`, 'data-go="net"', d.rack ? slots(d) : undefined)).join(''))].join('');
  }
  function render() {
    const el = document.getElementById('organizer');
    if (!el || !S.info || !S.units) return;
    const pr = S.info.project || {}, kind = S.info.kind, sens = pr.sensors || [];
    const k = [S.info.ws, S.info.wsName, kind, S.cur, document.body.dataset.tab, JSON.stringify(S.units.pous.map(p => [p.id, p.name, p.lang])), sens.length, (pr.hmi || []).length, (pr.alarms || []).length, JSON.stringify(open), JSON.stringify(S.snap && S.snap.net && S.snap.net.online), JSON.stringify((S.info.project || {}).network || null)].join('|');
    if (k === key) return; key = k;
    const tab = document.body.dataset.tab, cur = id => (tab === 'program' && S.cur === id ? ' cur' : '');
    const t = (name, label) => (tab === name ? ' cur' : '');
    const di = sens.filter(s => s.type !== 'analog').length, ai = sens.filter(s => s.type === 'analog').length;
    const outs = Object.keys((S.snap && S.snap.out) || {});
    const dq = outs.filter(n => /^Q_/i.test(n)).length, aq = outs.filter(n => /^AO_/i.test(n)).length;
    const routines = S.units.pous.map((p, i) => node('r-' + p.id, p.lang === 'LD' ? 'ld' : 'st', `${esc(p.name)}<small>${p.lang}</small>`, `data-go="unit:${p.id}" class="nd${cur(p.id)}"`)).join('');
    el.innerHTML = `<div class="org-h">Controller Organizer</div><ul class="tree">
      ${kind === 'lesson' || kind === 'challenge' ? node('mis', 'mis', kind === 'lesson' ? 'Lesson' : 'Work order', `data-go="tab:mission" class="nd${t('mission')}"`) : ''}
      ${kind === 'sandbox' ? node('bld', 'build', 'Machine builder', `data-go="tab:build" class="nd${t('build')}"`) : ''}
      ${node('ctl', 'ctl', `Controller <b>${esc(S.info.wsName || '')}</b>`, 'data-go="tab:settingsless"', [
        node('ctags', 'tag', 'Controller Tags', `data-go="tab:tags" class="nd${t('tags')}"`),
        node('glob', 'tag', 'Global declarations', `data-go="unit:globals" class="nd${cur('globals')}"`),
      ].join(''))}
      ${node('tasks', 'fold', 'Tasks', '', node('mt', 'task', `MainTask <small>${S.snap ? S.snap.scanMs : ''} ms periodic</small>`, '', node('mp', 'prog', 'MainProgram', '', routines)))}
      ${node('types', 'fold', 'Data Types', '', node('udt', 'type', 'User-Defined', `data-go="unit:types" class="nd${cur('types')}"`))}
      ${S.info.net ? node('ioc', 'fold', 'I/O Configuration', '', netTree()) : node('ioc', 'fold', 'I/O Configuration', '', [
        node('io1', 'io', `Slot 1 · Digital in <small>${di}</small>`, `data-go="tab:io" class="nd${t('io')}"`),
        node('io2', 'io', `Slot 2 · Analog in <small>${ai}</small>`, 'data-go="tab:io"'),
        node('io3', 'io', `Slot 3 · Digital out <small>${dq}</small>`, 'data-go="tab:tags"'),
        node('io4', 'io', `Slot 4 · Analog out <small>${aq}</small>`, 'data-go="tab:tags"'),
        kind === 'sandbox' ? node('net', 'net', 'Network & racks', 'data-go="net"') : '',
      ].join(''))}
      ${node('vis', 'fold', 'Visualization', '', [
        node('hmi', 'hmi', `HMI screen <small>${(pr.hmi || []).length}</small>`, `data-go="tab:hmi" class="nd${t('hmi')}"`),
        node('alm', 'alm', `Alarms <small>${(pr.alarms || []).length}</small>`, `data-go="tab:alarms" class="nd${t('alarms')}"`),
        node('trd', 'trend', 'Trends', `data-go="tab:trend" class="nd${t('trend')}"`),
      ].join(''))}
    </ul>`;
    el.querySelectorAll('.nd').forEach(n => n.onclick = e => {
      const li = n.parentElement, go = n.dataset.go;
      if (e.target.classList.contains('tw') || (!go && li.classList.contains('br'))) { open[li.dataset.node] = !li.classList.contains('open'); try { localStorage.setItem('plcf.org', JSON.stringify(open)); } catch (x) {} key = ''; render(); return; }
      if (!go) return;
      const [a, b] = go.split(':');
      if (a === 'unit') { S.cur = b; setTab('program'); renderProgram(); }
      else if (a === 'tab' && b !== 'settingsless') setTab(b);
      else if (a === 'net') { setTab('build'); if (typeof NET !== 'undefined') NET.open(); }
      key = ''; render();
    });
  }
  function status() {
    const s = S.snap; if (!s) return;
    const run = s.plc === 'RUN', faulted = !!s.fault, forces = Object.keys(s.forces || {}).length;
    const netBad = !!(s.net && (s.net.bad || Object.values(s.net.online).some(v => !v)));
    const ioBad = netBad || ((S.info && S.info.project && S.info.project.sensors) || []).some(x => x.fault && x.fault !== 'none');
    const set = (id, cls) => { const e = document.getElementById(id); if (e && e.className !== 'lamp ' + cls) e.className = 'lamp ' + cls; };
    set('lmRun', run ? 'g' : faulted ? 'r' : 'o');
    set('lmOk', faulted ? 'r blink' : 'g');
    set('lmIo', netBad ? 'r blink' : ioBad ? 'a blink' : 'g');
    set('lmForce', forces ? 'a blink' : 'o');
    setText(document.getElementById('sbMode'), faulted ? 'Faulted' : run ? 'Rem Run' : 'Rem Prog');
    setText(document.getElementById('sbForce'), forces ? `Forces active (${forces})` : 'No forces');
    setText(document.getElementById('sbScan'), run ? `Scan ${s.scanTime.toFixed(2)} / ${s.scanMs} ms` : `Cycle ${s.scanMs} ms`);
    if (S.info) setText(document.getElementById('sbWs'), S.info.wsName || '');
    if (S.meta) setText(document.getElementById('sbVer'), 'v' + S.meta.version);
  }
  setInterval(() => { try { render(); status(); } catch (e) {} }, 250);
  document.getElementById('brandHome').onclick = e => { e.preventDefault(); if (typeof MODES !== 'undefined') MODES.openHome(); };
  return { render, refresh() { key = ''; render(); } };
})();
