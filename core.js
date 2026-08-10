// core.js — the layer every page of this site shares.
//
// S'notify (index.html) and S'nart (art.html) are two views of the same thing:
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
function cssVar(n){ return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
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
// S'notify logs you into S'nart too.
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

// Log out of the current band → back to the home page (band-name entry).
function logout(){
  clearAuth(curBand);
  localStorage.removeItem('mp_band_pass');   // pre-v3 key — clear it out
  if (localStorage.getItem('mp_last_band') === curBand) localStorage.removeItem('mp_last_band');
  App.onLogout();
  document.body.classList.remove('authed', 'editing');
  history.replaceState(null, '', pageBase());
  route = parseRoute();
  App.init();
}
on('logoutBtn', 'click', logout);
