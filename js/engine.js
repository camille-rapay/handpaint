/* HandPaint web engine: two paint layers (dithered + feathered) simulated and drawn with WebGL2.
 * See shaders.js for how a layer is stored.  Coordinates everywhere are canvas pixels, y down (CW x CH, about
 * 1280x720 worth of pixels whatever the aspect ratio), like the Python app. */
(function (HP) {
'use strict';

const SPECTRUM = [[255, 70, 150], [255, 50, 55], [255, 150, 30], [255, 225, 60], [160, 255, 60], [50, 235, 110],
  [40, 215, 185], [50, 220, 255], [70, 110, 255], [85, 60, 215], [150, 70, 255], [235, 50, 215]];
const SUNSET = [[255, 236, 130], [255, 175, 45], [255, 95, 45], [255, 45, 105], [220, 35, 165], [125, 35, 160]];
const MAX_VERSIONS = 12;

function fitSize(area, ratio, even) {
  even = even || 1;
  const w = Math.max(even, Math.round(Math.sqrt(area * ratio) / even) * even);
  return [w, Math.max(even, Math.round(w / ratio / even) * even)];
}

function rampRow(rgb, cyclic) {            // 256 colours, like the Python _ramp_lut
  const out = new Uint8Array(256 * 4);
  const n = rgb.length;
  const ctrl = cyclic ? rgb.concat([rgb[0]]) : rgb;
  for (let i = 0; i < 256; i++) {
    const x = cyclic ? (i / 256) * n : (i / 255) * (n - 1);
    const i0 = Math.min(Math.floor(x), ctrl.length - 2), f = x - i0;
    for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.round(ctrl[i0][c] * (1 - f) + ctrl[i0 + 1][c] * f);
    out[i * 4 + 3] = 255;
  }
  return out;
}

function makeNoise(w, h, seed) {           // three channels of smooth value noise, roughly normal around 0.5
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const gauss = () => { let a = 0; for (let i = 0; i < 6; i++) a += rnd(); return (a - 3) / Math.sqrt(0.5); };
  const data = new Uint8Array(w * h * 4);
  for (let ch = 0; ch < 3; ch++) {
    const acc = new Float32Array(w * h);
    for (const [gw, gh, wt] of [[10, 6, 1], [26, 15, 0.8], [70, 40, 0.6]]) {
      const g = new Float32Array((gw + 1) * (gh + 1));
      for (let i = 0; i < g.length; i++) g[i] = gauss();
      for (let y = 0; y < h; y++) {
        const fy = (y / h) * gh, y0 = Math.floor(fy), ty = fy - y0;
        for (let x = 0; x < w; x++) {
          const fx = (x / w) * gw, x0 = Math.floor(fx), tx = fx - x0;
          const a = g[y0 * (gw + 1) + x0], b = g[y0 * (gw + 1) + x0 + 1], c = g[(y0 + 1) * (gw + 1) + x0], d = g[(y0 + 1) * (gw + 1) + x0 + 1];
          acc[y * w + x] += wt * ((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty);
        }
      }
    }
    let mean = 0, sq = 0;
    for (let i = 0; i < acc.length; i++) mean += acc[i];
    mean /= acc.length;
    for (let i = 0; i < acc.length; i++) sq += (acc[i] - mean) ** 2;
    const sd = Math.sqrt(sq / acc.length) + 1e-6;
    for (let i = 0; i < acc.length; i++) data[i * 4 + ch] = Math.max(0, Math.min(255, Math.round(128 + ((acc[i] - mean) / sd) * 36)));
  }
  for (let i = 0; i < w * h; i++) data[i * 4 + 3] = 255;
  return data;
}

class Engine {
  constructor(canvas, opts) {
    opts = opts || {};
    const gl = this.gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float'))
      throw new Error('This browser cannot draw to floating-point textures.');
    gl.getExtension('OES_texture_float_linear');
    this.canvas = canvas;
    this.progs = {};
    this.build();
    this.noise = this.makeTexture(256, 144, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, makeNoise(256, 144, 11), gl.LINEAR, gl.REPEAT);
    this.lut = this.makeTexture(256, 1 + MAX_VERSIONS, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(256 * (1 + MAX_VERSIONS) * 4), gl.NEAREST, gl.CLAMP_TO_EDGE);
    this.versions = [{ rgb: SUNSET.map(c => c.slice()), used: false }];
    this.curVer = 0;
    this.uploadLut();
    // settings
    this.levels = 16; this.band = 0.6; this.ditherPx = 3;
    this.bleed = 1.0; this.tauSec = 60;
    this.bg = [17, 17, 17]; this.bgAlpha = 1.0;
    this.history = []; this.maxHistory = 20;
    this.setAspect(16, 9, opts.area || 1280 * 720);
  }

  // ------------------------------------------------------------------------------------------------ GL helpers
  compile(type, src) {
    const gl = this.gl, s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n'));
    return s;
  }
  program(name, frag) {
    const gl = this.gl, p = gl.createProgram();
    gl.attachShader(p, this.compile(gl.VERTEX_SHADER, HP.shaders.VERT));
    gl.attachShader(p, this.compile(gl.FRAGMENT_SHADER, frag));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(name + ': ' + gl.getProgramInfoLog(p));
    this.progs[name] = { p, loc: {} };
  }
  build() {
    const S = HP.shaders;
    for (const k of ['PAINT', 'SMUDGE', 'ERASE', 'ORDER', 'COPY', 'COPY1', 'PREP', 'BLUR', 'PHYS', 'RENDER', 'STYLE']) this.program(k, S[k]);
    this.vao = this.gl.createVertexArray();
  }
  use(name) {
    this.cur = this.progs[name];
    this.gl.useProgram(this.cur.p);
    this.nextUnit = 0;
    if (name !== 'BLUR') this.set2('uCanvas', this.CW, this.CH);
    return this;
  }
  loc(n) {
    const c = this.cur;
    if (!(n in c.loc)) c.loc[n] = this.gl.getUniformLocation(c.p, n);
    return c.loc[n];
  }
  set1(n, v) { const l = this.loc(n); if (l) this.gl.uniform1f(l, v); return this; }
  set2(n, a, b) { const l = this.loc(n); if (l) this.gl.uniform2f(l, a, b); return this; }
  set4(n, a, b, c, d) { const l = this.loc(n); if (l) this.gl.uniform4f(l, a, b, c, d); return this; }
  tex(n, t) {
    const gl = this.gl, l = this.loc(n);
    if (l) { gl.activeTexture(gl.TEXTURE0 + this.nextUnit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(l, this.nextUnit); }
    this.nextUnit++;
    return this;
  }
  makeTexture(w, h, internal, format, type, data, filter, wrap) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, internal, w, h);
    if (data) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, format, type, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    return t;
  }
  floatTex(w, h) { const gl = this.gl; return this.makeTexture(w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, null, gl.LINEAR, gl.CLAMP_TO_EDGE); }
  // a set of n textures with a framebuffer that draws into all of them
  makeSet(w, h, n) {
    const gl = this.gl, tex = [], fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    for (let i = 0; i < n; i++) {
      const t = this.floatTex(w, h);
      tex.push(t);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0);
    }
    gl.drawBuffers(tex.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo, w, h };
  }
  freeSet(s) { const gl = this.gl; s.tex.forEach(t => gl.deleteTexture(t)); gl.deleteFramebuffer(s.fbo); }
  draw(fbo, w, h) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  clearSet(s, value) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, s.fbo);
    for (let i = 0; i < s.tex.length; i++) gl.clearBufferfv(gl.COLOR, i, value || [0, 0, 0, 0]);
  }

  // ------------------------------------------------------------------------------------------------ canvas setup
  setAspect(aw, ah, area) {
    const gl = this.gl;
    this.free();
    this.area = area || this.area;
    [this.CW, this.CH] = fitSize(this.area, aw / ah);
    this.SW = Math.max(16, Math.round(this.CW / 2)); this.SH = Math.max(16, Math.round(this.CH / 2));
    this.MW = Math.max(8, Math.round(this.SW / 2)); this.MH = Math.max(8, Math.round(this.SH / 2));
    this.sc = Math.sqrt(this.CW * this.CH / (1280 * 720));
    this.layers = [0, 1].map(() => ({ sets: [this.makeSet(this.SW, this.SH, 4), this.makeSet(this.SW, this.SH, 4)], cur: 0, has: false, st: [this.makeSet(this.SW, this.SH, 1), this.makeSet(this.SW, this.SH, 1)], sc: 0 }));
    this.ord = [this.makeSet(this.SW, this.SH, 1), this.makeSet(this.SW, this.SH, 1)];
    this.ordCur = 0;
    this.mid = { mA: this.makeSet(this.MW, this.MH, 4), mB: this.makeSet(this.MW, this.MH, 4), uA: this.makeSet(this.MW, this.MH, 4), uB: this.makeSet(this.MW, this.MH, 4) };
    this.history = [];
    this.clearAll();
  }
  free() {
    if (!this.layers) return;
    for (const L of this.layers) { L.sets.forEach(s => this.freeSet(s)); L.st.forEach(s => this.freeSet(s)); }
    this.ord.forEach(s => this.freeSet(s));
    Object.values(this.mid).forEach(s => this.freeSet(s));
    this.history.forEach(h => this.freeSnapshot(h));
    this.history = [];
  }
  clearAll() {
    for (const L of this.layers) { L.sets.forEach(s => this.clearSet(s)); L.st.forEach(s => this.clearSet(s)); L.has = false; L.cur = 0; L.sc = 0; }
    this.ord.forEach(s => this.clearSet(s, [0.5, 0, 0, 1]));
    this.ordCur = 0;
  }
  resetVersions() {
    this.versions = [{ rgb: this.versions[this.curVer].rgb.map(c => c.slice()), used: false }];
    this.curVer = 0;
    this.uploadLut();
  }

  // ------------------------------------------------------------------------------------------------ palettes
  uploadLut() {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.lut);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, rampRow(SPECTRUM, true));
    this.versions.forEach((v, i) => gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 1 + i, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, rampRow(v.rgb, false)));
  }
  get multiRgb() { return this.versions[this.curVer].rgb; }
  /** Change one Multicolor colour; only strokes painted from now on use it (a used colour set is copied first). */
  setMultiColor(index, rgb) {
    let v = this.versions[this.curVer];
    if (v.used && this.versions.length < MAX_VERSIONS) {
      v = { rgb: v.rgb.map(c => c.slice()), used: false };
      this.versions.push(v); this.curVer = this.versions.length - 1;
    }
    v.rgb[index] = rgb.slice();
    this.uploadLut();
  }
  resetMulti() {
    let v = this.versions[this.curVer];
    if (v.used && this.versions.length < MAX_VERSIONS) {
      v = { rgb: [], used: false }; this.versions.push(v); this.curVer = this.versions.length - 1;
    }
    v.rgb = SUNSET.map(c => c.slice());
    this.uploadLut();
  }

  // ------------------------------------------------------------------------------------------------ brush operations
  /** Lay paint along p0->p1.  o: {layer, radius, weights[5] (pigments), amount, softness, palette (0 rainbow | 1 multicolor),
   *  solid: [r,g,b] 0-1 or null, solidLoad} */
  paint(p0, p1, o) {
    const L = this.layers[o.layer], src = L.sets[L.cur], dst = L.sets[1 - L.cur];
    const w = o.weights, isPig = !o.solid && Math.max(...w) > 0.02;
    const wf = 0.22 + 0.83 * Math.min(o.radius / (50 * this.sc), 1);
    this.use('PAINT');
    src.tex.forEach((t, i) => this.tex('uT' + i, t));
    this.tex('uNoise', this.noise);
    this.set2('uA', p0[0], p0[1]).set2('uB', p1[0], p1[1]).set1('uR', o.radius).set1('uSoft', o.softness)
      .set1('uAmount', o.amount).set1('uWf', wf).set4('uW0', w[0], w[1], w[2], w[3]).set1('uW4', w[4])
      .set1('uPalette', o.palette).set1('uVer', this.curVer).set1('uSize', o.layer === 0 ? this.ditherPx : 0)
      .set1('uIsPig', isPig ? 1 : 0).set1('uIsSolid', o.solid ? 1 : 0);
    const m = o.solidLoad || 0.3;
    this.set4('uSolid', o.solid ? o.solid[0] * m : 0, o.solid ? o.solid[1] * m : 0, o.solid ? o.solid[2] * m : 0, o.solid ? m : 0);
    this.draw(dst.fbo, this.SW, this.SH);
    L.cur = 1 - L.cur; L.has = true;
    this.stamp(L, p0, p1, o.radius, o.softness);
    if (isPig && o.palette === 1) this.versions[this.curVer].used = true;
    this.order(p0, p1, o.radius, o.softness, o.layer === 0 ? 1 : 0);
  }
  /** Remember the current look settings under this stroke (see the STYLE shader). */
  stamp(L, p0, p1, r, soft) {
    const src = L.st[L.sc], dst = L.st[1 - L.sc];
    this.use('STYLE').tex('uSt', src.tex[0]);
    this.set2('uA', p0[0], p0[1]).set2('uB', p1[0], p1[1]).set1('uR', r).set1('uSoft', soft).set4('uVals', this.levels, this.band, this.bleed, this.tauSec);
    this.draw(dst.fbo, this.SW, this.SH);
    L.sc = 1 - L.sc;
  }
  order(p0, p1, r, soft, value) {
    const src = this.ord[this.ordCur], dst = this.ord[1 - this.ordCur];
    this.use('ORDER').tex('uOrd', src.tex[0]);
    this.set2('uA', p0[0], p0[1]).set2('uB', p1[0], p1[1]).set1('uR', r).set1('uSoft', soft).set1('uValue', value);
    this.draw(dst.fbo, this.SW, this.SH);
    this.ordCur = 1 - this.ordCur;
  }
  /** Smear the whole composition; the smear lands on layer `target` (0 = dithered, 1 = smooth). */
  smudge(p0, p1, radius, softness, strength, target) {
    const A = this.layers[target], O = this.layers[1 - target];
    if (!A.has && !O.has) return;
    if (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) < 0.5) return;
    const aSrc = A.sets[A.cur], aDst = A.sets[1 - A.cur], oSrc = O.sets[O.cur], oDst = O.sets[1 - O.cur];
    this.use('SMUDGE');
    aSrc.tex.forEach((t, i) => this.tex('uT' + i, t));
    oSrc.tex.forEach((t, i) => this.tex('uO' + i, t));
    this.set2('uA', p0[0], p0[1]).set2('uB', p1[0], p1[1]).set1('uR', radius).set1('uSoft', softness)
      .set1('uStrength', strength).set1('uRole', 0).set1('uSize', target === 0 ? this.ditherPx : 0);
    this.draw(aDst.fbo, this.SW, this.SH);
    A.cur = 1 - A.cur; A.has = true;
    if (O.has) {
      this.use('SMUDGE');
      oSrc.tex.forEach((t, i) => this.tex('uT' + i, t));
      oSrc.tex.forEach((t, i) => this.tex('uO' + i, t));
      this.set2('uA', p0[0], p0[1]).set2('uB', p1[0], p1[1]).set1('uR', radius).set1('uSoft', softness)
        .set1('uStrength', strength).set1('uRole', 1).set1('uSize', 0);
      this.draw(oDst.fbo, this.SW, this.SH);
      O.cur = 1 - O.cur;
    }
    this.order(p0, p1, radius, softness, target === 0 ? 1 : 0);
  }
  erase(p0, p1, radius, softness) {
    for (const L of this.layers) {
      if (!L.has) continue;
      const src = L.sets[L.cur], dst = L.sets[1 - L.cur];
      this.use('ERASE');
      src.tex.forEach((t, i) => this.tex('uT' + i, t));
      this.set2('uA', p0[0], p0[1]).set2('uB', p1[0], p1[1]).set1('uR', radius).set1('uSoft', softness);
      this.draw(dst.fbo, this.SW, this.SH);
      L.cur = 1 - L.cur;
    }
  }

  // ------------------------------------------------------------------------------------------------ physics
  step(dts) {
    dts = Math.max(0.5, Math.min(4, dts));
    const decay = Math.exp(-dts / (this.tauSec * 30));
    const k = this.MW / this.CW;
    const S = (a, b, c, d) => [a * k, b * k, c * k, d * k];
    const sig = {
      m: [S(4.0, 2.6, 9.0, 6.5), S(2.6, 5, 5, 5), S(5, 5, 5, 5), S(5, 5, 5, 5)],
      u: [S(4.0, 2.6, 9.0, 6.5), S(2.6, 5, 5, 5), S(5, 5, 5, 5), S(7, 7, 5, 5)],
    };
    for (const L of this.layers) {
      if (!L.has) continue;
      const cur = L.sets[L.cur], nxt = L.sets[1 - L.cur];
      for (const kind of ['m', 'u']) {
        const A = this.mid[kind + 'A'], B = this.mid[kind + 'B'];
        this.use('PREP');
        cur.tex.forEach((t, i) => this.tex('uT' + i, t));
        this.set1('uMasked', kind === 'm' ? 1 : 0);
        this.draw(A.fbo, this.MW, this.MH);
        for (const [from, to, dx, dy] of [[A, B, 1 / this.MW, 0], [B, A, 0, 1 / this.MH]]) {
          this.use('BLUR');
          from.tex.forEach((t, i) => this.tex('uI' + i, t));
          this.set2('uStep', dx, dy);
          sig[kind].forEach((s, i) => this.set4('uS' + i, s[0], s[1], s[2], s[3]));
          this.draw(to.fbo, this.MW, this.MH);
        }
      }
      this.use('PHYS');
      cur.tex.forEach((t, i) => this.tex('uT' + i, t));
      this.mid.mA.tex.forEach((t, i) => this.tex('uM' + i, t));
      this.mid.uA.tex.forEach((t, i) => this.tex('uU' + i, t));
      this.tex('uNoise', this.noise).tex('uSt', L.st[L.sc].tex[0]);
      this.set2('uTexel', 1 / this.SW, 1 / this.SH).set2('uMidTexel', 1 / this.MW, 1 / this.MH).set1('uDts', dts).set1('uBleed', this.bleed).set1('uDecay', decay).set1('uFront', this.front || 0.952).set1('uFlow', this.flow == null ? 11 : this.flow).set1('uSlow', this.slow == null ? 1 : this.slow);
      this.draw(nxt.fbo, this.SW, this.SH);
      L.cur = 1 - L.cur;
    }
  }

  // ------------------------------------------------------------------------------------------------ drawing the result
  /** Draw to the screen canvas (target null) or into an offscreen framebuffer. */
  renderTo(fbo, w, h, opts) {
    opts = opts || {};
    const D = this.layers[0], Sm = this.layers[1];
    this.use('RENDER');
    D.sets[D.cur].tex.forEach((t, i) => this.tex('uD' + i, t));
    Sm.sets[Sm.cur].tex.forEach((t, i) => this.tex('uS' + i, t));
    this.tex('uOrd', this.ord[this.ordCur].tex[0]).tex('uLut', this.lut).tex('uStD', D.st[D.sc].tex[0]).tex('uStS', Sm.st[Sm.sc].tex[0]);
    this.set1('uLevels', this.levels).set1('uBand', this.band).set1('uDefaultSize', this.ditherPx)
      .set1('uDitherOn', (D.has ? 1 : 0) + (Sm.has ? 2 : 0))
      .set4('uBg', this.bg[0] / 255, this.bg[1] / 255, this.bg[2] / 255, this.bgAlpha)
      .set1('uChecker', opts.checker ? 1 : 0).set1('uOutAlpha', typeof opts.alpha === 'number' ? opts.alpha : (opts.alpha ? 1 : 0)).set1('uFlip', opts.flip ? 1 : 0).set2('uOutSize', w, h);
    this.draw(fbo, w, h);
  }
  render() {
    this.renderTo(null, this.canvas.width, this.canvas.height, { checker: this.showChecker !== false });
  }
  /** A PNG of the whole canvas at w x h, with transparency where the background is transparent. */
  exportPNG(w, h) {
    const gl = this.gl;
    const tex = this.makeTexture(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, null, gl.NEAREST, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    this.renderTo(fbo, w, h, { alpha: true });
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo); gl.deleteTexture(tex);
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {            // flip, and turn premultiplied colour back into straight colour
      const s = (h - 1 - y) * w * 4, d = y * w * 4;
      for (let x = 0; x < w; x++) {
        const a = px[s + x * 4 + 3];
        const inv = a > 0 ? 255 / a : 0;
        out[d + x * 4] = Math.min(255, px[s + x * 4] * inv); out[d + x * 4 + 1] = Math.min(255, px[s + x * 4 + 1] * inv);
        out[d + x * 4 + 2] = Math.min(255, px[s + x * 4 + 2] * inv); out[d + x * 4 + 3] = a;
      }
    }
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').putImageData(new ImageData(out, w, h), 0, 0);
    return new Promise(res => c.toBlob(res, 'image/png'));
  }

  /** The current picture as straight-alpha RGBA, top row first (for video frames).  Reuses one offscreen target per size. */
  captureFrame(w, h, mode) {   // mode: 2 straight RGBA (default), 3 straight colour with alpha 1, 4 the alpha as a grey picture
    const gl = this.gl;
    if (!this.cap || this.cap.w !== w || this.cap.h !== h) {
      if (this.cap) { gl.deleteFramebuffer(this.cap.fbo); gl.deleteTexture(this.cap.tex); }
      const tex = this.makeTexture(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, null, gl.NEAREST, gl.CLAMP_TO_EDGE);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      this.cap = { w, h, tex, fbo };
    }
    this.renderTo(this.cap.fbo, w, h, { alpha: mode || 2, flip: true });
    const px = new Uint8ClampedArray(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.cap.fbo);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return px;
  }

  // ------------------------------------------------------------------------------------------------ undo
  snapshotNow() {
    const snap = { layers: this.layers.map(L => ({ set: this.makeSet(this.SW, this.SH, 4), st: this.makeSet(this.SW, this.SH, 1), has: L.has })), ord: this.makeSet(this.SW, this.SH, 1),
      versions: this.versions.map(v => ({ rgb: v.rgb.map(c => c.slice()), used: v.used })), curVer: this.curVer };
    this.layers.forEach((L, i) => { this.copySet(L.sets[L.cur], snap.layers[i].set); this.copyOne(L.st[L.sc], snap.layers[i].st); });
    this.use('COPY1').tex('uT', this.ord[this.ordCur].tex[0]);
    this.draw(snap.ord.fbo, this.SW, this.SH);
    return snap;
  }
  copyOne(from, to) { this.use('COPY1').tex('uT', from.tex[0]); this.draw(to.fbo, this.SW, this.SH); }
  copySet(from, to) {
    this.use('COPY');
    from.tex.forEach((t, i) => this.tex('uT' + i, t));
    this.draw(to.fbo, this.SW, this.SH);
  }
  freeSnapshot(s) { s.layers.forEach(l => { this.freeSet(l.set); this.freeSet(l.st); }); this.freeSet(s.ord); }
  pushHistory() {
    this.history.push(this.snapshotNow());
    while (this.history.length > this.maxHistory) this.freeSnapshot(this.history.shift());
  }
  get canUndo() { return this.history.length > 0; }
  undo() {
    const s = this.history.pop();
    if (!s) return false;
    this.layers.forEach((L, i) => {
      this.copySet(s.layers[i].set, L.sets[L.cur]);
      this.copyOne(s.layers[i].st, L.st[L.sc]);
      L.has = L.has || s.layers[i].has;
    });
    this.use('COPY1').tex('uT', s.ord.tex[0]);
    this.draw(this.ord[this.ordCur].fbo, this.SW, this.SH);
    if (s.versions.length >= this.versions.length) { this.versions = s.versions; this.curVer = s.curVer; this.uploadLut(); }
    this.freeSnapshot(s);
    return true;
  }
  clear() {
    this.pushHistory();
    this.layers.forEach(L => { L.sets.forEach(x => this.clearSet(x)); L.st.forEach(x => this.clearSet(x)); L.has = false; });
    this.ord.forEach(s => this.clearSet(s, [0.5, 0, 0, 1]));
  }
}

HP.Engine = Engine;
HP.fitSize = fitSize;
HP.SUNSET = SUNSET;
})(window.HP = window.HP || {});
