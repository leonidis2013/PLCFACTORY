'use strict';
/* 2D schematic views (SVG strings) + scoreboards */
const SCENES2D = (() => {
  const G = '#3fb950', OFF = '#3f6283', BL = '#7cc4ff', RD = '#ff5a4d';
  const f = (v, d = 1) => (+v).toFixed(d);
  const valve = (x, y, pos, lbl, vert) => `<g transform="translate(${x} ${y})${vert ? ' rotate(90)' : ''}"><path d="M-13 -9 L13 9 L13 -9 L-13 9 Z" fill="${pos > 0.97 ? G : pos > 0.03 ? '#c9a227' : OFF}" stroke="#d6e8fa" stroke-width="1.2"/></g>${lbl ? `<text x="${x}" y="${y - 15}" class="l" text-anchor="middle">${lbl}</text>` : ''}`;
  const style = `<style>.l{font:600 12px 'Barlow Condensed','Arial Narrow',sans-serif;letter-spacing:.06em;fill:#d6e8fa}.s{font:600 10.5px 'Barlow Condensed','Arial Narrow',sans-serif;letter-spacing:.06em;fill:#8fb7dd}.b{font:600 13px 'IBM Plex Mono',monospace;fill:#ffffff}.pipe{fill:none;stroke:#7fa6cc;stroke-width:5;stroke-linecap:square}.fl{fill:none;stroke:${BL};stroke-width:3;stroke-dasharray:9 7}.bad{fill:${RD}}</style>`;
  const flow = (d, on, ph) => on ? `<path d="${d}" class="fl" stroke-dashoffset="${-ph}"/>` : '';

  function tank(v, c) {
    const ty = 70, th = 250, ly = ty + th * (1 - v.level / 100), ph = (c.t * 40) % 16;
    const col = `hsl(${210 - Math.max(0, Math.min(1, (v.temp - 15) / 65)) * 190},65%,50%)`;
    let s = `<svg viewBox="0 0 600 380">${style}
      <path d="M10 45 H240 V72" class="pipe"/>${flow('M10 45 H240 V72', v.qin > 0.01, ph)}${valve(110, 45, v.valve, 'XV-101')}
      <defs><clipPath id="tk"><rect x="200" y="70" width="180" height="250" rx="8"/></clipPath></defs>
      <g clip-path="url(#tk)"><rect x="200" y="${ly}" width="180" height="${320 - ly}" fill="${col}" opacity=".85"/></g>
      <rect x="200" y="70" width="180" height="250" rx="8" fill="none" stroke="#d6e8fa" stroke-width="2"/>
      <rect x="270" y="20" width="40" height="30" rx="4" fill="${v.mix ? G : OFF}"/><text x="290" y="40" text-anchor="middle" class="b">M</text>
      <line x1="290" y1="50" x2="290" y2="290" stroke="#d6e8fa" stroke-width="3"/>
      <rect x="${290 - Math.max(4, Math.abs(Math.cos(c.t * (v.mix ? 9 : 0))) * 50)}" y="286" width="${Math.max(8, Math.abs(Math.cos(c.t * (v.mix ? 9 : 0))) * 100)}" height="7" fill="#d6e8fa"/>
      <polyline points="${Array.from({ length: 16 }, (_, i) => `${215 + i * 10},${i % 2 ? 300 : 310}`).join(' ')}" fill="none" stroke="${v.burned ? '#333' : `hsl(15,90%,${25 + (v.hp || 0) / 3}%)`}" stroke-width="4"/>
      <path d="M290 320 V350 H442" class="pipe"/><path d="M478 350 H590" class="pipe"/>${flow('M290 320 V350 H442 M478 350 H590', v.qout > 0.01, ph)}
      <circle cx="460" cy="350" r="18" fill="${v.pumpSpd > 1 ? G : OFF}" stroke="#d6e8fa"/><text x="460" y="327" class="l" text-anchor="middle">P-101 ${Math.round(v.pumpSpd)}%</text>
      <text x="290" y="200" text-anchor="middle" class="b">${f(v.level)} %</text><text x="290" y="218" text-anchor="middle" class="b">${f(v.temp)} °C</text>
      <text x="390" y="40" class="l">M-101 · H-101 ${v.burned ? 'BURNED' : Math.round(v.hp || 0) + '%'}</text>`;
    for (const sn of c.sensors) {
      if (sn.type === 'switch' && sn.signal === 'level') {
        const y = ty + th * (1 - sn.sp / 100), on = sn.op === '<=' ? v.level <= sn.sp : v.level >= sn.sp;
        s += `<line x1="380" y1="${y}" x2="400" y2="${y}" stroke="#d6e8fa"/><circle cx="406" cy="${y}" r="6" fill="${on ? G : OFF}"/><text x="416" y="${y + 4}" class="l">${sn.tag}</text>`;
      }
    }
    let ay = 140;
    for (const sn of c.sensors) if (sn.type === 'analog') { s += `<rect x="96" y="${ay}" width="96" height="34" rx="4" fill="#123a5e" stroke="#4f7fae"/><text x="144" y="${ay + 14}" class="s" text-anchor="middle">${sn.tag}</text><text x="144" y="${ay + 28}" class="l" text-anchor="middle">${f(c.val(sn.tag), 2)}</text>`; ay += 42; }
    if (v.overflow) s += `<text x="290" y="64" text-anchor="middle" class="b bad">OVERFLOW!</text>`;
    return s + '</svg>';
  }

  function conveyor(v, c) {
    let s = `<svg viewBox="0 0 800 380">${style}
      <rect x="355" y="242" width="90" height="100" rx="6" fill="#123a5e" stroke="#6f99c2"/><text x="400" y="360" text-anchor="middle" class="l">BIN B · tall</text>
      <rect x="728" y="135" width="64" height="110" rx="6" fill="#123a5e" stroke="#6f99c2"/><text x="760" y="262" text-anchor="middle" class="l">BIN A</text>
      <rect x="20" y="150" width="702" height="80" fill="#1a4670"/>`;
    for (let x = 20 + (v.ph % 30); x < 722; x += 30) s += `<line x1="${x}" y1="150" x2="${x}" y2="230" stroke="#2d5c88"/>`;
    s += `<circle cx="40" cy="268" r="15" fill="${v.run ? G : OFF}"/><text x="40" y="273" text-anchor="middle" class="b">M</text>`;
    for (const sn of c.sensors) {
      if (sn.type !== 'probe') continue;
      const x = sn.pos / 5, hit = v.boxes.some(b => Math.abs(b.x - x) < 20 && Math.abs(b.y - 190) < 30 && (sn.signal === 'box' || (sn.signal === 'tall' && b.tall) || (sn.signal === 'short' && !b.tall)));
      s += `<line x1="${x}" y1="140" x2="${x}" y2="240" stroke="${hit ? RD : '#2ecc7180'}" stroke-width="2" stroke-dasharray="4 3"/><rect x="${x - 5}" y="132" width="10" height="9" fill="#2d6cdf"/><text x="${x}" y="126" text-anchor="middle" class="s">${sn.tag}</text>`;
    }
    for (const b of v.boxes) {
      const jam = b.s === 'jam';
      s += `<g transform="${jam ? `rotate(18 ${b.x} ${b.y})` : ''}"><rect x="${b.x - 18}" y="${b.y - 18}" width="36" height="36" rx="3" fill="${b.tall ? '#e39b3a' : '#b9946a'}" stroke="${jam ? RD : '#3b2a1a'}" stroke-width="2"/><text x="${b.x}" y="${b.y + 5}" text-anchor="middle" class="b" style="fill:#2a1c0e">${b.tall ? 'T' : 'S'}</text></g>`;
    }
    s += `<rect x="372" y="56" width="56" height="44" rx="4" fill="#5d6b7a"/><rect x="396" y="100" width="8" height="${60 + v.p * 80}" fill="#d6e8fa"/>
      <rect x="378" y="${160 + v.p * 80}" width="44" height="12" fill="${v.p > 0.05 ? '#f5a623' : '#8592a0'}"/><text x="400" y="48" text-anchor="middle" class="l">PUSHER</text>`;
    return s + '</svg>';
  }

  function vialfiller(v, c) {
    const X = mm => 60 + mm * 1.05, TY = 260;
    let s = `<svg viewBox="0 0 800 380">${style}
      <rect x="20" y="40" width="760" height="260" rx="6" fill="${v.h2o2 > 2 ? `rgba(120,230,170,${Math.min(0.35, v.h2o2 / 900)})` : '#0f3252'}" stroke="#d6e8fa" stroke-width="2"/>
      <rect x="20" y="20" width="760" height="22" fill="#d9e0e7"/><text x="400" y="35" text-anchor="middle" class="l" style="fill:#223">HEPA ${Math.round(v.fan)}% · ${f(v.air, 2)} m/s</text>`;
    if (v.air > 0.03) for (let i = 0; i < 24; i++) { const x = 40 + i * 31, y = 50 + ((c.t * v.air * 250 + i * 37) % 200); s += `<line x1="${x}" y1="${y}" x2="${x}" y2="${y + 22}" stroke="#7fc8ff" stroke-opacity=".35"/>`; }
    s += `<rect x="40" y="${TY}" width="${X(660) - 40}" height="10" fill="#30363d"/>`;
    for (const q of v.vials) {
      const x = X(q.x), lh = Math.min(30, q.w / 2.5 * 28);
      s += `<rect x="${x - 9}" y="${TY - 40}" width="18" height="40" rx="3" fill="#b9d4ea22" stroke="#b9d4ea"/>${lh > 0.5 ? `<rect x="${x - 7}" y="${TY - 2 - lh}" width="14" height="${lh}" fill="#f2b6c6"/>` : ''}${q.st ? `<rect x="${x - 10}" y="${TY - 46}" width="20" height="7" rx="2" fill="#7c8794"/>` : ''}`;
    }
    const nY = TY - 150 + v.needle * 70;
    s += `<rect x="${X(210) - 26}" y="${nY - 18}" width="52" height="16" fill="${v.bent ? RD : '#c3ccd5'}"/><line x1="${X(210)}" y1="${nY - 2}" x2="${X(210)}" y2="${nY + 40}" stroke="#e9eef3" stroke-width="2"/><text x="${X(210)}" y="${nY - 24}" text-anchor="middle" class="l">FILL ${f(c.val('AI_FillWeight') || 0, 3)} g</text>`;
    const sY = TY - 110 + v.stopper * 54;
    s += `<rect x="${X(350) - 11}" y="${sY - 40}" width="22" height="40" fill="#7c8794"/><text x="${X(350)}" y="${TY - 160}" text-anchor="middle" class="l">STOPPER (${v.hopper})</text>`;
    s += `<rect x="${X(490) - 10}" y="${TY - 30}" width="20" height="20" fill="${v.kick > 0.1 ? RD : '#8592a0'}"/><text x="${X(490)}" y="${TY + 30}" text-anchor="middle" class="l">REJECT</text>`;
    for (const sn of c.sensors) if (sn.type === 'probe') { const on = !!c.val(sn.tag) !== (sn.contact === 'NC'); s += `<circle cx="${X(sn.pos)}" cy="${TY + 18}" r="5" fill="${on ? G : OFF}"/>`; }
    s += `<text x="40" y="70" class="l">ΔP <tspan class="b" ${v.dp < 10 ? 'style="fill:#ff5a4d"' : ''}>${f(v.dp)} Pa</tspan>   Particles <tspan class="b" ${v.part > 3520 ? 'style="fill:#ff5a4d"' : ''}>${Math.round(v.part)}</tspan>/m³   H₂O₂ <tspan class="b">${f(v.h2o2)} ppm</tspan></text>
      <text x="40" y="92" class="b" style="fill:${v.sterile ? G : RD}">${v.sterile ? 'STERILE' : 'NOT STERILE'}${v.dose > 0 && !v.sterile ? ` — dose ${f(v.dose, 0)}/30 s` : ''}</text>
      <text x="760" y="70" text-anchor="end" class="l">Door: ${v.door ? 'OPEN' : 'closed'} · ${v.locked ? 'LOCKED' : 'unlocked'}</text>
      ${v.jam ? `<text x="400" y="140" text-anchor="middle" class="b bad">MACHINE JAM</text>` : ''}`;
    return s + '</svg>';
  }

  function bioreactor(v, c) {
    const vy = 90, vh = 220, fl = Math.min(1, v.V / 70), ly = vy + vh * (1 - fl);
    const vv = v.v;
    let s = `<svg viewBox="0 0 800 380">${style}
      <rect x="300" y="${vy}" width="200" height="${vh}" rx="40" fill="#0f3252" stroke="#d6e8fa" stroke-width="2"/>
      <rect x="292" y="${vy + 60}" width="216" height="140" rx="10" fill="none" stroke="hsl(${210 - Math.max(0, Math.min(1, (v.Tj - 5) / 80)) * 200},60%,50%)" stroke-width="5" opacity=".7"/>
      <clipPath id="bv"><rect x="300" y="${vy}" width="200" height="${vh}" rx="40"/></clipPath>
      <g clip-path="url(#bv)"><rect x="300" y="${ly}" width="200" height="${vy + vh - ly}" fill="hsl(45,${50 + Math.min(30, v.X * 4)}%,${70 - Math.min(35, v.X * 4)}%)"/>
      ${v.foam > 0.3 ? `<rect x="300" y="${ly - Math.min(50, v.foam * 2.5)}" width="200" height="${Math.min(50, v.foam * 2.5)}" fill="#f4f1e8" opacity=".85"/>` : ''}</g>
      <rect x="380" y="40" width="40" height="30" rx="4" fill="${v.rpm > 5 ? G : OFF}"/><text x="400" y="60" text-anchor="middle" class="b">M</text>
      <line x1="400" y1="70" x2="400" y2="290" stroke="#d6e8fa" stroke-width="3"/>
      <text x="400" y="${vy + vh / 2}" text-anchor="middle" class="b">${f(v.V)} L · ${f(v.T)} °C</text>
      <text x="400" y="${vy + vh / 2 + 18}" text-anchor="middle" class="l">pH ${f(v.pH, 2)} · DO ${f(v.DO, 0)}% · ${f(v.p, 2)} bar</text>`;
    const pv = (key, path, x, y, lbl, vert) => `<path d="${path}" class="pipe"/>${valve(x, y, vv[key], lbl, vert)}`;
    s += pv('xv01', 'M60 60 H330 V90', 190, 60, 'XV-01 media');
    s += pv('xv02', 'M740 60 H470 V90', 610, 60, 'XV-02 inoc');
    s += pv('xv09', 'M430 90 V20 H520', 480, 20, 'XV-09 vent');
    s += pv('xv05', 'M60 140 H300', 190, 140, 'XV-05 steam');
    s += pv('xv06', 'M60 190 H292', 190, 190, 'XV-06 hot');
    s += pv('xv07', 'M60 240 H292', 190, 240, 'XV-07 cold');
    s += pv('xv08', 'M60 330 H360 V290', 190, 330, 'XV-08 air');
    s += pv('xv03', 'M400 310 V350 H740', 610, 350, 'XV-03 harvest');
    s += pv('xv04', 'M420 310 V372', 460, 362, '');
    s += `<text x="470" y="368" class="l">XV-04 drain</text>`;
    [['Q_P01_Base', 'BASE'], ['Q_P02_Acid', 'ACID'], ['Q_P03_Antifoam', 'ANTIFOAM'], ['Q_P04_Feed', 'FEED']].forEach(([t, n], i) => {
      const on = !!c.out[t]; s += `<circle cx="${560 + i * 0}" cy="${130 + i * 40}" r="10" fill="${on ? G : OFF}"/><text x="578" y="${134 + i * 40}" class="l">${n}</text><line x1="550" y1="${130 + i * 40}" x2="500" y2="${130 + i * 40}" stroke="#7fa6cc" stroke-width="2"/>`;
    });
    s += `<text x="650" y="140" class="l">OD ${f(v.X * 2.5, 1)}</text><text x="650" y="160" class="l">Glucose ${f(v.S, 2)} g/L</text><text x="650" y="180" class="l">Titer ${f(v.P, 2)} g/L</text>
      <text x="650" y="200" class="l">Air ${f(v.air, 0)} L/min</text><text x="650" y="220" class="l">${Math.round(v.rpm)} rpm</text>
      <text x="650" y="250" class="b" style="fill:${v.sterile ? G : RD}">${v.sterile ? 'STERILE' : 'NOT STERILE'}</text>`;
    return s + '</svg>';
  }

  const score = {
    tank: v => `<span>Level ${f(v.level)}%</span><span>Temp ${f(v.temp)}°C</span><span>Heater ${Math.round(v.hp || 0)}%</span>${v.burned ? '<span class="bad">Heater burned out</span>' : ''}`,
    conveyor: v => { const c = v.cnt; const ok = c.aS + c.bT, bad = c.aT + c.bS; return `<span class="good">Sorted right ${ok}</span><span class="bad">Wrong bin ${bad}</span><span class="${c.jam ? 'bad' : ''}">Jams ${c.jam}</span>`; },
    vialfiller: v => { const c = v.cnt; return `<span class="good">Good accepted ${c.good}</span><span class="${c.badAcc ? 'bad' : ''}">BAD accepted ${c.badAcc}</span><span class="good">Bad rejected ${c.rejBad}</span><span>Good rejected ${c.rejGood}</span><span class="${c.broken ? 'bad' : ''}">Broken ${c.broken}</span><span>Spill ${f(c.spill, 2)} g</span>${c.exposures ? `<span class="bad">H₂O₂ exposures ${c.exposures}</span>` : ''}`; },
    bioreactor: v => `<span>${v.mu > 1e-4 ? 'Doubling ' + f(Math.LN2 / v.mu, 0) + ' s' : 'No growth'}</span><span>Product ${f(v.P, 2)} g/L</span><span>Harvested ${f(v.harvested, 1)} g</span><span class="${v.contam ? 'bad' : 'good'}">${v.contam ? 'CONTAMINATED' : 'Culture clean'}</span>`,
  };
  return { tank, conveyor, vialfiller, bioreactor, score };
})();
