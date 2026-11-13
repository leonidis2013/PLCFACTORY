'use strict';
/* PLCFACTORY web client — engineering station + HMI runtime */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const PEN_COLORS = ['#3fa9f5', '#f5a623', '#2ecc71', '#e74c3c', '#b48cff', '#ff7fd0'];
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

const S = {
  meta: null, info: null, snap: null, events: [], hist: { t: [], v: {} }, lastSample: 0,
  sensors: [], ioDirty: false, alarmsDraft: [], pens: [], trendPaused: false, view: '3d',
  editorDirty: false, refreshing: false, renderer: null, tagRows: [], tagVerShown: -1, almVerShown: -1, evVerShown: -1,
};

// ---------- API ----------
const ROLES = ['viewer', 'operator', 'engineer', 'admin'];
const can = min => !!S.me && ROLES.indexOf(S.me.role) >= ROLES.indexOf(min);
async function api(method, url, body) {
  const get = method === 'GET';
  const r = await fetch(url, { method, headers: get ? {} : { 'Content-Type': 'application/json' }, body: get ? undefined : JSON.stringify(body || {}), credentials: 'same-origin' });
  if (r.status === 401) { location.replace('/login.html?next=' + encodeURIComponent(location.pathname + location.hash)); throw new Error('not logged in'); }
  const j = await r.json().catch(() => ({ ok: false, msg: 'Bad response' }));
  if (r.status === 403 || r.status === 429) toast(j.msg || 'Not allowed', true);
  return j;
}
function applyRole() {
  document.body.dataset.role = S.me.role;
  $$('[data-min]').forEach(el => { el.disabled = !can(el.dataset.min); if (el.disabled) el.title = `Needs the ${el.dataset.min} role`; });
  $('#userBtn').innerHTML = S.me.noAuth ? '<small>NO AUTH</small>' : `${esc(S.me.username)}<small>${esc(S.me.role)}</small>`;
}
function toast(msg, err) {
  const t = $('#toast'); t.textContent = msg; t.className = err ? 'err' : ''; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, err ? 5000 : 2200);
}
const App = {
  val(name) {
    if (!S.snap || !name) return undefined;
    const N = String(name).toUpperCase();
    if (N.includes('.')) { const [a, b] = N.split('.'); return S.snap.fb[a] ? S.snap.fb[a][b] : undefined; }
    return S.snap.tags[N];
  },
  has(name) { const v = App.val(name); return v !== undefined; },
  isFb(name) { return S.snap && S.snap.fb[String(name).toUpperCase()] !== undefined; },
  write(tag, value) { if (!can('operator')) { toast('Viewers can watch but not operate', true); return Promise.resolve({ ok: false }); } if (S.snap) { const N = String(tag).toUpperCase(); if (!N.includes('.') && N in S.snap.tags) S.snap.tags[N] = value; } return api('POST', '/api/write', { tag, value }); },
  tagNames() { return (S.info ? S.info.tags : []).filter(t => t.kind !== 'FB').map(t => t.name); },
  fbNames(type) { return (S.info ? S.info.tags : []).filter(t => t.kind === 'FB' && (!type || t.type === type)).map(t => t.name); },
  hist: () => S.hist,
  saveHmi: debounce(() => api('PUT', '/api/hmi', { hmi: S.info.project.hmi }), 400),
  goTab: t => setTab(t),
};
window.App = App;

function fmt(v, dec) {
  if (v === undefined || v === null) return '—';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v !== 'number') return String(v);
  if (dec === undefined) dec = Number.isInteger(v) ? 0 : Math.abs(v) >= 100 ? 1 : Math.abs(v) >= 10 ? 2 : 3;
  return v.toFixed(dec);
}
function fmtTag(t, v) {
  if (t && t.type === 'TIME') return v >= 1000 ? (v / 1000).toFixed(2) + ' s' : v + ' ms';
  return fmt(v);
}

// ---------- tabs ----------
function setTab(t) {
  if (t === 'plant' && matchMedia('(min-width:1150px)').matches) t = 'hmi';
  document.body.dataset.tab = t;
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
  try { localStorage.setItem('plcf.tab', t); } catch (e) {}
  if (t === 'hmi') HMI.layout();
  if (t === 'tags') buildTags();
  if (t === 'alarms') { renderAlarmCfg(); renderAlarms(true); renderEvents(); }
  if (t === 'io') renderIo();
  if (t === 'trend') renderPens();
  if (t === 'learn') $('#learn').innerHTML = LEARN.html(S.info, S.meta);
  if (t === 'program') renderGutter();
}
$$('#tabs button').forEach(b => b.onclick = () => setTab(b.dataset.t));

// ---------- header ----------
$('#runBtn').onclick = async () => {
  const run = S.snap && S.snap.plc === 'RUN';
  if (!run && S.editorDirty) toast('Note: your edits are not downloaded yet — the PLC runs the downloaded program.');
  const r = await api('POST', '/api/mode', { mode: run ? 'STOP' : 'RUN' });
  if (r && r.ok === false) toast(r.msg, true);
};
$('#scenSel').onchange = async e => {
  await api('POST', '/api/scenario', { id: e.target.value });
  await refreshProject(true);
};
function updateHeader() {
  const s = S.snap; if (!s) return;
  const st = $('#plcStat');
  st.lastChild.textContent = s.plc;
  st.className = 'pill ' + s.plc.toLowerCase();
  st.title = s.fault || '';
  const rb = $('#runBtn');
  rb.textContent = s.plc === 'RUN' ? '■ STOP' : '▶ RUN';
  rb.className = 'mode ' + (s.plc === 'RUN' ? 'stop' : 'run');
  $('#scanInfo').textContent = s.plc === 'RUN' ? `scan ${s.scanTime.toFixed(2)} ms / ${s.scanMs} ms` : (s.fault || `cycle ${s.scanMs} ms`);
  const un = s.alarms.filter(a => !a.acked).length;
  $('#almBadge').textContent = un || '';
  $('#forceBanner').hidden = !Object.keys(s.forces).length;
}
$('#forceGo').onclick = e => { e.preventDefault(); setTab('tags'); };

// ---------- menu ----------
$('#menuBtn').onclick = () => {
  const m = S.info;
  modal(`<h3>Project — ${esc(m.plant.name)}</h3>
    <div class="menu">
      <label class="row small">PLC cycle time
        <select id="mScan">${[10, 20, 50, 100, 200].map(v => `<option ${v === m.scanMs ? 'selected' : ''} value="${v}">${v} ms</option>`).join('')}</select></label>
      <a href="/api/export" download><button>⬇ Export project (.json)</button></a>
      <button id="mImport">⬆ Import project…</button><input type="file" id="mFile" accept=".json,application/json" hidden>
      <button id="mPlant">↺ Reset the plant (physics state)</button>
      <p class="muted small" style="margin:14px 0 4px">Restore example content for this plant:</p>
      <div class="row">
        <button data-r="src">Program</button><button data-r="hmi">HMI</button><button data-r="sensors">I/O</button>
        <button data-r="alarms">Alarms</button><button data-r="all" class="danger">Everything</button>
      </div>
      <p class="muted small" style="margin-top:14px">PLCFACTORY ${esc(m.version)} · ${m.modbus ? 'Modbus TCP on port ' + m.modbus.port + ' (inside the container)' : 'Modbus off'}</p>
    </div><div class="row" style="justify-content:flex-end"><button id="mClose">Close</button></div>`);
  $('#mClose').onclick = closeModal;
  $('#mScan').onchange = e => api('POST', '/api/scan', { ms: +e.target.value }).then(() => refreshProject());
  $('#mPlant').onclick = async () => { await api('POST', '/api/plant-reset'); closeModal(); toast('Plant reset'); };
  $('#mImport').onclick = () => $('#mFile').click();
  $('#mFile').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const p = JSON.parse(await f.text()); const r = await api('POST', '/api/import', { project: p }); if (r.ok === false) return toast(r.msg, true); closeModal(); await refreshProject(true); toast('Project imported'); }
    catch (err) { toast('Could not read that file: ' + err.message, true); }
  };
  $$('.menu [data-r]').forEach(b => b.onclick = () => {
    const part = b.dataset.r;
    const ok = $('#mConfirm') || document.createElement('div');
    ok.id = 'mConfirm'; ok.className = 'row';
    ok.innerHTML = `<span class="warn small">Replace your ${part === 'all' ? 'whole project' : part === 'src' ? 'program' : part} with the example?</span><button class="danger" id="mYes">Replace</button>`;
    b.parentElement.after(ok);
    $('#mYes').onclick = async () => { await api('POST', '/api/reset-project', { part }); closeModal(); await refreshProject(true); toast('Restored'); };
  });
};
// ---------- account ----------
$('#userBtn').onclick = () => {
  if (S.me.noAuth) return toast('Authentication is off (AUTH=off) — do not expose this server to the internet.', true);
  modal(`<h3>Signed in as ${esc(S.me.username)}</h3><p class="role-note">Role: <b>${esc(S.me.role)}</b> — ${roleText(S.me.role)}</p>
    <div class="menu"><button id="uPw">Change password</button>${can('admin') ? '<button id="uUsers">Manage users</button>' : ''}<button id="uOut" class="danger">Sign out</button></div>
    <div class="row" style="justify-content:flex-end"><button id="mClose">Close</button></div>`);
  $('#mClose').onclick = closeModal;
  $('#uPw').onclick = () => passwordDialog(false);
  if ($('#uUsers')) $('#uUsers').onclick = usersDialog;
  $('#uOut').onclick = async () => { await api('POST', '/api/logout', {}); location.replace('/login.html'); };
};
function roleText(r) {
  return { viewer: 'can watch everything, change nothing', operator: 'can run the HMI, operator panel, plant controls and acknowledge alarms',
    engineer: 'can also program, download, configure I/O, HMI and alarms, force and inject faults', admin: 'can also manage users' }[r] || '';
}
function passwordDialog(forced) {
  modal(`<h3>${forced ? 'Choose a new password' : 'Change password'}</h3>
    ${forced ? '<p class="warn small">You are using a temporary password. Set your own before continuing.</p>' : ''}
    <form id="pwForm" class="menu" autocomplete="on">
      <input type="text" name="username" value="${esc(S.me.username)}" autocomplete="username" hidden>
      <label class="f">Current password<input type="password" id="pwOld" autocomplete="current-password" required></label>
      <label class="f">New password (10+ characters)<input type="password" id="pwNew" autocomplete="new-password" minlength="10" required></label>
      <label class="f">Repeat new password<input type="password" id="pwNew2" autocomplete="new-password" minlength="10" required></label>
      <div class="row" style="justify-content:flex-end;margin-top:10px">${forced ? '<button type="button" id="pwOut">Sign out</button>' : '<button type="button" id="pwCancel">Cancel</button>'}<button class="primary" type="submit">Save</button></div>
    </form>`);
  $('#modal').dataset.locked = forced ? '1' : '';
  if ($('#pwCancel')) $('#pwCancel').onclick = closeModal;
  if ($('#pwOut')) $('#pwOut').onclick = async () => { await api('POST', '/api/logout', {}); location.replace('/login.html'); };
  $('#pwForm').onsubmit = async e => {
    e.preventDefault();
    if ($('#pwNew').value !== $('#pwNew2').value) return toast('The new passwords do not match', true);
    const r = await api('POST', '/api/password', { old: $('#pwOld').value, new: $('#pwNew').value });
    if (!r.ok) return toast(r.msg, true);
    S.me.mustChange = false; $('#modal').dataset.locked = ''; closeModal(); toast('Password changed — other devices were signed out');
  };
}
async function usersDialog() {
  const r = await api('GET', '/api/users'); if (!r.ok) return;
  const opts = sel => ROLES.map(x => `<option ${x === sel ? 'selected' : ''}>${x}</option>`).join('');
  modal(`<h3>Users</h3>
    <div>${r.users.map(u => `<div class="urow" data-u="${esc(u.username)}"><span class="nm">${esc(u.username)}${u.mustChange ? ' <span class="muted small">(temp password)</span>' : ''}</span>
      <select data-role>${opts(u.role)}</select><button data-reset>New password</button><button data-del class="danger">Delete</button></div>`).join('')}</div>
    <h3 style="margin-top:16px">Add user</h3>
    <form id="addU" class="menu">
      <label class="f">Username<input id="nuName" autocomplete="off" autocapitalize="off" required></label>
      <label class="f">Temporary password (10+ characters — they must change it)<input id="nuPw" type="password" autocomplete="new-password" minlength="10" required></label>
      <label class="f">Role<select id="nuRole">${opts('operator')}</select></label>
      <p class="role-note">viewer: watch only · operator: run the HMI · engineer: program & configure · admin: + users</p>
      <div class="row" style="justify-content:flex-end"><button type="button" id="uClose">Close</button><button class="primary" type="submit">Add user</button></div>
    </form>`);
  $('#uClose').onclick = closeModal;
  $$('.urow').forEach(row => {
    const name = row.dataset.u;
    row.querySelector('[data-role]').onchange = async e => { const x = await api('POST', '/api/users', { username: name, role: e.target.value }); if (!x.ok) { toast(x.msg, true); usersDialog(); } else toast('Role updated'); };
    row.querySelector('[data-del]').onclick = async () => {
      if (row.dataset.confirm !== '1') { row.dataset.confirm = '1'; row.querySelector('[data-del]').textContent = 'Confirm delete'; return; }
      const x = await api('POST', '/api/users/delete', { username: name }); if (!x.ok) toast(x.msg, true); usersDialog();
    };
    row.querySelector('[data-reset]').onclick = () => {
      const b = row.querySelector('[data-reset]');
      const inp = document.createElement('input'); inp.type = 'password'; inp.placeholder = 'temp password'; inp.autocomplete = 'new-password';
      b.replaceWith(inp); inp.focus();
      inp.onkeydown = async e => { if (e.key !== 'Enter') return; const x = await api('POST', '/api/users', { username: name, role: row.querySelector('[data-role]').value, password: inp.value }); toast(x.ok ? 'Password reset — they must change it at next sign-in' : x.msg, !x.ok); if (x.ok) usersDialog(); };
    };
  });
  $('#addU').onsubmit = async e => {
    e.preventDefault();
    const x = await api('POST', '/api/users', { username: $('#nuName').value.trim(), password: $('#nuPw').value, role: $('#nuRole').value });
    if (!x.ok) return toast(x.msg, true);
    toast('User added'); usersDialog();
  };
}
function modal(html) { $('#mbody').innerHTML = html; $('#modal').hidden = false; }
function closeModal() { if ($('#modal').dataset.locked === '1') return; $('#modal').hidden = true; }
$('#modal').onclick = e => { if (e.target.id === 'modal') closeModal(); };

// ---------- program editor ----------
const code = $('#code');
function renderGutter(errLine) {
  const n = code.value.split('\n').length;
  const g = $('#gutter');
  if (g._n !== n || g._e !== errLine) {
    let h = ''; for (let i = 1; i <= n; i++) h += `<span${i === errLine ? ' class="err"' : ''}>${i}</span>`;
    g.innerHTML = h + '<span>&nbsp;</span>'; g._n = n; g._e = errLine;
  }
  g.scrollTop = code.scrollTop;
}
code.addEventListener('scroll', () => { $('#gutter').scrollTop = code.scrollTop; });
const saveDraft = debounce(() => api('PUT', '/api/source', { src: code.value }), 1200);
code.addEventListener('input', () => { S.editorDirty = code.value !== S.info.loadedSrc; renderGutter(S.errLine); progStatus(); saveDraft(); });
code.addEventListener('keydown', e => {
  if (e.key === 'Tab') { e.preventDefault(); code.setRangeText('  ', code.selectionStart, code.selectionEnd, 'end'); code.dispatchEvent(new Event('input')); }
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); download(false); }
});
function progStatus(msg) {
  const el = $('#progStat');
  if (msg) { el.textContent = msg; return; }
  el.innerHTML = !S.info.hasProgram ? '<span class="warn">No program in the PLC</span>' : S.editorDirty ? '<span class="warn">● Edited — not downloaded</span>' : '✓ Matches the PLC';
}
function showErr(r) {
  const bar = $('#errBar');
  if (r.ok) { bar.hidden = true; S.errLine = null; renderGutter(); return; }
  bar.hidden = false; bar.textContent = `Line ${r.line}: ${r.msg}`; S.errLine = r.line; renderGutter(r.line);
  bar.onclick = () => gotoLine(r.line);
  gotoLine(r.line);
}
function gotoLine(n) {
  const lines = code.value.split('\n'); let pos = 0;
  for (let i = 0; i < n - 1 && i < lines.length; i++) pos += lines[i].length + 1;
  code.focus(); code.setSelectionRange(pos, pos + (lines[n - 1] || '').length);
  code.scrollTop = Math.max(0, (n - 6) * 20);
}
async function download(cold) {
  const r = await api('POST', '/api/download', { src: code.value, cold });
  showErr(r);
  if (r.ok) { toast(cold ? 'Downloaded (cold: memory reset)' : 'Downloaded to PLC'); await refreshProject(); }
  else toast('Compile error — nothing was downloaded', true);
}
$('#dlBtn').onclick = () => download(false);
$('#coldBtn').onclick = () => download(true);
$('#chkBtn').onclick = async () => { const r = await api('POST', '/api/check', { src: code.value }); showErr(r); toast(r.ok ? `No errors (${r.vars} variables)` : 'Errors found', !r.ok); };
$('#revertBtn').onclick = () => { code.value = S.info.loadedSrc; S.editorDirty = false; saveDraft(); renderGutter(); progStatus(); showErr({ ok: true }); };
$('#exampleBtn').onclick = () => {
  modal(`<h3>Load the example program?</h3><p class="muted">This replaces the text in the editor (not the PLC until you download).</p>
    <div class="row" style="justify-content:flex-end"><button id="xNo">Cancel</button><button id="xYes" class="primary">Load example</button></div>`);
  $('#xNo').onclick = closeModal;
  $('#xYes').onclick = async () => {
    closeModal();
    const r = await api('POST', '/api/reset-project', { part: 'src' });
    await refreshProject(); code.value = S.info.project.src; S.editorDirty = false; renderGutter(); progStatus();
  };
};
function renderIoChips() {
  const kinds = { DI: 'in', AI: 'in', DO: 'out', AO: 'out', SYS: 'sys' };
  $('#ioList').innerHTML = S.info.tags.filter(t => kinds[t.kind]).map(t => `<span class="chip ${t.kind}" data-n="${esc(t.name)}" title="${esc(t.desc)}">${esc(t.name)}<i>${t.type}</i></span>`).join('');
  $$('#ioList .chip').forEach(c => c.onclick = () => { code.focus(); code.setRangeText(c.dataset.n, code.selectionStart, code.selectionEnd, 'end'); code.dispatchEvent(new Event('input')); });
  $('#fbList').innerHTML = '<table>' + Object.entries(S.meta.fbTypes).map(([k, v]) => `<tr><td class="nm"><code>${k}</code></td><td>${esc(v.desc)}<br><span class="muted">in: ${Object.keys(v.in).join(', ')} · out: ${Object.keys(v.out).join(', ')}</span></td></tr>`).join('') + '</table>';
}

// ---------- plant panel ----------
$$('.seg button').forEach(b => b.onclick = () => {
  S.view = b.dataset.v; $$('.seg button').forEach(x => x.classList.toggle('on', x === b));
  $('#view3d').hidden = S.view !== '3d'; $('#view2d').hidden = S.view !== '2d';
  try { localStorage.setItem('plcf.view', S.view); } catch (e) {}
});
$('#camReset').onclick = () => S.renderer && S.renderer.resetView();
$$('.panel [data-pb]').forEach(el => {
  const key = el.dataset.pb;
  if (key === 'estop') {
    el.onclick = () => { const v = !(S.snap && S.snap.panel.estop); api('POST', '/api/panel', { key, value: v }); };
  } else {
    const dn = e => { e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch (x) {} el.classList.add('down'); api('POST', '/api/panel', { key, value: true }); };
    const up = () => { el.classList.remove('down'); api('POST', '/api/panel', { key, value: false }); };
    el.addEventListener('pointerdown', dn); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  }
});
function buildPlantControls() {
  const p = S.info.plant;
  $('#plantName').textContent = p.name;
  $('#plantActions').innerHTML = (p.actions || []).map(a => {
    if (a.kind === 'toggle') return `<label><input type="checkbox" data-act="${a.id}"> ${esc(a.label)}</label>`;
    if (a.kind === 'select') return `<label>${esc(a.label)} <select data-act="${a.id}">${a.options.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select></label>`;
    return `<button data-act="${a.id}">${esc(a.label)}</button>`;
  }).join('');
  $('#plantFaults').innerHTML = (p.faults || []).map(([k, l]) => `<label><input type="checkbox" data-fault="${k}"> ${esc(l)}</label>`).join('');
  $$('#plantActions [data-act]').forEach(el => {
    const id = el.dataset.act;
    if (el.tagName === 'BUTTON') el.onclick = () => api('POST', '/api/plant', { action: id });
    else el.onchange = () => api('POST', '/api/plant', { action: id, value: el.type === 'checkbox' ? el.checked : el.value });
  });
  $$('#plantFaults [data-fault]').forEach(el => el.onchange = () => api('POST', '/api/plant', { fault: el.dataset.fault, value: el.checked }));
}
function syncPlantControls(v) {
  const act = v.act || {};
  $$('#plantActions [data-act]').forEach(el => {
    if (document.activeElement === el || !(el.dataset.act in act)) return;
    if (el.type === 'checkbox') el.checked = !!act[el.dataset.act]; else if (el.tagName === 'SELECT') el.value = act[el.dataset.act];
  });
  $$('#plantFaults [data-fault]').forEach(el => { el.checked = !!(v.faults || {})[el.dataset.fault]; });
}
function plantCtx() {
  return { val: App.val, out: S.snap.out, sensors: S.info.project.sensors, t: performance.now() / 1000, info: S.info, tags: S.snap.tags };
}
let last2d = 0;
function renderPlant() {
  const s = S.snap, v = s.plant, id = S.info.scen;
  if (s.scen !== id) return;   // snapshot from before a scenario switch
  $('#lampRun').classList.toggle('on', !!App.val('Q_RunLamp'));
  $('#lampFault').classList.toggle('on', !!App.val('Q_FaultLamp'));
  $('.estop').classList.toggle('down', !!s.panel.estop);
  const msgs = v.msgs || [];
  const mk = msgs.join('|');
  if ($('#plantMsgs')._k !== mk) { $('#plantMsgs').innerHTML = msgs.map(m => `<div>${esc(m)}</div>`).join(''); $('#plantMsgs')._k = mk; }
  const sc = (SCENES2D.score[id] || (() => ''))(v);
  if ($('#score')._k !== sc) { $('#score').innerHTML = sc; $('#score')._k = sc; }
  syncPlantControls(v);
  if (S.view === '3d') {
    if (!S.renderer) {
      S.renderer = new GL3D.Renderer($('#glc'), $('#glLabels'));
      if (S.renderer.failed) { $('#view3d').innerHTML = '<p class="muted" style="padding:20px">WebGL is not available in this browser — use the 2D view.</p>'; return; }
      S.renderer.attachControls();
      S.renderer.setHome(SCENES3D.cam[id]); S.camScen = id;
    }
    if (S.camScen !== id) { S.renderer.setHome(SCENES3D.cam[id]); S.camScen = id; }
    const sc3 = SCENES3D[id](v, plantCtx());
    S.renderer.draw(sc3.objs, sc3.labels);
  } else {
    const now = performance.now();
    if (now - last2d > 66) { last2d = now; $('#view2d').innerHTML = SCENES2D[id](v, plantCtx()); }
  }
}

// ---------- I/O configuration ----------
function sigOptions(type) {
  const cat = S.info.catalog;
  if (type === 'probe') return Object.entries(cat.probes || {});
  return Object.entries(cat.signals).filter(([, m]) => (type === 'analog' || type === 'switch') ? m.kind === 'analog' : m.kind === 'bool');
}
function newSensor(type) {
  const s = { id: 's' + Math.random().toString(36).slice(2, 9), tag: '', type, fault: 'none' };
  const opts = sigOptions(type);
  if (!opts.length) return null;
  s.signal = opts[0][0]; applySignalDefaults(s);
  return s;
}
function applySignalDefaults(s) {
  const cat = S.info.catalog, m = (s.type === 'probe' ? cat.probes : cat.signals)[s.signal] || {};
  if (s.type === 'analog') { s.lo = m.min ?? 0; s.hi = m.max ?? 100; s.scale = s.scale || 'eng'; s.noise = s.noise ?? 0.2; }
  if (s.type === 'switch') { s.op = s.op || '>='; s.sp = +(((m.min ?? 0) + (m.max ?? 100)) / 2).toFixed(2); s.hyst = s.hyst ?? 0.5; s.contact = s.contact || 'NO'; }
  if (s.type === 'discrete') s.contact = s.contact || 'NO';
  if (s.type === 'probe') { s.pos = Math.round(((m.min ?? 0) + (m.max ?? 1000)) / 2); s.contact = s.contact || 'NO'; }
}
function renderIo() {
  if (!S.ioDirty) S.sensors = JSON.parse(JSON.stringify(S.info.project.sensors));
  $('#ioDirty').hidden = !S.ioDirty;
  const cat = S.info.catalog;
  const sel = (name, val, opts) => `<select data-k="${name}">${opts.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(l)}</option>`; }).join('')}</select>`;
  const num = (name, val, step = 'any') => `<input type="number" step="${step}" data-k="${name}" value="${esc(val)}">`;
  $('#sensorList').innerHTML = S.sensors.map((s, i) => {
    const sigs = sigOptions(s.type).map(([k, m]) => [k, m.label + (m.unit ? ` (${m.unit})` : '')]);
    const faults = s.type === 'analog' ? S.meta.analogFaults : S.meta.discreteFaults;
    const pm = s.type === 'probe' ? (cat.probes[s.signal] || {}) : {};
    let extra = '';
    if (s.type === 'analog') extra = `<label>Range low${num('lo', s.lo)}</label><label>Range high${num('hi', s.hi)}</label>
      <label>Signal format${sel('scale', s.scale, [['eng', 'Engineering (REAL)'], ['mA', '4–20 mA (REAL)'], ['raw', 'Raw 0–27648 (INT)']])}</label><label>Noise % span${num('noise', s.noise)}</label>`;
    if (s.type === 'switch') extra = `<label>Trips when${sel('op', s.op, [['>=', 'value ≥ SP'], ['<=', 'value ≤ SP']])}</label><label>Setpoint${num('sp', s.sp)}</label><label>Hysteresis${num('hyst', s.hyst)}</label><label>Contact${sel('contact', s.contact, ['NO', 'NC'])}</label>`;
    if (s.type === 'discrete') extra = `<label>Contact${sel('contact', s.contact, ['NO', 'NC'])}</label>`;
    if (s.type === 'probe') extra = `<label>Position (mm)${num('pos', s.pos, 1)}</label><label style="grid-column:span 2">&nbsp;<input type="range" data-k="pos" min="${pm.min ?? 0}" max="${pm.max ?? 1000}" value="${s.pos}"></label><label>Contact${sel('contact', s.contact, ['NO', 'NC'])}</label>`;
    return `<div class="sensor" data-i="${i}">
      <label>Tag name<input data-k="tag" value="${esc(s.tag)}" placeholder="I_MySensor"></label>
      <label>Type${sel('type', s.type, [['analog', 'Analog transmitter'], ['switch', 'Switch (analog SP)'], ['discrete', 'Discrete contact'], ['probe', 'Position sensor']])}</label>
      <label class="sig">Measures${sel('signal', s.signal, sigs)}</label>
      ${extra}
      <label>Fault (live)${sel('fault', s.fault || 'none', faults)}</label>
      <label>PLC value<span class="live" data-live="${esc(s.tag)}">—</span></label>
      <label>&nbsp;<button data-del="${i}" class="danger">Remove</button></label>
    </div>`;
  }).join('') || '<p class="muted">No sensors — add one.</p>';
  $$('#sensorList .sensor').forEach(el => {
    const s = S.sensors[+el.dataset.i];
    el.querySelectorAll('[data-k]').forEach(inp => {
      inp.onchange = inp.oninput = e => {
        const k = inp.dataset.k;
        let v = inp.value;
        if (['lo', 'hi', 'noise', 'sp', 'hyst', 'pos'].includes(k)) v = parseFloat(v);
        if (k === 'fault') { s.fault = v; const live = S.info.project.sensors.find(x => x.id === s.id); if (live) { live.fault = v; api('PUT', '/api/sensorfault', { id: s.id, fault: v }); } return; }
        s[k] = v;
        if (k === 'pos') el.querySelectorAll('[data-k=pos]').forEach(o => { if (o !== inp) o.value = v; });
        if (k === 'type') { const opts = sigOptions(v); s.signal = opts.length ? opts[0][0] : ''; delete s.contact; delete s.op; applySignalDefaults(s); }
        if (k === 'signal') { const keep = { contact: s.contact, op: s.op }; applySignalDefaults(s); Object.assign(s, keep); }
        S.ioDirty = true; $('#ioDirty').hidden = false;
        if (e.type === 'change' && (k === 'type' || k === 'signal')) renderIo();
      };
    });
  });
  $$('#sensorList [data-del]').forEach(b => b.onclick = () => { S.sensors.splice(+b.dataset.del, 1); S.ioDirty = true; renderIo(); });
  const af = S.info.project.actFaults || {};
  $('#actList').innerHTML = S.info.plant.actuators.map(([n, ty, k, d]) => `<div class="act"><div><span class="nm">${esc(n)}</span> <span class="kind">${k}</span><div class="muted small">${esc(d)}</div></div>
    <select data-af="${esc(n)}">${S.meta.actFaults.map(f => `<option ${af[n] === f ? 'selected' : ''} value="${f}">${f === 'none' ? 'no fault' : f.replace('_', ' ')}</option>`).join('')}</select>
    <span class="live" data-live="${esc(n)}">—</span></div>`).join('');
  $$('#actList [data-af]').forEach(el => el.onchange = () => { const m = Object.assign({}, S.info.project.actFaults || {}); m[el.dataset.af] = el.value; if (el.value === 'none') delete m[el.dataset.af]; S.info.project.actFaults = m; api('PUT', '/api/actfaults', { actFaults: m }); });
  const mb = S.info.modbus;
  $('#mbMap').innerHTML = mb ? `<p class="small muted">Server port ${mb.port} inside the container (the compose file publishes it as 502). Unit ID is ignored. 32-bit values use 2 registers, big-endian (ABCD).</p>
    <table class="tt"><tr><th>Tag</th><th>Table</th><th>FC</th><th>Address (0-based)</th><th>Ref</th><th>Type</th></tr>${mb.map.map(r => `<tr><td class="nm">${esc(r.tag)}</td><td>${r.table}</td><td>${r.fc}</td><td>${r.addr}</td><td>${r.ref}</td><td>${r.type}</td></tr>`).join('')}</table>` : '<p class="muted">Modbus is disabled (MODBUS=off).</p>';
}
$('#ioAddBtn').onclick = () => {
  modal(`<h3>Add a sensor</h3><div class="menu">
    <button data-ty="analog">Analog transmitter — level, temperature, pressure, weight… (REAL / mA / raw)</button>
    <button data-ty="switch">Switch on an analog value — level switch, pressure switch, thermostat (BOOL)</button>
    <button data-ty="discrete">Discrete contact — limit switch, aux contact, door switch (BOOL)</button>
    ${Object.keys(S.info.catalog.probes || {}).length ? '<button data-ty="probe">Position sensor — photoeye, proximity, camera at a position (BOOL)</button>' : ''}
  </div><div class="row" style="justify-content:flex-end"><button id="xNo">Cancel</button></div>`);
  $('#xNo').onclick = closeModal;
  $$('.menu [data-ty]').forEach(b => b.onclick = () => {
    const s = newSensor(b.dataset.ty); closeModal(); if (!s) return;
    const base = { analog: 'AI_', switch: 'I_', discrete: 'I_', probe: 'I_' }[s.type];
    let n = 1; while (S.sensors.some(x => x.tag.toUpperCase() === (base + 'New' + n).toUpperCase())) n++;
    s.tag = base + 'New' + n;
    S.sensors.push(s); S.ioDirty = true; renderIo();
  });
};
$('#ioApplyBtn').onclick = async () => {
  const names = new Set();
  for (const s of S.sensors) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s.tag)) return toast(`Invalid tag name '${s.tag}'`, true);
    if (names.has(s.tag.toUpperCase())) return toast(`Duplicate tag '${s.tag}'`, true);
    names.add(s.tag.toUpperCase());
  }
  const r = await api('PUT', '/api/sensors', { sensors: S.sensors });
  S.ioDirty = false;
  await refreshProject();
  renderIo();
  if (r.ok) toast('I/O configuration applied');
  else { toast(`Applied, but the program no longer compiles: line ${r.line}: ${r.msg}`, true); showErr(r); }
};
function updateIoLive() {
  $$('[data-live]').forEach(el => { const v = App.val(el.dataset.live); el.textContent = fmt(v); });
}

// ---------- alarms ----------
function renderAlarms(force) {
  const s = S.snap;
  if (!force && S.almVerShown === s.almVer) return;
  S.almVerShown = s.almVer;
  $('#almList').innerHTML = s.alarms.map(a => `<div class="almrow ${a.pri} ${a.active ? 'act' : 'rtn'} ${a.acked ? '' : 'un'}">
    <span class="pri ${a.pri}">${a.pri}</span><span class="small">${new Date(a.t).toLocaleTimeString()}</span>
    <span>${esc(a.msg)} <span class="muted small">${a.active ? (a.acked ? 'active, acknowledged' : 'ACTIVE') : 'returned to normal, not acknowledged'}</span></span>
    ${a.acked ? '<span></span>' : `<button data-ack="${a.id}">Ack</button>`}</div>`).join('') || '<p class="muted">No active alarms.</p>';
  $$('[data-ack]').forEach(b => b.onclick = () => api('POST', '/api/ack', { id: b.dataset.ack }));
}
$('#ackAllBtn').onclick = () => api('POST', '/api/ack', { id: 'all' });
function renderAlarmCfg() {
  S.alarmsDraft = JSON.parse(JSON.stringify(S.info.project.alarms));
  const rows = () => {
    $('#almCfg').innerHTML = '<datalist id="tagDL">' + App.tagNames().map(n => `<option value="${esc(n)}">`).join('') + '</datalist>' +
      '<div class="cfgrow small muted"><span>Tag</span><span>Condition</span><span>Value</span><span>Message</span><span>Priority</span><span></span></div>' +
      S.alarmsDraft.map((a, i) => `<div class="cfgrow" data-i="${i}"><input list="tagDL" data-k="tag" value="${esc(a.tag)}">
        <select data-k="cond">${['TRUE', 'FALSE', '>', '<', '>=', '<=', '=', '<>'].map(c => `<option ${a.cond === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
        <input data-k="val" value="${esc(a.val)}"><input data-k="msg" value="${esc(a.msg)}">
        <select data-k="pri">${['High', 'Medium', 'Low'].map(c => `<option ${a.pri === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
        <button data-del="${i}">✕</button></div>`).join('');
    $$('#almCfg [data-k]').forEach(inp => inp.oninput = inp.onchange = () => { S.alarmsDraft[+inp.closest('.cfgrow').dataset.i][inp.dataset.k] = inp.value; });
    $$('#almCfg [data-del]').forEach(b => b.onclick = () => { S.alarmsDraft.splice(+b.dataset.del, 1); rows(); });
  };
  rows();
  $('#almAddBtn').onclick = () => { S.alarmsDraft.push({ id: 'a' + Math.random().toString(36).slice(2, 9), tag: '', cond: '>', val: '0', msg: 'New alarm', pri: 'Medium' }); rows(); };
}
$('#almSaveBtn').onclick = async () => { await api('PUT', '/api/alarms', { alarms: S.alarmsDraft }); await refreshProject(); toast('Alarms saved'); };
function renderEvents() {
  $('#evList').innerHTML = S.events.map(e => `<div class="ev"><span class="muted">${new Date(e.t).toLocaleTimeString()}</span><span class="ty ${e.type}">${e.type}</span><span>${esc(e.msg)}</span></div>`).join('');
}

// ---------- trend ----------
function sample(snap) {
  if (S.trendPaused) return;
  const h = S.hist; const t = snap.t;
  if (t - S.lastSample < 95) return;
  S.lastSample = t;
  h.t.push(t);
  for (const K in snap.tags) { const v = snap.tags[K]; (h.v[K] || (h.v[K] = new Array(h.t.length - 1).fill(null))).push(typeof v === 'boolean' ? (v ? 1 : 0) : v); }
  for (const K in snap.fb) for (const m in snap.fb[K]) { const KK = K + '.' + m, v = snap.fb[K][m]; (h.v[KK] || (h.v[KK] = new Array(h.t.length - 1).fill(null))).push(typeof v === 'boolean' ? (v ? 1 : 0) : v); }
  for (const K in h.v) if (h.v[K].length < h.t.length) h.v[K].push(null);
  if (h.t.length > 1200) { h.t.shift(); for (const K in h.v) h.v[K].shift(); }
}
function renderPens() {
  S.pens = JSON.parse(JSON.stringify(S.info.project.pens || []));
  const save = debounce(() => { S.info.project.pens = S.pens; api('PUT', '/api/pens', { pens: S.pens }); }, 500);
  const opts = '<datalist id="penDL">' + App.tagNames().map(n => `<option value="${esc(n)}">`).join('') +
    (S.info.tags.filter(t => t.kind === 'FB' && t.type === 'PID').map(t => ['Y', 'P', 'I', 'D', 'E'].map(m => `<option value="${esc(t.name)}.${m}">`).join('')).join('')) + '</datalist>';
  const draw = () => {
    $('#penList').innerHTML = opts + S.pens.map((p, i) => `<div class="pen" data-i="${i}"><span class="sw" style="background:${PEN_COLORS[i]}"></span>
      <input list="penDL" data-k="tag" value="${esc(p.tag)}"><input type="number" step="any" data-k="min" value="${p.min}" title="scale min"><input type="number" step="any" data-k="max" value="${p.max}" title="scale max">
      <span class="small" data-pv="${i}">—</span><button data-del="${i}">✕</button></div>`).join('');
    $$('#penList [data-k]').forEach(inp => inp.oninput = () => { const p = S.pens[+inp.closest('.pen').dataset.i]; p[inp.dataset.k] = inp.dataset.k === 'tag' ? inp.value : parseFloat(inp.value); save(); });
    $$('#penList [data-del]').forEach(b => b.onclick = () => { S.pens.splice(+b.dataset.del, 1); save(); draw(); });
  };
  draw();
  $('#penAddBtn').onclick = () => { if (S.pens.length >= 6) return toast('Maximum 6 pens'); S.pens.push({ tag: '', min: 0, max: 100 }); save(); draw(); };
}
$('#trPause').onclick = e => { S.trendPaused = !S.trendPaused; e.target.textContent = S.trendPaused ? 'Resume' : 'Pause'; };
function drawTrend(cv, pens, winS, opts = {}) {
  const dpr = Math.min(devicePixelRatio || 1, 2), W = cv.clientWidth, H = cv.clientHeight;
  if (!W || !H) return;
  if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const h = S.hist, n = h.t.length; if (!n) return;
  const tEnd = S.trendPaused ? h.t[n - 1] : Math.max(h.t[n - 1], Date.now() - 150), t0 = tEnd - winS * 1000;
  const L = opts.compact ? 4 : 8, R = W - (opts.compact ? 4 : 8), T = 6, B = H - (opts.compact ? 4 : 18);
  g.strokeStyle = opts.light ? '#c9ced3' : '#20262b'; g.lineWidth = 1; g.font = '11px "IBM Plex Mono", monospace'; g.fillStyle = opts.light ? '#69727a' : '#5f6870';
  for (let i = 0; i <= 4; i++) { const y = T + (B - T) * i / 4; g.beginPath(); g.moveTo(L, y); g.lineTo(R, y); g.stroke(); }
  const step = winS <= 30 ? 5 : winS <= 60 ? 10 : 20;
  for (let s = 0; s <= winS; s += step) { const x = R - (R - L) * s / winS; g.beginPath(); g.moveTo(x, T); g.lineTo(x, B); g.stroke(); if (!opts.compact) g.fillText(`-${s}s`, x - 12, H - 4); }
  pens.forEach((p, i) => {
    const a = h.v[String(p.tag || '').toUpperCase()]; if (!a) return;
    const lo = +p.min, hi = +p.max || lo + 1;
    g.strokeStyle = PEN_COLORS[i]; g.lineWidth = 1.6; g.beginPath(); let started = false;
    for (let k = 0; k < n; k++) {
      if (h.t[k] < t0 || a[k] === null || a[k] === undefined) { started = false; continue; }
      const x = L + (R - L) * (h.t[k] - t0) / (winS * 1000), y = B - (B - T) * clamp((a[k] - lo) / (hi - lo), -0.02, 1.02);
      if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y);
    }
    g.stroke();
  });
}
function updateTrendTab() {
  drawTrend($('#trend'), S.pens, +$('#trWin').value);
  S.pens.forEach((p, i) => { const el = document.querySelector(`[data-pv="${i}"]`); if (el) el.textContent = fmt(App.val(p.tag)); });
}

// ---------- tags ----------
function buildTags() {
  const f = $('#tagFilter').value.trim().toUpperCase();
  const groups = [['DI', 'Digital inputs'], ['AI', 'Analog inputs'], ['DO', 'Digital outputs'], ['AO', 'Analog outputs'], ['MEM', 'Memory (your VARs)'], ['FB', 'Function block instances'], ['SYS', 'System']];
  const tags = S.info.tags.filter(t => !f || t.name.toUpperCase().includes(f) || (t.desc || '').toUpperCase().includes(f));
  let h = '<table class="tt"><tr><th>Name</th><th>Type</th><th>Value</th><th>Force</th></tr>';
  S.tagRows = [];
  for (const [k, label] of groups) {
    const g = tags.filter(t => t.kind === k); if (!g.length) continue;
    h += `<tr class="grp"><td colspan="4">${label}</td></tr>`;
    for (const t of g) {
      if (t.kind === 'FB') {
        const def = S.meta.fbTypes[t.type];
        const mem = [...Object.keys(def.in), ...Object.keys(def.out)];
        h += `<tr><td class="nm">${esc(t.name)}<div class="ds">${esc(t.desc)}</div></td><td>${t.type}</td><td colspan="2" class="small">` +
          mem.map(m => `<span style="display:inline-block;margin:0 10px 2px 0">${m}=<span class="val" data-fb="${esc(t.name)}.${m}" data-in="${m in def.in ? 1 : 0}">—</span></span>`).join('') + '</td></tr>';
      } else {
        h += `<tr data-k="${t.key}"><td class="nm">${esc(t.name)}<div class="ds">${esc(t.desc)}</div></td><td>${t.type}</td><td class="val" data-v="${t.key}">—</td>
          <td>${t.kind === 'SYS' ? '' : `<button class="fbtn" data-f="${t.key}">F</button>`}</td></tr>`;
      }
    }
  }
  $('#tagTable').innerHTML = h + '</table>';
  S.tagVerShown = S.info.tagVer;
  $$('#tagTable [data-v]').forEach(el => el.onclick = () => editVal(el, el.dataset.v));
  $$('#tagTable [data-fb]').forEach(el => { if (el.dataset.in === '1') el.onclick = () => editVal(el, el.dataset.fb); });
  $$('#tagTable [data-f]').forEach(b => b.onclick = () => {
    const K = b.dataset.f, forced = K in S.snap.forces;
    api('POST', '/api/force', { tag: K, value: forced ? null : S.snap.tags[K] });
  });
}
$('#tagFilter').oninput = debounce(buildTags, 200);
function editVal(el, name) {
  const cur = App.val(name);
  const meta = S.info.tags.find(t => t.key === name);
  if (meta && meta.kind === 'SYS') return;
  const forced = S.snap.forces && name in S.snap.forces;
  const doWrite = v => forced ? api('POST', '/api/force', { tag: name, value: v }) : App.write(name, v);
  if (typeof cur === 'boolean') return doWrite(!cur);
  const inp = document.createElement('input');
  inp.type = 'number'; inp.step = 'any'; inp.value = cur; inp.style.width = '110px';
  el.textContent = ''; el.appendChild(inp); inp.focus(); inp.select();
  el._editing = true;
  const done = ok => { if (ok && inp.value !== '') doWrite(parseFloat(inp.value)); el._editing = false; };
  inp.onkeydown = e => { if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.value = ''; inp.blur(); } };
  inp.onblur = () => done(true);
}
function updateTags() {
  if (S.tagVerShown !== S.info.tagVer) buildTags();
  const s = S.snap;
  $$('#tagTable [data-v]').forEach(el => {
    if (el._editing) return;
    const K = el.dataset.v, v = s.tags[K], meta = S.info.tags.find(t => t.key === K);
    el.textContent = fmtTag(meta, v);
    el.className = 'val' + (typeof v === 'boolean' ? (v ? ' t' : ' f') : '');
    const forced = K in s.forces;
    el.parentElement.classList.toggle('forced', forced);
    const fb = el.parentElement.querySelector('.fbtn'); if (fb) fb.classList.toggle('on', forced);
  });
  $$('#tagTable [data-fb]').forEach(el => { if (el._editing) return; const v = App.val(el.dataset.fb); el.textContent = fmt(v); el.className = 'val' + (typeof v === 'boolean' ? (v ? ' t' : ' f') : ''); });
}

// ---------- project ----------
async function refreshProject(resetEditor) {
  if (S.refreshing) return; S.refreshing = true;
  try {
    const prevScen = S.info && S.info.scen;
    S.info = await api('GET', '/api/project');
    const scenChanged = prevScen !== S.info.scen;
    $('#scenSel').value = S.info.scen;
    if (resetEditor || scenChanged || (!S.editorDirty && document.activeElement !== code)) {
      code.value = S.info.project.draft != null && S.info.project.draft !== '' ? S.info.project.draft : S.info.project.src;
      S.editorDirty = code.value !== S.info.loadedSrc;
      renderGutter();
    }
    HMI.setTheme(S.info.project.hmiTheme || 'hp');
    if (scenChanged) { S.hist = { t: [], v: {} }; S.ioDirty = false; buildPlantControls(); HMI.load(S.info.project.hmi); }
    else HMI.load(S.info.project.hmi, true);
    progStatus();
    renderIoChips();
    const tab = document.body.dataset.tab;
    if (tab === 'io' && !S.ioDirty) renderIo();
    if (tab === 'trend' && (scenChanged || resetEditor)) renderPens();
    if (tab === 'alarms') renderAlarmCfg();
    if (tab === 'learn') $('#learn').innerHTML = LEARN.html(S.info, S.meta);
    if (!S.pens.length || scenChanged) S.pens = JSON.parse(JSON.stringify(S.info.project.pens || []));
  } finally { S.refreshing = false; }
}

// ---------- live stream ----------
function connect() {
  const es = new EventSource('/api/stream');
  es.onopen = () => { $('#conn').className = 'pill small ok'; $('#conn').title = 'Connected to the PLC'; };
  es.onerror = () => { $('#conn').className = 'pill small bad'; $('#conn').title = 'Disconnected — retrying'; api('GET', '/api/me').catch(() => {}); };
  es.onmessage = e => {
    const s = JSON.parse(e.data);
    S.snap = s;
    if (s.events) { S.events = s.events; if (document.body.dataset.tab === 'alarms') renderEvents(); }
    sample(s);
    if (S.info && (s.projVer !== S.info.projVer || s.tagVer !== S.info.tagVer)) refreshProject();
  };
}

// ---------- frame loop ----------
function frame() {
  requestAnimationFrame(frame);
  if (!S.snap || !S.info) return;
  updateHeader();
  const tab = document.body.dataset.tab;
  if ($('#plantSec').offsetParent !== null) renderPlant();
  if (tab === 'hmi') HMI.update();
  if (tab === 'tags') updateTags();
  if (tab === 'trend') updateTrendTab();
  if (tab === 'alarms') renderAlarms();
  if (tab === 'io') updateIoLive();
}

// ---------- boot ----------
(async function boot() {
  S.me = await api('GET', '/api/me');
  S.meta = await api('GET', '/api/meta');
  $('#scenSel').innerHTML = S.meta.scenarios.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  try { S.view = localStorage.getItem('plcf.view') || '3d'; } catch (e) {}
  $$('.seg button').forEach(x => x.classList.toggle('on', x.dataset.v === S.view));
  $('#view3d').hidden = S.view !== '3d'; $('#view2d').hidden = S.view !== '2d';
  HMI.init($('#hmiWrap'), $('#hmiCanvas'), $('#hmiProps'));
  await refreshProject(true);
  buildPlantControls();
  HMI.load(S.info.project.hmi);
  try {
    const h = await api('GET', '/api/history'); S.hist.t = h.t.slice();
    for (const K in h.v) S.hist.v[K] = new Array(Math.max(0, h.t.length - h.v[K].length)).fill(null).concat(h.v[K]);
  } catch (e) {}
  connect();
  let tab = 'hmi';
  try { tab = location.hash.slice(1) || localStorage.getItem('plcf.tab') || 'hmi'; } catch (e) {}
  if (!document.querySelector(`#tabs [data-t="${tab}"]`)) tab = 'hmi';
  setTab(tab);
  applyRole();
  if (S.me.mustChange) passwordDialog(true);
  requestAnimationFrame(frame);
  window.addEventListener('resize', () => HMI.layout());
})();
