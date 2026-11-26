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

/** Alignment level id for the Swimulator (Guber Eats takes 0..9). The box counts levels 0..31. */
export const SWIM_LEVEL_ID = 16;

/** The box's alignment endpoint for a level event. `demo` asks for a tenth of the credit and never ticks the level. Pure. */
export function levelEventUrl(id, result, demo) {
  return `/api/alignment/event?source=level&id=${id}&result=${result}${demo ? '&demo=1' : ''}`;
}

/** Tell the box a level was cleared or attempted. Fire and forget: a failed report must never touch the game. Off the box it does nothing. */
export function reportLevel(id, result, demo) {
  if (!ON_BOX) return;
  try {
    const url = levelEventUrl(id, result, demo);
    if (navigator.sendBeacon && result === 'attempt') { if (navigator.sendBeacon(url)) return; }
    fetch(url, { method: 'POST', keepalive: true }).catch(() => {});
  } catch { /* nothing to do */ }
}

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
