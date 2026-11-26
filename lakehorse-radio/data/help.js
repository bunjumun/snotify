/* Lakehorse Radio: help. What's this? mode and the Help index.
 *
 * Why it is shaped like this:
 *   * Every usable element carries data-help="<id>", and all the words live in
 *     help.json keyed by that id. This file holds no help text of its own.
 *   * What's this? works like Windows 95: the "?" in a title bar (frame.js)
 *     turns it on, and the next tap explains the thing tapped instead of doing
 *     it. That is done with one transparent catcher laid over the whole page:
 *     the tap lands on the catcher, so a button, slider, select or link under
 *     it cannot act, with no handler on any of them. The catcher then asks
 *     which element is underneath (elementFromPoint) and walks up to the
 *     nearest data-help. Tapping a title bar finds the window's own entry.
 *   * help.json is fetched the first time help is used (mode on, or the Help
 *     window opened), never at load, so help costs no request until wanted.
 *     A missing or malformed file leaves the page fully working: the bubble
 *     just says help could not be loaded.
 *   * The bubble is plain text (textContent, never innerHTML) and stays crisp:
 *     it sits above the screen-look layers (style.css).
 *
 * Pure helpers first (tested without a page), then attach().
 */
(function (root) {
  'use strict';

  var FILE = 'help.json';
  var BUBBLE_W = 270;
  var MARGIN = 8;
  var NOT_WRITTEN = 'Nothing has been written about this yet.';
  var NOT_LOADED = 'Help could not be loaded. The page itself still works.';
  var NOTHING = 'Nothing here to ask about. Tap a button, slider, icon or song.';
  var HINT = "What's this? is on. Tap anything to ask about it.";

  // Pure: a parsed help.json to { entries, index }, or null if it is not one.
  // Entries without a text are dropped; a bad index list becomes empty.
  function normalize(data) {
    if (!data || typeof data !== 'object' || !data.entries || typeof data.entries !== 'object') return null;
    var entries = {};
    Object.keys(data.entries).forEach(function (id) {
      var e = data.entries[id];
      if (e && typeof e.text === 'string' && e.text) {
        entries[id] = { title: typeof e.title === 'string' ? e.title : id, text: e.text };
      }
    });
    var index = [];
    if (Array.isArray(data.index)) {
      data.index.forEach(function (g) {
        if (g && typeof g.group === 'string' && Array.isArray(g.ids)) {
          index.push({ group: g.group, ids: g.ids.filter(function (i) { return typeof i === 'string'; }) });
        }
      });
    }
    return { entries: entries, index: index };
  }

  // Pure: the id for an element, from the element itself or the nearest
  // ancestor that has one. Walks parentNode so it needs no closest().
  function helpIdFor(node) {
    while (node) {
      var id = node.getAttribute && node.getAttribute('data-help');
      if (id) return id;
      node = node.parentNode;
    }
    return '';
  }

  // Pure: what the bubble says for an id given the loaded help (or null).
  function bubbleFor(help, id) {
    if (!help) return { title: '', text: NOT_LOADED };
    if (!id) return { title: '', text: NOTHING };
    var e = help.entries[id];
    return e ? { title: e.title, text: e.text } : { title: '', text: NOT_WRITTEN };
  }

  // Pure: where the bubble goes. `rect` is the tapped thing's box, `view` the
  // viewport. It sits below the thing when there is room, otherwise above, and
  // never leaves the screen sideways.
  function placeBubble(rect, view, height) {
    var w = Math.min(BUBBLE_W, view.width - 2 * MARGIN);
    var left = rect.left + rect.width / 2 - w / 2;
    left = Math.max(MARGIN, Math.min(view.width - w - MARGIN, left));
    var below = rect.bottom + MARGIN;
    var top = below + height <= view.height - MARGIN ? below : rect.top - MARGIN - height;
    top = Math.max(MARGIN, Math.min(view.height - height - MARGIN, top));
    return { left: Math.round(left), top: Math.round(top), width: Math.round(w) };
  }

  function attach(el, opts) {
    opts = opts || {};
    var doc = opts.doc || root.document;
    var doFetch = opts.fetch || (root.fetch ? root.fetch.bind(root) : null);
    var help = null;
    var loading = null;
    var armed = false;

    function load() {
      if (help) return Promise.resolve(help);
      if (loading) return loading;
      if (!doFetch) return Promise.resolve(null);
      // no-cache: the box serves page files as immutable for 70 days, but this
      // file is text a person edits, so it is revalidated (a 304 costs almost nothing).
      loading = doFetch(FILE, { cache: 'no-cache' })
        .then(function (r) { return r.ok === false ? null : r.json(); })
        .then(function (d) { help = normalize(d); loading = null; return help; })
        .catch(function () { loading = null; return null; });
      return loading;
    }

    function showBubble(b, rect) {
      var bubble = el('helpBubble');
      el('helpBubbleTitle').textContent = b.title;
      el('helpBubbleTitle').hidden = !b.title;
      el('helpBubbleText').textContent = b.text;
      bubble.hidden = false;
      var view = { width: doc.documentElement.clientWidth, height: doc.documentElement.clientHeight };
      var p = placeBubble(rect, view, bubble.offsetHeight || 90);
      bubble.style.left = p.left + 'px';
      bubble.style.top = p.top + 'px';
      bubble.style.width = p.width + 'px';
    }

    function hideBubble() { el('helpBubble').hidden = true; }

    function setArmed(on) {
      armed = !!on;
      el('helpCatcher').hidden = !armed;
      doc.documentElement.classList.toggle('asking', armed);
    }

    function viewRect() {
      var w = doc.documentElement.clientWidth, h = doc.documentElement.clientHeight;
      return { left: w / 2, top: h / 3, bottom: h / 3, width: 0 };
    }

    function turnOn() {
      setArmed(true);
      return load().then(function (h) { if (!h) showBubble(bubbleFor(null, ''), viewRect()); else showBubble({ title: '', text: HINT }, viewRect()); });
    }

    function ask(x, y) {
      setArmed(false);
      var target = doc.elementFromPoint ? doc.elementFromPoint(x, y) : null;
      var id = helpIdFor(target);
      var rect = target && target.getBoundingClientRect ? target.getBoundingClientRect()
        : { left: x, top: y, bottom: y, width: 0 };
      return load().then(function (h) { showBubble(bubbleFor(h, id), rect); });
    }

    // The Help window: one <details> per entry, grouped, built on first open.
    var built = false;
    function buildIndex() {
      if (built) return;
      var box = el('helpList');
      if (!box) return;
      load().then(function (h) {
        box.textContent = '';
        if (!h) { box.textContent = NOT_LOADED; return; }
        built = true;
        h.index.forEach(function (g) {
          var title = doc.createElement('p');
          title.className = 'label';
          title.textContent = g.group.toUpperCase();
          box.appendChild(title);
          g.ids.forEach(function (id) {
            var e = h.entries[id];
            if (!e) return;
            var d = doc.createElement('details');
            d.className = 'helpentry';
            var s = doc.createElement('summary');
            s.setAttribute('data-help', 'help-entry');
            s.textContent = e.title;
            var p = doc.createElement('p');
            p.textContent = e.text;
            d.appendChild(s);
            d.appendChild(p);
            box.appendChild(d);
          });
        });
      });
    }

    doc.addEventListener('click', function (ev) {
      var t = ev.target;
      var q = t && t.closest ? t.closest('.win-help') : null;
      if (q || (t && t.id === 'startWhat')) {
        if (armed) { setArmed(false); hideBubble(); } else { hideBubble(); turnOn(); }
        return;
      }
      if (!el('helpBubble').hidden) hideBubble();
    }, true);
    el('helpCatcher').addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      hideBubble();
      ask(ev.clientX, ev.clientY);
    });
    doc.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') { setArmed(false); hideBubble(); }
    });
    var helpWin = el('win-help');
    if (helpWin && typeof root.MutationObserver === 'function') {
      new root.MutationObserver(function () { if (!helpWin.hidden) buildIndex(); })
        .observe(helpWin, { attributes: true, attributeFilter: ['hidden'] });
    }
    return { turnOn: turnOn, ask: ask, load: load, buildIndex: buildIndex, isArmed: function () { return armed; } };
  }

  if (typeof document !== 'undefined' && document.getElementById && document.getElementById('helpCatcher')) {
    attach(function (id) { return document.getElementById(id); });
  }

  var exported = { normalize: normalize, helpIdFor: helpIdFor, bubbleFor: bubbleFor, placeBubble: placeBubble, attach: attach, FILE: FILE };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  else root.LakehorseHelp = exported;
})(typeof window !== 'undefined' ? window : globalThis);
