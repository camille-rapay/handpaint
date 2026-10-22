/* HandPaint web app: layout, sidebar, input (camera hands, demo hands, mouse), recording and exports. */
(function (HP) {
'use strict';

const $ = s => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ASPECTS = [['1:1', 1, 1], ['4:3', 4, 3], ['16:9', 16, 9], ['3:4', 3, 4], ['9:16', 9, 16]];
const SIDEBAR_W = 300, LEFT_W = 290, THUMB_W = 256;
const HOTKEYS = [['Space', 'Record / stop'], ['V', 'Export video'], ['S', 'Export PNG'], ['C', 'Clear'], ['Z', 'Undo'],
  ['R', 'Rainbow / multicolor / solid'], ['E', 'Eraser'], ['P', 'Paint color'], ['B', 'Background'], ['F', 'Fullscreen']];
const CHEV = '<svg width="12" height="8" viewBox="0 0 12 8" fill="none"><path d="M1 1.5L6 6.5L11 1.5" stroke="#888A8C" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// ------------------------------------------------------------------------------------------------------ colour helpers
function hexToRgba(h) {
  h = h.trim().replace('#', '');
  if (h.length === 3 || h.length === 4) h = h.split('').map(c => c + c).join('');
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
}
const toHex2 = v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0').toUpperCase();
const rgbToHex = (r, g, b, a) => '#' + toHex2(r) + toHex2(g) + toHex2(b) + (a != null && a < 0.999 ? toHex2(a * 255) : '');
function hsvToRgb(h, s, v) {
  const f = n => { const k = (n + h * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5) * 255, f(3) * 255, f(1) * 255];
}
function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-6) { h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; if (h < 0) h += 1; }
  return [h, mx < 1e-6 ? 0 : d / mx, mx];
}

/** HSV square + hue bar + (optional) alpha bar + hex field. */
function makeColorEditor(onChange, withAlpha) {
  const root = el('div', 'ced');
  const sv = el('div', 'sv'), knob = el('div', 'knob'); sv.appendChild(knob);
  const hue = el('div', 'bar hue'), hueI = el('i'); hue.appendChild(hueI);
  const alpha = el('div', 'bar alpha'), alphaI = el('i'); alpha.appendChild(alphaI);
  const hexRow = el('label', 'hex'), input = el('input'), hint = el('span', '', withAlpha ? 'type #RRGGBBAA' : 'type #RRGGBB');
  input.spellcheck = false; input.maxLength = 9; hexRow.append(input, hint);
  root.append(sv, hue); if (withAlpha) root.appendChild(alpha); root.appendChild(hexRow);
  const S = { h: 0, s: 0, v: 1, a: 1 };
  const rgb = () => hsvToRgb(S.h, S.s, S.v);
  const hex = () => { const c = rgb(); return rgbToHex(c[0], c[1], c[2], withAlpha ? S.a : 1); };
  function paint(updateInput) {
    const c = rgb();
    sv.style.setProperty('--h', S.h * 360);
    knob.style.left = S.s * 100 + '%'; knob.style.top = (1 - S.v) * 100 + '%';
    hueI.style.left = S.h * 100 + '%'; alphaI.style.left = S.a * 100 + '%';
    alpha.style.setProperty('--c', rgbToHex(c[0], c[1], c[2]));
    if (updateInput) input.value = hex();
  }
  const emit = () => { paint(true); onChange(hex(), rgb(), S.a); };
  function drag(node, fn) {
    node.addEventListener('pointerdown', e => {
      node.setPointerCapture(e.pointerId);
      const go = ev => { const r = node.getBoundingClientRect(); fn(clamp((ev.clientX - r.left) / r.width, 0, 1), clamp((ev.clientY - r.top) / r.height, 0, 1)); emit(); };
      go(e);
      const mv = ev => go(ev), up = () => { node.removeEventListener('pointermove', mv); node.removeEventListener('pointerup', up); };
      node.addEventListener('pointermove', mv); node.addEventListener('pointerup', up);
    });
  }
  drag(sv, (x, y) => { S.s = x; S.v = 1 - y; });
  drag(hue, x => { S.h = x; });
  drag(alpha, x => { S.a = x; });
  input.addEventListener('input', () => {
    const v = hexToRgba(input.value.startsWith('#') ? input.value : '#' + input.value);
    if (v) { setRgba(v, false); onChange(hex(), rgb(), S.a); }
  });
  input.addEventListener('blur', () => { input.value = hex(); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === 'Escape') input.blur(); e.stopPropagation(); });
  function setRgba(v, updateInput) {
    const [h, s, vv] = rgbToHsv(v[0], v[1], v[2]);
    if (s > 1e-4 && vv > 1e-4) S.h = h;           // keep the hue when the colour is grey or black
    S.s = s; S.v = vv; S.a = withAlpha ? v[3] : 1;
    paint(updateInput);
  }
  return { el: root, set(hexStr) { const v = hexToRgba(hexStr); if (v) setRgba(v, true); }, hex, rgb, alpha: () => S.a };
}

// ------------------------------------------------------------------------------------------------------ app state
const ui = {};            // DOM references
const S = {
  mode: 0, lastPaintMode: 0,        // 0 rainbow, 1 multicolor, 2 solid, 3 eraser
  retro: true, aspectI: 2,
  softness: 0.4, load: 1.0, bleed: 1.0, tau: 60,
  solidHex: '#FF5CA8', bgHex: '#111111',
  panel: null,                      // 'aspect' | 'bg' | 'paint'
  multiSel: null, level: 2,
  source: 'mouse',                  // 'camera' | 'demo' | 'mouse'
};
let engine = null, tracker = null, video = null, camReady = false, side = false, thumbH = 144, dpr = 1;
const toasts = [];
const rightCtl = new HP.HandCtl(), leftCtl = new HP.HandCtl(), paintSrc = new HP.PaintSource();
const demoR = new HP.DemoHand(1), demoL = new HP.DemoHand(2);
const open = { r: false, l: false };
let depth = 0;
const rec = { mr: null, chunks: [], t0: 0, seconds: 0, active: false, blob: null, mime: '', exported: true, kind: 'video', converting: false, progress: 0, stage: '' };

function toast(msg, secs) {
  const t = { msg, until: performance.now() + (secs || 3.5) * 1000 };
  toasts.push(t);
  const node = el('div', 'toast'); node.textContent = msg; ui.toasts.appendChild(node);
  setTimeout(() => node.remove(), (secs || 3.5) * 1000);
  while (ui.toasts.children.length > 3) ui.toasts.firstChild.remove();
}

// ------------------------------------------------------------------------------------------------------ saving files
async function saveBlob(blob, name) {
  try {
    const dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null;   // when hosted as a Claude artifact
    if (dl) { await dl.save({ filename: name, data: blob }); return; }
  } catch (e) { /* fall through to a normal download */ }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 20000);
}
const stamp = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };

// ------------------------------------------------------------------------------------------------------ sidebar
const SLIDERS = [
  { id: 'dither', label: 'Dither size', min: 1, max: 8, step: 1, get: () => engine.ditherPx, set: v => { engine.ditherPx = v; }, fmt: v => v + 'px', when: () => S.retro },
  { id: 'levels', label: 'Color steps', min: 3, max: 32, step: 1, get: () => engine.levels, set: v => { engine.levels = v; }, fmt: v => String(v), when: () => S.retro },
  { id: 'band', label: 'Color bands', min: 0.1, max: 2, step: 0.01, get: () => engine.band, set: v => { engine.band = v; }, fmt: v => v.toFixed(2) },
  { id: 'soft', label: 'Edge softness', min: 0, max: 1, step: 0.01, get: () => S.softness, set: v => { S.softness = v; }, fmt: v => v.toFixed(2) },
  { id: 'load', label: 'Paint load', min: 0.3, max: 2.5, step: 0.1, get: () => S.load, set: v => { S.load = v; }, fmt: v => v.toFixed(1) + 'x' },
  { id: 'bleed', label: 'Bleed', min: 0, max: 3, step: 0.1, get: () => engine.bleed, set: v => { engine.bleed = v; }, fmt: v => v.toFixed(1) + 'x' },
  { id: 'tau', label: 'Bleed duration', min: 15, max: 180, step: 1, get: () => engine.tauSec, set: v => { engine.tauSec = v; }, fmt: v => v + 's' },
];

function card(id, title, value, swatch) {
  const b = el('button', 'card'); b.type = 'button'; b.id = id;
  b.innerHTML = (swatch ? '<span class="sw chk"></span>' : '') + `<span class="txt"><b>${title}</b><i>${value}</i></span>${CHEV}`;
  return b;
}

function buildSidebar() {
  const head = $('#sb-head'), sc = $('#sb-scroll');
  head.innerHTML = `<h1>HandPaint</h1><p class="sub">By Camille Rapay (and Claude) | v0.3 web</p>
    <div class="section">Export</div>
    <div class="col"><button id="btn-rec" class="btn primary" type="button">Start video recording</button>
    <div class="row"><button id="btn-video" class="btn" type="button" disabled>Export video</button><button id="btn-png" class="btn" type="button">Export PNG</button></div></div>`;
  sc.innerHTML = '';
  const sec = t => sc.appendChild(el('div', 'section', t));
  // canvas
  sec('Canvas');
  const col = sc.appendChild(el('div', 'col'));
  const r1 = col.appendChild(el('div', 'row'));
  r1.innerHTML = '<button id="btn-undo" class="btn tall" type="button" disabled>Undo</button><button id="btn-clear" class="btn tall" type="button">Clear</button>';
  ui.aspectCard = col.appendChild(card('aspect-card', 'Aspect Ratio', '16:9'));
  ui.aspectOpts = col.appendChild(el('div', 'opts')); ui.aspectOpts.hidden = true;
  ASPECTS.forEach((a, i) => { const b = el('button', 'btn', a[0]); b.type = 'button'; b.onclick = () => setAspect(i); ui.aspectOpts.appendChild(b); });
  ui.bgCard = col.appendChild(card('bg-card', 'Background', '#111111', true));
  ui.bgEd = makeColorEditor((hex, rgb, a) => { S.bgHex = hex; engine.bg = rgb.map(Math.round); engine.bgAlpha = a; refresh(); }, true);
  ui.bgEd.el.hidden = true; col.appendChild(ui.bgEd.el); ui.bgEd.set('#111111FF');
  // brush
  sec('Brush');
  const bcol = sc.appendChild(el('div', 'col'));
  ui.notes = bcol.appendChild(el('div', 'notes'));
  ui.sizes = bcol.appendChild(el('div', 'sizes'));
  ui.sizes.innerHTML = '<div class="set"></div><span class="lbl">Brush size</span>';
  [10, 13, 15, 18, 22].forEach((d, i) => {
    const one = el('div', 'one'); one.style.paddingBottom = '0';
    one.innerHTML = `<div class="dot" style="width:${d}px;height:${d}px;margin-bottom:${[8, 7, 6, 4, 2][i]}px"></div><span>${i + 1}</span>`;
    ui.sizes.firstChild.appendChild(one);
  });
  ui.modes = bcol.appendChild(el('div', 'seg'));
  ['Rainbow', 'Multicolor', 'Solid', 'Eraser'].forEach((t, i) => { const b = el('button', '', t); b.type = 'button'; b.onclick = () => setMode(i); ui.modes.appendChild(b); });
  ui.paintCard = bcol.appendChild(card('paint-card', 'Paint color', '#FF5CA8', true));
  ui.paintEd = makeColorEditor((hex) => { S.solidHex = hex; if (S.mode !== 2) setMode(2); refresh(); }, true);
  ui.paintEd.el.hidden = true; bcol.appendChild(ui.paintEd.el); ui.paintEd.set('#FF5CA8');
  ui.multi = bcol.appendChild(el('div', 'col'));
  ui.multi.innerHTML = '<div class="small">Click a color swatch to change it</div>';
  ui.chips = ui.multi.appendChild(el('div', 'chips'));
  ui.multiEd = makeColorEditor((hex, rgb) => { if (S.multiSel != null) { engine.setMultiColor(S.multiSel, rgb.map(Math.round)); refresh(); } }, false);
  ui.multiEd.el.hidden = true; ui.multi.appendChild(ui.multiEd.el);
  ui.multiReset = ui.multi.appendChild(el('button', 'btn', 'Reset to default')); ui.multiReset.type = 'button';
  ui.multiReset.onclick = () => { engine.resetMulti(); refresh(); };
  ui.eraserNote = bcol.appendChild(el('div', 'small', 'Eraser: rubs out paint from every layer, down to transparent'));
  // paint settings
  sec('Paint settings');
  const pcol = sc.appendChild(el('div', 'col'));
  ui.look = pcol.appendChild(el('div', 'pill'));
  ['Feathered', 'Dithered'].forEach((t, i) => { const b = el('button', '', t); b.type = 'button'; b.onclick = () => { S.retro = i === 1; refresh(); }; ui.look.appendChild(b); });
  ui.sliders = pcol.appendChild(el('div', 'sliders'));
  SLIDERS.forEach(sl => {
    const wrap = el('div', 'slider');
    wrap.innerHTML = `<div class="top"><span>${sl.label}</span><output></output></div><input type="range" id="sl-${sl.id}" min="${sl.min}" max="${sl.max}" step="${sl.step}">`;
    const inp = wrap.querySelector('input'), out = wrap.querySelector('output');
    inp.addEventListener('input', () => { sl.set(parseFloat(inp.value)); out.textContent = sl.fmt(sl.get()); inp.style.setProperty('--p', ((inp.value - sl.min) / (sl.max - sl.min) * 100) + '%'); });
    sl.wrap = wrap; sl.inp = inp; sl.out = out; sl.def = sl.get(); ui.sliders.appendChild(wrap);
  });
  const reset = pcol.appendChild(el('button', 'reset', 'Reset to defaults')); reset.type = 'button';
  reset.onclick = () => { SLIDERS.forEach(sl => sl.set(sl.def)); refresh(); };
  // events
  $('#btn-rec').onclick = toggleRecord; $('#btn-video').onclick = exportVideo; $('#btn-png').onclick = exportPNG;
  $('#btn-undo').onclick = undo; $('#btn-clear').onclick = clearCanvas;
  ui.aspectCard.onclick = () => togglePanel('aspect'); ui.bgCard.onclick = () => togglePanel('bg'); ui.paintCard.onclick = () => togglePanel('paint');
}

function swatchStyle(node, hex) { const v = hexToRgba(hex) || [0, 0, 0, 1]; node.style.setProperty('--c', `rgba(${Math.round(v[0])},${Math.round(v[1])},${Math.round(v[2])},${v[3]})`); }

function refresh() {
  if (!engine) return;
  const hasFootage = !!rec.blob && !rec.active;
  $('#btn-video').disabled = !hasFootage || rec.converting;
  $('#btn-video').textContent = hasFootage && rec.kind === 'mov' ? 'Export MOV' : hasFootage && rec.kind === 'webm-alpha' ? 'Export WebM' : 'Export video';
  $('#btn-undo').disabled = !engine.canUndo;
  const rb = $('#btn-rec');
  const mm = String(Math.floor(rec.seconds / 60)).padStart(2, '0'), ss = String(Math.floor(rec.seconds % 60)).padStart(2, '0');
  rb.className = 'btn ' + (rec.active || rec.converting ? 'dark' : 'primary'); rb.disabled = rec.converting;
  rb.textContent = rec.converting ? `${rec.stage}${rec.stage.startsWith('Converting') ? '  ' + Math.round(rec.progress * 100) + '%' : '...'}` : rec.active ? `Stop video recording   ${mm}:${ss}` : 'Start video recording' + (hasFootage ? `   (${mm}:${ss})` : '');
  ui.aspectCard.querySelector('i').textContent = ASPECTS[S.aspectI][0];
  ui.aspectCard.classList.toggle('open', S.panel === 'aspect'); ui.aspectOpts.hidden = S.panel !== 'aspect';
  [...ui.aspectOpts.children].forEach((b, i) => b.classList.toggle('sel', i === S.aspectI));
  ui.bgCard.querySelector('i').textContent = S.bgHex; swatchStyle(ui.bgCard.querySelector('.sw'), S.bgHex);
  ui.bgCard.classList.toggle('open', S.panel === 'bg'); ui.bgEd.el.hidden = S.panel !== 'bg';
  [...ui.modes.children].forEach((b, i) => b.classList.toggle('on', i === S.mode));
  ui.paintCard.hidden = S.mode !== 2; ui.paintCard.querySelector('i').textContent = S.solidHex; swatchStyle(ui.paintCard.querySelector('.sw'), S.solidHex);
  ui.paintCard.classList.toggle('open', S.panel === 'paint'); ui.paintEd.el.hidden = !(S.mode === 2 && S.panel === 'paint');
  ui.multi.hidden = S.mode !== 1; ui.eraserNote.hidden = S.mode !== 3;
  if (S.mode === 1) {
    const rgb = engine.multiRgb;
    if (ui.chips.children.length !== rgb.length) { ui.chips.innerHTML = ''; rgb.forEach((_, i) => { const b = el('button'); b.type = 'button'; b.onclick = () => { S.multiSel = S.multiSel === i ? null : i; if (S.multiSel != null) ui.multiEd.set(rgbToHex(...engine.multiRgb[i])); refresh(); }; ui.chips.appendChild(b); }); }
    [...ui.chips.children].forEach((b, i) => { b.style.background = `rgb(${rgb[i].join(',')})`; b.classList.toggle('on', S.multiSel === i); });
    ui.multiEd.el.hidden = S.multiSel == null;
  }
  [...ui.look.children].forEach((b, i) => b.classList.toggle('on', (i === 1) === S.retro));
  SLIDERS.forEach(sl => {
    sl.wrap.hidden = sl.when ? !sl.when() : false;
    if (document.activeElement !== sl.inp) sl.inp.value = sl.get();
    sl.out.textContent = sl.fmt(sl.get());
    sl.inp.style.setProperty('--p', ((sl.get() - sl.min) / (sl.max - sl.min) * 100) + '%');
  });
  refreshHands();
}

function refreshHands() {
  const lines = [];
  if (S.source === 'demo') lines.push(['Demo hands (no camera)', '']);
  if (S.source === 'mouse') lines.push(['No camera: mouse paints, Shift + drag smudges', '']);
  const row = (name, what, ctl) => lines.push([`${name} hand (${what}): ` + (ctl.seen ? `${ctl.fingers} finger${ctl.fingers !== 1 ? 's' : ''}` : 'not in view'), ctl.seen ? 'ok' : '']);
  if (S.source !== 'mouse') { row('Right', 'paint', rightCtl); row('Left', 'smudge', leftCtl); }
  const html = lines.map(l => `<div class="${l[1]}">${l[0]}</div>`).join('');
  if (ui.notes.dataset.h !== html) { ui.notes.innerHTML = html; ui.notes.dataset.h = html; }
  const lv = S.source === 'mouse' ? S.level : (rightCtl.seen && rightCtl.fingers >= 1 ? rightCtl.level : null);
  [...ui.sizes.firstChild.children].forEach((o, i) => { o.classList.toggle('on', lv === i); o.firstChild.classList.toggle('on', lv === i); });
}

function togglePanel(p) { S.panel = S.panel === p ? null : p; refresh(); }
function setMode(m) {
  S.mode = m; if (m !== 3) S.lastPaintMode = m;
  if (m !== 2 && S.panel === 'paint') S.panel = null;
  if (m !== 1) S.multiSel = null;
  refresh();
}

// ------------------------------------------------------------------------------------------------------ layout
function layout() {
  const W = innerWidth, H = innerHeight;
  dpr = Math.min(window.devicePixelRatio || 1, 3);
  const mainW = W - SIDEBAR_W, ar = ASPECTS[S.aspectI][1] / ASPECTS[S.aspectI][2];
  const stripH = thumbH + 22, hot = ui.hotkeys;
  let cw, ch, cx, cy, strip = false;
  side = ar < 1 && mainW - LEFT_W >= 200;
  if (side) {
    cw = Math.min(mainW - LEFT_W, H * ar); ch = cw / ar;
    cx = LEFT_W + Math.max(0, (mainW - LEFT_W - cw) / 2); cy = (H - ch) / 2;
  } else {
    cw = Math.min(mainW, H * ar);
    if (H - cw / ar < stripH) { const alt = (H - stripH) * ar; if (alt >= 0.6 * cw) cw = alt; }
    ch = cw / ar; strip = H - ch >= stripH - 2;
    cx = (mainW - cw) / 2; cy = strip ? 0 : (H - ch) / 2;
  }
  cw = Math.floor(cw / 2) * 2; ch = Math.round(cw / ar);
  Object.assign(ui.stage.style, { left: cx + 'px', top: cy + 'px', width: cw + 'px', height: ch + 'px' });
  ui.layout = { cx, cy, cw, ch, strip, side };
  for (const c of [ui.paint, ui.overlay]) { const w = Math.round(cw * dpr), h = Math.round(ch * dpr); if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } }
  const cam = ui.cam;
  cam.style.height = thumbH + 'px';
  if (side) {
    cam.style.left = '12px'; cam.style.top = '14px';
    hot.className = 'side'; Object.assign(hot.style, { left: '12px', top: (14 + thumbH + 26) + 'px', display: 'block' });
  } else if (strip) {
    cam.style.left = '12px'; cam.style.top = (H - thumbH - 10) + 'px';
    hot.className = 'strip'; Object.assign(hot.style, { left: (12 + THUMB_W + 24) + 'px', top: (H - thumbH - 10 + 2) + 'px', display: 'block' });
  } else {   // no room under the canvas: the preview sits on the canvas's bottom-left corner
    cam.style.left = Math.max(12, cx + 6) + 'px'; cam.style.top = (cy + ch - thumbH - 12) + 'px'; hot.style.display = 'none';
  }
  buildHotkeys();
}

function buildHotkeys() {
  const hot = ui.hotkeys, key = ([k, d]) => `<span class="k"><b>${k}</b>${d}</span>`;
  const mouse = S.source === 'mouse' ? '1-5 brush size, Shift + drag smudges' : '';
  let html;
  if (side) {
    html = HOTKEYS.map(key).join('') + `<span class="note">Right hand paints,<br>left hand smudges.<br><br>Fingers pick the size:<br>1 smallest ... open palm largest;<br>fist lifts.${mouse ? '<br><br>' + mouse : ''}</span>`;
  } else {
    const rows = [HOTKEYS.slice(0, 4), HOTKEYS.slice(4, 8), HOTKEYS.slice(8)];
    html = rows.map(r => `<div class="hrow">${r.map(key).join('')}</div>`).join('') + `<span class="note">Right hand paints, left hand smudges &nbsp;|&nbsp; Fingers pick the size: 1 smallest ... open palm largest; fist lifts${mouse ? '. ' + mouse : ''}</span>`;
  }
  if (hot.dataset.h !== html) { hot.innerHTML = html; hot.dataset.h = html; }
}

// ------------------------------------------------------------------------------------------------------ actions
function setAspect(i) {
  if (rec.active || rec.converting) { toast('Finish the recording before changing the aspect ratio'); return; }
  if (i === S.aspectI) { S.panel = null; refresh(); return; }
  S.aspectI = i; S.panel = null;
  engine.setAspect(ASPECTS[i][1], ASPECTS[i][2]);
  open.r = open.l = false; depth = 0; rightCtl.reset(); leftCtl.reset();
  engine.versions.forEach(v => { v.used = false; });
  tracker && tracker.setAspects(tracker.camAspect, ASPECTS[i][1] / ASPECTS[i][2]);
  layout(); refresh();
  toast(`Canvas: ${ASPECTS[i][0]} (${engine.CW}x${engine.CH}), cleared`);
}
function undo() { toast(engine.undo() ? 'Undo' : 'Nothing to undo'); refresh(); }
function clearCanvas() { engine.clear(); toast('Canvas cleared (Undo brings it back)'); refresh(); }
function setPen(flag, down) {   // each stroke, with either hand, is one Undo step
  if (down && !open[flag]) { if (depth++ === 0) engine.pushHistory(); open[flag] = true; refresh(); }
  else if (!down && open[flag]) { depth = Math.max(0, depth - 1); open[flag] = false; }
}
const solidM = a => -Math.log(Math.max(1 - 0.97 * a, 1e-3)) / 3.5;
function applyRight(seg) {
  const layer = S.retro ? 0 : 1;
  if (S.mode === 3) { engine.erase(seg.from, seg.to, seg.radius, S.softness); return; }
  paintSrc.advance(seg.dist, engine.sc);
  const o = { layer, radius: seg.radius, softness: S.softness, palette: S.mode === 1 ? 1 : 0,
    amount: S.load * 0.45 * (0.12 + Math.min(seg.dist / (2 * seg.radius), 1.2)), weights: [0, 0, 0, 0, 0], solid: null };
  if (S.mode === 2) { const v = hexToRgba(S.solidHex); o.solid = [v[0] / 255, v[1] / 255, v[2] / 255]; o.solidLoad = solidM(v[3]); }
  else o.weights = paintSrc.weights();
  engine.paint(seg.from, seg.to, o);
}
function applyLeft(seg) { engine.smudge(seg.from, seg.to, seg.radius, S.softness, 0.65, S.retro ? 0 : 1); }
function handleHands(hands, dt) {
  const sc = engine.sc, W = engine.CW, H = engine.CH;
  const sl = leftCtl.update(hands.Left, dt, W, H, sc); setPen('l', leftCtl.pen); if (sl) applyLeft(sl);
  const sr = rightCtl.update(hands.Right, dt, W, H, sc);
  if (rightCtl.justDown) paintSrc.newStroke();
  setPen('r', rightCtl.pen); if (sr) applyRight(sr);
}

// ------------------------------------------------------------------------------------------------------ mouse
const mouse = { down: false, prev: null, smudge: false, pos: null };
function canvasPos(e) { const r = ui.paint.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * engine.CW, (e.clientY - r.top) / r.height * engine.CH]; }
function mouseRadius() { return 25 * engine.sc * (0.3 + 2.5 * S.level / 4); }
function initMouse() {
  const c = ui.paint;
  c.addEventListener('pointerdown', e => {
    if (e.button !== 0 || S.source === 'camera' && false) return;
    c.setPointerCapture(e.pointerId);
    mouse.down = true; mouse.prev = canvasPos(e); mouse.smudge = e.shiftKey || e.ctrlKey;
    setPen('m', true); if (!mouse.smudge) paintSrc.newStroke();
    S.panel = null; refresh();
  });
  c.addEventListener('pointermove', e => {
    mouse.pos = canvasPos(e);
    if (!mouse.down) return;
    const p = mouse.pos, seg = { from: mouse.prev, to: p, radius: mouseRadius(), dist: Math.hypot(p[0] - mouse.prev[0], p[1] - mouse.prev[1]) };
    if (seg.dist < 0.3) return;
    if (mouse.smudge) applyLeft(seg); else applyRight(seg);
    mouse.prev = p;
  });
  const up = () => { mouse.down = false; setPen('m', false); };
  c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
  c.addEventListener('pointerleave', () => { if (!mouse.down) mouse.pos = null; });
}

// ------------------------------------------------------------------------------------------------------ camera
async function startCamera() {
  const text = $('#camtext'); text.textContent = 'Starting the camera and loading hand tracking...';
  $('#camon').disabled = true;
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('This browser does not allow camera access here.');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: false });
    video = document.createElement('video'); video.playsInline = true; video.muted = true; video.srcObject = stream;
    await video.play();
    const camAspect = video.videoWidth / video.videoHeight;
    tracker = new HP.HandTracker(); tracker.setAspects(camAspect, ASPECTS[S.aspectI][1] / ASPECTS[S.aspectI][2]);
    thumbH = Math.round(THUMB_W / camAspect);
    ui.mirror = document.createElement('canvas'); ui.mirror.width = 640; ui.mirror.height = Math.round(640 / camAspect);
    await tracker.load();
    S.source = 'camera'; camReady = true; ui.cam.classList.add('live'); $('#camswitch').textContent = 'Camera off';
    layout(); refresh(); toast('Camera on: right hand paints, left hand smudges');
  } catch (e) {
    console.error(e);
    text.textContent = (e && e.name === 'NotAllowedError') ? 'Camera access was blocked. Allow it in the address bar, or use the mouse.' : 'Could not start hand tracking: ' + (e && e.message || e);
    $('#camon').disabled = false;
    if (video && video.srcObject) video.srcObject.getTracks().forEach(t => t.stop());
    video = null;
  }
}
function stopCamera() {
  if (video && video.srcObject) video.srcObject.getTracks().forEach(t => t.stop());
  video = null; camReady = false; tracker = null;
  rightCtl.reset(); leftCtl.reset(); setPen('r', false); setPen('l', false);
  S.source = 'mouse'; thumbH = 144; ui.cam.classList.remove('live'); $('#camon').disabled = false;
  $('#camtext').textContent = 'Paint with your hands: turn on the camera. Everything stays on your computer.';
  layout(); refresh();
}
function startDemo() {
  S.source = 'demo'; ui.cam.classList.add('live'); $('#camswitch').textContent = 'Demo off';
  layout(); refresh();
}
function drawCamPreview() {
  const cv = ui.camcv, g = cv.getContext('2d');
  if (S.source === 'camera' && video) {
    g.save(); g.scale(-1, 1); g.drawImage(video, -cv.width, 0, cv.width, cv.height); g.restore();
    for (const [ctl, col] of [[rightCtl, '#FF3B3B'], [leftCtl, '#1E8CD7']]) {
      if (!ctl.camPts) continue;
      g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath();
      for (const [a, b] of HP.CONNECTIONS) { g.moveTo(ctl.camPts[a][0] * cv.width, ctl.camPts[a][1] * cv.height); g.lineTo(ctl.camPts[b][0] * cv.width, ctl.camPts[b][1] * cv.height); }
      g.stroke();
      const t = ctl.camPts[8]; g.fillStyle = ctl.pen ? col : '#FFC800'; g.beginPath(); g.arc(t[0] * cv.width, t[1] * cv.height, 5, 0, 7); g.fill();
    }
  } else if (S.source === 'demo') {
    g.fillStyle = '#4a4a4a'; g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = '#ddd'; g.font = '22px sans-serif'; g.textAlign = 'center'; g.fillText('Demo hands', cv.width / 2, cv.height / 2 + 8);
  }
  if (S.source !== 'mouse') drawSafeZone(g, cv.width, cv.height);
}

/** The part of the camera picture that reaches the canvas is the middle of it (cropped to the canvas shape, then a margin
 *  all round), so you can reach every edge and corner of the canvas without your hand leaving the picture.  Everything
 *  outside that area is tinted red: a closed fist there can travel anywhere without painting. */
function drawSafeZone(g, w, h) {
  const cam = tracker ? tracker.camAspect : 16 / 9, can = ASPECTS[S.aspectI][1] / ASPECTS[S.aspectI][2], m = HP.SAFE_MARGIN != null ? HP.SAFE_MARGIN : 0.12;
  const fx = cam < can ? 1 : can / cam, fy = cam < can ? cam / can : 1;
  const x0 = ((1 - fx) / 2 + fx * m) * w, x1 = ((1 - fx) / 2 + fx * (1 - m)) * w;
  const y0 = ((1 - fy) / 2 + fy * m) * h, y1 = ((1 - fy) / 2 + fy * (1 - m)) * h;
  g.save();
  g.fillStyle = 'rgba(233, 34, 48, 0.34)';
  g.beginPath(); g.rect(0, 0, w, h); g.rect(x0, y0, x1 - x0, y1 - y0); g.fill('evenodd');
  g.strokeStyle = 'rgba(255, 255, 255, 0.55)'; g.lineWidth = 1.5; g.strokeRect(x0, y0, x1 - x0, y1 - y0);
  g.restore();
}

// ------------------------------------------------------------------------------------------------------ recording + export
function pickMime() {
  const cands = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return cands.find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
}
/* Two kinds of take.  With an opaque background the page's own picture is recorded as an ordinary video.  With a transparent
 * background every frame is rendered with its alpha channel into an alpha canvas, recorded by the browser as WebM (VP9 with
 * alpha), and then converted to ProRes 4444 (.mov) by ffmpeg running inside the page, which After Effects and Premiere open
 * with the transparency intact. */
const REC_FPS = 30, ALPHA_MAX_S = 30;
const FF_CORE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm/', FF_LIB = 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/umd/',
  FF_UTIL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/umd/index.js';
const alpha = { on: false, w: 0, h: 0, last: 0, cvC: null, ctxC: null, cvA: null, ctxA: null };
let ffmpeg = null, ffmpegLoading = null;
function loadScript(src) { return new Promise((res, rej) => { const t = document.createElement('script'); t.src = src; t.onload = res; t.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(t); }); }
function loadFFmpeg() {
  if (ffmpeg) return Promise.resolve(ffmpeg);
  if (!ffmpegLoading) ffmpegLoading = (async () => {
    await loadScript(FF_LIB + 'ffmpeg.js'); await loadScript(FF_UTIL);
    const ff = new window.FFmpegWASM.FFmpeg(), { toBlobURL } = window.FFmpegUtil;
    ff.on('progress', ({ progress }) => { rec.progress = Math.max(0, Math.min(1, progress)); });
    await ff.load({ coreURL: await toBlobURL(FF_CORE + 'ffmpeg-core.js', 'text/javascript'), wasmURL: await toBlobURL(FF_CORE + 'ffmpeg-core.wasm', 'application/wasm'),
      classWorkerURL: await toBlobURL(FF_LIB + '814.ffmpeg.js', 'text/javascript') });
    ffmpeg = ff; return ff;
  })().finally(() => { ffmpegLoading = null; });
  return ffmpegLoading;
}
function captureTick(now) {
  if (!alpha.on || now - alpha.last < 1000 / REC_FPS - 3) return;
  alpha.last = now;
  const { w, h } = alpha;   // two plain, opaque pictures per frame: the colour, and the transparency as a grey picture
  alpha.ctxC.putImageData(new ImageData(engine.captureFrame(w, h, 3), w, h), 0, 0);
  alpha.ctxA.putImageData(new ImageData(engine.captureFrame(w, h, 4), w, h), 0, 0);
  if ((now - rec.t0) / 1000 > ALPHA_MAX_S) { toast('Transparent takes stop at 30 seconds'); toggleRecord(); }
}
/** colour.webm + matte.webm -> one ProRes 4444 .mov with a real alpha channel.  (The two pictures are recorded separately
 *  because browsers differ in whether their own recorder keeps alpha; this way it never depends on that.) */
async function convertToProRes(colorWebm, matteWebm) {
  rec.converting = true; rec.progress = 0; rec.stage = 'Loading the converter (first time only)'; refresh();
  const names = ['c.webm', 'a.webm', 'out.mov', 'chk.png'];
  try {
    const ff = await loadFFmpeg();
    rec.stage = 'Converting to MOV with alpha'; rec.progress = 0; refresh();
    await ff.writeFile('c.webm', new Uint8Array(await colorWebm.arrayBuffer()));
    await ff.writeFile('a.webm', new Uint8Array(await matteWebm.arrayBuffer()));
    const rc = await ff.exec(['-i', 'c.webm', '-i', 'a.webm', '-filter_complex',
      `[0:v]fps=${REC_FPS},format=yuv444p[c];[1:v]fps=${REC_FPS},scale=in_range=tv:out_range=pc:flags=accurate_rnd,format=gray[a];[c][a]alphamerge,format=argb[v]`,
      '-map', '[v]', '-an', '-c:v', 'qtrle', '-pix_fmt', 'argb', 'out.mov']);
    if (rc !== 0) throw new Error('ffmpeg returned ' + rc);
    // check that the result really has transparency: decode a frame from the middle and count its transparent pixels
    let check = '';
    try {
      const mid = Math.max(0, Math.floor(rec.seconds * REC_FPS / 2));
      await ff.exec(['-i', 'out.mov', '-vf', `select=eq(n\\,${mid})`, '-vframes', '1', '-pix_fmt', 'rgba', 'chk.png']);
      const img = await createImageBitmap(new Blob([await ff.readFile('chk.png')], { type: 'image/png' }));
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data; let t = 0, o = 0;
      for (let i = 3; i < d.length; i += 4) { if (d[i] < 3) t++; else if (d[i] > 252) o++; }
      const n = d.length / 4; check = `${Math.round(100 * t / n)}% transparent, ${Math.round(100 * o / n)}% opaque in the middle frame`;
      rec.alphaOk = t > 0;
    } catch (e) { check = 'transparency check skipped'; }
    const out = await ff.readFile('out.mov');
    rec.blob = new Blob([out], { type: 'video/quicktime' }); rec.kind = 'mov';
    console.log('ProRes take:', check, (out.length / 1e6).toFixed(1) + ' MB');
    toast(rec.alphaOk === false ? 'Converted, but the picture has no transparency (' + check + ')' : 'Ready: MOV with alpha (' + check + '). Press Export MOV to save it', 8);
  } catch (e) {
    console.error(e);
    rec.blob = colorWebm; rec.kind = 'webm-alpha'; rec.alphaOk = false;
    toast('Could not convert to MOV here, so only the colour picture was kept as WebM', 8);
  }
  for (const n of names) { try { if (ffmpeg) await ffmpeg.deleteFile(n); } catch (e) { /* not there */ } }
  rec.converting = false; rec.exported = false; refresh();
}

function toggleRecord() {
  if (rec.converting) return;
  if (rec.active) { rec.mr.stop(); return; }
  if (!window.MediaRecorder) { toast('This browser cannot record video.'); return; }
  const transparent = engine.bgAlpha < 0.999;
  rec.t0 = performance.now(); rec.seconds = 0; rec.blob = null; rec.chunks = [];
  let stream, mime;
  if (transparent) {
    mime = 'video/webm;codecs=vp9';
    if (!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm';
    const ar = ASPECTS[S.aspectI][1] / ASPECTS[S.aspectI][2];
    [alpha.w, alpha.h] = HP.fitSize(1920 * 1080, ar, 2);
    for (const k of ['C', 'A']) {
      const cv = document.createElement('canvas'); cv.width = alpha.w; cv.height = alpha.h; alpha['cv' + k] = cv; alpha['ctx' + k] = cv.getContext('2d', { alpha: false });
    }
    alpha.ctxC.putImageData(new ImageData(engine.captureFrame(alpha.w, alpha.h, 3), alpha.w, alpha.h), 0, 0);
    alpha.ctxA.putImageData(new ImageData(engine.captureFrame(alpha.w, alpha.h, 4), alpha.w, alpha.h), 0, 0);
    stream = alpha.cvC.captureStream(REC_FPS); rec.chunksA = [];
    const mrA = new MediaRecorder(alpha.cvA.captureStream(REC_FPS), { mimeType: mime, videoBitsPerSecond: 8e6 });
    mrA.ondataavailable = e => { if (e.data.size) rec.chunksA.push(e.data); };
    rec.mrA = mrA; rec.matteDone = new Promise(r => { mrA.onstop = r; });
    alpha.last = performance.now(); alpha.on = true; rec.kind = 'alpha'; rec.alphaOk = null;
    loadFFmpeg().catch(() => {});      // start fetching the converter now, so it is ready when the take ends
  } else { mime = pickMime(); stream = ui.paint.captureStream(REC_FPS); rec.kind = 'video'; }
  rec.mime = mime;
  rec.mr = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 16e6 } : { videoBitsPerSecond: 16e6 });
  rec.mr.ondataavailable = e => { if (e.data.size) rec.chunks.push(e.data); };
  rec.mr.onstop = async () => {
    alpha.on = false; rec.active = false; rec.seconds = (performance.now() - rec.t0) / 1000;
    ui.stage.classList.remove('has-badge'); $('#recbadge').classList.remove('on');
    const blob = new Blob(rec.chunks, { type: (rec.mime || 'video/webm').split(';')[0] });
    toast(`Recording stopped  (${rec.seconds.toFixed(1)}s captured)`);
    if (rec.kind === 'alpha') { rec.mrA.stop(); await rec.matteDone; convertToProRes(blob, new Blob(rec.chunksA, { type: 'video/webm' })); }
    else { rec.blob = blob; rec.exported = false; refresh(); }
  };
  if (rec.mrA) rec.mrA.start(250);
  rec.active = true; rec.mr.start(250);
  $('#recbadge').classList.add('on'); ui.stage.classList.add('has-badge');
  toast(transparent ? 'Recording with transparency (saved as .mov with alpha)' : 'Recording started'); refresh();
}
function exportVideo() {
  if (!rec.blob || rec.converting) return;
  const ext = rec.kind === 'mov' ? 'mov' : rec.blob.type.includes('mp4') ? 'mp4' : 'webm';
  saveBlob(rec.blob, `handpaint_${stamp()}.${ext}`); rec.exported = true; toast('Saved ' + (rec.kind === 'mov' ? '.mov with alpha' : 'video'));
}
async function exportPNG() {
  const ar = ASPECTS[S.aspectI][1] / ASPECTS[S.aspectI][2];
  const [w, h] = HP.fitSize(3840 * 2160, ar, 2);
  toast(`Rendering ${w}x${h} PNG ...`);
  await new Promise(r => setTimeout(r, 30));
  const blob = await engine.exportPNG(w, h);
  await saveBlob(blob, `handpaint_${stamp()}.png`); toast('Saved PNG');
}

// ------------------------------------------------------------------------------------------------------ keys
function onKey(e) {
  if (e.target && (e.target.tagName === 'INPUT' && e.target.type === 'text')) return;
  const k = e.key.toLowerCase(), mod = e.metaKey || e.ctrlKey;
  if (mod) { if (k === 'z') { e.preventDefault(); undo(); } return; }
  if (e.altKey) return;
  if (k === ' ') { e.preventDefault(); toggleRecord(); }
  else if (k === 'v') exportVideo();
  else if (k === 's') exportPNG();
  else if (k === 'c') clearCanvas();
  else if (k === 'z') undo();
  else if (k === 'r') setMode(S.mode < 3 ? (S.mode + 1) % 3 : 0);
  else if (k === 'e') setMode(S.mode === 3 ? S.lastPaintMode : 3);
  else if (k === 'p') { if (S.mode === 2) togglePanel('paint'); else toast('Paint color is for Solid: switch to Solid first'); }
  else if (k === 'b') togglePanel('bg');
  else if (k === 'f') { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => {}); }
  else if (/^[1-5]$/.test(k)) { S.level = parseInt(k, 10) - 1; refresh(); }
}

// ------------------------------------------------------------------------------------------------------ main loop
let lastT = 0, physAcc = 0, detAcc = 0, demoAcc = 0, uiAcc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastT) / 1000, 0.1); lastT = now;
  // hands
  if (S.source === 'camera' && video && tracker && tracker.ready && video.readyState >= 2) {
    detAcc += dt;
    if (detAcc >= 1 / 30) {
      const g = ui.mirror.getContext('2d');
      g.save(); g.scale(-1, 1); g.drawImage(video, -ui.mirror.width, 0, ui.mirror.width, ui.mirror.height); g.restore();
      let hands; try { hands = tracker.detect(ui.mirror, performance.now()); } catch (e) { hands = { Right: null, Left: null }; }
      handleHands(hands, detAcc); detAcc = 0;
    }
  } else if (S.source === 'demo') {
    demoAcc += dt;
    if (demoAcc >= 1 / 30) { demoAcc -= 1 / 30; handleHands({ Right: demoR.update(1 / 30), Left: demoL.update(1 / 30) }, 1 / 30); }
  }
  // physics (about 22 passes a second)
  physAcc += dt;
  if (physAcc >= 1 / 22) { if (!S.noPhys) engine.step(physAcc * 30); physAcc = 0; }
  engine.render(); captureTick(now);
  drawOverlay(); drawCamPreview();
  uiAcc += dt;
  if (uiAcc > 0.25) { uiAcc = 0; if (rec.converting) refresh(); if (rec.active) { rec.seconds = (performance.now() - rec.t0) / 1000; refresh(); $('#rectime').textContent = 'REC ' + String(Math.floor(rec.seconds / 60)).padStart(2, '0') + ':' + String(Math.floor(rec.seconds % 60)).padStart(2, '0'); } else refreshHands(); }
  $('#recbadge i').classList.toggle('off', rec.active && Math.floor(now / 500) % 2 === 1);
}

function drawOverlay() {
  const cv = ui.overlay, g = cv.getContext('2d'), k = cv.width / engine.CW;
  g.clearRect(0, 0, cv.width, cv.height);
  const ring = (p, r, col, w) => { g.strokeStyle = col; g.lineWidth = w * dpr; g.beginPath(); g.arc(p[0] * k, p[1] * k, Math.max(2, r * k), 0, 7); g.stroke(); };
  if (S.source !== 'mouse') {
    if (rightCtl.cursor) {
      const col = rightCtl.pen ? (S.mode === 3 ? '#E65A96' : '#DC2828') : '#5A5A5A';
      ring(rightCtl.cursor, rightCtl.radius, col, 2); if (S.softness > 0.15) ring(rightCtl.cursor, rightCtl.radius * (1 + 0.6 * S.softness), col, 1);
    }
    if (leftCtl.cursor) {
      const col = leftCtl.pen ? '#1E8CD7' : '#646E78', c = leftCtl.cursor, r = leftCtl.radius * k;
      ring(c, leftCtl.radius, col, 2); g.strokeStyle = col; g.lineWidth = dpr; g.beginPath();
      g.moveTo(c[0] * k - r / 2, c[1] * k); g.lineTo(c[0] * k + r / 2, c[1] * k); g.moveTo(c[0] * k, c[1] * k - r / 2); g.lineTo(c[0] * k, c[1] * k + r / 2); g.stroke();
    }
  }
  if (mouse.pos) {
    const r = mouseRadius(), col = mouse.down ? (mouse.smudge ? '#1E8CD7' : S.mode === 3 ? '#E65A96' : '#DC2828') : '#5A5A5A';
    ring(mouse.pos, r, col, 2); if (S.softness > 0.15) ring(mouse.pos, r * (1 + 0.6 * S.softness), col, 1);
  }
}

// ------------------------------------------------------------------------------------------------------ start
function init() {
  ui.stage = $('#stage'); ui.paint = $('#paint'); ui.overlay = $('#overlay'); ui.toasts = $('#toasts');
  ui.cam = $('#cam'); ui.camcv = $('#camcv'); ui.hotkeys = $('#hotkeys');
  try { engine = new HP.Engine(ui.paint); }
  catch (e) { const f = $('#fatal'); f.style.display = 'flex'; f.textContent = 'HandPaint needs WebGL 2 with floating-point rendering. ' + e.message; console.error(e); return; }
  buildSidebar(); initMouse();
  $('#camon').onclick = startCamera;
  if (/[?&]demo\b/.test(location.search)) startDemo();   // (developer shortcut, not offered in the page)
  $('#camswitch').onclick = () => { if (S.source === 'camera') stopCamera(); else { S.source = 'mouse'; ui.cam.classList.remove('live'); rightCtl.reset(); leftCtl.reset(); setPen('r', false); setPen('l', false); layout(); refresh(); } };
  addEventListener('resize', layout); addEventListener('keydown', onKey);
  layout(); refresh();
  requestAnimationFrame(t => { lastT = t; frame(t); });
  window.HPApp = { rec, captureTick, toggleRecord, convertToProRes, loadFFmpeg, S, engine, handleHands, rightCtl, leftCtl, setMode, setAspect, refresh, layout, toast, undo };
}
init();
})(window.HP = window.HP || {});
