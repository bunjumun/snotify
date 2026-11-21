/* Lakehorse Radio: a pre-buffer in front of the <audio> element.
 *
 * The box sends a song over Wi-Fi from its SD card, and on a busy 2.4 GHz
 * network that link runs in bursts: fast for a while, then stalled for a
 * second while a lost packet is resent. A browser left to itself starts
 * playing as soon as it has a sliver of audio, so every stall is heard as a
 * dropout. This holds playback back until a cushion of audio is already
 * downloaded, and if the cushion runs dry anyway it pauses cleanly, refills a
 * bigger one, and carries on.
 *
 * The cushion starts small (START_SECONDS) so a song begins quickly, and
 * doubles after each stall up to MAX_SECONDS, so a slow link costs a couple of
 * waits and then settles rather than stuttering all the way through. Once the
 * whole rest of the song is downloaded there is nothing to wait for.
 *
 * iOS only lets an <audio> element play if play() was first called inside a
 * tap. So start() calls play() straight away, inside the tap, and pauses it at
 * once; the element stays unlocked, and the later play() calls made from a
 * timer are allowed.
 */

(function () {
  'use strict';

  var START_SECONDS = 8;     // cushion before a song starts
  var MAX_SECONDS = 64;      // largest cushion after repeated stalls
  var POLL_MS = 250;         // how often to look at the buffer while holding

  /* Seconds of audio already downloaded ahead of the playhead. */
  function secondsAhead(audio) {
    var t = audio.currentTime;
    for (var i = 0; i < audio.buffered.length; i++) {
      if (audio.buffered.start(i) <= t + 0.5 && audio.buffered.end(i) >= t) {
        return audio.buffered.end(i) - t;
      }
    }
    return 0;
  }

  function restIsLoaded(audio) {
    return isFinite(audio.duration) && audio.duration > 0 &&
           secondsAhead(audio) >= audio.duration - audio.currentTime - 0.5;
  }

  /* Wraps `audio`. onStatus(text) is called with a line to show the listener,
   * or '' when there is nothing to say. */
  function attach(audio, onStatus) {
    var target = START_SECONDS;
    var holding = false;    // paused by us, waiting for the cushion
    var starting = false;   // between start() and the first real play
    var seeking = false;
    var timer = null;

    function release() {
      holding = false;
      starting = false;
      clearTimeout(timer);
      onStatus('');
      var p = audio.play();
      if (p && p.catch) {
        p.catch(function () { onStatus('Tap play to start.'); });
      }
    }

    function poll() {
      clearTimeout(timer);
      if (!holding) return;
      var ahead = secondsAhead(audio);
      if (ahead >= target || restIsLoaded(audio)) { release(); return; }
      onStatus('Buffering ' + Math.floor(ahead) + ' of ' + target + ' s');
      timer = setTimeout(poll, POLL_MS);
    }

    function hold() {
      holding = true;
      audio.pause();
      poll();
    }

    // The buffer ran dry mid-song. A seek into unloaded audio also fires this
    // and is not the link's fault, so only a genuine stall grows the cushion.
    audio.addEventListener('waiting', function () {
      if (holding || audio.paused) return;
      if (!seeking) target = Math.min(MAX_SECONDS, target * 2);
      hold();
    });
    audio.addEventListener('seeking', function () { seeking = true; });
    audio.addEventListener('playing', function () { seeking = false; });

    // Pressing play on the controls while we hold means "play now anyway".
    audio.addEventListener('play', function () {
      if (holding && !starting) { holding = false; clearTimeout(timer); onStatus(''); }
    });

    return {
      start: function (url) {
        clearTimeout(timer);
        target = START_SECONDS;
        seeking = false;
        audio.preload = 'auto';
        audio.src = url;
        starting = true;
        var p = audio.play();   // inside the tap: unlocks the element on iOS
        if (p && p.catch) p.catch(function () { /* interrupted by hold(), expected */ });
        hold();
      }
    };
  }

  window.LakehorseBuffer = { attach: attach };
})();
