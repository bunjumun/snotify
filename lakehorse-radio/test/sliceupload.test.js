// Tests for data/sliceupload.js: the pause / resume / cancel / retry control
// flow of a sliced upload, driven by a fake box. Run: node test/sliceupload.test.js
'use strict';
const assert = require('assert');
const S = require('../data/sliceupload.js');

const SLICE = S.SLICE_BYTES;
const tick = () => new Promise((r) => setImmediate(r));

// A box that stores what it is sent. `script(offset, call)` may override one answer.
function fakeBox(totalSize, script) {
  const box = { received: 0, calls: [], aborted: 0 };
  box.post = (blob, name, offset, size, onProgress, track) => {
    box.calls.push(offset);
    let aborted = false;
    return new Promise((resolve, reject) => {
      track(() => { aborted = true; box.aborted++; reject(new Error('cancelled')); });
      setImmediate(() => {
        if (aborted) return;
        const custom = script && script(offset, box.calls.length);
        if (custom) return custom.reject ? reject(custom.reject) : resolve(custom);
        box.received = offset + blob.size;
        onProgress(1);
        const done = box.received >= size;
        resolve({ status: 200, d: { ok: true, done: done, received: box.received } });
      });
    });
  };
  return box;
}

function make(box, extra) {
  const said = [];
  const u = S.create(Object.assign({
    post: box.post, delay: () => Promise.resolve(),
    say: (t) => said.push(t), megabytes: (n) => n + 'B'
  }, extra));
  return { u, said };
}

const blobOf = (n) => ({ size: n, slice: (a, b) => ({ size: b - a }) });

const tests = {
  async 'sends a song in slices and finishes'() {
    const box = fakeBox(SLICE * 2 + 10);
    const { u } = make(box);
    const d = await u.run(blobOf(SLICE * 2 + 10), 'a.wav', () => {});
    assert.strictEqual(d.done, true);
    assert.deepStrictEqual(box.calls, [0, SLICE, SLICE * 2]);
  },

  async 'pause stops after the slice in flight and resume carries on from the same offset'() {
    const box = fakeBox(SLICE * 4);
    const { u } = make(box);
    const events = [];
    const p = u.run(blobOf(SLICE * 4), 'a.wav', () => {}, (isPaused, at) => events.push([isPaused, at]));
    u.pause();                       // while slice 0 is in flight
    await tick(); await tick(); await tick();
    assert.deepStrictEqual(box.calls, [0], 'only the in-flight slice was sent');
    assert.deepStrictEqual(events, [[true, SLICE]]);
    await tick();
    assert.deepStrictEqual(box.calls, [0], 'still waiting');
    u.resume();
    const d = await p;
    assert.strictEqual(d.done, true);
    assert.deepStrictEqual(box.calls, [0, SLICE, SLICE * 2, SLICE * 3]);
    assert.deepStrictEqual(events, [[true, SLICE], [false, SLICE]]);
  },

  async 'cancel while running aborts the slice in flight and rejects as cancelled'() {
    const box = fakeBox(SLICE * 4);
    const { u } = make(box);
    const p = u.run(blobOf(SLICE * 4), 'a.wav', () => {});
    await tick();                    // slice 0 is now on the wire
    u.cancel();
    await assert.rejects(p, (e) => e.cancelled === true);
    assert.strictEqual(box.aborted, 1);
    assert.deepStrictEqual(box.calls, [0]);
  },

  async 'cancel while paused wakes the wait and stops without sending more'() {
    const box = fakeBox(SLICE * 4);
    const { u } = make(box);
    const p = u.run(blobOf(SLICE * 4), 'a.wav', () => {});
    u.pause();
    await tick(); await tick(); await tick();
    u.cancel();
    await assert.rejects(p, (e) => e.cancelled === true);
    assert.deepStrictEqual(box.calls, [0]);
  },

  async 'a slice that fails to arrive is sent again, then the song completes'() {
    const script = (offset, n) => (n === 2 ? { reject: new Error('the connection to the box dropped') } : null);
    const box2 = fakeBox(SLICE * 2, script);
    const m = make(box2);
    const d = await m.u.run(blobOf(SLICE * 2), 'a.wav', () => {});
    assert.strictEqual(d.done, true);
    assert.deepStrictEqual(box2.calls, [0, SLICE, SLICE]);
    assert.ok(m.said.some((t) => /retrying from/.test(t)));
  },

  async 'a 409 with a smaller received offset resumes from where the card is'() {
    const script = (offset, n) => (n === 2
      ? { status: 409, d: { ok: false, error: 'the card has less', received: 0 } } : null);
    const box = fakeBox(SLICE * 2, script);
    const { u } = make(box);
    const d = await u.run(blobOf(SLICE * 2), 'a.wav', () => {});
    assert.strictEqual(d.done, true);
    assert.deepStrictEqual(box.calls, [0, SLICE, 0, SLICE]);
  },

  async 'gives up after the retry limit with the offset it stopped at'() {
    const box = fakeBox(SLICE * 2, () => ({ reject: new Error('the connection to the box dropped') }));
    const { u } = make(box);
    await assert.rejects(u.run(blobOf(SLICE * 2), 'a.wav', () => {}), /stopped at 0B of /);
    assert.strictEqual(box.calls.length, S.SLICE_TRIES);
  },

  async 'a cancel during a failed slice does not retry'() {
    let u;
    const box = fakeBox(SLICE * 2, () => { u.cancel(); return { reject: new Error('dropped') }; });
    ({ u } = make(box));
    await assert.rejects(u.run(blobOf(SLICE * 2), 'a.wav', () => {}), (e) => e.cancelled === true);
    assert.strictEqual(box.calls.length, 1);
  },

  async 'an old firmware that does not report done is flagged legacy on the first slice'() {
    const box = fakeBox(SLICE, () => ({ status: 200, d: { ok: true } }));
    const { u } = make(box);
    const d = await u.run(blobOf(SLICE), 'a.wav', () => {});
    assert.strictEqual(d.legacy, true);
  },

  async 'an empty file is refused'() {
    const { u } = make(fakeBox(0));
    await assert.rejects(u.run(blobOf(0), 'a.wav', () => {}), /empty/);
  },

  async 'progress climbs from 0 to 1 across the whole song'() {
    const box = fakeBox(SLICE * 2);
    const { u } = make(box);
    const seen = [];
    await u.run(blobOf(SLICE * 2), 'a.wav', (p) => seen.push(p));
    assert.strictEqual(seen[seen.length - 1], 1);
    assert.ok(seen.every((p, i) => i === 0 || p >= seen[i - 1]));
  }
};

(async () => {
  let failed = 0;
  for (const [name, fn] of Object.entries(tests)) {
    try { await fn(); console.log('ok   ' + name); }
    catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e && e.stack || e)); }
  }
  if (failed) { console.log(failed + ' failed'); process.exit(1); }
  console.log('all passed');
})();
