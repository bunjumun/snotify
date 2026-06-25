# 🎵 My Music

A personal, self-hosted music player in the spirit of [samply.app](https://samply.app) —
dark UI, real waveform scrubbing, **stacked song versions you can A/B seamlessly**, and
**timestamped comments**. It's a single static page, so the whole thing (player **and**
audio files) lives in one GitHub repo and is served free from GitHub Pages.

```
music-player/
├── index.html            ← the player (open this)
├── tracks.json           ← the manifest (songs → versions)
├── generate-manifest.mjs ← builds tracks.json from the tracks/ folder
├── tracks/               ← your audio (a folder per song = a stack of versions)
├── covers/               ← optional cover art
└── .nojekyll             ← tells GitHub Pages to serve files untouched
```

## The two headline features

**Version stacking + seamless switching.** Every song can hold multiple mixes
("versions"). While one is playing, click another version chip (or press `1`–`9`) and
playback **continues from the exact same spot on the new mix** — no gap, no restart. Perfect
for A/B-ing a master against a rough, or comparing two mix decisions at the same bar.

**Timestamped comments.** Seek to a spot, type a note, hit Add. It pins to that timestamp,
shows as a 💬 marker on the waveform, and records which version you left it on. Click a
comment (or marker) to jump there. Great for review notes to yourself.

## Add songs

**A folder per song = a stack of versions.** Make a folder inside `tracks/` named after the
song, and drop each mix inside it. The most recently modified file becomes the **latest**
version on top of the stack.

```
tracks/
  Midnight Drive/
    Rough Demo.mp3
    Mix v2.mp3
    Final Master.mp3      ← newest file → shown first / "LATEST"
  Loose Single.mp3        ← a file straight in tracks/ = a 1-version song
```

Then build the manifest:
```bash
node generate-manifest.mjs
```

Prefer to do it by hand? Edit `tracks.json` directly:
```json
{
  "title": "My Music",
  "songs": [
    {
      "title": "Midnight Drive", "artist": "Me", "cover": "covers/midnight.jpg",
      "versions": [
        { "name": "Final Master", "src": "tracks/Midnight Drive/master.mp3", "date": "2026-06-20" },
        { "name": "Mix v2",       "src": "tracks/Midnight Drive/v2.mp3",     "date": "2026-06-10" },
        { "name": "Rough Demo",   "src": "tracks/Midnight Drive/demo.mp3",   "date": "2026-05-30" }
      ]
    }
  ]
}
```
Version order in the array = stack order (first = on top). Only `src` is required per
version. A single-version song can just use `{ "title": "...", "src": "..." }`. The older
`"tracks": [...]` key still works too.

## Try it locally

Browsers block `fetch('tracks.json')` over `file://`, so run a tiny local server:
```bash
cd music-player
python3 -m http.server 8080
# open http://localhost:8080
```

## Publish on GitHub Pages

```bash
cd music-player
git init && git add . && git commit -m "Music player"
# create the repo on github.com (or with the gh CLI), then:
git remote add origin https://github.com/<your-username>/<repo>.git
git branch -M main
git push -u origin main
```
Then on GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch →
`main` / root → Save.** Your player goes live at
`https://<your-username>.github.io/<repo>/` within a minute or two.

> GitHub caps individual files at 100 MB and recommends repos stay under ~1 GB — plenty for
> MP3s. For very large lossless libraries, host the audio in a second repo and point `src`
> at jsDelivr (`https://cdn.jsdelivr.net/gh/<user>/<repo>@main/song.mp3`), which serves with
> CORS enabled.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Space` | Play / pause |
| `←` / `→` | Previous / next song |
| `↑` / `↓` | Volume up / down |
| `1`–`9` | Switch to version 1–9 (seamless) |
| `c` | Toggle the comments drawer |
| `s` | Toggle shuffle |
| `r` | Cycle repeat (off → all → one) |

## Notes & limits

- **Comments are stored in your browser (`localStorage`)** — they're private to you and the
  device you wrote them on, and they are *not* committed to the repo or shared with people
  you send the link to. This is the right default for personal review notes. If you want
  **shared** comments (so collaborators see each other's, like samply proper), that needs a
  place to store them — say the word and I can wire up a small backend (or a GitHub-token
  "commit a comments.json" flow per the project's password-protected strategy).
- Waveforms are rendered client-side by [wavesurfer.js](https://wavesurfer.xyz) (loaded from
  a CDN). To make the page fully self-contained, vendor `wavesurfer.esm.js` into the repo and
  change the import in `index.html` to a relative path.
- Switching versions preloads each mix's waveform when you open a song, so the first A/B is
  instant. The page is mobile-friendly and registers with OS media controls.
