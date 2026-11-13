'use strict';
/* 3D scene builders: each returns { objs, labels } for GL3D.Renderer */
const SCENES3D = (() => {
  const PI = Math.PI;
  const STEEL = '#a7b2bd', DARK = '#39424c', OFF = '#56616c', ON = '#2ecc71', RED = '#e74c3c', AMBER = '#f5a623', BLUE = '#3fa9f5', GLASS = '#b9d4ea';
  const box = (p, s, c, o) => Object.assign({ m: 'box', p, s, c }, o);
  const cyl = (p, r, h, c, o) => Object.assign({ m: 'cyl', p, s: [r, h, r], c }, o);
  const sph = (p, r, c, o) => Object.assign({ m: 'sph', p, s: [r, r, r], c }, o);
  let cur = [];
  const pipeX = (x1, x2, y, z, r, c, o) => cur.push(cyl([(x1 + x2) / 2, y, z], r, Math.abs(x2 - x1), c || STEEL, Object.assign({ r: [0, 0, PI / 2], s: [r, Math.abs(x2 - x1), r] }, o)));
  const pipeY = (x, y1, y2, z, r, c, o) => cur.push(cyl([x, (y1 + y2) / 2, z], r, Math.abs(y2 - y1), c || STEEL, o));
  const pipeZ = (x, y, z1, z2, r, c, o) => cur.push(cyl([x, y, (z1 + z2) / 2], r, Math.abs(z2 - z1), c || STEEL, Object.assign({ r: [PI / 2, 0, 0], s: [r, Math.abs(z2 - z1), r] }, o)));
  const mix = (a, b, f) => { const A = GL3D.hex(a), B = GL3D.hex(b); return A.map((v, i) => v + (B[i] - v) * Math.max(0, Math.min(1, f))); };
  const fx = (v, d = 1) => (v === undefined || v === null ? '—' : typeof v === 'boolean' ? (v ? 'ON' : 'OFF') : (+v).toFixed(d));

  function floor(objs, w = 14, d = 10) {
    objs.push(box([0, -0.05, 0], [w, 0.1, d], '#1a2028'));
    for (let i = -Math.floor(w / 2); i <= w / 2; i++) objs.push(box([i, 0.002, 0], [0.012, 0.004, d], '#262f3a'));
    for (let j = -Math.floor(d / 2); j <= d / 2; j++) objs.push(box([0, 0.002, j], [w, 0.004, 0.012], '#262f3a'));
  }
  function valve3d(objs, p, pos, axis = 'x', size = 0.12) {
    const c = mix(OFF, ON, pos);
    objs.push(box(p, axis === 'x' ? [size * 1.6, size, size] : [size, size, size * 1.6], c));
    objs.push(cyl([p[0], p[1] + size * 0.9, p[2]], size * 0.25, size * 0.8, DARK));
    objs.push(box([p[0], p[1] + size * 1.45, p[2]], [size * 0.9, size * 0.5, size * 0.9], c));
  }
  function sensorLabels(labels, ctx, place) {
    for (const s of ctx.sensors) {
      if (s.type !== 'analog') continue;
      const p = place(s); if (!p) continue;
      labels.push({ p, t: `${s.tag} ${fx(ctx.val(s.tag), s.scale === 'raw' ? 0 : 2)}${s.scale === 'mA' ? ' mA' : ''}`, cls: 'dim' });
    }
  }

  // ====================== TANK ======================
  function tank(v, ctx) {
    const objs = [], labels = [], o = ctx.out;
    cur = objs;
    floor(objs);
    const y0 = 0.6, H = 2.0, R = 0.8, lev = v.level / 100;
    // legs + skirt
    for (const [x, z] of [[0.55, 0.55], [-0.55, 0.55], [0.55, -0.55], [-0.55, -0.55]]) objs.push(box([x, y0 / 2, z], [0.08, y0, 0.08], DARK));
    objs.push(cyl([0, y0 - 0.02, 0], R + 0.02, 0.04, STEEL));
    // liquid
    if (lev > 0.002) {
      const col = mix('#2f7fd6', '#e0663a', (v.temp - 15) / 65);
      objs.push(cyl([0, y0 + H * lev / 2, 0], R - 0.02, H * lev, col, { a: 0.78 }));
    }
    // heater ring
    const hc = v.burned ? '#2b2b2b' : mix('#6b4a40', '#ff4a1a', (v.hp || 0) / 100);
    for (let i = 0; i < 12; i++) { const a = i / 12 * 2 * PI; objs.push(box([Math.cos(a) * 0.5, y0 + 0.1, Math.sin(a) * 0.5], [0.06, 0.06, 0.28], hc, { r: [0, -a, 0], e: v.hp > 5 ? 0.5 * v.hp / 100 : 0 })); }
    // mixer
    const mOn = !!v.mix, ang = mOn ? ctx.t * 9 : 0;
    objs.push(cyl([0, y0 + H + 0.03, 0], R + 0.03, 0.06, STEEL));
    objs.push(box([0, y0 + H + 0.25, 0], [0.32, 0.36, 0.32], mOn ? ON : OFF));
    objs.push(cyl([0, y0 + 1.05, 0], 0.03, 1.9, STEEL));
    for (const k of [0, PI / 2]) objs.push(box([0, y0 + 0.28, 0], [0.9, 0.04, 0.12], STEEL, { r: [0.35, ang + k, 0] }));
    labels.push({ p: [0, y0 + H + 0.55, 0], t: `M-101 ${mOn ? 'RUN' : 'STOP'}`, cls: mOn ? 'on' : '' });
    // inlet
    const vp = v.valve;
    pipeX(-3, -0.35, y0 + H + 0.35, 0, 0.06);
    pipeY(-0.35, y0 + H + 0.05, y0 + H + 0.35, 0, 0.06);
    valve3d(objs, [-1.8, y0 + H + 0.35, 0], vp);
    if (v.qin > 0.01) objs.push(cyl([-0.35, y0 + (H * lev + H) / 2, 0], 0.035, H * (1 - lev), BLUE, { a: 0.55 }));
    labels.push({ p: [-1.8, y0 + H + 0.75, 0], t: `XV-101 ${Math.round(vp * 100)}%`, cls: vp > 0.5 ? 'on' : '' });
    // outlet + pump
    pipeY(0, 0.25, y0, 0, 0.07);
    pipeX(0, 1.7, 0.25, 0, 0.07);
    const pr = v.pumpSpd > 1;
    objs.push(cyl([1.95, 0.3, 0], 0.26, 0.22, pr ? ON : OFF, { r: [PI / 2, 0, 0] }));
    objs.push(box([1.95, 0.3, -0.35], [0.3, 0.3, 0.4], DARK));
    objs.push(box([1.95 + Math.cos(ctx.t * 12 * (pr ? 1 : 0)) * 0.12, 0.3 + Math.sin(ctx.t * 12 * (pr ? 1 : 0)) * 0.12, 0.13], [0.06, 0.06, 0.03], '#ddd'));
    pipeX(2.2, 3.4, 0.45, 0, 0.07); pipeY(2.2, 0.3, 0.45, 0, 0.07);
    labels.push({ p: [1.95, 0.75, 0], t: `P-101 ${Math.round(v.pumpSpd)}%`, cls: pr ? 'on' : '' });
    // level switches from the I/O configuration
    for (const s of ctx.sensors) {
      if (s.type !== 'switch' || s.signal !== 'level') continue;
      const y = y0 + H * s.sp / 100, phys = s.op === '<=' ? v.level <= s.sp : v.level >= s.sp;
      objs.push(box([R + 0.06, y, 0.25], [0.14, 0.08, 0.08], phys ? ON : OFF, { e: phys ? 0.4 : 0 }));
      labels.push({ p: [R + 0.25, y + 0.05, 0.25], t: `${s.tag}`, cls: phys ? 'on' : 'dim' });
    }
    // glass vessel
    objs.push(cyl([0, y0 + H / 2, 0], R, H, GLASS, { a: 0.16 }));
    objs.push(cyl([0, y0 + 0.01, 0], R + 0.01, 0.02, STEEL));
    // transmitters
    objs.push(box([-R - 0.12, y0 + 0.4, 0], [0.16, 0.22, 0.16], '#2d6cdf'));
    objs.push(box([-R + 0.05, y0 + 0.25, -0.5], [0.12, 0.16, 0.12], '#c26d2b'));
    sensorLabels(labels, ctx, s => s.signal === 'level' || s.signal === 'volume' ? [-R - 0.3, y0 + 0.75, 0] : s.signal.startsWith('temp') ? [-R - 0.1, y0 + 0.45, -0.6] : [0.9, y0 + H + 0.1, 0.6]);
    labels.push({ p: [0, y0 + H * lev + 0.08, R], t: `T-101 ${v.level.toFixed(1)}% · ${v.temp.toFixed(1)}°C`, cls: 'big' });
    if (v.hp > 1 || v.burned) labels.push({ p: [0.5, y0 + 0.1, 0.6], t: v.burned ? 'H-101 BURNED OUT' : `H-101 ${Math.round(v.hp)}%`, cls: v.burned ? 'bad' : 'on' });
    if (v.overflow) labels.push({ p: [0, y0 + H + 0.1, R], t: 'OVERFLOW!', cls: 'bad big' });
    return { objs, labels };
  }

  // ====================== CONVEYOR ======================
  function conveyor(v, ctx) {
    const objs = [], labels = [], k = 0.005;
    cur = objs;
    const X = px => (px - 371) * k, Z = py => (py - 190) * k, TOP = 0.8;
    floor(objs);
    const x0 = X(20), x1 = X(722);
    objs.push(box([(x0 + x1) / 2, TOP - 0.03, 0], [x1 - x0, 0.06, 0.42], '#2a3038'));
    for (let px = 20 + (v.ph % 30); px < 722; px += 30) objs.push(box([X(px), TOP + 0.001, 0], [0.012, 0.004, 0.4], '#3c4652'));
    objs.push(box([(x0 + x1) / 2, TOP - 0.04, 0.23], [x1 - x0, 0.1, 0.04], STEEL));
    objs.push(box([(x0 + x1) / 2, TOP - 0.04, -0.23], [x1 - x0, 0.1, 0.04], STEEL));
    for (const x of [x0, x1]) objs.push(cyl([x, TOP - 0.04, 0], 0.05, 0.44, STEEL, { r: [PI / 2, 0, 0] }));
    for (let x = x0 + 0.1; x < x1; x += 0.8) for (const z of [-0.2, 0.2]) objs.push(box([x, (TOP - 0.1) / 2, z], [0.05, TOP - 0.1, 0.05], DARK));
    // motor
    objs.push(cyl([x0 + 0.05, TOP - 0.05, -0.36], 0.11, 0.25, v.run ? ON : OFF, { r: [PI / 2, 0, 0] }));
    labels.push({ p: [x0, TOP + 0.2, -0.4], t: `M-1 ${v.run ? 'RUN' : 'STOP'}`, cls: v.run ? 'on' : '' });
    // bins
    const bin = (cx, cz, w, d, h, y) => {
      objs.push(box([cx, y, cz], [w, 0.03, d], DARK));
      objs.push(box([cx - w / 2, y + h / 2, cz], [0.02, h, d], '#4b5562')); objs.push(box([cx + w / 2, y + h / 2, cz], [0.02, h, d], '#4b5562'));
      objs.push(box([cx, y + h / 2, cz - d / 2], [w, h, 0.02], '#4b5562')); objs.push(box([cx, y + h / 2, cz + d / 2], [w, h, 0.02], '#4b5562'));
    };
    bin(X(400), Z(300), 0.5, 0.45, 0.3, 0.35);
    bin(x1 + 0.3, 0, 0.45, 0.6, 0.3, 0.3);
    labels.push({ p: [X(400), 0.75, Z(330)], t: `BIN B (tall): ✓${v.cnt.bT} ✗${v.cnt.bS}` });
    labels.push({ p: [x1 + 0.3, 0.7, 0.3], t: `BIN A (short): ✓${v.cnt.aS} ✗${v.cnt.aT}` });
    // boxes
    for (const b of v.boxes) {
      const h = b.tall ? 0.36 : 0.16, jam = b.s === 'jam';
      objs.push(box([X(b.x), TOP + h / 2, Z(b.y)], [0.18, h, 0.18], b.tall ? '#e39b3a' : '#b9946a', { r: [0, jam ? 0.35 : 0, 0] }));
      if (jam) labels.push({ p: [X(b.x), TOP + h + 0.1, Z(b.y)], t: 'JAM', cls: 'bad' });
    }
    // pusher
    const px = X(400), pz = Z(166 + v.p * 80);
    objs.push(box([px, TOP + 0.12, Z(70)], [0.3, 0.2, 0.25], '#5d6b7a'));
    pipeZ(px, TOP + 0.12, Z(83), pz - 0.02, 0.025, STEEL);
    objs.push(box([px, TOP + 0.12, pz], [0.22, 0.2, 0.03], v.p > 0.05 ? AMBER : '#8592a0'));
    labels.push({ p: [px, TOP + 0.35, Z(70)], t: `PUSHER ${Math.round(v.p * 100)}%`, cls: v.p > 0.5 ? 'on' : '' });
    // position sensors from the I/O configuration
    let n = 0;
    for (const s of ctx.sensors) {
      if (s.type !== 'probe') continue;
      const xp = X(s.pos / 5), hit = v.boxes.some(b => Math.abs(b.x - s.pos / 5) < 20 && Math.abs(b.y - 190) < 30 && (s.signal === 'box' || (s.signal === 'tall' && b.tall) || (s.signal === 'short' && !b.tall)));
      const by = s.signal === 'tall' ? TOP + 0.28 : TOP + 0.08, zoff = (n++ % 2) * 0.012;
      objs.push(box([xp, by / 2, -0.27], [0.04, by, 0.04], DARK));
      objs.push(box([xp, by, -0.27], [0.06, 0.06, 0.06], '#2d6cdf'));
      objs.push(box([xp, by, 0.27], [0.05, 0.05, 0.05], '#555'));
      objs.push(box([xp + zoff, by, 0], [0.008, 0.008, 0.52], hit ? RED : '#42ff9a', { a: 0.7, e: 1 }));
      labels.push({ p: [xp, by + 0.15, -0.3], t: s.tag, cls: hit ? 'on' : 'dim' });
    }
    return { objs, labels };
  }

  // ====================== VIAL FILLER ======================
  function vialfiller(v, ctx) {
    const objs = [], labels = [], k = 0.005;
    cur = objs;
    const X = mm => (mm - 350) * k, TOP = 0.9;
    floor(objs);
    // machine base
    objs.push(box([0, TOP / 2, 0], [3.9, TOP, 1.0], '#c9d1d9'));
    objs.push(box([0, TOP + 0.01, 0], [3.9, 0.02, 1.0], '#e2e8ee'));
    // index belt + pockets
    objs.push(box([X(330), TOP + 0.03, 0], [X(660) - X(0), 0.04, 0.2], '#30363d'));
    const off = ((v.belt % 70) + 70) % 70;
    for (let mm = off; mm < 660; mm += 70) objs.push(box([X(mm), TOP + 0.06, 0], [0.02, 0.025, 0.2], '#59636e'));
    // infeed turntable & outfeed tray
    objs.push(cyl([X(-60), TOP + 0.03, 0], 0.35, 0.04, '#b8c2cc', { r: [0, ctx.t * 0.6, 0] }));
    objs.push(box([X(700), TOP + 0.03, 0], [0.5, 0.04, 0.5], '#8994a0'));
    labels.push({ p: [X(700), TOP + 0.15, 0.3], t: `ACCEPT ✓${v.cnt.good} ✗${v.cnt.badAcc}`, cls: v.cnt.badAcc ? 'bad' : 'on' });
    // vials
    for (const q of v.vials) {
      const x = X(q.x);
      objs.push(cyl([x, TOP + 0.05 + 0.03, 0], 0.07, 0.04, GLASS, { a: 0.5 }));
      if (q.w > 0.01) { const lh = Math.min(0.2, q.w / 2.5 * 0.18); objs.push(cyl([x, TOP + 0.1 + lh / 2, 0], 0.06, lh, '#f2b6c6', { a: 0.85 })); }
      objs.push(cyl([x, TOP + 0.21, 0], 0.07, 0.24, GLASS, { a: 0.28 }));
      if (q.st) objs.push(cyl([x, TOP + 0.345, 0], 0.075, 0.04, '#7c8794'));
    }
    // fill station
    const nY = TOP + 0.62 - v.needle * 0.26;
    objs.push(box([X(210), TOP + 0.45, -0.38], [0.12, 0.9, 0.12], '#9aa5b0'));
    objs.push(box([X(210), nY, -0.15], [0.28, 0.08, 0.5], v.bent ? RED : '#c3ccd5'));
    objs.push(cyl([X(210), nY - 0.12, 0], 0.008, 0.18, '#e9eef3'));
    if (v.flow > 0.05) objs.push(cyl([X(210), nY - 0.25, 0], 0.01, 0.1, '#f2b6c6', { a: 0.9 }));
    labels.push({ p: [X(210), TOP + 0.85, -0.15], t: `FILL ${v.flow > 0.05 ? '▶ ' : ''}${fx(ctx.val('AI_FillWeight'), 3)} g`, cls: v.flow > 0.05 ? 'on' : '' });
    // peristaltic pump + product bag (outside the isolator, back side)
    objs.push(cyl([X(210), TOP + 0.3, -0.62], 0.12, 0.1, v.flow > 0.05 ? ON : OFF, { r: [PI / 2, 0, 0] }));
    objs.push(box([X(90), TOP + 1.25, -0.62], [0.25, 0.35 * v.product / 100 + 0.02, 0.08], '#f2b6c6', { a: 0.8 }));
    labels.push({ p: [X(90), TOP + 1.55, -0.62], t: `Product ${v.product.toFixed(0)}%`, cls: 'dim' });
    // stopper station
    const sY = TOP + 0.55 - v.stopper * 0.17;
    objs.push(box([X(350), TOP + 0.45, -0.38], [0.12, 0.9, 0.12], '#9aa5b0'));
    objs.push(box([X(350), TOP + 0.75, -0.2], [0.14, 0.08, 0.4], '#c3ccd5'));
    objs.push(cyl([X(350), sY, 0], 0.05, 0.2, '#7c8794'));
    objs.push(cyl([X(350), TOP + 0.95, -0.25], 0.18, 0.12, '#b8c2cc'));
    labels.push({ p: [X(350), TOP + 1.1, -0.25], t: `STOPPERS ${v.hopper}`, cls: v.hopper ? 'dim' : 'bad' });
    // reject kicker + bin
    objs.push(box([X(490), TOP + 0.15, -0.33 + v.kick * 0.25], [0.16, 0.12, 0.05], v.kick > 0.1 ? RED : '#8592a0'));
    pipeZ(X(490), TOP + 0.15, -0.5, -0.33 + v.kick * 0.25, 0.02);
    objs.push(box([X(490), TOP - 0.3, 0.62], [0.35, 0.3, 0.25], '#7a2b25', { a: 0.85 }));
    labels.push({ p: [X(490), TOP - 0.05, 0.7], t: `REJECT ✓${v.cnt.rejBad} ✗${v.cnt.rejGood}` });
    // isolator shell
    const ix0 = X(-130), ix1 = X(690), iy0 = TOP, iy1 = TOP + 1.5, iz0 = -0.5, iz1 = 0.5;
    const cx = (ix0 + ix1) / 2, cy = (iy0 + iy1) / 2, wX = ix1 - ix0, hY = iy1 - iy0;
    const edge = (p, s) => objs.push(box(p, s, '#d0d7de'));
    for (const y of [iy0, iy1]) for (const z of [iz0, iz1]) edge([cx, y, z], [wX, 0.04, 0.04]);
    for (const x of [ix0, ix1]) for (const z of [iz0, iz1]) edge([x, cy, z], [0.04, hY, 0.04]);
    for (const x of [ix0, ix1]) for (const y of [iy0, iy1]) edge([x, y, 0], [0.04, 0.04, iz1 - iz0]);
    objs.push(box([cx, cy, iz0], [wX, hY, 0.01], GLASS, { a: 0.12 }));
    objs.push(box([ix0, cy, 0], [0.01, hY, 1.0], GLASS, { a: 0.12 }));
    objs.push(box([ix1, cy, 0], [0.01, hY, 1.0], GLASS, { a: 0.12 }));
    // front window = door (hinged at left)
    if (v.door) objs.push(box([ix0 + 0.05 - 0.0, cy, iz1 + wX / 2 * 0.0 + 0.6], [0.02, hY, 1.2], GLASS, { a: 0.18 }));
    objs.push(box([v.door ? ix0 + 1.2 : cx, cy, iz1], [v.door ? wX - 1.2 : wX, hY, 0.01], GLASS, { a: 0.14 }));
    if (v.door) labels.push({ p: [ix0 + 0.1, iy1, iz1 + 0.9], t: 'DOOR OPEN', cls: 'bad' });
    objs.push(box([ix1 - 0.1, cy, iz1 + 0.02], [0.06, 0.18, 0.04], v.locked ? RED : ON, { e: 0.6 }));
    labels.push({ p: [ix1 - 0.1, cy + 0.2, iz1 + 0.05], t: v.locked ? 'LOCKED' : 'unlocked', cls: v.locked ? 'bad' : 'dim' });
    // glove ports
    const gb = (ctx.info.plant && v.faults.gloveBreach);
    for (const gx of [X(150), X(350), X(550)]) {
      objs.push(cyl([gx, TOP + 0.55, iz1], 0.11, 0.05, '#2b2f35', { r: [PI / 2, 0, 0] }));
      objs.push(cyl([gx, TOP + 0.5, iz1 - 0.15], 0.06, 0.3, gb && gx === X(350) ? RED : '#1b1e22', { r: [PI / 2 + 0.4, 0, 0] }));
    }
    // HEPA plenum + laminar flow streaks
    objs.push(box([cx, iy1 + 0.15, 0], [wX, 0.3, 1.0], '#e2e8ee'));
    objs.push(box([cx, iy1 + 0.005, 0], [wX - 0.1, 0.01, 0.9], '#f7fafc', { e: 0.3 }));
    labels.push({ p: [cx, iy1 + 0.45, 0], t: `HEPA ${Math.round(v.fan)}% · ${v.air.toFixed(2)} m/s`, cls: v.air >= 0.36 ? 'on' : 'bad' });
    if (v.air > 0.03) {
      for (let i = 0; i < 26; i++) {
        const sx = ix0 + 0.15 + ((i * 0.618) % 1) * (wX - 0.3), sz = -0.4 + ((i * 0.381) % 1) * 0.8;
        const sy = iy1 - (((ctx.t * v.air * 2.2 + i * 0.37) % 1) * (hY - 0.1));
        objs.push(box([sx, sy, sz], [0.006, 0.18, 0.006], '#bfe6ff', { a: 0.35 * Math.min(1, v.air / 0.4), e: 1 }));
      }
    }
    // H2O2 fog
    if (v.h2o2 > 2) objs.push(box([cx, cy, 0], [wX - 0.05, hY - 0.05, 0.95], '#9ff0c4', { a: Math.min(0.42, v.h2o2 / 700), e: 0.6 }));
    // particles (log scale)
    const np = Math.min(70, Math.max(0, Math.round((Math.log10(Math.max(1, v.part)) - 2) * 18)));
    for (let i = 0; i < np; i++) {
      const r1 = Math.sin(i * 12.9898 + Math.floor(ctx.t * 4) * 0.1) * 43758.5453 % 1, r2 = Math.sin(i * 78.233) * 12345.6789 % 1, r3 = Math.sin(i * 39.425) * 9876.54 % 1;
      objs.push(box([cx + r1 * wX / 2, cy + r2 * hY / 2, r3 * 0.45], [0.012, 0.012, 0.012], v.part > 3520 ? '#ffd0c8' : '#ffffff', { e: 1 }));
    }
    labels.push({ p: [ix0 + 0.2, iy1 - 0.1, iz1], t: `ΔP ${v.dp.toFixed(1)} Pa`, cls: v.dp >= 10 ? 'on' : 'bad' });
    labels.push({ p: [ix0 + 0.2, iy1 - 0.25, iz1], t: `Particles ${Math.round(v.part)}/m³`, cls: v.part <= 3520 ? 'on' : 'bad' });
    labels.push({ p: [ix0 + 0.2, iy1 - 0.4, iz1], t: `H₂O₂ ${v.h2o2.toFixed(1)} ppm`, cls: v.h2o2 <= 1 ? 'dim' : 'bad' });
    labels.push({ p: [cx + 0.6, iy1 - 0.1, iz1], t: v.sterile ? 'STERILE' : `NOT STERILE${v.dose > 0 ? ' · dose ' + v.dose.toFixed(0) + '/30 s' : ''}`, cls: v.sterile ? 'on' : 'bad' });
    if (v.jam) labels.push({ p: [X(280), TOP + 0.5, 0.3], t: 'MACHINE JAM', cls: 'bad big' });
    return { objs, labels };
  }

  // ====================== BIOREACTOR ======================
  function bioreactor(v, ctx) {
    const objs = [], labels = [], o = ctx.out;
    cur = objs;
    floor(objs);
    const y0 = 0.75, H = 1.5, R = 0.5, fl = Math.min(1, v.V / 70), vv = v.v;
    for (let i = 0; i < 3; i++) { const a = i / 3 * 2 * PI + 0.5; objs.push(box([Math.cos(a) * 0.45, y0 / 2, Math.sin(a) * 0.45], [0.06, y0, 0.06], DARK)); }
    // broth + foam
    if (fl > 0.003) {
      const turb = Math.min(1, v.X / 8);
      objs.push(cyl([0, y0 + H * fl / 2, 0], R - 0.02, H * fl, mix('#e8d78a', '#a8823a', turb), { a: 0.65 + 0.3 * turb }));
      if (v.foam > 0.3) { const fh = Math.min(0.5, v.foam / 30 * 0.6); objs.push(cyl([0, y0 + H * fl + fh / 2, 0], R - 0.03, fh, '#f4f1e8', { a: 0.85 })); }
    }
    // agitator
    const run = v.rpm > 5, ang = ctx.t * v.rpm / 60 * 2 * PI * 0.3;
    objs.push(box([0, y0 + H + 0.42, 0], [0.26, 0.3, 0.26], run ? ON : OFF));
    objs.push(cyl([0, y0 + H / 2 + 0.2, 0], 0.025, H + 0.3, STEEL));
    for (const yy of [0.25, 0.75]) for (let b = 0; b < 6; b++) objs.push(box([0, y0 + H * yy, 0], [0.42, 0.08, 0.02], STEEL, { r: [0, ang + b * PI / 3, 0] }));
    labels.push({ p: [0, y0 + H + 0.7, 0], t: `M-01 ${Math.round(v.rpm)} rpm`, cls: run ? 'on' : '' });
    // sparger + bubbles
    objs.push(cyl([0, y0 + 0.08, 0], 0.22, 0.02, STEEL));
    if (v.air > 1 && fl > 0.02) {
      const nb = Math.min(40, Math.round(v.air / 2.5) + 4);
      for (let i = 0; i < nb; i++) {
        const ph = ((ctx.t * 0.6 + i * 0.137) % 1), a = i * 2.39996;
        const rr = 0.08 + (i % 5) * 0.07;
        objs.push(sph([Math.cos(a + ph * 2) * rr, y0 + 0.1 + ph * (H * fl - 0.1), Math.sin(a + ph * 2) * rr], 0.018, '#ffffff', { a: 0.6 }));
      }
    }
    // vessel shell, jacket, heads
    objs.push(cyl([0, y0 + H / 2, 0], R, H, '#c3ccd5', { a: 0.22 }));
    objs.push(sph([0, y0 + H, 0], 1, '#c3ccd5', { s: [R, 0.18, R], a: 0.28 }));
    objs.push(sph([0, y0, 0], 1, '#aab4be', { s: [R, 0.15, R] }));
    objs.push(cyl([0, y0 + H * 0.42, 0], R + 0.07, H * 0.72, mix('#3f7fc4', '#d2523a', (v.Tj - 5) / 80), { a: 0.22 }));
    // valves and lines
    const V = (key, p, labelP, txt) => {
      valve3d(objs, p, vv[key]);
      const pos = vv[key], tag = txt.split(' ')[0];
      labels.push({ p: labelP, t: pos > 0.97 ? `${txt} OPEN` : pos < 0.03 ? tag : `${tag} ${Math.round(pos * 100)}%`, cls: pos > 0.5 ? 'on' : 'dim' });
    };
    // XV-01 media (top left)
    pipeX(-2.2, -0.2, y0 + H + 0.3, 0.15, 0.04); pipeY(-0.2, y0 + H + 0.1, y0 + H + 0.3, 0.15, 0.04);
    objs.push(cyl([-2.4, 0.9, 0.15], 0.35, 1.2, '#b8c2cc'));
    labels.push({ p: [-2.4, 1.65, 0.15], t: 'MEDIA', cls: 'dim' });
    pipeY(-2.2, 1.5, y0 + H + 0.3, 0.15, 0.04);
    V('xv01', [-1.2, y0 + H + 0.3, 0.15], [-1.2, y0 + H + 0.62, 0.15], 'XV-01');
    // XV-02 inoculum (top right) + seed vessel
    objs.push(cyl([1.6, 2.35, -0.2], 0.16, 0.45, '#d8e2ea', { a: 0.5 }));
    objs.push(cyl([1.6, 2.13 + 0.2 * v.inoc / 2, -0.2], 0.14, 0.4 * v.inoc / 2 + 0.001, '#a8823a', { a: 0.8 }));
    labels.push({ p: [1.6, 2.7, -0.2], t: `SEED ${v.inoc.toFixed(1)} L`, cls: 'dim' });
    pipeX(0.2, 1.6, y0 + H + 0.3, -0.2, 0.03); pipeY(0.2, y0 + H + 0.1, y0 + H + 0.3, -0.2, 0.03); pipeY(1.6, y0 + H + 0.3, 2.12, -0.2, 0.03);
    V('xv02', [0.9, y0 + H + 0.3, -0.2], [0.9, y0 + H + 0.62, -0.2], 'XV-02');
    // XV-09 vent + filter (top)
    pipeY(0.25, y0 + H + 0.05, y0 + H + 0.9, 0.2, 0.035);
    objs.push(cyl([0.25, y0 + H + 1.0, 0.2], 0.08, 0.22, '#e8eef3'));
    V('xv09', [0.25, y0 + H + 0.55, 0.2], [0.25, y0 + H + 1.25, 0.2], 'XV-09 vent');
    // XV-03 harvest + XV-04 drain (bottom)
    pipeY(0, 0.25, y0 - 0.1, 0, 0.05);
    pipeX(0, 1.8, 0.25, 0, 0.05);
    V('xv03', [1.0, 0.25, 0], [1.0, 0.55, 0], 'XV-03 harvest');
    objs.push(cyl([2.1, 0.45, 0], 0.3, 0.9, '#b8c2cc'));
    labels.push({ p: [2.1, 1.0, 0], t: `HARVEST ${v.harvested.toFixed(0)} g`, cls: 'dim' });
    pipeZ(0, 0.25, 0, 0.9, 0.04);
    V('xv04', [0, 0.25, 0.6], [0, 0.55, 0.75], 'XV-04 drain');
    // XV-05 steam, XV-06 hot, XV-07 cold, XV-08 air (left side)
    const side = (key, y, col, txt, into) => { pipeX(-1.6, -into, y, -0.35, 0.03, col); V(key, [-1.05, y, -0.35], [-1.05, y + 0.28, -0.35], txt); };
    side('xv05', y0 + 1.15, '#d9d9d9', 'XV-05 steam', R);
    side('xv06', y0 + 0.85, '#c0533f', 'XV-06 hot', R + 0.07);
    side('xv07', y0 + 0.55, '#3f7fc4', 'XV-07 cold', R + 0.07);
    pipeX(-1.6, -0.15, y0 + 0.15, -0.35, 0.03); pipeZ(-0.15, y0 + 0.15, -0.35, 0, 0.03);
    V('xv08', [-1.05, y0 + 0.15, -0.35], [-1.05, y0 + 0.43, -0.35], `XV-08 air ${v.air.toFixed(0)} L/min`);
    // dosing pumps
    const pumps = [['Q_P01_Base', 'BASE', '#4f8ef7'], ['Q_P02_Acid', 'ACID', '#ef6a5a'], ['Q_P03_Antifoam', 'AF', '#f4f1e8'], ['Q_P04_Feed', 'FEED', '#e8d78a']];
    pumps.forEach(([tag, nm, c], i) => {
      const x = 0.95 + i * 0.32, on = !!o[tag];
      objs.push(cyl([x, 0.9, -0.85], 0.1, 0.35, c, { a: 0.8 }));
      objs.push(box([x, 1.2, -0.85], [0.16, 0.12, 0.16], on ? ON : OFF, { e: on ? 0.4 : 0 }));
      labels.push({ p: [x, 1.38, -0.85], t: nm, cls: on ? 'on' : 'dim' });
    });
    // readouts
    labels.push({ p: [0, y0 + 0.55, R + 0.1], t: `${v.V.toFixed(1)} L · ${v.T.toFixed(1)}°C · pH ${v.pH.toFixed(2)} · DO ${v.DO.toFixed(0)}%`, cls: 'big' });
    labels.push({ p: [0.75, y0 + H + 0.15, 0.1], t: `PT-01 ${v.p.toFixed(2)} bar g`, cls: v.p < -0.03 || v.p > 1.8 ? 'bad' : '' });
    labels.push({ p: [0, y0 + 0.25, R + 0.1], t: `OD ${(v.X * 2.5).toFixed(1)} · Glc ${v.S.toFixed(1)} g/L · foam ${v.foam.toFixed(1)} cm`, cls: '' });
    labels.push({ p: [0, y0 - 0.05, R + 0.1], t: v.sterile ? 'STERILE' : `NOT STERILE${v.lostWhy ? ' (' + v.lostWhy + ')' : ''}${v.dose > 0 ? ' · ' + v.dose.toFixed(0) + '/20 s @121°C' : ''}`, cls: v.sterile ? 'on' : 'bad' });
    return { objs, labels };
  }

  return {
    tank, conveyor, vialfiller, bioreactor,
    cam: {
      tank: { yaw: 0.55, pitch: 0.38, dist: 7.2, target: [0, 1.4, 0] },
      conveyor: { yaw: 0.3, pitch: 0.55, dist: 4.3, target: [0.1, 0.6, 0.1] },
      vialfiller: { yaw: 0.25, pitch: 0.38, dist: 5.2, target: [0, 1.4, 0] },
      bioreactor: { yaw: 0.45, pitch: 0.28, dist: 6.6, target: [0, 1.4, 0] },
    },
  };
})();
