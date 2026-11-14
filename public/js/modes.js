'use strict';
/* Learning modes: home screen (guided path, troubleshooting, sandbox, practice), mission panel and the build tab. */
const MODES = (() => {
  const ICON = {
    learn: '<svg viewBox="0 0 24 24"><path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M7 9v5c0 1.5 2.5 3 5 3s5-1.5 5-3V9"/><path d="M21 7v6"/></svg>',
    chal: '<svg viewBox="0 0 24 24"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4 2.5-2.5z"/></svg>',
    build: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M17.5 14v7M14 17.5h7"/></svg>',
    prac: '<svg viewBox="0 0 24 24"><path d="M4 20V10l5 3V10l5 3V6l6 4v10z"/><path d="M4 20h16"/></svg>',
  };
  let W = null;                  // last /api/workspaces
  let M = null;                  // last /api/mission
  let homeMode = null;
  const fmtT = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  // ---------------------------------------------------------------- home
  async function openHome(mode) {
    W = await api('GET', '/api/workspaces');
    if (!W.ok) return;
    homeMode = mode || homeMode || ({ lesson: 'learn', challenge: 'chal', sandbox: 'build', practice: 'prac' }[S.info && S.info.kind] || 'learn');
    document.body.classList.add('home-open');
    renderHome();
    try { localStorage.setItem('plcf.seenHome', '1'); } catch (e) {}
  }
  function closeHome() { document.body.classList.remove('home-open'); }
  function renderHome() {
    const L = W.lessons, C = W.challenges, done = L.filter(x => x.done).length, solved = C.filter(x => x.done).length;
    const next = L.find(x => !x.done) || L[L.length - 1];
    const card = (id, cls, title, text, meta, prog) => `<button class="mode-card ${cls}${homeMode === id ? ' on' : ''}" data-mode="${id}"><div class="ic">${ICON[id]}</div><b>${title}</b><span>${text}</span>${prog !== undefined ? `<div class="prog"><i style="width:${prog}%"></i></div>` : ''}<span class="meta">${meta}</span></button>`;
    let sec = '';
    if (homeMode === 'learn') {
      const units = [...new Set(L.map(x => x.unit))];
      sec = `<div class="hsec"><div class="row between"><div><h2>Guided learning path</h2><p class="sub">Fifteen lessons that follow a typical industrial PLC certification syllabus. Each has its own machine, a task, hints, and an automatic grader that tests your program against the real simulation.</p></div>
          <button class="primary" data-ws="${next.ws}">${done ? 'Continue' : 'Start'}: ${esc(next.title)}</button></div>` +
        units.map(u => `<div class="unit-h">${esc(u)}</div><div class="mlist">` + L.filter(x => x.unit === u).map(x => `<button class="mitem${x.done ? ' done' : ''}${W.current === x.ws ? ' cur' : ''}" data-ws="${x.ws}">
          <span class="num"><span>${+x.id.slice(1)}</span></span><span class="tx"><b>${esc(x.title)}</b><small>${esc(x.summary)}</small>
          <span class="meta"><span class="chipk">${x.minutes} min</span>${x.done ? '<span class="chipk sandbox">passed</span>' : x.best ? `<span class="chipk">${x.best}/${x.objectives} objectives</span>` : x.started ? '<span class="chipk">started</span>' : ''}</span></span></button>`).join('') + '</div>').join('') + '</div>';
    } else if (homeMode === 'chal') {
      sec = `<div class="hsec"><h2>Troubleshooting</h2><p class="sub">A working plant with something wrong — a failed sensor, a stuck valve, a bad setting or a programming error. Read the work order, investigate with trends, tags and the I/O view, repair it, then close the work order with the root cause. Faster, cleaner fixes score higher; replacing healthy parts costs points.</p>
        <div class="mlist">${C.map(x => `<button class="mitem${x.done ? ' done' : ''}${W.current === x.ws ? ' cur' : ''}" data-ws="${x.ws}"><span class="num"><span>${+x.id.slice(1)}</span></span>
          <span class="tx"><b>${esc(x.title)}</b><span class="meta"><span class="diff ${x.difficulty}">${x.difficulty}</span><span class="chipk">${esc((W.practice.find(p => p.id === x.plant) || {}).name || x.plant).split(':')[0]}</span>
          <span class="chipk">par ${fmtT(x.par)}</span>${x.best ? `<span class="score-b">best ${x.best}</span>` : x.started ? '<span class="chipk">in progress</span>' : ''}</span></span></button>`).join('')}</div></div>`;
    } else if (homeMode === 'build') {
      sec = `<div class="hsec"><h2>Your machines</h2><p class="sub">Assemble a machine from tanks, valves, pumps, heaters, motors, conveyors, cylinders and an operator panel, then program it in ST or ladder. Every part simulates real behaviour: flow, heat, overloads, jams.</p>
        <div class="newsb"><input id="nsName" placeholder="Machine name, e.g. Mixing skid" maxlength="48"><select id="nsTpl">${W.templates.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select><button class="primary" id="nsGo" ${can('engineer') ? '' : 'disabled'}>Create machine</button></div>
        <div class="mlist">${W.sandboxes.map(x => `<div class="sbrow"><button class="mitem${W.current === x.id ? ' cur' : ''}" data-ws="${x.id}"><span class="num">${SBX.glyph('conveyor')}</span><span class="tx"><b>${esc(x.name)}</b><small>${x.components} parts · ${x.updated ? 'edited ' + new Date(x.updated).toLocaleDateString() : ''}</small></span></button>
          <span class="acts"><button data-ren="${x.id}" ${can('engineer') ? '' : 'disabled'}>Rename</button><button data-delsb="${x.id}" class="danger" ${can('engineer') ? '' : 'disabled'}>Delete</button></span></div>`).join('') || '<p class="muted">No machines yet — create one above.</p>'}</div></div>`;
    } else {
      sec = `<div class="hsec"><h2>Practice plants</h2><p class="sub">Complete process models with example programs, HMIs and alarms. Change anything — programs, sensors, alarms, faults — and see what happens.</p>
        <div class="mlist">${W.practice.map(x => `<button class="mitem${W.current === x.id ? ' cur' : ''}" data-ws="${x.id}"><span class="num">${SBX.glyph({ tank: 'tank', conveyor: 'conveyor', vialfiller: 'pump', bioreactor: 'heater' }[x.id] || 'tank')}</span><span class="tx"><b>${esc(x.name)}</b><small>${esc(x.blurb)}</small></span></button>`).join('')}</div></div>`;
    }
    $('#home').innerHTML = `<div class="home">
      <div class="row between"><div><h1>What would you like to do?</h1><p class="lead">PLCFACTORY is a soft PLC wired to simulated equipment. Pick how you want to learn.</p></div>
        ${S.info ? `<button id="hClose">Back to ${esc(S.info.wsName)}</button>` : ''}</div>
      <div class="modes">
        ${card('learn', '', 'Learn', 'Step-by-step lessons from first contact to PID loops, graded automatically.', `${done} of ${L.length} lessons passed`, done / L.length * 100)}
        ${card('chal', 'm-chal', 'Troubleshoot', 'Find and fix faults in running plants against the clock.', `${solved} of ${C.length} work orders closed`, solved / C.length * 100)}
        ${card('build', 'm-build', 'Build', 'Design your own machine from parts, then program it.', `${W.sandboxes.length} machine${W.sandboxes.length === 1 ? '' : 's'}`)}
        ${card('prac', 'm-prac', 'Practice', 'Free play on four complete example plants.', `${W.practice.length} plants`)}
      </div>${sec}
      <p class="muted small" style="margin-top:30px">Progress is saved per user. <a href="#" id="hReset">Reset my progress</a></p></div>`;
    $$('#home [data-mode]').forEach(b => b.onclick = () => { homeMode = b.dataset.mode; renderHome(); });
    $$('#home [data-ws]').forEach(b => b.onclick = () => go(b.dataset.ws));
    if ($('#hClose')) $('#hClose').onclick = closeHome;
    if ($('#nsGo')) $('#nsGo').onclick = async () => {
      const r = await api('POST', '/api/sandbox/new', { name: $('#nsName').value.trim() || 'My machine', template: $('#nsTpl').value });
      if (!r.ok) return toast(r.msg || 'Could not create', true);
      await entered('build');
    };
    $$('#home [data-delsb]').forEach(b => b.onclick = async () => {
      if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Really?'; return; }
      await api('POST', '/api/sandbox/delete', { id: b.dataset.delsb });
      if (S.info.ws === b.dataset.delsb) await refreshProject(true);
      openHome('build');
    });
    $$('#home [data-ren]').forEach(b => b.onclick = async () => {
      const name = prompt('New name for this machine:'); if (!name) return;
      const r = await api('POST', '/api/sandbox/rename', { id: b.dataset.ren, name }); if (!r.ok) return toast(r.msg, true);
      if (S.info.ws === b.dataset.ren) await refreshProject();
      openHome('build');
    });
    $('#hReset').onclick = async e => {
      e.preventDefault();
      if (e.target.dataset.sure !== '1') { e.target.dataset.sure = '1'; e.target.textContent = 'Click again to erase all lesson and challenge progress'; return; }
      await api('POST', '/api/progress/reset', {}); openHome();
    };
  }
  async function go(ws) {
    if (S.info && S.info.ws === ws) { closeHome(); return setTab(defaultTab()); }
    if (!can('engineer')) return toast('Switching workspaces needs the engineer role', true);
    if (S.editorDirty) toast('Your unsaved editor changes were kept as a draft in the previous workspace.');
    const r = await api('POST', '/api/workspace', { id: ws });
    if (!r.ok) return toast(r.msg || 'Could not open', true);
    await entered();
  }
  async function entered(tab) {
    await refreshProject(true);
    closeHome();
    setTab(tab || defaultTab());
  }
  function defaultTab() { const k = S.info.kind; return k === 'lesson' || k === 'challenge' ? 'mission' : k === 'sandbox' ? 'build' : 'hmi'; }

  // ---------------------------------------------------------------- mission panel
  async function loadMission() { M = await api('GET', '/api/mission'); return M; }
  async function renderMission() {
    if (!S.info || (S.info.kind !== 'lesson' && S.info.kind !== 'challenge')) { $('#mission').innerHTML = ''; return; }
    await loadMission();
    if (!M.ok) return;
    if (M.kind === 'lesson') renderLesson(); else renderChallenge();
  }
  const objList = (objs, results) => `<ul class="objs">${objs.map(o => { const r = results && results.find(x => x.id === o.id); return `<li class="${r ? (r.pass ? 'pass' : 'fail') : ''}"><span class="st"></span><span>${esc(o.text)}${r && !r.pass && r.msg ? `<span class="why">${esc(r.msg)}</span>` : ''}</span></li>`; }).join('')}</ul>`;
  const hintList = h => h.length ? `<ul class="hints">${h.map((x, i) => `<li><b>Hint ${i + 1}</b>${esc(x).replace(/`([^`]+)`/g, '<code>$1</code>')}</li>`).join('')}</ul>` : '';
  function renderLesson() {
    const m = M, eng = can('engineer');
    const passed = m.results ? m.results.filter(r => r.pass).length : 0;
    $('#mission').innerHTML = `<div class="mission">
      <div class="mhead"><span class="chipk lesson">Lesson ${m.index} of ${m.total}</span><span class="crumb">${esc(m.unit)} · about ${m.minutes} min</span>${m.done ? '<span class="chipk sandbox">passed</span>' : ''}</div>
      <h2>${esc(m.title)}</h2><p class="lead">${esc(m.summary)}</p>
      <details class="card prose" ${m.done ? '' : 'open'}><summary>Background</summary>${m.theory}</details>
      <div class="task prose"><b>Your task</b>${m.task}</div>
      ${m.done && m.results && passed === m.results.length ? `<div class="done-banner"><span class="big">✓</span><div><b>Lesson passed.</b><div class="small muted">${m.solutionViewed ? 'You looked at the reference solution — try the next one without it!' : m.hints.length ? `Passed with ${m.hints.length} hint${m.hints.length > 1 ? 's' : ''}.` : 'Passed without hints. Nice work.'}</div></div><span class="grow"></span>${m.next ? `<button class="primary" id="mNext">Next lesson →</button>` : '<b>Path complete!</b>'}</div>` : ''}
      <div class="card"><div class="row between"><h3 style="margin:0">Objectives</h3>${m.results ? `<span class="small muted">${passed} of ${m.results.length} passed at the last check</span>` : '<span class="small muted">Not checked yet</span>'}</div>
        ${objList(m.objectives, m.results)}
        <div class="mbar"><button class="primary" id="mCheck" ${eng ? '' : 'disabled'}>Check my program</button>
          <span class="small muted">Grades the program that is <b>in the PLC</b> (download first) in a fast-forward copy of this machine.</span></div></div>
      <div class="card"><div class="row between"><h3 style="margin:0">Stuck?</h3><span class="row">
          <button id="mHint" ${m.hints.length >= m.hintCount ? 'disabled' : ''}>${m.hints.length ? 'Another hint' : 'Show a hint'} (${m.hints.length}/${m.hintCount})</button>
          <button id="mSol" class="ghost" ${eng ? '' : 'disabled'}>Reference solution…</button></span></div>${hintList(m.hints)}</div>
      <div class="row between" style="margin-top:6px">${m.prev ? '<button id="mPrev" class="ghost">← Previous lesson</button>' : '<span></span>'}<button id="mAll" class="ghost">All lessons</button>${m.next ? '<button id="mNext2" class="ghost">Next lesson →</button>' : '<span></span>'}</div>
    </div>`;
    $('#mCheck').onclick = async e => {
      if (S.editorDirty) toast('Note: your editor has changes that are not downloaded — checking what is in the PLC.');
      e.target.disabled = true; e.target.textContent = 'Checking…';
      const r = await api('POST', '/api/grade', {});
      if (!r.ok) { toast(r.msg, true); e.target.disabled = false; e.target.textContent = 'Check my program'; return; }
      toast(r.done ? 'All objectives passed!' : `${r.passed} of ${r.total} objectives passed`, !r.done);
      renderMission();
    };
    $('#mHint').onclick = async () => { await api('POST', '/api/hint', {}); renderMission(); };
    $('#mSol').onclick = () => {
      modal(`<h3>Show the reference solution?</h3><p class="muted">It is loaded into the editor (not downloaded) so you can study it, replacing your current code. Your progress will note that you looked.</p>
        <div class="row" style="justify-content:flex-end"><button id="xNo">Cancel</button><button id="xYes" class="primary">Load solution into editor</button></div>`);
      $('#xNo').onclick = closeModal;
      $('#xYes').onclick = async () => {
        closeModal();
        const r = await api('POST', '/api/solution', {}); if (!r.ok) return toast(r.msg, true);
        S.units = canonUnits(r.units); S.cur = S.units.pous[0].id; edited(); setTab('program');
        toast('Solution loaded into the editor — Download to try it');
      };
    };
    if ($('#mNext')) $('#mNext').onclick = () => go(m.next);
    if ($('#mNext2')) $('#mNext2').onclick = () => go(m.next);
    if ($('#mPrev')) $('#mPrev').onclick = () => go(m.prev);
    $('#mAll').onclick = () => openHome('learn');
  }
  function renderChallenge() {
    const m = M, eng = can('engineer');
    const sensors = S.info.project.sensors.map(s => ['s:' + s.tag, s.tag, s.desc || (s.type === 'analog' ? 'transmitter' : 'sensor')]);
    const acts = S.info.plant.actuators.map(([n, , , d]) => ['a:' + n, n, d]);
    const rep = new Set(m.replaced);
    const b = m.breakdown;
    $('#mission').innerHTML = `<div class="mission">
      <div class="mhead"><span class="chipk challenge">Work order ${esc(m.id)}</span><span class="diff ${m.difficulty}">${m.difficulty}</span><span class="crumb">par ${fmtT(m.par)}</span><span class="grow"></span>
        <span class="timer${m.elapsed > m.par ? ' over' : ''}" id="mTimer">${fmtT(m.elapsed)}</span></div>
      <h2>${esc(m.title)}</h2>
      <div class="ticket">${m.ticket}</div>
      ${m.done ? `<div class="done-banner"><span class="big">${m.score}</span><div><b>Work order closed.</b><div class="small">Root cause: ${esc((m.causes.find(c => c.id === m.rootCause) || {}).text || m.rootCause)}${b && !b.causeOk ? ' — you picked a different cause' : ''}</div><div class="small muted">Best score: ${m.best}</div></div></div>
        <div class="card"><h3>Score</h3><table class="breakdown"><tr><td>Base</td><td>${b.base}</td></tr><tr><td>Time (${fmtT(b.elapsed)} vs par ${fmtT(m.par)})</td><td>${b.time}</td></tr><tr><td>Hints</td><td>${b.hints}</td></tr>
          <tr><td>Healthy parts replaced (${b.unneeded})</td><td>${b.parts}</td></tr><tr><td>Root cause</td><td>${b.cause}</td></tr><tr><td>Rejected attempts</td><td>${b.retries}</td></tr><tr class="tot"><td>Total</td><td>${m.score}</td></tr></table>
          <div class="mbar"><button id="mRestart">Try again</button><button id="mAll" class="primary">More work orders</button></div></div>` : ''}
      <div class="card"><h3>Acceptance tests</h3>${objList(m.objectives, m.results)}</div>
      ${m.done ? '' : `<div class="card"><h3>Maintenance</h3><p class="muted small" style="margin:0 0 6px">Replace a field device or repair an actuator. A replacement fixes a hardware failure — but replacing healthy parts costs points. Configuration and program problems are fixed in the I/O and Program tabs.</p>
        <details><summary class="small">Sensors (${sensors.length})</summary><div class="maint">${sensors.map(([k, n, d]) => `<div class="mi${rep.has(k) ? ' rep' : ''}"><span>${esc(n)}<small>${esc(d)}</small></span><button data-rep="${esc(k)}" ${rep.has(k) || !eng ? 'disabled' : ''}>${rep.has(k) ? 'Replaced' : 'Replace'}</button></div>`).join('')}</div></details>
        <details><summary class="small">Actuators (${acts.length})</summary><div class="maint">${acts.map(([k, n, d]) => `<div class="mi${rep.has(k) ? ' rep' : ''}"><span>${esc(n)}<small>${esc(d)}</small></span><button data-rep="${esc(k)}" ${rep.has(k) || !eng ? 'disabled' : ''}>${rep.has(k) ? 'Repaired' : 'Repair'}</button></div>`).join('')}</div></details></div>
      <div class="card"><div class="row between"><h3 style="margin:0">Hints</h3><button id="mHint" ${m.hints.length >= m.hintCount ? 'disabled' : ''}>Hint (−100 points) ${m.hints.length}/${m.hintCount}</button></div>${hintList(m.hints)}</div>
      <div class="card"><h3>Close the work order</h3><p class="muted small" style="margin:0 0 8px">The acceptance tests run against your current plant, I/O configuration and the program in the PLC. A rejected attempt costs 50 points.</p>
        <div class="row"><select id="mCause" style="flex:1;min-width:220px"><option value="">Root cause…</option>${m.causes.map(c => `<option value="${c.id}">${esc(c.text)}</option>`).join('')}</select>
          <button class="primary" id="mSubmit" ${eng ? '' : 'disabled'}>Submit</button></div></div>
      <div class="row between"><button id="mRestart" class="ghost">Restart this work order</button><button id="mAll" class="ghost">All work orders</button></div>`}
    </div>`;
    $$('#mission [data-rep]').forEach(bt => bt.onclick = async () => {
      if (bt.dataset.sure !== '1') { bt.dataset.sure = '1'; bt.textContent = 'Confirm'; return; }
      const r = await api('POST', '/api/challenge/replace', { what: bt.dataset.rep }); if (!r.ok) return toast(r.msg, true);
      toast('Done — the part was swapped'); renderMission();
    });
    if ($('#mHint')) $('#mHint').onclick = async () => { await api('POST', '/api/hint', {}); renderMission(); };
    if ($('#mSubmit')) $('#mSubmit').onclick = async e => {
      const cause = $('#mCause').value; if (!cause) return toast('Pick the root cause first', true);
      if (S.editorDirty) toast('Your editor has changes that are not downloaded — testing what is in the PLC.');
      e.target.disabled = true; e.target.textContent = 'Testing…';
      const r = await api('POST', '/api/challenge/submit', { cause });
      if (!r.ok) { toast(r.msg, true); } else toast(r.pass ? `Work order closed — ${r.score} points` : 'Rejected: the acceptance tests still fail', !r.pass);
      renderMission();
    };
    const restart = async () => {
      modal(`<h3>Restart this work order?</h3><p class="muted">The plant, program and I/O go back to the reported state and the clock restarts.</p><div class="row" style="justify-content:flex-end"><button id="xNo">Cancel</button><button id="xYes" class="danger">Restart</button></div>`);
      $('#xNo').onclick = closeModal;
      $('#xYes').onclick = async () => { closeModal(); await api('POST', '/api/reset-project', { part: 'all' }); await refreshProject(true); renderMission(); };
    };
    $$('#mRestart').forEach(x => x.onclick = restart);
    $$('#mAll').forEach(x => x.onclick = () => openHome('chal'));
  }
  function tick() {
    if (!M || M.kind !== 'challenge' || M.done) return;
    const el = $('#mTimer'); if (!el) return;
    const s = Math.round((Date.now() - M.startedAt) / 1000);
    const t = fmtT(s); if (el.textContent !== t) { el.textContent = t; el.classList.toggle('over', s > M.par); }
  }

  // ---------------------------------------------------------------- build tab
  let cat = null;
  async function renderBuild() {
    if (!S.info || S.info.kind !== 'sandbox') return;
    if (!cat) { const r = await api('GET', '/api/catalog'); if (r.ok) cat = r; }
    SBX.Builder.mount($('#build'), { ws: S.info.ws, layout: S.info.project.layout, sensors: S.info.project.sensors, cat, editable: can('engineer'), api, toast,
      onApplied: () => refreshProject() });
  }
  function onProject(wsChanged) {
    document.body.dataset.kind = S.info.kind;
    $('#wsBtn').innerHTML = `<span class="chipk ${S.info.kind}">${{ lesson: 'Lesson', challenge: 'Challenge', sandbox: 'My machine', practice: 'Practice' }[S.info.kind]}</span><span class="nm">${esc(S.info.wsName)}</span>`;
    const tab = document.body.dataset.tab;
    if ((tab === 'mission' && !['lesson', 'challenge'].includes(S.info.kind)) || (tab === 'build' && S.info.kind !== 'sandbox')) setTab(defaultTab());
    else if (tab === 'mission' && wsChanged) renderMission();
    if (S.info.kind === 'sandbox' && cat) SBX.Builder.sync({ ws: S.info.ws, layout: S.info.project.layout, sensors: S.info.project.sensors, editable: can('engineer'), cat });
  }
  return { openHome, closeHome, renderMission, renderBuild, onProject, tick, defaultTab };
})();
