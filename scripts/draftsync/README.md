# draftsync — push a folder into the music player (CR-1)

Drop `draftsync.py` (or the `draftsync/` folder) anywhere on either Mac, run
it, and every audio file in that folder is uploaded to the site and filed
under a **"Recently uploaded"** folder on the Music page. Sort them into real
albums/folders by hand afterwards.

It does exactly what the site's own *Upload a folder* button does — just from
the command line, from any folder, on either computer.

## One-time setup, per computer

```bash
mkdir -p ~/.snalbum-draftsync
cp scripts/draftsync/config.example ~/.snalbum-draftsync/config
chmod 600 ~/.snalbum-draftsync/config
$EDITOR ~/.snalbum-draftsync/config          # set BAND and BAND_PASS
```

The band password sits in that chmod-600 file, outside the repo — never in the
script, never in a URL. After this, the script needs no per-folder setup.

## Using it

```bash
python3 /path/to/draftsync.py                 # upload the folder the script sits in
python3 /path/to/draftsync.py "/some/folder"  # upload a different folder
```

Or copy `draftsync.py` + `upload.command` into a folder and **double-click
`upload.command`** in Finder — it uploads that folder and prints what it did.

Instead of `~/.snalbum-draftsync/config`, a `.snalbum-draftsync` file sitting
next to the script (or in the target folder) is used if present — handy for a
folder that belongs to a different band.

## What it does / doesn't do

- **Add-only.** Deleting a file locally never removes it from the site.
- Each audio file becomes its own **song**, named after the filename, with the
  file as its first mix — same as the site's batch folder-upload.
- **Re-run any time.** Files already uploaded are recognised by content hash
  and skipped. A file with the **same name but new audio** goes up as a new
  mix under that song (the site's existing same-name-replace).
- Files over **50 MB** are skipped with a warning (Supabase free-tier ceiling).
- Extensions: mp3 m4a aac ogg opus wav aif aiff flac.
- Recurses into sub-folders. Sub-folder structure is **not** mirrored yet —
  everything lands flat in "Recently uploaded". ("We will advance this feature
  later.")
- Per-folder state is `.snalbum-draftsync-state.json` inside the folder, so
  moving the folder carries its upload history. Delete it to force a rescan.

## Optional: a set-and-forget synced folder

`install.sh` wires up a launchd agent that runs the script automatically
whenever one chosen folder changes — event-driven (WatchPaths), no polling, no
Homebrew/pip dependency.

```bash
scripts/draftsync/install.sh "/Users/bunj/Music/SnAlbum drafts"
scripts/draftsync/install.sh uninstall
```

Edge case: a **brand-new top-level sub-folder** added while the agent runs
isn't seen until something also changes at the root, or you re-run
`install.sh`. Uncomment the `StartInterval` block in the template for a
10-minute backstop scan.

## Later (not built yet)

Sub-folder → album/folder mapping, an over-50 MB path, delete/rename mirroring,
a menu-bar status.
