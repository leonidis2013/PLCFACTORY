'use strict';
/* PLCFACTORY Ladder Diagram editor + online power-flow view.
   Rung = { comment, rows:[[contact…]…] (parallel branches of series contacts), outs:[output…] } */
const LDE = (() => {
  const IN = [['NO', 'Normally open contact  —| |—'], ['NC', 'Normally closed contact  —|/|—'], ['P', 'Rising edge contact  —|P|—'], ['N', 'Falling edge contact  —|N|—'], ['CMP', 'Compare  A ? B']];
  const OUT = [['COIL', 'Coil  —( )—'], ['NCOIL', 'Negated coil  —(/)—'], ['SET', 'Set (latch)  —(S)—'], ['RST', 'Reset (unlatch)  —(R)—'],
    ['TON', 'TON on-delay timer'], ['TOF', 'TOF off-delay timer'], ['TP', 'TP pulse timer'], ['CTU', 'CTU up counter'], ['CTD', 'CTD down counter'], ['RES', 'RES reset timer/counter'],
    ['MOV', 'MOV move'], ['ADD', 'ADD'], ['SUB', 'SUB'], ['MUL', 'MUL'], ['DIV', 'DIV'], ['BSL', 'BSL shift register left'], ['BSR', 'BSR shift register right'], ['ST', 'ST statement']];
  const OPS = ['=', '<>', '>', '>=', '<', '<='];
  const FIELDS = {
    NO: [['a', 'Tag']], NC: [['a', 'Tag']], P: [['a', 'Tag']], N: [['a', 'Tag']], CMP: [['a', 'A'], ['op', 'Compare'], ['b', 'B']],
    COIL: [['a', 'Tag']], NCOIL: [['a', 'Tag']], SET: [['a', 'Tag']], RST: [['a', 'Tag']],
    TON: [['a', 'Timer (TON variable)'], ['b', 'Preset PT']], TOF: [['a', 'Timer (TOF variable)'], ['b', 'Preset PT']], TP: [['a', 'Timer (TP variable)'], ['b', 'Preset PT']],
    CTU: [['a', 'Counter (CTU variable)'], ['b', 'Preset PV']], CTD: [['a', 'Counter (CTD variable)'], ['b', 'Preset PV']], RES: [['a', 'Timer/counter to reset']],
    MOV: [['a', 'Source'], ['b', 'Destination']], ADD: [['a', 'A'], ['b', 'B'], ['c', 'Dest = A + B']], SUB: [['a', 'A'], ['b', 'B'], ['c', 'Dest = A − B']],
    MUL: [['a', 'A'], ['b', 'B'], ['c', 'Dest = A × B']], DIV: [['a', 'A'], ['b', 'B'], ['c', 'Dest = A ÷ B']],
    BSL: [['a', 'Array'], ['b', 'Value shifted in (bit / record)']], BSR: [['a', 'Array'], ['b', 'Value shifted in (bit / record)']], ST: [['a', 'ST statement']],
  };
  const debounce2 = (fn, ms) => { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; };
  const isBox = t => !['NO', 'NC', 'P', 'N', 'COIL', 'NCOIL', 'SET', 'RST'].includes(t);
  let host, pou, opts, sel = null, errRung = 0;

  const truthy = v => v === true || (typeof v === 'number' && v !== 0);
  function value(expr) {
    if (expr === undefined || expr === null || expr === '') return undefined;
    const s = String(expr).trim();
    if (/^[+-]?\d+(\.\d+)?$/.test(s)) return parseFloat(s);
    if (/^TRUE$/i.test(s)) return true; if (/^FALSE$/i.test(s)) return false;
    const m = /^T#(\d+(?:\.\d+)?)(ms|s|m)$/i.exec(s);
    if (m) return parseFloat(m[1]) * ({ ms: 1, s: 1000, m: 60000 }[m[2].toLowerCase()]);
    return App.val(s);
  }
  function contactState(el) {
    const v = value(el.a);
    switch (el.t) {
      case 'NO': return v === undefined ? null : truthy(v);
      case 'NC': return v === undefined ? null : !truthy(v);
      case 'P': case 'N': return v === undefined ? null : truthy(v);       // show the variable; edge lasts one scan
      case 'CMP': {
        const a = value(el.a), b = value(el.b);
        if (a === undefined || b === undefined) return null;
        const x = +a, y = +b;
        return { '=': x === y, '<>': x !== y, '>': x > y, '>=': x >= y, '<': x < y, '<=': x <= y }[el.op];
      }
    }
    return null;
  }
  const esc2 = s => esc(s == null ? '' : s);

  function sym(el) {
    const t = el.t;
    const w = (inner, wide) => `<svg viewBox="0 0 ${wide || 64} 30" class="sym"><line x1="0" y1="15" x2="${(wide || 64)}" y2="15" class="wire"/>${inner}</svg>`;
    switch (t) {
      case 'NO': return w('<rect x="22" y="3" width="20" height="24" class="gap"/><line x1="24" y1="4" x2="24" y2="26" class="bar"/><line x1="40" y1="4" x2="40" y2="26" class="bar"/>');
      case 'NC': return w('<rect x="22" y="3" width="20" height="24" class="gap"/><line x1="24" y1="4" x2="24" y2="26" class="bar"/><line x1="40" y1="4" x2="40" y2="26" class="bar"/><line x1="27" y1="26" x2="37" y2="4" class="bar"/>');
      case 'P': case 'N': return w(`<rect x="22" y="3" width="20" height="24" class="gap"/><line x1="24" y1="4" x2="24" y2="26" class="bar"/><line x1="40" y1="4" x2="40" y2="26" class="bar"/><text x="32" y="20" class="lt">${t}</text>`);
      case 'COIL': case 'NCOIL': case 'SET': case 'RST': {
        const l = { COIL: '', NCOIL: '/', SET: 'S', RST: 'R' }[t];
        return w(`<rect x="18" y="3" width="28" height="24" class="gap"/><path d="M25 4 Q18 15 25 26 M39 4 Q46 15 39 26" class="bar" fill="none"/><text x="32" y="20" class="lt">${l}</text>`);
      }
    }
    return '';
  }
  function boxHtml(el) {
    const f = FIELDS[el.t] || [];
    let rows = '';
    if (el.t === 'CMP') rows = `<div class="bx-l">${esc2(el.a || '?')}</div><div class="bx-op">${esc2(el.op || '=')}</div><div class="bx-l">${esc2(el.b || '?')}</div>`;
    else rows = f.map(([k, lab]) => `<div class="bx-r"><span>${esc2(lab.split(' ')[0])}</span><b>${esc2(el[k] || '?')}</b></div>`).join('');
    let live = '';
    if (['TON', 'TOF', 'TP'].includes(el.t) && el.a) { const et = App.val(el.a + '.ET'), q = App.val(el.a + '.Q'); if (et !== undefined) live = `<div class="bx-live">ET ${(et / 1000).toFixed(1)} s · Q ${q ? 1 : 0}</div>`; }
    if (['CTU', 'CTD'].includes(el.t) && el.a) { const cv = App.val(el.a + '.CV'); if (cv !== undefined) live = `<div class="bx-live">CV ${cv}</div>`; }
    return `<div class="bx"><div class="bx-t">${el.t === 'CMP' ? 'CMP' : el.t}</div>${rows}${live}</div>`;
  }
  function elHtml(el, r, row, i, kind) {
    const id = `${r}:${row}:${i}`;
    const selc = sel === id ? ' sel' : '';
    if (isBox(el.t)) return `<div class="el box ${el.t}${selc}" data-id="${id}" data-k="${kind}">${boxHtml(el)}</div>`;
    return `<div class="el ${el.t}${selc}" data-id="${id}" data-k="${kind}"><div class="op">${esc2(el.a || '???')}</div>${sym(el)}<div class="lv"></div></div>`;
  }

  function render() {
    if (!host) return;
    const ed = opts.editable;
    const rungs = pou.rungs || (pou.rungs = []);
    host.innerHTML = `<datalist id="ldTags">${opts.tagNames().map(n => `<option value="${esc2(n)}">`).join('')}</datalist>` +
      rungs.map((rg, r) => `<div class="rung${errRung === r + 1 ? ' err' : ''}" data-r="${r}">
        <div class="rhead"><span class="rn">${String(r + 1).padStart(3, '0')}</span>
          ${ed ? `<input class="rc" data-r="${r}" value="${esc2(rg.comment)}" placeholder="Rung comment…">` : `<span class="rc">${esc2(rg.comment)}</span>`}
          ${ed ? `<span class="rtools"><button data-a="up" title="Move up">↑</button><button data-a="down" title="Move down">↓</button><button data-a="dup" title="Duplicate">⧉</button><button data-a="del" title="Delete rung" class="danger">✕</button></span>` : ''}
        </div>
        <div class="rbody">
          <div class="rail"></div>
          <div class="rin${(rg.rows || []).length > 1 ? ' par' : ''}">
            ${(rg.rows || []).map((row, j) => `<div class="lrow" data-row="${j}">${row.map((el, i) => elHtml(el, r, j, i, 'in')).join('<span class="wseg"></span>')}
              <span class="wseg fill"></span>${ed ? `<button class="add" data-a="addc" data-row="${j}" title="Add contact">＋</button>${(rg.rows.length > 1) ? `<button class="add" data-a="delrow" data-row="${j}" title="Remove branch">−</button>` : ''}` : ''}</div>`).join('') || '<div class="lrow"><span class="wseg fill"></span></div>'}
            ${ed ? `<button class="addb" data-a="addrow">＋ branch</button>` : ''}
          </div>
          <span class="wseg mid"></span>
          <div class="rout${(rg.outs || []).length > 1 ? ' par' : ''}">
            ${(rg.outs || []).map((el, i) => `<div class="lrow o">${elHtml(el, r, 'o', i, 'out')}<span class="wseg fill"></span></div>`).join('')}
            ${ed ? `<button class="addb" data-a="addout">＋ output</button>` : ''}
          </div>
          <div class="rail r"></div>
        </div>
        ${sel && sel.startsWith(r + ':') ? propsHtml(r) : ''}
      </div>`).join('') +
      (ed ? `<div class="row" style="margin:8px 0"><button data-a="addrung" class="primary">＋ Rung</button><span class="muted small">Click an element to edit it. Branches are OR'ed; contacts in a branch are AND'ed.</span></div>` : '');
    bind();
    update();
  }
  function getEl(id) {
    const [r, row, i] = id.split(':');
    const rg = pou.rungs[+r];
    if (!rg) return null;
    return row === 'o' ? { list: rg.outs, i: +i, kind: 'out', rg } : { list: rg.rows[+row], i: +i, kind: 'in', rg, row: +row };
  }
  function propsHtml(r) {
    const g = getEl(sel); if (!g) return '';
    const el = g.list[g.i]; if (!el) return '';
    const types = g.kind === 'in' ? IN : OUT;
    const fields = (FIELDS[el.t] || []).map(([k, lab]) => k === 'op'
      ? `<label>${lab}<select data-f="op">${OPS.map(o => `<option ${el.op === o ? 'selected' : ''}>${o}</option>`).join('')}</select></label>`
      : `<label>${lab}<input data-f="${k}" list="ldTags" value="${esc2(el[k])}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>`).join('');
    return `<div class="ldprops"><label>Instruction<select data-f="t">${types.map(([v, l]) => `<option value="${v}" ${el.t === v ? 'selected' : ''}>${esc2(l)}</option>`).join('')}</select></label>
      ${fields}${newTagHtml(el)}<div class="row"><button data-p="left" title="Move left/up">◀</button><button data-p="right" title="Move right/down">▶</button><button data-p="del" class="danger">Delete</button><button data-p="close">Done</button></div></div>`;
  }
  /* Undeclared operands get a "create tag" form right in the instruction editor */
  const TYPES = ['BOOL', 'INT', 'DINT', 'REAL', 'TIME', 'TON', 'TOF', 'TP', 'CTU', 'CTD', 'R_TRIG', 'F_TRIG'];
  function guessType(el, k) {
    if (['TON', 'TOF', 'TP', 'CTU', 'CTD'].includes(el.t) && k === 'a') return el.t;
    if (['NO', 'NC', 'P', 'N', 'COIL', 'NCOIL', 'SET', 'RST'].includes(el.t)) return 'BOOL';
    if (el.t === 'CMP' || el.t === 'MOV' || ['ADD', 'SUB', 'MUL', 'DIV'].includes(el.t)) return /\./.test(String(el.a) + String(el.b)) ? 'REAL' : 'INT';
    return 'BOOL';
  }
  function missing(el) {
    if (!opts.isDeclared || el.t === 'ST') return [];
    return (FIELDS[el.t] || []).filter(([k]) => k !== 'op' && (el.t !== 'RES' || k === 'a') && !((['TON', 'TOF', 'TP', 'CTU', 'CTD'].includes(el.t)) && k === 'b'))
      .map(([k]) => [k, String(el[k] || '').trim()])
      .filter(([, v]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(v) && !/^(TRUE|FALSE)$/i.test(v) && !opts.isDeclared(v));
  }
  function newTagHtml(el) {
    const m = missing(el); if (!opts.editable || !m.length) return '';
    return m.map(([k, v]) => `<div class="newtag"><span>⚠ <b>${esc2(v)}</b> isn't declared yet.</span>
      <select data-nt-type="${k}">${TYPES.map(t => `<option ${t === guessType(el, k) ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <button class="primary" data-nt="${k}">Create tag</button><span class="muted small">adds it to Globals</span></div>`).join('');
  }
  function changed() { opts.onChange(); render(); }
  function bind() {
    const ed = opts.editable;
    host.querySelectorAll('.el').forEach(e => e.onclick = ev => { if (!ed) return; ev.stopPropagation(); sel = sel === e.dataset.id ? null : e.dataset.id; render(); const f = host.querySelector('.ldprops input'); if (f && !f.value) f.focus(); });
    if (!ed) return;
    host.querySelectorAll('.rc').forEach(i => i.oninput = () => { pou.rungs[+i.dataset.r].comment = i.value; opts.onChange(); });
    host.querySelectorAll('[data-a]').forEach(b => b.onclick = ev => {
      ev.stopPropagation();
      const rEl = b.closest('.rung'), r = rEl ? +rEl.dataset.r : -1, rg = pou.rungs[r], a = b.dataset.a;
      if (a === 'addrung') { pou.rungs.push({ comment: '', rows: [[{ t: 'NO', a: '' }]], outs: [{ t: 'COIL', a: '' }] }); sel = `${pou.rungs.length - 1}:0:0`; }
      else if (a === 'up' && r > 0) { [pou.rungs[r - 1], pou.rungs[r]] = [pou.rungs[r], pou.rungs[r - 1]]; sel = null; }
      else if (a === 'down' && r < pou.rungs.length - 1) { [pou.rungs[r + 1], pou.rungs[r]] = [pou.rungs[r], pou.rungs[r + 1]]; sel = null; }
      else if (a === 'dup') { pou.rungs.splice(r + 1, 0, JSON.parse(JSON.stringify(rg))); sel = null; }
      else if (a === 'del') { if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Delete?'; return; } pou.rungs.splice(r, 1); sel = null; }
      else if (a === 'addc') { const row = +b.dataset.row; rg.rows[row].push({ t: 'NO', a: '' }); sel = `${r}:${row}:${rg.rows[row].length - 1}`; }
      else if (a === 'delrow') { rg.rows.splice(+b.dataset.row, 1); sel = null; }
      else if (a === 'addrow') { rg.rows.push([{ t: 'NO', a: '' }]); sel = `${r}:${rg.rows.length - 1}:0`; }
      else if (a === 'addout') { rg.outs.push({ t: 'COIL', a: '' }); sel = `${r}:o:${rg.outs.length - 1}`; }
      changed();
    });
    const pp = host.querySelector('.ldprops');
    if (pp) {
      const g = getEl(sel), el = g.list[g.i];
      pp.onclick = e => e.stopPropagation();
      pp.querySelectorAll('[data-f]').forEach(i => {
        const f = i.dataset.f;
        const apply = () => {
          el[f] = i.value;
          if (f === 't') { if (el.t === 'CMP' && !el.op) el.op = '='; if (['TON', 'TOF', 'TP'].includes(el.t) && !el.b) el.b = 'T#1s'; if (['CTU', 'CTD'].includes(el.t) && !el.b) el.b = '10'; changed(); }
          else opts.onChange();
        };
        i.onchange = apply; if (i.tagName === 'INPUT') i.oninput = () => { el[f] = i.value; opts.onChange(); const op = host.querySelector(`.el[data-id="${sel}"] .op`); if (op) op.textContent = i.value || '???'; };
        if (i.tagName === 'INPUT') i.onkeydown = e => { if (e.key === 'Enter') { sel = null; changed(); } };
      });
      // refresh only the "create tag" strip — a full re-render here would swallow the click that caused the blur
      const refreshNew = () => {
        pp.querySelectorAll('.newtag').forEach(n => n.remove());
        const html = newTagHtml(el); if (!html) return;
        pp.querySelector('.row:last-child').insertAdjacentHTML('beforebegin', html);
        pp.querySelectorAll('[data-nt]').forEach(b => b.onclick = ev => {
          ev.stopPropagation();
          const k = b.dataset.nt, ty = pp.querySelector(`[data-nt-type="${k}"]`).value;
          opts.declare(String(el[k]).trim(), ty); refreshNew();
        });
      };
      refreshNew();
      pp.querySelectorAll('input[data-f]').forEach(i => i.addEventListener('input', debounce2(refreshNew, 500)));
      pp.querySelectorAll('[data-p]').forEach(b => b.onclick = () => {
        const p = b.dataset.p;
        if (p === 'close') sel = null;
        else if (p === 'del') {
          g.list.splice(g.i, 1);
          if (g.kind === 'in' && !g.list.length && g.rg.rows.length > 1) g.rg.rows.splice(g.row, 1);
          sel = null;
        } else {
          const j = g.i + (p === 'left' ? -1 : 1);
          if (j >= 0 && j < g.list.length) { [g.list[j], g.list[g.i]] = [g.list[g.i], g.list[j]]; const parts = sel.split(':'); parts[2] = j; sel = parts.join(':'); }
        }
        changed();
      });
    }
  }
  // live power flow (called every frame while visible)
  function update() {
    if (!host || !pou) return;
    const online = !!(S.snap && S.snap.plc === 'RUN');
    host.classList.toggle('online', online);
    host.querySelectorAll('.rung').forEach(rEl => {
      const rg = pou.rungs[+rEl.dataset.r]; if (!rg) return;
      let rungPw = !(rg.rows || []).some(row => row.length);   // empty logic = always true
      rEl.querySelectorAll('.rin .lrow').forEach((rowEl, j) => {
        const row = (rg.rows || [])[j] || [];
        let pw = true;
        rowEl.querySelectorAll('.el').forEach((e, i) => {
          const el = row[i]; if (!el) return;
          const st = contactState(el);
          e.classList.toggle('on', st === true);
          e.classList.toggle('pw', pw && st === true);
          const lv = e.querySelector('.lv');
          if (lv) { const v = value(el.a); lv.textContent = v === undefined ? '' : typeof v === 'boolean' ? (v ? '1' : '0') : (+v).toFixed(Number.isInteger(+v) ? 0 : 2); }
          if (el.t === 'P' || el.t === 'N') pw = false; else pw = pw && st === true;
        });
        // edges are TRUE for one scan only: trust the generated result instead
        if (row.some(el => el.t === 'P' || el.t === 'N')) pw = false;
        rowEl.classList.toggle('pw', pw && row.length > 0);
        if (pw && row.length) rungPw = true;
      });
      // outputs: coils show their own tag state, boxes show rung power
      rEl.querySelectorAll('.rout .el').forEach((e, i) => {
        const el = (rg.outs || [])[i]; if (!el) return;
        let st = rungPw;
        if (['COIL', 'SET', 'RST', 'NCOIL'].includes(el.t)) { const v = value(el.a); if (v !== undefined) st = el.t === 'RST' ? !truthy(v) : el.t === 'NCOIL' ? !truthy(v) : truthy(v); }
        e.classList.toggle('on', !!st);
        e.classList.toggle('pw', rungPw);
        const lv = e.querySelector('.lv'); if (lv) { const v = value(el.a); lv.textContent = v === undefined ? '' : typeof v === 'boolean' ? (v ? '1' : '0') : (+v).toFixed(2); }
        if (isBox(el.t)) { const bl = e.querySelector('.bx-live'); if (bl && ['TON', 'TOF', 'TP'].includes(el.t)) { const et = App.val(el.a + '.ET'), q = App.val(el.a + '.Q'); if (et !== undefined) bl.textContent = `ET ${(et / 1000).toFixed(1)} s · Q ${q ? 1 : 0}`; } if (bl && ['CTU', 'CTD'].includes(el.t)) { const cv = App.val(el.a + '.CV'); if (cv !== undefined) bl.textContent = 'CV ' + cv; } }
      });
      rEl.classList.toggle('pw', rungPw);
    });
  }
  function mount(h, p, o) { host = h; pou = p; opts = o; sel = null; errRung = 0; render(); }
  function showError(rung, quiet) {
    errRung = rung || 0;
    if (quiet) { if (host) host.querySelectorAll('.rung').forEach(r => r.classList.toggle('err', +r.dataset.r + 1 === errRung)); return; }   // no re-render: keep focus while typing
    render(); const e = host && host.querySelector('.rung.err'); if (e) e.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  function rerender() { render(); }
  document.addEventListener('click', e => { if (sel && host && !e.target.closest('.ldprops') && !e.target.closest('.el') && host.contains(e.target)) { sel = null; render(); } });
  return { mount, update, showError, rerender };
})();
