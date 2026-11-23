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
 *
 * iPhones (Safari, and Chrome, which is Safari underneath) need two more
 * things, learned when a phone showed "playing" with no sound:
 *   - With the ring/silent switch on silent, iOS mutes Web Audio but not
 *     <audio>. Playing a silent loop on the <audio> element puts the page in
 *     "playback" mode, which un-mutes Web Audio. So while wavstream plays, the
 *     element loops a tenth of a second of silence (navigator.audioSession
 *     does the same on iOS 17+, but an iPhone 8 stops at iOS 16).
 *   - iOS lets an element play from a script only if it was first played
 *     inside a tap. Starting the silent loop in the tap primes the element,
 *     so falling back to it later (wavstream rejects when Web Audio will not
 *     start) is allowed to play.
 */

(function (root) {
  'use strict';

  function urlFor(track) { return '/sd/' + encodeURIComponent(track); }

  // 0.1 s of 8 kHz mono 16-bit silence as a WAV, built once.
  var silenceUrl = null;
  function silence() {
    if (silenceUrl) return silenceUrl;
    var frames = 800;
    var buf = new ArrayBuffer(44 + frames * 2);
    var v = new DataView(buf);
    var str = function (at, t) { for (var i = 0; i < 4; i++) v.setUint8(at + i, t.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + frames * 2, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, frames * 2, true);
    silenceUrl = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
    return silenceUrl;
  }
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

    // The element's job while wavstream plays: loop silence (see the header).
    function holdSessionOpen() {
      if (audio.getAttribute('src') !== silence()) {
        audio.loop = true;
        audio.src = silence();
      }
      var p = audio.play();
      if (p && p.catch) p.catch(function () { /* not in a tap; already primed or never will be */ });
    }

    function stopElement() {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }

    function playOnElement(url) {
      if (wav) wav.stop();
      engine = 'element';
      audio.loop = false;
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
        if (engine === 'element') audio.pause();
        engine = 'wav';
        if (root.navigator && root.navigator.audioSession) root.navigator.audioSession.type = 'playback';
        holdSessionOpen();   // inside the tap: primes the element, un-mutes iOS
        var w = wavPlayer();
        w.setNext(nextTrack && isWav(nextTrack) ? urlFor(nextTrack) : null);
        // A WAV wavstream cannot parse still plays, just through the element.
        return w.start(url).catch(function (e) {
          events.status(e && e.message ? e.message + '; playing the plain way.' : '');
          playOnElement(url);
          return true;
        });
      },

      pause: function () {
        if (engine === 'wav') wav.pause();
        audio.pause();
      },

      resume: function () {
        if (engine === 'wav') {
          holdSessionOpen();
          wav.resume();
        } else if (engine === 'element') {
          audio.play().catch(function () { events.status('Tap play to start.'); });
        }
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

      // Eight levels 0..8 for the sound this page is playing, or null. Only the
      // WAV engine can be tapped: routing the <audio> element through Web Audio
      // would mute it when its source is not same-origin, so those songs get
      // no bars here.
      bands: function () {
        if (engine !== 'wav' || !wav || !wav.spectrum || !root.LakehorseBandMeter) return null;
        var sp = wav.spectrum();
        return sp ? root.LakehorseBandMeter.levelsFromSpectrum(sp.db, sp.sampleRate, sp.fftSize) : null;
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
