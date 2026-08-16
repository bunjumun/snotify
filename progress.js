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
  const CHECKLIST_VERSION = 6;

  /* The song checklist: ten stages, 24 leaves, 100 points.
   *
   * TRIMMED BY A QUARTER at his word ("simplify opitons by 25%"), from 32
   * leaves to 24. Nothing was dropped that was a real step; what went was
   * granularity that made the list a chore to read without telling him
   * anything he did not already know from the neighbouring box. The vocal
   * tournament is the clearest case: eight to four to two to one was four
   * boxes describing one afternoon, and what actually matters is that takes
   * exist, that they have been comped to one, and that it is finished. Session
   * cleanup folded into the edit pass it happens during, sweetening became one
   * act rather than two, credits and promo became the one errand they are, and
   * physical manufacturing left the song entirely because pressing a record is
   * the record's job and is on the album list.
   *
   * No stage weights changed, so nothing already ticked moved: the freed points
   * stayed inside the stage they came from. Every surviving key kept its name,
   * so the ticks already on the board survived the trim untouched.
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
      { key: 'e.rest', weight: 6, name: 'Filler and atmospheres edited, session cleaned up' },
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
      { key: 'v.takes', weight: 6, name: 'Takes recorded against the finished mix — eight of them' },
      { key: 'v.comp1', weight: 7, name: 'Comped down to one elite take' },
      { key: 'v.mix', weight: 5, name: 'Pitch corrected and mixed' },
    ]},
    { key: 's', name: 'Sweetening', weight: 6, tasks: [
      { key: 's.automation', weight: 6, name: 'Sweetened — automation, builds, doubles, transition effects' },
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
      { key: 'x.credits', weight: 2, name: 'Credits, lyrics and promo assets ready' },
    ]},
    { key: 'd', name: 'Distribution & rights', weight: 5, tasks: [
      { key: 'd.codes', weight: 2, name: 'ISRC code generated and metadata locked' },
      { key: 'd.out', weight: 3, name: 'Out — Soundcloud, or live through the distributor' },
    ]},
  ];

  /* THE ALBUM IS THE AVERAGE OF ITS SONGS PLUS ITS OWN VARIABLES, at his word:
   * "song level has the production pipeline. album completion is determined
   * more generally by averaging individual song completion amount and then
   * factoring in the rest of the variables".
   *
   * So the two lists part company, and the division of labour is clean. The
   * pipeline above — writing, tracking, editing, mixing, vocals, mastering —
   * happens to a SONG. It is meaningless at album level except as the average
   * of the songs it already applies to, which is what the first phase here is.
   * What is left over is the work that only exists because the songs are being
   * assembled into one object: choosing and ordering them, making them flow
   * into each other, mastering the sequence as a whole, and everything the
   * package needs.
   *
   * Half and half. Fifty points of average and fifty of album-only work is the
   * split the original doc chose and nothing has argued against it: a record of
   * finished songs that has never been sequenced, mastered or packaged is
   * genuinely about half done, and so is a fully packaged record of unfinished
   * songs.
   *
   * `auto: true` marks the averaged phase. It has no boxes because there is
   * nothing on it a person could tick — it is worked out from the songs — and
   * it sits in the list rather than beside it so the phases still add to 100
   * and it appears in its right place when the accordion is open.
   *
   * A NOTE ON WHAT LOOKS LIKE DUPLICATION. The song list also has Visuals &
   * assets and Distribution & rights, added when he said a finished song is
   * "choosable as a single release". Those are not these. A single's artwork
   * and its distribution are its own; the album's cover, liner notes, packaging
   * and pre-order are the record's. A song can go out as a single long before
   * the record is packaged, and both need saying. */
  const ALBUM = [
    { key: 'am', name: 'Material & track selection', weight: 10, tasks: [
      { key: 'am.vision', weight: 3, name: 'Album vision and shortlist defined' },
      { key: 'am.flow', weight: 3, name: 'Key, tempo and sequence flow rough drafted' },
      { key: 'am.slots', weight: 4, name: 'Every track slot filled — the songs that are on it are on it' },
    ]},
    { key: 'avg', name: 'Song completion average', weight: 50, auto: true, tasks: [] },
    { key: 'ai', name: 'Integration & master flow', weight: 15, tasks: [
      { key: 'ai.assembly', weight: 4, name: 'Full album assembly uploaded as one sequenced render' },
      { key: 'ai.transitions', weight: 4, name: 'Transitions, interludes and crossfades dialled in' },
      { key: 'ai.seq_ok', weight: 3, name: 'Running order approved by the band' },
      { key: 'ai.master', weight: 4, name: 'Final album master received and the sequence signed off' },
    ]},
    { key: 'av', name: 'Visuals, assets & packaging', weight: 15, tasks: [
      { key: 'av.cover', weight: 5, name: 'Front and back cover artwork finalised and uploaded' },
      { key: 'av.credits', weight: 3, name: 'Album credits, liner notes and lyrics formatted' },
      { key: 'av.packaging', weight: 4, name: 'Physical packaging layout completed' },
      { key: 'av.promo', weight: 3, name: 'Promotional assets and press kit ready' },
    ]},
    { key: 'ad', name: 'Distribution, rights & release', weight: 10, tasks: [
      { key: 'ad.codes', weight: 2, name: 'ISRC and UPC codes generated, metadata locked' },
      { key: 'ad.upload', weight: 3, name: 'Distribution upload and pre-order scheduled' },
      { key: 'ad.physical', weight: 2, name: 'Physical manufacturing submitted' },
      { key: 'ad.campaign', weight: 3, name: 'Promo campaign and release date locked' },
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
  /* The album's score: its own ticks, plus the averaged phase filled in from
   * the songs.
   *
   * The average counts EVERY song on the record, including ones nobody has
   * started, which is the reading he described: "3 of 5 songs could be complete
   * and choosable as single releases but the album that includes them and yet
   * to be completed songs would read as not complete". Three of five finished
   * and nothing else touched is 30 of the 50 averaged points, so 30%.
   *
   * A record with no songs on it scores zero for that phase rather than full
   * marks. Dividing by nothing and calling it complete would say a record with
   * nothing on it is half made.
   *
   * Nothing is auto-ticked from what is on the site, deliberately: "for now i'm
   * manually engaging the options on the webpage so dont worry about auto
   * filling". The averaged phase is worked out rather than ticked, which is a
   * different thing — it has no boxes to fill in by hand or otherwise. */
  function albumPct(ticks, songPcts) {
    const manual = pct(ALBUM, ticks);
    const auto = ALBUM.find(ph => ph.auto);
    if (!auto) return manual;
    const mean = songPcts.length
      ? songPcts.reduce((a, b) => a + b, 0) / songPcts.length
      : 0;
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
