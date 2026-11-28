// Round-trip tests for data/flacencode.js with the real libflac.js: encode
// 16-bit PCM, decode it again with the same library, require the identical
// samples. Also times a long song. Run: node test/flacencode.test.js
'use strict';
const assert = require('assert');
const E = require('../data/flacencode.js');
// Node 26 has fetch, and libflac then tries to fetch() its .wasm by file path,
// which is not a URL. Hide fetch while it loads so it reads the file instead.
const realFetch = globalThis.fetch;
globalThis.fetch = undefined;
const Flac = require('../data/libflac.min.wasm.js');
globalThis.fetch = realFetch;

function decode(bytes) {
  const dec = Flac.create_libflac_decoder(false);
  const out = [];
  let meta = null, at = 0;
  Flac.init_decoder_stream(dec,
    (n) => {
      const take = Math.min(n, bytes.length - at);
      if (!take) return { buffer: undefined, readDataLength: 0, error: false };
      const buffer = new Uint8Array(bytes.subarray(at, at + take)); at += take;
      return { buffer, readDataLength: take, error: false };
    },
    (chans) => out.push(chans.map((c) => new Uint8Array(c))),
    (e, m) => { throw new Error('decode error ' + m); }, (m) => { meta = m; });
  Flac.FLAC__stream_decoder_process_until_end_of_stream(dec);
  Flac.FLAC__stream_decoder_finish(dec);
  Flac.FLAC__stream_decoder_delete(dec);
  return { out, meta };
}

// Planar 16-bit channel bytes back to interleaved Int16.
function interleave(blocks, channels) {
  let frames = 0;
  blocks.forEach((b) => { frames += b[0].length / 2; });
  const res = new Int16Array(frames * channels);
  let f = 0;
  blocks.forEach((b) => {
    const n = b[0].length / 2;
    for (let c = 0; c < channels; c++) {
      const v = new DataView(b[c].buffer, b[c].byteOffset, b[c].byteLength);
      for (let i = 0; i < n; i++) res[(f + i) * channels + c] = v.getInt16(i * 2, true);
    }
    f += n;
  });
  return res;
}

async function encode(samples, channels, rate, chunkFrames) {
  await E.ready(Flac);
  const parts = [];
  const enc = E.create(Flac, { rate, channels, totalFrames: samples.length / channels,
                               sink: (b) => { parts.push(b); } });
  for (let at = 0; at < samples.length; at += chunkFrames * channels) {
    await enc.write(samples.subarray(at, at + chunkFrames * channels));
  }
  const r = await enc.finish();
  const bytes = new Uint8Array(r.bytes);
  let o = 0; parts.forEach((p) => { bytes.set(p, o); o += p.length; });
  assert.strictEqual(o, r.bytes);
  return bytes;
}

function music(frames, channels, seed = 1) {
  const s = new Int16Array(frames * channels);
  let x = seed;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      const tone = Math.sin(i * 0.05 * (c + 1)) * 12000 + Math.sin(i * 0.31) * 3000;
      s[i * channels + c] = Math.max(-32768, Math.min(32767, Math.round(tone + ((x >> 8) % 400) - 200)));
    }
  }
  return s;
}

const tests = {
  async 'stereo 44.1 kHz round-trips bit-exact'() {
    const src = music(50000, 2);
    const flac = await encode(src, 2, 44100, 4096);
    assert.strictEqual(String.fromCharCode(...flac.subarray(0, 4)), 'fLaC');
    const { out, meta } = decode(flac);
    assert.strictEqual(meta.sampleRate, 44100);
    assert.strictEqual(meta.channels, 2);
    assert.strictEqual(meta.bitsPerSample, 16);
    assert.strictEqual(meta.total_samples, 50000);
    assert.deepStrictEqual(interleave(out, 2), src);
    assert.ok(flac.length < src.length * 2, 'smaller than the WAV data');
  },
  async 'mono and odd chunk sizes round-trip bit-exact'() {
    const src = music(30011, 1, 7);
    const flac = await encode(src, 1, 48000, 1000);
    assert.deepStrictEqual(interleave(decode(flac).out, 1), src);
  },
  async 'silence compresses to almost nothing and decodes to silence'() {
    const src = new Int16Array(44100 * 2);
    const flac = await encode(src, 2, 44100, 8192);
    assert.ok(flac.length < 2000, 'silent second is ' + flac.length + ' bytes');
    assert.deepStrictEqual(interleave(decode(flac).out, 2), src);
  },
  async 'full-scale extremes survive'() {
    const src = new Int16Array(4096 * 2);
    for (let i = 0; i < src.length; i++) src[i] = i % 2 ? 32767 : -32768;
    assert.deepStrictEqual(interleave(decode(await encode(src, 2, 44100, 4096)).out, 2), src);
  },
  async 'a 7 minute stereo song encodes in reasonable time and round-trips'() {
    const frames = 44100 * 420;
    const src = music(frames, 2, 3);
    const t0 = Date.now();
    const flac = await encode(src, 2, 44100, 1 << 18);
    const secs = (Date.now() - t0) / 1000;
    console.log('     7 min: ' + (frames * 4 / 1e6).toFixed(0) + ' MB -> ' + (flac.length / 1e6).toFixed(0) +
                ' MB in ' + secs.toFixed(1) + ' s (noisy synthetic, so a poor ratio)');
    assert.ok(secs < 60, 'encode took ' + secs + ' s');
    assert.deepStrictEqual(interleave(decode(flac).out, 2), src);
  }
};

(async () => {
  let failed = 0;
  for (const [name, fn] of Object.entries(tests)) {
    try { await fn(); console.log('ok   ' + name); }
    catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e && e.stack || e)); }
  }
  console.log(failed ? failed + ' failed' : 'all passed');
  process.exit(failed ? 1 : 0);
})();
