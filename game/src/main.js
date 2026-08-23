// Boot.
//
// The single most important line in this file is the one inside the DIVE IN
// handler that resumes the AudioContext. Browsers hard-block audio until a real
// user gesture, and that gesture is the entire reason a start screen exists at
// all — it isn't decoration, it's the only legal place to turn the sound on.
//
// Audio is loaded through a guarded dynamic import. If the network is down, or
// Supabase is unreachable, or the browser does something unexpected with Web
// Audio, the game still runs — silently, but it runs. A band's website should
// never show a blank canvas because a track 404'd.

import { Game } from './core/Game.js';
import { CFG } from '../config.js';
import { KEYS } from './core/Keys.js';
import { PadMenu } from './input/PadMenu.js';

const canvas = document.getElementById('c');

// ------------------------------------------------------------------ preflight
//
// Ask before building, because THREE.WebGLRenderer throwing is a dead end and
// this is a question with a good answer. Plenty of real visitors have no usable
// WebGL — in-app browsers inside social apps, old Android, desktop Firefox with
// hardware acceleration switched off — and they arrive by tapping a link on a
// band's page, which makes them exactly the people worth catching gently.
function webglOk() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return false;
    // Hand it straight back. Browsers cap how many live WebGL contexts a page
    // may hold, and a probe that quietly keeps one is a probe that can cause
    // the very failure it was checking for.
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/** The net lives in index.html; never let its absence become the error. */
function bail(headline, detail) {
  if (typeof window.__lakehorseBail === 'function') {
    window.__lakehorseBail(headline, detail);
  }
}

if (!webglOk()) {
  bail(
    "This browser can't run the water.",
    'The Swimulator needs WebGL, and this browser either lacks it or has it ' +
    'switched off. <b>Did you open this inside another app?</b> Instagram, ' +
    'Facebook and messages lists all carry their own browser about with them. ' +
    'Open this in Safari or Chrome instead and it should run.');
  throw new Error('no webgl');   // stops the rest of this module cold
}

let game;
try {
  game = new Game(canvas);
} catch (e) {
  console.error('[lakehorse]', e);
  bail(
    'The water would not load.',
    'Something broke while building the lake. A reload often fixes it. The ' +
    'site updates in place, and a half-cached update can land like this.');
  throw e;
}

// ------------------------------------------------------------- the pad's menus
//
// Attached here rather than inside Game, and attached NOW rather than on dive,
// because the first screen a pad player meets is the start screen and the panel
// that most needs a pad is the pause screen, which is up while the game loop is
// stopped. It polls on its own frame and does nothing at all unless an overlay
// is visible, so it costs one getGamepads() call while you are swimming.
const padMenu = new PadMenu(game);
padMenu.attach();

// --------------------------------------------------------------- start screen

const startEl = document.getElementById('start');
const modesEl = document.getElementById('modes');
const diveBtn = document.getElementById('dive');
const loadState = document.getElementById('loadState');

function buildModes() {
  modesEl.innerHTML = '';
  for (const m of game.difficulty.list()) {
    const b = document.createElement('button');
    b.className = `mode${m.id === 'chill' ? ' chill' : ''}`;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(m.id === game.difficulty.name));
    b.innerHTML = m.id === 'chill'
      ? `<b>${m.label}</b><small>Drift and look around. You won't drown.</small>`
      : `<b>${m.label} · ${m.tankLabel}</b><small>${MODE_BLURB[m.id]}</small>`;
    b.onclick = () => {
      game.difficulty.set(m.id);
      game.breath.reset();
      buildModes();
    };
    modesEl.appendChild(b);
  }
}

const MODE_BLURB = {
  easy: 'Room to explore.',
  medium: 'The intended run.',
  hard: 'Thin air, sparse pickings.',
};

buildModes();

// The audio engine is built NOW, on page load, not on the tap.
//
// It used to be imported inside the DIVE IN handler, and that quietly broke the
// thing the handler exists for. `await import(...)` on a cold load is a network
// fetch, and a tap's permission to make noise does not survive an await on iOS —
// by the time the module landed the gesture was spent, every play() was refused,
// and the phone stayed silent with nothing in the console to say why.
//
// Constructing an AudioContext outside a gesture is fine: it simply comes up
// suspended, which is what unlock() resumes. So the whole engine is standing by
// before the visitor has finished reading the start screen, and the handler can
// unlock it synchronously.
const audioReady = import('./audio/AudioDirector.js')
  .then(({ AudioDirector }) => new AudioDirector())
  .catch((e) => { console.warn('[lakehorse] audio unavailable, continuing silent', e); return null; });

let audio = null;
audioReady.then((a) => { audio = a; });

let started = false;
diveBtn.addEventListener('click', () => {
  if (started) return;
  started = true;
  diveBtn.disabled = true;
  loadState.textContent = 'flooding the chamber…';

  // First statement, no await in front of it: this is the only moment the
  // browser will let us turn the sound on. unlock() is built to do its
  // gesture-bound work before its own first await for the same reason.
  audio?.unlock();

  // Everything else can take its time. The game does not wait on the network to
  // start — Game treats `audio` as optional throughout, so it attaches late
  // without a special case.
  bootAudio();
  startEl.classList.add('hide');
  game.start();
});

async function bootAudio() {
  try {
    const audio = await audioReady;
    if (!audio) return;
    // Normally a no-op — the tap above already did it. This is the path where
    // the module was still in flight when the button was pressed.
    await audio.unlock();
    game.audio = audio;
    armSilentAudioRescue(audio);
    wireVolumes(audio);

    // The record announces itself on every change, and the ⏭ skips. Only the
    // button skips: the pill stays on screen now, and a label you can brush
    // past that silently changes the song is a trap rather than a control.
    audio.onTrack = (t, i, n) => game.hud.nowPlaying(t, i, n);
    // Optional chaining because a missing button must cost you the button, not
    // the album: this used to throw straight past loadMusic() into the catch
    // below, which then reported "audio unavailable" for a control that isn't
    // load-bearing.
    const skipBtn = document.getElementById('npSkip');
    if (skipBtn) skipBtn.onclick = (e) => { e.stopPropagation(); audio.skip(); };

    // Tracks stream in behind the game rather than holding up the dive; the
    // procedural bed covers the gap so it's never silent.
    audio.loadMusic().then((n) => {
      if (!n) console.info('[lakehorse] music.json listed no playable tracks — running on the procedural bed');
      else console.info(`[lakehorse] running order: ${n} track${n === 1 ? '' : 's'}`);
    }).catch((e) => console.warn('[lakehorse] music load failed', e));
  } catch (e) {
    console.warn('[lakehorse] audio unavailable, continuing silent', e);
  }
}

/**
 * The one thing a controller is not allowed to do.
 *
 * Gamepad input does not count as a user gesture anywhere. Pressing A on DIVE IN
 * starts the game perfectly well, and then `ctx.resume()` is refused and the lake
 * comes up silent with nothing in the console to explain it — which, in a game
 * built around a record, is close to the worst failure available.
 *
 * It cannot be fixed from here; the browser is right and the rule is the rule.
 * So it is made visible instead: if the context did not actually come up running,
 * say so once on the HUD and take the first touch, click or key as the gesture.
 * Costs nothing on every normal load, because there the context is already
 * running and this returns immediately.
 */
function armSilentAudioRescue(audio) {
  if (!audio?.ctx || audio.ctx.state === 'running') return;
  game.hud.say('Tap once to turn the sound on. A controller is not allowed to.', { seconds: 6 });
  const wake = async () => {
    try { await audio.unlock(); } catch { /* nothing else to try */ }
    if (audio.ctx.state === 'running') {
      removeEventListener('pointerdown', wake);
      removeEventListener('keydown', wake);
      game.hud.say('Sound on.', { seconds: 1.5 });
    }
  };
  addEventListener('pointerdown', wake);
  addEventListener('keydown', wake);
}

// ------------------------------------------------------------------- settings

const settingsEl = document.getElementById('settings');
document.getElementById('btnSettings').onclick = () => game.togglePause();
document.getElementById('btnResume').onclick = () => game.togglePause();

const setDiff = document.getElementById('setDiff');
for (const m of game.difficulty.list()) {
  const o = document.createElement('option');
  o.value = m.id;
  o.textContent = `${m.label} · ${m.tankLabel}`;
  setDiff.appendChild(o);
}
setDiff.value = game.difficulty.name;
setDiff.onchange = () => {
  game.difficulty.set(setDiff.value);
  game.hud.say('Applies on your next run.', { seconds: 2.5 });
};

const setQuality = document.getElementById('setQuality');
setQuality.value = localStorage.getItem(KEYS.quality) || 'auto';
setQuality.onchange = () => {
  const v = setQuality.value;
  localStorage.setItem(KEYS.quality, v);
  game.setQuality(v === 'auto' ? game._guessQuality() : v);
};
if (setQuality.value !== 'auto') game.setQuality(setQuality.value);

const setInvert = document.getElementById('setInvert');
setInvert.checked = localStorage.getItem(KEYS.invert) === '1';
game.input.invertPitch = setInvert.checked;
setInvert.onchange = () => {
  game.input.invertPitch = setInvert.checked;
  try { localStorage.setItem(KEYS.invert, setInvert.checked ? '1' : '0'); } catch { /* private mode */ }
};

document.getElementById('btnRecentre').onclick = () => {
  game.tilt?.recentre();
  game.hud.say('Recentred.', { seconds: 1.5 });
};

function wireVolumes(audio) {
  const map = [
    ['volMusic', 'music'],
    ['volSfx', 'sfx'],
    ['volAmb', 'ambience'],
  ];
  for (const [id, bus] of map) {
    const el = document.getElementById(id);
    const saved = localStorage.getItem(KEYS.vol(bus));
    el.value = saved !== null ? saved : CFG.audio.volumes[bus];
    audio.setVolume(bus, parseFloat(el.value));
    el.oninput = () => {
      audio.setVolume(bus, parseFloat(el.value));
      localStorage.setItem(KEYS.vol(bus), el.value);
    };
  }
}

// ---------------------------------------------------------------------- death

document.getElementById('btnRetry').onclick = () => game.retry();
document.getElementById('btnMenu').onclick = () => location.reload();

// ---------------------------------------------------------------------- misc

// Ask a fish. The button is the discoverable route; H is the one you use once
// you know it's there.
document.getElementById('btnHint').onclick = () => game.clues.ask();

// Esc pauses; the settings panel doubles as the pause screen.
addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && started) {
    // Escape backs out of whatever is on top before it touches the game state,
    // or closing the log would silently unpause underneath it.
    if (!document.getElementById('logbook').classList.contains('hide')) return game.logbook.hide();
    if (!document.getElementById('lorebook').classList.contains('hide')) return game.loreHistory.hide();
    if (!document.getElementById('reward').classList.contains('hide')) return game.reward.hide();
    game.togglePause();
  }
  if (e.code === 'KeyH' && started && game.state === 'play') game.clues.ask();
});

// ?debug shows fps, draw calls, uTrip and the seed. Shift+R from there wipes
// progress, which is how the opening gets re-tested without clearing site data.
if (new URLSearchParams(location.search).has('debug')) {
  game.debug = true;
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyR' && e.shiftKey) {
      game.progress.reset();
      game.hud.say('Progress wiped. Reload to replay the opening.', { seconds: 4 });
    }
  });
}

// Losing the tab mid-run shouldn't cost breath.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.state === 'play') game.togglePause();
});

window.__lakehorse = game; // handy from the console; harmless in production
// Exposed for the same reason, and for one specific one: a controller cannot be
// simulated from a test harness, but PadMenu can be stepped by hand with a
// stubbed navigator.getGamepads(), which is how its navigation was verified
// without a pad in the room.
window.__padMenu = padMenu;
