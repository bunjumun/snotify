/* progress-ui.js — the record's progress bar, for pages that only need to show it.
 *
 * The player owns the full thing: bars you can open, a checklist you can tick, a
 * dropdown to fill in any track. That lives in music.html because it is most of
 * a page's worth of behaviour and only one page needs it.
 *
 * This is the other half. Sn'Album's front page and the art page both want to
 * say how far along the record is without becoming editors of it, so what they
 * get is a read-only bar that links to the player. One file, mounted the same
 * way on both, rather than the same fifty lines pasted twice and then diverging
 * the first time anything changes.
 *
 * WHY IT FETCHES ITS OWN DATA. Both host pages already call `get_library` for
 * their own reasons, so asking them to hand it over would mean each one knowing
 * the shape this needs and passing it correctly. Fetching is one extra call on a
 * page that is already making several, and it means mounting is a single line
 * with nothing to get wrong.
 *
 * WHY IT IS SILENT ON FAILURE. A band that has never ticked anything, a page
 * loaded before v25 was applied, a network blip: in every case the right
 * behaviour is no bar at all. There is nothing half-drawn to explain, and a page
 * about artwork should not grow an error message about a checklist.
 *
 * Depends on progress.js for the arithmetic and on core.js for `libRpc`.
 */
(function (global) {
  'use strict';

  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // The same fallback the player uses: a song with no album set belongs to the
  // band's own record. Every song has a null album today, so this makes one
  // record named after the band, and splits on its own the day one is set.
  const slug = (t) => String(t || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  /* Mount read-only bars into `host`.
   *   host  — the element to fill. Left empty, and so invisible, on any failure.
   *   opts.href — where the bar links to, i.e. the player, where it can be edited.
   *   opts.bandTitle — what to call a record whose songs have no album set. */
  async function mount(host, opts) {
    opts = opts || {};
    if (!host || !global.PROGRESS || typeof libRpc !== 'function') return;
    let lib, rows, shape, notes;
    try {
      [lib, rows, shape, notes] = await Promise.all([
        libRpc('get_library', {}),
        libRpc('progress_all', {}),
        // His own added and removed steps. Fetched here rather than ignored,
        // because a bar that does not know about them would quietly disagree
        // with the player about the same record — and two different numbers for
        // one thing is worse than no number at all.
        libRpc('progress_shape', {}).catch(() => ({ items: [], hidden: [] })),
        // The notes on each song, for the same reason: since 2026-08-22 an open
        // note costs a song 1% and a resolved one pays 4%, so a bar drawn
        // without them is not a rounder version of the player's number, it is a
        // different number.
        libRpc('get_comments', {}).catch(() => []),
      ]);
    } catch { return; }                    // see "silent on failure" above
    const songs = ((lib && lib.songs) || []).filter(s => s && s.folder);
    if (!songs.length) return;

    // Same effective-exclusion rule as the player (CR-81, music.html): a song
    // excludes itself, or inherits exclusion from the folder it currently sits
    // in. `get_library`'s raw song/folder rows carry both flags directly, so
    // this needs no normalize() step the way the player's does.
    const foldersById = new Map(((lib && lib.folders) || []).map(f => [f.id, f]));
    const excludedFromAlbumPct = (s) =>
      !!(s && (s.excluded || (s.music_folder_id && (foldersById.get(s.music_folder_id) || {}).excluded)));

    // scope+ref → Set of ticked task keys, the same shape the player keeps.
    const ticks = Object.create(null);
    const setFor = (scope, ref) => {
      const k = scope + '/' + ref;
      return ticks[k] || (ticks[k] = new Set());
    };
    // Only a DONE row belongs in a tick set — an assignee or a note with no
    // tick is phase-2 metadata, not phase 1, and this bar has never read
    // that. Found unguarded during the CR-103 extraction: harmless while no
    // such row exists, but a bar that would have shown false progress the
    // day one did.
    for (const r of (rows || [])) if (r.done) setFor(r.scope, r.ref).add(r.key);

    // song_id -> {open, done}, counting ROOTS ONLY so this agrees with the
    // player's to-do tabs. A reply is part of a note, not a note of its own.
    const todos = Object.create(null);
    for (const c of (notes || [])) {
      if (c.parent_id) continue;
      const t = todos[c.song_id] || (todos[c.song_id] = { open: 0, done: 0 });
      c.resolved ? t.done++ : t.open++;
    }
    /* `get_library` hands back a bare song id ("this-is-war") while a comment
     * is keyed by the band-qualified one ("lakehorse/this-is-war"). The player
     * builds that key in its own normalize(); this rebuilds it the same way
     * rather than matching on the bare id, which would silently find nothing
     * and quietly show every song its checklist-only number. */
    const bandOf = (lib && lib.slug) || (typeof curBand === 'string' ? curBand : '');
    const todosFor = (s) => {
      const id = s && (s.id || slug(s.title || ''));
      return (id && todos[bandOf + '/' + id]) || { open: 0, done: 0 };
    };

    const title = opts.bandTitle || (lib && lib.title) || '';
    const albums = [], seen = new Map();
    for (const s of songs) {
      const name = (s.album || '').trim() || title;
      const key = slug(name);
      if (!seen.has(key)) { seen.set(key, { slug: key, name, songs: [] }); albums.push(seen.get(key)); }
      seen.get(key).songs.push(s);
    }

    host.innerHTML = albums.map(a => {
      const P = global.PROGRESS;
      const pctOf = (s) => P.songPct(setFor('song', s.folder), P.shapeFor(shape, 'song', s.folder), todosFor(s));
      // Excluded songs still count toward "N of M songs finished" below — only
      // what feeds the percentage mean excludes them. See music.html's
      // albumPctOf, which keeps the same split for the same reason.
      const allPcts = a.songs.map(pctOf);
      const countedPcts = a.songs.filter(s => !excludedFromAlbumPct(s)).map(pctOf);
      const w = Math.round(
        P.albumPct(setFor('album', a.slug), countedPcts, P.shapeFor(shape, 'album', a.slug)));
      const done = allPcts.filter(p => p >= 100).length;
      const tag = opts.href ? 'a' : 'div';
      const href = opts.href ? ` href="${esc(opts.href)}"` : '';
      return `<${tag} class="aprogmini${w >= 100 ? ' done' : ''}"${href}
        title="How far along ${esc(a.name)} is — open the player to fill it in">
        <span class="lbl">${esc(a.name)}</span>
        <span class="sub2">${done} of ${a.songs.length} song${a.songs.length === 1 ? '' : 's'} finished</span>
        <span class="track"><span class="fill" style="width:${w}%"></span></span>
        <span class="pct">${w}%</span>
      </${tag}>`;
    }).join('');
  }

  /* ------------------------------------------------------------------------
   * THE INTERACTIVE CHECKLIST (CR-103), moved here from music.html.
   *
   * Everything above this line is the OTHER half: read-only, fetches its own
   * data, never writes. This half ticks boxes, persists them, and used to be
   * a page's worth of code wired directly to music.html's own globals — the
   * per-song and per-record bars in the library, the record panel above the
   * list, and the song's own profile page all shared one copy of it because
   * only one page needed it. Release Builder is now a second page that does,
   * and pasting the ~500 lines a second time would mean the next change to a
   * checkbox has two places to land instead of one.
   *
   * WHY IT TAKES A HOST ADAPTER RATHER THAN OWNING EVERYTHING. Two things
   * genuinely differ per page and cannot move here: which songs count toward
   * a given album's average (music.html's library view versus Release
   * Builder's whole-library read), and what else has to repaint once a tick
   * lands (song rows and the library's album bars on one page, a release's
   * header percentage and song list on the other). Everything else — the
   * ticks themselves, his own added/removed steps, the assignee/notes/due
   * inspector — is identical on both pages and lives here, owned once.
   *
   * `initChecklist` registers the adapter. `loadChecklistData` is called
   * once per page load (or refresh) with the same two RPC results music.html
   * has always fetched (`progress_all`, `progress_shape`); the module keeps
   * its own copy from there, the same way `progMeta`/`progShape`/`progress`
   * used to live as music.html module-level state. Callers keep their own
   * `songPctOf`/`albumPctOf` — those read `ticksFor`/`shapeOf`, exported
   * below, exactly as they always have; only the checklist's own render and
   * write path moved.
   */
  let CK = null;
  let ckProgress = Object.create(null);
  let ckMeta = Object.create(null);
  let ckShape = { items: [], hidden: [] };

  const ckProgKey = (scope, ref) => scope + '/' + ref;
  const ckMetaKey = (scope, ref, key) => scope + '/' + ref + '/' + key;
  function ticksFor(scope, ref){
    const k = ckProgKey(scope, ref);
    return ckProgress[k] || (ckProgress[k] = new Set());
  }
  const shapeOf = (scope, ref) => global.PROGRESS.shapeFor(ckShape, scope, ref);

  /* The host's other half: what only it knows. See the header above for why
   * each of these cannot be worked out in here.
   *   getSong(ref)               — the song object for a song-scope ref
   *   getAutoFeedSongs(ref)      — songs whose mean feeds an album's auto phase
   *   songPctOf(song), excludedFromAlbumPct(song), todosOf(song) — the host's
   *     own versions of the same functions music.html has always had
   *   onChange(except)          — repaint whatever else the host owns after a
   *     tick; `except` is the .pacc that changed, or null/undefined for "reload" */
  function initChecklist(adapter){ CK = adapter; }

  /* Replaces music.html's loadProgress() body: same two RPC shapes, same
   * "only a DONE row ticks" rule the mini-bar above was just given too. */
  function loadChecklistData(rows, shape){
    ckProgress = Object.create(null);
    ckMeta = Object.create(null);
    ckShape = shape || { items: [], hidden: [] };
    for (const r of (rows || [])) {
      if (r.done) ticksFor(r.scope, r.ref).add(r.key);
      if (r.assignee || r.notes || r.due_on)
        ckMeta[ckMetaKey(r.scope, r.ref, r.key)] =
          { assignee: r.assignee || '', notes: r.notes || '', due_on: r.due_on || '' };
    }
  }

  function barHtml(pct, cls){
    const w = Math.round(pct);
    return `<span class="pbar ${cls || ''}${w >= 100 ? ' done' : ''}${w === 0 ? ' zero' : ''}" title="Production progress — click for the checklist">
        <span class="track"><span class="fill" style="width:${w}%"></span></span>
        <span class="pct">${w}%</span>
      </span>`;
  }

  // The checklist itself. `auto` phases have no boxes — the album's 50% song
  // average is the mean of the songs and there is nothing on it a person could
  // tick — so they render as a sentence saying what the number came from.
  //
  // The formula, stated once here and nowhere else:
  //   album %  =  (album's own ticked weights, out of 50)
  //             +  50 x (mean of every song's own %) / 100
  // A song's own % is the sum of its ticked stage weights, so a song part-way
  // through the pipeline contributes part-way. That is what makes this work for
  // any mix of stages: three finished, one being mastered and two still being
  // written all fall out of the same average without a special case.
  function autoPhaseHtml(ref, ph){
    const inAlbum = CK.getAutoFeedSongs(ref) || [];
    // CR-81: an excluded song is left out of the mean this phase explains, same
    // as albumPctOf — this is the one place that shows the arithmetic behind
    // the number, so it has to agree with it. Still listed below, tagged, so an
    // excluded song doesn't just silently vanish from its own record's page.
    const counted = inAlbum.filter(s => !CK.excludedFromAlbumPct(s));
    const pcts = counted.map(CK.songPctOf);
    const mean = pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : 0;
    const done = pcts.filter(p => p >= 100).length;
    const pts = mean / 100 * ph.weight;
    return `<div class="pphase pphase-auto">
      <div class="pphase-h">${esc(ph.name)} <span class="w">${ph.weight}%</span></div>
      <div class="pauto">Worked out from the songs, never ticked. The average of every
        counted song on the record, including ones nobody has started, is <b>${mean.toFixed(1)}%</b>
        &mdash; ${done} of ${pcts.length} finished &mdash; which is
        <b>${pts.toFixed(1)}</b> of the ${ph.weight} points here.</div>
      <div class="pbreak">
        ${inAlbum.map((sg, n) => {
          const excl = CK.excludedFromAlbumPct(sg);
          const w = CK.songPctOf(sg);
          return `<div class="pbrow ${w >= 100 ? 'full' : ''} ${excl ? 'excluded' : ''}">
            <span class="n">${n + 1}</span>
            <span class="t">${esc(sg.title)}${excl ? ' <i>(excluded from %)</i>' : ''}</span>
            <span class="b"><span style="width:${Math.round(w)}%"></span></span>
            <span class="p">${Math.round(w)}%</span>
          </div>`;
        }).join('')}
      </div>
      <div class="pnote">Pick any of them in the dropdown above to fill it in, and this moves.</div>
    </div>`;
  }

  // CR-86, "the hidden variable" made visible. The bar already moves by this on
  // every note and every custom item (progress.js's todoSwing); this just says
  // so out loud, the same way autoPhaseHtml spells out the album mean instead of
  // leaving him to trust a single percentage. Song scope only, since a to-do
  // modal and its notes are a song's, not a record's; an album's own swing is
  // only ever its own custom checklist items, already visible as -1/+4 badges
  // on those rows.
  function todoSwingHtml(scope, ref, ticks, shaped){
    if (scope !== 'song') return '';
    const song = CK.getSong(ref);
    const todos = song ? CK.todosOf(song) : { open: 0, done: 0 };
    let itemOpen = 0, itemDone = 0;
    for (const ph of shaped) for (const t of ph.tasks)
      if (t.custom) (ticks.has(t.key) ? itemDone++ : itemOpen++);
    const open = todos.open + itemOpen, done = todos.done + itemDone;
    if (!open && !done) return '';
    const swing = global.PROGRESS.todoSwing(shaped, ticks, todos);
    return `<div class="pswing" title="Every open or resolved note, plus your own checklist items">
      <b>To-do swing:</b> ${open} open (${global.PROGRESS.TODO_OPEN * open}%), ${done} resolved
      (+${global.PROGRESS.TODO_DONE * done}%) &mdash; net ${swing >= 0 ? '+' : ''}${swing}%,
      already folded into the total above.
    </div>`;
  }

  function accHtml(list, scope, ref){
    const ticks = ticksFor(scope, ref);
    const shape = shapeOf(scope, ref);
    const shaped = global.PROGRESS.shapedList(list, shape);
    return todoSwingHtml(scope, ref, ticks, shaped) + shaped.map(ph => {
      if (ph.auto) return autoPhaseHtml(ref, ph);
      const full = ph.tasks.length && ph.tasks.every(t => ticks.has(t.key));
      return `<div class="pphase">
        <div class="pphase-h clickable" data-phase="${esc(ph.key)}"
             title="${full ? 'Clear every box in ' + esc(ph.name) : 'Tick every box in ' + esc(ph.name)}">
          ${esc(ph.name)} <span class="w">${Math.round(ph.weight)}%</span>
          <span class="phall">${full ? 'clear' : 'tick all'}</span>
        </div>
        ${ph.tasks.map(t => {
          const on = ticks.has(t.key);
          const id = `pt-${esc(scope)}-${esc(ref)}-${esc(t.key)}`;
          const meta = ckMeta[ckMetaKey(scope, ref, t.key)];
          return `<div class="ptask ${on ? 'on' : ''} ${t.custom ? 'mine' : ''}" data-key="${esc(t.key)}">
            <input type="checkbox" id="${id}" ${on ? 'checked' : ''} />
            <label for="${id}">${esc(t.name)}</label>
            ${meta && meta.assignee ? `<span class="pwho" title="Assigned to ${esc(meta.assignee)}">${esc(initials(meta.assignee))}</span>` : ''}
            <!-- His own to-do items do not carry a share of the 100; they swing
                 the bar instead, so the badge says what they actually do. -->
            <span class="w">${t.custom ? '&minus;2 / +4%' : t.weight.toFixed(t.weight < 10 ? 1 : 0) + '%'}</span>
            <span class="pinsp" title="Assignee, notes, due date" data-inspect="${esc(t.key)}">&#9998;</span>
            <span class="pdrop" title="${t.custom ? 'Delete this item' : 'Remove this step from this one only'}"
                  data-drop="${esc(t.key)}" data-mine="${t.custom ? esc(t.id) : ''}">&times;</span>
          </div>`;
        }).join('')}
        <div class="padd" data-addphase="${esc(ph.key)}">
          <span class="lnk">+ add a step to ${esc(ph.name)}</span>
        </div>
      </div>`;
    }).join('')
    + hiddenHtml(list, scope, ref)
    + `<div class="pnote editonly">Click a category heading to fill it in or empty it. Removing a
         step shares its weight out inside its own category, so this still adds up to 100.</div>`
    + peditHtml();
  }

  // First letters of up to two words, for the assignee badge. "Sam" -> S,
  // "Sam Lee" -> SL. Never more than two, so a full name typed by accident does
  // not stretch the row.
  const initials = (name) => String(name || '').trim().split(/\s+/).slice(0, 2)
    .map(w => w[0]).join('').toUpperCase();

  // The link at the foot of a checklist that turns it into an editor of itself,
  // named in his own words. Both labels are always in the markup and CSS shows one
  // of them, because the panel is repainted on every tick and a label rendered
  // from a mode variable would need that variable carried through every repaint
  // path — the class on the container survives innerHTML replacement, so it is the
  // one place the mode can live without being reset by an unrelated click.
  function peditHtml(){
    return `<div class="pedit">
      <span class="lnk" data-editcrit="1">
        <span class="e-off">Edit progress criteria</span>
        <span class="e-on">Done editing</span>
      </span>
    </div>`;
  }

  // What he has taken off THIS song or record, so removing something is visibly
  // reversible rather than a one-way door. Absent entirely when nothing is hidden.
  function hiddenHtml(list, scope, ref){
    const hid = shapeOf(scope, ref).hidden;
    if (!hid.size) return '';
    const names = [];
    for (const ph of list) for (const t of (ph.tasks || []))
      if (hid.has(t.key)) names.push(t);
    if (!names.length) return '';
    return `<div class="phidden">
      <span class="hl">Not counted here:</span>
      ${names.map(t => `<span class="hchip" data-restore="${esc(t.key)}"
          title="Put this step back">${esc(t.name)} <b>+</b></span>`).join('')}
    </div>`;
  }

  // The bulk row that sits above a checklist. Separate from accHtml's output only
  // in that it is prepended, so that the "everything" controls read as being about
  // the list rather than as another line inside it.
  function bulkHtml(list, scope, ref){
    const ticks = ticksFor(scope, ref);
    const all = global.PROGRESS.shapedList(list, shapeOf(scope, ref))
      .filter(ph => !ph.auto).flatMap(ph => ph.tasks);
    const on = all.filter(t => ticks.has(t.key)).length;
    return `<div class="pbulk">
      <span class="bcount">${on} of ${all.length} ticked</span>
      <span class="lnk" data-bulk="all">Tick everything</span>
      <span class="lnk" data-bulk="none">Clear everything</span>
    </div>`;
  }

  // Wire one accordion. Delegated on the container, so re-rendering its innards
  // never leaves a listener behind on an element that has gone.
  // Tick or clear a set of keys in one go, from a category heading or from the
  // "everything" controls. One round trip either way.
  async function bulkSet(el, keys, on){
    if (!keys.length) return;
    const scope = el.dataset.scope, ref = el.dataset.ref;
    const ticks = ticksFor(scope, ref);
    const before = new Set(ticks);
    keys.forEach(k => on ? ticks.add(k) : ticks.delete(k));
    paintAcc(el);
    ckRefresh(null);
    try {
      await libRpc(on ? 'progress_set_many' : 'progress_clear_many',
        on ? { scope_in: scope, ref_in: ref, keys, ver_in: global.PROGRESS.VERSION }
           : { scope_in: scope, ref_in: ref, keys });
    } catch (err){
      // Put back exactly what was there, rather than inverting what we just did:
      // some of these keys may already have been ticked before the click, and
      // undoing by inversion would clear those too.
      ckProgress[ckProgKey(scope, ref)] = before;
      paintAcc(el);
      ckRefresh(null);
      alert('Could not save that: ' + (err.message || err));
    }
  }

  function wireAcc(el){
    el.addEventListener('click', (e) => {
      e.stopPropagation();                                    // never plays the song
      const scope = el.dataset.scope, ref = el.dataset.ref;
      const list = global.PROGRESS.shapedList(scope === 'album' ? global.PROGRESS.ALBUM : global.PROGRESS.SONG,
                                       shapeOf(scope, ref));
      const ticks = ticksFor(scope, ref);

      const bulk = e.target.closest('[data-bulk]');
      if (bulk){
        const all = list.filter(ph => !ph.auto).flatMap(ph => ph.tasks).map(t => t.key);
        const want = bulk.dataset.bulk === 'all';
        return bulkSet(el, all.filter(k => ticks.has(k) !== want), want);
      }

      const insp = e.target.closest('[data-inspect]');
      if (insp){
        const task = list.flatMap(ph => ph.tasks).find(t => t.key === insp.dataset.inspect);
        if (task) openInspector(scope, ref, task);
        return;
      }

      // --- his own items: add, remove, put back -----------------------------
      const drop = e.target.closest('[data-drop]');
      if (drop){
        const key = drop.dataset.drop, mine = drop.dataset.mine;
        if (mine){
          if (!confirm('Delete this step? It only exists here, so this cannot be undone.')) return;
          ckShape.items = ckShape.items.filter(i => i.id !== mine);
          ticksFor(el.dataset.scope, el.dataset.ref).delete(key);
          paintAcc(el); ckRefresh(null);
          libRpc('progress_item_del', { id_in: mine }).catch(err => {
            alert('Could not delete that: ' + (err.message || err));
          });
        } else {
          if (!confirm('Remove this step from this one? You can put it back from the chip below.')) return;
          ckShape.hidden = ckShape.hidden.concat(
            [{ scope: el.dataset.scope, ref: el.dataset.ref, key }]);
          ticksFor(el.dataset.scope, el.dataset.ref).delete(key);
          paintAcc(el); ckRefresh(null);
          libRpc('progress_hide', { scope_in: el.dataset.scope, ref_in: el.dataset.ref,
                                    key_in: key, hide: true })
            .catch(err => { alert('Could not remove that: ' + (err.message || err)); });
        }
        return;
      }

      const back = e.target.closest('[data-restore]');
      if (back){
        const key = back.dataset.restore;
        ckShape.hidden = ckShape.hidden.filter(h =>
          !(h.scope === el.dataset.scope && h.ref === el.dataset.ref && h.key === key));
        paintAcc(el); ckRefresh(null);
        libRpc('progress_hide', { scope_in: el.dataset.scope, ref_in: el.dataset.ref,
                                  key_in: key, hide: false })
          .catch(err => { alert('Could not put that back: ' + (err.message || err)); });
        return;
      }

      // Editing mode is a class on the panel and nothing else — nothing is saved,
      // because which mode a panel is in is not a fact about the record.
      if (e.target.closest('[data-editcrit]')){
        el.classList.toggle('editing');
        return;
      }

      const add = e.target.closest('[data-addphase]');
      if (add){
        const phase = add.dataset.addphase;
        const label = (prompt('What is the step called? It will only exist on this one.') || '').trim();
        if (!label) return;
        const scope = el.dataset.scope, ref = el.dataset.ref;
        libRpc('progress_item_add', { scope_in: scope, ref_in: ref,
                                      phase_in: phase, label_in: label, weight_in: 0 })
          .then(id => {
            ckShape.items = ckShape.items.concat(
              [{ id, scope, ref, phase, label, weight: 0, sort: 999 }]);
            paintAcc(el); ckRefresh(null);
          })
          .catch(err => alert('Could not add that: ' + (err.message || err)));
        return;
      }

      const head = e.target.closest('.pphase-h[data-phase]');
      if (head){
        const ph = list.find(x => x.key === head.dataset.phase);
        if (!ph || !ph.tasks.length) return;
        const full = ph.tasks.every(t => ticks.has(t.key));
        return bulkSet(el, ph.tasks.filter(t => ticks.has(t.key) === full).map(t => t.key), !full);
      }
    });
    el.addEventListener('change', async (e) => {
      const box = e.target.closest('input[type=checkbox]');
      if (!box) return;
      // Read the target off the element, not out of a closure. The record's panel
      // can be pointed at any track on it, and a closure captured at wiring time
      // would happily go on writing ticks to the record while the dropdown said
      // otherwise — the worst kind of bug, because the screen would look right.
      const scope = el.dataset.scope, ref = el.dataset.ref;
      const row = box.closest('.ptask');
      const key = row.dataset.key;
      const on  = box.checked;
      const ticks = ticksFor(scope, ref);
      on ? ticks.add(key) : ticks.delete(key);
      row.classList.toggle('on', on);
      ckRefresh(el);
      try {
        await libRpc('progress_set', { scope_in: scope, ref_in: ref, key_in: key,
                                       done_in: on, ver_in: global.PROGRESS.VERSION });
      } catch (err){
        on ? ticks.delete(key) : ticks.add(key);
        box.checked = !on; row.classList.toggle('on', !on);
        ckRefresh(el);
        alert('Could not save that tick: ' + (err.message || err));
        return;
      }
      if (!on) return;
      // "mark all prior steps... completed?" Cascade across every phase before
      // this task, not just its own category. Only offered on a tick, never an
      // untick, and only when something earlier is genuinely still open.
      const shaped = global.PROGRESS.shapedList(scope === 'album' ? global.PROGRESS.ALBUM : global.PROGRESS.SONG,
                                         shapeOf(scope, ref));
      const flat = shaped.filter(p => !p.auto).flatMap(p => p.tasks);
      const idx = flat.findIndex(t => t.key === key);
      const prior = idx > 0 ? flat.slice(0, idx).filter(t => !ticks.has(t.key)) : [];
      if (prior.length && confirm('Mark all prior steps in this '
          + (scope === 'album' ? 'record' : 'song') + ' as completed?')){
        const keys = prior.map(t => t.key);
        keys.forEach(k => ticks.add(k));
        paintAcc(el);
        ckRefresh(el);
        try {
          await libRpc('progress_set_many', { scope_in: scope, ref_in: ref, keys, ver_in: global.PROGRESS.VERSION });
        } catch (err){
          keys.forEach(k => ticks.delete(k));
          paintAcc(el);
          ckRefresh(el);
          alert('Could not backfill those: ' + (err.message || err));
        }
      }
    });
  }

  // Draw an accordion from whatever it is currently pointed at.
  function paintAcc(acc){
    const scope = acc.dataset.scope, ref = acc.dataset.ref;
    if (!scope || !ref) return;
    const list = scope === 'album' ? global.PROGRESS.ALBUM : global.PROGRESS.SONG;
    acc.innerHTML = bulkHtml(list, scope, ref) + accHtml(list, scope, ref);
  }

  /* The shareable half of what music.html's refreshProgressNumbers used to do
   * whole: repaint every OTHER open checklist (so a tick on one page-chrome
   * bar's accordion doesn't leave a second open copy of the same record
   * stale), then patch the one under the pointer's auto-phase in place if it
   * is an album (the only part of `except` that can have gone stale without a
   * checkbox changing — a tick on one of its songs). The host's own chrome —
   * song rows, its own header percentages — is not this module's to know
   * about, which is what `onChange` is for. */
  function refreshChecklists(except){
    document.querySelectorAll('.pacc').forEach(acc => {
      if (acc.hidden || acc === except) return;
      paintAcc(acc);
    });
    if (except && !except.hidden && except.dataset.scope === 'album'){
      const auto = global.PROGRESS.ALBUM.find(ph => ph.auto);
      const phase = except.querySelector('.pphase-auto');
      if (auto && phase) phase.outerHTML = autoPhaseHtml(except.dataset.ref, auto);
    }
  }

  /* Called from every place inside this module that used to call music.html's
   * page-level refreshProgressNumbers(). Does the shareable repaint above,
   * then hands off to whatever the host itself needs to repatch — which is
   * exactly what the host's OWN refreshProgressNumbers is, registered once
   * via initChecklist so this module never has to know its name. */
  function ckRefresh(except){
    refreshChecklists(except);
    if (CK && CK.onChange) CK.onChange(except);
  }

  /* Progress inspector: assignee, notes, due date on one task. Reuses whatever
   * plain modal shell the host page has under these same ids — both music.html
   * and release-builder.html carry an identical #progModal block for exactly
   * this reason. */
  let progInspTarget = null;
  function openInspector(scope, ref, task){
    progInspTarget = { scope, ref, key: task.key };
    const meta = ckMeta[ckMetaKey(scope, ref, task.key)] || {};
    $('progInspTitle').textContent = task.name;
    $('progInspWho').value = meta.assignee || '';
    $('progInspDue').value = meta.due_on || '';
    $('progInspNotes').value = meta.notes || '';
    $('progInspStatus').textContent = '';
    $('progInspStatus').className = 'status';
    $('progModal').classList.add('open');
  }
  function closeInspector(){ $('progModal').classList.remove('open'); progInspTarget = null; }

  /* Wired once, lazily, the first time a host page's DOM has the modal in it —
   * calling this before the modal exists would throw, and unlike the rest of
   * this module the modal's own buttons are not re-created per repaint, so
   * wiring them more than once would double-fire a save. */
  let inspectorWired = false;
  function wireInspectorOnce(){
    if (inspectorWired) return;
    inspectorWired = true;
    $('progInspClose').onclick = closeInspector;
    $('progModal').addEventListener('click', (e) => { if (e.target === $('progModal')) closeInspector(); });
    $('progInspSave').onclick = async () => {
      if (!progInspTarget) return;
      const { scope, ref, key } = progInspTarget;
      const assignee = $('progInspWho').value.trim();
      const notes = $('progInspNotes').value.trim();
      const due = $('progInspDue').value || null;
      $('progInspStatus').textContent = 'Saving…';
      try {
        await libRpc('progress_set_meta', { scope_in: scope, ref_in: ref, key_in: key,
          assignee_in: assignee, notes_in: notes, due_in: due, ver_in: global.PROGRESS.VERSION });
        const k = ckMetaKey(scope, ref, key);
        if (assignee || notes || due) ckMeta[k] = { assignee, notes, due_on: due || '' };
        else delete ckMeta[k];
        // Rows carrying meta but no tick are invisible to a bare accordion repaint
        // unless it is told to run — same reason a tick calls paintAcc rather than
        // trusting the DOM already matches.
        document.querySelectorAll(`.pacc[data-scope="${scope}"][data-ref="${CSS.escape(ref)}"]`)
          .forEach(paintAcc);
        closeInspector();
      } catch (err){
        $('progInspStatus').textContent = 'Could not save that: ' + (err.message || err);
      }
    };
  }

  global.PROGRESS_UI = {
    mount,
    initChecklist, loadChecklistData,
    ticksFor, shapeOf,
    barHtml, wireAcc, paintAcc, refreshChecklists,
    openInspector, closeInspector, wireInspectorOnce,
  };
})(window);
