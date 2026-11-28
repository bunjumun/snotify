// data/flacsend.js: WAV header parsing, the FLAC result, and the fall-backs.
// Uses the real libflac. Run: node test/flacsend.test.js
'use strict';
const assert = require('assert');
const realFetch = globalThis.fetch;
globalThis.fetch = undefined;
const Flac = require('../data/libflac.min.wasm.js');
globalThis.fetch = realFetch;
globalThis.window = { LakehorseFlacEncode: require('../data/flacencode.js') };
const S = require('../data/flacsend.js');

function wav(samples, channels, rate, extraChunk) {
  const data = Buffer.from(new Int16Array(samples).buffer);
  const extra = extraChunk ? Buffer.concat([Buffer.from('LIST'), Buffer.from([4, 0, 0, 0]), Buffer.from('abcd')]) : Buffer.alloc(0);
  const h = Buffer.alloc(36);
  h.write('RIFF', 0); h.writeUInt32LE(36 + extra.length + 8 + data.length - 8 + 8 - 36 + 28, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * channels * 2, 28); h.writeUInt16LE(channels * 2, 32); h.writeUInt16LE(16, 34);
  const d = Buffer.alloc(8); d.write('data', 0); d.writeUInt32LE(data.length, 4);
  return new Blob([h, extra, d, data]);
}
const ready = () => require('../data/flacencode.js').ready(Flac);

(async () => {
  // parse: skips a LIST chunk, finds the data
  const w = wav([1, 2, 3, 4], 2, 44100, true);
  const p = S.parseWav(await w.arrayBuffer());
  assert.deepStrictEqual([p.rate, p.channels, p.dataBytes, p.dataStart], [44100, 2, 8, 56]);
  assert.strictEqual(S.parseWav(new ArrayBuffer(10)), null);

  // a compressible tone becomes a smaller .flac
  const n = 44100 * 2;
  const tone = Array.from({ length: n }, (_, i) => Math.round(8000 * Math.sin(i / 20)));
  const big = wav(tone, 2, 44100, false);
  const r = await S.fromWav(big, 'Song.wav', null, ready);
  assert.strictEqual(r.fallback, false);
  assert.strictEqual(r.name, 'Song.flac');
  assert.ok(r.blob.size < big.size / 2);
  const head = Buffer.from(await r.blob.slice(0, 4).arrayBuffer()).toString();
  assert.strictEqual(head, 'fLaC');

  // encoder fails to load: the WAV goes unchanged
  const f = await S.fromWav(big, 'Song.wav', null, () => Promise.reject(new Error('no')));
  assert.strictEqual(f.fallback, true);
  assert.strictEqual(f.blob, big);
  assert.strictEqual(f.name, 'Song.wav');

  // not a 16-bit WAV: unchanged
  const junk = new Blob([Buffer.alloc(100)]);
  assert.strictEqual((await S.fromWav(junk, 'x.wav', null, ready)).fallback, true);
  console.log('flacsend: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
