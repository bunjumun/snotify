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

  /* Version 2 is HIS workflow. Version 1 was the Gemini checklist that shipped
   * earlier the same day; he read it, gave his own process instead, and chose
   * to replace rather than merge. Nothing was ticked under version 1 — the
   * table was confirmed empty before the swap — so no band lost a tick and
   * there is no migration. Version 3 is the album adopting the same list as a
   * song, again against an empty table. The number moves on every change to
   * what the lists MEAN, because a stored row claiming a list that no longer
   * exists is worth being able to spot later. */
  const CHECKLIST_VERSION = 4;

  /* The song checklist: nine stages, 27 leaves, 100 points.
   *
   * WHY IT LOOKS NOTHING LIKE THE FIRST ONE. The shipped list was generated,
   * and it put vocals in tracking — two stages before mixing. He records vocals
   * AFTER the instrumental mix is basically done, on purpose: it lets him sing
   * to something that already sounds like a record rather than fighting a muddy
   * bass, and it puts the longest and most important job last instead of in the
   * middle. Those two orders cannot both be true, and it is his record.
   *
   * WHY THE NAMES POINT AT THINGS ON THIS SITE. At his word: "tailor naming and
   * criteria to the assets that exist on the site already when possible". So a
   * prototype is a version on the stack rather than an abstract demo, a rough
   * mix is an upload the band can comment on, revising mixes is the to-do list
   * filling and emptying, and the final mix is the one wearing the star. A box
   * you can settle by looking at the page beats one you have to remember.
   *
   * WHY THE WEIGHTS ARE LOPSIDED. Also his: weight by effort, not by
   * importance. Editing is 18 because he calls it by far the most mind-numbing
   * part of the whole process, and vocals are 22 because the tournament comp is
   * the longest. Mixing is 9 despite being the thing that makes or breaks a
   * record, because a veteran does 90% of it in an hour. The bar measures work
   * remaining, not how much each stage matters. */
  const SONG = [
    /* Three boxes, not the five in his written process. He collapsed Gestation
     * and Development into "prototypes", which is the better word here because
     * it names something that exists — a scratch sitting on the stack — where
     * gestation names a state of mind nobody can tick honestly. */
    { key: 'w', name: 'Songwriting', weight: 12, tasks: [
      { key: 'w.idea', weight: 3, name: 'Idea landed — a riff, an image, a line worth chasing' },
      { key: 'w.proto', weight: 4, name: 'Prototypes recorded — a scratch or two up on the stack' },
      { key: 'w.written', weight: 5, name: 'Written through — structure, lyrics and arrangement settled' },
    ]},
    /* His tempo rule is in the task name on purpose. It is the one step in the
     * whole process with a trap in it: whatever you pick on day one feels right
     * because you have spent an hour acclimatising to the tempo below it. */
    { key: 'f', name: 'Recording: foundation', weight: 10, tasks: [
      { key: 'f.tempo', weight: 4, name: 'Tempo settled — tried either side of it, and slept on before committing' },
      { key: 'f.main', weight: 6, name: 'Main instrument tracked — the one you would play it on alone' },
    ]},
    /* His three arranging categories, which were already three ticks waiting to
     * happen. The weighting says what he says: body is the song, the other two
     * are the difference between a local band and the radio. */
    { key: 'a', name: 'Arrangement', weight: 14, tasks: [
      { key: 'a.body', weight: 7, name: 'Body tracked — what a five-piece would play live' },
      { key: 'a.filler', weight: 4, name: 'Filler tracked — the parts nobody notices and everybody hears' },
      { key: 'a.atmos', weight: 3, name: 'Atmospheres tracked — the reverb-drenched background mass' },
    ]},
    { key: 'e', name: 'Editing', weight: 16, tasks: [
      { key: 'e.body', weight: 7, name: 'Body edited — transients pulled tight without going inhuman' },
      { key: 'e.rest', weight: 4, name: 'Filler and atmospheres edited' },
      { key: 'e.gain', weight: 2, name: 'Gain staging and session cleanup' },
      { key: 'e.rough', weight: 3, name: 'Rough mix uploaded as a version for the band to pick at' },
    ]},
    /* Three STATES, not three jobs, and that is exactly what he asked for:
     * "just have me verify when we are in mix phase, when we are revising mixes
     * and when we have chosen a final mix and ready to move to next phase". A
     * mix is not a checklist, it is a place the song is in. */
    { key: 'm', name: 'Mixing', weight: 9, tasks: [
      { key: 'm.in', weight: 2, name: 'In the mix phase' },
      { key: 'm.revising', weight: 3, name: 'Revising mixes — notes coming in on the to-do and being answered' },
      { key: 'm.final', weight: 4, name: 'Final mix chosen — the starred one — and ready to move on' },
    ]},
    /* The heaviest stage, and last rather than middle. The tournament is his,
     * down to the number: eight takes because it halves cleanly three times. */
    { key: 'v', name: 'Vocals', weight: 18, tasks: [
      { key: 'v.takes', weight: 4, name: 'Eight takes recorded against the finished mix' },
      { key: 'v.comp4', weight: 3, name: 'Comped down to four' },
      { key: 'v.comp2', weight: 3, name: 'Comped down to two' },
      { key: 'v.pitch', weight: 3, name: 'Final two pitch corrected' },
      { key: 'v.comp1', weight: 2, name: 'Comped down to one elite take' },
      { key: 'v.mix', weight: 3, name: 'Vocal mixed' },
    ]},
    { key: 's', name: 'Sweetening', weight: 6, tasks: [
      { key: 's.automation', weight: 3, name: 'Automation and builds — the transitions ramp the way they should' },
      { key: 's.extras', weight: 3, name: 'Doubles, extra parts and transition effects added' },
    ]},
    { key: 'r', name: 'Mastering', weight: 5, tasks: [
      { key: 'r.eq', weight: 2, name: 'Master EQ — top-end sparkle, bass weight, mids in check' },
      { key: 'r.limit', weight: 3, name: 'Compression and limiting — level sits with everything else' },
    ]},
    /* A SONG'S RELEASE IS AS FULL AS AN ALBUM'S, at his word: a finished song is
     * "choosable as a single release", so it needs everything a record needs —
     * artwork, credits, codes, a distributor. These two stages are what the old
     * generated album list called Visuals & Packaging and Distribution, Rights
     * & Release Strategy, folded into the one shared list so both levels get
     * them. Physical packaging and manufacturing read oddly on a single and are
     * kept anyway: he ticks these by hand, so a box that does not apply is one
     * he leaves alone, and dropping it would lose it for the album. */
    { key: 'x', name: 'Visuals & assets', weight: 5, tasks: [
      { key: 'x.art', weight: 3, name: 'Cover artwork finalised and uploaded' },
      { key: 'x.credits', weight: 1, name: 'Credits, liner notes and lyrics formatted' },
      { key: 'x.promo', weight: 1, name: 'Promo assets and press kit ready' },
    ]},
    { key: 'd', name: 'Distribution & rights', weight: 5, tasks: [
      { key: 'd.codes', weight: 1, name: 'ISRC / UPC codes generated and metadata locked' },
      { key: 'd.upload', weight: 2, name: 'Distribution upload and pre-save scheduled' },
      { key: 'd.physical', weight: 1, name: 'Physical manufacturing submitted' },
      { key: 'd.out', weight: 1, name: 'Out — Soundcloud, or live through the distributor' },
    ]},
  ];

  /* THE ALBUM USES THE SAME LIST AS A SONG, at his word: "we'll need to refine
   * progress criteria per song verses album eventually but for now use the same
   * metrics for both". So there is one checklist, applied at two levels.
   *
   * What this replaced: a separate generated album list — material selection,
   * integration and master flow, visuals and packaging, distribution — with a
   * fifty-point phase that was the mean of the songs and could not be ticked by
   * anyone. It is in the git history if it is ever wanted back, and
   * docs/song-workflow-plan.md records why it went.
   *
   * TWO CONSEQUENCES WORTH KNOWING, because neither is obviously right.
   *
   * The album's score is now its OWN ticks and nothing else — it no longer
   * moves on its own as the songs fill in. "The album is mastered" is a
   * different claim from "every song is mastered", and this measures the first.
   * If he wants the songs to feed it again that is one phase back in the list.
   *
   * The same task key can now exist at both scopes for the same band. That is
   * fine and always was: the stored row carries `scope`, and the unique key is
   * (band, scope, ref, task_key). Ticking Mastering on the album does not tick
   * it on any song.
   *
   * He also said the music page is the album for now, and that it splits into
   * releases once there is more than one. Nothing here has to change for that:
   * the album is keyed on the album slug, and a second album starts its own
   * row set the day a song is given one. */
  const ALBUM = SONG;

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
  /* THE ALBUM IS HALF ITS OWN TICKS AND HALF ITS SONGS, at his word: "songs
   * have their own completion status that feeds into album completion status.
   * so 3 of 5 songs could be complete and choosable as single releases but the
   * album that includes them and yet to be completed songs would read as not
   * complete."
   *
   * That sentence rules out both simple answers. If the album were only its own
   * checklist it would not budge as songs finished, and three finished songs
   * would show nothing. If it were only the mean of its songs it would have no
   * room for the work that is the record's alone — sequencing it, mastering it
   * as a whole, getting the artwork made. So it is a blend, an even one: half
   * the album's own ticks over the same nine stages, half how far its songs
   * have got.
   *
   * Three of five songs finished and nothing else touched therefore reads 30%,
   * and cannot read complete until both halves are, which is the behaviour he
   * described. A song's own score is one number wherever it is looked at — as
   * part of the record or as a single — because it is stored against the song,
   * not against the context it is viewed in.
   *
   * Nothing is auto-ticked from what is on the site, deliberately: "for now i'm
   * manually engaging the options on the webpage so dont worry about auto
   * filling". Every box here is his to tick. */
  const ALBUM_OWN_SHARE = 0.5;
  function albumPct(ticks, songPcts) {
    const own = pct(ALBUM, ticks);
    if (!songPcts.length) return own;
    const mean = songPcts.reduce((a, b) => a + b, 0) / songPcts.length;
    return own * ALBUM_OWN_SHARE + mean * (1 - ALBUM_OWN_SHARE);
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
    /* Per list, not across both. The two scopes deliberately share their keys
     * now, and the stored row separates them by `scope`. */
    for (const [name, tasks] of [['song', SONG_TASKS], ['album', ALBUM_TASKS]]) {
      const keys = new Set();
      for (const t of tasks) {
        if (keys.has(t.key)) throw new Error(`progress.js: duplicate ${name} task key ${t.key}`);
        keys.add(t.key);
      }
    }
  }
  assertWeights();

  global.PROGRESS = {
    VERSION: CHECKLIST_VERSION,
    SONG, ALBUM, SONG_TASKS, ALBUM_TASKS,
    songPct, albumPct, priorTo,
  };
})(window);
