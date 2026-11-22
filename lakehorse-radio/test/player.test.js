// Tests for data/player.js against a fake backend. Run: node test/player.test.js
'use strict';
const assert = require('assert');
const P = require('../data/player.js');

function fakeBackend({ available = true, failPlay = false } = {}) {
  const calls = [];
  const b = {
    name: 'fake',
    available,
    events: null,
    calls,
    connect(e) { b.events = e; },
    play(track, next) {
      calls.push(['play', track, next]);
      return failPlay ? Promise.reject(new Error('boom')) : Promise.resolve(true);
    },
    pause() { calls.push(['pause']); },
    resume() { calls.push(['resume']); },
    seek(s) { calls.push(['seek', s]); },
    setVolume(v) { calls.push(['volume', v]); },
    stop() { calls.push(['stop']); }
  };
  return b;
}

const tests = {
  async 'play hands the backend the track and the one after it'() {
    const b = fakeBackend();
    const p = P.createPlayer(b);
    p.setTracks(['a.wav', 'b.wav', 'c.aac']);
    await p.play('b.wav');
    assert.deepStrictEqual(b.calls.at(-1), ['play', 'b.wav', 'c.aac']);
    assert.strictEqual(p.current(), 'b.wav');
  },

  async 'next walks the list and stops at the end'() {
    const b = fakeBackend();
    const p = P.createPlayer(b);
    p.setTracks(['a.wav', 'b.wav']);
    await p.play('a.wav');
    assert.strictEqual(p.next(), true);
    assert.deepStrictEqual(b.calls.at(-1), ['play', 'b.wav', null]);
    assert.strictEqual(p.next(), false);
  },

  async 'a track ending plays the next one, and the last clears the current track'() {
    const b = fakeBackend();
    const seen = [];
    const p = P.createPlayer(b, { track: (n) => seen.push(n) });
    p.setTracks(['a.wav', 'b.wav']);
    await p.play('a.wav');
    b.events.ended();
    assert.strictEqual(p.current(), 'b.wav');
    b.events.ended();
    assert.strictEqual(p.current(), null);
    assert.deepStrictEqual(seen, ['a.wav', 'b.wav', null]);
  },

  async 'toggle pauses and resumes, following what the backend reports'() {
    const b = fakeBackend();
    const p = P.createPlayer(b);
    p.setTracks(['a.wav']);
    await p.play('a.wav');
    b.events.progress(1, 10, true);
    p.toggle();
    assert.deepStrictEqual(b.calls.at(-1), ['pause']);
    b.events.progress(1, 10, false);
    p.toggle();
    assert.deepStrictEqual(b.calls.at(-1), ['resume']);
  },

  'pause, resume and seek do nothing before anything has played'() {
    const b = fakeBackend();
    const p = P.createPlayer(b);
    const before = b.calls.length;
    p.pause(); p.resume(); p.seek(5);
    assert.strictEqual(b.calls.length, before);
  },

  'volume is clamped to 0..1 and applied to the backend from the start'() {
    const b = fakeBackend();
    const p = P.createPlayer(b, {}, 0.4);
    assert.deepStrictEqual(b.calls[0], ['volume', 0.4]);
    assert.strictEqual(p.setVolume(3), 1);
    assert.strictEqual(p.setVolume(-1), 0);
    assert.strictEqual(p.setVolume('nonsense'), 1);
    assert.deepStrictEqual(b.calls.at(-1), ['volume', 1]);
  },

  async 'a backend that cannot play says so instead of throwing'() {
    const b = fakeBackend({ available: false });
    const status = [];
    const p = P.createPlayer(b, { status: (t) => status.push(t) });
    assert.strictEqual(await p.play('a.wav'), false);
    assert.strictEqual(b.calls.filter((c) => c[0] === 'play').length, 0);
    assert.strictEqual(status.length, 1);
  },

  async 'a failed play is reported and leaves the player not playing'() {
    const b = fakeBackend({ failPlay: true });
    const status = [];
    const p = P.createPlayer(b, { status: (t) => status.push(t) });
    assert.strictEqual(await p.play('a.wav'), false);
    assert.strictEqual(p.isPlaying(), false);
    assert.match(status[0], /boom/);
  },

  async 'the on-box stub fits the same shape and reports itself unavailable'() {
    require('../data/player-box.js');
    const box = globalThis.LakehorseBoxPlayer.create();
    const p = P.createPlayer(box);
    assert.strictEqual(box.available, false);
    assert.strictEqual(await p.play('a.wav'), false);
  }
};

(async () => {
  let failed = 0;
  for (const [name, fn] of Object.entries(tests)) {
    try { await fn(); console.log('ok  ', name); }
    catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); }
  }
  if (failed) { console.log(failed + ' failed'); process.exit(1); }
})();
