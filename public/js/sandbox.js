'use strict';
/* Sandbox machines: 3D scene, 2D schematic, operator panel and the drag-and-drop machine builder.
   Layout units are metres; plan x → 3D x, plan y → 3D z. */
const SBX = (() => {
  const PI = Math.PI;
  const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
  const escS = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const f1 = (v, d = 1) => (v === undefined || v === null || !isFinite(v) ? '—' : (+v).toFixed(d));
  const COL = { green: '#1f9d5c', red: '#d33a3f', amber: '#e8a317', blue: '#2f62e6', white: '#eef1f4', black: '#2a2e33' };
  const LIT = { green: '#2fd17a', red: '#ff4d4d', amber: '#ffc531', blue: '#5b8cff', white: '#ffffff', black: '#777777' };
  const PANEL = new Set(['pushbutton', 'selector', 'estop', 'pot', 'pilot', 'stacklight']);

  // ---------- geometry ----------
  const tankGeo = c => { const R = clampN(0.28 * Math.cbrt((+c.props.capacity || 200) / 100), 0.22, 1.3); return { R, H: Math.max(0.6, R * 2.3), y0: 0.35 }; };
  const byId = L => Object.fromEntries(L.components.map(c => [c.id, c]));
  function anchor(L, c) {         // where a component is drawn (plan, metres)
    const m = byId(L);
    if (c.type === 'heater' && m[c.props.tank]) return { x: m[c.props.tank].x, y: m[c.props.tank].y };
    if (c.type === 'motor' && m[c.props.attach]) { const t = m[c.props.attach]; return { x: t.x, y: t.y - tankGeo(t).R * 1.2 - 0.12 }; }
    if (c.type === 'cylinder' && m[c.props.conveyor]) { const v = m[c.props.conveyor]; return { x: v.x + Math.min(+c.props.pos, +v.props.length), y: v.y - 0.42 }; }
    return { x: c.x, y: c.y };
  }
  function bounds(L) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
    for (const c of L.components) {
      const a = anchor(L, c);
      if (c.type === 'tank') { const g = tankGeo(c); add(a.x - g.R, a.y - g.R * 1.2); add(a.x + g.R, a.y + g.R * 1.2); }
      else if (c.type === 'conveyor') { add(a.x, a.y - 0.5); add(a.x + +c.props.length, a.y + 0.6); }
      else { add(a.x - 0.25, a.y - 0.25); add(a.x + 0.25, a.y + 0.25); }
      if (['valve', 'cvalve', 'pump'].includes(c.type)) { add(a.x - 0.8, a.y); add(a.x + 0.8, a.y); }
    }
    if (!isFinite(x0)) { x0 = -2; y0 = -1.5; x1 = 2; y1 = 1.5; }
    return { x0, y0, x1, y1 };
  }
  /** pipe endpoints: returns [{x,y,kind}] for source and destination of a flow element */
  function ends(L, c) {
    const m = byId(L), a = anchor(L, c);
    const one = (ref, isSrc) => {
      const t = m[ref];
      if (t && t.type === 'tank') {
        const g = tankGeo(t), side = Math.sign(a.x - t.x) || (isSrc ? 1 : -1);
        return { x: t.x + side * g.R, y: t.y + (isSrc ? 0.55 : -0.55) * g.R * 1.2, kind: 'tank', tank: t, top: !isSrc };
      }
      return { x: a.x + (isSrc ? -0.75 : 0.75), y: a.y, kind: ref === '@drain' ? 'drain' : 'supply' };
    };
    return [one(c.props.from, true), one(c.props.to, false)];
  }

  // ============================================================ 2D plan / schematic
  function glyph(type) {
    const g = {
      tank: '<rect x="5" y="2" width="10" height="16" rx="3"/><line x1="5" y1="11" x2="15" y2="11"/>',
      valve: '<path d="M3 6 L17 14 L17 6 L3 14 Z"/>',
      cvalve: '<path d="M3 9 L17 17 L17 9 L3 17 Z"/><path d="M6 6 Q10 0 14 6 Z"/><line x1="10" y1="6" x2="10" y2="13"/>',
      pump: '<circle cx="10" cy="10" r="7"/><path d="M7 5 L16 10 L7 15"/>',
      heater: '<path d="M2 10 L5 5 L8 15 L11 5 L14 15 L17 5 L18 8"/>',
      motor: '<circle cx="10" cy="10" r="7"/><text x="10" y="13.5" text-anchor="middle" font-size="9" stroke="none" fill="currentColor" font-weight="700">M</text>',
      conveyor: '<rect x="1" y="7" width="18" height="6" rx="3"/><circle cx="4" cy="10" r="1.2"/><circle cx="16" cy="10" r="1.2"/>',
      cylinder: '<rect x="2" y="6" width="10" height="8" rx="1"/><line x1="12" y1="10" x2="18" y2="10"/><line x1="18" y1="6" x2="18" y2="14"/>',
      pb: '<circle cx="10" cy="10" r="7"/><circle cx="10" cy="10" r="3.5" fill="currentColor"/>',
      selector: '<circle cx="10" cy="10" r="7"/><line x1="10" y1="10" x2="14" y2="5"/>',
      estop: '<circle cx="10" cy="10" r="8"/><circle cx="10" cy="10" r="5" fill="currentColor"/>',
      pot: '<circle cx="10" cy="10" r="7"/><line x1="10" y1="10" x2="6" y2="5"/><path d="M4 15 A8 8 0 1 1 16 15" stroke-dasharray="1 2"/>',
      pilot: '<circle cx="10" cy="10" r="6"/><line x1="10" y1="1" x2="10" y2="3"/><line x1="17" y1="10" x2="19" y2="10"/><line x1="1" y1="10" x2="3" y2="10"/>',
      stack: '<rect x="7" y="2" width="6" height="4" rx="1"/><rect x="7" y="7" width="6" height="4" rx="1"/><rect x="7" y="12" width="6" height="4" rx="1"/><line x1="10" y1="16" x2="10" y2="19"/>',
    }[type] || '<rect x="4" y="4" width="12" height="12"/>';
    return `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${g}</svg>`;
  }

  /**
   * plan(L, v, ctx, opts) → SVG markup.
   * v: live plant view (or null in the builder), ctx: { out } outputs, opts: { edit, sel }
   */
  function plan(L, v, ctx, opts = {}) {
    const S = 100, b = bounds(L), pad = 0.6;
    const vb = [(b.x0 - pad) * S, (b.y0 - pad) * S, Math.max(4, b.x1 - b.x0 + pad * 2) * S, Math.max(2.6, b.y1 - b.y0 + pad * 2) * S];
    const st = id => (v && v.c && v.c[id]) || {};
    const out = (ctx && ctx.out) || {};
    const ph = ((ctx && ctx.t) || 0) * 30 % 13;
    const m = byId(L);
    let pipes = '', body = '';
    const P = (x, y) => `${(x * S).toFixed(1)},${(y * S).toFixed(1)}`;
    // pipes first (under everything)
    for (const c of L.components) {
      if (!['valve', 'cvalve', 'pump'].includes(c.type)) continue;
      const a = anchor(L, c), [A, B] = ends(L, c), s = st(c.id);
      const d = `M${P(A.x, A.y)} L${P(A.x + (a.x - A.x) / 2, A.y)} L${P(A.x + (a.x - A.x) / 2, a.y)} L${P(a.x, a.y)} L${P(a.x + (B.x - a.x) / 2, a.y)} L${P(a.x + (B.x - a.x) / 2, B.y)} L${P(B.x, B.y)}`;
      pipes += `<path d="${d}" class="pipe"/>`;
      if (v && s.q > 0.0005) pipes += `<path d="${d}" class="flow" stroke-dashoffset="${-ph}"/>`;
      for (const E of [A, B]) {
        if (E.kind === 'supply') pipes += `<g transform="translate(${P(E.x, E.y)})"><path d="M-14 -7 L0 0 L-14 7" class="ln" fill="none"/><text x="-18" y="4" class="s" text-anchor="end">supply</text></g>`;
        if (E.kind === 'drain') pipes += `<g transform="translate(${P(E.x, E.y)})"><path d="M0 0 V12 M-9 12 H9 M-6 16 H6 M-3 20 H3" class="ln" fill="none"/></g>`;
      }
    }
    for (const c of L.components) {
      const a = anchor(L, c), s = st(c.id), x = a.x * S, y = a.y * S, p = c.props;
      const sel = opts.sel === c.id;
      let g = '', box = [-24, -24, 48, 48], lab = true, sub = '';
      switch (c.type) {
        case 'tank': {
          const G = tankGeo(c), w = G.R * S * 2, h = G.R * S * 2.4, lv = v ? (s.vol / p.capacity) : p.level / 100;
          const col = v ? `hsl(${215 - clampN((s.temp - 15) / 65, 0, 1) * 200},70%,55%)` : '';
          g = `<rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="10" class="ln"/>` +
            (lv > 0.003 ? `<rect x="${-w / 2 + 2}" y="${h / 2 - (h - 4) * clampN(lv, 0, 1) - 2}" width="${w - 4}" height="${(h - 4) * clampN(lv, 0, 1)}" rx="8" class="water" ${col ? `style="fill:${col}"` : ''}/>` : '') +
            `<text y="-4" text-anchor="middle" class="v">${v ? f1(lv * 100) + ' %' : p.capacity + ' L'}</text>` + (v ? `<text y="11" text-anchor="middle" class="v">${f1(s.temp)} °C</text>` : '') +
            (v && s.overflow ? `<text y="${-h / 2 - 22}" text-anchor="middle" class="t bad" style="fill:#e5484d">OVERFLOW</text>` : '');
          box = [-w / 2 - 4, -h / 2 - 4, w + 8, h + 8]; sub = `${p.capacity} L`;
          break;
        }
        case 'valve': case 'cvalve': {
          const pos = v ? s.pos : 0, cl = pos > 0.97 ? 'on' : pos > 0.03 ? '' : 'off';
          g = `<path d="M-14 -9 L14 9 L14 -9 L-14 9 Z" class="ln ${cl}" ${cl === '' ? 'style="fill:#e8a317"' : ''}/>` +
            (c.type === 'cvalve' ? `<path d="M-9 -16 Q0 -30 9 -16 Z" class="ln"/><line x1="0" y1="-16" x2="0" y2="0" class="ln"/>` : `<rect x="-6" y="-22" width="12" height="9" rx="2" class="ln"/><line x1="0" y1="-13" x2="0" y2="0" class="ln"/>`);
          sub = v ? `${Math.round(pos * 100)} %` : (c.type === 'cvalve' ? 'control' : 'on/off'); box = [-18, -34, 36, 46];
          break;
        }
        case 'pump': {
          const on = v && s.spd > 0.05;
          g = `<circle r="15" class="ln ${on ? 'on' : 'off'}"/><path d="M-6 -9 L11 0 L-6 9 Z" class="ln" style="fill:var(--pl-fill)"/>`;
          sub = v ? (s.dry > 0 ? 'DRY' : on ? `${f1(s.q * 60, 0)} L/min` : 'stopped') : `${p.flow} L/min`; box = [-19, -19, 38, 38];
          break;
        }
        case 'heater': {
          const pw = v ? s.pwr : 0, burnt = v && v.faults && v.faults[`${c.id}.burnt`];
          g = `<path d="M-22 18 L-15 8 L-8 28 L-1 8 L6 28 L13 8 L20 18" fill="none" style="stroke:${burnt ? '#555' : pw > 0.02 ? `hsl(15,90%,${40 + pw * 20}%)` : 'var(--pl-line)'};stroke-width:3"/>`;
          box = [-25, 4, 50, 28]; lab = false; sub = '';
          g += `<text x="26" y="24" class="s">${escS(c.name)}${v ? ' ' + Math.round(pw * 100) + '%' : ''}</text>`;
          break;
        }
        case 'motor': {
          const on = v && Math.abs(s.spd) > 0.05, ol = v && s.ol;
          g = `<circle r="15" class="ln ${ol ? 'bad' : on ? 'on' : 'off'}"/><text y="4.5" text-anchor="middle" class="t" style="fill:${on || ol ? '#fff' : 'var(--pl-text)'}">M</text>`;
          if (m[p.attach]) g += `<line x1="0" y1="15" x2="0" y2="${tankGeo(m[p.attach]).R * S * 1.2 + 4}" class="ln"/>`;
          sub = v ? (ol ? 'OVERLOAD' : on ? `${Math.round(s.spd * 100)} %` : 'stopped') : `${p.amps} A`; box = [-19, -19, 38, 38];
          break;
        }
        case 'conveyor': {
          const len = p.length * S, items = (v && s.items) || [];
          g = `<rect x="0" y="-16" width="${len}" height="32" rx="16" class="ln"/>`;
          for (let k = 0; k < len - 10; k += 22) g += `<line x1="${8 + k + (v ? (s.phase || 0) * 110 % 22 : 0)}" y1="-12" x2="${8 + k + (v ? (s.phase || 0) * 110 % 22 : 0)}" y2="12" style="stroke:var(--pl-off);stroke-width:1"/>`;
          for (const it of items) {
            const ix = it.pos * S, iy = (it.lat || 0) * 46, sz = it.tall ? 16 : 12;
            g += `<rect x="${ix - sz / 2}" y="${iy - sz / 2}" width="${sz}" height="${sz}" rx="2" style="fill:${it.state === 'jam' ? '#e5484d' : it.metal ? '#9aa6b2' : '#c49a64'};stroke:#0005"/>`;
          }
          g += `<rect x="${len - 14}" y="28" width="40" height="26" rx="4" class="ln"/><text x="${len + 6}" y="46" text-anchor="middle" class="v">${v ? s.bin.n : ''}</text>`;
          box = [-4, -20, len + 8, 40]; sub = v ? `${f1(Math.abs(s.v || 0), 2)} m/s` : `${p.length} m · ${p.speed} m/s`;
          // sensor markers from the I/O configuration
          let k = 0;
          for (const sn of (ctx && ctx.sensors) || []) {
            if (sn.type !== 'probe' || !String(sn.signal).startsWith(c.id + '.')) continue;
            const sx = (+sn.pos / 1000) * S, on = ctx.val ? !!ctx.val(sn.tag) : false, up = k++ % 2 === 0;
            g += `<line x1="${sx}" y1="-22" x2="${sx}" y2="22" style="stroke:${on ? 'var(--pl-on)' : 'var(--pl-sub)'};stroke-width:1.5;stroke-dasharray:3 3"/><circle cx="${sx}" cy="${up ? -24 : 24}" r="4" class="${on ? 'on' : 'off'}"/>` +
              `<text x="${sx + 6}" y="${up ? -30 : 38}" class="s">${escS(sn.tag)}</text>`;
          }
          break;
        }
        case 'cylinder': {
          const xx = v ? s.x : 0, push = p.mode !== 'stop';
          g = `<rect x="-12" y="-14" width="24" height="16" rx="2" class="ln"/><line x1="0" y1="2" x2="0" y2="${2 + xx * (push ? 30 : 22)}" class="ln" style="stroke-width:3"/>` +
            `<rect x="-12" y="${2 + xx * (push ? 30 : 22)}" width="24" height="4" rx="1" class="ln ${xx > 0.97 ? 'on' : ''}"/>`;
          if (push && m[p.conveyor]) g += `<rect x="-22" y="76" width="44" height="26" rx="4" class="ln"/><text y="94" text-anchor="middle" class="v">${v ? s.bin.n : ''}</text>`;
          sub = push ? 'pusher' : 'stopper'; box = [-16, -18, 32, 30];
          break;
        }
        case 'pushbutton': g = `<circle r="13" class="ln"/><circle r="9" style="fill:${COL[p.color]};opacity:${v && s.on ? 1 : .8}"/>`; box = [-17, -17, 34, 34]; break;
        case 'selector': {
          const n = +p.positions, pos = v ? s.pos : 0, ang = n === 2 ? (pos ? 45 : -45) : (pos - 1) * 45;
          g = `<circle r="13" class="ln"/><rect x="-3" y="-11" width="6" height="22" rx="2" transform="rotate(${ang})" style="fill:var(--pl-text)"/>`; box = [-17, -17, 34, 34];
          sub = v ? (p.labels.split(',')[pos] || pos) : `${n}-pos`;
          break;
        }
        case 'estop': g = `<circle r="15" style="fill:#f2c230"/><circle r="10" style="fill:${v && s.tripped ? '#8f1d18' : '#d2312b'}"/>`; sub = v && s.tripped ? 'TRIPPED' : ''; box = [-18, -18, 36, 36]; break;
        case 'pot': {
          const lo = +p.min, hi = +p.max, val = v ? s.value : lo, fr = hi === lo ? 0 : (val - lo) / (hi - lo);
          g = `<circle r="13" class="ln"/><line x1="0" y1="0" x2="${Math.cos((fr * 270 - 225) * PI / 180) * 11}" y2="${Math.sin((fr * 270 - 225) * PI / 180) * 11}" class="ln" style="stroke-width:3"/>`;
          sub = v ? `${f1(val, 1)} ${p.unit}` : `${lo}–${hi}`; box = [-17, -17, 34, 34];
          break;
        }
        case 'pilot': {
          const on = !!out['Q_' + c.name];
          g = `<circle r="12" class="ln"/><circle r="8" style="fill:${on ? LIT[p.color] : COL[p.color]};opacity:${on ? 1 : .3}"/>` + (on ? `<circle r="15" style="fill:none;stroke:${LIT[p.color]};opacity:.5;stroke-width:3"/>` : '');
          box = [-17, -17, 34, 34];
          break;
        }
        case 'stacklight': {
          const q = k => !!out[`Q_${c.name}_${k}`];
          g = `<rect x="-8" y="-26" width="16" height="12" rx="3" style="fill:${q('Red') ? '#ff4d4d' : '#ff4d4d44'}"/><rect x="-8" y="-12" width="16" height="12" rx="3" style="fill:${q('Amber') ? '#ffc531' : '#ffc53144'}"/>` +
            `<rect x="-8" y="2" width="16" height="12" rx="3" style="fill:${q('Green') ? '#2fd17a' : '#2fd17a44'}"/><line x1="0" y1="14" x2="0" y2="24" class="ln"/>` + (q('Horn') ? `<text x="12" y="-14" class="t" style="fill:#e5484d">♪</text>` : '');
          box = [-12, -30, 24, 56];
          break;
        }
      }
      const labY = box[1] + box[3] + 13;
      if (c.type === 'cylinder') { lab = false; g += `<text x="-18" y="-4" text-anchor="end" class="t">${escS(c.name)}</text><text x="-18" y="9" text-anchor="end" class="s">${escS(sub)}</text>`; }
      body += `<g class="comp${sel ? ' sel' : ''}" data-id="${escS(c.id)}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})">` +
        `<rect x="${box[0]}" y="${box[1]}" width="${box[2]}" height="${box[3]}" style="fill:transparent" class="hit"/>${g}` +
        (lab ? `<text y="${labY}" ${c.type === 'conveyor' ? `x="${p.length * S / 2}"` : ''} text-anchor="middle" class="t">${escS(c.name)}</text>` + (sub ? `<text y="${labY + 13}" ${c.type === 'conveyor' ? `x="${p.length * S / 2}"` : ''} text-anchor="middle" class="s">${escS(sub)}</text>` : '') : '') +
        (sel ? `<rect x="${box[0] - 4}" y="${box[1] - 4}" width="${box[2] + 8}" height="${box[3] + 8}" rx="6" class="selbox"/>` : '') + '</g>';
    }
    if (!L.components.length) body = `<text x="${vb[0] + vb[2] / 2}" y="${vb[1] + vb[3] / 2}" text-anchor="middle" class="s" style="font-size:14px">Add parts from the palette to build your machine</text>`;
    return `<svg class="plan${opts.edit ? ' edit' : ''}" viewBox="${vb.map(n => n.toFixed(0)).join(' ')}" preserveAspectRatio="xMidYMid meet">${pipes}${body}</svg>`;
  }

  // ============================================================ 3D scene
  const STEEL = '#a9b3bd', DARK = '#3b434c', OFF = '#58626d', ON = '#2fbf71', GLASS = '#b9d4ea';
  const box = (p, s, c, o) => Object.assign({ m: 'box', p, s, c }, o);
  const cyl = (p, r, h, c, o) => Object.assign({ m: 'cyl', p, s: [r, h, r], c }, o);
  const sph = (p, r, c, o) => Object.assign({ m: 'sph', p, s: [r, r, r], c }, o);
  function seg(objs, a, b, r, c) {         // axis-aligned pipe between 3D points a and b (must differ in one axis)
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], len = Math.hypot(...d);
    if (len < 0.005) return;
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    if (Math.abs(d[1]) > 0.001) objs.push(cyl(mid, r, len, c));
    else if (Math.abs(d[0]) > 0.001) objs.push(cyl(mid, r, len, c, { r: [0, 0, PI / 2], s: [r, len, r] }));
    else objs.push(cyl(mid, r, len, c, { r: [PI / 2, 0, 0], s: [r, len, r] }));
  }
  function route(objs, pts, r, c) { for (let i = 1; i < pts.length; i++) seg(objs, pts[i - 1], pts[i], r, c); }
  const mixC = (a, b, f) => { const A = GL3D.hex(a), B = GL3D.hex(b); return A.map((v, i) => v + (B[i] - v) * clampN(f, 0, 1)); };

  function scene3d(v, ctx) {
    const L = v.layout || { components: [] }, objs = [], labels = [], m = byId(L), out = ctx.out || {};
    const b = bounds(L), cx = (b.x0 + b.x1) / 2, cz = (b.y0 + b.y1) / 2;
    const T = window.GL3D_THEME || {};
    const W = Math.max(8, Math.ceil(b.x1 - b.x0 + 4)), D = Math.max(6, Math.ceil(b.y1 - b.y0 + 4));
    objs.push(box([cx, -0.05, cz], [W, 0.1, D], T.floor || '#1d2126'));
    for (let i = Math.floor(cx - W / 2); i <= cx + W / 2; i++) objs.push(box([i, 0.002, cz], [0.008, 0.004, D], T.grid || '#272c32'));
    for (let j = Math.floor(cz - D / 2); j <= cz + D / 2; j++) objs.push(box([cx, 0.002, j], [W, 0.004, 0.008], T.grid || '#272c32'));
    const st = id => (v.c && v.c[id]) || {};
    const lab = (p, t, cls) => labels.push({ p, t, cls: cls || '' });
    for (const c of L.components) {
      const a = anchor(L, c), x = a.x, z = a.y, s = st(c.id), p = c.props;
      switch (c.type) {
        case 'tank': {
          const g = tankGeo(c), lv = clampN(s.vol / p.capacity, 0, 1);
          for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) objs.push(box([x + dx * g.R * 0.65, g.y0 / 2, z + dz * g.R * 0.65], [0.06, g.y0, 0.06], DARK));
          objs.push(cyl([x, g.y0 - 0.01, z], g.R + 0.015, 0.03, STEEL));
          if (lv > 0.003) objs.push(cyl([x, g.y0 + g.H * lv / 2, z], g.R - 0.02, g.H * lv, mixC('#2f7fd6', '#e0663a', (s.temp - 15) / 65), { a: 0.8 }));
          objs.push(cyl([x, g.y0 + g.H / 2, z], g.R, g.H, GLASS, { a: 0.16 }));
          objs.push(cyl([x, g.y0 + g.H + 0.015, z], g.R + 0.015, 0.03, STEEL));
          lab([x, g.y0 + g.H * lv + 0.06, z + g.R], `${c.name} ${f1(lv * 100)}% · ${f1(s.temp)}°C`, s.overflow ? 'bad big' : 'big');
          break;
        }
        case 'heater': {
          const t = m[p.tank]; if (!t) break;
          const g = tankGeo(t), pw = s.pwr || 0, burnt = v.faults && v.faults[`${c.id}.burnt`];
          const hc = burnt ? '#2b2b2b' : mixC('#6b4a40', '#ff4a1a', pw);
          for (let i = 0; i < 10; i++) { const an = i / 10 * 2 * PI, rr = g.R * 0.62; objs.push(box([x + Math.cos(an) * rr, g.y0 + 0.07, z + Math.sin(an) * rr], [0.05, 0.05, g.R * 0.35], hc, { r: [0, -an, 0], e: pw > 0.05 ? 0.5 * pw : 0 })); }
          if (pw > 0.01 || burnt) lab([x + g.R * 0.6, g.y0 + 0.1, z + g.R * 0.7], burnt ? `${c.name} BURNED OUT` : `${c.name} ${Math.round(pw * 100)}%`, burnt ? 'bad' : 'on');
          break;
        }
        case 'valve': case 'cvalve': case 'pump': {
          const [A, B] = ends(L, c), h = c.type === 'pump' ? 0.3 : 0.9;
          const yA = A.kind === 'tank' ? tankGeo(A.tank).y0 + 0.08 : h, yB = B.kind === 'tank' ? tankGeo(B.tank).y0 + tankGeo(B.tank).H + 0.15 : h;
          const pr = c.type === 'pump' ? 0.05 : 0.04;
          const midA = A.x + (x - A.x) / 2, midB = x + (B.x - x) / 2;
          route(objs, [[A.x, yA, A.y], [midA, yA, A.y], [midA, yA, z], [midA, h, z], [x, h, z]], pr, STEEL);
          route(objs, [[x, h, z], [midB, h, z], [midB, h, B.y], [midB, yB, B.y], [B.x, yB, B.y]], pr, STEEL);
          if (B.kind === 'tank') route(objs, [[B.x, yB, B.y], [B.x - Math.sign(B.x - B.tank.x) * 0.1, yB, B.y], [B.x - Math.sign(B.x - B.tank.x) * 0.1, yB - 0.12, B.y]], pr, STEEL);
          if (A.kind === 'supply') objs.push(cyl([A.x, yA, A.y], pr * 1.8, 0.05, '#3f7fc4', { r: [0, 0, PI / 2], s: [pr * 1.8, 0.05, pr * 1.8] }));
          if (B.kind === 'drain') { route(objs, [[B.x, yB, B.y], [B.x, 0.02, B.y]], pr, STEEL); objs.push(box([B.x, 0.01, B.y], [0.3, 0.02, 0.3], DARK)); }
          if (c.type === 'pump') {
            const on = s.spd > 0.05;
            objs.push(cyl([x, h, z], 0.2, 0.18, s.dry > 0 ? '#e0663a' : on ? ON : OFF, { r: [PI / 2, 0, 0] }));
            objs.push(box([x, h, z - 0.28], [0.22, 0.22, 0.32], DARK));
            objs.push(box([x + Math.cos(ctx.t * 12 * (on ? 1 : 0)) * 0.1, h + Math.sin(ctx.t * 12 * (on ? 1 : 0)) * 0.1, z + 0.1], [0.05, 0.05, 0.03], '#ddd'));
            lab([x, h + 0.38, z], `${c.name} ${s.dry > 0 ? 'DRY' : on ? f1(s.q * 60, 0) + ' L/min' : 'off'}`, s.dry > 0 ? 'bad' : on ? 'on' : '');
          } else {
            const col = mixC(OFF, ON, s.pos);
            objs.push(box([x, h, z], [0.2, 0.13, 0.13], col));
            objs.push(cyl([x, h + 0.13, z], 0.025, 0.14, DARK));
            if (c.type === 'cvalve') objs.push(sph([x, h + 0.24, z], 0.1, col)); else objs.push(box([x, h + 0.23, z], [0.12, 0.08, 0.12], col));
            lab([x, h + 0.45, z], `${c.name} ${Math.round(s.pos * 100)}%`, s.pos > 0.5 ? 'on' : '');
          }
          break;
        }
        case 'motor': {
          const t = m[p.attach], on = Math.abs(s.spd) > 0.05, col = s.ol ? '#e5484d' : on ? ON : OFF;
          if (t) {
            const g = tankGeo(t), top = g.y0 + g.H;
            objs.push(box([t.x, top + 0.18, t.y], [0.24, 0.3, 0.24], col));
            objs.push(cyl([t.x, g.y0 + g.H / 2 + 0.05, t.y], 0.02, g.H - 0.05, STEEL));
            for (const k of [0, PI / 2]) objs.push(box([t.x, g.y0 + 0.22, t.y], [g.R * 1.1, 0.03, 0.09], STEEL, { r: [0.35, s.ang * PI / 180 + k, 0] }));
            lab([t.x, top + 0.45, t.y], `${c.name} ${s.ol ? 'OVERLOAD' : on ? Math.round(s.spd * 100) + '%' : 'off'}`, s.ol ? 'bad' : on ? 'on' : '');
          } else {
            objs.push(box([x, 0.08, z], [0.5, 0.06, 0.32], DARK));
            objs.push(cyl([x, 0.28, z], 0.15, 0.4, col, { r: [0, 0, PI / 2], s: [0.15, 0.4, 0.15] }));
            objs.push(cyl([x + 0.28, 0.28, z], 0.025, 0.16, STEEL, { r: [0, 0, PI / 2], s: [0.025, 0.16, 0.025] }));
            objs.push(box([x + 0.37, 0.28, z], [0.03, 0.2, 0.06], '#ddd', { r: [s.ang * PI / 180, 0, 0] }));
            lab([x, 0.6, z], `${c.name} ${s.ol ? 'OVERLOAD' : on ? Math.round(s.spd * 100) + '%' : 'off'}`, s.ol ? 'bad' : on ? 'on' : '');
          }
          break;
        }
        case 'conveyor': {
          const len = +p.length, y = 0.75, run = Math.abs(s.v || 0) > 0.001;
          objs.push(box([x + len / 2, y - 0.04, z], [len, 0.05, 0.42], '#2a2f35'));
          objs.push(box([x + len / 2, y - 0.01, z], [len, 0.015, 0.38], '#3a4048'));
          for (const sd of [-1, 1]) objs.push(box([x + len / 2, y - 0.03, z + sd * 0.23], [len, 0.1, 0.03], STEEL));
          for (let k = 0; k <= len; k += Math.max(0.6, len / 6)) for (const sd of [-1, 1]) objs.push(box([x + k, (y - 0.08) / 2, z + sd * 0.2], [0.04, y - 0.08, 0.04], DARK));
          for (let k = 0; k < len; k += 0.2) objs.push(box([x + ((k + (s.phase || 0)) % len), y + 0.002, z], [0.01, 0.004, 0.36], '#4a5159'));
          for (const it of s.items || []) {
            const hh = it.tall ? 0.28 : 0.14;
            objs.push(box([x + it.pos, y + hh / 2 + 0.01, z + (it.lat || 0) * 0.5], [0.16, hh, 0.16], it.state === 'jam' ? '#e5484d' : it.metal ? '#aab4be' : '#b9946a', { e: it.state === 'jam' ? 0.3 : 0 }));
          }
          objs.push(box([x + len + 0.25, 0.15, z], [0.4, 0.3, 0.5], '#2d6cdf', { a: 0.85 }));
          lab([x + len / 2, y + 0.45, z - 0.25], `${c.name} ${run ? f1(Math.abs(s.v), 2) + ' m/s' : 'stopped'} · ${s.bin ? s.bin.n : 0} out`, run ? 'on' : '');
          for (const sn of ctx.sensors || []) {
            if (sn.type !== 'probe' || !String(sn.signal).startsWith(c.id + '.')) continue;
            const sx = x + +sn.pos / 1000, on = !!ctx.val(sn.tag);
            objs.push(box([sx, y + 0.18, z - 0.27], [0.05, 0.36, 0.05], DARK));
            objs.push(box([sx, y + (sn.signal.endsWith('.tall') ? 0.26 : 0.08), z - 0.25], [0.06, 0.06, 0.06], on ? ON : '#d4a72c', { e: on ? 0.5 : 0 }));
            lab([sx, y + 0.5, z - 0.3], sn.tag, on ? 'on' : 'dim');
          }
          break;
        }
        case 'cylinder': {
          const t = m[p.conveyor], xx = s.x || 0, y = 0.75 + 0.12;
          if (!t) { objs.push(box([x, 0.4, z], [0.12, 0.12, 0.4], STEEL)); break; }
          const push = p.mode !== 'stop';
          objs.push(box([x, y, z - 0.18], [0.1, 0.1, 0.36], STEEL));
          objs.push(cyl([x, y, z + xx * (push ? 0.42 : 0.3) / 2], 0.015, xx * (push ? 0.42 : 0.3) + 0.02, '#ddd', { r: [PI / 2, 0, 0] }));
          objs.push(box([x, y, z + xx * (push ? 0.42 : 0.3)], push ? [0.2, 0.14, 0.02] : [0.03, 0.14, 0.03], xx > 0.97 ? ON : OFF));
          if (push) objs.push(box([x, 0.2, z + 0.62], [0.42, 0.4, 0.4], '#2d6cdf', { a: 0.85 }));
          lab([x, y + 0.35, z - 0.35], `${c.name} ${xx > 0.97 ? 'ext' : xx < 0.03 ? 'ret' : '…'}${push && s.bin ? ' · ' + s.bin.n + ' in bin' : ''}`, xx > 0.5 ? 'on' : '');
          break;
        }
        default:
          if (!PANEL.has(c.type)) break;
          objs.push(box([x, 0.45, z], [0.08, 0.9, 0.08], DARK));
          objs.push(box([x, 0.98, z], [0.2, 0.16, 0.16], '#cfd5db'));
          if (c.type === 'pushbutton') objs.push(cyl([x, 1.08 - (s.on ? 0.015 : 0), z], 0.055, 0.04, COL[p.color]));
          if (c.type === 'pilot') { const on = !!out['Q_' + c.name]; objs.push(sph([x, 1.1, z], 0.06, on ? LIT[p.color] : COL[p.color], { e: on ? 0.9 : 0 })); }
          if (c.type === 'estop') { objs.push(box([x, 1.065, z], [0.2, 0.01, 0.16], '#f2c230')); objs.push(cyl([x, 1.09 - (s.tripped ? 0.02 : 0), z], 0.06, 0.05, '#d2312b')); }
          if (c.type === 'selector') { objs.push(cyl([x, 1.08, z], 0.05, 0.03, '#2a2e33')); objs.push(box([x, 1.1, z], [0.02, 0.02, 0.09], '#eee', { r: [0, ((+p.positions === 2 ? (s.pos ? 45 : -45) : (s.pos - 1) * 45)) * PI / 180, 0] })); }
          if (c.type === 'pot') { objs.push(cyl([x, 1.09, z], 0.045, 0.05, '#2a2e33')); }
          if (c.type === 'stacklight') {
            objs.push(cyl([x, 1.15, z], 0.015, 0.2, DARK));
            [['Green', 1.27], ['Amber', 1.35], ['Red', 1.43]].forEach(([k, yy]) => { const on = !!out[`Q_${c.name}_${k}`], col = { Green: '#2fd17a', Amber: '#ffc531', Red: '#ff4d4d' }[k]; objs.push(cyl([x, yy, z], 0.045, 0.075, col, { a: on ? 1 : 0.35, e: on ? 0.9 : 0 })); });
          }
          lab([x, c.type === 'stacklight' ? 1.6 : 1.3, z], c.name + (c.type === 'pot' ? ` ${f1(s.value, 1)} ${p.unit}` : c.type === 'selector' ? ` ${(p.labels.split(',')[s.pos] || s.pos)}` : ''), 'dim');
      }
    }
    return { objs, labels };
  }
  function cam(L) {
    const b = bounds(L), ext = Math.max(b.x1 - b.x0, b.y1 - b.y0, 2);
    return { yaw: 0.35, pitch: 0.5, dist: clampN(ext * 1.35 + 1.5, 3, 30), target: [(b.x0 + b.x1) / 2, 0.6, (b.y0 + b.y1) / 2] };
  }

  // ============================================================ operator panel (live)
  function panel(el, L, v, ctx, send) {
    const devs = L.components.filter(c => PANEL.has(c.type));
    const key = JSON.stringify(devs.map(c => [c.id, c.type, c.name, c.props]));
    if (el._k !== key) {
      el._k = key;
      el.innerHTML = devs.length ? '<div class="ttl">Operator panel</div>' + devs.map(c => {
        const p = c.props, nm = `<span class="nm" title="${escS(c.name)}">${escS(c.name)}</span>`;
        if (c.type === 'pushbutton') return `<div class="odev">${nm}<div class="opb c-${p.color}" data-pb="${c.id}" data-latch="${p.latch ? 1 : 0}" title="${p.latch ? 'Maintained: click to toggle' : 'Momentary: hold to press'}"></div></div>`;
        if (c.type === 'selector') return `<div class="odev">${nm}<div class="osel">${p.labels.split(',').slice(0, +p.positions).map((l, i) => `<button data-sel="${c.id}" data-pos="${i}">${escS(l.trim() || i)}</button>`).join('')}</div></div>`;
        if (c.type === 'estop') return `<div class="odev">${nm}<div class="oestop" data-es="${c.id}" title="Click to trip, click again to reset"><i></i></div></div>`;
        if (c.type === 'pot') return `<div class="odev opot">${nm}<input type="range" min="${p.min}" max="${p.max}" step="${(Math.abs(p.max - p.min) / 200) || 0.01}" data-pot="${c.id}"><span class="oval" data-potv="${c.id}"></span></div>`;
        if (c.type === 'pilot') return `<div class="odev">${nm}<div class="olamp c-${p.color}" data-lamp="Q_${escS(c.name)}"></div></div>`;
        if (c.type === 'stacklight') return `<div class="odev">${nm}<div class="ostack"><i class="r" data-lamp="Q_${escS(c.name)}_Red"></i><i class="a" data-lamp="Q_${escS(c.name)}_Amber"></i><i class="g" data-lamp="Q_${escS(c.name)}_Green"></i><span class="h" data-lamp="Q_${escS(c.name)}_Horn">HORN</span></div></div>`;
        return '';
      }).join('') : '';
      el.querySelectorAll('[data-pb]').forEach(b => {
        const id = b.dataset.pb;
        if (b.dataset.latch === '1') { b.onclick = () => send(`ctl:${id}:press`, true); return; }
        const dn = e => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (x) {} b.classList.add('down'); send(`ctl:${id}:press`, true); };
        const up = () => { if (!b.classList.contains('down')) return; b.classList.remove('down'); send(`ctl:${id}:press`, false); };
        b.addEventListener('pointerdown', dn); b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up);
      });
      el.querySelectorAll('[data-sel]').forEach(b => b.onclick = () => send(`ctl:${b.dataset.sel}:set`, +b.dataset.pos));
      el.querySelectorAll('[data-es]').forEach(b => b.onclick = () => send(`ctl:${b.dataset.es}:set`, !((v.c[b.dataset.es] || {}).tripped)));
      el.querySelectorAll('[data-pot]').forEach(b => b.oninput = () => send(`ctl:${b.dataset.pot}:set`, +b.value));
    }
    for (const c of devs) {
      const s = (v.c && v.c[c.id]) || {};
      if (c.type === 'pushbutton' && c.props.latch) { const b = el.querySelector(`[data-pb="${c.id}"]`); if (b) b.classList.toggle('lit', !!s.on); }
      if (c.type === 'selector') el.querySelectorAll(`[data-sel="${c.id}"]`).forEach(b => b.classList.toggle('on', +b.dataset.pos === s.pos));
      if (c.type === 'estop') { const b = el.querySelector(`[data-es="${c.id}"]`); if (b) b.classList.toggle('down', !!s.tripped); }
      if (c.type === 'pot') { const b = el.querySelector(`[data-pot="${c.id}"]`), t = el.querySelector(`[data-potv="${c.id}"]`); if (b && document.activeElement !== b) b.value = s.value; if (t) t.textContent = `${f1(s.value, 1)} ${c.props.unit}`; }
    }
    el.querySelectorAll('[data-lamp]').forEach(l => l.classList.toggle('on', !!(ctx.out || {})[l.dataset.lamp]));
  }

  // ============================================================ builder
  const Builder = (() => {
    let B = null;
    const uid = t => t.slice(0, 3) + Math.random().toString(36).slice(2, 6);
    function nextName(type) {
      const base = { tank: 'T', valve: 'XV', cvalve: 'FCV', pump: 'P', heater: 'H', motor: 'M', conveyor: 'C', cylinder: 'Cyl', pushbutton: 'PB', selector: 'SS', estop: 'ES', pot: 'Pot', pilot: 'PL', stacklight: 'SL' }[type] || 'X';
      let n = 1; while (B.draft.components.some(c => c.name.toUpperCase() === (base + n).toUpperCase())) n++;
      return base + n;
    }
    function defaults(type) {
      const t = B.cat.types[type], p = {};
      for (const k in t.props) p[k] = t.props[k].def;
      const pick = kind => (B.draft.components.find(c => c.type === kind) || {}).id || '';
      if (type === 'heater') p.tank = pick('tank');
      if (type === 'cylinder') p.conveyor = pick('conveyor');
      if (type === 'valve' || type === 'cvalve') { const t1 = pick('tank'); if (t1) p.to = t1; }
      if (type === 'pump') { const t1 = pick('tank'); if (t1) p.from = t1; }
      return p;
    }
    function mount(el, opts) {
      B = Object.assign(B || {}, opts, { el });
      if (!B.draft || !B.dirty || B.ws !== opts.ws) { B.draft = JSON.parse(JSON.stringify(opts.layout || { components: [] })); B.dirty = false; B.sel = null; B.added = new Set(); B.ws = opts.ws; B.errors = []; }
      const cats = {};
      for (const [k, t] of Object.entries(B.cat.types)) (cats[t.cat] = cats[t.cat] || []).push([k, t]);
      el.innerHTML = `<div class="toolbar">
          <button id="bApply" class="primary" ${B.editable ? '' : 'disabled'}>Apply to machine</button>
          <button id="bRevert" ${B.editable ? '' : 'disabled'}>Revert</button>
          <label class="row small"><input type="checkbox" id="bAuto" ${B.auto !== false ? 'checked' : ''}> Add typical sensors for new parts</label>
          <span class="grow"></span><span id="bStat" class="bstat"></span></div>
        <div class="build">
          <div class="palette">${Object.entries(cats).map(([cat, list]) => `<div class="cat">${escS(cat)}</div>` + list.map(([k, t]) => `<button data-add="${k}" ${B.editable ? '' : 'disabled'} title="Add ${escS(t.label)}">${glyph(t.icon)}${escS(t.label)}</button>`).join('')).join('')}</div>
          <div><div id="planWrap"></div><div id="bErr" class="berr"></div><div id="bProps" class="bprops card"></div></div>
        </div>`;
      el.querySelectorAll('[data-add]').forEach(b => b.onclick = () => add(b.dataset.add));
      el.querySelector('#bApply').onclick = apply;
      el.querySelector('#bRevert').onclick = () => { B.draft = JSON.parse(JSON.stringify(B.layout || { components: [] })); B.dirty = false; B.sel = null; B.added = new Set(); draw(); props(); };
      el.querySelector('#bAuto').onchange = e => { B.auto = e.target.checked; };
      attachDrag();
      draw(); props();
    }
    function status() {
      const s = B.el.querySelector('#bStat'); if (!s) return;
      s.className = 'bstat' + (B.dirty ? ' dirty' : '');
      s.textContent = B.dirty ? '● Changes not applied' : `${B.draft.components.length} parts · matches the machine`;
      B.el.querySelector('#bErr').innerHTML = (B.errors || []).map(e => `<div>${escS(e)}</div>`).join('');
    }
    function draw() { B.el.querySelector('#planWrap').innerHTML = plan(B.draft, null, { sensors: B.sensors }, { edit: true, sel: B.sel }); status(); }
    function touch() { B.dirty = true; draw(); }
    function add(type) {
      const n = B.draft.components.length;
      const bb = n ? bounds(B.draft) : { x0: 0, x1: 0, y0: 0, y1: 0 };
      const isPanel = PANEL.has(type);
      const c = { id: uid(type), type, name: nextName(type), x: +(isPanel ? bb.x0 + (B.draft.components.filter(q => PANEL.has(q.type)).length * 0.6) : (n ? bb.x1 + 0.9 : 0)).toFixed(2), y: +(isPanel ? (n ? bb.y0 - 0.6 : -1.2) : 0.4).toFixed(2), rot: 0, props: defaults(type) };
      if (type === 'conveyor') c.x = +(n ? bb.x0 : -1.5).toFixed(2);
      if (type === 'conveyor' && n) c.y = +(bb.y1 + 0.8).toFixed(2);
      B.draft.components.push(c); B.added.add(c.id); B.sel = c.id; touch(); props();
    }
    function attachDrag() {
      const wrap = B.el.querySelector('#planWrap');
      let drag = null;
      const pt = e => { const svg = wrap.querySelector('svg'); const P = svg.createSVGPoint(); P.x = e.clientX; P.y = e.clientY; const q = P.matrixTransform(svg.getScreenCTM().inverse()); return [q.x / 100, q.y / 100]; };
      wrap.addEventListener('pointerdown', e => {
        const g = e.target.closest('.comp');
        if (!g) { if (B.sel) { B.sel = null; draw(); props(); } return; }
        const c = B.draft.components.find(q => q.id === g.dataset.id); if (!c) return;
        if (B.sel !== c.id) { B.sel = c.id; draw(); props(); }
        if (!B.editable) return;
        const [mx, my] = pt(e);
        drag = { c, dx: c.x - mx, dy: c.y - my, moved: false, pid: e.pointerId };
        try { wrap.setPointerCapture(e.pointerId); } catch (x) {}
      });
      wrap.addEventListener('pointermove', e => {
        if (!drag || e.pointerId !== drag.pid) return;
        const [mx, my] = pt(e), snap = v => Math.round(v * 20) / 20;
        const c = drag.c;
        if (c.type === 'cylinder' && B.draft.components.find(q => q.id === c.props.conveyor)) {
          const cv = B.draft.components.find(q => q.id === c.props.conveyor);
          c.props.pos = +clampN(snap(mx - cv.x), 0, +cv.props.length).toFixed(2);
        } else if ((c.type === 'heater' && c.props.tank) || (c.type === 'motor' && c.props.attach)) return;
        else { c.x = +snap(mx + drag.dx).toFixed(2); c.y = +snap(my + drag.dy).toFixed(2); }
        drag.moved = true; B.dirty = true; draw();
      });
      const end = () => { if (drag && drag.moved) props(); drag = null; };
      wrap.addEventListener('pointerup', end); wrap.addEventListener('pointercancel', end);
      if (!B.keyBound) { B.keyBound = true; document.addEventListener('keydown', e => { if (!B || !B.sel || document.body.dataset.tab !== 'build' || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return; if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); del(); } }); }
    }
    function del() {
      if (!B.sel || !B.editable) return;
      const id = B.sel;
      B.draft.components = B.draft.components.filter(c => c.id !== id);
      for (const c of B.draft.components) for (const k in c.props) if (c.props[k] === id) c.props[k] = (B.cat.types[c.type].props[k].of || []).includes('') ? '' : (B.cat.types[c.type].props[k].of.find(x => x.startsWith('@')) || '');
      B.sel = null; touch(); props();
    }
    function props() {
      const el = B.el.querySelector('#bProps');
      const c = B.draft.components.find(q => q.id === B.sel);
      if (!c) { el.innerHTML = `<p class="muted small" style="margin:0">Click a part to edit it. Drag parts to arrange them; cylinders slide along their conveyor. <b>Apply to machine</b> rebuilds the simulation — the PLC keeps running your program, and new outputs and sensor signals appear in the I/O tab.</p>`; return; }
      const t = B.cat.types[c.type], dis = B.editable ? '' : 'disabled';
      const refOpts = (d, v) => {
        const o = [];
        if (d.of.includes('')) o.push(['', '— none —']);
        for (const r of d.of) if (r.startsWith('@')) o.push([r, B.cat.refs[r]]);
        for (const q of B.draft.components) if (q.id !== c.id && d.of.includes(q.type)) o.push([q.id, `${q.name} (${B.cat.types[q.type].label})`]);
        return o.map(([k, l]) => `<option value="${escS(k)}" ${k === v ? 'selected' : ''}>${escS(l)}</option>`).join('');
      };
      el.innerHTML = `<div class="row between"><h3 style="margin:0">${glyph(t.icon).replace('<svg', '<svg style="width:16px;height:16px;vertical-align:-3px;margin-right:6px"')}${escS(t.label)}</h3>
          <span class="row"><button id="bDup" ${dis}>Duplicate</button><button id="bDel" class="danger" ${dis}>Delete</button></span></div>
        <div class="grid" style="margin-top:10px"><label>Name (used in tag names)<input data-p="name" value="${escS(c.name)}" maxlength="20" ${dis}></label>` +
        Object.entries(t.props).map(([k, d]) => {
          const v = c.props[k];
          if (d.t === 'bool') return `<label class="cb"><input type="checkbox" data-k="${k}" ${v ? 'checked' : ''} ${dis}>${escS(d.label)}</label>`;
          if (d.t === 'sel') return `<label>${escS(d.label)}<select data-k="${k}" ${dis}>${d.opts.map(([o, l]) => `<option value="${escS(o)}" ${String(v) === o ? 'selected' : ''}>${escS(l)}</option>`).join('')}</select></label>`;
          if (d.t === 'ref') return `<label>${escS(d.label)}<select data-k="${k}" ${dis}>${refOpts(d, v)}</select></label>`;
          if (d.t === 'num') return `<label>${escS(d.label)}${d.unit ? ` (${escS(d.unit)})` : ''}<input type="number" step="any" data-k="${k}" value="${escS(v)}" ${d.min !== undefined ? `min="${d.min}"` : ''} ${d.max !== undefined ? `max="${d.max}"` : ''} ${dis}></label>`;
          return `<label>${escS(d.label)}<input data-k="${k}" value="${escS(v)}" ${dis}></label>`;
        }).join('') + `</div><p class="muted small" style="margin:10px 0 0">PLC tags for this part: ${tagsFor(c).map(n => `<code>${escS(n)}</code>`).join(' ') || '<i>inputs only — add sensors in the I/O tab</i>'}</p>`;
      el.querySelector('[data-p=name]').oninput = e => { c.name = e.target.value.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 20); touch(); };
      el.querySelector('[data-p=name]').onchange = () => props();
      el.querySelectorAll('[data-k]').forEach(inp => inp.onchange = inp.oninput = () => {
        const d = t.props[inp.dataset.k];
        c.props[inp.dataset.k] = d.t === 'bool' ? inp.checked : d.t === 'num' ? (inp.value === '' ? d.def : +inp.value) : inp.value;
        touch();
      });
      el.querySelector('#bDel').onclick = del;
      el.querySelector('#bDup').onclick = () => { const n = JSON.parse(JSON.stringify(c)); n.id = uid(c.type); n.name = nextName(c.type); n.x += 0.6; B.draft.components.push(n); B.added.add(n.id); B.sel = n.id; touch(); props(); };
    }
    function tagsFor(c) {
      const n = c.name, p = c.props;
      switch (c.type) {
        case 'valve': return [`Q_${n}_Open`];
        case 'cvalve': return [`AO_${n}_Pos`];
        case 'pump': return [`Q_${n}_Run`].concat(p.vfd ? [`AO_${n}_Speed`] : []);
        case 'heater': return [`Q_${n}_On`].concat(p.scr ? [`AO_${n}_Power`] : []);
        case 'motor': case 'conveyor': return (p.reversible ? [`Q_${n}_Fwd`, `Q_${n}_Rev`] : [`Q_${n}_Run`]).concat(p.vfd ? [`AO_${n}_Speed`] : []);
        case 'cylinder': return [`Q_${n}_Ext`];
        case 'pilot': return [`Q_${n}`];
        case 'stacklight': return ['Red', 'Amber', 'Green', 'Horn'].map(k => `Q_${n}_${k}`);
      }
      return [];
    }
    async function apply() {
      const ids = B.auto !== false ? [...B.added].filter(id => B.draft.components.some(c => c.id === id)) : [];
      const r = await B.api('PUT', '/api/layout', { layout: B.draft, addSensorsFor: ids });
      if (r.ok === false && !r.layoutErrors) { B.toast(r.msg || 'Could not apply', true); return; }
      B.errors = r.layoutErrors || [];
      B.dirty = false; B.added = new Set();
      B.toast(r.ok ? `Machine updated${r.added && r.added.length ? ` — added sensors ${r.added.join(', ')}` : ''}` : `Machine updated, but the program no longer compiles: ${r.msg}`, !r.ok);
      await B.onApplied();
    }
    function sync(opts) {          // called when the server project changes
      if (!B || !B.el || !B.el.isConnected) return;
      Object.assign(B, { layout: opts.layout, sensors: opts.sensors, editable: opts.editable, cat: opts.cat });
      if (!B.dirty || B.ws !== opts.ws) { B.draft = JSON.parse(JSON.stringify(opts.layout || { components: [] })); B.ws = opts.ws; if (B.sel && !B.draft.components.some(c => c.id === B.sel)) B.sel = null; }
      draw(); props();
    }
    return { mount, sync, isDirty: () => !!(B && B.dirty) };
  })();

  return { plan, scene3d, cam, panel, Builder, glyph, PANEL };
})();
