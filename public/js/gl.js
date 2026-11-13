'use strict';
/* PLCFACTORY — tiny dependency-free WebGL renderer: boxes, cylinders, spheres,
   Lambert lighting, transparency, orbit camera and projected HTML labels. */
const GL3D = (() => {
  // ---------- math (column-major 4x4) ----------
  const M = {
    ident: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    mul(a, b) {
      const o = new Array(16);
      for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
      return o;
    },
    persp(fov, asp, n, f) { const t = 1 / Math.tan(fov / 2); return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, 2 * f * n / (n - f), 0]; },
    lookAt(e, c, u) {
      let z = [e[0] - c[0], e[1] - c[1], e[2] - c[2]]; const zl = Math.hypot(...z); z = z.map(v => v / zl);
      let x = [u[1] * z[2] - u[2] * z[1], u[2] * z[0] - u[0] * z[2], u[0] * z[1] - u[1] * z[0]]; const xl = Math.hypot(...x); x = x.map(v => v / xl);
      const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
      return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
        -(x[0] * e[0] + x[1] * e[1] + x[2] * e[2]), -(y[0] * e[0] + y[1] * e[1] + y[2] * e[2]), -(z[0] * e[0] + z[1] * e[1] + z[2] * e[2]), 1];
    },
    // model = T * Ry * Rx * Rz * S
    model(p, r, s) {
      const [rx, ry, rz] = r || [0, 0, 0];
      const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
      // R = Ry*Rx*Rz
      const r00 = cy * cz + sy * sx * sz, r01 = -cy * sz + sy * sx * cz, r02 = sy * cx;
      const r10 = cx * sz, r11 = cx * cz, r12 = -sx;
      const r20 = -sy * cz + cy * sx * sz, r21 = sy * sz + cy * sx * cz, r22 = cy * cx;
      const [a, b, c] = s || [1, 1, 1];
      return [r00 * a, r10 * a, r20 * a, 0, r01 * b, r11 * b, r21 * b, 0, r02 * c, r12 * c, r22 * c, 0, p[0], p[1], p[2], 1];
    },
  };

  // ---------- meshes ----------
  function boxMesh() {
    const P = [], N = [];
    const f = (n, a, b, c, d) => { for (const v of [a, b, c, a, c, d]) { P.push(...v); N.push(...n); } };
    const h = 0.5;
    f([0, 0, 1], [-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]);
    f([0, 0, -1], [h, -h, -h], [-h, -h, -h], [-h, h, -h], [h, h, -h]);
    f([1, 0, 0], [h, -h, h], [h, -h, -h], [h, h, -h], [h, h, h]);
    f([-1, 0, 0], [-h, -h, -h], [-h, -h, h], [-h, h, h], [-h, h, -h]);
    f([0, 1, 0], [-h, h, h], [h, h, h], [h, h, -h], [-h, h, -h]);
    f([0, -1, 0], [-h, -h, -h], [h, -h, -h], [h, -h, h], [-h, -h, h]);
    return { P, N };
  }
  function cylMesh(seg = 28) {
    const P = [], N = [];
    for (let i = 0; i < seg; i++) {
      const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
      const x0 = Math.cos(a0), z0 = Math.sin(a0), x1 = Math.cos(a1), z1 = Math.sin(a1);
      // side (radius 1, y -0.5..0.5)
      const quad = [[x0, -0.5, z0], [x1, -0.5, z1], [x1, 0.5, z1], [x0, -0.5, z0], [x1, 0.5, z1], [x0, 0.5, z0]];
      const nq = [[x0, 0, z0], [x1, 0, z1], [x1, 0, z1], [x0, 0, z0], [x1, 0, z1], [x0, 0, z0]];
      quad.forEach((v, k) => { P.push(...v); N.push(...nq[k]); });
      P.push(0, 0.5, 0, x1, 0.5, z1, x0, 0.5, z0); N.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
      P.push(0, -0.5, 0, x0, -0.5, z0, x1, -0.5, z1); N.push(0, -1, 0, 0, -1, 0, 0, -1, 0);
    }
    return { P, N };
  }
  function sphMesh(seg = 16, rings = 10) {
    const P = [], N = [];
    const pt = (i, j) => { const th = j / rings * Math.PI, ph = i / seg * Math.PI * 2; return [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)]; };
    for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
      const a = pt(i, j), b = pt(i + 1, j), c = pt(i + 1, j + 1), d = pt(i, j + 1);
      for (const v of [a, c, b, a, d, c]) { P.push(...v); N.push(...v); }
    }
    return { P, N };
  }

  const VS = `attribute vec3 aP; attribute vec3 aN; uniform mat4 uMVP; uniform mat4 uM; varying vec3 vN; varying vec3 vW;
    void main(){ vec4 w = uM * vec4(aP,1.0); vW = w.xyz; vN = mat3(uM) * aN; gl_Position = uMVP * vec4(aP,1.0); }`;
  const FS = `precision mediump float; varying vec3 vN; varying vec3 vW; uniform vec3 uC; uniform float uA; uniform float uE; uniform vec3 uEye;
    void main(){ vec3 n = normalize(vN); vec3 v = normalize(uEye - vW); if (dot(n, v) < 0.0) n = -n;
      float d1 = max(dot(n, normalize(vec3(0.45,0.85,0.35))), 0.0); float d2 = max(dot(n, normalize(vec3(-0.6,0.3,-0.5))), 0.0);
      vec3 h = normalize(normalize(vec3(0.45,0.85,0.35)) + v); float sp = pow(max(dot(n,h),0.0), 40.0) * 0.25;
      vec3 col = uC * (0.32 + 0.62*d1 + 0.18*d2) + vec3(sp);
      col = mix(col, uC, uE);
      float fog = clamp((length(uEye - vW) - 12.0) / 40.0, 0.0, 0.6);
      col = mix(col, vec3(0.07,0.09,0.11), fog);
      gl_FragColor = vec4(col, uA); }`;

  function hex(c) {
    if (Array.isArray(c)) return c;
    const n = parseInt(c.slice(1), 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }

  class Renderer {
    constructor(canvas, labelLayer) {
      this.cv = canvas; this.lab = labelLayer; this.labPool = [];
      const gl = this.gl = canvas.getContext('webgl', { antialias: true, alpha: false, preserveDrawingBuffer: false });
      if (!gl) { this.failed = true; return; }
      const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
      const pr = this.pr = gl.createProgram();
      gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr);
      gl.useProgram(pr);
      this.loc = { aP: gl.getAttribLocation(pr, 'aP'), aN: gl.getAttribLocation(pr, 'aN'), uMVP: gl.getUniformLocation(pr, 'uMVP'), uM: gl.getUniformLocation(pr, 'uM'),
        uC: gl.getUniformLocation(pr, 'uC'), uA: gl.getUniformLocation(pr, 'uA'), uE: gl.getUniformLocation(pr, 'uE'), uEye: gl.getUniformLocation(pr, 'uEye') };
      this.mesh = {};
      for (const [k, m] of Object.entries({ box: boxMesh(), cyl: cylMesh(), sph: sphMesh() })) {
        const pb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(m.P), gl.STATIC_DRAW);
        const nb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, nb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(m.N), gl.STATIC_DRAW);
        this.mesh[k] = { pb, nb, n: m.P.length / 3 };
      }
      gl.enable(gl.DEPTH_TEST);
      gl.enableVertexAttribArray(this.loc.aP); gl.enableVertexAttribArray(this.loc.aN);
      this.cam = { yaw: 0.6, pitch: 0.42, dist: 7, target: [0, 1, 0] };
      this.home = Object.assign({}, this.cam);
    }
    setHome(c) { this.home = Object.assign({}, c, { target: c.target.slice() }); this.cam = Object.assign({}, this.home, { target: this.home.target.slice() }); }
    resetView() { this.cam = Object.assign({}, this.home, { target: this.home.target.slice() }); }
    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = this.cv.clientWidth, h = this.cv.clientHeight;
      if (this.cv.width !== Math.round(w * dpr) || this.cv.height !== Math.round(h * dpr)) { this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(h * dpr); }
      return [w, h];
    }
    eye() {
      const c = this.cam;
      return [c.target[0] + c.dist * Math.cos(c.pitch) * Math.sin(c.yaw), c.target[1] + c.dist * Math.sin(c.pitch), c.target[2] + c.dist * Math.cos(c.pitch) * Math.cos(c.yaw)];
    }
    draw(objs, labels) {
      if (this.failed) return;
      const gl = this.gl, L = this.loc;
      const [w, h] = this.resize();
      gl.viewport(0, 0, this.cv.width, this.cv.height);
      gl.clearColor(0.07, 0.09, 0.11, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const eye = this.eye();
      const VP = M.mul(M.persp(0.8, w / Math.max(h, 1), 0.05, 100), M.lookAt(eye, this.cam.target, [0, 1, 0]));
      this.VP = VP; this.wh = [w, h];
      gl.uniform3fv(L.uEye, eye);
      const opaque = [], trans = [];
      for (const o of objs) ((o.a !== undefined && o.a < 1) ? trans : opaque).push(o);
      const dist = o => (o.p[0] - eye[0]) ** 2 + (o.p[1] - eye[1]) ** 2 + (o.p[2] - eye[2]) ** 2;
      trans.sort((a, b) => dist(b) - dist(a));
      let cur = null;
      const one = o => {
        const m = this.mesh[o.m || 'box'];
        if (cur !== m) {
          gl.bindBuffer(gl.ARRAY_BUFFER, m.pb); gl.vertexAttribPointer(L.aP, 3, gl.FLOAT, false, 0, 0);
          gl.bindBuffer(gl.ARRAY_BUFFER, m.nb); gl.vertexAttribPointer(L.aN, 3, gl.FLOAT, false, 0, 0);
          cur = m;
        }
        const Mm = M.model(o.p, o.r, o.s);
        gl.uniformMatrix4fv(L.uM, false, new Float32Array(Mm));
        gl.uniformMatrix4fv(L.uMVP, false, new Float32Array(M.mul(VP, Mm)));
        gl.uniform3fv(L.uC, hex(o.c || '#888888'));
        gl.uniform1f(L.uA, o.a === undefined ? 1 : o.a);
        gl.uniform1f(L.uE, o.e || 0);
        gl.drawArrays(gl.TRIANGLES, 0, m.n);
      };
      gl.disable(gl.BLEND); gl.depthMask(true);
      opaque.forEach(one);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      trans.forEach(one);
      gl.depthMask(true);
      this.drawLabels(labels || []);
    }
    project(p) {
      const v = this.VP, x = p[0], y = p[1], z = p[2];
      const cx = v[0] * x + v[4] * y + v[8] * z + v[12], cy = v[1] * x + v[5] * y + v[9] * z + v[13], cw = v[3] * x + v[7] * y + v[11] * z + v[15];
      if (cw <= 0.01) return null;
      return [(cx / cw * 0.5 + 0.5) * this.wh[0], (1 - (cy / cw * 0.5 + 0.5)) * this.wh[1]];
    }
    drawLabels(labels) {
      if (!this.lab) return;
      // place important labels first, then nudge/hide others that would overlap
      const rank = l => /bad|big/.test(l.cls || '') ? 0 : /on/.test(l.cls || '') ? 1 : /dim/.test(l.cls || '') ? 3 : 2;
      const order = labels.map((l, i) => [rank(l), i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(x => labels[x[1]]);
      const placed = [];
      let i = 0;
      for (const l of order) {
        const s = this.project(l.p);
        if (!s) continue;
        let el = this.labPool[i];
        if (!el) { el = document.createElement('div'); this.lab.appendChild(el); this.labPool.push(el); }
        const cls = 'gl-label ' + (l.cls || '');
        if (el._t !== l.t || el._c !== cls) { el.textContent = l.t; el.className = cls; el._t = l.t; el._c = cls; el._w = 0; }
        el.style.display = '';
        if (!el._w) { el._w = el.offsetWidth; el._h = el.offsetHeight; }
        const w = el._w, h = el._h;
        let x = s[0] - w / 2, y = s[1] - h, ok = false;
        for (let k = 0; k < 4 && !ok; k++) {
          const yy = y + (k === 0 ? 0 : k % 2 ? k * (h + 1) / 1 : -k * (h + 1) / 2);
          if (!placed.some(r => x < r[0] + r[2] && x + w > r[0] && yy < r[1] + r[3] && yy + h > r[1])) { y = yy; ok = true; }
        }
        if (!ok && rank(l) >= 2) { el.style.display = 'none'; i++; continue; }
        placed.push([x, y, w, h]);
        el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        i++;
      }
      for (; i < this.labPool.length; i++) this.labPool[i].style.display = 'none';
    }
    attachControls() {
      const cv = this.cv, ptrs = new Map();
      let last = null;
      cv.style.touchAction = 'none';
      cv.addEventListener("pointerdown", e => { try { cv.setPointerCapture(e.pointerId); } catch (x) {} ptrs.set(e.pointerId, [e.clientX, e.clientY]); last = null; });
      const end = e => { ptrs.delete(e.pointerId); last = null; };
      cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
      cv.addEventListener('pointermove', e => {
        if (!ptrs.has(e.pointerId)) return;
        const prev = ptrs.get(e.pointerId);
        ptrs.set(e.pointerId, [e.clientX, e.clientY]);
        const c = this.cam;
        if (ptrs.size === 1) {
          const dx = e.clientX - prev[0], dy = e.clientY - prev[1];
          if (e.shiftKey || e.buttons === 2 || e.buttons === 4) this.pan(dx, dy);
          else { c.yaw -= dx * 0.008; c.pitch = Math.max(-0.1, Math.min(1.45, c.pitch + dy * 0.006)); }
        } else if (ptrs.size === 2) {
          const [a, b] = [...ptrs.values()];
          const d = Math.hypot(a[0] - b[0], a[1] - b[1]), mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          if (last) { c.dist = Math.max(1, Math.min(40, c.dist * last.d / d)); this.pan(mid[0] - last.mid[0], mid[1] - last.mid[1]); }
          last = { d, mid };
        }
      });
      cv.addEventListener('wheel', e => { e.preventDefault(); this.cam.dist = Math.max(1, Math.min(40, this.cam.dist * Math.exp(e.deltaY * 0.001))); }, { passive: false });
      cv.addEventListener('dblclick', () => this.resetView());
      cv.addEventListener('contextmenu', e => e.preventDefault());
    }
    pan(dx, dy) {
      const c = this.cam, k = c.dist * 0.0018;
      const rx = Math.cos(c.yaw), rz = -Math.sin(c.yaw);
      c.target[0] -= dx * k * rx; c.target[2] -= dx * k * rz;
      c.target[1] += dy * k;
    }
  }
  return { Renderer, hex };
})();
