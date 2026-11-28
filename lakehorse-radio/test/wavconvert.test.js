// Tests for the pure parts of data/wavconvert.js. Run: node test/wavconvert.test.js
//
// The decode and resample step is the browser's (OfflineAudioContext) and
// cannot run here; it is checked in a real browser instead. What can be pinned
// down here is everything around it: the shape that counts as already
// Bluetooth-ready, the header written for it, the dithered sample writer, and
// the file name each format saves under.
'use strict';
const assert = require('assert');
const W = require('../data/wavconvert.js');

const tests = {
  'only 44.1 kHz 16-bit stereo PCM counts as Bluetooth-ready'() {
    const ok = { format: 1, bits: 16, rate: 44100, channels: 2 };
    assert.strictEqual(W.isBtReady(ok), true);
    assert.strictEqual(W.isBtReady({ ...ok, rate: 48000 }), false);
    assert.strictEqual(W.isBtReady({ ...ok, bits: 24 }), false);
    assert.strictEqual(W.isBtReady({ ...ok, channels: 1 }), false);
    assert.strictEqual(W.isBtReady({ ...ok, format: 3, bits: 32 }), false);
  },
  'a missing header is not Bluetooth-ready, so it is decoded rather than copied'() {
    assert.strictEqual(W.isBtReady(null), false);
    assert.strictEqual(W.isBtReady(undefined), false);
  },
  'the header describes 44.1 kHz 16-bit stereo PCM'() {
    const v = new DataView(W.header16(2, W.BT_RATE, 4000));
    assert.strictEqual(v.byteLength, 44);
    assert.strictEqual(v.getUint16(20, true), 1);        // PCM
    assert.strictEqual(v.getUint16(22, true), 2);        // channels
    assert.strictEqual(v.getUint32(24, true), 44100);    // rate
    assert.strictEqual(v.getUint32(28, true), 176400);   // byte rate
    assert.strictEqual(v.getUint16(32, true), 4);        // block align
    assert.strictEqual(v.getUint16(34, true), 16);       // bits
    assert.strictEqual(v.getUint32(40, true), 4000);     // data bytes
    assert.strictEqual(v.getUint32(4, true), 36 + 4000); // RIFF size
  },
  'interleaves L/R and lands within dither of the true value'() {
    const left = new Float32Array([0, 0.5, -0.5, 0.25]);
    const right = new Float32Array([0.1, -0.1, 0.9, -0.9]);
    const out = W.interleave16(left, right, 1, 3);
    assert.strictEqual(out.length, 6);
    const want = [0.5, -0.1, -0.5, 0.9, 0.25, -0.9].map((x) => x * 32768);
    want.forEach((w, i) => assert.ok(Math.abs(out[i] - w) <= 1.5, `sample ${i}: ${out[i]} vs ${w}`));
  },
  'clamps samples past full scale instead of wrapping'() {
    const out = W.interleave16(new Float32Array([1.2]), new Float32Array([-1.2]), 0, 1);
    assert.strictEqual(out[0], 32767);
    assert.strictEqual(out[1], -32768);
  },
  'silence stays within one step of zero: dither, not distortion'() {
    const z = new Float32Array(1000);
    const out = W.interleave16(z, z, 0, 1000);
    assert.ok(out.every((s) => Math.abs(s) <= 1));
  },
  'wav44 saves everything as .wav; aac renames only WAVs'() {
    assert.strictEqual(W.outputExtension('Song.mp3', 'wav44'), '.wav');
    assert.strictEqual(W.outputExtension('Song.WAV', 'wav44'), '.wav');
    assert.strictEqual(W.outputExtension('Song.wav', 'aac'), '.aac');
    assert.strictEqual(W.outputExtension('Song.mp3', 'aac'), '.mp3');
    assert.strictEqual(W.outputExtension('Song.mp3', 'wav16'), '.mp3');
  },
  'a FLAC is stored as .wav even under the default format'() {
    assert.strictEqual(W.outputExtension('Song.flac', 'wav16'), '.wav');
    assert.strictEqual(W.outputExtension('Song.FLAC', 'wav16'), '.wav');
  }
};

// Needs the browser's decoder, so it runs against a stand-in OfflineAudioContext
// that "decodes" any bytes to 0.5 s of a stereo ramp.
const asyncTests = {
  async 'a FLAC is decoded to 16-bit stereo WAV with a .wav name'() {
    const frames = 22050;
    const left = new Float32Array(frames).fill(0.25);
    const right = new Float32Array(frames).fill(-0.25);
    global.window = { OfflineAudioContext: function () {
      this.decodeAudioData = () => Promise.resolve({
        length: frames, numberOfChannels: 2,
        getChannelData: (c) => (c === 0 ? left : right) });
    } };
    const r = await W.toBlob(new File([new Uint8Array(100)], 'Song.flac'));
    delete global.window;
    assert.strictEqual(r.name, 'Song.wav');
    assert.strictEqual(r.blob.size, 44 + frames * 4);
    const v = new DataView(await r.blob.arrayBuffer());
    assert.strictEqual(v.getUint16(20, true), 1);      // PCM
    assert.strictEqual(v.getUint16(22, true), 2);      // stereo
    assert.strictEqual(v.getUint32(24, true), 44100);
    assert.strictEqual(v.getUint16(34, true), 16);
    assert.ok(Math.abs(v.getInt16(44, true) - 8192) <= 2);
    assert.ok(Math.abs(v.getInt16(46, true) + 8192) <= 2);
  },
  async 'a WAV keeps its own name'() {
    const f = new File([new Uint8Array(100)], 'Song.mp3');
    assert.strictEqual((await W.toBlob(f)).name, 'Song.mp3');
  }
};

let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
  try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); }
}
(async () => {
  for (const [name, fn] of Object.entries(asyncTests)) {
    try { await fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); }
  }
  console.log(failed ? failed + ' failed' : 'all passed');
  process.exit(failed ? 1 : 0);
})();
