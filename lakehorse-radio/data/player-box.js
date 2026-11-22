/* Lakehorse Radio: the on-box backend for player.js.
 *
 * The box plays the song itself, out of its Bluetooth speaker
 * (src/box_player.cpp), and this page is only the remote. Each call becomes
 * a POST to /api/player/*; progress comes back by polling /api/player once a
 * second while a song is current. Polling rather than an event stream
 * because the server already closes every connection (HANDOFF.md, Module 4),
 * and one small GET a second is nothing next to the audio.
 *
 * The end of a song arrives as a counter, `ended`, not a flag: a poll that
 * lands late or twice can neither miss an end nor report one twice.
 *
 * `opts` exists for test/player-box.test.js: { fetch, setInterval,
 * clearInterval }. The page passes nothing and gets the browser's own.
 */

(function (root) {
  'use strict';

  var POLL_MS = 1000;

  function create(opts) {
    opts = opts || {};
    var doFetch = opts.fetch || root.fetch.bind(root);
    var every = opts.setInterval || root.setInterval.bind(root);
    var cancel = opts.clearInterval || root.clearInterval.bind(root);

    var events = null;
    var timer = null;
    var lastEnded = null;   // counter value when the current song started
    var lastStatusText = '';

    function say(text) {
      if (text === lastStatusText) return;
      lastStatusText = text;
      if (events) events.status(text);
    }

    function call(path, method) {
      return doFetch(path, { method: method || 'POST', cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d.ok) throw new Error(d.error || 'the box refused');
          return d;
        });
    }

    function apply(d) {
      if (!events) return;
      if (lastEnded !== null && d.ended !== lastEnded) {
        lastEnded = d.ended;
        stopPolling();
        events.ended();
        return;
      }
      events.progress(d.position || 0, d.duration || 0, d.state === 'playing');
      if (d.error) say(d.error);
      else if (!d.connected) say('Box speaker ' + d.speaker + ' is not connected. Switch it on (pairing mode the first time).');
      else say('');
    }

    function poll() {
      call('/api/player', 'GET').then(apply).catch(function () {
        say('Lost touch with the box.');
      });
    }

    function startPolling() {
      if (timer === null) timer = every(poll, POLL_MS);
    }

    function stopPolling() {
      if (timer !== null) cancel(timer);
      timer = null;
    }

    function command(path) {
      return call(path).then(function (d) { apply(d); return d; })
        .catch(function (e) { say(e.message); });
    }

    return {
      name: 'box',
      available: true,
      connect: function (e) { events = e; },
      play: function (track) {
        return call('/api/player/play?name=' + encodeURIComponent(track)).then(function (d) {
          lastEnded = d.ended;
          lastStatusText = '';
          apply(d);
          startPolling();
          return true;
        });
      },
      pause: function () { return command('/api/player/pause'); },
      resume: function () { return command('/api/player/resume'); },
      seek: function (s) { return command('/api/player/seek?t=' + encodeURIComponent(s)); },
      setVolume: function (v) { return command('/api/player/volume?v=' + encodeURIComponent(v)); },
      stop: function () {
        stopPolling();
        lastEnded = null;
        return command('/api/player/stop');
      }
    };
  }

  /* Whether this box was built with Bluetooth at all. Resolves false on any
   * failure, so an older box simply never offers the choice. */
  function probe(fetchFn) {
    var f = fetchFn || root.fetch.bind(root);
    return f('/api/player', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { return !!(d && d.ok && d.built); })
      .catch(function () { return false; });
  }

  var exported = { create: create, probe: probe };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  else root.LakehorseBoxPlayer = exported;
})(typeof window !== 'undefined' ? window : globalThis);
