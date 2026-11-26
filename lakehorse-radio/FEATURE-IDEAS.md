# Lakehorse Radio: merch box feature ideas and status (2026-11-22)

Ideas and leanings from a design chat, with build status checked against BRAINSTORM-BRIEF.md and HANDOFF.md. See those for the details of what the firmware does today.

Status tags:
- **DONE**: built and tested on the real box
- **BUILT**: in the code but switched off, or not tested live
- **PARTIAL**: some of it exists
- **TODO**: not started
- **OPEN**: a question or decision still pending

## Concept

The player is one component of a decorative, functional merch object: a cigar or stash box that works as a new album release format. The ESP32 player, SD card and an 8x8 LED matrix live inside. Fans play the album, add their own music, and either pair the box to a Bluetooth speaker or use it as a small media server on their network. The look is space-age dazzle camo: WWI optical-illusion warship patterns on futuristic spaceships, in an alternate-reality dystopia. The UI is an imagined OS pulled from a crashed spaceship, used as the shell.

## What works today

The core player is real. The box plays WAV songs from its card through a Bluetooth speaker (tested on an ML301), and the web page works as the remote. The same page also plays songs on the phone itself when Bluetooth is off. Everything else in the merch concept (matrix, lid, shell, games, NFC, fan uploads, song updates) is still ahead.

## Playback and Bluetooth

- **DONE** Network mode as the main mode: the phone or computer plays card WAVs from the box (checked in Chrome and on an iPhone 8). It only works with Bluetooth off.
- **DONE** Bluetooth output to a speaker, with the page as the remote: play, pause, resume, seek, volume, and moving to the next song while the page is open. No underruns in tests.
- **DONE** The two modes are exclusive. With Bluetooth on, Wi-Fi power saving is forced and card songs download at only 22 to 40 KB/s, so phone playback needs Bluetooth off. A "Play songs on" chooser and a Bluetooth on/off switch handle this, and the page reloads itself after the restart.
- **DONE** Speaker pairing from the page: find speakers, connect, disconnect, and the box remembers the choice. Switching between speakers was tested.
- **DONE** The box resamples 48 kHz WAVs on the fly, so non-44.1 kHz files no longer need to be refused for Bluetooth.
- **TODO** Prompt to use home Wi-Fi or a phone hotspot when a speaker is paired and the only link is the box's own network. The unstable-SoftAP case has not been tested.
- **PARTIAL** Busy states: the page recovers after a Bluetooth restart, but there are no dedicated busy screens for scans or uploads.
- **DONE** The box advances to the next song by itself, with the page closed. It stops after the last song and does not wrap. Tested: one album track rolled into the next with no underruns.
- **DONE** Volume is saved and survives a restart (tested).
- **DONE** The speaker's own buttons work: pause and play were tested on the ML301, and the page follows. Next and previous are mapped but not yet tried on hardware.
- **TODO** A page opened mid-song does not yet show what the box is already playing.

## Network and setup

- **DONE** Station-first joining of home Wi-Fi, and a name that resolves on the network (lakehorseradio.local, which may be flakier with Bluetooth on, so the IP always works).
- **DONE** A Wi-Fi watchdog that rejoins when the router stops answering and restarts as a last resort, never during a song. It passed a simulated drill but has not yet caught a real hang.
- **BUILT** Fallback to the box's own network with a setup sheet (captive portal). The code is in, but the real "no saved network in range" case has not been seen live. Whether the network is open with no password is not confirmed.
- **TODO** NFC tag for joining the box's network on Android, plus a second record so iPhones open an instructions page (test on both phones), a printed QR fallback, and a front tag that opens the UI.
- **TODO** A second saved network for phone hotspots.
- **TODO** Online mode: saved links (direct audio, internet radio, embeds) that play in the device's own browser, never through the box's speaker, and hidden when only card media is shown.
- **DECIDED** Anything heavy served by the box (uploads, games, card songs to a phone) happens with Bluetooth off.

## Matrix and the box itself

Nothing here has been started.

- **NEXT** An 8x8 matrix inside the lid, with all electronics in the lid so only power crosses the hinge. First pass: status animations and scrolling text. Audio-reactive patterns come after that.
- **SKIPPED** Waking the matrix when the lid opens (reed switch plus magnet). Dropped for the prototype.
- **TODO** Song title and artist scrolling across the matrix, taken from the track list, with an ASCII fallback for accents.
- **TODO** Sound-reactive patterns. Current lean: native FastLED code fed from the audio samples, rather than a second ESP32 running stock WLED.
- **TODO** Images and GIFs converted to 8x8 frames in the browser, with the ESP just playing frames.
- **TODO** Clock (time from the phone's browser, or network time when online, plus an optional RTC module), an alarm that starts a track, a sleep timer, and quiet hours.
- **TODO** Distinct matrix animations for each state: pairing, upload, playing, idle.
- **OPEN** Physical controls: the lid sensor is skipped for now, so this is just whether to add a touch pad or a hidden reset.
- **TODO** A non-metal reflective or smoked cover for the electronics, with a signal-strength test on the real material.

## Shell, games and lore

- **DECIDED** (2026-11-25) Every usable feature has help, not only each window: a Windows 95 style What's this? mode (tap "?", then tap anything) plus a Help index in the Start menu that also covers features with no button. Text in data/help.json, written by whichever session builds the feature, enforced by a coverage test, added retroactively in plan Module 9. A guided tutorial mode comes later and reads the same file.
- **IDEA** (2026-11-25, not planned) Optics recalibration: a photo from the phone camera sets the shared color palette for the matrix, the shell and Signal Jam. ENIAS speaking lines aloud through the phone's built-in text to speech, if it works over plain HTTP on the iPhone.
- **IDEA** (2026-11-25, not planned) Fleet mode: boxes on the same network find each other, play in sync, compare alignment and share files that open only when several are together. Needs unique box names.
- **IDEA** (2026-11-25, not planned) Crew manifest photo booth: a phone selfie shrunk to a tiny portrait in the browser, saved to the card, shown on Drive B and as a face on the matrix. Each person can delete their own entry.
- **IDEA** (2026-11-25, not planned) Speaker knock codes: rhythmic presses on the Bluetooth speaker's own buttons unlock hidden things, without skipping the song.
- **PARTIAL** Dazzle-camo look: a dazzle.js already ships with the page. The full crashed-ship OS shell (boot log, launcher of programs, embedded bitmap font) is not started.
- **PARTIAL** (built 2026-11-23, untested on the box; see HANDOFF) Browser games, including the Lakehorse Swimulator, served from the card with the stored music as the soundtrack. First loads are heavy, so games should load with Bluetooth off or stay small.
- **TODO** Save slots as crew profiles on the card, so progress is shared across devices, with unlocks tied to the profile.
- **TODO** ENIAS alignment (decided 2026-11-22, mockup in the design canvas, Drive B artboard): the crashed ship's computer is a neural net that drifted in the crash, and finished Lakehorse songs pull it back into alignment. Alignment unlocks the corrupted drive's files (lore, promo track downloads, free ticket links) and the matrix settles from scattered pixels into a tidy pattern. Only band tracks count, using a per-track flag in the track list that ships set on the band's songs (no tag parsing). A track counts only when it plays most of the way through, and the counter lives in NVS. Outside music gets a "pattern unrecognized" line. Unlocks are for fun, so nothing exclusive goes on the card. Hints, not explanations: the drive shows a node lattice, an alignment readout and cryptic balloon lines.
- **DECIDED** (2026-11-22, details in ALIGNMENT-BRIEF.md) Game levels and finished band songs both add to the same alignment counter until it reaches 100%. The games run in the phone's browser, so the page has to report each cleared level to the box, which needs the crew profile or a small save endpoint that does not exist yet.
- **TODO** Export the lore as plain files, which depends on the Supabase site coming back at the next billing period. A content-as-data layout lets the story evolve without reflashing.
- **TODO** A band news ticker, tour dates and new-release notices fetched from a static file when online.

## Songs and updates (must-have)

- **DONE** The song-prep tool on a computer converts audio to 44.1 kHz 16-bit stereo WAV by default (verified in Chrome). AAC is labelled "browser playback only".
- **DONE** Partitions and PSRAM: the app partition is now 3.375 MB, and 4 MB of PSRAM is enabled. The chip is an early ESP32 revision with a known PSRAM fault, which limits what can live there.
- **BUILT** Uploading songs from the page works as a raw-body POST at about 220 KB/s, with an optional pairing key, but it is switched off (`SD_UPLOAD_ENABLED`).
- **TODO** A fan-friendly upload page: use the same 44.1 kHz conversion as song-prep, drop in a file or album ZIP, unzip in the browser, convert and upload one track at a time (whole songs held in memory can crash a phone), fill in titles and cover art, and make transfers resumable with progress. Playback stops during upload.
- **DECIDED** No Bandcamp API for a fan's collection (the official API is for labels and partners), and the box never holds a fan's login cookie.
- **OPEN** Quality without a noticeable drop. WAV is about 10.6 MB per minute, so a 40-minute album is roughly 420 MB and slow to upload. Preferred direction: FLAC on the box (lossless, about half the size, light on the CPU), using the FLAC decoders in audio-tools. Decoder working memory is roughly 16 to 64 KB, which does not fit in the roughly 50 KB of internal RAM left while Bluetooth plays on this chip. It needs the newer board and a test. Fallback: high-bitrate AAC or MP3, which is lossy and a user decision.
- **DECIDED** Card swapping is out, and USB file transfer is not possible on the classic ESP32.
- **CHECKED, NOT BUILT** Page-only updates over Wi-Fi. The core can write the page partition, but it erases in place, a failed write leaves an empty filesystem, and there is no recovery page in firmware. Safe only with a firmware-served recovery page and an SD-staged image, see HANDOFF.md "Borrowed from WLED" item 4.
- **DONE** Small card-file upload (`POST /api/sd/card-file`, allowlist in config.h, pairing key, content checked) so song updates can maintain band-tracks.json; push it with `tools/push_card_file.py`.
- **DONE** Hotspot stays usable while the saved network is away: auto-reconnect off while the hotspot is up, search cancelled when a phone joins, resumes 30 s after it leaves (bench-measured with a Mac; iPhone 5 minute test still open).
- **NOTE** The 8x8 matrix driver costs about 13.5 KB of internal heap and is out of the normal build until the matrix section is picked up (`env:radio-core2-matrix` has it).
- **TODO** OTA firmware updates. Blocked by flash: partitions.csv has one 3.375 MB app slot in a 4 MB chip, and an update needs a second slot of the same size, which cannot fit. Options to weigh later: a module with more flash, or a much smaller firmware. Check the built firmware size before deciding. WLED's own OTA is a plain browser upload to /update, see the chat notes of 2026-11-25.

## Hardware and future editions

- **OPTIONAL** Move to the ESP32-WROVER-E rev 3 (about $10), which fixes the PSRAM fault. The current WROVER is the right kind of board, just an early chip revision. Only needed if a feature runs out of RAM, most likely FLAC decoding or a screen. It must stay a classic ESP32, because the S3, C3 and C6 have no Bluetooth Classic.
- **TODO** A screen edition: a 2.4 inch SPI touch module on the WROVER board, on its own SPI bus, after the new board is in. It could run with Wi-Fi off during Bluetooth playback.
- **DECIDED** All-in-one cheap display boards usually lack PSRAM, so they are not the base. Analog DAC output is deferred.

## Open questions

- **BUG** Away from its saved network (taken from the house, 2026-11-25), the box raised its hotspot but the phone could not hold a connection to it long enough for the setup sheet to appear. Not Bluetooth. Likely cause is the 30 s background retry of the saved network knocking phones off the hotspot; details and the proposed fix are in SHELL-AND-MATRIX-PLAN.md under Open decisions. Matters for any use away from a home network, including shows.
- Will the new board raise Wi-Fi throughput with Bluetooth on? RAM will improve, but the limit looks like coexistence power saving, so this is unknown.
- FLAC or high-bitrate AAC/MP3, decided after a memory test.
- How to handle first-load game downloads under Bluetooth.
- Does the two-record NFC tag behave on both iPhone and Android?
- Can Bandcamp download links be fetched by URL at all? Unlikely.
