/* Lakehorse Radio: the shell.
 *
 * A small desktop around the page: windows, a taskbar with a Start button, a
 * Start menu, desktop icons and a first-run view. It owns no feature. Every
 * feature script (player, speaker panel, matrix window, setup form) still
 * finds its own elements by the same ids as before, and the shell only decides
 * which windows are showing.
 *
 * Why it is shaped like this:
 *   * A window is any `.win` element, open unless it has the `hidden`
 *     attribute. That is the whole contract, so a script that opens or closes
 *     its own window (the matrix window does) needs no call into the shell:
 *     the taskbar watches the attribute and follows.
 *   * A window whose script does work when it opens (the matrix window starts
 *     polling) names its own handles with data-opener / data-closer, and the
 *     shell clicks those instead of flipping the attribute. Nothing runs that
 *     the window's own script did not agree to.
 *   * First run is decided by /api/status, which app.js already fetches: it
 *     calls onStatus() with the reply, so the shell makes no request of its
 *     own. With no home Wi-Fi saved, the Start menu opens with Network
 *     highlighted and the setup window is opened, because a phone arriving
 *     through the captive-portal sheet often cannot navigate anywhere else.
 *   * Windows flow in the page rather than float: stacked full width on a
 *     phone, side by side on a wide screen (style.css). Dragging is not built.
 *
 * Pure helpers first (tested without a page), then attach() for the DOM side.
 * `opts` for attach exists for tests: { all, now, setInterval, doc }.
 */

(function (root) {
  'use strict';

  var CLOCK_MS = 30000;

  // Pure: the taskbar clock, 12-hour like the mockup ("6:02 PM").
  function clockText(date) {
    var h = date.getHours();
    var m = date.getMinutes();
    return (h % 12 === 0 ? 12 : h % 12) + ':' + (m < 10 ? '0' : '') + m + (h < 12 ? ' AM' : ' PM');
  }

  // Pure: the taskbar button text. Three open windows must fit one row on a
  // 375 px phone, so the ".EXE" that the window's title bar carries is left off.
  function taskLabel(title) { return String(title).replace(/\.EXE$/, ''); }

  // Pure: true only when the box says it has no home network saved. An
  // unreadable or missing reply is not a first run: showing the setup nag
  // because a request failed would be wrong.
  function needsNetwork(status) {
    return !!status && status.hasSavedNetwork === false;
  }

  function attach(el, opts) {
    opts = opts || {};
    var doc = opts.doc || root.document;
    var all = opts.all || function (sel) { return doc.querySelectorAll(sel); };
    var now = opts.now || function () { return new Date(); };
    var every = opts.setInterval || root.setInterval.bind(root);

    function wins() { return Array.prototype.slice.call(all('.win')); }
    function winById(id) { return el(id); }

    function click(id) { var e = el(id); if (e) e.click(); }

    function isOpen(w) { return !w.hidden; }

    function focusWin(w) {
      wins().forEach(function (x) { x.classList.toggle('focus', x === w); });
      if (w.scrollIntoView) {
        try { w.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { /* old browser: stays put */ }
      }
    }

    function open(id) {
      var w = winById(id);
      if (!w) return;
      if (!isOpen(w)) {
        if (w.dataset && w.dataset.opener) click(w.dataset.opener);
        else w.hidden = false;
      }
      renderTasks();
      focusWin(w);
    }

    function close(id) {
      var w = winById(id);
      if (!w || !isOpen(w)) return;
      if (w.dataset && w.dataset.closer) click(w.dataset.closer);
      else w.hidden = true;
      renderTasks();
    }

    function renderTasks() {
      var bar = el('tasks');
      bar.textContent = '';
      wins().filter(isOpen).forEach(function (w) {
        var b = doc.createElement('button');
        b.type = 'button';
        b.className = 'task' + (w.classList.contains('focus') ? ' focus' : '');
        b.textContent = taskLabel((w.dataset && w.dataset.title) || w.id);
        b.addEventListener('click', function () { focusWin(w); renderTasks(); });
        bar.appendChild(b);
      });
    }

    function setStart(on) {
      el('startMenu').hidden = !on;
      el('startBtn').setAttribute('aria-expanded', on ? 'true' : 'false');
    }

    function firstRun() {
      el('startNetwork').classList.add('needs');
      el('startNetworkNote').textContent = 'needs setup';
      el('callout').hidden = false;
      el('tray').textContent = 'NO WI-FI';
      el('tray').classList.add('warn');
      open('win-network');
      setStart(true);
    }

    function onStatus(status) {
      if (needsNetwork(status)) firstRun();
    }

    function tickClock() {
      if (!el('tray').classList.contains('warn')) el('tray').textContent = clockText(now());
    }

    // Wiring. Buttons carry what they do in data attributes, so the markup
    // reads as the menu.
    Array.prototype.slice.call(all('[data-open]')).forEach(function (b) {
      b.addEventListener('click', function () {
        open(b.dataset.open);
        setStart(false);
        el('callout').hidden = true;
      });
    });
    Array.prototype.slice.call(all('[data-close]')).forEach(function (b) {
      b.addEventListener('click', function () {
        var w = b.parentNode && b.parentNode.parentNode;
        if (w && w.id) close(w.id);
      });
    });
    el('startBtn').addEventListener('click', function () {
      setStart(el('startMenu').hidden);
      el('callout').hidden = true;
    });
    if (doc.addEventListener) {
      doc.addEventListener('click', function (ev) {
        if (el('startMenu').hidden) return;
        var t = ev.target;
        if (t && t.closest && (t.closest('#startMenu') || t.closest('#startBtn'))) return;
        setStart(false);
      });
      doc.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape' && !el('startMenu').hidden) setStart(false);
      });
    }
    if (typeof root.MutationObserver === 'function' && !opts.noObserver) {
      var watch = new root.MutationObserver(renderTasks);
      wins().forEach(function (w) { watch.observe(w, { attributes: true, attributeFilter: ['hidden'] }); });
    }

    tickClock();
    every(tickClock, CLOCK_MS);
    renderTasks();
    return { open: open, close: close, onStatus: onStatus, renderTasks: renderTasks, setStart: setStart };
  }

  var api = null;
  if (typeof document !== 'undefined' && document.getElementById && document.getElementById('startBtn')) {
    api = attach(function (id) { return document.getElementById(id); });
  }

  var exported = {
    clockText: clockText,
    needsNetwork: needsNetwork,
    taskLabel: taskLabel,
    attach: attach,
    // Called by app.js with /api/status; a no-op until the shell exists.
    onStatus: function (s) { if (api) api.onStatus(s); },
    open: function (id) { if (api) api.open(id); }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  else root.LakehorseShell = exported;
})(typeof window !== 'undefined' ? window : globalThis);
