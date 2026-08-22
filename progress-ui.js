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

    // scope+ref → Set of ticked task keys, the same shape the player keeps.
    const ticks = Object.create(null);
    const setFor = (scope, ref) => {
      const k = scope + '/' + ref;
      return ticks[k] || (ticks[k] = new Set());
    };
    for (const r of (rows || [])) setFor(r.scope, r.ref).add(r.key);

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
      const pcts = a.songs.map(s =>
        P.songPct(setFor('song', s.folder), P.shapeFor(shape, 'song', s.folder), todosFor(s)));
      const w = Math.round(
        P.albumPct(setFor('album', a.slug), pcts, P.shapeFor(shape, 'album', a.slug)));
      const done = pcts.filter(p => p >= 100).length;
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

  global.PROGRESS_UI = { mount };
})(window);
