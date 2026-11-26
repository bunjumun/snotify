// Tests for data/align-report.js. Run: node test/align-report.test.js
const assert = require('assert');
const R = require('../data/align-report.js');

function run(fn) {
  const sent = [];
  const t = R.createTracker((n, r) => sent.push([n, r]));
  fn(t);
  return sent;
}
// Plays `seconds` of a song one second at a time.
function listen(t, from, seconds, dur) {
  for (let s = 0; s <= seconds; s++) t.progress(from + s, dur, true);
}

// Listened to the end: full credit once, when the next song starts.
assert.deepStrictEqual(run(t => { t.track('A.wav'); listen(t, 0, 200, 200); t.track('B.wav'); }), [['A.wav', 'full']]);

// Left after half: partial. Left before half: nothing.
assert.deepStrictEqual(run(t => { t.track('A.wav'); listen(t, 0, 110, 200); t.track(null); }), [['A.wav', 'partial']]);
assert.deepStrictEqual(run(t => { t.track('A.wav'); listen(t, 0, 90, 200); t.track(null); }), []);

// Seeking to the end earns nothing: only time listened counts.
assert.deepStrictEqual(run(t => { t.track('A.wav'); listen(t, 0, 10, 200); t.progress(195, 200, true); t.progress(200, 200, true); t.track(null); }), []);

// Paused time and a pause/resume do not add listening.
assert.deepStrictEqual(run(t => { t.track('A.wav'); listen(t, 0, 60, 200); t.progress(60, 200, false); t.progress(61, 200, false); listen(t, 61, 60, 200); t.track(null); }), [['A.wav', 'partial']]);

// Flush (page closing) reports the song in hand once, and a second flush nothing.
assert.deepStrictEqual(run(t => { t.track('A.wav'); listen(t, 0, 150, 200); t.flush(); t.flush(); }), [['A.wav', 'partial']]);

// Same song announced twice is not a new song; unknown duration reports nothing.
assert.deepStrictEqual(run(t => { t.track('A.wav'); t.track('A.wav'); listen(t, 0, 50, 0); t.track(null); }), []);
assert.deepStrictEqual(run(t => { t.progress(5, 100, true); t.flush(); }), []);

// Replaying the same file after another song reports each time (the box ignores repeats inside 10 s).
assert.deepStrictEqual(run(t => { t.track('A.wav'); listen(t, 0, 100, 100); t.track('B.wav'); t.track('A.wav'); listen(t, 0, 100, 100); t.track(null); }), [['A.wav', 'full'], ['A.wav', 'full']]);

// poster: builds the URL, encodes the name, and swallows every failure.
const urls = [];
R.poster((u, o) => { urls.push([u, o.method]); return Promise.resolve(); })('Mango Tree World.wav', 'full');
assert.deepStrictEqual(urls, [['/api/alignment/event?source=song&id=Mango%20Tree%20World.wav&result=full', 'POST']]);
R.poster(() => { throw new Error('offline'); })('A.wav', 'full');
R.poster(() => Promise.reject(new Error('offline')))('A.wav', 'full');

console.log('align-report: all passed');
