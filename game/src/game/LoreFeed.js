// The lore, live from the band's active draft.
//
// The story is written in the Band assets page and one draft is marked active.
// This fetches that draft and parses the fish/diver exchanges out of it, so
// editing the document changes what the fish say — no rebuild, no redeploy, no
// second copy of the story to keep in step. Promote a new draft and the next
// conversation in the game is the new one.
//
// Three rules it follows, and each one exists because the alternative is worse:
//
//  1. FALL BACK, ALWAYS. No network, no draft promoted, a document with no
//     exchanges in it — any of those and the game uses the LORE table compiled
//     into Clues.js. The fish must never run out of things to say because a
//     database was slow.
//  2. RE-CHECK ON NARRATIVE ACTIONS, not on a timer. The game asks for a
//     refresh each time a fish is about to speak; the fetch only actually goes
//     out if the last one was more than `ttl` ago. So a doc edited mid-session
//     lands within a minute, and standing still costs nothing.
//  3. NEVER BLOCK. The refresh is fire-and-forget. Whoever asked for it gets
//     whatever is in hand right now, and the new text arrives for the line
//     after. A fish that pauses mid-sentence waiting on an HTTP round trip is
//     worse than a fish that is one line out of date.
//
// The parse is deliberately loose. Prose stays prose; only lines that announce
// themselves as a question or an answer are picked up, in pairs, in order:
//
//   Q: / A:        Ask: / Say:        Fish: / Diver:
//
// A document that is pure prose parses to nothing, which means it changes
// nothing — writing the story badly for the parser cannot break the game.

const ASK = /^\s*(?:[-*>#\s]*)(?:q|ask|fish|them)\s*[:—-]\s*(.+)$/i;
const SAY = /^\s*(?:[-*>#\s]*)(?:a|say|diver|him|reply)\s*[:—-]\s*(.+)$/i;

export class LoreFeed {
  /**
   * @param {string} band
   * @param {string} supaUrl
   * @param {string} supaKey publishable — lore_active() is public by design
   * @param {{ttl?:number}} [opt]
   */
  constructor(band, supaUrl, supaKey, opt = {}) {
    this.band = band;
    this.url = supaUrl;
    this.key = supaKey;
    this.ttl = opt.ttl ?? 60;      // seconds between fetches, at most

    /** @type {{ask:string,say:string}[]|null} null until a draft says otherwise */
    this.exchanges = null;
    this.draftName = null;
    this.updated = null;
    this.source = 'built-in';
    this._at = -Infinity;
    this._busy = false;
  }

  /**
   * Ask for fresh lore. Cheap to call on every narrative beat — it returns
   * immediately and only goes to the network when the TTL has run out.
   */
  touch(now = performance.now() / 1000) {
    if (this._busy || now - this._at < this.ttl) return;
    this._at = now;
    this._busy = true;
    this._fetch().finally(() => { this._busy = false; });
  }

  /** Same, but you can await it — used once at startup. */
  async refresh() {
    this._at = performance.now() / 1000;
    try { await this._fetch(); } catch { /* the built-in lore stands */ }
  }

  async _fetch() {
    const r = await fetch(`${this.url}/rest/v1/rpc/lore_active`, {
      method: 'POST',
      headers: {
        apikey: this.key,
        Authorization: `Bearer ${this.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ b: this.band }),
    });
    if (!r.ok) return;                      // 404 = v19 not applied yet
    const doc = await r.json();
    if (!doc || !doc.body) return;          // no draft promoted

    const found = parseExchanges(doc.body);
    this.draftName = doc.name || null;
    this.updated = doc.updated || null;
    if (found.length) {
      this.exchanges = found;
      this.source = 'live';
    }
  }

  /**
   * What the fish should be working from. Hands back the live list when there
   * is one and the game's own table when there isn't, so callers never have to
   * ask which of those happened.
   */
  lines(fallback) {
    return this.exchanges && this.exchanges.length ? this.exchanges : fallback;
  }
}

/**
 * Pull ask/say pairs out of a document.
 *
 * An ask with no answer under it is dropped rather than shown alone — half an
 * exchange reads as a bug, and the whole point of the format is that the fish
 * asks and the diver answers. Answers can run over several lines; the next
 * marker ends them.
 */
export function parseExchanges(text) {
  const out = [];
  let ask = null, say = null;

  const flush = () => {
    if (ask && say) out.push({ ask: tidy(ask), say: tidy(say) });
    ask = null; say = null;
  };

  for (const raw of String(text).split(/\r?\n/)) {
    const a = raw.match(ASK);
    if (a) { flush(); ask = a[1]; continue; }
    const s = raw.match(SAY);
    // A second answer under the same question adds a line rather than replacing
    // one — writing an answer as two A: lines is a reasonable thing to do, and
    // silently throwing the first one away is not a reasonable thing to answer
    // it with.
    if (s) { if (ask) say = say == null ? s[1] : say + '  ' + s[1]; continue; }
    // A blank line closes whatever was open; anything else continues it.
    if (!raw.trim()) { flush(); continue; }
    if (say != null) say += ' ' + raw.trim();
    else if (ask != null) ask += ' ' + raw.trim();
  }
  flush();
  return out;
}

/**
 * The HUD renders these as HTML, so a document written by a person has to be
 * made safe before it goes in. Tags out, then the one piece of markup the game
 * actually wants back: a line break where the writer left a double space or a
 * pipe, because these lines are read in two beats.
 */
function tidy(s) {
  return s
    .replace(/[<>]/g, '')
    .replace(/\s*\|\s*/g, '<br>')
    .replace(/\s{2,}/g, '<br>')
    .trim();
}
