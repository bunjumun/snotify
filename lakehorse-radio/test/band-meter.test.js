// Tests for data/band-meter.js. Run: node test/band-meter.test.js
'use strict';
const assert = require('assert');
const B = require('../data/band-meter.js');

// ---- levelFromDb: same scale as src/band_levels.cpp ----
assert.strictEqual(B.levelFromDb(-Infinity, 0), 0);
assert.strictEqual(B.levelFromDb(NaN, 0), 0);
assert.strictEqual(B.levelFromDb(0, 0), 8);
assert.strictEqual(B.levelFromDb(-72, 0), 0);
assert.strictEqual(B.levelFromDb(-50, 0), 3);
assert.strictEqual(B.levelFromDb(-50, 4), 5);            // tilt lifts higher bands
assert.ok(B.levelFromDb(-40, 3) < B.levelFromDb(-30, 3)); // louder reads higher

// ---- levelsFromSpectrum ----
const SR = 44100, FFT = 2048, BINS = FFT / 2;
const quiet = () => new Float32Array(BINS).fill(-140);
const binOf = (hz) => Math.round(hz / (SR / FFT));

assert.strictEqual(B.levelsFromSpectrum(null, SR, FFT), null);        // no spectrum is not silence
assert.strictEqual(B.levelsFromSpectrum(new Float32Array(0), SR, FFT), null);
assert.strictEqual(B.levelsFromSpectrum(quiet(), 0, FFT), null);
assert.deepStrictEqual(B.levelsFromSpectrum(quiet(), SR, FFT), [0, 0, 0, 0, 0, 0, 0, 0]);
assert.deepStrictEqual(B.levelsFromSpectrum(new Float32Array(BINS).fill(-Infinity), SR, FFT), [0, 0, 0, 0, 0, 0, 0, 0]);

B.FREQS.forEach((hz, band) => {
  const s = quiet();
  s[binOf(hz)] = -20;                                      // one loud bin at the band's centre
  const lv = B.levelsFromSpectrum(s, SR, FFT);
  assert.strictEqual(lv.length, 8);
  assert.ok(lv[band] >= 5, 'band ' + band + ' lit: ' + lv);
  const max = Math.max.apply(null, lv);
  assert.strictEqual(lv[band], max, 'band ' + band + ' is the peak: ' + lv);
  lv.forEach((v, i) => { if (Math.abs(i - band) >= 2) assert.ok(v === 0, 'far band ' + i + ' dark: ' + lv); });
});

// ---- barsFrame matches the box's drawBars ----
const f = B.barsFrame([8, 1, 0, 3, 0, 0, 0, 8]);
assert.strictEqual(f.length, 64);
assert.strictEqual(f[0], 'f');                            // column 0, top row: the tip of 8
assert.strictEqual(f[8], '8');                            // below the tip
assert.strictEqual(f.charAt(7 * 8 + 1), 'f');             // column 1, height 1: bottom row is the tip
assert.strictEqual(f.charAt(6 * 8 + 1), '0');
assert.strictEqual(f.charAt(7 * 8 + 2), '0');             // height 0: dark
assert.strictEqual(f.charAt(5 * 8 + 3), 'f');             // height 3: tip two rows above the bottom row... row 5
assert.strictEqual(f.charAt(7 * 8 + 3), '8');
assert.strictEqual(B.barsFrame([99, -3, 2.9, NaN]).charAt(0), 'f');   // clamped, junk tolerated
assert.strictEqual(B.barsFrame([]), '0'.repeat(64));

console.log('band-meter: all passed');
