/* Lakehorse Radio: eight band levels for phone mode.
 *
 * When the browser plays the music, the box never sees the samples, so the
 * matrix window works its bars out here from a Web Audio AnalyserNode. This is
 * the page's twin of src/band_levels.cpp and uses the same scale, so bars look
 * alike whichever device is playing: eight bands an octave apart (60 Hz to
 * 8 kHz), +3 dB per band to offset music's tilt, -72 dBFS = 0 and -18 dBFS = 8.
 *
 * Pure functions only; wavstream.js owns the analyser and player-browser.js
 * hands the result on. These are for the virtual window only: nothing here is
 * sent to the box.
 */

(function (root) {
  'use strict';

  var BANDS = 8;
  var FREQS = [60, 120, 250, 500, 1000, 2000, 4000, 8000];
  var FLOOR_DB = -72;
  var RANGE_DB = 54;
  var TILT_DB = 3;
  // An analyser reports a full-scale sine about 6 dB below 0 (its FFT is
  // normalised by the window length, not half of it).
  var ANALYSER_OFFSET_DB = 6;
  var HALF_OCTAVE = Math.SQRT2;

  // Pure: a dB reading (full-scale sine = 0) for band 0..7 to a level 0..8.
  function levelFromDb(db, band) {
    if (!(db > -200)) return 0;   // -Infinity and NaN: nothing there
    var level = (db + TILT_DB * band - FLOOR_DB) / RANGE_DB * 8;
    if (level <= 0) return 0;
    if (level >= 8) return 8;
    return Math.round(level);
  }

  // Pure: an analyser's dB spectrum in, eight levels out. Each band takes the
  // loudest bin within half an octave either side of its centre. A spectrum
  // that is missing or too short gives null, never a row of zeros that reads
  // as "silence".
  function levelsFromSpectrum(db, sampleRate, fftSize) {
    if (!db || !db.length || !(sampleRate > 0) || !(fftSize > 0)) return null;
    var binHz = sampleRate / fftSize;
    var out = [];
    for (var b = 0; b < BANDS; b++) {
      var lo = Math.max(1, Math.floor(FREQS[b] / HALF_OCTAVE / binHz));
      var hi = Math.min(db.length - 1, Math.ceil(FREQS[b] * HALF_OCTAVE / binHz));
      if (hi < lo) hi = lo;
      if (lo >= db.length) return null;
      var peak = -Infinity;
      for (var i = lo; i <= hi; i++) if (db[i] > peak) peak = db[i];
      out.push(levelFromDb(peak + ANALYSER_OFFSET_DB, b));
    }
    return out;
  }

  // Pure: levels to the 64-character frame the box's Bars mode would draw
  // (src/matrix_engine.cpp drawBars): columns from the bottom, brighter tip.
  function barsFrame(levels) {
    var cells = [];
    for (var i = 0; i < 64; i++) cells.push('0');
    for (var x = 0; x < BANDS; x++) {
      var h = Math.max(0, Math.min(8, levels[x] | 0));
      for (var k = 0; k < h; k++) cells[(7 - k) * 8 + x] = k === h - 1 ? 'f' : '8';
    }
    return cells.join('');
  }

  var exported = {
    levelFromDb: levelFromDb, levelsFromSpectrum: levelsFromSpectrum, barsFrame: barsFrame,
    BANDS: BANDS, FREQS: FREQS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  else root.LakehorseBandMeter = exported;
})(typeof window !== 'undefined' ? window : globalThis);
