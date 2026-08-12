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

const canvas = document.getElementById('c');
const game = new Game(canvas);

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

let started = false;
diveBtn.addEventListener('click', async () => {
  if (started) return;
  started = true;
  diveBtn.disabled = true;
  loadState.textContent = 'flooding the chamber…';

  // Audio MUST be unlocked synchronously inside this handler.
  await bootAudio();

  startEl.classList.add('hide');
  game.start();
});

async function bootAudio() {
  try {
    const { AudioDirector } = await import('./audio/AudioDirector.js');
    const audio = new AudioDirector();
    await audio.unlock();          // resume the context — needs this gesture
    game.audio = audio;
    wireVolumes(audio);

    // The record announces itself on every change, and the pill skips.
    audio.onTrack = (t, i, n) => game.hud.nowPlaying(t, i, n);
    document.getElementById('np').onclick = () => audio.skip();

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
setQuality.value = localStorage.getItem('lakehorse.quality') || 'auto';
setQuality.onchange = () => {
  const v = setQuality.value;
  localStorage.setItem('lakehorse.quality', v);
  game.setQuality(v === 'auto' ? game._guessQuality() : v);
};
if (setQuality.value !== 'auto') game.setQuality(setQuality.value);

const setInvert = document.getElementById('setInvert');
setInvert.checked = localStorage.getItem('lakehorse.invert') === '1';
game.input.invertPitch = setInvert.checked;
setInvert.onchange = () => {
  game.input.invertPitch = setInvert.checked;
  try { localStorage.setItem('lakehorse.invert', setInvert.checked ? '1' : '0'); } catch { /* private mode */ }
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
    const saved = localStorage.getItem(`lakehorse.vol.${bus}`);
    el.value = saved !== null ? saved : CFG.audio.volumes[bus];
    audio.setVolume(bus, parseFloat(el.value));
    el.oninput = () => {
      audio.setVolume(bus, parseFloat(el.value));
      localStorage.setItem(`lakehorse.vol.${bus}`, el.value);
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
