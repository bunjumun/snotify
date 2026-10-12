// Reading back what the fish have said.
//
// Opened from the pause screen, same as the ship's log. The lore-exchange
// system (Clues.js) only ever shows one line of dialogue at a time and lets it
// scroll off — that's right for the moment it happens, being high, in the
// water, but it means a conversation that unspooled over three dives was never
// re-readable. This is that history, oldest first, so it reads as the story it
// was told across every dive rather than a shuffled deck of lines.

export class LoreHistory {
  /** @param {import('../core/Game.js').Game} game */
  constructor(game) {
    this.game = game;
    this.el = document.getElementById('lorebook');
    this.list = document.getElementById('loreList');
    document.getElementById('loreClose').onclick = () => this.hide();
    document.getElementById('btnLore').onclick = () => this.show();
  }

  show() {
    const history = this.game.progress.data.loreHistory;
    this.list.innerHTML = '';

    if (!history.length) {
      this.list.innerHTML = '<p class="logempty">Nothing yet. Pack a bowl, get high, '
        + 'and ask a fish about it.</p>';
    } else {
      // Not escaped: this is the same ask/say text HUD.say() already renders
      // as HTML. Live lore is pre-sanitised by LoreFeed's tidy() (every `<`
      // and `>` stripped before a lone trusted `<br>` is re-added for line
      // breaks); the built-in table is hardcoded in Clues.js. Either way it
      // reaches here already safe, and escaping it here would print `<br>`
      // as literal text instead of breaking the line.
      for (const { ask, say } of history) {
        const d = document.createElement('div');
        d.className = 'logentry';
        d.innerHTML = `<h4>${ask}</h4><pre>${say}</pre>`;
        this.list.appendChild(d);
      }
      // Newest exchange visible without scrolling, same as opening a chat.
      this.list.scrollTop = this.list.scrollHeight;
    }
    this.el.classList.remove('hide');
  }

  hide() { this.el.classList.add('hide'); }

  /** Keeps the pause-screen button honest about how much there is to reread. */
  refreshCount() {
    const n = this.game.progress.data.loreHistory.length;
    document.getElementById('loreCount').textContent = n ? `${n}` : '';
  }
}
