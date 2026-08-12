// What's in the box.
//
// A download of Mango Tree World, offered for an email address — and offered
// just as readily without one. Hard-gating converts worse than it looks: the
// people who bounce at a form are the people who just played your whole game,
// and turning them away at the last screen to protect a mailing list is a bad
// trade for a band. So the "no thanks" button gives the same file.
//
// Two things about the address, because collecting them carries obligations:
// there's a plain sentence saying what it's for and how to stop, and the list
// itself is insert-only at the database (see supabase/schema-v17.sql), so the
// public page can write to it and can never read it back.
//
// The whole screen degrades. If v17 hasn't been applied, the signup silently
// keeps the address locally and the download still works — a band's website
// should never respond to "I finished your game" with an error.

const SUPA_URL = 'https://twgukeyoayfqldnojrkg.supabase.co';
const SUPA_KEY = 'sb_publishable_zIiAxxA5Zk1yRNzignANXA_rEp3vKdG';   // publishable — safe to ship

export class RewardScreen {
  /** @param {import('../core/Game.js').Game} game */
  constructor(game) {
    this.game = game;
    this.el = document.getElementById('reward');
    this.form = document.getElementById('rwForm');
    this.email = document.getElementById('rwEmail');
    this.status = document.getElementById('rwStatus');
    this.dl = document.getElementById('rwDownload');
    this.track = null;

    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      this._submit(this.email.value.trim());
    });
    document.getElementById('rwSkip').onclick = () => this._reveal();
    document.getElementById('rwClose').onclick = () => this.hide();
    this.dl.onclick = (e) => { e.preventDefault(); this._download(); };
  }

  /** @param {{title:string, url:string}|null} track what the chest is giving away */
  show(track) {
    this.track = track;
    document.getElementById('rwTitle').textContent = track?.title || 'Mango Tree World';
    this.status.textContent = '';
    this.dl.classList.add('hide');
    this.dl.textContent = 'DOWNLOAD';
    this.form.classList.remove('hide');
    // Someone who has been here before gets the file, not the form again.
    if (this.game.progress.claimed) this._reveal();
    this.el.classList.remove('hide');
    this.game.audio?.duck(true);
    if (this.game.state === 'play') this.game.state = 'paused';
  }

  hide() {
    this.el.classList.add('hide');
    this.game.audio?.duck(false);
    if (this.game.state === 'paused') this.game.state = 'play';
  }

  async _submit(email) {
    // Deliberately loose. A regex that rejects a valid address is worse than one
    // that accepts a typo, and the mail provider will bounce the typo anyway.
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      this.status.textContent = 'That address looks incomplete.';
      return;
    }
    this.status.textContent = 'Sending…';
    try {
      const r = await fetch(`${SUPA_URL}/rest/v1/rpc/game_subscribe`, {
        method: 'POST',
        headers: {
          apikey: SUPA_KEY,
          Authorization: `Bearer ${SUPA_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ e: email, b: 'lakehorse', s: 'swimulator' }),
      });
      if (!r.ok) throw new Error(String(r.status));
      this.status.textContent = "You're on the list.";
    } catch {
      // v17 not applied, or offline. Keep it so it isn't simply lost, and don't
      // make it the player's problem.
      try {
        const pending = JSON.parse(localStorage.getItem('lakehorse.pendingSignups') || '[]');
        if (!pending.includes(email)) pending.push(email);
        localStorage.setItem('lakehorse.pendingSignups', JSON.stringify(pending));
      } catch { /* private mode */ }
      this.status.textContent = 'Saved. Here it is either way.';
    }
    this._reveal();
  }

  _reveal() {
    this.form.classList.add('hide');
    this.dl.classList.remove('hide');
    this.game.progress.markClaimed();
  }

  /**
   * Fetch to a blob first. The download attribute is ignored cross-origin, so a
   * plain link to Supabase opens the player in a tab instead of saving the file.
   */
  async _download() {
    const t = this.track;
    if (!t?.url) {
      // No manifest, or it loaded nothing playable. Don't leave a dead button on
      // the last screen of the game — send them where the music actually is.
      this.status.innerHTML = 'The record lives on the '
        + '<a href="../music.html?b=lakehorse" style="color:var(--weed)">music page</a>.';
      return;
    }
    const name = `${t.title || 'Lakehorse'}.m4a`;
    this.dl.textContent = 'FETCHING…';
    try {
      const r = await fetch(t.url);
      if (!r.ok) throw new Error(String(r.status));
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      this.dl.textContent = 'SAVED ✓';
    } catch {
      // Last resort: open it. Not a download, but not nothing.
      open(t.url, '_blank', 'noopener');
      this.dl.textContent = 'DOWNLOAD';
    }
  }
}
