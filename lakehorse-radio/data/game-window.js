/* Lakehorse Radio: GAME.EXE.
 *
 * The Swimulator is not in the box's flash (512 KB, page only). It is plain
 * files in the SD card's /game/ folder, served by the box under /game/. This
 * window only checks the card has it and offers the launch link.
 *
 * Pure helper first (tested without a page), then attach().
 */
(function (root) {
  'use strict';

  var GAME_URL = '/game/';

  // Pure: what the window should say, from the probe of /game/index.html.
  // `probe` is { status } (HTTP status) or null when the request itself failed.
  function describe(probe) {
    if (!probe) return { ready: false, note: 'Could not reach the box.' };
    if (probe.status === 200 || probe.status === 206) return { ready: true, note: 'On the SD card. Loads in about 10 seconds.' };
    if (probe.status === 503) return { ready: false, note: 'No SD card in the box.' };
    if (probe.status === 404) return { ready: false, note: 'Not on the card yet. Copy the game folder to the SD card as /game.' };
    return { ready: false, note: 'The box answered ' + probe.status + '.' };
  }

  function attach(el, fetchFn) {
    var f = fetchFn || root.fetch.bind(root);
    var link = el('gameLaunch');
    var note = el('gameNote');
    if (!link || !note) return Promise.resolve(null);
    // GET with a one-byte Range, not HEAD: the box registers /game/* for GET only, so HEAD 404s even when the game is on the card.
    return f(GAME_URL + 'index.html', { headers: { Range: 'bytes=0-0' }, cache: 'no-store' })
      .then(function (r) { return { status: r.status }; })
      .catch(function () { return null; })
      .then(function (probe) {
        var d = describe(probe);
        note.textContent = d.note;
        var guber = el('guberLaunch');  // ships in the same pack, so same readiness
        [link, guber].forEach(function (a) {
          if (!a) return;
          if (d.ready) a.removeAttribute('aria-disabled');
          else a.setAttribute('aria-disabled', 'true');
        });
        return d;
      });
  }

  var exported = { describe: describe, attach: attach, GAME_URL: GAME_URL };
  if (typeof module !== 'undefined' && module.exports) { module.exports = exported; return; }
  root.LakehorseGameWindow = exported;
  if (root.document) {
    var run = function () { attach(function (id) { return root.document.getElementById(id); }); };
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', run);
    else run();
  }
})(typeof window !== 'undefined' ? window : globalThis);
