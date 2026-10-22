/* Dev helpers (loaded with ?debug): HPDebug.stroke(...) paints a reference stroke, HPDebug.stats() reads the fields back. */
(function (HP) {
const D = window.HPDebug = {};
D.stats = (label, layer) => {
  const E = window.HPApp.engine, gl = E.gl, L = E.layers[layer || 0], s = L.sets[L.cur], W = E.SW, H = E.SH;
  const rd = att => { gl.bindFramebuffer(gl.FRAMEBUFFER, s.fbo); gl.readBuffer(gl.COLOR_ATTACHMENT0 + att); const a = new Float32Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.FLOAT, a); return a; };
  const a0 = rd(0), a1 = rd(1), a3 = rd(3), STR = [1, 0.85, 0.95, 1, 0.8];
  let mx = 0, sum = 0, cnt = 0, area = 0, mass = 0, wm = 0;
  for (let i = 0; i < W * H; i++) {
    const t = a0[i * 4] * STR[0] + a0[i * 4 + 1] * STR[1] + a0[i * 4 + 2] * STR[2] + a0[i * 4 + 3] * STR[3] + a1[i * 4] * STR[4];
    mx = Math.max(mx, t); mass += t; if (t > 0.05) { sum += t; cnt++; } if (t > 0.25) area++; wm = Math.max(wm, a3[i * 4]);
  }
  return `${label}: max ${mx.toFixed(2)} mean(t>.05) ${(sum / cnt).toFixed(2)} area(t>.25) ${area * 4} mass ${(mass * 4).toFixed(0)} wet.max ${wm.toFixed(2)}`;
};
D.run = async (opts, times) => {
  const A = window.HPApp, E = A.engine; E.clear(); E.history = []; Object.assign(E, opts || {});
  const K = 5; let u = 0, prev = [150, 360];
  const weights = u => { const t = (K - 1) - Math.abs(u - (K - 1)); const w = [0, 1, 2, 3, 4].map(i => Math.pow(Math.max(0, Math.min(1, 1 - Math.abs(i - t) / 1.35)), 1.4)); const m = Math.max(...w) + 1e-6; return w.map(x => x / m); };
  for (let i = 1; i < 60; i++) {
    const p = [150 + i * 16, 360 + 110 * Math.sin(i / 9)]; u = (u + 16 / 330) % 8;
    E.paint(prev, p, { layer: 0, radius: 40, weights: weights(u), amount: 0.45 * (0.12 + Math.min(Math.hypot(p[0] - prev[0], p[1] - prev[1]) / 80, 1.2)), softness: 0.4, palette: 0, solid: null });
    prev = p; await new Promise(r => setTimeout(r, 33));
  }
  A.S.noPhys = true; const iv = setInterval(() => E.step(1.36), 1000 / 22);
  const out = [], t0 = performance.now();
  for (const s of (times || [0, 3, 12])) { while ((performance.now() - t0) / 1000 < s) await new Promise(r => setTimeout(r, 30)); out.push(D.stats(String(s).padStart(2) + 's')); }
  clearInterval(iv); A.S.noPhys = false;
  return out.join('\n');
};
})(window.HP);
