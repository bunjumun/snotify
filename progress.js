/* progress.js — how far along is the record.
 *
 * The two checklists from his "album progress strategy" doc, and the arithmetic
 * that turns a set of ticks into a percentage. No DOM in here and no network:
 * this file is the definition and the maths, music.html is the surface.
 *
 * WHY THE LIST LIVES IN CODE AND NOT IN A TABLE.
 * The names and the weights are a design decision he has already made on paper.
 * Putting them in a table invites a half-edited checklist whose weights no
 * longer sum to 100, with nothing to notice it. Here they sum to 100 and the
 * file asserts it at load — see the bottom. That assertion is the whole reason
 * this is not just a data literal: a hand-edited weight that quietly makes the
 * maximum 97 is precisely the defect nobody ever reports, because the bar just
 * never reaches the end and everyone assumes they forgot something.
 *
 * WHY EVERY TASK HAS A SLUG AS WELL AS A NAME.
 * The stored row keys on the slug. His names are long English sentences and he
 * will reword them; a stored name would mean a reword silently unticking
 * everything. Slugs are frozen once shipped. Rewording a name is free.
 *
 * VERSIONING. Every stored row carries the CHECKLIST_VERSION it was ticked
 * under. Nothing reads it yet. It exists so that re-cutting the list later —
 * splitting a task, changing a weight — can tell old ticks from new ones
 * instead of reinterpreting them and quietly moving a band's bar.
 *
 * PERCENTAGES ARE NEVER STORED, anywhere. They are summed here, at render, from
 * the weights above. Change a weight and every bar on the site moves at once,
 * with no cached number left behind to disagree.
 */
(function (global) {
  'use strict';

  const CHECKLIST_VERSION = 1;

  /* The song checklist: five phases, 22 leaves, 100 points.
   * Straight from the doc. Where the doc's wording is a mouthful it is kept
   * anyway — it is his list, and the whole value of it is that the words say
   * exactly which piece of work is meant. */
  const SONG = [
    { key: 'w', name: 'Writing & Pre-Production', weight: 15, tasks: [
      { key: 'w.structure', weight: 3, name: 'Song structure & lyrics completed' },
      { key: 'w.arrangement', weight: 3, name: 'Working arrangement settled' },
      { key: 'w.scratch', weight: 3, name: 'Scratch / guide track uploaded' },
      { key: 'w.plan', weight: 3, name: 'Production plan set (tones, references, tempo, key)' },
      { key: 'w.demo', weight: 3, name: 'Pre-production demo tracked & exported' },
    ]},
    { key: 't', name: 'Tracking & Overdubs', weight: 35, tasks: [
      { key: 't.foundation', weight: 10, name: 'Main rhythm / foundation instruments tracked' },
      { key: 't.vox_arr', weight: 5, name: 'Vocal arrangement written & settled' },
      { key: 't.vox_main', weight: 8, name: 'Main vocal tracks recorded' },
      { key: 't.vox_harm', weight: 5, name: 'Vocal harmonies & backings recorded' },
      { key: 't.aux', weight: 7, name: 'Auxiliary tracking & overdubs recorded' },
    ]},
    { key: 'e', name: 'Editing & Post-Production', weight: 20, tasks: [
      { key: 'e.comp_inst', weight: 5, name: 'Main instruments comped & edited' },
      { key: 'e.comp_vox', weight: 5, name: 'Vocals comped, pitched & time-aligned' },
      { key: 'e.gain', weight: 4, name: 'Gain staging & project cleanup' },
      { key: 'e.rough', weight: 6, name: 'Rough mix exported for band review' },
    ]},
    { key: 'm', name: 'Mixing & Band Revisions', weight: 20, tasks: [
      { key: 'm.initial', weight: 7, name: 'Initial mix dialled in' },
      { key: 'm.v1', weight: 5, name: 'Mix revision v1 uploaded' },
      { key: 'm.feedback', weight: 5, name: 'Band feedback & revisions logged & addressed' },
      { key: 'm.approved', weight: 3, name: 'Final mix approved by all members' },
    ]},
    { key: 'r', name: 'Mastering, Export & Release Prep', weight: 10, tasks: [
      { key: 'r.premaster', weight: 3, name: 'Pre-masters exported & sent to mastering' },
      { key: 'r.master', weight: 3, name: 'Mastering revisions & final master approved' },
      { key: 'r.archive', weight: 2, name: 'Final high-res WAVs & stems archived' },
      { key: 'r.metadata', weight: 2, name: 'Metadata & distribution upload completed' },
    ]},
  ];

  /* The album checklist: five phases, 100 points, of which 50 are not ticked by
   * anyone. `auto: true` marks the phase the doc calls "Song Completion
   * Aggregate" — it is the mean of the songs' own percentages, so it has no box
   * and cannot be ticked. It is in the list rather than bolted on beside it so
   * that the phases still add to 100 and the accordion can show it in the
   * running order the doc gives it, second of five. */
  const ALBUM = [
    { key: 'a', name: 'Material & Track Selection', weight: 10, tasks: [
      { key: 'a.vision', weight: 3, name: 'Album vision & tracklist shortlist defined' },
      { key: 'a.flow', weight: 3, name: 'Key / tempo / sequence flow rough drafted' },
      { key: 'a.slots', weight: 4, name: 'All song track slots initialised & assigned' },
    ]},
    { key: 'avg', name: 'Song Completion Aggregate', weight: 50, auto: true, tasks: [] },
    { key: 'i', name: 'Album Integration & Master Flow', weight: 15, tasks: [
      { key: 'i.assembly', weight: 4, name: 'Full album rough assembly / sequencing render uploaded' },
      { key: 'i.transitions', weight: 4, name: 'Transitions, interludes & crossfades dialled in' },
      { key: 'i.seq_ok', weight: 3, name: 'Full album sequence approved by band' },
      { key: 'i.master', weight: 4, name: 'Final album master received & sequence approved' },
    ]},
    { key: 'v', name: 'Visuals, Assets & Packaging', weight: 15, tasks: [
      { key: 'v.cover', weight: 5, name: 'Front & back cover artwork uploaded & finalised' },
      { key: 'v.credits', weight: 3, name: 'Album credits, liner notes & lyrics formatted' },
      { key: 'v.packaging', weight: 4, name: 'Physical packaging layout completed' },
      { key: 'v.promo', weight: 3, name: 'Promotional assets & press kit ready' },
    ]},
    { key: 'd', name: 'Distribution, Rights & Release Strategy', weight: 10, tasks: [
      { key: 'd.codes', weight: 2, name: 'ISRC / UPC codes generated & metadata locked' },
      { key: 'd.upload', weight: 3, name: 'Distribution upload & pre-order scheduled' },
      { key: 'd.manufacture', weight: 2, name: 'Physical manufacturing submitted' },
      { key: 'd.campaign', weight: 3, name: 'Promo campaign schedule & release date locked' },
    ]},
  ];

  /* Every leaf in reading order, which is also backfill order: the cascade
   * prompt in phase 4 means "everything above this line", and "above" is this
   * order and nothing else. Flattened once at load rather than per render. */
  const flatten = (list) => list.reduce((acc, ph) => acc.concat(ph.tasks), []);
  const SONG_TASKS  = flatten(SONG);
  const ALBUM_TASKS = flatten(ALBUM);

  /* A tick set is a plain Set of task keys. The server only ever returns rows
   * that are done, so "in the set" and "ticked" are the same thing and there is
   * no third state to carry around. */
  function pct(list, ticks) {
    let got = 0;
    for (const ph of list) for (const t of ph.tasks) if (ticks.has(t.key)) got += t.weight;
    return got;
  }

  /* The song percentage: just the sum of what is ticked, because every point on
   * a song is manual. */
  function songPct(ticks) { return pct(SONG, ticks); }

  /* The album percentage: the manual half plus the mean of the songs.
   *
   * `songPcts` is one number per song IN THE ALBUM, including songs nobody has
   * touched, which is the assumption on the outbox and the one he can argue
   * with: an album of ten songs with one finished reads 5% of that phase and
   * not 50%. The other reading makes the bar lurch backwards every time a song
   * is added, which is the opposite of what a progress bar is for.
   *
   * An album with no songs in it scores zero for the phase rather than full
   * marks. Dividing by zero and calling it complete would say a record with
   * nothing on it is half made. */
  function albumPct(ticks, songPcts) {
    const manual = pct(ALBUM, ticks);
    const mean = songPcts.length
      ? songPcts.reduce((a, b) => a + b, 0) / songPcts.length
      : 0;
    const auto = ALBUM.find(ph => ph.auto);
    return manual + (mean / 100) * auto.weight;
  }

  /* Everything above a given task, for the cascade backfill. Returns the keys
   * that are not already ticked, so the prompt can say how many it would
   * actually change rather than claiming to fill in things already filled. */
  function priorTo(list, key, ticks) {
    const all = list === ALBUM ? ALBUM_TASKS : SONG_TASKS;
    const at = all.findIndex(t => t.key === key);
    if (at <= 0) return [];
    return all.slice(0, at).filter(t => !ticks.has(t.key)).map(t => t.key);
  }

  /* The assertion the whole file exists for. Both lists must sum to 100, and
   * each phase must sum to its own declared weight — the second half matters as
   * much as the first, because two errors that cancel out still mean the
   * accordion's phase headings lie about what a phase is worth.
   *
   * It throws rather than warns. A silently wrong maximum is worse than a page
   * that refuses to load, because the first is discovered months later by a bar
   * that never reaches the end and the second is discovered immediately. */
  function assertWeights() {
    for (const [name, list] of [['song', SONG], ['album', ALBUM]]) {
      let total = 0;
      for (const ph of list) {
        total += ph.weight;
        if (ph.auto) continue;                    // no leaves by design
        const leaves = ph.tasks.reduce((a, t) => a + t.weight, 0);
        if (leaves !== ph.weight)
          throw new Error(`progress.js: ${name} phase "${ph.name}" declares ${ph.weight} but its tasks sum to ${leaves}`);
      }
      if (total !== 100)
        throw new Error(`progress.js: the ${name} checklist sums to ${total}, not 100`);
    }
    const keys = new Set();
    for (const t of SONG_TASKS.concat(ALBUM_TASKS)) {
      if (keys.has(t.key)) throw new Error(`progress.js: duplicate task key ${t.key}`);
      keys.add(t.key);
    }
  }
  assertWeights();

  global.PROGRESS = {
    VERSION: CHECKLIST_VERSION,
    SONG, ALBUM, SONG_TASKS, ALBUM_TASKS,
    songPct, albumPct, priorTo,
  };
})(window);
