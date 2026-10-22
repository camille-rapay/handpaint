/* GLSL for the HandPaint web engine.  Every paint surface ("layer") is four RGBA16F textures at simulation size:
 *   T0 = pigments 0-3          T1 = (pigment 4, qm, vm, zm)    qm / vm / zm = palette share, colour-set id and dither size,
 *   T2 = solid paint (r*c, g*c, b*c, c)      T3 = (wet, damp, top, m)    each weighted by the mass m, and all of them diffusing
 *                                                                        together, so qm/m, vm/m, zm/m stay meaningful as paint bleeds
 * Canvas pixel coordinates are y-down (like the Python app); texture space is y-up, hence the flips below. */
(function (HP) {
'use strict';

const HEAD = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform vec2 uCanvas;          // logical canvas size in px (e.g. 1280x720)
vec2 canvasPos(vec2 uv) { return vec2(uv.x * uCanvas.x, (1.0 - uv.y) * uCanvas.y); }
const vec4 STR = vec4(1.00, 0.85, 0.95, 1.00);
const float STR4 = 0.80;
float erf_(float x) {                      // Abramowitz & Stegun 7.1.26
  float s = sign(x); x = abs(x);
  float t = 1.0 / (1.0 + 0.3275911 * x);
  float y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-x * x);
  return s * y;
}
float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}
// a hard-edged line of half-width R, blurred by a gaussian of sigma: the profile across it
float strip(float d, float R, float sigma) {
  float s = max(sigma, 0.05) * 1.41421356;
  return 0.5 * (erf_((R - d) / s) + erf_((R + d) / s));
}
`;

const VERT = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// ---------------------------------------------------------------------------------------------------- brush
const PAINT = HEAD + `
in vec2 vUv;
uniform sampler2D uT0, uT1, uT2, uT3, uNoise;
uniform vec2 uA, uB;           // segment, canvas px
uniform float uR, uSoft, uAmount, uWf;
uniform vec4 uW0; uniform float uW4;   // pigment weights
uniform float uPalette, uVer, uSize;
uniform vec4 uSolid;           // rgb * m, m
uniform float uIsPig, uIsSolid;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
layout(location = 2) out vec4 o2;
layout(location = 3) out vec4 o3;
void main() {
  vec4 t0 = texture(uT0, vUv), t1 = texture(uT1, vUv), t2 = texture(uT2, vUv), t3 = texture(uT3, vUv);
  vec2 p = canvasPos(vUv);
  float d = segDist(p, uA, uB);
  float sig = (0.10 + 0.40 * uSoft) * uR + 0.6 + 2.5 * uSoft;
  float cf = 0.6 * (1.0 - 0.35 * uSoft);
  float water = strip(d, uR, sig);
  float shapeCore = strip(d, uR * cf, sig);
  float fib = 1.0 + 0.55 * (texture(uNoise, p / vec2(300.0, 170.0)).r - 0.5) * 2.0;
  fib = clamp(fib, 0.15, 2.4);
  float core = shapeCore * ((0.78 + 0.22 * fib) * uAmount / cf);
  float cover = clamp(shapeCore * 1.6, 0.0, 1.0);
  // water
  t3.r = max(t3.r, water * uWf);
  t3.g = max(t3.g, water * uWf);
  t3.b += (uIsSolid - t3.b) * cover;      // which kind of paint was laid last: 1 = solid on top
  if (uIsPig > 0.5) {
    t0 = min(t0 + core * uW0 * STR, vec4(2.2));
    t1.r = min(t1.r + core * uW4 * STR4, 2.2);
  }
  if (uIsSolid > 0.5) {
    float conc = t2.a;
    float dep = core * uSolid.a;
    dep = min(conc + dep, 2.2) - conc;
    vec3 newCol = uSolid.rgb / max(uSolid.a, 1e-5);
    vec3 oldCol = conc > 1e-3 ? t2.rgb / max(conc, 1e-4) : newCol;
    float take = 1.0 - exp(-3.6 * dep);
    vec3 mixed = oldCol * (1.0 - take) + newCol * take;
    float total = conc + dep;
    t2 = vec4(mixed * total, total);
  }
  float mass = dot(t0, STR) + t1.r * STR4 + t2.a;
  t3.a += (mass - t3.a) * cover;
  if (uIsPig > 0.5) {
    t1.g += (uPalette * mass - t1.g) * cover;
    if (uPalette > 0.5) t1.b += (uVer * mass - t1.b) * cover;
  }
  if (uSize > 0.5) t1.a += (uSize * mass - t1.a) * cover;
  o0 = t0; o1 = t1; o2 = t2; o3 = t3;
}`;

// ---------------------------------------------------------------------------------------------------- per-stroke style
// One texture per layer remembering the settings (colour steps, colour bands, bleed, bleed duration) each stroke was
// painted with, so changing a slider later only affects future strokes.  r = 0 means "no stroke here".
const STYLE = HEAD + `
in vec2 vUv;
uniform sampler2D uSt;
uniform vec2 uA, uB;
uniform float uR, uSoft;
uniform vec4 uVals;
out vec4 o;
void main() {
  vec4 st = texture(uSt, vUv);
  float d = segDist(canvasPos(vUv), uA, uB);
  float reach = uR * 1.3 + 14.0;                                  // a bit wider than the brush: paint bleeds and flows outward
  float cover = clamp(strip(d, reach * 0.8, reach * 0.25) * 1.6, 0.0, 1.0);
  float core = clamp(strip(d, uR * 0.6, 0.1 * uR + 2.0) * 1.6, 0.0, 1.0);   // the stroke's own body takes the new look fully
  if (cover > 0.02) st = st.r < 0.5 ? uVals : mix(st, uVals, max(core, st.r < 0.5 ? 1.0 : 0.35 * cover));
  o = st;
}`;

// ---------------------------------------------------------------------------------------------------- smudge / erase
const SMUDGE = HEAD + `
in vec2 vUv;
uniform sampler2D uT0, uT1, uT2, uT3;       // this layer
uniform sampler2D uO0, uO1, uO2, uO3;       // the other layer (its paint is picked up too)
uniform vec2 uA, uB;
uniform float uR, uSoft, uStrength, uRole;  // role 0: target (receives the smear), 1: source (loses what is picked up)
uniform float uSize;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
layout(location = 2) out vec4 o2;
layout(location = 3) out vec4 o3;
void main() {
  vec4 a0 = texture(uT0, vUv), a1 = texture(uT1, vUv), a2 = texture(uT2, vUv), a3 = texture(uT3, vUv);
  float sig = (0.12 + 0.4 * uSoft) * uR + 0.6;
  float w = strip(segDist(canvasPos(vUv), uA, uB), uR, sig) * uStrength;
  vec2 v = uB - uA;                         // content moves with the finger: new(x) = old(x - v)
  vec2 src = vUv - vec2(v.x / uCanvas.x, -v.y / uCanvas.y);
  if (uRole < 0.5) {
    vec4 m0 = texture(uT0, src) + texture(uO0, src);
    vec4 m1 = texture(uT1, src) + texture(uO1, src);
    vec4 m2 = texture(uT2, src) + texture(uO2, src);
    a0 = max(a0 + (m0 - a0) * w, 0.0);
    a1 = max(a1 + (m1 - a1) * w, 0.0);
    a2 = max(a2 + (m2 - a2) * w, 0.0);
    vec4 s3 = texture(uT3, src);
    a3.b += (s3.b - a3.b) * w;
    a3.a = max(a3.a + ((s3.a + texture(uO3, src).a) - a3.a) * w, 0.0);   // mass moves with the paint
    if (uSize > 0.5 && w > 0.3) a1.a = uSize * a3.a;   // the smear itself is dithered at the current size
  } else {
    a0 *= (1.0 - w); a1 *= (1.0 - w); a2 *= (1.0 - w); a3.a *= (1.0 - w);
  }
  o0 = a0; o1 = a1; o2 = a2; o3 = a3;
}`;

const ERASE = HEAD + `
in vec2 vUv;
uniform sampler2D uT0, uT1, uT2, uT3;
uniform vec2 uA, uB;
uniform float uR, uSoft;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
layout(location = 2) out vec4 o2;
layout(location = 3) out vec4 o3;
void main() {
  vec4 a0 = texture(uT0, vUv), a1 = texture(uT1, vUv), a2 = texture(uT2, vUv), a3 = texture(uT3, vUv);
  float sig = (0.12 + 0.4 * uSoft) * uR + 0.6;
  float k = 1.0 - clamp(strip(segDist(canvasPos(vUv), uA, uB), uR, sig) * 1.8, 0.0, 1.0);
  a3.ga *= k;
  a3.r = a3.r * k - 0.6 * (1.0 - k);        // rubbed-out paper is locked dry (negative wetness) so neighbouring paint can't bleed back in
  o0 = a0 * k; o1 = a1 * k; o2 = a2 * k; o3 = a3;
}`;

// which layer is on top where a stroke lands (1 = dithered layer, 0 = smooth layer)
const ORDER = HEAD + `
in vec2 vUv;
uniform sampler2D uOrd;
uniform vec2 uA, uB;
uniform float uR, uSoft, uValue;
out vec4 o;
void main() {
  float sig = (0.10 + 0.40 * uSoft) * uR + 0.6 + 2.5 * uSoft;
  float cf = 0.6 * (1.0 - 0.35 * uSoft);
  float cover = clamp(strip(segDist(canvasPos(vUv), uA, uB), uR * cf, sig) * 1.6, 0.0, 1.0);
  float cur = texture(uOrd, vUv).r;
  o = vec4(cur + (uValue - cur) * cover, 0.0, 0.0, 1.0);
}`;

const COPY = HEAD + `
in vec2 vUv;
uniform sampler2D uT0, uT1, uT2, uT3;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
layout(location = 2) out vec4 o2;
layout(location = 3) out vec4 o3;
void main() { o0 = texture(uT0, vUv); o1 = texture(uT1, vUv); o2 = texture(uT2, vUv); o3 = texture(uT3, vUv); }`;

const COPY1 = HEAD + `
in vec2 vUv;
uniform sampler2D uT;
out vec4 o;
void main() { o = texture(uT, vUv); }`;

// ---------------------------------------------------------------------------------------------------- physics
// (1) shrink the fields to a quarter size, once weighted by the wet mask and once plain
const PREP = HEAD + `
in vec2 vUv;
uniform sampler2D uT0, uT1, uT2, uT3;
uniform float uMasked;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
layout(location = 2) out vec4 o2;
layout(location = 3) out vec4 o3;
void main() {
  vec4 t0 = texture(uT0, vUv), t1 = texture(uT1, vUv), t2 = texture(uT2, vUv), t3 = texture(uT3, vUv);
  if (uMasked > 0.5) {
    float m = clamp((t3.r - 0.05) / 0.2, 0.0, 1.0);
    o0 = t0 * m; o1 = t1 * m; o2 = t2 * m; o3 = vec4(m, t3.a * m, 0.0, 0.0);
  } else {
    o0 = t0; o1 = t1; o2 = t2; o3 = vec4(t3.r, t3.g, t3.a, 0.0);
  }
}`;

// (2) separable gaussian, each of the 16 channels with its own sigma (in texels of this texture)
const BLUR = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uI0, uI1, uI2, uI3;
uniform vec2 uStep;                 // one texel along the blur direction, in uv
uniform vec4 uS0, uS1, uS2, uS3;    // sigmas per channel
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
layout(location = 2) out vec4 o2;
layout(location = 3) out vec4 o3;
void main() {
  vec4 a0 = vec4(0), a1 = vec4(0), a2 = vec4(0), a3 = vec4(0);
  vec4 w0 = vec4(0), w1 = vec4(0), w2 = vec4(0), w3 = vec4(0);
  for (int i = -9; i <= 9; i++) {
    float x = float(i);
    vec4 k0 = exp(-x * x / (2.0 * max(uS0 * uS0, vec4(1e-3))));
    vec4 k1 = exp(-x * x / (2.0 * max(uS1 * uS1, vec4(1e-3))));
    vec4 k2 = exp(-x * x / (2.0 * max(uS2 * uS2, vec4(1e-3))));
    vec4 k3 = exp(-x * x / (2.0 * max(uS3 * uS3, vec4(1e-3))));
    vec2 uv = vUv + uStep * x;
    a0 += texture(uI0, uv) * k0; w0 += k0;
    a1 += texture(uI1, uv) * k1; w1 += k1;
    a2 += texture(uI2, uv) * k2; w2 += k2;
    a3 += texture(uI3, uv) * k3; w3 += k3;
  }
  o0 = a0 / w0; o1 = a1 / w1; o2 = a2 / w2; o3 = a3 / w3;
}`;

// (3) the bleed itself
const PHYS = HEAD + `
in vec2 vUv;
uniform sampler2D uT0, uT1, uT2, uT3;       // current fields
uniform sampler2D uM0, uM1, uM2, uM3;       // blurred, weighted by the wet mask (M3.r = blurred mask, M3.g = blurred mass)
uniform sampler2D uU0, uU1, uU2, uU3;       // blurred, plain (U3 = blurred wet, damp, mass)
uniform sampler2D uNoise, uSt;
uniform vec2 uTexel;                        // one sim texel in uv
uniform vec2 uMidTexel;                     // one blurred-texture texel in uv
uniform float uDts, uBleed, uDecay, uFront, uFlow, uSlow;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
layout(location = 2) out vec4 o2;
layout(location = 3) out vec4 o3;
void main() {
  vec4 t0 = texture(uT0, vUv), t1 = texture(uT1, vUv), t2 = texture(uT2, vUv), t3 = texture(uT3, vUv);
  vec4 b0 = t0, b1 = t1, b2 = t2, b3 = t3;
  vec2 p = canvasPos(vUv);
  float wet = t3.r, damp = t3.g;
  float mask = clamp((wet - 0.05) / 0.2, 0.0, 1.0);
  vec4 nz = texture(uNoise, p / vec2(300.0, 170.0));
  float fib = clamp(1.0 + 1.1 * (nz.r - 0.5), 0.15, 2.4);
  float adv = clamp(1.0 + 1.8 * (nz.g - 0.5), 0.0, 3.0);
  float rate = clamp(0.78 * uDts * mask * fib, 0.0, 0.9);
  vec4 m3 = texture(uM3, vUv);
  float den = m3.r + 1e-4;
  // the two low-mobility pigments (sienna, indigo) spread by only ~1 texel: blurred right here at full simulation resolution
  vec4 loc0 = vec4(0.0), loc1 = vec4(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    float k = (i == 0 ? 2.0 : 1.0) * (j == 0 ? 2.0 : 1.0) / 16.0;
    vec2 q = vUv + vec2(float(i), float(j)) * uTexel;
    loc0 += texture(uT0, q) * k; loc1 += texture(uT1, q) * k;
  }
  // fast bleed: diffusion through the wet paper only
  vec4 f0 = texture(uM0, vUv) / den, f1 = texture(uM1, vUv) / den;
  f0.g = loc0.g; f1.r = loc1.r;
  t0 += rate * (f0 - b0);
  t1 += rate * (f1 - b1);
  t2 += rate * (texture(uM2, vUv) / den - b2);
  t3.a += rate * (m3.g / den - b3.a);
  // slow, endless bleed: follows the spread-out moisture, no wet-edge pinning
  vec4 u3 = texture(uU3, vUv);
  vec4 stl = texture(uSt, vUv);
  float bleedHere = stl.r > 0.5 ? stl.b : uBleed;
  float rs = clamp(0.10 * uSlow * bleedHere * uDts * u3.g * clamp(damp * 5.0, 0.0, 1.0) * (1.0 - 0.85 * clamp(wet * 2.0, 0.0, 1.0)), 0.0, 0.5);   // (only where the paper is damp itself, so rubbed-out paint stays gone)
  vec4 s0 = texture(uU0, vUv), s1 = texture(uU1, vUv);
  s0.g = loc0.g; s1.r = loc1.r;
  t0 += rs * (s0 - b0);
  t1 += rs * (s1 - b1);
  t2 += rs * (texture(uU2, vUv) - b2);
  t3.a += rs * (u3.b - b3.a);
  // outward flow down the wetness gradient, broken up by noise: feathered edges and a bit of extra reach
  float gx = texture(uU3, vUv + vec2(uMidTexel.x, 0.0)).r - texture(uU3, vUv - vec2(uMidTexel.x, 0.0)).r;
  float gy = texture(uU3, vUv + vec2(0.0, uMidTexel.y)).r - texture(uU3, vUv - vec2(0.0, uMidTexel.y)).r;
  vec2 g = vec2(gx / (2.0 * uMidTexel.x * uCanvas.x), gy / (2.0 * uMidTexel.y * uCanvas.y));   // wetness per canvas px (x right, y up)
  vec2 disp = g * (uFlow * uDts * adv * mask);
  float lim = 6.0;
  disp = clamp(disp, vec2(-lim), vec2(lim));
  vec2 duv = disp / uCanvas;
  t0 += (texture(uT0, vUv + duv) - b0) * vec4(0.55, 0.30, 1.00, 0.85);
  t1 += (texture(uT1, vUv + duv) - b1) * vec4(0.20, 0.5, 0.5, 0.5);
  t2 += (texture(uT2, vUv + duv) - b2) * 0.5;
  t3.a += (texture(uT3, vUv + duv).a - b3.a) * 0.5;
  t0 = clamp(t0, 0.0, 2.2); t1 = max(t1, 0.0); t1.r = min(t1.r, 2.2); t2 = max(t2, 0.0); t3.a = max(t3.a, 0.0);
  // water creeps out from the brush (unevenly) and then evaporates
  float fr = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) fr = max(fr, texture(uT3, vUv + vec2(float(i), float(j)) * uTexel * 0.5).r);
  float front = fr * (uFront + 0.034 * clamp(0.6 + 0.3 * (nz.b - 0.5) * 2.0, 0.0, 1.0));
  float dried = wet - 0.0028 * uDts * (1.0 + 0.35 * (nz.b - 0.5) * 2.0);
  float nw = max(dried, front - 0.0015 * uDts);
  if (nw < 0.004) nw = 0.0;
  if (wet < 0.0) nw = min(wet + 0.0015 * uDts, 0.0);   // locked dry by the eraser: stays dry for a good while
  float nd = (damp * 0.985 + u3.g * 0.015) * (stl.r > 0.5 ? exp(-uDts / (stl.a * 30.0)) : uDecay);   // (the moisture itself spreads slowly)
  if (nd < 0.004) nd = 0.0;
  o0 = t0; o1 = t1; o2 = t2; o3 = vec4(nw, nd, t3.b, t3.a);
}`;

// ---------------------------------------------------------------------------------------------------- render
const RENDER = HEAD + `
in vec2 vUv;
vec2 UV;                                    // UV, flipped when uFlip is set (frames read back top-down)
uniform sampler2D uD0, uD1, uD2, uD3;       // dithered layer
uniform sampler2D uS0, uS1, uS2, uS3;       // smooth layer
uniform sampler2D uOrd, uLut, uStD, uStS;
uniform float uLevels, uBand, uDefaultSize, uDitherOn;   // uDitherOn: bit 0 = draw the dithered layer, bit 1 = the smooth one
uniform float uBlockScale;                  // canvas px -> output px, so exports get proportionally bigger blocks
uniform vec4 uBg;                           // page background: rgb, alpha
uniform float uChecker;                     // 1 = show a checkerboard where the background is transparent (screen only)
uniform float uOutAlpha;                    // 0 = flatten over the background, 1 = keep alpha (premultiplied), 2 = straight RGBA, 3 = straight colour only, 4 = alpha as a grey picture
uniform float uFlip;
uniform vec2 uOutSize;
out vec4 outColor;

const float BAYER[64] = float[64](
   0.,32., 8.,40., 2.,34.,10.,42.,   48.,16.,56.,24.,50.,18.,58.,26.,
  12.,44., 4.,36.,14.,46., 6.,38.,   60.,28.,52.,20.,62.,30.,54.,22.,
   3.,35.,11.,43., 1.,33., 9.,41.,   51.,19.,59.,27.,49.,17.,57.,25.,
  15.,47., 7.,39.,13.,45., 5.,37.,   63.,31.,55.,23.,61.,29.,53.,21.);
float bayer(vec2 cell, vec2 off) {
  ivec2 c = ivec2(mod(cell + off, 8.0));
  return (BAYER[c.y * 8 + c.x] + 0.5) / 64.0;
}
const vec4 OFF0A = vec4(-0.06, 0.06, 0.20, 0.52); const float OFF0B = 0.74;   // spectrum
const vec4 OFF1A = vec4(0.27, 0.10, 0.0, 0.38);   const float OFF1B = 0.48;   // multicolor
float thickCap(float t) { return t / sqrt(1.0 + (t / 3.0) * (t / 3.0)); }

// returns premultiplied colour + alpha of one layer
vec4 layer(sampler2D T0, sampler2D T1, sampler2D T2, sampler2D T3, sampler2D ST, bool dith) {
  vec4 p = texture(T0, UV), q = texture(T1, UV), s = texture(T2, UV), m = texture(T3, UV);
  vec4 stl = texture(ST, UV);
  float levels = stl.r > 0.5 ? stl.r : uLevels, band = stl.r > 0.5 ? stl.g : uBand;   // each stroke keeps the settings it was painted with
  vec2 cp = canvasPos(UV);
  float t = dot(p, STR) + q.r * STR4;
  float mm = max(m.a, 1e-3);
  float sz = uDefaultSize;
  if (dith && m.a > 0.02) sz = clamp(floor(q.a / mm + 0.5), 1.0, 8.0);
  // (a stroke's own block size; the output may be a bigger rendering of the same canvas, so blocks scale with it)
  vec2 cell = floor(cp / sz);
  float thr = dith ? bayer(cell, vec2(0.0)) : 0.5;
  float thr2 = dith ? bayer(cell, vec2(3.0, 5.0)) : 0.0;
  vec4 rcol = vec4(0.0); float ar = 0.0;
  if (t > 1e-3) {
    float tm = max(t, 1e-3);
    bool multi = q.g / mm > 0.5;
    float ver = clamp(floor(q.b / mm + 0.5), 0.0, 11.0);
    float n0 = dot(p, STR * OFF0A) + q.r * STR4 * OFF0B;
    float n1 = dot(p, STR * OFF1A) + q.r * STR4 * OFF1B;
    float u = (multi ? n1 : n0) / tm + band * thickCap(t);
    float f = u - floor(u);
    float pp = multi ? 1.0 - abs(2.0 * f - 1.0) : f;
    float qv = dith ? floor(pp * levels + thr) / levels : pp;
    float idx = multi ? floor(clamp(qv, 0.0, 1.0) * 255.0 + 0.5) : mod(floor(qv * 256.0), 256.0);
    float row = multi ? 1.0 + ver : 0.0;
    rcol = texelFetch(uLut, ivec2(int(idx), int(row)), 0);
    float cov = clamp((t - 0.03) / 0.22, 0.0, 1.0);
    ar = dith ? step(thr2 + 1e-6, cov) : cov;
  }
  float conc = s.a;
  vec4 scol = vec4(0.0); float as = 0.0;
  if (conc > 1e-4) {
    as = 1.0 - exp(-3.6 * conc);
    scol = vec4(clamp(s.rgb / conc, 0.0, 1.0), 1.0);
    if (dith) as = step(thr2 + 1e-6, as);
  }
  float top = m.b;
  vec3 prem; float a;
  if (dith) {
    bool useS = as > 0.0 && (top > 0.5 || ar <= 0.0);
    bool useR = ar > 0.0 && !useS;
    prem = useS ? scol.rgb : (useR ? rcol.rgb : vec3(0.0));
    a = (useS || useR) ? 1.0 : 0.0;
    prem *= a;
  } else {
    vec3 pr = rcol.rgb * ar, ps = scol.rgb * as;
    float tw = clamp(top, 0.0, 1.0);
    vec3 sOver = ps + pr * (1.0 - as), rOver = pr + ps * (1.0 - ar);
    float aSOver = as + ar * (1.0 - as), aROver = ar + as * (1.0 - ar);
    prem = mix(rOver, sOver, tw);
    a = mix(aROver, aSOver, tw);
  }
  return vec4(prem, a);
}

void main() {
  UV = uFlip > 0.5 ? vec2(vUv.x, 1.0 - vUv.y) : vUv;
  vec4 D = (mod(uDitherOn, 2.0) > 0.5) ? layer(uD0, uD1, uD2, uD3, uStD, true) : vec4(0.0);
  vec4 S = (uDitherOn > 1.5) ? layer(uS0, uS1, uS2, uS3, uStS, false) : vec4(0.0);
  float ord = texture(uOrd, UV).r;
  vec4 on = D + S * (1.0 - D.a);      // dithered layer over the smooth one
  vec4 off = S + D * (1.0 - S.a);     // smooth layer over the dithered one
  vec4 c = mix(off, on, clamp(ord, 0.0, 1.0));
  if (uOutAlpha > 0.5) {              // export: paint over the (maybe transparent) background, premultiplied
    vec4 bg = vec4(uBg.rgb * uBg.a, uBg.a);
    outColor = c + bg * (1.0 - c.a);
    if (uOutAlpha > 3.5) outColor = vec4(vec3(outColor.a), 1.0);                                                             // the matte (alpha as grey)
    else if (uOutAlpha > 2.5) outColor = vec4(outColor.a > 0.0 ? outColor.rgb / outColor.a : vec3(0.0), 1.0);                // straight colour, opaque
    else if (uOutAlpha > 1.5) outColor = vec4(outColor.a > 0.0 ? outColor.rgb / outColor.a : vec3(0.0), outColor.a);        // straight RGBA
  } else {
    vec3 under = uBg.rgb;
    if (uChecker > 0.5 && uBg.a < 0.999) {
      vec2 g = floor(canvasPos(UV) / 10.0);
      float chk = mod(g.x + g.y, 2.0) < 0.5 ? 1.0 : 0.84;
      under = vec3(chk) * (1.0 - uBg.a) + uBg.rgb * uBg.a;
    }
    outColor = vec4(c.rgb + under * (1.0 - c.a), 1.0);
  }
}`;

HP.shaders = { VERT, PAINT, SMUDGE, ERASE, ORDER, COPY, COPY1, PREP, BLUR, PHYS, RENDER, STYLE, HEAD };
})(window.HP = window.HP || {});
