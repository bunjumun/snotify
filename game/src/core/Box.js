// Is this copy of the game being served by a Lakehorse Radio box?
//
// The box has no internet to speak of and no Supabase: its page, lore and songs
// are all local, so every network call to the band's database is skipped and the
// soundtrack comes from the box's SD card (/api/sd, /sd/<name>).
//
// The marker is set by the box build (tools/bundle_game.py injects
// `window.LAKEHORSE_BOX = true` into index.html). It is NOT inferred from the
// URL path: the hosted site also serves this game under /game/, and guessing
// would switch the live site's database off. `?box=1` forces it for local testing.
export const ON_BOX =
  (typeof window !== 'undefined')
  && (window.LAKEHORSE_BOX === true || new URLSearchParams(window.location.search).has('box'));

/** `Cool Song.wav` -> `Cool Song`. Pure, so it is tested without a browser. */
export function titleFromFile(name) {
  return String(name).replace(/\.[A-Za-z0-9]{2,5}$/, '').replace(/[_]+/g, ' ').trim() || 'Lakehorse';
}

/** The box's songs as the director's `{ title, src }` rows, from /api/sd's list. */
export function tracksFromSdList(list) {
  return (Array.isArray(list) ? list : [])
    .filter((f) => f && typeof f.name === 'string' && f.name)
    .map((f) => ({
      title: titleFromFile(f.name),
      version: '',
      src: `/sd/${encodeURIComponent(f.name)}`,
    }));
}
