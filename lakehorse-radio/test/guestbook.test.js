// Tests for data/guestbook.js (pure book logic). Run: node test/guestbook.test.js
'use strict';
const assert = require('assert');
const G = require('../data/guestbook.js');

const A = 'aaaaaaaaaaaa', B = 'bbbbbbbbbbbb';

// ---- text cleaning ----
assert.strictEqual(G.cleanHandle('  Ana \n  Maria '), 'Ana Maria');
assert.strictEqual(G.cleanHandle('x'.repeat(50)).length, 20);
assert.strictEqual(G.cleanMessage('a\u0000b\tc'), 'a b c');
assert.strictEqual(Array.from(G.cleanMessage('😀'.repeat(200))).length, 140);
assert.strictEqual(G.cleanHandle(null), '');

// ---- ownership ----
assert.strictEqual(G.secretHash(A), G.secretHash(A));
assert.notStrictEqual(G.secretHash(A), G.secretHash(B));
assert.ok(/^[0-9a-f]{12}$/.test(G.newSecret()));
assert.ok(G.secretHash(A).length <= 16);

// ---- add ----
let r = G.addEntry(G.emptyBook(), ' Ana ', ' hello ', false, A, 1000.9);
assert.ok(!r.error);
assert.deepStrictEqual(r.book.entries[0], { id: 0, h: 'Ana', m: 'hello', t: 1000, k: G.secretHash(A) });
let book = r.book;
r = G.addEntry(book, 'Bo', 'pic', true, B, 2000);
assert.strictEqual(r.id, 1);
assert.strictEqual(r.book.entries[1].i, 1);
book = r.book;
assert.ok(G.addEntry(book, '', 'x', false, A, 1).error);
assert.ok(G.addEntry(book, 'x', '   ', false, A, 1).error);
assert.strictEqual(book.entries.length, 2);   // the original is never changed

// ---- edit: owner only ----
r = G.editEntry(book, 0, A, 'Ana2', 'changed');
assert.strictEqual(r.book.entries[0].m, 'changed');
assert.strictEqual(r.book.entries[0].t, 1000);
assert.strictEqual(book.entries[0].m, 'hello');
assert.ok(G.editEntry(book, 0, B, 'x', 'y').error);
assert.ok(G.editEntry(book, 9, A, 'x', 'y').error);
assert.ok(G.editEntry(book, 0, A, '', 'y').error);
assert.strictEqual(G.editEntry(book, 1, B, 'Bo', 'again').book.entries[1].i, 1);   // picture kept

// ---- trash, restore, purge ----
r = G.trashEntry(book, 0, A);
assert.strictEqual(r.book.entries.length, 1);
assert.strictEqual(r.book.trash.length, 1);
assert.ok(G.trashEntry(book, 0, B).error);
const trashed = r.book;
assert.strictEqual(G.myTrash(trashed, A).length, 1);
assert.strictEqual(G.myTrash(trashed, B).length, 0);
assert.strictEqual(G.otherTrashCount(trashed, B), 1);
assert.strictEqual(G.restoreEntry(trashed, 0, A).book.entries.length, 2);
assert.ok(G.restoreEntry(trashed, 0, B).error);
assert.ok(G.purgeEntry(trashed, 0, B).error);
r = G.purgeEntry(trashed, 0, A);
assert.strictEqual(r.book.trash.length, 0);
assert.strictEqual(r.hadImage, false);
assert.strictEqual(G.purgeEntry(G.trashEntry(book, 1, B).book, 1, B).hadImage, true);
assert.ok(G.purgeEntry(book, 0, A).error);     // not in the trash: nothing to purge
// ids never get reused while anything still holds them
assert.strictEqual(G.nextId(trashed), 2);

// ---- full book: oldest trash makes room, otherwise refuse ----
let full = G.emptyBook();
for (let i = 0; i < G.MAX_ENTRIES; i++) full = G.addEntry(full, 'h', 'm' + i, false, A, 100 + i).book;
assert.strictEqual(G.planAdd(full).ok, false);
assert.ok(G.addEntry(full, 'h', 'm', false, A, 1).error);
const withTrash = G.trashEntry(G.trashEntry(full, 5, A).book, 3, A).book;   // 5 trashed first? t decides, not order
r = G.addEntry(withTrash, 'new', 'room', false, B, 9999);
assert.ok(!r.error);
assert.strictEqual(r.dropped, 3);                       // the older (t=103) of the two trashed
assert.strictEqual(G.nextId(withTrash), G.MAX_ENTRIES);
assert.strictEqual(r.book.entries.length + r.book.trash.length, G.MAX_ENTRIES);

// ---- reading the box's file ----
assert.strictEqual(G.parseBook(null), null);
assert.strictEqual(G.parseBook({ entries: [] }), null);
assert.strictEqual(G.parseBook('x'), null);
const parsed = G.parseBook({ v: 1, entries: [
  { id: 1, h: 'ok', m: 'fine', t: 5, k: 'abc', i: 1 },
  { id: 2, h: '', m: 'no handle', t: 5, k: 'abc' },
  { id: 3, h: 'x', m: 'no key', t: 5 },
  { id: 1, h: 'dup', m: 'dup id', t: 5, k: 'abc' },
  { id: 4, h: '<b>x</b>', m: '<img src=x onerror=1>', t: -4, k: 'abc' },
  'junk', null
], trash: [{ id: 7, h: 't', m: 'bin', t: 1, k: 'k' }] });
assert.deepStrictEqual(parsed.entries.map((e) => e.id), [1, 4]);
assert.strictEqual(parsed.entries[1].t, 0);
assert.strictEqual(parsed.entries[1].m, '<img src=x onerror=1>');     // kept as TEXT; the page uses textContent
assert.strictEqual(parsed.trash.length, 1);

// ---- file size and picture url ----
assert.ok(G.serialise(full).length <= G.FILE_MAX_BYTES);
let big = G.emptyBook();
for (let i = 0; i < 60; i++) big.entries.push({ id: i, h: 'h'.repeat(20), m: 'm'.repeat(140), t: i, k: 'abcd1234' });
assert.strictEqual(G.serialise(big), null);
assert.ok(G.serialise(G.emptyBook()).includes('"entries":[]'));
assert.strictEqual(G.imageUrl(12, 34), '/api/guestbook/img?id=12&v=34');
assert.strictEqual(G.imageUrl('12; drop', 3.9), '/api/guestbook/img?id=0&v=3');   // only an integer can get in

// ---- photo crop: centre, no stretching ----
let c = G.coverRect(400, 300, 160, 120);
assert.deepStrictEqual([c.sx, c.sy, c.sw, c.sh], [0, 0, 400, 300]);
c = G.coverRect(300, 400, 160, 120);                       // portrait: crop top and bottom
assert.strictEqual(c.sw, 300); assert.ok(Math.abs(c.sh - 225) < 1e-9); assert.ok(Math.abs(c.sy - 87.5) < 1e-9);
c = G.coverRect(800, 300, 160, 120);                       // very wide: crop the sides
assert.strictEqual(c.sh, 300); assert.ok(Math.abs(c.sw - 400) < 1e-9); assert.ok(Math.abs(c.sx - 200) < 1e-9);

console.log('guestbook: all passed');
