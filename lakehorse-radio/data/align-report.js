/* Lakehorse Radio: reports songs this phone played to the box's alignment
 * counter (ALIGNMENT-BRIEF.md, "Who reports what").
 *
 * Only when the page itself is playing. When the box plays a song through its
 * speaker the box counts it, so a tracker is built only for the browser
 * backend, and a song is never counted twice.
 *
 * It counts time actually listened (position moving forward in small steps),
 * not where the seek bar sits, so jumping to the end earns nothing. A song
 * left after half its length earns the partial credit; one listened through
 * earns the full credit. The box decides what the credit is worth, whether
 * the file is a band track, and ignores a repeat inside ten seconds.
 *
 * Pure apart from the `post` function it is given (tested in node).
 */
(function (root) {
  'use strict';

  var STEP_MAX = 1.5;     // seconds: a bigger jump in position is a seek, not listening
  var PARTIAL_AT = 0.5;   // share listened before leaving earns anything
  var FULL_AT = 0.95;     // share listened to count as played to the end

  /* post(name, result) is called with 'full' or 'partial'. */
  function createTracker(post) {
    var name = null, last = null, dur = 0, listened = 0;

    function reset(next) { name = next || null; last = null; dur = 0; listened = 0; }

    function leave() {
      if (!name || !(dur > 0)) return;
      var share = Math.min(1, listened / dur);
      if (share >= FULL_AT) post(name, 'full');
      else if (share >= PARTIAL_AT) post(name, 'partial');
    }

    return {
      /* The player's track hook: a new song, or null when it stopped. */
      track: function (next) {
        if (next === name) return;
        leave();
        reset(next);
      },
      progress: function (pos, duration, playing) {
        if (!name) return;
        if (isFinite(duration) && duration > 0) dur = duration;
        if (!playing || !isFinite(pos)) { last = null; return; }
        if (last !== null) {
          var step = pos - last;
          if (step > 0 && step <= STEP_MAX) listened += step;
        }
        last = pos;
      },
      /* The page is closing or the player is being replaced. */
      flush: function () { leave(); reset(null); }
    };
  }

  /* Sends one event. Never throws: a missed report must not disturb playback. */
  function poster(fetchFn) {
    return function (name, result) {
      try {
        var url = '/api/alignment/event?source=song&id=' + encodeURIComponent(name) + '&result=' + result;
        var p = fetchFn(url, { method: 'POST', keepalive: true });
        if (p && p.catch) p.catch(function () { /* not heard; the song is simply not counted */ });
      } catch (e) { /* same */ }
    };
  }

  var api = { createTracker: createTracker, poster: poster, STEP_MAX: STEP_MAX, PARTIAL_AT: PARTIAL_AT, FULL_AT: FULL_AT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LakehorseAlignReport = api;
})(typeof window !== 'undefined' ? window : globalThis);
