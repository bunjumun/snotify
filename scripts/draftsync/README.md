# draftsync — synced upload folder (CR-1)

A folder on this Mac that pushes new audio files into the music player by
itself. New files land as songs in a **"Recently uploaded"** folder on the
Music page; sort them into real albums/folders by hand later.

It does exactly what the site's own *Upload a folder* button does, just
unattended and triggered by the filesystem instead of a click.

## What it does / doesn't do

- **Add-only.** Deleting a file locally never removes it from the site.
- Each audio file becomes its own **song**, named after the filename, with the
  file as its first mix — same as the site's batch folder-upload.
- Re-syncing a file with the **same name but new audio** adds it as a new mix
  under that song (same-name replace, the site's existing behaviour). Same
  name *and* same bytes → skipped.
- Files over **50 MB** are skipped with a warning (Supabase free-tier ceiling;
  compress the bounce or wait for a later version of this feature).
- Accepted extensions: mp3 m4a aac ogg opus wav aif aiff flac.

## Install

```bash
cp scripts/draftsync/config.example ~/.snalbum-draftsync/config
chmod 600 ~/.snalbum-draftsync/config
# edit it: BAND, BAND_PASS, WATCH_DIR

scripts/draftsync/install.sh
```

The band password sits in `~/.snalbum-draftsync/config` (chmod 600, outside
the repo) — never in the script, never in the repo, never in a URL.

## How the trigger works

A launchd **WatchPaths** agent runs `draftsync.py` the moment the watched
directory's contents change — no polling, no Homebrew/pip dependency, all
macOS stdlib. `install.sh` watches the root folder **plus every sub-folder
present at install time**.

Edge case: adding a **brand-new top-level sub-folder** while the agent is
running isn't seen until something also changes at the root, or you re-run
`install.sh`. For a fully hands-off backstop, uncomment the `StartInterval`
block in the template and re-install — that adds a scan every 10 minutes on
top of the instant triggers.

## Run / inspect / stop

```bash
launchctl kickstart -k gui/$(id -u)/com.bunjumun.snalbum-draftsync   # run now
tail -f ~/.snalbum-draftsync/draftsync.log                            # watch it
python3 scripts/draftsync/draftsync.py                                # run once, by hand
scripts/draftsync/install.sh uninstall                                # remove the agent
```

State (which files are already up) lives in `~/.snalbum-draftsync/state.json`.
Delete it to force a full re-scan — already-uploaded files are recognised by
content hash and won't double up.

## Later (not built yet)

Sub-folder → album/folder mapping, an over-50 MB path, delete/rename mirroring,
a menu-bar status. "We will advance this feature later" — his note.
