// Reading the log.
//
// Opened from the pause screen, because that's where you go when you want to
// stop and read rather than swim. Shows only the slates actually recovered, and
// the gaps are left visible — a log with pages missing is a better story than a
// log with a progress bar, and the blanks are what make you go back out.
//
// **It reads the slates, not a module-level array, and that distinction is the
// whole of CR-93.** This file used to `import { ENTRIES }` straight from
// LogPages.js and render from it. ENTRIES is the copy compiled into the game as
// an offline fallback; the band's live draft arrives later, over the wire, and
// LogFeed hands it to `LogPages.setEntries()`. So the slates lying in the silt
// carried the live words while the screen you actually READ them on rendered
// the fallback, permanently, for everyone — and it looked exactly like a broken
// fetch from the outside, which is where a day went. The fetch was never
// broken. Take the text from `game.logs.pages`, which is the one list that is
// both live and real: those are the slates that exist in the world, in story
// order (LogPages builds them in order and setEntries preserves it), so a draft
// with more entries than there are pages cannot show a page you can never find.

export class Logbook {
  /** @param {import('../core/Game.js').Game} game */
  constructor(game) {
    this.game = game;
    this.el = document.getElementById('logbook');
    this.list = document.getElementById('logList');
    document.getElementById('logClose').onclick = () => this.hide();
    document.getElementById('btnLog').onclick = () => this.show();
  }

  /**
   * The entries there are slates for, live text and all. Read at call time
   * rather than cached in the constructor, because the draft lands a moment
   * after the game is built and a snapshot taken then would be the fallback.
   */
  _entries() {
    return this.game.logs.pages.map((p) => p.entry);
  }

  show() {
    const have = new Set(this.game.progress.data.logPages);
    this.list.innerHTML = '';

    if (!have.size) {
      this.list.innerHTML = '<p class="logempty">Nothing recovered yet. The slates are out '
        + 'there. They are small and dark, and they catch the lamp when you sweep past one.</p>';
    } else {
      this._entries().forEach((e, i) => {
        const d = document.createElement('div');
        d.className = 'logentry';
        if (have.has(e.id)) {
          d.innerHTML = `<h4>${escapeHtml(e.title)}</h4><pre>${escapeHtml(e.body)}</pre>`;
        } else {
          // A missing page is shown as missing rather than hidden, so the shape
          // of the story is visible from the first slate you find. The wording
          // rotates because six identical lines in a column read as a bug.
          d.innerHTML = '<h4>(not recovered)</h4><pre class="logempty">'
            + MISSING[i % MISSING.length] + '</pre>';
        }
        this.list.appendChild(d);
      });
    }
    this.el.classList.remove('hide');
  }

  hide() { this.el.classList.add('hide'); }

  /** Keeps the pause-screen button honest about how much there is to read. */
  refreshCount() {
    const n = this.game.progress.data.logPages.length;
    document.getElementById('logCount').textContent = `${n}/${this._entries().length}`;
  }
}

const MISSING = [
  'Silt and a hundred winters.',
  'Still out there somewhere in the debris.',
  'The slate is down here. The lamp has not been over it yet.',
  'Buried, or under something heavy.',
  'Not found.',
  'Somewhere between the bow and the boiler.',
  'Missing.',
];

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
