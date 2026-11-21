// Tests for the pure parts of data/wavstream.js. Run: node test/wavstream.test.js
'use strict';
const assert = require('assert');
const W = require('../data/wavstream.js');

function wav({ channels = 2, rate = 44100, bits = 16, format = 1, dataBytes = 1000, listBytes = 0 }) {
  const header = 12 + 24 + (listBytes ? 8 + listBytes : 0) + 8;
  const buf = new ArrayBuffer(header + dataBytes);
  const v = new DataView(buf);
  const str = (at, s) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, buf.byteLength - 8, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, format, true); v.setUint16(22, channels, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * channels * bits / 8, true);
  v.setUint16(32, channels * bits / 8, true); v.setUint16(34, bits, true);
  let at = 36;
  if (listBytes) { str(at, 'LIST'); v.setUint32(at + 4, listBytes, true); at += 8 + listBytes; }
  str(at, 'data'); v.setUint32(at + 4, dataBytes, true);
  return buf;
}

const tests = {
  'parses a 16-bit stereo header and finds data after a LIST chunk'() {
    const info = W.parseWavHeader(wav({ listBytes: 26, dataBytes: 4000 }), 0);
    assert.strictEqual(info.dataStart, 12 + 24 + 8 + 26 + 8);
    assert.strictEqual(info.dataEnd - info.dataStart, 4000);
    assert.strictEqual(info.chunkBytes, W.CHUNK_FRAMES * 4);
    assert.strictEqual(info.chunkCount, 1);
  },
  'rejects 24-bit and float WAVs so <audio> takes them'() {
    assert.strictEqual(W.parseWavHeader(wav({ bits: 24 }), 0), null);
    assert.strictEqual(W.parseWavHeader(wav({ format: 3, bits: 32 }), 0), null);
  },
  'rejects empty and non-WAV input'() {
    assert.strictEqual(W.parseWavHeader(new ArrayBuffer(0), 0), null);
    assert.strictEqual(W.parseWavHeader(new ArrayBuffer(64), 0), null);
  },
  'clamps a data size that overstates the file, to whole frames'() {
    const info = W.parseWavHeader(wav({ dataBytes: 1000 }), 44 + 501);
    assert.strictEqual(info.dataEnd, 44 + 500);
  },
  'chunk ranges are contiguous, inclusive and end at dataEnd'() {
    const info = { dataStart: 44, dataEnd: 44 + 10, chunkBytes: 4 };
    assert.deepStrictEqual(W.chunkRange(info, 0), [44, 47]);
    assert.deepStrictEqual(W.chunkRange(info, 1), [48, 51]);
    assert.deepStrictEqual(W.chunkRange(info, 2), [52, 53]);
  },
  'converts interleaved int16 to per-channel floats'() {
    const pcm = new Int16Array([0, -32768, 16384, 32767]).buffer;
    const [l, r] = W.pcm16ToChannels(pcm, 2);
    assert.deepStrictEqual([...l], [0, 0.5]);
    assert.deepStrictEqual([...r], [-1, 32767 / 32768]);
  },
  'reads the total size from Content-Range, and 0 when absent'() {
    assert.strictEqual(W.totalFromContentRange('bytes 0-65535/84097716'), 84097716);
    assert.strictEqual(W.totalFromContentRange(null), 0);
  }
};

let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
  try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); }
}
process.exit(failed ? 1 : 0);
