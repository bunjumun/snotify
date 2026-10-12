// The ship's log, live from the band's active draft.
//
// Same deal as LoreFeed and for the same reason: the log is writing, writing
// gets rewritten, and a copy of it frozen inside a JS file is a copy that goes
// quietly out of date. It's edited in Band assets, one draft is marked live, and
// the game reads that draft when it starts.
//
// The format is a heading and the prose under it, which is what a log looks like
// anyway:
//
//   # Log of the Enias — day 1
//   Cleared the yards 0610 with eleven hundred tonnes of ore and forty-one
//   souls. The manifest lists both in the same column.
//
//   # day 9
//   They have started calling it a run instead of a haul.
//
// Any of `#`, `##`, `--`, or `[...]` marks a heading. Entries come out in the
// order they're written, and the game takes as many as it scatters pages for.
//
// Ids are positional (`p1`, `p2`, …) so a player's collected-pages list survives
// an edit to the text. Rewriting page three's words leaves it page three; adding
// a new entry in the middle does shuffle what a saved id points at, which is the
// honest cost of not asking a band to hand-maintain identifiers.

const HEADING = /^\s*(?:#{1,3}\s*|-{2,}\s*|\[)\s*(.+?)\s*(?:\]|-{2,})?\s*$/;

export class LogFeed {
  /**
   * @param {string} band
   * @param {string} supaUrl
   * @param {string} supaKey publishable — lore_active() is public by design
   */
  constructor(band, supaUrl, supaKey) {
    this.band = band;
    this.url = supaUrl;
    this.key = supaKey;

    /** @type {{id:string,title:string,body:string}[]|null} */
    this.entries = null;
    this.draftName = null;
    this.source = 'built-in';
  }

  /**
   * Fetched once, at startup, before the pages are placed — unlike the lore,
   * which can change mid-session because it's spoken. A log page is a physical
   * object lying in the silt; swapping its text out from under someone who is
   * swimming toward it would be worse than being a minute out of date.
   */
  async refresh() {
    try {
      const r = await fetch(`${this.url}/rest/v1/rpc/lore_active`, {
        method: 'POST',
        headers: {
          apikey: this.key,
          Authorization: `Bearer ${this.key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ b: this.band, d: 'log' }),
      });
      // Every early return here falls back to the built-in log, same as the
      // catch below — that fallback is correct and by design (see header).
      // What was NOT fine: falling back silently. A band member seeing the
      // built-in placeholder instead of their own draft had no way to tell
      // "nothing's promoted yet" from "the fetch is broken in your browser"
      // apart from diffing prose against a screenshot of the SQL, which is
      // how CR-93 actually got diagnosed. One line each turns that into a
      // console check.
      if (!r.ok) {
        console.warn(`[LogFeed] lore_active HTTP ${r.status}; showing the built-in log.`);
        return null;
      }
      const doc = await r.json();
      if (!doc || !doc.body) {
        console.warn('[LogFeed] no active "log" draft for this band; showing the built-in log.');
        return null;
      }
      const found = parseEntries(doc.body);
      if (!found.length) {
        console.warn('[LogFeed] active draft has no headings the parser recognises; showing the built-in log.');
        return null;
      }
      this.entries = found;
      this.draftName = doc.name || null;
      this.source = 'live';
      return found;
    } catch (err) {
      console.warn('[LogFeed] fetch failed; showing the built-in log.', err);
      return null;
    }
  }

  /** The live log if there is one, the game's own if there isn't. */
  pages(fallback) {
    return this.entries && this.entries.length ? this.entries : fallback;
  }
}

/**
 * Split a document into log entries.
 *
 * Prose before the first heading is dropped rather than shown as a nameless
 * page — that space is where people put titles and notes to themselves, and a
 * slate in the silt reading "LOG — draft 3" is not the artefact anyone wanted.
 */
export function parseEntries(text) {
  const out = [];
  let cur = null;

  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trimEnd();
    const h = line.match(HEADING);
    // A heading is a SHORT marked line. Long ones are prose that happens to
    // start with a dash, which is a thing people write.
    if (h && h[1] && h[1].length <= 80 && /^[#\-[]/.test(line.trim())) {
      if (cur) out.push(cur);
      cur = { id: `p${out.length + 1}`, title: h[1], body: '' };
      continue;
    }
    if (!cur) continue;
    cur.body += (cur.body ? '\n' : '') + line;
  }
  if (cur) out.push(cur);

  return out
    .map((e) => ({ ...e, body: e.body.trim() }))
    .filter((e) => e.title && e.body);
}
