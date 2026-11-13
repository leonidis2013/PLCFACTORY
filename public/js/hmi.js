'use strict';
/* PLCFACTORY HMI runtime + drag-and-drop builder (800×480 logical canvas) */
const HMI = (() => {
  const COLORS = { green: '#2ecc71', red: '#e74c3c', blue: '#3fa9f5', amber: '#f5a623', gray: '#8a96a3', white: '#e8eef4' };
  const FIELDS = {
    label: ['label', 'size', 'color'], button: ['label', 'tag', 'color'], switch: ['label', 'tag'], lamp: ['label', 'tag', 'color'],
    value: ['label', 'tag', 'unit', 'dec'], setpoint: ['label', 'tag', 'unit', 'dec'], bar: ['label', 'tag', 'min', 'max', 'unit', 'vert', 'color'],
    motor: ['label', 'tag'], valve: ['label', 'tag'], pid: ['label', 'tag', 'min', 'max', 'unit'], trend: ['label', 'tag', 'tag2', 'min', 'max', 'win'], alarms: [],
  };
  const SIZES = { label: [300, 40], button: [160, 60], switch: [180, 50], lamp: [180, 44], value: [160, 64], setpoint: [160, 64], bar: [200, 44],
    motor: [110, 100], valve: [110, 90], pid: [260, 190], trend: [300, 150], alarms: [760, 44] };
  const FLABEL = { label: 'Label / text', tag: 'Tag', tag2: 'Second tag', color: 'Colour', unit: 'Unit', dec: 'Decimals', min: 'Scale min', max: 'Scale max',
    vert: 'Vertical', size: 'Font size', win: 'Window (s)' };
  let wrap, canvas, props, list = [], items = [], editing = false, sel = null, scale = 1, lastJson = '';
  const T = w => App.val(w.tag);
  const truthy = v => v === true || (typeof v === 'number' && v !== 0);
  const fmt = (v, d) => (v === undefined ? '?' : typeof v === 'boolean' ? (v ? 'ON' : 'OFF') : Number(v).toFixed(d === undefined || d === '' ? 1 : +d));

  function init(w, c, p) {
    wrap = w; canvas = c; props = p;
    $('#hmiEditBtn').onclick = () => setEdit(!editing);
    $('#hmiAddBtn').onclick = add;
    $('#hmiDupBtn').onclick = () => { if (!sel) return; const o = Object.assign({}, list.find(x => x.id === sel), { id: uid() }); o.x = Math.min(800 - o.w, o.x + 20); o.y = Math.min(480 - o.h, o.y + 20); list.push(o); changed(); select(o.id); };
    $('#hmiDelBtn').onclick = () => { if (!sel) return; const i = list.findIndex(x => x.id === sel); if (i >= 0) list.splice(i, 1); sel = null; changed(); };
    $('#hmiResetBtn').onclick = async () => { await fetch('/api/reset-project', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ part: 'hmi' }) }); sel = null; };
    $('#hmiFullBtn').onclick = () => { wrap.classList.toggle('full'); layout(); };
    canvas.addEventListener('pointerdown', onEditDown);
    $('#hmiTheme').onchange = e => { setTheme(e.target.value); build(); fetch('/api/hmitheme', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ theme: e.target.value }) }); };
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && wrap.classList.contains('full')) { wrap.classList.remove('full'); layout(); } });
  }
  const uid = () => 'w' + Math.random().toString(36).slice(2, 9);
  function setEdit(on) {
    editing = on; canvas.classList.toggle('editing', on);
    $('#hmiEditBtn').textContent = on ? '✓ Done' : '✎ Edit';
    $('#hmiEditTools').hidden = !on;
    if (!on) { sel = null; props.hidden = true; items.forEach(i => i.el.classList.remove('sel')); }
  }
  function load(l, soft) {
    const j = JSON.stringify(l);
    if (soft && j === lastJson) return;
    list = l; lastJson = j; build();
  }
  function changed() { lastJson = JSON.stringify(list); App.saveHmi(); build(); }
  function layout() {
    if (!wrap) return;
    const full = wrap.classList.contains('full');
    const W = wrap.clientWidth, H = full ? wrap.clientHeight : Infinity;
    scale = Math.min(W / 800, H / 480);
    canvas.style.transform = `scale(${scale})`;
    if (full) { canvas.style.left = ((W - 800 * scale) / 2) + 'px'; canvas.style.top = ((wrap.clientHeight - 480 * scale) / 2) + 'px'; wrap.style.height = ''; }
    else { canvas.style.left = canvas.style.top = '0'; wrap.style.height = (480 * scale) + 'px'; }
  }
  function pos(el, w) { Object.assign(el.style, { left: w.x + 'px', top: w.y + 'px', width: w.w + 'px', height: w.h + 'px' }); }
  function build() {
    canvas.innerHTML = '';
    items = list.map(w => { const it = make(w); it.w = w; pos(it.el, w); const rh = document.createElement('div'); rh.className = 'rh'; it.el.appendChild(rh); canvas.appendChild(it.el); return it; });
    if (sel) { const it = items.find(i => i.w.id === sel); if (it) it.el.classList.add('sel'); else sel = null; }
    layout();
    renderProps();
  }
  function write(tag, v) { if (!editing && tag) App.write(tag, v); }

  function make(w) {
    const el = document.createElement('div');
    el.className = 'w w-' + w.type; el.dataset.id = w.id;
    let upd = () => {};
    const col = COLORS[w.color] || null;
    switch (w.type) {
      case 'label':
        el.innerHTML = `<span style="font-size:${+w.size || 18}px;${col ? 'color:' + col : ''}">${esc(w.label || '')}</span>`; break;
      case 'button': {
        el.innerHTML = `<button class="hb ${w.color || 'gray'}">${esc(w.label || 'BUTTON')}</button>`;
        const b = el.firstChild;
        b.addEventListener('pointerdown', e => { if (editing) return; e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (x) {} write(w.tag, true); });
        const up = () => write(w.tag, false);
        b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
        upd = () => { const v = T(w); b.classList.toggle('on', truthy(v)); el.classList.toggle('bad', v === undefined); };
        break;
      }
      case 'switch':
        el.innerHTML = `<div class="trk"></div><div class="lbl">${esc(w.label || w.tag)}</div>`;
        el.addEventListener('click', () => { if (!editing) write(w.tag, !truthy(T(w))); });
        upd = () => { const v = T(w); el.classList.toggle('on', truthy(v)); el.classList.toggle('bad', v === undefined); };
        break;
      case 'lamp': {
        el.innerHTML = `<div class="dot"></div><div class="lbl">${esc(w.label || w.tag)}</div>`;
        el.style.setProperty('--c', col || COLORS.green);
        // ISA-101: red/amber lamps are abnormal indications and keep their colour; others show as gray "on"
        if (w.color === 'red' || w.color === 'amber') el.classList.add('alm');
        upd = () => { const v = T(w); el.classList.toggle('on', truthy(v)); el.classList.toggle('bad', v === undefined); };
        break;
      }
      case 'value': {
        el.innerHTML = `<div class="lbl">${esc(w.label || w.tag)}</div><div class="num"></div>`;
        const n = el.lastChild;
        upd = () => { const v = T(w); n.innerHTML = `${fmt(v, w.dec)}<small>${esc(w.unit || '')}</small>`; el.classList.toggle('bad', v === undefined); };
        break;
      }
      case 'setpoint': {
        el.innerHTML = `<div class="lbl">${esc(w.label || w.tag)}${w.unit ? ' (' + esc(w.unit) + ')' : ''}</div><input type="number" step="any">`;
        const inp = el.lastChild;
        inp.addEventListener('change', () => { if (inp.value !== '') write(w.tag, parseFloat(inp.value)); inp.blur(); });
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
        upd = () => { const v = T(w); if (document.activeElement !== inp) inp.value = v === undefined ? '' : fmt(v, w.dec === undefined ? 2 : w.dec); el.classList.toggle('bad', v === undefined); };
        break;
      }
      case 'bar': {
        el.innerHTML = `<div class="lbl">${esc(w.label || w.tag)}</div><div class="track"><div class="fill"></div></div><div class="bv"></div>`;
        const fill = el.querySelector('.fill'), bv = el.querySelector('.bv');
        el.style.setProperty('--c', col || COLORS.blue);
        if (!w.vert) { el.style.flexDirection = 'column'; }
        upd = () => {
          const v = T(w), lo = +w.min || 0, hi = +w.max || 100, f = Math.max(0, Math.min(1, ((+v || 0) - lo) / (hi - lo || 1)));
          if (w.vert) { fill.style.height = (f * 100) + '%'; fill.style.width = '100%'; } else { fill.style.width = (f * 100) + '%'; fill.style.height = '100%'; }
          bv.textContent = fmt(v, 1) + ' ' + (w.unit || ''); el.classList.toggle('bad', v === undefined);
        };
        break;
      }
      case 'motor': {
        el.innerHTML = `<svg viewBox="0 0 100 80"><circle cx="50" cy="40" r="28"/><text x="50" y="49" text-anchor="middle" font-size="26" font-weight="700" font-family="Barlow Condensed, Arial Narrow, sans-serif">M</text></svg><div class="lbl">${esc(w.label || w.tag)}</div>`;
        upd = () => { const v = T(w); el.classList.toggle('on', truthy(v)); el.classList.toggle('bad', v === undefined); };
        break;
      }
      case 'valve': {
        el.innerHTML = `<svg viewBox="0 0 100 70"><path class="body" d="M15 20 L50 40 L15 60 Z M85 20 L50 40 L85 60 Z" stroke-linejoin="round"/><path class="stem" d="M50 40 V12 M36 12 H64" stroke-width="4" fill="none"/></svg><div class="lbl">${esc(w.label || w.tag)}</div>`;
        upd = () => { const v = T(w); el.classList.toggle('on', truthy(v)); el.classList.toggle('bad', v === undefined); };
        break;
      }
      case 'alarms':
        el.innerHTML = '<span class="cnt"></span><span class="txt"></span>';
        el.addEventListener('click', () => { if (!editing) App.goTab('alarms'); });
        upd = () => {
          const a = (S.snap && S.snap.alarms) || [], un = a.filter(x => !x.acked), act = a.filter(x => x.active);
          el.classList.toggle('act', un.length > 0); el.classList.toggle('ack', !un.length && act.length > 0);
          el.firstChild.textContent = a.length ? `🔔 ${act.length} active${un.length ? ', ' + un.length + ' unacked' : ''}` : '✓ No alarms';
          el.lastChild.textContent = a.length ? a[0].msg : '';
        };
        break;
      case 'pid': {
        el.innerHTML = `<div class="hd"><span>${esc(w.label || w.tag)}</span><span class="md"></span></div>
          <div class="bars"><div><div class="t"><i style="background:#2f6aa8"></i></div><span>SP <b class="sp"></b></span></div>
          <div><div class="t"><i style="background:#5d6770"></i></div><span>PV <b class="pv"></b></span></div>
          <div><div class="t"><i style="background:#b88a00"></i></div><span>OUT <b class="y"></b></span></div></div>
          <div class="prm"><label>KP<input data-p="KP" type="number" step="any"></label><label>TN (s)<input data-p="TN" type="number" step="any"></label><label>TV (s)<input data-p="TV" type="number" step="any"></label></div>
          <div class="am"><button data-m="0">AUTO</button><button data-m="1">MAN</button><input data-p="Y_MANUAL" type="number" step="any" title="Manual output %" style="width:60px"></div>`;
        const bars = el.querySelectorAll('.t i'), sp = el.querySelector('.sp'), pv = el.querySelector('.pv'), y = el.querySelector('.y'), md = el.querySelector('.md');
        el.querySelectorAll('[data-p]').forEach(inp => {
          inp.addEventListener('change', () => { if (inp.value !== '') write(w.tag + '.' + inp.dataset.p, parseFloat(inp.value)); inp.blur(); });
          inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
        });
        el.querySelectorAll('[data-m]').forEach(b => b.addEventListener('click', () => write(w.tag + '.MANUAL', b.dataset.m === '1')));
        upd = () => {
          const g = m => App.val(w.tag + '.' + m);
          const ok = App.isFb(w.tag); el.classList.toggle('bad', !ok); if (!ok) { md.textContent = 'no PID named ' + w.tag; return; }
          const lo = +w.min || 0, hi = +w.max || 100, f = v => Math.max(0, Math.min(100, ((+v || 0) - lo) / (hi - lo || 1) * 100));
          const ylo = g('Y_MIN'), yhi = g('Y_MAX'), fy = Math.max(0, Math.min(100, (g('Y') - ylo) / ((yhi - ylo) || 1) * 100));
          bars[0].style.height = f(g('SETPOINT')) + '%'; bars[1].style.height = f(g('ACTUAL')) + '%'; bars[2].style.height = fy + '%';
          sp.textContent = fmt(g('SETPOINT'), 1); pv.textContent = fmt(g('ACTUAL'), 1); y.textContent = fmt(g('Y'), 1);
          const man = g('MANUAL'); md.textContent = (man ? 'MANUAL' : 'AUTO') + (g('LIMITS_ACTIVE') ? ' · LIMIT' : '') + (w.unit ? ' · ' + w.unit : '');
          el.querySelectorAll('[data-m]').forEach(b => b.classList.toggle('on', (b.dataset.m === '1') === !!man));
          el.querySelectorAll('[data-p]').forEach(inp => { const pv = g(inp.dataset.p); if (document.activeElement !== inp) inp.value = pv === undefined ? '' : +(+pv).toFixed(3); });
        };
        break;
      }
      case 'trend': {
        el.innerHTML = `<div class="lbl">${esc(w.label || '')}</div><canvas></canvas>`;
        const cv = el.querySelector('canvas');
        let t = 0;
        upd = () => { const now = performance.now(); if (now - t < 100) return; t = now; drawTrend(cv, [{ tag: w.tag, min: w.min ?? 0, max: w.max ?? 100 }, { tag: w.tag2, min: w.min ?? 0, max: w.max ?? 100 }], +w.win || 60, { compact: true, light: canvas.classList.contains('hp') }); };
        break;
      }
    }
    return { el, upd: () => { if (!editing || true) upd(); } };
  }

  let clockT = 0;
  function update() {
    for (const it of items) it.upd();
    const now = Date.now();
    if (now - clockT > 1000) { clockT = now; const c = document.getElementById('hmiClock'); if (c) c.textContent = new Date().toLocaleTimeString(); }
  }
  function setTheme(t) {
    t = t === 'dark' ? 'dark' : 'hp';
    canvas.classList.toggle('hp', t === 'hp'); canvas.classList.toggle('dark', t === 'dark');
    const sel = document.getElementById('hmiTheme'); if (sel) sel.value = t;
  }

  // ----- editing -----
  function select(id) {
    sel = id;
    items.forEach(i => i.el.classList.toggle('sel', i.w.id === id));
    renderProps();
  }
  function onEditDown(e) {
    if (!editing) return;
    const wEl = e.target.closest('.w');
    if (!wEl) { select(null); return; }
    const w = list.find(x => x.id === wEl.dataset.id); if (!w) return;
    select(w.id);
    const rs = e.target.classList.contains('rh');
    const sx = e.clientX, sy = e.clientY, o = { x: w.x, y: w.y, w: w.w, h: w.h };
    const snap = v => Math.round(v / 10) * 10;
    try { wEl.setPointerCapture(e.pointerId); } catch (x) {}
    const mv = ev => {
      const dx = (ev.clientX - sx) / scale, dy = (ev.clientY - sy) / scale;
      if (rs) { w.w = Math.max(20, Math.min(800 - w.x, snap(o.w + dx))); w.h = Math.max(20, Math.min(480 - w.y, snap(o.h + dy))); }
      else { w.x = Math.max(0, Math.min(800 - w.w, snap(o.x + dx))); w.y = Math.max(0, Math.min(480 - w.h, snap(o.y + dy))); }
      pos(wEl, w);
    };
    const up = () => { wEl.removeEventListener('pointermove', mv); wEl.removeEventListener('pointerup', up); wEl.removeEventListener('pointercancel', up); lastJson = JSON.stringify(list); App.saveHmi(); renderProps(); if (rs) build(); };
    wEl.addEventListener('pointermove', mv); wEl.addEventListener('pointerup', up); wEl.addEventListener('pointercancel', up);
    e.preventDefault();
  }
  function add() {
    const type = $('#hmiAddType').value, [w, h] = SIZES[type];
    const o = { id: uid(), type, x: 20, y: 60, w, h, label: type === 'label' ? 'Text' : type.toUpperCase() };
    if (type === 'button') o.color = 'gray';
    if (type === 'bar') { o.min = 0; o.max = 100; }
    if (type === 'pid') { o.tag = App.fbNames('PID')[0] || ''; o.min = 0; o.max = 100; o.label = o.tag || 'PID'; }
    if (type === 'trend') { o.min = 0; o.max = 100; o.win = 60; o.label = ''; }
    if (type === 'alarms') { o.x = 20; o.y = 420; }
    list.push(o); changed(); select(o.id);
  }
  function renderProps() {
    if (!editing || !sel) { props.hidden = true; return; }
    const w = list.find(x => x.id === sel); if (!w) { props.hidden = true; return; }
    props.hidden = false;
    const tagOpts = w.type === 'pid' ? App.fbNames('PID') : App.tagNames();
    const f = FIELDS[w.type].map(k => {
      if (k === 'tag' || k === 'tag2') return `<label>${FLABEL[k]}<input list="hmiTagDL" data-k="${k}" value="${esc(w[k] || '')}"></label>`;
      if (k === 'color') return `<label>${FLABEL[k]}<select data-k="color">${Object.keys(COLORS).map(c => `<option ${w.color === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>`;
      if (k === 'vert') return `<label>${FLABEL[k]}<input type="checkbox" data-k="vert" ${w.vert ? 'checked' : ''}></label>`;
      const numeric = ['dec', 'min', 'max', 'size', 'win'].includes(k);
      return `<label>${FLABEL[k]}<input ${numeric ? 'type="number" step="any"' : ''} data-k="${k}" value="${esc(w[k] ?? '')}"></label>`;
    }).join('');
    props.innerHTML = `<div class="row between"><b>${w.type}</b><span class="muted small">x ${w.x} · y ${w.y} · ${w.w}×${w.h}</span></div>
      <datalist id="hmiTagDL">${tagOpts.map(n => `<option value="${esc(n)}">`).join('')}</datalist><div class="grid">${f}</div>
      ${w.type === 'button' ? '<p class="muted small">Momentary: writes TRUE while pressed, FALSE on release. Point it at a memory BOOL (e.g. HMI_Start), not at an input.</p>' : ''}
      ${w.type === 'pid' ? '<p class="muted small">Tag = the name of a PID instance in your program. KP/TN/TV/MANUAL are written into the block — do not also assign them in the PID call, or the program will overwrite your tuning every scan.</p>' : ''}`;
    props.querySelectorAll('[data-k]').forEach(inp => {
      inp.addEventListener('change', () => {
        const k = inp.dataset.k;
        w[k] = inp.type === 'checkbox' ? inp.checked : inp.type === 'number' ? parseFloat(inp.value) : inp.value;
        changed();
      });
    });
  }
  return { init, load, layout, update, setTheme };
})();
