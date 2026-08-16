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

  /* Bumped on every change to what the lists MEAN, so a stored row claiming a
   * shape that no longer exists stays possible to spot. 1 was the generated
   * checklist; 2 his own pipeline; 3 the album borrowing the song's list; 4 the
   * album blended half and half; 5 the album back to its own variables plus the
   * song average; 6 a quarter fewer boxes; 7 half again.
   *
   * Versions 1 to 6 were all changed against an empty or near-empty table, so
   * nothing was ever silently reinterpreted. Version 7 was not: it kept the four
   * keys whose meaning survived the merge (w.idea, w.written, f.main, a.body) so
   * that the ticks already on the board carried over rather than being wiped.
   * He offered to let progress be reset to zero to save the trouble; it was not
   * needed, and throwing away real ticks to avoid a few minutes of care would
   * have been the wrong trade. */
  const CHECKLIST_VERSION = 7;

  /* The song checklist: six stages, 12 leaves, 100 points.
   *
   * WHY IT LOOKS NOTHING LIKE THE GENERATED ONE. That list put vocals in
   * tracking, two stages before mixing. He records vocals AFTER the
   * instrumental mix is basically done, on purpose: it lets him sing to
   * something that already sounds like a record rather than fighting a muddy
   * bass, and it puts the longest job last instead of in the middle. Those two
   * orders cannot both be true, and it is his record.
   *
   * WHY THE NAMES POINT AT THINGS ON THIS SITE. At his word: "tailor naming and
   * criteria to the assets that exist on the site already when possible". A
   * prototype is a version on the stack, a rough mix is an upload the band can
   * comment on, the final mix is the one wearing the star. A box he can settle
   * by looking at the page beats one he has to remember.
   *
   * WHY THE WEIGHTS ARE LOPSIDED. Also his: weight by effort, not importance.
   * Recording and arrangement carry 24 and vocals 18 because that is where the
   * hours go; mixing carries 9 despite making or breaking a record, because a
   * veteran does most of it in an hour. The bar measures work remaining.
   *
   * HOW IT GOT HERE, since the shape moved a lot in one day: 22 generated ->
   * 27 (his own pipeline) -> 32 (a song's release made as full as a record's)
   * -> 24 ("simplify by 25%") -> 12 ("way too granular, tone it down 50%").
   * Not one of those needed a migration, because the list lives in code. */
  const SONG = [
    /* Six stages, twelve boxes. Halved at his word ("your song completion list
     * is way too granular, tone it down 50%"), from 24.
     *
     * The cut is not more merging of neighbours — that was the last pass, and
     * doing it again would have produced twelve boxes with three-clause names.
     * This is a different question: what is the smallest set of moments where a
     * song genuinely changes state? Tempo and the main instrument are one act of
     * sitting down to record. Body, filler and atmospheres are one act of
     * arranging. Sweetening and mastering are the same afternoon of finishing.
     * A box earns its place if he would ever be half way between it and its
     * neighbour; if he would not, it was never a step, only a description.
     *
     * FOUR KEYS ARE DELIBERATELY REUSED — w.idea, w.written, f.main, a.body —
     * so the ticks already on Light survive the halving instead of being wiped.
     * Where a merged box means the same thing as one of the old ones, it keeps
     * the old key rather than taking a tidier new one. */
    { key: 'w', name: 'Songwriting', weight: 12, tasks: [
      { key: 'w.idea', weight: 4, name: 'Idea landed, and a prototype or two on the stack' },
      { key: 'w.written', weight: 8, name: 'Written through — structure, lyrics and arrangement settled' },
    ]},
    { key: 'f', name: 'Recording & arrangement', weight: 24, tasks: [
      { key: 'f.main', weight: 10, name: 'Tempo settled and the main instrument tracked' },
      { key: 'a.body', weight: 14, name: 'Arranged and tracked — body, filler and atmospheres' },
    ]},
    { key: 'e', name: 'Editing', weight: 16, tasks: [
      { key: 'e.body', weight: 10, name: 'Edited tight without going inhuman' },
      { key: 'e.rough', weight: 6, name: 'Cleaned up and a rough mix out to the band' },
    ]},
    { key: 'm', name: 'Mixing', weight: 9, tasks: [
      { key: 'm.in', weight: 4, name: 'Mixing under way and revisions coming back' },
      { key: 'm.final', weight: 5, name: 'Final mix chosen — the starred one' },
    ]},
    { key: 'v', name: 'Vocals', weight: 18, tasks: [
      { key: 'v.comp1', weight: 11, name: 'Takes recorded and comped down to one' },
      { key: 'v.mix', weight: 7, name: 'Pitch corrected and mixed' },
    ]},
    { key: 'r', name: 'Mastering & release', weight: 21, tasks: [
      { key: 'r.master', weight: 11, name: 'Sweetened and mastered' },
      { key: 'd.out', weight: 10, name: 'Artwork, metadata and out — Soundcloud or a distributor' },
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

  /* ------------------------------------------------------------------------
   * HIS OWN ITEMS, AND THE WEIGHTS STRETCHING TO FIT
   *
   * At his word: "allow me to add or remove tems to album progress list that
   * are unique to particular item i am editing on, these should stretch or
   * compress completion weghts appropriately".
   *
   * THE RULE, and it is one sentence: a category keeps its declared weight, and
   * the items inside it share that weight in proportion to their base weights.
   *
   * Everything follows from that. Remove a box from Editing and its points go to
   * the boxes still in Editing, not to Mixing. Add one and they all give a
   * little. The record still totals 100 with nothing renormalised anywhere else,
   * so a song with three extra boxes and a song with none are still directly
   * comparable — which matters, because the record's score is the average of
   * them and an average of numbers on different scales would be meaningless.
   *
   * The one case that needs its own answer: a category emptied completely. Its
   * weight cannot stay with it, so it is shared out across the surviving
   * categories in proportion to theirs. Dropping the category and letting the
   * total fall to 90 would mean a song that can never reach 100.
   *
   * A custom item with weight 0 means "an ordinary one", resolved here to the
   * average of the built-ins in its category, so adding a box never asks him to
   * think about numbers. That is why the default is 0 rather than some fixed
   * figure: what counts as ordinary differs per category.
   * --------------------------------------------------------------------------- */

  /* Build the list as it actually stands for one song or one record: built-ins
   * minus what he has hidden, plus what he has added, with every weight resolved
   * to its effective value. Everything else in this file works on the result, so
   * nothing downstream needs to know that custom items exist. */
  function shapedList(list, shape) {
    const hidden = (shape && shape.hidden) || new Set();
    const added  = (shape && shape.items) || [];
    const phases = [];
    for (const ph of list) {
      if (ph.auto) { phases.push({ ...ph, tasks: [] }); continue; }
      const kept = ph.tasks.filter(t => !hidden.has(t.key));
      const mine = added.filter(i => i.phase === ph.key);
      if (!kept.length && !mine.length) continue;          // emptied; see below
      // "An ordinary one" = the average of this category's built-ins, so the
      // default is meaningful per category rather than a fixed number.
      const avg = ph.tasks.length
        ? ph.tasks.reduce((a, t) => a + t.weight, 0) / ph.tasks.length : 1;
      const tasks = kept.map(t => ({ ...t, base: t.weight }))
        .concat(mine.map(i => ({
          key: 'c.' + i.id, name: i.label, custom: true, id: i.id,
          base: i.weight > 0 ? i.weight : avg,
        })));
      phases.push({ ...ph, tasks });
    }
    // A category that lost every box takes its weight with it, so what is left
    // is scaled back up to 100. Without this a song could never finish.
    const total = phases.reduce((a, ph) => a + ph.weight, 0) || 1;
    const scale = 100 / total;
    return phases.map(ph => {
      const w = ph.weight * scale;
      const sum = ph.tasks.reduce((a, t) => a + t.base, 0) || 1;
      return { ...ph, weight: w, tasks: ph.tasks.map(t => ({ ...t, weight: w * t.base / sum })) };
    });
  }

  /* The shape for one song or record, out of the raw rows the server returns.
   * Kept here rather than in the page so that the read-only bar on the other two
   * pages gets the same answer without repeating any of it. */
  function shapeFor(raw, scope, ref) {
    if (!raw) return { hidden: new Set(), items: [] };
    return {
      hidden: new Set((raw.hidden || [])
        .filter(h => h.scope === scope && h.ref === ref).map(h => h.key)),
      items: (raw.items || [])
        .filter(i => i.scope === scope && i.ref === ref)
        .sort((a, b) => (a.sort || 0) - (b.sort || 0)),
    };
  }

  /* ------------------------------------------------------------------------
   * THE REMIX FLAG WAS HERE, AND HE ASKED FOR IT BACK OUT (CR-50)
   *
   * CR-47 added a flag that withheld the last phase's points on a song or a
   * record while it was on, without touching a tick, so that finished work
   * deliberately reopened did not read the same as work never done. He said
   * that misread him: "You misunderstood my intent here, rewind these changes".
   * So the mechanic is gone rather than renamed, and the button it put at the
   * foot of the checklist is now the one he asked for, "edit progress criteria".
   *
   * Left as a comment rather than as nothing, because the distinction it was
   * drawing is still real and may come back under some other name: a record at
   * 79% because it was never mastered and one at 79% because the mix was
   * reopened are opposite situations, and no number alone can tell them apart.
   * The full reasoning is in CR-47 in the ledger. The v28 table is still in the
   * database, empty and unread. */

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
  function songPct(ticks, shape) {
    return pct(shapedList(SONG, shape), ticks);
  }

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
  function albumPct(ticks, songPcts, shape) {
    const list = shapedList(ALBUM, shape);
    const manual = pct(list, ticks);
    const auto = list.find(ph => ph.auto);
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
    songPct, albumPct, priorTo, shapedList, shapeFor,
  };
})(window);
