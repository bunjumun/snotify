// sketchpad.js — a reusable "draw over this image" layer.
//
// Lifted in spirit from art.html's comment-sketch pad, which has drawn
// suggested edits over artwork since schema-v7. That copy is welded to the art
// page's comment drawer (openDrawer, syncComposer, set_comment_sketch); this
// one is page-agnostic. It builds its own two canvases and its own toolbar,
// overlays any <img>, and hands the strokes back through a callback. art.html
// keeps its own copy for now — pulling that one out is a separate job with its
// own regression surface, and this module is small enough that a second copy
// costs less than the risk of rewiring a 74 KB file that can only be fully
// tested behind a band login.
//
// A stroke is { c:<colour>, w:<width 0..1 of image width>, p:[[x,y],...] } with
// x/y in 0..1 of the image's rendered rect — never a flattened PNG. It scales
// to any screen, lands in the same place on an image exported at other
// dimensions, rides along in a JSON body with no upload, and can be redrawn.

const SK_MAX_STROKES = 200, SK_MAX_POINTS = 4000;
const SWATCHES = [
  ['#ff5c5c', 'Red'], ['#ffb454', 'Amber'], ['#00d0a4', 'Green'],
  ['#6c5ce7', 'Purple'], ['#e7e9ee', 'White'],
];
const NIBS = [[0.003, 'Fine', 4], [0.006, 'Medium', 8], [0.012, 'Thick', 13]];

let styleInjected = false;
function ensureStyle(){
  if (styleInjected) return;
  styleInjected = true;
  const css = `
  .sk-view { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; }
  .sk-pad  { position:absolute; inset:0; width:100%; height:100%; display:none; cursor:crosshair; touch-action:none; }
  .sk-pad.on { display:block; }
  .sk-tools {
    display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-top:12px;
    padding:10px 12px; background:var(--bg-soft,#15161c); border:1px solid var(--accent,#6c5ce7);
    border-radius:10px;
  }
  .sk-tools .sk-lbl { color:var(--text-mute,#8a8f9c); font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; }
  .sk-tools .sk-swatch { width:20px; height:20px; border-radius:50%; cursor:pointer; border:2px solid transparent; }
  .sk-tools .sk-swatch.on { border-color:var(--text,#e7e9ee); transform:scale(1.12); }
  .sk-tools .sk-nib { width:22px; height:22px; border-radius:50%; background:var(--bg-row,#1b1c22); border:1px solid var(--line,#2a2c34); cursor:pointer; display:grid; place-items:center; }
  .sk-tools .sk-nib.on { border-color:var(--text,#e7e9ee); }
  .sk-tools .sk-nib i { display:block; background:var(--text-dim,#b6bac4); border-radius:50%; }
  .sk-tools .sk-nib.on i { background:var(--text,#e7e9ee); }
  .sk-tools .sk-sep { width:1px; align-self:stretch; background:var(--line,#2a2c34); }
  .sk-tools .btn { padding:6px 12px; font-size:13px; }
  .sk-tools .sk-grow { margin-left:auto; display:flex; gap:8px; }`;
  const el = document.createElement('style');
  el.textContent = css;
  document.head.appendChild(el);
}

/** Paint a stroke list onto a canvas, sized from the image's rendered rect. */
export function paintStrokes(cv, img, strokes, fallbackColor = '#ff5c5c', fallbackW = 0.003){
  const b = img.getBoundingClientRect();
  if (!b.width || !b.height) return;
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(b.width * dpr);
  cv.height = Math.round(b.height * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, b.width, b.height);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  (strokes || []).forEach(s => {
    if (!s.p || !s.p.length) return;
    ctx.strokeStyle = s.c || fallbackColor;
    ctx.lineWidth = Math.max(1, (s.w || fallbackW) * b.width);
    ctx.beginPath();
    s.p.forEach(([x, y], i) => i ? ctx.lineTo(x * b.width, y * b.height)
                                : ctx.moveTo(x * b.width, y * b.height));
    if (s.p.length === 1) ctx.lineTo(s.p[0][0] * b.width + .01, s.p[0][1] * b.height + .01); // a tap is a dot
    ctx.stroke();
  });
}

function mk(tag, cls){ const e = document.createElement(tag); if (cls) e.className = cls; return e; }
function markOne(root, sel, hit){ root.querySelectorAll(sel).forEach(n => n.classList.toggle('on', n === hit)); }

/**
 * Attach a draw pad to an image.
 *   host : a positioned element that contains `img` (the pad's canvases go here)
 *   img  : the <img> to draw over
 * Returns { start, isActive, onDone, renderStatic, destroy }.
 */
export function createSketchPad(host, img){
  ensureStyle();
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

  const view = mk('canvas', 'sk-view');
  const pad  = mk('canvas', 'sk-pad');
  host.append(view, pad);

  const tools = mk('div', 'sk-tools');
  tools.hidden = true;
  const lbl = mk('span', 'sk-lbl'); lbl.textContent = 'Draft'; tools.append(lbl);
  SWATCHES.forEach(([c, title], i) => {
    const s = mk('span', 'sk-swatch' + (i === 0 ? ' on' : ''));
    s.style.background = c; s.title = title; s.dataset.color = c;
    tools.append(s);
  });
  tools.append(mk('span', 'sk-sep'));
  NIBS.forEach(([w, title, px], i) => {
    const n = mk('span', 'sk-nib' + (i === 0 ? ' on' : ''));
    n.title = title; n.dataset.w = String(w);
    const dot = mk('i'); dot.style.width = px + 'px'; dot.style.height = px + 'px';
    n.append(dot); tools.append(n);
  });
  tools.append(mk('span', 'sk-sep'));
  const undo = mk('button', 'btn ghost'); undo.textContent = '↶ Undo'; undo.dataset.act = 'undo';
  const clr  = mk('button', 'btn ghost'); clr.textContent = 'Clear'; clr.dataset.act = 'clear';
  tools.append(undo, clr);
  const grow = mk('div', 'sk-grow');
  const cancel = mk('button', 'btn ghost'); cancel.textContent = 'Cancel'; cancel.dataset.act = 'cancel';
  const done = mk('button', 'btn primary'); done.textContent = 'Done'; done.dataset.act = 'done';
  grow.append(cancel, done); tools.append(grow);
  host.after(tools);

  let mode = false, strokes = [], color = '#ff5c5c', width = 0.003;
  let doneCb = null, cur = null, lastStatic = null;

  const frac = (e) => {
    const r = img.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };
  const count = () => strokes.reduce((n, s) => n + s.p.length, 0);
  const repaintPad = () => paintStrokes(pad, img, strokes, color, width);
  function renderStatic(s){
    lastStatic = s || [];
    if (!mode) paintStrokes(view, img, lastStatic, color, width);
  }

  pad.addEventListener('pointerdown', (e) => {
    if (!mode) return;
    if (strokes.length >= SK_MAX_STROKES || count() >= SK_MAX_POINTS) return;
    const p = frac(e);
    cur = { c: color, w: width, p: [[+p.x.toFixed(4), +p.y.toFixed(4)]] };
    strokes.push(cur);
    pad.setPointerCapture(e.pointerId);
    repaintPad();
    e.preventDefault();
  });
  pad.addEventListener('pointermove', (e) => {
    if (!cur) return;
    const p = frac(e), last = cur.p[cur.p.length - 1];
    if (Math.hypot(p.x - last[0], p.y - last[1]) < 0.004) return;
    if (cur.p.length >= SK_MAX_POINTS) return;
    cur.p.push([+p.x.toFixed(4), +p.y.toFixed(4)]);
    repaintPad();
  });
  const stop = () => { cur = null; };
  pad.addEventListener('pointerup', stop);
  pad.addEventListener('pointercancel', stop);

  tools.addEventListener('click', (e) => {
    const sw = e.target.closest('[data-color]');
    if (sw){ color = sw.dataset.color; markOne(tools, '[data-color]', sw); return; }
    const nb = e.target.closest('[data-w]');
    if (nb){ width = parseFloat(nb.dataset.w); markOne(tools, '[data-w]', nb); return; }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    if (act.dataset.act === 'undo'){ strokes.pop(); repaintPad(); }
    else if (act.dataset.act === 'clear'){ strokes = []; repaintPad(); }
    else if (act.dataset.act === 'cancel'){ end(false); }
    else if (act.dataset.act === 'done'){ end(true); }
  });

  function start(existing){
    mode = true;
    strokes = existing ? JSON.parse(JSON.stringify(existing)) : [];
    tools.hidden = false;
    pad.classList.add('on');
    paintStrokes(view, img, [], color, width);
    repaintPad();
    tools.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function end(keep){
    const out = (strokes || []).filter(s => s.p && s.p.length);
    mode = false; cur = null;
    tools.hidden = true;
    pad.classList.remove('on');
    strokes = [];
    if (keep && doneCb) doneCb(out.length ? out : null);
    renderStatic(keep ? out : lastStatic);
  }

  const onResize = () => { mode ? repaintPad() : renderStatic(lastStatic); };
  window.addEventListener('resize', onResize);

  return {
    start,
    isActive: () => mode,
    onDone: (cb) => { doneCb = cb; },
    renderStatic,
    destroy: () => {
      window.removeEventListener('resize', onResize);
      view.remove(); pad.remove(); tools.remove();
    },
  };
}
