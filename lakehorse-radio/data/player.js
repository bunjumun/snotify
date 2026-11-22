/* Lakehorse Radio: the player, the one thing the page talks to for playback.
 *
 * Why a layer. Songs play in the listener's browser today (player-browser.js),
 * and v2 adds playing them on the box itself, out of a speaker (player-box.js).
 * The page should not care which: its buttons call play, pause, next and
 * volume here, and this hands each call to whichever backend is plugged in.
 * Swapping backends is then one line in library.js, not a rewrite.
 *
 * This layer owns what is the same for both: the track list, which track is
 * current, what "next" means, and the volume. Backends own only how sound is
 * made. Tracks are passed as names on the card, not URLs, because the box
 * backend will play by name and has no use for a URL.
 *
 * A backend is an object with:
 *   name                     short label, e.g. 'browser'
 *   available                false if it cannot play at all on this device
 *   connect(events)          events = { progress(pos, dur, playing),
 *                                       status(text), ended() }
 *   play(track, nextTrack)   starts track; nextTrack (or null) may be
 *                            preloaded. Returns a Promise.
 *   pause() / resume()
 *   seek(seconds)
 *   setVolume(v)             v from 0 to 1
 *   stop()
 *
 * Pure apart from the backend it is given, so test/player.test.js runs it in
 * node against a fake backend.
 */

(function (root) {
  'use strict';

  function clampVolume(v) {
    v = Number(v);
    if (!isFinite(v)) return 1;
    return Math.min(1, Math.max(0, v));
  }

  /* hooks (all optional): progress(pos, dur, playing), status(text),
   * track(name or null) when the current track changes. */
  function createPlayer(backend, hooks, initialVolume) {
    hooks = hooks || {};
    var tracks = [];
    var current = null;
    var playing = false;
    var volume = clampVolume(initialVolume === undefined ? 1 : initialVolume);

    function emit(name) {
      var fn = hooks[name];
      if (fn) fn.apply(null, Array.prototype.slice.call(arguments, 1));
    }

    function after(name) {
      var i = tracks.indexOf(name);
      return i >= 0 && i + 1 < tracks.length ? tracks[i + 1] : null;
    }

    function setCurrent(name) {
      current = name;
      emit('track', name);
    }

    backend.connect({
      progress: function (pos, dur, isPlaying) {
        playing = !!isPlaying;
        emit('progress', pos, dur, playing);
      },
      status: function (text) { emit('status', text); },
      ended: function () {
        playing = false;
        if (!api.next()) setCurrent(null);
      }
    });
    backend.setVolume(volume);

    var api = {
      backendName: function () { return backend.name; },

      /* The list "next" walks, in order. Called again whenever the card's
       * listing changes; the current track keeps playing even if it is gone. */
      setTracks: function (names) { tracks = (names || []).slice(); },

      play: function (name) {
        if (!backend.available) {
          emit('status', 'This device cannot play here.');
          return Promise.resolve(false);
        }
        setCurrent(name);
        playing = true;
        return Promise.resolve(backend.play(name, after(name))).catch(function (e) {
          playing = false;
          emit('status', 'Could not play ' + name + (e && e.message ? ': ' + e.message : '.'));
          return false;
        });
      },

      pause: function () {
        if (!current) return;
        playing = false;
        backend.pause();
      },

      resume: function () {
        if (!current) return;
        playing = true;
        backend.resume();
      },

      toggle: function () {
        if (playing) api.pause();
        else api.resume();
      },

      /* Plays the track after the current one. False when there is none. */
      next: function () {
        var n = after(current);
        if (!n) return false;
        api.play(n);
        return true;
      },

      seek: function (seconds) {
        if (current) backend.seek(Math.max(0, seconds));
      },

      setVolume: function (v) {
        volume = clampVolume(v);
        backend.setVolume(volume);
        return volume;
      },

      /* Silences the backend and forgets the current track. Used when the
       * page switches where songs play, so the old backend stops first. */
      stop: function () {
        playing = false;
        backend.stop();
        if (current) setCurrent(null);
      },

      volume: function () { return volume; },
      current: function () { return current; },
      isPlaying: function () { return playing; }
    };
    return api;
  }

  var exported = { createPlayer: createPlayer, clampVolume: clampVolume };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  else root.LakehorsePlayer = exported;
})(typeof window !== 'undefined' ? window : globalThis);
