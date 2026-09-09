// paint-tool.js — the paint tool. He named it on 9 Sep, and the name lives here
// rather than only on the toolbar, because this file is meant to become the one
// copy: see the note on art.html's second copy below, which is his standing
// instruction and not yet done.
//
// A reusable draw-over-an-image layer, and since CR-114 a draw-on-nothing one
// too, since the second argument is only ever measured, never drawn.
//
// Lifted in spirit from art.html's comment-sketch pad, which has drawn
// suggested edits over artwork since schema-v7. It builds its own two canvases
// and its own toolbar, overlays any <img>, and hands the strokes back through a
// callback, so it knows nothing about whatever page it is sitting on.
//
// THIS IS THE ONLY PEN ON THE SITE, as of CR-116 on 2026-09-09, at his word:
// "that tool itself should be something you paste in as a whole tool or module
// of sorts so when we update it it automatically would update in every instance
// it happens in". There were two until that day. He found it by asking whether
// the morning's improvements applied everywhere, and they did not: eraser, redo,
// the colour picker and opacity all landed here, while art.html's own copy got
// none of them. That is the drift a second copy guarantees rather than risks.
// So art.html's pen was deleted, not synchronised, and anything added here now
// reaches both pages by existing. If a third page ever wants a pen, import this;
// do not paste it.
//
// The options argument exists for exactly that reason. art.html could not use
// the module as it stood: its toolbar lives outside the image wrapper, its
// caption says "Draft" because on that page the word names the comment feature
// rather than the pen, its Done button reads "Save" when it is redrawing an
// existing suggestion, and it needs a body class toggled so the region boxes dim
// while you paint. Every one of those is a host concern, so each is an option
// with a default that leaves the original caller untouched.
//
// A stroke is { c:<colour>, w:<width 0..1 of image width>, p:[[x,y],...],
// o:<opacity 0..1, optional> } with x/y in 0..1 of the image's rendered rect —
// never a flattened PNG. It scales to any screen, lands in the same place on an
// image exported at other dimensions, rides along in a JSON body with no
// upload, and can be redrawn.
//
// `o` was added after the fact and is deliberately optional: a stroke without
// one paints fully opaque, which is exactly how every sketch drawn before it
// existed already looked. So no sketch needed migrating and none changed.
//
// What this module is NOT, and the boundary is worth stating because the next
// three requests all sit the other side of it: strokes are a flat list of pen
// paths. A placeable image, a shape, a fill, or a canvas you can zoom all need
// this to become a list of positioned objects instead. That is one change, not
// three, and it is not this one.

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
    display:none; align-items:center; gap:10px; flex-wrap:wrap; margin-top:12px;
    padding:10px 12px; background:var(--bg-soft,#15161c); border:1px solid var(--accent,#6c5ce7);
    border-radius:10px;
  }
  /* Shown via a class, not the hidden attribute: an unconditional display
     rule on the same selector always beats the UA's [hidden]{display:none}
     in the cascade, regardless of specificity, because origin (UA vs author)
     is decided before specificity is. .sk-pad.on above already gets this
     right; tools.hidden did not, and the toolbar never actually hid on any
     page until this fix. Found on CR-116 because art.html's pad lives for
     the whole page rather than being created and destroyed per block, which
     put a permanently 'hidden' toolbar in constant view. */
  .sk-tools.on { display:flex; }
  .sk-tools .sk-lbl { color:var(--text-mute,#8a8f9c); font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; }
  .sk-tools .sk-swatch { width:20px; height:20px; border-radius:50%; cursor:pointer; border:2px solid transparent; }
  .sk-tools .sk-swatch.on { border-color:var(--text,#e7e9ee); transform:scale(1.12); }
  .sk-tools .sk-nib { width:22px; height:22px; border-radius:50%; background:var(--bg-row,#1b1c22); border:1px solid var(--line,#2a2c34); cursor:pointer; display:grid; place-items:center; }
  .sk-tools .sk-nib.on { border-color:var(--text,#e7e9ee); }
  .sk-tools .sk-nib i { display:block; background:var(--text-dim,#b6bac4); border-radius:50%; }
  .sk-tools .sk-nib.on i { background:var(--text,#e7e9ee); }
  .sk-tools .sk-sep { width:1px; align-self:stretch; background:var(--line,#2a2c34); }
  .sk-tools .btn { padding:6px 12px; font-size:13px; }
  .sk-tools .sk-grow { margin-left:auto; display:flex; gap:8px; }
  /* The picker sits beside the swatches rather than replacing them: the
     swatches are what he has been drawing with, and a picker is slower for
     the common case. */
  .sk-tools .sk-pick { width:22px; height:22px; padding:0; border:2px solid transparent; border-radius:50%; background:none; cursor:pointer; overflow:hidden; }
  .sk-tools .sk-pick.on { border-color:var(--text,#e7e9ee); transform:scale(1.12); }
  .sk-tools .sk-pick::-webkit-color-swatch-wrapper { padding:0; }
  .sk-tools .sk-pick::-webkit-color-swatch { border:none; border-radius:50%; }
  .sk-tools .sk-pick::-moz-color-swatch { border:none; border-radius:50%; }
  .sk-tools .sk-op { display:flex; align-items:center; gap:6px; }
  .sk-tools .sk-op input { width:74px; accent-color:var(--accent,#6c5ce7); }
  .sk-tools .sk-op span { color:var(--text-mute,#8a8f9c); font-size:11px; min-width:30px; font-variant-numeric:tabular-nums; }
  .sk-tools .sk-era.on { background:var(--accent,#6c5ce7); border-color:var(--accent,#6c5ce7); color:#fff; }
  .sk-pad.era { cursor:cell; }`;
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
    // Absent means opaque, so nothing drawn before opacity existed shifts.
    ctx.globalAlpha = typeof s.o === 'number' ? Math.max(0.05, Math.min(1, s.o)) : 1;
    ctx.strokeStyle = s.c || fallbackColor;
    ctx.lineWidth = Math.max(1, (s.w || fallbackW) * b.width);
    ctx.beginPath();
    s.p.forEach(([x, y], i) => i ? ctx.lineTo(x * b.width, y * b.height)
                                : ctx.moveTo(x * b.width, y * b.height));
    if (s.p.length === 1) ctx.lineTo(s.p[0][0] * b.width + .01, s.p[0][1] * b.height + .01); // a tap is a dot
    ctx.stroke();
    ctx.globalAlpha = 1;
  });
}

function mk(tag, cls){ const e = document.createElement(tag); if (cls) e.className = cls; return e; }
function markOne(root, sel, hit){ root.querySelectorAll(sel).forEach(n => n.classList.toggle('on', n === hit)); }

/**
 * Attach a draw pad to an image.
 *   host : a positioned element that contains `img` (the pad's canvases go here)
 *   img  : the <img> to draw over
 *   opts : { toolsInto, label, doneLabel, onStart, onEnd } — all optional, and
 *          every default is what the module did before options existed, so a
 *          caller that passes nothing sees no change at all.
 *            toolsInto : element to append the toolbar into. Default: straight
 *                        after `host`, which is where it used to go and is right
 *                        whenever the image wrapper is not itself inside
 *                        something the toolbar must escape.
 *            label     : toolbar caption. Default 'Paint tool'.
 *            doneLabel : the confirm button's text. Default 'Done'; change it
 *                        per session with setDoneLabel().
 *            onStart   : run when the pad goes live, before it scrolls itself
 *                        into view, so a host class lands before the paint.
 *            onEnd     : run last of all, after onDone and after the static
 *                        repaint, so a host that repaints from its own state
 *                        wins rather than being overwritten.
 * Returns { start, cancel, isActive, onDone, setDoneLabel, renderStatic, destroy }.
 */
export function createSketchPad(host, img, opts = {}){
  ensureStyle();
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

  const view = mk('canvas', 'sk-view');
  const pad  = mk('canvas', 'sk-pad');
  host.append(view, pad);

  const tools = mk('div', 'sk-tools');
  // .on is added by start() / removed by end() — see the CSS note above.
  const lbl = mk('span', 'sk-lbl'); lbl.textContent = opts.label || 'Paint tool'; tools.append(lbl);
  SWATCHES.forEach(([c, title], i) => {
    const s = mk('span', 'sk-swatch' + (i === 0 ? ' on' : ''));
    s.style.background = c; s.title = title; s.dataset.color = c;
    tools.append(s);
  });
  // Any colour, beside the presets rather than instead of them: the swatches
  // are what he has been drawing with, and a picker is slower for the common
  // case.
  const pick = document.createElement('input');
  pick.type = 'color'; pick.className = 'sk-pick'; pick.value = '#ff5c5c';
  pick.title = 'Any colour';
  tools.append(pick);

  tools.append(mk('span', 'sk-sep'));
  NIBS.forEach(([w, title, px], i) => {
    const n = mk('span', 'sk-nib' + (i === 0 ? ' on' : ''));
    n.title = title; n.dataset.w = String(w);
    const dot = mk('i'); dot.style.width = px + 'px'; dot.style.height = px + 'px';
    n.append(dot); tools.append(n);
  });
  const opWrap = mk('div', 'sk-op');
  const opLbl = mk('span'); opLbl.textContent = '100%';
  const op = document.createElement('input');
  op.type = 'range'; op.min = '10'; op.max = '100'; op.step = '5'; op.value = '100';
  op.title = 'Opacity';
  opWrap.append(op, opLbl);
  tools.append(mk('span', 'sk-sep'), opWrap, mk('span', 'sk-sep'));
  // Rubs out whole strokes rather than pixels, because a stroke is the unit
  // this format stores. Half-erasing a line would mean splitting its path,
  // which is a different feature and a lossier one.
  const era = mk('button', 'btn ghost sk-era'); era.textContent = '⌫ Erase'; era.dataset.act = 'erase';
  const undo = mk('button', 'btn ghost'); undo.textContent = '↶ Undo'; undo.dataset.act = 'undo';
  const redo = mk('button', 'btn ghost'); redo.textContent = '↷ Redo'; redo.dataset.act = 'redo';
  tools.append(era);
  const clr  = mk('button', 'btn ghost'); clr.textContent = 'Clear'; clr.dataset.act = 'clear';
  tools.append(undo, redo, clr);
  const grow = mk('div', 'sk-grow');
  const cancel = mk('button', 'btn ghost'); cancel.textContent = 'Cancel'; cancel.dataset.act = 'cancel';
  const done = mk('button', 'btn primary'); done.textContent = opts.doneLabel || 'Done'; done.dataset.act = 'done';
  grow.append(cancel, done); tools.append(grow);
  // A host whose image wrapper is nested (art.html's sits inside a stage wrapper
  // that the toolbar has to sit outside of) names its own mount point.
  if (opts.toolsInto) opts.toolsInto.append(tools); else host.after(tools);

  let mode = false, strokes = [], color = '#ff5c5c', width = 0.003;
  let doneCb = null, cur = null, lastStatic = null;
  // Opacity 0..1, and the eraser as a mode rather than a separate tool object.
  let opacity = 1, erasing = false;
  // Undo history. `undone` holds what undo took off so redo can put it back,
  // and any new mark clears it, which is what every editor does and what
  // stops redo resurrecting something from three edits ago.
  let undone = [];

  const frac = (e) => {
    const r = img.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };
  const count = () => strokes.reduce((n, s) => n + s.p.length, 0);

  /** Distance in pixels from a point to a segment. Point-to-point alone would
   *  make a long straight stroke, which has very few recorded points, almost
   *  impossible to hit. */
  function distToSeg(px, py, ax, ay, bx, by){
    const dx = bx - ax, dy = by - ay;
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  /** The topmost stroke under the pointer, or -1. Later strokes sit on top, so
   *  the search runs backwards and takes the first hit. */
  function strokeAt(e){
    const r = img.getBoundingClientRect();
    if (!r.width || !r.height) return -1;
    const px = e.clientX - r.left, py = e.clientY - r.top;
    for (let i = strokes.length - 1; i >= 0; i--){
      const s = strokes[i];
      if (!s.p || !s.p.length) continue;
      // Reach scales with the nib, so a thick line is as easy to hit as it
      // looks, with a floor so a fine line is still catchable on a phone.
      const reach = Math.max(10, (s.w || 0.003) * r.width * 0.9);
      const pts = s.p.map(([x, y]) => [x * r.width, y * r.height]);
      if (pts.length === 1){
        if (Math.hypot(px - pts[0][0], py - pts[0][1]) <= reach) return i;
        continue;
      }
      for (let k = 1; k < pts.length; k++){
        if (distToSeg(px, py, pts[k-1][0], pts[k-1][1], pts[k][0], pts[k][1]) <= reach) return i;
      }
    }
    return -1;
  }

  /** Erasing is undoable like anything else: the removed stroke goes on the
   *  same history the undo button reads, so a mis-rub is one press away. */
  function eraseAt(e){
    const i = strokeAt(e);
    if (i < 0) return false;
    undone.push({ act: 'erase', at: i, s: strokes[i] });
    strokes.splice(i, 1);
    repaintPad();
    return true;
  }
  const repaintPad = () => paintStrokes(pad, img, strokes, color, width);
  function renderStatic(s){
    lastStatic = s || [];
    if (!mode) paintStrokes(view, img, lastStatic, color, width);
  }

  pad.addEventListener('pointerdown', (e) => {
    if (!mode) return;
    if (erasing){ pad.setPointerCapture(e.pointerId); eraseAt(e); e.preventDefault(); return; }
    if (strokes.length >= SK_MAX_STROKES || count() >= SK_MAX_POINTS) return;
    const p = frac(e);
    cur = { c: color, w: width, p: [[+p.x.toFixed(4), +p.y.toFixed(4)]] };
    // Opaque strokes stay shaped exactly as before, so nothing gains a field
    // it does not need.
    if (opacity < 1) cur.o = opacity;
    // A fresh mark ends the redo chain.
    undone = [];
    strokes.push(cur);
    pad.setPointerCapture(e.pointerId);
    repaintPad();
    e.preventDefault();
  });
  pad.addEventListener('pointermove', (e) => {
    // Drag to rub out a run of strokes, the way an eraser actually behaves.
    if (erasing){ if (e.buttons) eraseAt(e); return; }
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

  pick.addEventListener('input', () => {
    color = pick.value;
    // Choosing a free colour deselects the presets, so the toolbar never shows
    // two colours as current at once.
    tools.querySelectorAll('[data-color]').forEach(n => n.classList.remove('on'));
    pick.classList.add('on');
  });
  op.addEventListener('input', () => {
    opacity = Math.max(0.1, Math.min(1, (+op.value || 100) / 100));
    opLbl.textContent = Math.round(opacity * 100) + '%';
  });

  tools.addEventListener('click', (e) => {
    const sw = e.target.closest('[data-color]');
    if (sw){ color = sw.dataset.color; markOne(tools, '[data-color]', sw); pick.classList.remove('on'); return; }
    const nb = e.target.closest('[data-w]');
    if (nb){ width = parseFloat(nb.dataset.w); markOne(tools, '[data-w]', nb); return; }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    if (act.dataset.act === 'erase'){
      erasing = !erasing;
      era.classList.toggle('on', erasing);
      pad.classList.toggle('era', erasing);
      return;
    }
    if (act.dataset.act === 'undo'){
      // Undo reverses whichever kind of thing happened last: a stroke drawn
      // comes off, a stroke erased goes back where it was.
      const last = undone[undone.length - 1];
      if (last && last.act === 'erase'){
        undone.pop();
        strokes.splice(Math.min(last.at, strokes.length), 0, last.s);
      } else if (strokes.length){
        undone.push({ act: 'draw', s: strokes.pop() });
      }
      repaintPad();
    }
    else if (act.dataset.act === 'redo'){
      const last = undone[undone.length - 1];
      if (last && last.act === 'draw'){ undone.pop(); strokes.push(last.s); repaintPad(); }
    }
    else if (act.dataset.act === 'clear'){
      // Clear is one undoable step, not a silent wipe of everything.
      if (strokes.length) undone.push({ act: 'clear', s: strokes.slice() });
      strokes = [];
      repaintPad();
    }
    else if (act.dataset.act === 'cancel'){ end(false); }
    else if (act.dataset.act === 'done'){ end(true); }
  });

  function start(existing){
    mode = true;
    strokes = existing ? JSON.parse(JSON.stringify(existing)) : [];
    // History belongs to one editing session; carrying it across would let
    // redo paste a stroke into a different drawing.
    undone = [];
    erasing = false;
    era.classList.remove('on');
    pad.classList.remove('era');
    tools.classList.add('on');
    pad.classList.add('on');
    // Before the paint and before the scroll: a host class that dims other
    // overlays has to be on the element while the first frame is drawn.
    if (opts.onStart) opts.onStart();
    paintStrokes(view, img, [], color, width);
    repaintPad();
    tools.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function end(keep){
    const out = (strokes || []).filter(s => s.p && s.p.length);
    mode = false; cur = null; erasing = false;
    tools.classList.remove('on');
    pad.classList.remove('on', 'era');
    era.classList.remove('on');
    strokes = []; undone = [];
    if (keep && doneCb) doneCb(out.length ? out : null);
    renderStatic(keep ? out : lastStatic);
    // Last, deliberately. A host that decides for itself what should be showing
    // over the image (the drawing you are about to attach, or the one on the
    // comment you have selected) repaints from its own state here and wins.
    if (opts.onEnd) opts.onEnd(keep);
  }

  const onResize = () => { mode ? repaintPad() : renderStatic(lastStatic); };
  window.addEventListener('resize', onResize);

  return {
    start,
    // Cancel and finish from outside: closing the page's stage or switching
    // revision abandons a drawing without a click on Cancel, and a host that
    // offers its own "done" affordance elsewhere (art.html's composer chip
    // toggles into one) needs the same escape hatch for Done.
    cancel: () => { if (mode) end(false); },
    finish: () => { if (mode) end(true); },
    isActive: () => mode,
    onDone: (cb) => { doneCb = cb; },
    setDoneLabel: (t) => { done.textContent = t; },
    renderStatic,
    destroy: () => {
      window.removeEventListener('resize', onResize);
      view.remove(); pad.remove(); tools.remove();
    },
  };
}
