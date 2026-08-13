// Reading the log.
//
// Opened from the pause screen, because that's where you go when you want to
// stop and read rather than swim. Shows only the slates actually recovered, and
// the gaps are left visible — a log with pages missing is a better story than a
// log with a progress bar, and the blanks are what make you go back out.

import { ENTRIES } from '../game/LogPages.js';

export class Logbook {
  /** @param {import('../core/Game.js').Game} game */
  constructor(game) {
    this.game = game;
    this.el = document.getElementById('logbook');
    this.list = document.getElementById('logList');
    document.getElementById('logClose').onclick = () => this.hide();
    document.getElementById('btnLog').onclick = () => this.show();
  }

  show() {
    const have = new Set(this.game.progress.data.logPages);
    this.list.innerHTML = '';

    if (!have.size) {
      this.list.innerHTML = '<p class="logempty">Nothing recovered yet. The slates are out '
        + 'there — small, dark, and they catch the lamp when you sweep past one.</p>';
    } else {
      ENTRIES.forEach((e, i) => {
        const d = document.createElement('div');
        d.className = 'logentry';
        if (have.has(e.id)) {
          d.innerHTML = `<h4>${escapeHtml(e.title)}</h4><pre>${escapeHtml(e.body)}</pre>`;
        } else {
          // A missing page is shown as missing rather than hidden, so the shape
          // of the story is visible from the first slate you find. The wording
          // rotates because six identical lines in a column read as a bug.
          d.innerHTML = '<h4>— not recovered —</h4><pre class="logempty">'
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
    document.getElementById('logCount').textContent = `${n}/${ENTRIES.length}`;
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
