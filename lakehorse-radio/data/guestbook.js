/* Lakehorse Radio: GUEST BOOK. A handle, a short message, and optionally a
 * photo and/or a doodle (one small picture per entry).
 *
 * Why it is shaped like this:
 *   * Everything lives on the box's SD card, so every phone sees the same book.
 *     Text is /guestbook.json ({v,entries,trash}); an entry's picture is
 *     /gbimg-<id>.jpg. Both are written through POST /api/sd/card-file (shape-
 *     checked by the firmware, src/card_files.cpp) and read back through
 *     GET /api/guestbook and GET /api/guestbook/img?id=. Nothing is asked of the
 *     box until the window is open.
 *   * The box has no accounts, so ownership is an honour system: this browser
 *     keeps a random secret, each entry stores only a hash of the secret that
 *     wrote it, and Edit / Delete / Restore / Delete forever are offered only on
 *     entries whose hash matches. It stops accidents, not a determined person.
 *   * Two phones can write at the same moment, so every change is "read the
 *     book, change it, write it back" in one queue, never a stale copy.
 *   * Delete moves an entry to the trash can; "Delete forever" is the final
 *     step and removes its picture too. Editing and final deletion ask first.
 *     A trashed entry is shown, in the trash can, only to the phone that wrote
 *     it. When the book is full (40 entries, trash included) the oldest
 *     trashed entry of anyone makes room.
 *   * All text goes in with textContent, and picture URLs are built from an
 *     integer id only, so an entry can never inject markup.
 *
 * Pure helpers first (tested without a page), then attach().
 */
(function (root) {
  'use strict';

  var MAX_ENTRIES = 40;          // live + trash, matches cfg::GUESTBOOK_MAX_ENTRIES
  var HANDLE_MAX = 20;           // characters; the firmware allows 24 bytes
  var MESSAGE_MAX = 140;         // characters; the firmware allows 240 bytes
  var FILE_MAX_BYTES = 12288;    // cfg::CARD_FILE_MAX_BYTES
  var IMAGE_MAX_BYTES = 8000;    // under cfg::GUESTBOOK_IMAGE_MAX_BYTES (8192)
  var PAD_W = 160, PAD_H = 120;
  var QUALITIES = [0.7, 0.55, 0.4, 0.3, 0.2];
  var UNDO_MAX = 10;
  var COLORS = ['#111111', '#d33a2c', '#ff6b2c', '#e9c53a', '#2f9e6b', '#2b6fd4', '#ffffff'];
  var SIZES = [2, 5, 10];
  var SECRET_KEY = 'lh-gb-secret';
  // data-help ids for the buttons made by script (help.json has the text; test/help-coverage.test.js reads this line)
  var HELP = { edit: 'gb-edit', del: 'gb-delete', restore: 'gb-restore', purge: 'gb-purge', yes: 'gb-confirm-yes', no: 'gb-confirm-no' }; // data-help ids
  var BOOK_URL = '/api/guestbook';
  var WRITE_URL = '/api/sd/card-file?name=';

  function textHash(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
    return h >>> 0;
  }

  // ---- text ----------------------------------------------------------------
  function clean(s, max) {
    var t = String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
    var chars = Array.from(t);
    return chars.length > max ? chars.slice(0, max).join('').trim() : t;
  }
  function cleanHandle(s) { return clean(s, HANDLE_MAX); }
  function cleanMessage(s) { return clean(s, MESSAGE_MAX); }

  // ---- ownership -----------------------------------------------------------
  function newSecret(random) {
    var rnd = random || Math.random, s = '';
    for (var i = 0; i < 12; i++) s += Math.floor(rnd() * 16).toString(16);
    return s;
  }
  function secretHash(secret) {
    var h = textHash('lh-gb:' + secret).toString(16);
    return ('00000000' + h).slice(-8);
  }
  function owns(entry, secret) { return !!secret && !!entry && entry.k === secretHash(secret); }

  // ---- the book (pure; every change returns a new book) --------------------
  function emptyBook() { return { v: 1, entries: [], trash: [] }; }

  function cleanEntry(e) {
    if (!e || typeof e !== 'object') return null;
    var id = e.id, t = e.t;
    if (!(typeof id === 'number' && isFinite(id) && id >= 0 && id === Math.floor(id))) return null;
    var h = cleanHandle(e.h), m = cleanMessage(e.m);
    if (!h || !m || typeof e.k !== 'string' || !e.k || e.k.length > 16) return null;
    var out = { id: id, h: h, m: m, t: typeof t === 'number' && isFinite(t) && t >= 0 ? Math.floor(t) : 0, k: e.k };
    if (e.i === 1) out.i = 1;
    return out;
  }

  // The reply from the box, or null when it is not a usable book. Entries that
  // are not valid are dropped; the rest still show.
  function parseBook(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.entries) || !Array.isArray(data.trash)) return null;
    var seen = {};
    function pick(list) {
      var out = [];
      list.forEach(function (e) {
        var c = cleanEntry(e);
        if (c && !seen[c.id]) { seen[c.id] = true; out.push(c); }
      });
      return out;
    }
    var entries = pick(data.entries);
    return { v: 1, entries: entries, trash: pick(data.trash) };
  }

  function nextId(book) {
    var max = 0;
    book.entries.concat(book.trash).forEach(function (e) { if (e.id >= max) max = e.id + 1; });
    return max;
  }
  function size(book) { return book.entries.length + book.trash.length; }
  function without(list, id) { return list.filter(function (e) { return e.id !== id; }); }
  function find(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }

  // The id that WILL be used by the next add, and the id of a trashed entry
  // that would be dropped to make room (or null). Pure, so the page can upload
  // the picture under the right name before the text is written.
  function planAdd(book) {
    if (size(book) < MAX_ENTRIES) return { ok: true, id: nextId(book), drop: null };
    if (book.trash.length === 0) return { ok: false, error: 'full' };
    var oldest = book.trash.reduce(function (a, b) { return b.t < a.t ? b : a; });
    return { ok: true, id: nextId(book), drop: oldest.id };
  }

  function addEntry(book, handle, message, hasImage, secret, nowSec) {
    var plan = planAdd(book);
    var h = cleanHandle(handle), m = cleanMessage(message);
    if (!plan.ok) return { error: 'The guest book is full. Delete something forever from a trash can first.' };
    if (!h) return { error: 'Add a handle first.' };
    if (!m) return { error: 'Add a message first.' };
    var entry = { id: plan.id, h: h, m: m, t: Math.floor(nowSec), k: secretHash(secret) };
    if (hasImage) entry.i = 1;
    var trash = plan.drop === null ? book.trash : without(book.trash, plan.drop);
    return { book: { v: 1, entries: book.entries.concat([entry]), trash: trash }, id: plan.id, dropped: plan.drop };
  }

  function mapEntry(book, id, secret, fn) {
    var e = find(book.entries, id);
    if (!e) return { error: 'That message is gone.' };
    if (!owns(e, secret)) return { error: 'Only the phone that wrote a message can change it.' };
    return fn(e);
  }

  function editEntry(book, id, secret, handle, message) {
    var h = cleanHandle(handle), m = cleanMessage(message);
    if (!h || !m) return { error: 'A handle and a message are both needed.' };
    return mapEntry(book, id, secret, function (e) {
      var next = { id: e.id, h: h, m: m, t: e.t, k: e.k };
      if (e.i) next.i = 1;
      return { book: { v: 1, entries: book.entries.map(function (x) { return x.id === id ? next : x; }), trash: book.trash } };
    });
  }

  function trashEntry(book, id, secret) {
    return mapEntry(book, id, secret, function (e) {
      return { book: { v: 1, entries: without(book.entries, id), trash: book.trash.concat([e]) } };
    });
  }

  function trashMine(book, id, secret) {
    var e = find(book.trash, id);
    if (!e) return { error: 'That message is gone.' };
    if (!owns(e, secret)) return { error: 'Only the phone that wrote a message can change it.' };
    return { entry: e };
  }

  function restoreEntry(book, id, secret) {
    var r = trashMine(book, id, secret);
    if (r.error) return r;
    return { book: { v: 1, entries: book.entries.concat([r.entry]), trash: without(book.trash, id) } };
  }

  function purgeEntry(book, id, secret) {
    var r = trashMine(book, id, secret);
    if (r.error) return r;
    return { book: { v: 1, entries: book.entries, trash: without(book.trash, id) }, hadImage: !!r.entry.i };
  }

  // Newest first, for display.
  function visibleEntries(book) {
    return book.entries.slice().sort(function (a, b) { return b.t - a.t || b.id - a.id; });
  }
  function myTrash(book, secret) { return book.trash.filter(function (e) { return owns(e, secret); }); }
  function otherTrashCount(book, secret) { return book.trash.length - myTrash(book, secret).length; }

  function serialise(book) {
    var s = JSON.stringify({ v: 1, entries: book.entries, trash: book.trash });
    return s.length <= FILE_MAX_BYTES ? s : null;
  }

  function imageUrl(id, t) {
    return '/api/guestbook/img?id=' + (id | 0) + '&v=' + (t | 0);
  }

  // Pure: the part of a source picture that fills a dw x dh box with nothing
  // left over (centre crop).
  function coverRect(sw, sh, dw, dh) {
    var scale = Math.max(dw / sw, dh / sh);
    var w = dw / scale, h = dh / scale;
    return { sx: (sw - w) / 2, sy: (sh - h) / 2, sw: w, sh: h };
  }

  function dateText(sec) {
    if (!sec) return '';
    try { return new Date(sec * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch (e) { return ''; }
  }

  // ---- the page -------------------------------------------------------------
  function attach(el, opts) {
    opts = opts || {};
    var doc = opts.doc || root.document;
    var doFetch = opts.fetch || root.fetch.bind(root);
    var now = opts.now || function () { return Date.now() / 1000; };
    var store = opts.storage || (function () { try { return root.localStorage; } catch (e) { return null; } })();

    var isOpen = false, book = null, queue = Promise.resolve();
    var editingId = null, pendingConfirm = null, busy = false;
    var color = COLORS[0], sizeIx = 1, hasPicture = false;
    var undo = [], drawing = false, last = null;

    function secret() {
      var s = null;
      try { s = store && store.getItem(SECRET_KEY); } catch (e) { /* private mode: new one each time */ }
      if (!s) {
        s = newSecret();
        try { if (store) store.setItem(SECRET_KEY, s); } catch (e) { /* kept for this visit only */ }
        memory = s;
      }
      return s;
    }
    var memory = null;
    function mySecret() { return memory || (memory = secret()); }

    function say(text, kind) {
      var n = el('gbStatus');
      n.textContent = text || '';
      n.className = 'muted' + (kind ? ' ' + kind : '');
    }

    // ---- talking to the box ----
    function readBook() {
      return doFetch(BOOK_URL, { cache: 'no-store' })
        .then(function (r) {
          if (!r.ok) throw new Error(r.status === 503 ? 'There is no SD card in the box.' : 'The box would not open the book.');
          return r.json();
        })
        .then(function (d) {
          var b = parseBook(d);
          if (!b) throw new Error('The guest book file is not readable.');
          return b;
        });
    }

    function send(name, body, type) {
      return doFetch(WRITE_URL + encodeURIComponent(name), { method: 'POST', headers: { 'Content-Type': type || 'application/octet-stream' }, body: body })
        .then(function (r) {
          if (r.ok) return true;
          return r.json().catch(function () { return {}; }).then(function (j) { throw new Error(j.error || 'The box refused the write.'); });
        });
    }

    function writeBook(b) {
      var text = serialise(b);
      if (text === null) return Promise.reject(new Error('The guest book is too big to save.'));
      return send('guestbook.json', text, 'application/json');
    }

    function dropImage(id) {
      return doFetch('/api/guestbook/img-delete?id=' + (id | 0), { method: 'POST' }).catch(function () { return null; });
    }

    // One change at a time: read fresh, apply, write.
    function mutate(change) {
      var run = queue.then(function () {
        busy = true; renderBusy();
        return readBook().then(function (fresh) {
          return Promise.resolve(change(fresh)).then(function (res) {
            if (!res || res.error) throw new Error(res ? res.error : 'Nothing to do.');
            return writeBook(res.book).then(function () { book = res.book; return res; });
          });
        });
      });
      queue = run.catch(function () { return null; }).then(function () { busy = false; renderBusy(); });
      return run;
    }

    // ---- drawing pad ----
    function pad() { return el('gbPad'); }
    function ctx() { return pad().getContext('2d'); }

    function resetPad() {
      var c = ctx();
      c.fillStyle = '#ffffff';
      c.fillRect(0, 0, PAD_W, PAD_H);
      undo = []; hasPicture = false; renderPadButtons();
    }

    function pushUndo() {
      undo.push(ctx().getImageData(0, 0, PAD_W, PAD_H));
      if (undo.length > UNDO_MAX) undo.shift();
    }

    function point(ev) {
      var r = pad().getBoundingClientRect();
      return { x: (ev.clientX - r.left) * PAD_W / r.width, y: (ev.clientY - r.top) * PAD_H / r.height };
    }

    function stroke(from, to) {
      var c = ctx();
      c.strokeStyle = color; c.fillStyle = color;
      c.lineWidth = SIZES[sizeIx]; c.lineCap = 'round'; c.lineJoin = 'round';
      c.beginPath(); c.moveTo(from.x, from.y); c.lineTo(to.x, to.y); c.stroke();
      if (from.x === to.x && from.y === to.y) { c.beginPath(); c.arc(to.x, to.y, SIZES[sizeIx] / 2, 0, 6.2832); c.fill(); }
    }

    function padDown(ev) {
      ev.preventDefault();
      pushUndo(); drawing = true; hasPicture = true;
      last = point(ev); stroke(last, last);
      if (pad().setPointerCapture && ev.pointerId !== undefined) { try { pad().setPointerCapture(ev.pointerId); } catch (e) { /* not capturable */ } }
      renderPadButtons();
    }
    function padMove(ev) {
      if (!drawing) return;
      ev.preventDefault();
      var p = point(ev); stroke(last, p); last = p;
    }
    function padUp() { drawing = false; last = null; }

    function loadPhoto(file) {
      if (!file) return;
      var url = (root.URL || {}).createObjectURL ? root.URL.createObjectURL(file) : null;
      if (!url) { say('This browser cannot open photos here.', 'err'); return; }
      var img = new root.Image();
      img.onload = function () {
        pushUndo();
        var r = coverRect(img.naturalWidth || img.width, img.naturalHeight || img.height, PAD_W, PAD_H);
        ctx().drawImage(img, r.sx, r.sy, r.sw, r.sh, 0, 0, PAD_W, PAD_H);
        hasPicture = true; renderPadButtons();
        if (root.URL.revokeObjectURL) root.URL.revokeObjectURL(url);
        say('Photo added. Draw on it if you like.', '');
      };
      img.onerror = function () { say('That file would not open as a picture.', 'err'); };
      img.src = url;
    }

    // The pad as a small JPEG, tried at falling quality until it is under the cap.
    function padBlob() {
      return new Promise(function (resolve, reject) {
        var i = 0;
        (function attempt() {
          pad().toBlob(function (b) {
            if (!b) { reject(new Error('This browser could not save the picture.')); return; }
            if (b.size <= IMAGE_MAX_BYTES || i >= QUALITIES.length - 1) {
              if (b.size > IMAGE_MAX_BYTES) { reject(new Error('The picture is too detailed to save. Clear it and try a simpler one.')); return; }
              resolve(b); return;
            }
            i++; attempt();
          }, 'image/jpeg', QUALITIES[i]);
        })();
      });
    }

    // ---- rendering ----
    function btn(label, help, onClick, cls) {
      var b = doc.createElement('button');
      b.type = 'button';
      b.className = 'btn' + (cls ? ' ' + cls : '');
      b.setAttribute('data-help', help);   // help id comes from the caller
      b.textContent = label;
      b.addEventListener('click', onClick);
      return b;
    }

    function renderBusy() {
      ['gbPost'].forEach(function (id) { var b = el(id); if (b) b.disabled = busy; });
    }

    function renderPadButtons() {
      var u = el('gbUndo'); if (u) u.disabled = undo.length === 0;
      var c = el('gbClear'); if (c) c.disabled = !hasPicture;
      var sz = el('gbSize'); if (sz) sz.textContent = 'Brush ' + (sizeIx + 1);
      var sw = el('gbColors');
      if (sw) Array.prototype.forEach.call(sw.children, function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-color') === color ? 'true' : 'false'); });
    }

    function renderConfirm() {
      var box = el('gbConfirm');
      box.textContent = '';
      box.hidden = !pendingConfirm;
      if (!pendingConfirm) return;
      var p = doc.createElement('p');
      p.textContent = pendingConfirm.text;
      box.appendChild(p);
      box.appendChild(btn(pendingConfirm.yes, HELP.yes, function () { var c = pendingConfirm; pendingConfirm = null; renderConfirm(); c.run(); }, 'primary'));
      box.appendChild(btn('Cancel', HELP.no, function () { pendingConfirm = null; renderConfirm(); }));
    }

    function ask(text, yes, run) { pendingConfirm = { text: text, yes: yes, run: run }; renderConfirm(); }

    function entryNode(e, mine, inTrash) {
      var d = doc.createElement('div');
      d.className = 'gbentry' + (inTrash ? ' trashed' : '');
      var head = doc.createElement('div');
      head.className = 'gbhead';
      var who = doc.createElement('b'); who.textContent = e.h;
      var when = doc.createElement('span'); when.className = 'muted'; when.textContent = dateText(e.t);
      head.appendChild(who); head.appendChild(when);
      d.appendChild(head);

      if (editingId === e.id && !inTrash) {
        var hi = doc.createElement('input'); hi.type = 'text'; hi.maxLength = HANDLE_MAX; hi.value = e.h;
        hi.setAttribute('aria-label', 'Handle');
        hi.setAttribute('data-help', 'gb-handle');
        var mi = doc.createElement('textarea'); mi.maxLength = MESSAGE_MAX; mi.rows = 3; mi.value = e.m;
        mi.setAttribute('aria-label', 'Message');
        mi.setAttribute('data-help', 'gb-message');
        d.appendChild(hi); d.appendChild(mi);
        var row = doc.createElement('div'); row.className = 'gbbtns';
        row.appendChild(btn('Save changes', HELP.edit, function () {
          ask('Change this message? The old wording is not kept.', 'Yes, change it', function () { saveEdit(e.id, hi.value, mi.value); });
        }, 'primary'));
        row.appendChild(btn('Cancel', HELP.no, function () { editingId = null; render(); }));
        d.appendChild(row);
        return d;
      }

      var m = doc.createElement('p'); m.className = 'gbmsg'; m.textContent = e.m;
      d.appendChild(m);
      if (e.i) {
        var img = doc.createElement('img');
        img.className = 'gbimg'; img.alt = 'Picture from ' + e.h; img.width = PAD_W; img.height = PAD_H;
        img.loading = 'lazy'; img.src = imageUrl(e.id, e.t);
        d.appendChild(img);
      }
      if (mine) {
        var b = doc.createElement('div'); b.className = 'gbbtns';
        if (inTrash) {
          b.appendChild(btn('Restore', HELP.restore, function () { act(function (bk) { return restoreEntry(bk, e.id, mySecret()); }, 'Restored.'); }));
          b.appendChild(btn('Delete forever', HELP.purge, function () {
            ask('Delete this message forever? It cannot be brought back.', 'Yes, delete forever', function () { purge(e.id); });
          }));
        } else {
          b.appendChild(btn('Edit', HELP.edit, function () { editingId = e.id; render(); }));
          b.appendChild(btn('Delete', HELP.del, function () { act(function (bk) { return trashEntry(bk, e.id, mySecret()); }, 'Moved to the trash can.'); }));
        }
        d.appendChild(b);
      }
      return d;
    }

    function render() {
      var list = el('gbList'), trash = el('gbTrash');
      list.textContent = ''; trash.textContent = '';
      if (!book) { return; }
      var s = mySecret();
      var live = visibleEntries(book);
      if (!live.length) {
        var p = doc.createElement('p'); p.className = 'muted'; p.textContent = 'No messages yet. Be the first.';
        list.appendChild(p);
      }
      live.forEach(function (e) { list.appendChild(entryNode(e, owns(e, s), false)); });
      var mine = myTrash(book, s), others = otherTrashCount(book, s);
      el('gbTrashTitle').textContent = 'TRASH CAN (' + mine.length + ')';
      if (!mine.length) {
        var q = doc.createElement('p'); q.className = 'muted'; q.textContent = 'Empty.';
        trash.appendChild(q);
      }
      mine.forEach(function (e) { trash.appendChild(entryNode(e, true, true)); });
      if (others) {
        var o = doc.createElement('p'); o.className = 'muted';
        o.textContent = others + ' more ' + (others === 1 ? 'message is' : 'messages are') + ' in the trash can on other phones.';
        trash.appendChild(o);
      }
      renderConfirm();
    }

    // ---- actions ----
    function fail(err) { say(err && err.message ? err.message : 'Something went wrong.', 'err'); }

    function act(change, okText) {
      return mutate(change).then(function () { editingId = null; say(okText, 'ok'); render(); }).catch(fail);
    }

    function saveEdit(id, handle, message) {
      return act(function (bk) { return editEntry(bk, id, mySecret(), handle, message); }, 'Message changed.');
    }

    function purge(id) {
      var had = false;
      return mutate(function (bk) { var r = purgeEntry(bk, id, mySecret()); had = !!r.hadImage; return r; })
        .then(function () { if (had) return dropImage(id); return null; })
        .then(function () { say('Deleted forever.', 'ok'); render(); })
        .catch(fail);
    }

    function post() {
      var handle = el('gbHandle').value, message = el('gbMessage').value;
      if (!cleanHandle(handle)) { say('Add a handle first.', 'err'); return Promise.resolve(); }
      if (!cleanMessage(message)) { say('Add a message first.', 'err'); return Promise.resolve(); }
      var wantImage = hasPicture, blob = null, planned = null;
      say('Posting...', '');
      var prep = wantImage ? padBlob().then(function (b) { blob = b; }) : Promise.resolve();
      return prep.then(function () {
        return mutate(function (fresh) {
          var res = addEntry(fresh, handle, message, !!blob, mySecret(), now());
          if (res.error) return res;
          planned = res;
          // The picture goes in first, so a posted entry never points at nothing.
          if (!blob) return res;
          return send('gbimg-' + res.id + '.jpg', blob, 'image/jpeg').then(function () { return res; });
        });
      }).then(function (res) {
        if (res && res.dropped !== null && res.dropped !== undefined) dropImage(res.dropped);
        el('gbMessage').value = '';
        resetPad();
        el('gbPadWrap').hidden = true;
        el('gbPadToggle').textContent = 'Add photo / doodle';
        say('Posted. Thanks for stopping by.', 'ok');
        render();
      }).catch(function (err) {
        if (planned && blob) dropImage(planned.id);
        fail(err);
      });
    }

    function reload() {
      say('Opening the book...', '');
      return readBook().then(function (b) { book = b; say('', ''); render(); }).catch(function (err) { book = null; render(); fail(err); });
    }

    function open() { if (isOpen) return; isOpen = true; reload(); }
    function close() { isOpen = false; pendingConfirm = null; editingId = null; }

    // ---- wiring ----
    var win = el('win-guestbook');
    if (el('gbColors')) {
      COLORS.forEach(function (c) {
        var b = doc.createElement('button');
        b.type = 'button'; b.className = 'gbcolor';
        b.setAttribute('data-color', c); b.setAttribute('aria-label', 'Colour ' + c); b.style.background = c;
        b.setAttribute('data-help', 'gb-color');
        b.addEventListener('click', function () { color = c; renderPadButtons(); });
        el('gbColors').appendChild(b);
      });
      var p = pad();
      p.addEventListener('pointerdown', padDown);
      p.addEventListener('pointermove', padMove);
      p.addEventListener('pointerup', padUp);
      p.addEventListener('pointercancel', padUp);
      el('gbSize').addEventListener('click', function () { sizeIx = (sizeIx + 1) % SIZES.length; renderPadButtons(); });
      el('gbUndo').addEventListener('click', function () {
        var snap = undo.pop();
        if (snap) { ctx().putImageData(snap, 0, 0); hasPicture = undo.length > 0 || false; }
        renderPadButtons();
      });
      el('gbClear').addEventListener('click', function () { pushUndo(); resetPadKeepUndo(); });
      el('gbPhoto').addEventListener('change', function (ev) { loadPhoto(ev.target.files && ev.target.files[0]); ev.target.value = ''; });
      el('gbPadToggle').addEventListener('click', function () {
        var w = el('gbPadWrap'); w.hidden = !w.hidden;
        el('gbPadToggle').textContent = w.hidden ? 'Add photo / doodle' : 'Hide photo / doodle';
      });
      resetPad();
    }
    function resetPadKeepUndo() {
      var keep = undo;
      var c = ctx(); c.fillStyle = '#ffffff'; c.fillRect(0, 0, PAD_W, PAD_H);
      undo = keep; hasPicture = false; renderPadButtons();
    }
    el('gbPost').addEventListener('click', post);
    if (win && typeof root.MutationObserver === 'function') {
      new root.MutationObserver(function () { if (win.hidden) close(); else open(); })
        .observe(win, { attributes: true, attributeFilter: ['hidden'] });
    }
    if (win && !win.hidden) open();
    return { open: open, close: close, reload: reload, post: post, isOpen: function () { return isOpen; } };
  }

  if (typeof document !== 'undefined' && document.getElementById && document.getElementById('win-guestbook')) {
    attach(function (id) { return document.getElementById(id); });
  }

  var exported = {
    cleanHandle: cleanHandle, cleanMessage: cleanMessage, newSecret: newSecret, secretHash: secretHash, owns: owns,
    emptyBook: emptyBook, parseBook: parseBook, nextId: nextId, planAdd: planAdd, addEntry: addEntry,
    editEntry: editEntry, trashEntry: trashEntry, restoreEntry: restoreEntry, purgeEntry: purgeEntry,
    visibleEntries: visibleEntries, myTrash: myTrash, otherTrashCount: otherTrashCount, serialise: serialise,
    imageUrl: imageUrl, coverRect: coverRect, attach: attach,
    MAX_ENTRIES: MAX_ENTRIES, HANDLE_MAX: HANDLE_MAX, MESSAGE_MAX: MESSAGE_MAX, FILE_MAX_BYTES: FILE_MAX_BYTES
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  else root.LakehorseGuestBook = exported;
})(typeof window !== 'undefined' ? window : globalThis);
