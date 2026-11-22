/* Lakehorse Radio: the browser backend for player.js. Sound comes out of the
 * listener's own phone or computer.
 *
 * Two engines sit behind it, and the page never sees which one is running:
 *   - WAVs go through wavstream.js (Web Audio over two parallel Range
 *     requests). One connection from the box is too slow for a WAV; see the
 *     header of wavstream.js for the numbers.
 *   - Everything else (AAC from song-prep), and any WAV wavstream cannot
 *     read (not 16-bit PCM), goes through the hidden <audio> element with
 *     buffering.js holding it behind a cushion.
 *
 * Both report through the same three events, so player.js gets one shape of
 * progress whichever engine is playing.
 */

(function (root) {
  'use strict';

  function urlFor(track) { return '/sd/' + encodeURIComponent(track); }
  function isWav(track) { return /\.wav$/i.test(track); }

  /* audio: the page's <audio> element (no controls; the player bar drives it). */
  function create(audio) {
    var events = null;
    var engine = null;        // 'wav' | 'element' | null
    var wav = null;
    var buffer = null;
    var volume = 1;

    function wavPlayer() {
      if (wav) return wav;
      wav = root.LakehorseWavStream.createPlayer({
        status: function (t) { events.status(t); },
        ended: function () { events.ended(); },
        progress: function (pos, dur, playing) { events.progress(pos, dur, playing); }
      });
      wav.setVolume(volume);
      return wav;
    }

    function elementProgress() {
      if (engine !== 'element') return;
      var dur = isFinite(audio.duration) ? audio.duration : 0;
      events.progress(audio.currentTime, dur, !audio.paused);
    }

    function stopElement() {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }

    function playOnElement(url) {
      if (wav) wav.stop();
      engine = 'element';
      if (!buffer) buffer = root.LakehorseBuffer.attach(audio, function (t) { events.status(t); });
      buffer.start(url);
    }

    return {
      name: 'browser',
      available: true,

      connect: function (e) {
        events = e;
        ['timeupdate', 'play', 'pause', 'durationchange'].forEach(function (type) {
          audio.addEventListener(type, elementProgress);
        });
        audio.addEventListener('ended', function () { if (engine === 'element') events.ended(); });
      },

      play: function (track, nextTrack) {
        var url = urlFor(track);
        if (!root.LakehorseWavStream || !isWav(track)) {
          playOnElement(url);
          return Promise.resolve(true);
        }
        stopElement();
        engine = 'wav';
        var w = wavPlayer();
        w.setNext(nextTrack && isWav(nextTrack) ? urlFor(nextTrack) : null);
        // A WAV wavstream cannot parse still plays, just through the element.
        return w.start(url).catch(function () { playOnElement(url); return true; });
      },

      pause: function () {
        if (engine === 'wav') wav.pause();
        else if (engine === 'element') audio.pause();
      },

      resume: function () {
        if (engine === 'wav') wav.resume();
        else if (engine === 'element') audio.play().catch(function () { events.status('Tap play to start.'); });
      },

      seek: function (seconds) {
        if (engine === 'wav') wav.seek(seconds);
        else if (engine === 'element') audio.currentTime = seconds;
      },

      setVolume: function (v) {
        volume = v;
        audio.volume = v;
        if (wav) wav.setVolume(v);
      },

      stop: function () {
        if (wav) wav.stop();
        stopElement();
        engine = null;
      }
    };
  }

  root.LakehorseBrowserPlayer = { create: create };
})(typeof window !== 'undefined' ? window : globalThis);
