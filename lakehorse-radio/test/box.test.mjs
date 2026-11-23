// Tests for game/src/core/Box.js. Run: node test/box.test.mjs
import assert from 'assert';
import { titleFromFile, tracksFromSdList } from '../../game/src/core/Box.js';

assert.strictEqual(titleFromFile('Jupiter Gold.wav'), 'Jupiter Gold');
assert.strictEqual(titleFromFile('Mango_Tree_World.WAV'), 'Mango Tree World');
assert.strictEqual(titleFromFile('.wav'), 'Lakehorse');           // nothing left: a fallback name, not ''

const rows = tracksFromSdList([{ name: 'This Is War.wav', size: 1 }, { name: '' }, null, { size: 3 }]);
assert.strictEqual(rows.length, 1);                                // junk entries dropped
assert.strictEqual(rows[0].src, '/sd/This%20Is%20War.wav');       // encoded, same-origin
assert.deepStrictEqual(tracksFromSdList(undefined), []);          // card missing / bad reply: empty, so music.json runs
console.log('box: ok');
