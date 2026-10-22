/* Hand tracking for the web app: MediaPipe hand landmarks -> finger count + painting fingertip, plus the same
 * pen / brush-size logic as the Python app, a synthetic "demo hand" and a PaintSource (which pigments the brush carries). */
(function (HP) {
'use strict';

HP.SAFE_MARGIN = 0.12;      // how far in from the camera picture's edge the drawing area starts (the "safe zone")
const MP_VERSION = '0.10.14';
const MP_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + MP_VERSION;
const MP_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

class OneEuro {
  constructor(minCutoff, beta, dCutoff) { this.minCutoff = minCutoff || 2.2; this.beta = beta || 28; this.dCutoff = dCutoff || 1; this.reset(); }
  reset() { this.x = null; this.dx = [0, 0]; }
  static alpha(cutoff, dt) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
  call(v, dt) {
    dt = Math.max(dt, 1e-3);
    if (!this.x) { this.x = v.slice(); return this.x; }
    const dx = [(v[0] - this.x[0]) / dt, (v[1] - this.x[1]) / dt];
    const ad = OneEuro.alpha(this.dCutoff, dt);
    this.dx = [ad * dx[0] + (1 - ad) * this.dx[0], ad * dx[1] + (1 - ad) * this.dx[1]];
    const cutoff = this.minCutoff + this.beta * Math.hypot(this.dx[0], this.dx[1]);
    const a = OneEuro.alpha(cutoff, dt);
    this.x = [a * v[0] + (1 - a) * this.x[0], a * v[1] + (1 - a) * this.x[1]];
    return this.x;
  }
}

const JOINTS = [[5, 6, 8], [9, 10, 12], [13, 14, 16], [17, 18, 20]];   // (knuckle, middle joint, tip) of index..pinky
const CONNECTIONS = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13],
  [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];

class HandTracker {
  constructor() { this.lm = null; this.ready = false; this.error = null; this.state = {}; this.camAspect = 16 / 9; this.canvasAspect = 16 / 9; this.margin = HP.SAFE_MARGIN; }
  async load() {
    const vision = await import(MP_BASE + '/vision_bundle.mjs');
    const files = await vision.FilesetResolver.forVisionTasks(MP_BASE + '/wasm');
    const opts = d => ({ baseOptions: { modelAssetPath: MP_MODEL, delegate: d }, runningMode: 'VIDEO', numHands: 2,
      minHandDetectionConfidence: 0.6, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5 });
    try { this.lm = await vision.HandLandmarker.createFromOptions(files, opts('GPU')); }
    catch (e) { this.lm = await vision.HandLandmarker.createFromOptions(files, opts('CPU')); }
    this.ready = true;
  }
  setAspects(cam, canvas) { this.camAspect = cam; this.canvasAspect = canvas; }
  toCanvas(x, y) {   // camera-normalised (already mirrored) -> canvas-normalised, using the central area
    const cam = this.camAspect, can = this.canvasAspect;
    const fx = cam < can ? 1 : can / cam, fy = cam < can ? cam / can : 1;
    const cx = (x - (1 - fx) / 2) / fx, cy = (y - (1 - fy) / 2) / fy, m = this.margin;
    return [(cx - m) / (1 - 2 * m), (cy - m) / (1 - 2 * m)];
  }
  /** frame: a canvas holding the MIRRORED camera picture. -> {Right, Left} each null or {tip, fingers, pts} */
  detect(frame, ts) {
    const out = { Right: null, Left: null };
    if (!this.ready) return out;
    const res = this.lm.detectForVideo(frame, ts);
    const best = {};
    (res.landmarks || []).forEach((lms, i) => {
      const cls0 = res.handednesses[i][0];
      // MediaPipe's web labels come out the opposite way round to the Python app's for the same mirrored picture:
      // the label names the hand as seen in the (mirrored) image, so swap to get the user's own right and left hand
      const cls = { categoryName: cls0.categoryName === 'Left' ? 'Right' : 'Left', score: cls0.score };
      if (!(cls.categoryName in out) || cls.score <= (best[cls.categoryName] || 0)) return;
      best[cls.categoryName] = cls.score;
      const pts = lms.map(p => [p.x, p.y]);
      const pts3 = lms.map(p => [p.x, p.y / this.camAspect, p.z]);
      const [fingers, tipId] = this.classify(pts, pts3, cls.categoryName);
      out[cls.categoryName] = { tip: this.toCanvas(pts[tipId][0], pts[tipId][1]), fingers, pts };
    });
    return out;
  }
  /** Fingers held up = straight fingers (3D, with hysteresis); the painting fingertip sticks to one finger. */
  classify(pts, pts3, label) {
    const st = this.state[label] || (this.state[label] = { ext: [false, false, false, false], tip: null });
    const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], (a[2] || 0) - (b[2] || 0));
    JOINTS.forEach(([m, p, t], i) => {
      const s = d(pts3[t], pts3[m]) / (d(pts3[p], pts3[m]) + d(pts3[t], pts3[p]) + 1e-6);
      const farther = d(pts3[t], pts3[0]) > 0.95 * d(pts3[p], pts3[0]);
      st.ext[i] = st.ext[i] ? (s > 0.70 && farther) : (s > 0.84 && farther);
    });
    const n = st.ext.filter(Boolean).length;
    const thumb = d(pts[4], pts[17]) > 1.12 * d(pts[3], pts[17]);   // only decides 4 fingers vs an open palm
    const fingers = n === 4 && thumb ? 5 : n;
    if (st.tip === null || !st.ext[st.tip]) { const f = st.ext.findIndex(Boolean); st.tip = f < 0 ? null : f; }
    return [fingers, st.tip === null ? 8 : JOINTS[st.tip][2]];
  }
}

/** Pen up/down, finger-count brush size and smoothing for one hand.  update() returns the stroke segment to draw. */
class HandCtl {
  constructor() { this.filter = new OneEuro(); this.reset(); }
  reset() {
    this.pen = false; this.penVotes = 0; this.prev = null; this.radius = 24; this.speed = 0; this.lost = 0;
    this.level = 2; this.levelVotes = 0; this.fingers = 0; this.cursor = null; this.camPts = null; this.seen = false;
    this.justDown = false; this.filter.reset();
  }
  /** hand: {tip, fingers, pts} or null; W,H canvas px; sc canvas scale. -> {from, to, radius, dist} | null */
  update(hand, dt, W, H, sc) {
    let want = false, p = null;
    this.justDown = false;
    if (hand) {
      this.lost = 0;
      const pos = this.filter.call(hand.tip, dt);
      this.fingers = hand.fingers; this.camPts = hand.pts;
      const inside = pos[0] >= 0 && pos[0] <= 1 && pos[1] >= 0 && pos[1] <= 1;   // outside the safe zone: no brush at all
      if (inside) {
        p = [Math.min(Math.max(pos[0] * W, 0), W - 1), Math.min(Math.max(pos[1] * H, 0), H - 1)];
        this.cursor = p;
        want = this.fingers >= 1;                     // a fist lifts the brush
      } else { this.cursor = null; this.prev = null; }
      const cand = Math.min(Math.max(this.fingers, 1), 5) - 1;
      if (cand !== this.level) { if (++this.levelVotes >= 3) { this.level = cand; this.levelVotes = 0; } } else this.levelVotes = 0;
    } else {
      this.lost++; this.camPts = null;
      if (this.lost > 4) this.cursor = null;
    }
    this.seen = !!hand;
    if (want !== this.pen) {
      if (++this.penVotes >= (want ? 2 : 3)) { this.pen = want; this.penVotes = 0; this.prev = null; this.justDown = want; }
    } else this.penVotes = 0;
    if (!hand && this.lost > 4) { this.pen = false; this.prev = null; this.filter.reset(); }
    if (!(this.pen && p)) return null;
    if (!this.prev) this.prev = p;
    const dist = Math.hypot(p[0] - this.prev[0], p[1] - this.prev[1]);
    this.speed = 0.6 * this.speed + 0.4 * (dist / Math.max(dt, 1e-3));
    const fast = Math.min(this.speed / (1400 * sc), 1);
    const target = 25 * sc * (0.3 + 2.5 * this.level / 4) * (1.12 - 0.3 * fast);
    this.radius = 0.8 * this.radius + 0.2 * target;
    const seg = { from: this.prev, to: p, radius: this.radius, dist };
    this.prev = p;
    return seg;
  }
}

/** Which pigments the brush carries as the hand travels (a phase ping-ponging along the five pigments). */
class PaintSource {
  constructor() { this.span = 8; this.u = Math.random() * this.span; this.pace = 1; }
  newStroke() { this.u = Math.random() * this.span; this.pace = 0.7 + Math.random() * 0.7; }
  advance(dist, sc) { this.u = (this.u + this.pace * dist / (330 * sc)) % this.span; }
  weights() {
    const t = 4 - Math.abs(this.u - 4);
    const w = [0, 1, 2, 3, 4].map(i => Math.pow(Math.max(0, Math.min(1, 1 - Math.abs(i - t) / 1.35)), 1.4));
    const m = Math.max(...w) + 1e-6;
    return w.map(x => x / m);
  }
}

/** A synthetic hand for trying the app without a camera. */
class DemoHand {
  constructor(seed) {
    this.t = 0; this.strokeT = 0; this.down = true; this.seed = seed || 1;
    this.ph = [0, 1, 2, 3].map(i => (i * 1.7 + this.seed * 2.3) % 6); this.pos = [0.4 + 0.1 * this.seed, 0.5];
  }
  update(dt) {
    this.t += dt; this.strokeT += dt;
    if (this.down && this.strokeT > 6) { this.down = false; this.strokeT = 0; }
    else if (!this.down && this.strokeT > 0.8) {
      this.down = true; this.strokeT = 0; this.ph = this.ph.map(() => Math.random() * 6); this.pos = [0.2 + Math.random() * 0.6, 0.2 + Math.random() * 0.6];
    }
    const s = this.strokeT, ph = this.ph;
    this.pos = [this.pos[0] + dt * (0.22 * Math.cos(1.3 * s + ph[0]) + 0.1 * Math.cos(2.9 * s + ph[2])),
      this.pos[1] + dt * (0.22 * Math.sin(1.1 * s + ph[1]) + 0.1 * Math.sin(2.3 * s + ph[3]))];
    this.pos = this.pos.map(v => Math.min(0.96, Math.max(0.04, v)));
    return { tip: this.pos.slice(), fingers: this.down ? 1 + Math.floor(this.t / 5) % 5 : 0, pts: null };
  }
}

HP.OneEuro = OneEuro; HP.HandTracker = HandTracker; HP.HandCtl = HandCtl; HP.PaintSource = PaintSource; HP.DemoHand = DemoHand;
HP.CONNECTIONS = CONNECTIONS;
})(window.HP = window.HP || {});
