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
    this.dls = document.getElementById('rwDownloads') || this.dl.parentElement;
    /** @type {{title:string,url:string}[]} everything the chest is giving away */
    this.tracks = [];

    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      this._submit(this.email.value.trim());
    });
    document.getElementById('rwSkip').onclick = () => this._reveal();
    document.getElementById('rwClose').onclick = () => this.hide();
  }

  /**
   * @param {{title:string,url:string}|{title:string,url:string}[]|null} tracks
   *   what the chest is giving away — one track or several.
   */
  show(tracks) {
    this.tracks = (Array.isArray(tracks) ? tracks : [tracks]).filter(Boolean);

    // The RELEASE is what the chest held, not a list of filenames. `treasureName`
    // in music.json names it; without one, fall back to naming the tracks, which
    // is right for a chest holding one song.
    document.getElementById('rwTitle').textContent =
      this.game.audio?.treasureName
      || (this.tracks.length ? listNames(this.tracks.map((t) => t.title)) : 'LIGHT LESSONS');
    this.status.textContent = '';
    this._buildButtons();
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

  /**
   * A button per track. The one in the markup is reused for the first, so a
   * single-track chest looks and behaves exactly as it always did; any extras
   * are cloned off it and inherit the same styling.
   */
  _buildButtons() {
    this.buttons = [];
    // Clear out clones from a previous run — the chest can be reopened.
    for (const extra of [...this.dls.children]) if (extra !== this.dl) extra.remove();

    const make = (track, el) => {
      const b = el || this.dl.cloneNode(true);
      b.removeAttribute('id');
      b.textContent = this.tracks.length > 1 ? `DOWNLOAD ${track.title.toUpperCase()}` : 'DOWNLOAD';
      b.classList.add('hide');
      b.onclick = (e) => { e.preventDefault(); this._download(track, b); };
      if (!el) this.dls.appendChild(b);
      this.buttons.push(b);
    };

    if (!this.tracks.length) { make({ title: '' }, this.dl); return; }
    this.tracks.forEach((t, i) => make(t, i === 0 ? this.dl : null));
  }

  _reveal() {
    this.form.classList.add('hide');
    for (const b of this.buttons || [this.dl]) b.classList.remove('hide');
    this.game.progress.markClaimed();
  }

  /**
   * Fetch to a blob first. The download attribute is ignored cross-origin, so a
   * plain link to Supabase opens the player in a tab instead of saving the file.
   */
  async _download(track, btn) {
    const t = track || this.tracks[0];
    const el = btn || this.dl;
    if (!t?.url) {
      // No manifest, or it loaded nothing playable. Don't leave a dead button on
      // the last screen of the game — send them where the music actually is.
      this.status.innerHTML = 'The record lives on the '
        + '<a href="../music.html?b=lakehorse" style="color:var(--weed)">music page</a>.';
      return;
    }
    // Keep the real extension. The library holds mp3s as well as m4as, and a
    // file saved under the wrong one is a file some players cannot open.
    const ext = (t.url.split('?')[0].match(/\.(\w{2,4})$/) || [, 'm4a'])[1];
    const name = `${t.title || 'Lakehorse'}.${ext}`;
    const label = el.textContent;
    el.textContent = 'FETCHING…';
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
      el.textContent = 'SAVED ✓';
    } catch {
      // Last resort: open it. Not a download, but not nothing.
      open(t.url, '_blank', 'noopener');
      el.textContent = label;
    }
  }
}

/** "Light & Lessons", or "Light, Lessons & Currency". */
function listNames(names) {
  if (names.length <= 1) return names[0] || '';
  return names.slice(0, -1).join(', ') + ' & ' + names[names.length - 1];
}
