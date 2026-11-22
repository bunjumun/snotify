// Tests for data/player-box.js against a fake box. Run: node test/player-box.test.js
'use strict';
const assert = require('assert');
const B = require('../data/player-box.js');

// A fake /api/player: records calls, answers with a mutable status.
function fakeBox() {
  const box = {
    calls: [],
    status: { ok: true, built: true, connected: true, speaker: 'ML301', state: 'stopped',
              track: '', position: 0, duration: 0, volume: 1, ended: 0, underruns: 0, error: '' },
    refuse: null,
    timers: [],
    fetch(url, init) {
      box.calls.push([init.method || 'GET', url]);
      if (box.refuse && url.indexOf('/play') >= 0) {
        return Promise.resolve({ ok: false, json: () => Promise.resolve({ ok: false, error: box.refuse }) });
      }
      if (url.indexOf('/play?') >= 0) Object.assign(box.status, { state: 'playing', duration: 100 });
      return Promise.resolve({ ok: true, json: () => Promise.resolve(Object.assign({}, box.status)) });
    },
    setInterval(fn) { box.timers.push(fn); return box.timers.length; },
    clearInterval(id) { box.timers[id - 1] = null; },
    tick() { box.timers.forEach((t) => t && t()); return new Promise((r) => setTimeout(r, 0)); }
  };
  return box;
}

function events() {
  const e = { log: [] };
  e.progress = (p, d, playing) => e.log.push(['progress', p, d, playing]);
  e.status = (t) => e.log.push(['status', t]);
  e.ended = () => e.log.push(['ended']);
  return e;
}

const tests = {
  async 'play posts the encoded name and starts polling'() {
    const box = fakeBox();
    const b = B.create(box);
    b.connect(events());
    await b.play('Mango Tree World.wav');
    assert.deepStrictEqual(box.calls[0], ['POST', '/api/player/play?name=Mango%20Tree%20World.wav']);
    assert.strictEqual(box.timers.filter(Boolean).length, 1);
  },

  async 'progress comes from polls'() {
    const box = fakeBox();
    const b = B.create(box);
    const e = events();
    b.connect(e);
    await b.play('a.wav');
    box.status.position = 12.5;
    await box.tick();
    assert.deepStrictEqual(e.log.filter((x) => x[0] === 'progress').pop(), ['progress', 12.5, 100, true]);
  },

  async 'a bumped ended counter fires ended once and stops polling'() {
    const box = fakeBox();
    const b = B.create(box);
    const e = events();
    b.connect(e);
    await b.play('a.wav');
    box.status.ended = 1;
    box.status.state = 'stopped';
    await box.tick();
    await box.tick();
    assert.strictEqual(e.log.filter((x) => x[0] === 'ended').length, 1);
    assert.strictEqual(box.timers.filter(Boolean).length, 0);
  },

  async 'an ended count from before play is not an end'() {
    const box = fakeBox();
    box.status.ended = 7;
    const b = B.create(box);
    const e = events();
    b.connect(e);
    await b.play('a.wav');
    await box.tick();
    assert.strictEqual(e.log.filter((x) => x[0] === 'ended').length, 0);
  },

  async 'a refused play rejects with the box reason'() {
    const box = fakeBox();
    box.refuse = 'WAV is not 16-bit; convert it with song-prep';
    const b = B.create(box);
    b.connect(events());
    await assert.rejects(b.play('a.wav'), /16-bit/);
  },

  async 'a missing speaker is said once, not every second'() {
    const box = fakeBox();
    box.status.connected = false;
    const b = B.create(box);
    const e = events();
    b.connect(e);
    await b.play('a.wav');
    await box.tick();
    await box.tick();
    const said = e.log.filter((x) => x[0] === 'status' && /not connected/.test(x[1]));
    assert.strictEqual(said.length, 1);
  },

  async 'volume and seek are posted'() {
    const box = fakeBox();
    const b = B.create(box);
    b.connect(events());
    await b.setVolume(0.5);
    await b.seek(30);
    assert.deepStrictEqual(box.calls.map((c) => c[1]), ['/api/player/volume?v=0.5', '/api/player/seek?t=30']);
  },

  async 'stop posts stop and stops polling'() {
    const box = fakeBox();
    const b = B.create(box);
    b.connect(events());
    await b.play('a.wav');
    await b.stop();
    assert.strictEqual(box.calls.pop()[1], '/api/player/stop');
    assert.strictEqual(box.timers.filter(Boolean).length, 0);
  },

  async 'probe is false for a box without Bluetooth or an old box'() {
    const no = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, built: false }) });
    const old = () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    const yes = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, built: true }) });
    assert.strictEqual(await B.probe(no), false);
    assert.strictEqual(await B.probe(old), false);
    assert.strictEqual(await B.probe(yes), true);
  }
};

(async () => {
  let failed = 0;
  for (const [name, fn] of Object.entries(tests)) {
    try { await fn(); console.log('ok   ' + name); }
    catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); }
  }
  console.log(failed ? failed + ' failed' : 'all passed');
  process.exit(failed ? 1 : 0);
})();
