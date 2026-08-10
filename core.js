// core.js — the layer every page of this site shares.
//
// S'notify (index.html) and Sn'art (art.html) are two views of the same thing:
// a band's versioned library, gated by one band password, with threaded
// comments hanging off whatever the version happens to be. That common half
// lives here — Supabase access, the band gate, the route parser, and the small
// helpers — so a second page costs a page's worth of code and not a second
// copy of the whole app. (A future S'nalbum sits on this same layer.)
//
// Deliberately a CLASSIC script, not a module: loaded before each page's own
// <script type="module">, every declaration here lands in the shared global
// scope, so the page scripts keep using `rpc`, `$`, `curBand` and friends
// exactly as they did when this was all one file. Nothing imports anything.
//
// Load it with a cache-busting query (core.js?v=N) — Pages caches hard.

// ---------- Page hooks ----------
// The three things the shared gate has to hand back to whichever page is
// running. Each page assigns its own before anything can happen; the defaults
// keep core.js standalone-safe (and testable) on a page that sets none.
const App = {
  init:     async () => {},   // (re)render for the current route — after login, logout, or a hashchange
  onLock:   () => {},         // hard gate went up: clear page chrome that must not show through
  onLogout: () => {},         // teardown before the band is forgotten (players, caches, selection)
};

// ---------- Small helpers ----------
const $ = (id) => document.getElementById(id);
const fmt = (s) => { if (!isFinite(s) || s < 0) s = 0; const m = Math.floor(s/60), x = Math.floor(s%60); return `${m}:${String(x).padStart(2,'0')}`; };
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const filename = (p) => decodeURIComponent(p.split('/').pop().replace(/\.[^.]+$/, ''));
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
// Read off <body>, not :root — themes set their variables on
// body[data-theme=…], and :root would only ever hand back the defaults.
function cssVar(n){ return getComputedStyle(document.body).getPropertyValue(n).trim(); }
const pageBase = () => location.href.split('#')[0].split('?')[0];
// Bind only if the page actually has that element — the two pages share this
// file but not every control.
function on(id, ev, fn){ const el = $(id); if (el) el.addEventListener(ev, fn); }

function timeago(ts){
  const s = Math.floor((Date.now()-ts)/1000);
  if (s<60) return 'just now';
  const m=Math.floor(s/60); if (m<60) return m+'m ago';
  const h=Math.floor(m/60); if (h<24) return h+'h ago';
  const d=Math.floor(h/24); if (d<30) return d+'d ago';
  return new Date(ts).toLocaleDateString();
}

// ---------- Supabase ----------
// Comments and the library are SITEWIDE — everyone in the band sees the same
// pool. Everything goes through password-checked RPCs, so a shared single-item
// link can show the thing but never reads or writes the band's comments.
const SUPA_URL = 'https://twgukeyoayfqldnojrkg.supabase.co';
const SUPA_KEY = 'sb_publishable_zIiAxxA5Zk1yRNzignANXA_rEp3vKdG';   // publishable — safe to ship
const supaOn = () => !!(SUPA_URL && SUPA_KEY);
async function supaFetch(path, opts = {}){
  const r = await fetch(SUPA_URL + path, { ...opts,
    headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY, ...(opts.headers || {}) } });
  if (!r.ok){
    let msg = 'Supabase ' + r.status;
    try { const j = await r.json(); msg = j.message || j.error || msg; } catch {}
    const e = new Error(msg); e.status = r.status; throw e;
  }
  return r;
}
// Call a database function. Arguments travel in the POST body, so a band
// password never lands in a URL, a log, or a browser history entry.
async function rpc(fn, args){
  const r = await supaFetch('/rest/v1/rpc/' + fn, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args || {}) });
  if (r.status === 204) return null;
  return r.json().catch(() => null);
}
// Same, with the current band + its password filled in — every library edit.
function libRpc(fn, args){
  if (!curBand || !bandPass(curBand)) throw new Error('Log in to your band first.');
  return rpc(fn, { b: curBand, p: bandPass(curBand), ...args });
}
// The operations that must touch storage objects with the service role live in
// Edge Functions (the inbox import, and library deletes).
async function edgeFn(name, body){
  const r = await fetch(`${SUPA_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY,
               'Content-Type': 'application/json' },
    body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || `${name} failed (${r.status})`);
  return j;
}
// Rows store the object path inside the 'tracks' bucket; the bucket is public
// by exact URL but not listable, so a link plays and a crawl finds nothing.
function publicUrl(p){
  if (!p) return null;
  if (/^(https?:|data:|blob:)/.test(p)) return p;
  return SUPA_URL + '/storage/v1/object/public/tracks/'
       + p.replace(/^tracks\//, '').split('/').map(encodeURIComponent).join('/');
}

// Which band's library this page is currently showing.
let curBand = null, curBandTitle = '';

// ---------- Per-band themes ----------
// A band can have its own look without forking the site: the theme file is
// scoped to body[data-theme=…] and every band not listed here gets the
// original styling. Applied as early as the band is known — from the URL
// before login, so the gate itself is already wearing the right coat.
const BAND_THEME = {
  lakehorse: 'dazzle',       // WWI ship dazzle camo — theme-dazzle.css
};
function applyTheme(band){
  setToolBand(band);
  const t = BAND_THEME[bandSlugOf(band || '')] || '';
  if (t) document.body.dataset.theme = t;
  else delete document.body.dataset.theme;
  if (t === 'dazzle') paintDazzle();
}

// ---------- Dazzle generator ----------
// Real dazzle camouflage is not a barcode. A hull was divided into irregular
// panels by straight cuts at conflicting angles, and each panel was painted
// either flat black/white or striped at ITS OWN angle with bands of uneven
// width — the point being that no two adjacent panels agree about which way
// the ship is facing. Repeating a single stripe pattern gets none of that, so
// the pattern is generated instead of written by hand.
//
// Everything is seeded, so a given surface paints the same way on every load
// (a page that reshuffles its camouflage on each render is a nightmare), while
// different surfaces get genuinely different schemes.

// mulberry32 — small, fast, and identical across browsers for a given seed.
function rng(seed){
  let a = seed >>> 0;
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Ships were painted in more than black and white — most schemes carried a
// mid grey or two, which is what lets shapes read as separate planes rather
// than as one flat cutout. `tones` is how many steps sit between the two ends.
function dazzlePalette(ink, ground, tones){
  const hex = (c) => {
    const m = String(c).trim().replace('#','');
    return m.length === 3 ? m.split('').map(x => parseInt(x+x,16)) : [0,2,4].map(i => parseInt(m.slice(i,i+2),16));
  };
  const a = hex(ink), b = hex(ground);
  const out = [];
  const n = Math.max(2, Math.min(4, tones|0));
  for (let i = 0; i < n; i++){
    const t = i / (n - 1);
    out.push('#' + a.map((v, j) => Math.round(v + (b[j] - v) * t).toString(16).padStart(2,'0')).join(''));
  }
  return out;                                   // [ink … ground]
}

// Cut a convex polygon with a line, keeping the side the normal points away
// from (Sutherland–Hodgman against a single edge).
function clipHalf(poly, nx, ny, d){
  const out = [];
  const dist = (pt) => nx * pt[0] + ny * pt[1] - d;
  for (let i = 0; i < poly.length; i++){
    const cur = poly[i], nxt = poly[(i + 1) % poly.length];
    const dc = dist(cur), dn = dist(nxt);
    if (dc <= 0) out.push(cur);
    if ((dc < 0 && dn > 0) || (dc > 0 && dn < 0)){
      const t = dc / (dc - dn);
      out.push([cur[0] + (nxt[0] - cur[0]) * t, cur[1] + (nxt[1] - cur[1]) * t]);
    }
  }
  return out;
}
const polyArea = (p) => Math.abs(p.reduce((s, cur, i) => {
  const n = p[(i + 1) % p.length];
  return s + (cur[0] * n[1] - n[0] * cur[1]);
}, 0)) / 2;

// Split the canvas into irregular panels by repeated cuts. Each cut runs
// through a point inside the panel it divides, at an angle picked from a set
// that deliberately conflicts.
function dazzlePanels(w, h, n, rand, conflict = 1){
  let panels = [[[0,0],[w,0],[w,h],[0,h]]];
  // At full conflict the cuts disagree as widely as possible; wound down, they
  // converge on one prevailing angle and the scheme calms into stripes across
  // a few big plates.
  const base = 104;
  const angles = [18, 62, 108, 143, 74, 127, 35, 158]
    .map(a => base + (a - base) * conflict);
  for (let i = 0; i < n; i++){
    // bias towards cutting the biggest panel, so nothing stays a huge slab
    panels.sort((a, b) => polyArea(b) - polyArea(a));
    const idx = Math.floor(rand() * Math.min(3, panels.length));
    const poly = panels[idx];
    const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
    const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
    // jitter the pivot so cuts don't all pass through panel centres
    const px = cx + (rand() - 0.5) * w * 0.35;
    const py = cy + (rand() - 0.5) * h * 0.35;
    const th = angles[Math.floor(rand() * angles.length)] * Math.PI / 180;
    const nx = Math.cos(th), ny = Math.sin(th);
    const d = nx * px + ny * py;
    const a = clipHalf(poly, nx, ny, d);
    const b = clipHalf(poly, -nx, -ny, -d);
    if (a.length >= 3 && b.length >= 3 && polyArea(a) > 60 && polyArea(b) > 60){
      panels.splice(idx, 1, a, b);
    }
  }
  return panels;
}

// One panel's paint: flat, or stripes at this panel's own angle with widths
// that never settle into a rhythm.
function dazzlePanelSVG(poly, i, rand, pal, scale, conflict, stripeBase){
  const pts = poly.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const span = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const flip = rand() < 0.22;                       // some panels stay unstriped
  // Two tones drawn from the palette: the plate and whatever is ruled on it.
  const gi = Math.floor(rand() * pal.length);
  let si = Math.floor(rand() * pal.length);
  if (si === gi) si = (gi + 1 + Math.floor(rand() * (pal.length - 1))) % pal.length;
  const ground = pal[gi], ink = pal[si];
  const base = flip ? ink : ground;
  let out = `<g clip-path="url(#dp${i})"><rect x="${(cx - span).toFixed(1)}" y="${(cy - span).toFixed(1)}" `
          + `width="${(span * 2).toFixed(1)}" height="${(span * 2).toFixed(1)}" fill="${base}"/>`;
  if (!flip){
    // Conflict also governs how far this panel's ruling may swing away from
    // the scheme's prevailing angle: at 0 every panel is ruled the same way.
    const ang = (stripeBase + (rand() - 0.5) * 360 * conflict).toFixed(1);
    out += `<g transform="rotate(${ang} ${cx.toFixed(1)} ${cy.toFixed(1)})">`;
    let x = cx - span;
    let guard = 0;
    while (x < cx + span && guard++ < 90){
      // Uneven bands: a wide one, a hairline, a medium. `varied` is how far
      // from a regular stripe pattern they are allowed to wander — at 0 the
      // panel is a plain ruled field, at 1 no two bands are alike.
      const bar = (3 + rand() * 8.5) * scale;
      const gap = (3 + rand() * 10) * scale;
      out += `<rect x="${x.toFixed(1)}" y="${(cy - span).toFixed(1)}" `
           + `width="${bar.toFixed(1)}" height="${(span * 2).toFixed(1)}" fill="${ink}"/>`;
      x += bar + gap;
    }
    out += `</g>`;
  }
  return { defs: `<clipPath id="dp${i}"><polygon points="${pts}"/></clipPath>`, body: out + `</g>` };
}

// A whole scheme, as standalone SVG markup.
function dazzleSVG({ w = 1200, h = 120, seed = 1, cuts = 7, ink = '#ffffff',
                     ground = '#08080a', scale = 1, stretch = true,
                     tones = 2, conflict = 1 } = {}){
  const rand = rng(seed);
  const pal = dazzlePalette(ink, ground, tones);
  const panels = dazzlePanels(w, h, cuts, rand, conflict);
  const stripeBase = rand() * 360;                  // the scheme's prevailing ruling
  let defs = '', body = '';
  panels.forEach((poly, i) => {
    const part = dazzlePanelSVG(poly, i, rand, pal, scale, conflict, stripeBase);
    defs += part.defs; body += part.body;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" `
       + `viewBox="0 0 ${w} ${h}"${stretch ? ' preserveAspectRatio="none"' : ''}>`
       + `<defs>${defs}</defs><rect width="${w}" height="${h}" fill="${ground}"/>${body}</svg>`;
}
// …and the same thing ready to drop into background-image.
const dazzleURL = (opts) =>
  `url("data:image/svg+xml,${encodeURIComponent(dazzleSVG(opts)).replace(/'/g, '%27')}")`;

// Paint the theme's surfaces. The CSS keeps using var(--dazzle) and friends —
// only what those variables contain changes.
function paintDazzle(){
  const b = document.body.style;
  b.setProperty('--dazzle',     dazzleURL({ w: 1400, h: 140, seed: 20260810, cuts: 8, scale: 1.1 }));   // 2 tones, full conflict
  b.setProperty('--dazzle-2',   dazzleURL({ w: 1400, h: 120, seed: 771903,   cuts: 9, scale: 0.72 }));
  b.setProperty('--dazzle-narrow', dazzleURL({ w: 120, h: 900, seed: 40412,  cuts: 7, scale: 0.9 }));
  b.setProperty('--dazzle-bg',  dazzleURL({ w: 1600, h: 1000, seed: 5150,    cuts: 11, scale: 2.2,
                                            ink: 'rgba(255,255,255,.055)', ground: 'rgba(0,0,0,0)' }));
}

// ---------- Deep-link routing ----------
// Canonical (what the 🔗 buttons copy):  ?b=<band>&s=<folder>&v=<name>
// Query strings survive messaging apps and link-preview redirectors, which
// routinely strip #fragments. Old hash links (#/p/../s/..) still parse.
// Band sub-URLs (/<band>/) are stub pages that redirect here with ?b=.
function parseRoute(){
  const seg = location.hash.replace(/^#\/?/, '').split('/').map(x => { try { return decodeURIComponent(x); } catch { return x; } });
  const r = { band: null, album: null, project: null, song: null, version: null };
  for (let i = 0; i + 1 < seg.length; i += 2){
    if (seg[i] === 'p') r.project = seg[i+1];
    else if (seg[i] === 's') r.song = seg[i+1];
    else if (seg[i] === 'v') r.version = seg[i+1];
  }
  if (!r.project && !r.song){
    const q = new URLSearchParams(location.search);
    r.band = q.get('b'); r.project = q.get('p'); r.song = q.get('s'); r.version = q.get('v');
    r.album = q.get('al');
  }
  return r;
}
let route = parseRoute();
window.addEventListener('hashchange', () => { route = parseRoute(); App.init(); });

// ---------- Band login (gate) ----------
// Checked server-side: a Supabase RPC compares band + password against the
// bands table, so no credentials live in this page or the repo. Being a
// static site, the files themselves remain technically reachable by direct
// URL — the gate keeps the *site* band-only, it isn't DRM.
// Every library read and write is an RPC that re-checks the password, so the
// password itself is what we keep — not a "logged in" flag. (v1 stored a bare
// 1; those entries read as logged-out and ask for the password once.)
// One entry per band, shared by every page on this origin: logging into
// S'notify logs you into Sn'art too.
const AUTH_KEY = 'mp_auth_v1';
const bandSlugOf = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
function auths(){ try { return JSON.parse(localStorage.getItem(AUTH_KEY) || '{}'); } catch { return {}; } }
const bandPass = (b) => { const v = auths()[b]; return typeof v === 'string' ? v : ''; };
const isAuthed = (b) => !!bandPass(b);
function grantAuth(b, pass){
  const a = auths(); a[b] = pass;
  localStorage.setItem(AUTH_KEY, JSON.stringify(a));
  localStorage.setItem('mp_last_band', b);
}
function clearAuth(b){
  const a = auths(); delete a[b];
  localStorage.setItem(AUTH_KEY, JSON.stringify(a));
}
// The band password was wrong or has changed since we cached it.
const isAuthErr = (e) => e && (e.status === 401 || e.status === 403 || /band password/i.test(e.message || ''));

function unlockView(){ document.body.classList.remove('locked'); $('gateModal').classList.remove('open'); }

// Fuzzy band lookup happens server-side: there is no public manifest to scan,
// and the RPC deliberately reveals at most one band name per query.
async function resolveBand(input){
  if (!String(input || '').trim()) return { kind: 'empty' };
  try {
    const r = await rpc('resolve_band', { q: input });
    return r && r.kind !== 'none'
      ? { kind: r.kind, band: { slug: r.slug, title: r.title } }
      : { kind: 'none' };
  } catch { return { kind: 'offline' }; }
}

let pendingBand = null;
function gateStep(n){
  $('gateStep1').style.display = n === 1 ? 'block' : 'none';
  $('gateStep2').style.display = n === 2 ? 'block' : 'none';
  $('gateSuggest').style.display = 'none';
  $('gateErr1').textContent = ''; $('gateErr2').textContent = '';
  setTimeout(() => (n === 1 ? $('gateName') : $('gatePass')).focus(), 0);
}
function showGate(bandSlug, hard = true, bandTitle = null){
  applyTheme(bandSlug);
  if (hard){
    document.body.classList.remove('authed');
    document.body.classList.add('locked');
    App.onLock();
  }
  // Prefill only when the gate is reached via a specific band link; the main
  // URL's home box always starts empty.
  $('gateName').value = bandTitle || bandSlug || '';
  $('gatePass').value = '';
  gateStep(1);
  $('gateModal').classList.add('open');
}

// Step 1: resolve the typed band name.
async function gateNext(){
  $('gateSuggest').style.display = 'none'; $('gateErr1').textContent = '';
  const res = await resolveBand($('gateName').value);
  if (res.kind === 'empty'){ $('gateErr1').textContent = 'Enter your band name.'; return; }
  if (res.kind === 'offline'){ $('gateErr1').textContent = 'Could not reach the login service — check your connection.'; return; }
  if (res.kind === 'exact'){ proceedToBand(res.band); return; }
  if (res.kind === 'suggest'){
    $('gateSuggest').style.display = 'block';
    $('gateSuggest').innerHTML =
      `<div class="hint">Did you mean <b>${esc(res.band.title || res.band.slug)}</b>? ` +
      `<span class="linky" id="sugYes">Yes</span> &nbsp;·&nbsp; <span class="linky" id="sugNo">No</span></div>`;
    $('sugYes').onclick = () => proceedToBand(res.band);
    $('sugNo').onclick = () => { $('gateSuggest').style.display = 'none'; $('gateName').select(); };
    return;
  }
  // Unknown band — point them to the owner.
  $('gateSuggest').style.display = 'block';
  $('gateSuggest').innerHTML =
    `<div class="hint">No band by that name here. Email ` +
    `<a href="mailto:bunjumun@gmail.com?subject=S'notify%20band%20page">bunjumun@gmail.com</a> ` +
    `to set one up.</div>`;
}
// Already logged in on this device → straight in; otherwise ask the password.
function proceedToBand(band){
  pendingBand = band;
  if (isAuthed(band.slug)) return enterBand(band.slug);
  $('gateBandLabel').textContent = band.title || band.slug;
  gateStep(2);
}
async function enterBand(slug){
  applyTheme(slug);
  history.replaceState(null, '', pageBase() + '?b=' + encodeURIComponent(slug));
  route = parseRoute();
  await App.init();
}
// Step 2: password check for the resolved band.
async function gateGo(){
  if (!pendingBand) return gateStep(1);
  const pass = $('gatePass').value.trim().toLowerCase();
  if (!pass){ $('gateErr2').textContent = 'Enter the password.'; return; }
  $('gateGo').disabled = true; $('gateErr2').textContent = '';
  try {
    if ((await rpc('band_pass_ok', { b: pendingBand.slug, p: pass })) !== true){
      $('gateErr2').textContent = 'That’s not it — check with the band.'; return;
    }
    grantAuth(pendingBand.slug, pass);
    $('gatePass').value = '';
    await enterBand(pendingBand.slug);
  } catch {
    $('gateErr2').textContent = 'Could not reach the login service — check your connection.';
  } finally { $('gateGo').disabled = false; }
}
on('gateNext', 'click', gateNext);
on('gateGo', 'click', gateGo);
on('gateBack', 'click', () => gateStep(1));
on('gateName', 'keydown', (e) => { if (e.key === 'Enter'){ e.preventDefault(); gateNext(); } });
on('gatePass', 'keydown', (e) => { if (e.key === 'Enter'){ e.preventDefault(); gateGo(); } });
// Voluntary login (from a shared link): backdrop click closes the gate.
on('gateModal', 'click', (e) => {
  if (e.target === $('gateModal') && !document.body.classList.contains('locked'))
    $('gateModal').classList.remove('open');
});
on('mixLogin', 'click', () => showGate(curBand, false));

// ---------- Site admin ----------
// Gated separately from band logins: this password only unlocks adding new
// bands/libraries, never library contents. Session-only (sessionStorage) —
// closing the tab logs it out, unlike band logins which persist in
// localStorage. The server re-checks the password on every admin_create_band
// call, so a stale/cleared session just falls back to the login step.
//
// It lives here rather than on one page because the ⚙ button belongs at the
// top of every page. The markup is injected instead of copied into three
// files, so there is exactly one version of it to keep right.
const ADMIN_KEY = 'mp_admin_v1';
const adminPass = () => sessionStorage.getItem(ADMIN_KEY) || '';

document.body.insertAdjacentHTML('beforeend', `
  <div class="modal-back" id="adminModal">
    <div class="modal" style="max-width:380px">
      <h2>Site admin</h2>

      <!-- First-time setup -->
      <div id="adminSetup" style="display:none">
        <div class="hint" style="margin-bottom:6px">First time here — set an admin
          password and a recovery question. There's no email to reset through,
          so don't lose the answer.</div>
        <label>Admin password</label>
        <input type="password" id="adminSetupPass" autocomplete="off" />
        <label>Recovery question</label>
        <input type="text" id="adminSetupQ" placeholder="e.g. What was the first band's name?" maxlength="200" />
        <label>Answer</label>
        <input type="text" id="adminSetupA" autocomplete="off" maxlength="200" />
        <div class="status err" id="adminSetupErr"></div>
        <div class="actions">
          <button class="btn ghost" id="adminSetupClose">Close</button>
          <button class="btn primary" id="adminSetupGo">Set up</button>
        </div>
      </div>

      <!-- Login -->
      <div id="adminLoginStep" style="display:none">
        <label>Admin password</label>
        <input type="password" id="adminPass" autocomplete="off" />
        <div class="status err" id="adminLoginErr"></div>
        <div class="hint" style="margin-top:6px"><span class="linky" id="adminForgotLink">Forgot password?</span></div>
        <div class="actions">
          <button class="btn ghost" id="adminLoginClose">Close</button>
          <button class="btn primary" id="adminLoginGo">Log in</button>
        </div>
      </div>

      <!-- Recovery -->
      <div id="adminRecover" style="display:none">
        <div class="hint" id="adminRecoverQ" style="margin-bottom:6px"></div>
        <label>Answer</label>
        <input type="text" id="adminRecoverA" autocomplete="off" />
        <label>New admin password</label>
        <input type="password" id="adminRecoverNew" autocomplete="off" />
        <div class="status err" id="adminRecoverErr"></div>
        <div class="actions">
          <button class="btn ghost" id="adminRecoverBack">Back</button>
          <button class="btn primary" id="adminRecoverGo">Reset password</button>
        </div>
      </div>

      <!-- Add a band, once logged in -->
      <div id="adminPanel" style="display:none">
        <div class="hint" style="margin-bottom:10px">Rewrite this page's wording in place — titles, taglines, the descriptions on the doors.</div>
        <button class="btn ghost" id="adminTextGo" style="width:100%">✎ Edit text on this page</button>
        <button class="btn ghost" id="adminToolsGo" style="width:100%;margin-top:8px">▨ Tools menu — add or remove</button>
        <div class="hint" style="margin:14px 0 6px;border-top:1px solid var(--line);padding-top:14px">Add another project as a new band library.</div>
        <label>Band name</label>
        <input type="text" id="adminBandTitle" placeholder="e.g. Some Other Band" maxlength="120" />
        <label>URL slug</label>
        <input type="text" id="adminBandSlug" placeholder="e.g. someotherband" autocomplete="off" autocapitalize="none" maxlength="60" />
        <div class="hint" id="adminSlugHint">Lowercase letters, numbers and hyphens only — this is what goes in the link.</div>
        <label>Band password</label>
        <input type="text" id="adminBandPass" autocomplete="off" maxlength="120" />
        <div class="status err" id="adminPanelErr"></div>
        <div class="status" id="adminPanelStatus"></div>
        <div class="actions">
          <button class="btn ghost" id="adminClose">Close</button>
          <button class="btn primary" id="adminCreateGo">Create band</button>
        </div>
      </div>
    </div>
  </div>`);

function adminHideAll(){
  ['adminSetup', 'adminLoginStep', 'adminRecover', 'adminPanel']
    .forEach(id => $(id).style.display = 'none');
}
function adminShowPanel(){
  adminHideAll(); $('adminPanel').style.display = 'block';
  $('adminBandTitle').value = ''; $('adminBandSlug').value = ''; $('adminBandPass').value = '';
  $('adminPanelErr').textContent = ''; $('adminPanelStatus').textContent = '';
}
async function adminShowLoggedOut(){
  adminHideAll();
  if (adminPass()){ adminShowPanel(); return; }
  let status = { configured: true };
  try { status = await rpc('admin_status', {}); } catch {}
  if (status && status.configured === false){
    $('adminSetup').style.display = 'block';
    $('adminSetupPass').value = ''; $('adminSetupQ').value = ''; $('adminSetupA').value = '';
    $('adminSetupErr').textContent = '';
  } else {
    $('adminLoginStep').style.display = 'block';
    $('adminPass').value = ''; $('adminLoginErr').textContent = '';
  }
}
function openAdmin(){ $('adminModal').classList.add('open'); adminShowLoggedOut(); }
function closeAdmin(){ $('adminModal').classList.remove('open'); }
async function adminDoSetup(){
  const password = $('adminSetupPass').value;
  const question = $('adminSetupQ').value.trim();
  const answer = $('adminSetupA').value.trim();
  if (!password || !question || !answer){ $('adminSetupErr').textContent = 'All three fields are required.'; return; }
  $('adminSetupGo').disabled = true;
  try {
    await rpc('admin_setup', { password, question, answer });
    sessionStorage.setItem(ADMIN_KEY, password);
    adminShowPanel();
  } catch (e) { $('adminSetupErr').textContent = e.message || 'Setup failed.'; }
  finally { $('adminSetupGo').disabled = false; }
}
async function adminDoLogin(){
  const password = $('adminPass').value;
  if (!password){ $('adminLoginErr').textContent = 'Enter the admin password.'; return; }
  $('adminLoginGo').disabled = true;
  try {
    const ok = await rpc('admin_login', { password });
    if (ok !== true){ $('adminLoginErr').textContent = 'Wrong password.'; return; }
    sessionStorage.setItem(ADMIN_KEY, password);
    adminShowPanel();
  } catch { $('adminLoginErr').textContent = 'Could not reach the login service.'; }
  finally { $('adminLoginGo').disabled = false; }
}
async function adminShowRecover(){
  adminHideAll(); $('adminRecover').style.display = 'block';
  $('adminRecoverA').value = ''; $('adminRecoverNew').value = ''; $('adminRecoverErr').textContent = '';
  try {
    const status = await rpc('admin_status', {});
    $('adminRecoverQ').textContent = (status && status.question) || '';
  } catch { $('adminRecoverQ').textContent = ''; }
}
async function adminDoRecover(){
  const answer = $('adminRecoverA').value;
  const newPassword = $('adminRecoverNew').value;
  if (!answer || !newPassword){ $('adminRecoverErr').textContent = 'Answer and new password are both required.'; return; }
  $('adminRecoverGo').disabled = true;
  try {
    const ok = await rpc('admin_recover', { answer, new_password: newPassword });
    if (!ok){ $('adminRecoverErr').textContent = 'That answer doesn’t match.'; return; }
    sessionStorage.setItem(ADMIN_KEY, newPassword);
    adminShowPanel();
  } catch (e) { $('adminRecoverErr').textContent = e.message || 'Reset failed.'; }
  finally { $('adminRecoverGo').disabled = false; }
}
async function adminDoCreate(){
  const title = $('adminBandTitle').value.trim();
  const bandSlug = $('adminBandSlug').value.trim().toLowerCase();
  const bandPassword = $('adminBandPass').value;
  if (!bandSlug || !bandPassword){ $('adminPanelErr').textContent = 'Slug and band password are required.'; return; }
  $('adminCreateGo').disabled = true; $('adminPanelErr').textContent = ''; $('adminPanelStatus').textContent = '';
  try {
    await rpc('admin_create_band', { admin_password: adminPass(), slug: bandSlug, title, band_password: bandPassword });
    $('adminPanelStatus').textContent = `Created — share this link: ${pageBase()}?b=${encodeURIComponent(bandSlug)}`;
    $('adminBandTitle').value = ''; $('adminBandSlug').value = ''; $('adminBandPass').value = '';
  } catch (e) {
    if (/wrong admin password/i.test(e.message || '')){
      sessionStorage.removeItem(ADMIN_KEY); adminShowLoggedOut(); return;
    }
    $('adminPanelErr').textContent = e.message || 'Could not create the band.';
  } finally { $('adminCreateGo').disabled = false; }
}
// Two ways in on every page: the ⚙ in the header once you're through the gate,
// and the link on the gate itself for when you aren't.
on('adminOpenLink', 'click', openAdmin);
on('adminBtn', 'click', openAdmin);
on('adminSetupClose', 'click', closeAdmin);
on('adminLoginClose', 'click', closeAdmin);
on('adminClose', 'click', closeAdmin);
on('adminSetupGo', 'click', adminDoSetup);
on('adminLoginGo', 'click', adminDoLogin);
on('adminForgotLink', 'click', adminShowRecover);
on('adminRecoverBack', 'click', adminShowLoggedOut);
on('adminRecoverGo', 'click', adminDoRecover);
on('adminCreateGo', 'click', adminDoCreate);
on('adminTextGo', 'click', startTextEdit);
on('adminToolsGo', 'click', openToolAdmin);
on('adminModal', 'click', (e) => { if (e.target === $('adminModal')) closeAdmin(); });

// ---------- Editable page text ----------
// Any element marked data-txt="some.key" has its wording stored in the
// site_text table (schema v8) and can be rewritten in place by the site admin.
// The markup keeps the built-in wording, so the page is never blank and never
// depends on the fetch landing — a stored value simply wins when there is one.
let siteText = {};
function applySiteText(){
  document.querySelectorAll('[data-txt]').forEach(el => {
    const v = siteText[el.dataset.txt];
    if (typeof v === 'string' && v.length) el.textContent = v;
  });
}
async function loadSiteText(){
  try { siteText = (await rpc('get_site_text', {})) || {}; } catch { siteText = {}; }
  applySiteText();
  loadToolList();
  renderToolMenu();
}

// Admin edit mode: the marked elements become editable in place. No modal, no
// separate form — you rewrite the page on the page.
let textEditing = false;
function textTargets(){ return [...document.querySelectorAll('[data-txt]')]; }
function startTextEdit(){
  if (textEditing) return;
  textEditing = true;
  closeAdmin();
  document.body.classList.add('texting');
  textTargets().forEach(el => {
    el.dataset.orig = el.textContent;
    el.contentEditable = 'true';
    el.spellcheck = false;
  });
  $('textBar').classList.add('open');
  $('textBarMsg').textContent = `${textTargets().length} editable pieces of text on this page.`;
}
function stopTextEdit(revert){
  if (!textEditing) return;
  textEditing = false;
  textTargets().forEach(el => {
    if (revert && el.dataset.orig !== undefined) el.textContent = el.dataset.orig;
    el.removeAttribute('contenteditable');
    delete el.dataset.orig;
  });
  document.body.classList.remove('texting');
  $('textBar').classList.remove('open');
}
async function saveTextEdit(){
  // Only what actually changed travels; blanking a field clears the override
  // and the built-in wording comes back on the next load.
  const entries = {};
  textTargets().forEach(el => {
    const now = el.textContent.trim();
    if (now !== (el.dataset.orig || '').trim()) entries[el.dataset.txt] = now;
  });
  if (!Object.keys(entries).length){ stopTextEdit(false); return; }
  $('textSave').disabled = true;
  $('textBarMsg').textContent = 'Saving…';
  try {
    siteText = (await rpc('set_site_text', { admin_password: adminPass(), entries })) || siteText;
  } catch (e) {
    $('textBarMsg').textContent = e.message || 'Could not save.';
    $('textSave').disabled = false;
    return;
  }
  $('textSave').disabled = false;
  stopTextEdit(false);
  applySiteText();
}

document.body.insertAdjacentHTML('beforeend', `
  <div id="textBar">
    <span id="textBarMsg"></span>
    <span style="flex:1"></span>
    <button class="btn ghost" id="textCancel">Cancel</button>
    <button class="btn primary" id="textSave">Save text</button>
  </div>`);
on('textCancel', 'click', () => stopTextEdit(true));
on('textSave', 'click', saveTextEdit);

// ---------- Tools ----------
// A drawer of small graphic tools that belong to the site rather than to any
// one band's library — hence a menu in the header of every page rather than a
// feature of the player or the art board. The first is the dazzle generator
// the theme itself uses; anything made here saves to your own machine.
// Built-in tools run in a modal here; the rest are standalone pages under
// tools/ that open in their own tab, because they are full applications with
// their own canvases, keyboard maps and controllers — wrapping them in a
// dialog would only get in their way.
//
// This is only the STARTING list. The live one is whatever the site admin has
// saved (see the tools manager below), stored as JSON in the same site_text
// table the editable page copy uses — so adding a tool needs no deploy.
// Nothing ships site-wide. Every one of these is Lakehorse's own workshop —
// their graphic tools, their generator, their visualiser — so a band with no
// set of its own gets no Tools menu at all rather than someone else's kit.
const BUILTIN_TOOLS = [];

// Per-band sets, same idea as BAND_THEME.
const BAND_TOOLS = {
  lakehorse: [
    { id: 'dazzle', label: '▨  Dazzle camouflage generator',
      hint: 'Panels, stripe angles, seed — save as SVG or PNG' },
    { href: 'tools/visualizer.html', label: '◉  Visualizer',
      hint: 'Live audio-reactive visuals, gamepad or MIDI driven' },
    { href: 'tools/moire-maker.html', label: '◎  Moiré pattern toy',
      hint: 'Two line fields, live interference' },
    { href: 'tools/moire-zip.html', label: '⧉  Moiré colour separation',
      hint: 'Split an image per channel and export the set as a ZIP' },
    { href: 'tools/line-displacer.html', label: '≋  Image line displacer',
      hint: 'Redraw a photograph as displaced lines' },
    { href: 'tools/pen-separator.html', label: '✎  Highlighter plotter separator',
      hint: 'Mk2 — split artwork into pen layers for a plotter' },
    { href: 'tools/vj-mixer.html', label: '◐  VJ mixer',
      hint: 'Two live generators, crossfade, mic reactive, gamepad or MIDI' },
  ],
};

let toolList = BUILTIN_TOOLS.slice();
let toolBand = '';                      // whose menu is on screen

// A link in this menu is whatever an admin typed, so it is checked before it
// is ever put in an href: same-origin relative paths and plain http(s) only,
// which keeps javascript: and data: URLs out of the menu entirely.
function safeHref(u){
  const v = String(u || '').trim();
  if (!v || v.startsWith('//')) return '';
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return '';        // any other scheme
  return v;
}

// ---------- What the admin has changed ----------
// The saved value is a set of OVERRIDES, never a replacement list. That is the
// whole point: a tool added to the shipped set in code appears by itself,
// because nothing in the saved state says otherwise, while an admin's
// hiding, renaming and ordering survive every deploy.
//
//   { hidden: [key…], order: [key…], edits: {key: {label,hint,href}}, added: [tool…] }
//
// A tool's key is its id for the built-in panel, or its href otherwise.
const toolKey = (t) => t.id || t.href || '';
const EMPTY_OVERRIDES = { hidden: [], order: [], edits: {}, added: [] };

function parseOverrides(raw){
  if (!raw) return null;
  let v;
  try { v = JSON.parse(raw); } catch { return null; }

  // The first version of this feature saved a plain array — the whole menu.
  // Read it as an ordering (plus any renames and additions it carried) and
  // hide nothing, so tools that have shipped since then are not lost.
  if (Array.isArray(v)){
    const o = { hidden: [], order: [], edits: {}, added: [] };
    v.forEach(t => {
      const k = toolKey(t);
      if (!k) return;
      o.order.push(k);
      if (t.label || t.hint) o.edits[k] = { label: t.label, hint: t.hint };
      if (t.href) o.edits[k].href = t.href;
    });
    return o;
  }
  if (typeof v !== 'object') return null;
  return {
    hidden: Array.isArray(v.hidden) ? v.hidden.map(String) : [],
    order:  Array.isArray(v.order)  ? v.order.map(String)  : [],
    edits:  (v.edits && typeof v.edits === 'object') ? v.edits : {},
    added:  Array.isArray(v.added)
      ? v.added.filter(t => t && safeHref(t.href))
               .map(t => ({ href: t.href, label: String(t.label || '').slice(0, 80),
                            hint: String(t.hint || '').slice(0, 140) }))
      : [],
  };
}
function shippedFor(band){
  const b = bandSlugOf(band || '');
  return (BAND_TOOLS[b] || BUILTIN_TOOLS).map(t => ({ ...t }));
}
// Shipped set, plus anything added, with the admin's edits applied, the hidden
// ones dropped and the rest in the saved order. Tools the saved order has
// never seen keep their shipped position at the end.
function resolveTools(band, ov, includeHidden){
  const o = ov || EMPTY_OVERRIDES;
  const all = shippedFor(band).concat(o.added.map(t => ({ ...t })));
  const out = all.map(t => {
    const k = toolKey(t);
    const e = o.edits[k] || {};
    return {
      ...t,
      label: e.label !== undefined ? e.label : t.label,
      hint:  e.hint  !== undefined ? e.hint  : t.hint,
      href:  (t.id ? t.href : (e.href !== undefined ? e.href : t.href)),
      hidden: o.hidden.includes(k),
    };
  });
  const rank = (t) => {
    const i = o.order.indexOf(toolKey(t));
    return i === -1 ? 1e6 + all.findIndex(x => toolKey(x) === toolKey(t)) : i;
  };
  out.sort((a, b) => rank(a) - rank(b));
  return includeHidden ? out : out.filter(t => !t.hidden);
}
function loadToolList(){
  toolList = resolveTools(toolBand, parseOverrides(siteText['tools.' + toolBand]), false);
}
// Called whenever the band becomes known, so the menu follows the login.
function setToolBand(band){
  const b = bandSlugOf(band || '');
  if (b === toolBand) return;
  toolBand = b;
  loadToolList(); renderToolMenu();
}
function renderToolMenu(){
  const m = $('toolMenu');
  if (!m) return;
  // A band with no tools shouldn't carry a button that opens nothing.
  const btn = $('toolsBtn');
  if (btn) btn.style.display = toolList.length ? '' : 'none';
  m.innerHTML = toolList.map(t => t.href
    ? `<a class="toolitem" href="${esc(safeHref(t.href))}" target="_blank" rel="noopener">
         <b>${esc(t.label)}</b><span>${esc(t.hint)}</span></a>`
    : `<button class="toolitem" data-tool="${esc(t.id)}">
         <b>${esc(t.label)}</b><span>${esc(t.hint)}</span></button>`).join('')
    || `<div class="toolitem"><b>No tools</b><span>Add one from Site admin → Tools</span></div>`;
}

document.body.insertAdjacentHTML('beforeend', `
  <div id="toolMenu"></div>

  <div class="modal-back" id="dazzleModal">
    <div class="modal" style="max-width:760px">
      <h2>Dazzle camouflage generator</h2>
      <div class="hint" style="margin-bottom:12px">Straight cuts at conflicting
        angles divide the canvas into panels; each panel is painted flat or
        striped at its own angle, with bands of uneven width. Same idea the
        Admiralty used to make a ship's heading hard to read.</div>

      <div class="dz-preview"><div id="dzPreview"></div></div>

      <div class="dz-grid">
        <label>Panels <span class="dz-val" id="dzCutsVal">8</span>
          <input type="range" id="dzCuts" min="1" max="18" value="8" /></label>
        <label>Stripe scale <span class="dz-val" id="dzScaleVal">1.0</span>
          <input type="range" id="dzScale" min="3" max="45" value="10" /></label>
        <label>Tones <span class="dz-val" id="dzTonesVal">2</span>
          <input type="range" id="dzTones" min="2" max="4" value="2" /></label>
        <label>Conflict <span class="dz-val" id="dzConflictVal">100%</span>
          <input type="range" id="dzConflict" min="0" max="100" value="100" /></label>
        <label>Seed <span class="dz-val" id="dzSeedVal">1</span>
          <input type="range" id="dzSeed" min="1" max="9999" value="1" /></label>
        <label class="check"><input type="checkbox" id="dzInvert" /> Invert (black on white)</label>
      </div>

      <div class="actions">
        <button class="btn ghost" id="dzClose">Close</button>
        <button class="btn ghost" id="dzRandom">Randomise</button>
        <button class="btn ghost" id="dzSvg">Save SVG</button>
        <button class="btn primary" id="dzPng">Save PNG</button>
      </div>
    </div>
  </div>

  <!-- Tools manager (site admin) -->
  <div class="modal-back" id="toolAdminModal">
    <div class="modal" style="max-width:640px">
      <h2>Tools menu</h2>
      <div class="hint" style="margin-bottom:10px">What appears under ▨ Tools. A
        link can be a page in this site (<code>tools/thing.html</code>) or anywhere
        on the web. Removing the generator only hides it from the menu.</div>
      <label>These tools are for</label>
      <select id="toolScope"></select>
      <div class="hint" id="toolScopeHint" style="margin-bottom:12px"></div>
      <div id="toolRows"></div>
      <div class="tool-add">
        <input type="text" id="toolNewLabel" placeholder="Name" maxlength="80" />
        <input type="text" id="toolNewHref" placeholder="tools/my-tool.html  or  https://…" maxlength="400" />
        <input type="text" id="toolNewHint" placeholder="One line about what it does" maxlength="140" />
        <button class="btn ghost" id="toolAdd">Add</button>
      </div>
      <div class="status" id="toolAdminStatus"></div>
      <div class="actions">
        <button class="btn ghost" id="toolRestore">Show all</button>
        <button class="btn ghost" id="toolAdminClose">Close</button>
        <button class="btn primary" id="toolAdminSave">Save menu</button>
      </div>
    </div>
  </div>`);

// --- the dazzle workshop ---
// The tool the theme paints itself with, exposed with the handful of knobs
// that actually change the character of a scheme.
// The canvas is fixed at 2:1. Pixel dimensions were a slider for no reason —
// the SVG is resolution-independent and the PNG is written at twice this, so
// the only thing width and height ever changed was the aspect. What they cost
// was two of the six controls that do change how a scheme looks.
const DZ_W = 1200, DZ_H = 600;
const dzOpts = () => ({
  w: DZ_W, h: DZ_H, seed: +$('dzSeed').value,
  cuts: +$('dzCuts').value, scale: +$('dzScale').value / 10,
  tones:    +$('dzTones').value,               // steps between the two extremes
  conflict: +$('dzConflict').value / 100,     // how far the angles disagree
  ink:    $('dzInvert').checked ? '#08080a' : '#ffffff',
  ground: $('dzInvert').checked ? '#ffffff' : '#08080a',
  stretch: false,
});
function dzRender(){
  $('dzCutsVal').textContent  = $('dzCuts').value;
  $('dzScaleVal').textContent = (+$('dzScale').value / 10).toFixed(1);
  $('dzTonesVal').textContent    = $('dzTones').value;
  $('dzConflictVal').textContent = $('dzConflict').value + '%';
  $('dzSeedVal').textContent  = $('dzSeed').value;
  $('dzPreview').innerHTML = dazzleSVG(dzOpts());
}
function openDazzleTool(){
  $('dazzleModal').classList.add('open');
  dzRender();
}
['dzCuts','dzScale','dzTones','dzConflict','dzSeed','dzInvert'].forEach(id => on(id, 'input', dzRender));
on('dzRandom', 'click', () => {
  $('dzSeed').value  = 1 + Math.floor(Math.random() * 9999);
  $('dzCuts').value  = 4 + Math.floor(Math.random() * 12);
  $('dzScale').value = 5 + Math.floor(Math.random() * 30);
  $('dzTones').value    = 2 + Math.floor(Math.random() * 3);
  $('dzConflict').value = 30 + Math.floor(Math.random() * 70);
  dzRender();
});
on('dzClose', 'click', () => $('dazzleModal').classList.remove('open'));
on('dazzleModal', 'click', (e) => { if (e.target === $('dazzleModal')) $('dazzleModal').classList.remove('open'); });

function saveBlob(blob, name){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const dzName = (ext) => `dazzle-${$('dzSeed').value}-${$('dzCuts').value}p.${ext}`;
on('dzSvg', 'click', () => saveBlob(new Blob([dazzleSVG(dzOpts())], { type: 'image/svg+xml' }), dzName('svg')));
// PNG goes through a canvas at the scheme's own pixel size — what you see in
// the preview is what lands in the file.
on('dzPng', 'click', () => {
  const o = dzOpts();
  const img = new Image();
  img.onload = () => {
    const cv = document.createElement('canvas');
    cv.width = o.w * 2; cv.height = o.h * 2;      // 2400×1200 — worth printing
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    cv.toBlob(b => b && saveBlob(b, dzName('png')), 'image/png');
  };
  img.src = 'data:image/svg+xml,' + encodeURIComponent(dazzleSVG(o));
});

// Opening the menu. This lives next to the render so the two cannot be
// separated again: an earlier edit replaced the block that held it and left
// the button wired to nothing.
function toolMenuOpen(open){
  const m = $('toolMenu'), b = $('toolsBtn');
  if (!m || !b) return;
  if (open){
    const r = b.getBoundingClientRect();
    m.style.top = (r.bottom + 6) + 'px';
    m.style.left = Math.max(8, Math.min(r.left, innerWidth - 300)) + 'px';
  }
  m.classList.toggle('open', open);
  b.classList.toggle('on', open);
}
on('toolsBtn', 'click', (e) => { e.stopPropagation(); toolMenuOpen(!$('toolMenu').classList.contains('open')); });
document.addEventListener('click', (e) => {
  if (!e.target.closest('#toolMenu') && !e.target.closest('#toolsBtn')) toolMenuOpen(false);
});
on('toolMenu', 'click', (e) => {
  if (e.target.closest('a.toolitem')){ toolMenuOpen(false); return; }   // opens its own tab
  const b = e.target.closest('[data-tool]');
  if (!b) return;
  toolMenuOpen(false);
  if (b.dataset.tool === 'dazzle') openDazzleTool();
});

// --- the tools manager ---
// The draft is the resolved list WITH the hidden ones still in it, so the
// panel shows everything that exists and lets you turn each on or off.
let toolDraft = [], toolEditing = -1, toolAdded = [];

function renderToolRows(){
  $('toolRows').innerHTML = toolDraft.map((t, i) => i === toolEditing ? `
    <div class="tool-row editing" data-i="${i}">
      <div class="tool-edit">
        <input type="text" class="te-label" value="${esc(t.label)}" maxlength="80" placeholder="Name" />
        ${t.id ? `<div class="hint">Built in — opens in a panel here, so it has no link to change.</div>`
               : `<input type="text" class="te-href" value="${esc(t.href || '')}" maxlength="400" placeholder="tools/my-tool.html  or  https://…" />`}
        <input type="text" class="te-hint" value="${esc(t.hint || '')}" maxlength="140" placeholder="One line about what it does" />
        <div class="tool-editbtns">
          <button class="btn ghost" data-cancel="${i}">Cancel</button>
          <button class="btn primary" data-done="${i}">Done</button>
        </div>
      </div>
    </div>` : `
    <div class="tool-row ${t.hidden ? 'off' : ''}" data-i="${i}">
      <div class="tool-move">
        <span class="ec ${i === 0 ? 'disabled' : ''}" data-move="up" title="Move up">▲</span>
        <span class="ec ${i === toolDraft.length - 1 ? 'disabled' : ''}" data-move="down" title="Move down">▼</span>
      </div>
      <div class="tool-what">
        <b>${esc(t.label)}</b>
        <span>${t.hint ? esc(t.hint) + ' · ' : ''}${t.href ? esc(t.href) : 'built in — opens here'}</span>
      </div>
      <span class="ec" data-eye="${i}" title="${t.hidden ? 'Show in the menu' : 'Hide from the menu'}">${t.hidden ? '◌' : '◉'}</span>
      <span class="ec" data-edit="${i}" title="Rename or re-describe">✎</span>
    </div>`).join('') || `<div class="hint">No tools yet.</div>`;
}

function toolScopeKey(){ return $('toolScope').value; }
function syncToolScope(){
  const key = toolScopeKey();
  const band = key === 'tools.custom' ? '' : key.slice('tools.'.length);
  toolEditing = -1;
  const ov = parseOverrides(siteText[key]);
  toolAdded = ov ? ov.added.map(t => ({ ...t })) : [];
  toolDraft = resolveTools(band, ov, true);
  $('toolScopeHint').textContent = key === 'tools.custom'
    ? 'Every band that has no menu of its own.'
    : `Only ${curBandTitle || band}. Other bands keep the site-wide menu.`;
  renderToolRows();
}
function openToolAdmin(){
  closeAdmin();
  const opts = [];
  if (toolBand) opts.push(`<option value="tools.${esc(toolBand)}">${esc(curBandTitle || toolBand)} only</option>`);
  opts.push(`<option value="tools.custom">All bands (site-wide)</option>`);
  $('toolScope').innerHTML = opts.join('');
  $('toolAdminStatus').textContent = ''; $('toolAdminStatus').className = 'status';
  syncToolScope();
  $('toolAdminModal').classList.add('open');
}
on('toolScope', 'change', syncToolScope);

on('toolRows', 'click', (e) => {
  // Hiding, not removing: a tool you turn off stays in this panel so you can
  // turn it back on, and nothing about it is thrown away.
  const eye = e.target.closest('[data-eye]');
  if (eye){ const i = +eye.dataset.eye; toolDraft[i].hidden = !toolDraft[i].hidden; renderToolRows(); return; }
  const ed = e.target.closest('[data-edit]');
  if (ed){ toolEditing = +ed.dataset.edit; renderToolRows(); return; }
  const cancel = e.target.closest('[data-cancel]');
  if (cancel){ toolEditing = -1; renderToolRows(); return; }
  const done = e.target.closest('[data-done]');
  if (done){
    const row = done.closest('.tool-row.editing'), i = +done.dataset.done;
    const label = row.querySelector('.te-label').value.trim();
    const hrefEl = row.querySelector('.te-href');
    const href = hrefEl ? safeHref(hrefEl.value) : undefined;
    if (!label || (hrefEl && !href)){
      $('toolAdminStatus').className = 'status err';
      $('toolAdminStatus').textContent = label
        ? 'That link is not usable — use a path in this site or an http(s) address.'
        : 'Give the tool a name.';
      return;
    }
    toolDraft[i] = { ...toolDraft[i], label, hint: row.querySelector('.te-hint').value.trim() };
    if (hrefEl) toolDraft[i].href = href;
    toolEditing = -1;
    $('toolAdminStatus').className = 'status'; $('toolAdminStatus').textContent = '';
    renderToolRows();
    return;
  }
  const mv = e.target.closest('[data-move]');
  if (!mv || mv.classList.contains('disabled')) return;
  const i = +mv.closest('.tool-row').dataset.i;
  const j = mv.dataset.move === 'up' ? i - 1 : i + 1;
  [toolDraft[i], toolDraft[j]] = [toolDraft[j], toolDraft[i]];
  renderToolRows();
});

on('toolAdd', 'click', () => {
  const label = $('toolNewLabel').value.trim();
  const href = safeHref($('toolNewHref').value);
  if (!label || !href){
    $('toolAdminStatus').className = 'status err';
    $('toolAdminStatus').textContent = href
      ? 'Give the tool a name.'
      : 'That link is not usable — use a path in this site or an http(s) address.';
    return;
  }
  const t = { label, href, hint: $('toolNewHint').value.trim(), hidden: false };
  toolAdded.push({ label: t.label, href: t.href, hint: t.hint });
  toolDraft.push(t);
  $('toolNewLabel').value = $('toolNewHref').value = $('toolNewHint').value = '';
  $('toolAdminStatus').className = 'status'; $('toolAdminStatus').textContent = '';
  renderToolRows();
});

// "Show everything" rather than "restore": ordering and names are kept, only
// the hidden flags are cleared.
on('toolRestore', 'click', () => { toolDraft.forEach(t => t.hidden = false); renderToolRows(); });
on('toolAdminClose', 'click', () => $('toolAdminModal').classList.remove('open'));
on('toolAdminModal', 'click', (e) => { if (e.target === $('toolAdminModal')) $('toolAdminModal').classList.remove('open'); });

on('toolAdminSave', 'click', async () => {
  const key = toolScopeKey();
  const band = key === 'tools.custom' ? '' : key.slice('tools.'.length);
  // Save only the differences from what ships, so a tool added in code later
  // arrives on its own instead of waiting for someone to press a button.
  const shipped = shippedFor(band);
  const overrides = { hidden: [], order: [], edits: {}, added: toolAdded };
  toolDraft.forEach(t => {
    const k = toolKey(t);
    if (!k) return;
    overrides.order.push(k);
    if (t.hidden) overrides.hidden.push(k);
    const base = shipped.find(x => toolKey(x) === k) || toolAdded.find(x => toolKey(x) === k) || {};
    const e = {};
    if (t.label !== base.label) e.label = t.label;
    if ((t.hint || '') !== (base.hint || '')) e.hint = t.hint;
    if (!t.id && t.href !== base.href) e.href = t.href;
    if (Object.keys(e).length) overrides.edits[k] = e;
  });

  $('toolAdminSave').disabled = true;
  $('toolAdminStatus').className = 'status';
  $('toolAdminStatus').textContent = 'Saving…';
  try {
    siteText = await rpc('set_site_text', {
      admin_password: adminPass(),
      entries: { [key]: JSON.stringify(overrides) },
    }) || siteText;
    loadToolList(); renderToolMenu();
    const off = overrides.hidden.length;
    $('toolAdminStatus').textContent = (key === 'tools.custom'
      ? 'Saved — live for every band without its own menu.'
      : `Saved — live for ${curBandTitle || band}.`) + (off ? ` ${off} hidden.` : '');
    setTimeout(() => $('toolAdminModal').classList.remove('open'), 900);
  } catch (e) {
    $('toolAdminStatus').className = 'status err';
    $('toolAdminStatus').textContent = e.message || 'Could not save.';
  } finally { $('toolAdminSave').disabled = false; }
});

// Log out of the current band → back to the home page (band-name entry).
function logout(){
  clearAuth(curBand);
  localStorage.removeItem('mp_band_pass');   // pre-v3 key — clear it out
  if (localStorage.getItem('mp_last_band') === curBand) localStorage.removeItem('mp_last_band');
  App.onLogout();
  document.body.classList.remove('authed', 'editing');
  applyTheme(null);
  history.replaceState(null, '', pageBase());
  route = parseRoute();
  App.init();
}
on('logoutBtn', 'click', logout);

// Theme the very first paint, before any page code runs.
applyTheme(route.band);
loadSiteText();
