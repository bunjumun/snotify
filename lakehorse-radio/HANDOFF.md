# Lakehorse Radio — handoff

Written 2026-09-15, updated 2026-09-16. Read this, then `README.md`.

## 2026-11-21: baseline before Bluetooth work (Module 0)

Measured before any Bluetooth, partition or PSRAM change, so later modules have
something to be compared against. All heap figures are internal RAM only
(`ESP.getFreeHeap/getMaxAllocHeap/getMinFreeHeap` on core 3.3.11 ask for
`MALLOC_CAP_INTERNAL`), so they stay comparable once PSRAM is on.
`/api/status` now reports `largestFreeBlock` and `minFreeHeap` alongside
`freeHeap`, and the boot line prints all three.

**Card contents** (`GET /api/sd`, headers read by a 4 KB Range request):

| File | Bytes | Format |
|---|---|---|
| Currency.wav | 84,097,716 | PCM WAV, 48 kHz, 16-bit, stereo |
| Jupiter Gold.wav | 58,982,444 | PCM WAV, 48 kHz, 16-bit, stereo |
| Mango Tree World.wav | 41,621,148 | PCM WAV, 44.1 kHz, 16-bit, stereo |
| This Is War.wav | 68,266,844 | PCM WAV, 44.1 kHz, 16-bit, stereo |

Card: 31.25 GB, 29.0 GB free. The masters in `music/` are 24-bit; what is on
the card is the converted 16-bit copies.

**Heap** (bytes):

| Moment | freeHeap | largestFreeBlock | minFreeHeap |
|---|---|---|---|
| Boot line (before Wi-Fi/web server) | 260,752 | 110,580 | 228,552 |
| Idle, joined to pifi (before this change) | 143,284 | - | - |
| Idle, joined to pifi | 144,024 | 94,196 | 141,920 |
| During 2 parallel 256 KB Range streams | 79,196 | 38,900 | 60,156 |
| After the streams ended | 140,124 | 94,196 | 60,156 |

The load test mirrors `wavstream.js`: two `curl` loops fetching alternate
256 KB ranges of `Currency.wav` for 60 s, 50 x 206, 213 KB/s combined.
**The low-water mark under streaming load is ~60 KB of internal RAM**, and
the largest single block falls to ~38 KB. Anything added later (a Bluetooth
stack takes tens of KB of internal RAM on its own) has to fit under that.

- **PSRAM: 0 bytes** on the boot line, although the prebuilt core-3.x libs
  have `CONFIG_SPIRAM=y` and call `psramInit()` themselves. So either the
  module has none or init fails quietly; Module 3 finds out.
  - **↳ Found (Module 3): it was compiled out.** pioarduino defines
    `ESP32_ARDUINO_LIB_BUILDER`, and with that and no `BOARD_HAS_PSRAM`,
    `esp32-hal-psram.h` `#undef`s `CONFIG_SPIRAM`. The board has 4 MB.

## Shell Module 8, piece 1: alignment counter (2026-11-22/23) - BUILT, tested, verified on the box

**Built (working tree, not committed)**
- `src/alignment.{h,cpp}`: Arduino-free core. Constants block at the top of `alignment.cpp` (100/10/100/5, cap 6400, 50% half, 10 s repeat window, level ids 0..31). `Counter::submit` does the credit, cap, repeat table (8 slots, wrap-safe) and one `Storage::save` per credited event that changed something. Also `resultForLeaving`, `bandListContains`, `playlistHasTitle`.
- `src/alignment_box.{h,cpp}`: NVS storage (`lh_align`: `pts` uint16, `lvl` uint32), one mutex around the counter, `onTrackLeft`, `snapshot`, `submitEvent`.
- `test/test_alignment` (20 tests). Whole native suite 130/130; all JS and Python tests pass.
- `POST /api/alignment/event?source=song|level&id=&result=full|partial|clear|attempt` returns `{ok, credited, repeat, added, points, nodes, percent}`. 400 for bad combos (song takes full/partial, level takes clear/attempt), a song not in the playlist, a level id outside 0-31 (no leading zero). A repeat answers 200 with `repeat:true`, not counted. `/api/status` gained `alignment:{points,nodes,percent}`.
- `main.cpp`: `alignment::begin()` after `sdstore::begin()`.

**The four hooks in `src/box_player.cpp`** (plus one include and a 7-line helper `reportLeavingLocked(reachedEnd)` above `closeTrackLocked`, which works out played-since-seek / duration from `g_played`, not the clock): end path in `readerTask` (true), `stop()`, speaker Next in `handleSpeakerKeyLocked`, top of `startLocked` (play replacing a loaded song). All under `g_lock`, all before the state is reset. `g_played` resets on every flush, so a seek, the speaker Restart key and a replay all restart the count (as specified).

**Decisions I made**
- Band flag = `/band-tracks.json` at the card root, `{"version":1,"tracks":["Song.wav",...]}`, exact case-sensitive match. Not cached: it is read (<=4 KB, malloc'd, freed) only after a track has played 50%, so skips under half never touch the card. Missing card, missing file, empty, over 4 KB or malformed means nothing flagged.
- Played >= 50% is required for any credit; a track that ends having played under half (e.g. seek to 90%, let it end) earns nothing.
- Song events from the box go through the same repeat table as the endpoint; box song ids are file names, phone ids are playlist titles.
- Phone-mode songs checked against `playlist::load()`, falling back to the baked-in default (the same fallback `/api/playlist` uses). `playlist::validate` and `playlist.json` untouched.
- Level `clear` sets bit `id` in `lvl`; every clear still scores (replays count, per the brief's open note).
- A failed NVS write is logged and the total still counts until reboot.
- The endpoint does not refuse phone song events while the box is playing; the page is meant to not report then (piece 2).
- **Can the existing upload write band-tracks.json? No.** `/api/sd/upload` only takes audio names into `/music`; `/api/sd/game-upload` only writes under `/game/`. Future song updates need a card reader or a new small route. I did not add a permanent one.
  - **↳ AMENDED 2026-11-25:** the small route now exists, `POST /api/sd/card-file`, see "Borrowed from WLED" item 3. Push the list with `python3 tools/push_card_file.py`.
- Test-only firmware: `env:radio-core2-aligntest` (`-D LAKEHORSE_ALIGN_TEST`) adds `POST /api/test/align-reset` and `POST /api/test/band-tracks` (send `Content-Type: application/json`). Compiled out of `env:radio-core2`, which is the shipping build.
- Starter list: `band-tracks.json` in the project root (all four songs on the card).

**Measured / verified on the box (Mango Tree World, 236 s, via the API)**
- Skip at 30%: +0. Seek to 60% then stop: +0. Skip at 60% (141.7 s): +10. Flagged, played to the end: +100 (total 110). The auto-advance then started This Is War (not in the test list); stopped under half: +0. Unflagged (taken off the list), played to the end: +0.
- Endpoint: level 3 clear +100, same again inside 10 s ignored (`repeat:true`), level 3 attempt +5, playlist song "Light" full +100, repeat ignored, unknown title 400, level 40 and level+full 400. Total 315.
- Reboot: came back as 315 points, levels 0x00000008. Total reset to 0 with the test route, then the shipping `radio-core2` firmware was flashed (test route now 404). Status shows alignment 0, speaker ML301 connected.
- Reader-task stack spare after a credit with the card read: 3.8-4.2 KB of 6 KB, so the hook fits.
- Heap: minFreeHeap 16,240 after the run (4 plays, ~40 requests) vs Module 6's 26,024, i.e. 9.8 KB lower. At boot with Bluetooth connected this firmware already showed min 20.8 KB before any song, and the low-water mark crept down with repeated plays (19.4 to 16.2 KB). I did not A/B against the pre-change firmware, so how much is alignment (code, one small malloc per credit, mutex) vs Bluetooth being switched on and a longer run is not known. Needs an A/B before Drive B.
- Underruns 0 throughout. Pairing: speaker connected on boot and playback unchanged.

**Hardware note:** the box rebooted twice mid-playback (and once dropped off USB) while the user's 8x8 matrix was wired to its 5V/GND/data. With the matrix unplugged, no reset in a ~12 minute run. Likely a power sag; unproven.

**Not verified:** minFreeHeap A/B (above); pairing from cold (speaker was already connected); malformed or missing `band-tracks.json` on the box (covered by native tests only); phone-mode song events from a real page.

**State left on the box:** shipping firmware, total 0, `/band-tracks.json` on the card with all four songs (written by the last test run), Bluetooth ON (it was off when I started). The test route is not in this firmware, so a future list change needs a card reader.

## START HERE (2026-11-23, night): broken game-file responses = PSRAM pbufs (FIXED, flashed, verified)

- **Symptom:** `/game/index.html`, `three.core.min.js`, `three.module.min.js`, `config.js` failed EVERY time (not random): curl 200 + 0 bytes (exit 8), Chrome `ERR_INVALID_HTTP_RESPONSE`. Raw dump: the last (header length mod 4) bytes of the header block arrive as `00` (183-byte header -> `\n\r\n` lost). Guber's index.html (184-byte header) was fine.
- **Cause:** `RUNTIME_PSRAM_THRESHOLD = 1024` (config.h) put lwIP TCP pbufs (~1,508 B) in PSRAM; on this rev v1.0 chip the Wi-Fi copy out of PSRAM drops bytes. The old "header length matters" note in `web_server.cpp` was this same bug.
- **Fix:** threshold 1600 (pbufs internal; 2.9 KB send buffers and 16 KB SD blocks stay PSRAM).
- **Heap before (idle, ML301 connected, stopped):** freeHeap 22,368 / largestFreeBlock 12,276 / minFreeHeap 12,648; PSRAM free 3,726,623.
- **Heap after (`radio-core2` flashed, same state):** boot settles 23,228 / 14,324 / min 23,168. After 6 cold browser loads + 4 full game-file sweeps: 19,456 / 9,204 / **min 9,804**. After a song stream plus game sweep: 19,196 / 8,692 / **min 9,064**. PSRAM unchanged (3,726,623). The low-water is ~3.5 KB lower than before because segments in flight now sit in internal RAM; no OOM seen, box answered throughout. Watch this if anything else lands in internal RAM.
- **Verified:** every `/game/*` file byte-identical to its packed copy (gz as served), 4 sweeps, 0 bad (Guber index differs only because `build/sd-game` is stale; the served one is valid gzip, current source + the 46-byte box flag). Chrome cold loads (fresh isolated context each): Guber `/game/guber-eats/?mute` 3/3 and Swimulator `/game/` 3/3, every request 200, no console errors (one `/favicon.ico` 404 from the browser itself on 1 load; the box has no favicon). Radio page `/` still 200 with full body.
- **Not fixed (pre-existing, documented in Module 6):** with Bluetooth on, HTTP is 30-40 KB/s (modem sleep + send-window cap). A phone streaming a song while the game loads starves both: in a 25 s test 1 of 3 song ranges and one `config.js` fetch timed out. Turn Bluetooth off for phone playback, or don't stream songs during a game load.

## START HERE (2026-11-23, evening): Swimulator is bundled; GAMES folder; touch Guber live

- **"The water would not load" fix = bundle.** `pack_game.py` now runs `esbuild` (brew, 0.28.2) on `game/src/main.js` into ONE file at `src/audio/bundle.js` (depth matters: `AudioDirector` reads `new URL('../../music.json', import.meta.url)`), Three.js stays external via the import map. Swimulator load = 3 requests (was 54), 0 failed, no console errors. Without esbuild the pack falls back to the 52 modules and says so.
- **Card cleaned:** `tools/clean_game.py` removed the 106 stale files (old `/game/src/**` modules and top-level `bundle.js`, plain and .gz) through a new `POST /api/sd/game-delete?path=` (one file under /game/, folders refused, firmware reflashed). Empty `/game/src/<folder>/` directories remain. Songs, live bundle, index, config, music.json, vendor, guber-eats untouched and still 200. The old line below about leftovers is now out of date.
- **Page:** GAME.EXE is now a GAMES folder window (`SD:/game/`, one icon tile per game). GAME.EXE greyed out because the probe used HEAD and the box answers `/game/*` for GET only; the probe is now a one-byte Range GET. Firmware never gained HEAD for `/game/*`.
- **Guber Eats on the box:** gamepad + touch controls + phone layout (see `guber-eats/HANDOFF.md`), SD soundtrack with Currency first, synth muted.
- **Stress finding:** a song stream plus 6 parallel game-file requests made the box stop answering for a while (unknown if crash). Bundling removes the 54-request case; the song-plus-game heap and stutter measurement is still not done.

## START HERE (2026-11-23, later): Module 7 LIVE on the box, plus Guber Eats

**Done and checked on the real box (192.168.0.38), in Chrome, cold:** Swimulator at `/game/` (54 requests, 0 failed, 0 off-origin, load 0.3 s) and Guber Eats at `/game/guber-eats/` (title screen, no console errors, Three.js 0.3-0.6 s). Guber's soundtrack on the box is the SD songs, **Currency.wav first** (then the rest, cycling): played from `/sd/Currency.wav`, 16 s in, no error. Firmware + LittleFS flashed 3 times; last firmware has the fixes below.
- **Card fill needs no card reader now:** `python3 tools/pack_game.py && python3 tools/push_game.py [host]` pushes `build/sd-game/` to `/game/` via new `POST /api/sd/game-upload?path=` (path-checked by `gamefiles::resolve`, one upload at a time, overwrite only, never deletes). 116 files, ~40 s.
- **Bug fixed 1:** `g_server.on("/game")` registered before `/game/*` redirected every `/game/...` URL to `/game/` forever (library treats "/game" as a prefix). Wildcard now first.
- **Bug fixed 2:** `SD.begin` default `max_files` is 5; the browser's ~40 parallel module requests made the 6th open fail, a 404 on an existing file ("The water would not load"). Now 10 (`sd_store.cpp`).
- Guber: `pack_game.py` copies `../guber-eats/index.html`, injects `LAKEHORSE_BOX`; its `startTheme()` reads `/api/sd` only when that flag is set, so the hosted site is unchanged. Link button in GAME.EXE.
- **Guber synth is silent on the box:** with `LAKEHORSE_BOX`, `musicGain` and `sfxGain` are 0 (music, engine, skid, effects); only the SD song plays. Checked: gains 0, `/sd/Currency.wav` playing. If the SD song fails to load the game is now silent, not synth.
- **Not checked:** `minFreeHeap` under game load plus a song stream (was 14 KB after the flood before fix 2; re-measure). Currency is 48 kHz = ~192 KB/s against ~220-250 KB/s card reads, so game assets loading during a song may stutter. Bluetooth on/off, mute game when box speaker plays (`/api/player`), and FEATURE-IDEAS "Browser games" PARTIAL tick are still open.

## START HERE (2026-11-23): Swimulator on the SD card (Module 7), built, NOT yet tried on the box

**Decision (his words):** the SD card is the go-to storage for anything big. Flash (512 KB) keeps only the page. The game is plain files in `<SD>/game/`, served at `/game/`, no Supabase, SD songs as the soundtrack.

**Built and tested on the laptop**
- Firmware `src/game_files.*` (path rules, `test/test_gamefiles`, 8 tests) + `handleGameFile` in `web_server.cpp` (serves `X.gz` when the phone accepts gzip, Range, 1 h cache); `/game` redirects to `/game/`. `sendOpenedFile()` is now shared with `/sd/*`. `env:radio-core2` builds. **Not flashed.**
- `data/game-window.js` + GAME.EXE window, desktop icon, Start item in `index.html` (HEAD-probes `/game/index.html`; dimmed Play link if missing). `test/game-window.test.js`. FS image 50 KB gz, builds.
- Game side: `game/src/core/Box.js` (`ON_BOX`, set by `window.LAKEHORSE_BOX`, NOT by URL, since the hosted site is also under /game/). On a box: LogFeed, LoreFeed, reward sign-up skip Supabase; `AudioDirector._liveTracks` reads `/api/sd` and plays `/sd/<name>`. `test/box.test.mjs`.
- `tools/pack_game.py` -> `build/sd-game/` (game + vendor/three + `.gz` of every text file; 1.36 MB -> 420 KB gz). `test/pack_game.test.py`. No bundler: 52 module files.
- Checked in the browser against a mock box (`/game/`, `/api/sd`, `/sd/`): cold load OK, DIVE IN OK, 0 requests off-origin, HUD showed SD tracks, no console errors.

**Next, in order**
1. `python3 tools/pack_game.py`, copy `build/sd-game/*` to the card as `/game/` (so `/game/index.html` exists).
2. Flash firmware + LittleFS (`radio-core2`), open the page, GAME.EXE -> Play.
3. Watch `/api/status` `minFreeHeap` (was ~60 KB under streaming; game load + song stream is two SD streams). Try BT on and off. 52 requests at 22-40 KB/s may be slow: if so bundle with esbuild (not installed).
4. Remaining plan items: tick FEATURE-IDEAS "Browser games" PARTIAL (done below), mute the game when the box speaker is playing (`/api/player`), not built.

## START HERE (2026-11-22, night): Module 6 WORKS, the box plays songs on ML301

**Heard by ear:** WAVs from the SD card play out of ML301, 44.1 and 48 kHz
(48 is resampled on the box). The page drives it: "Play songs on: the box's
speaker" switch, then tap a song. Verified from the page: play, pause, resume,
seek, end of song moves on to the next, switching back to "this device" stops
the box. 0 underruns across every test. Board is flashed with all of this
(`radio-core2`, firmware + LittleFS).

**What was built**
- `src/box_player.*`: SD WAV -> reader task (core 1) -> 2 s ring in PSRAM ->
  A2DP data callback. Commands take a mutex; the BT callback only takes a
  spinlock and plays silence when dry. `src/pcm_format.*`: WAV header parse,
  mono->stereo, linear resampler, volume (pure, `test/test_pcm`, 18 tests).
- `src/player_api.*`: `GET /api/player`, `POST /api/player/{play?name=&t=,
  pause, resume, stop, seek?t=, volume?v=}`. `ended` is a counter.
- `data/player-box.js` (real backend, polls once a second), `player.js`
  `stop()`, `library.js` + `index.html` "Play songs on" switch, shown only
  if `/api/player` says `built`. `test/player-box.test.js`.
- Bluetooth only in `env:radio-core2` (`-D LAKEHORSE_BT=1`, ESP32-A2DP
  v1.8.8). `env:radio` (core 3) still builds, without it.

**The memory fight, and why the settings are what they are** (all in config.h)
1. Wi-Fi modem sleep must be ON with BT (IDF 4.4 coex aborts in
   `coex_core_enable` otherwise). mDNS may be flakier; the IP always works.
2. BT costs ~87 KB internal RAM at the core's malloc threshold (4096): left
   12 KB, Bluedroid asserted connecting. Threshold 32 for everything fixed
   RAM (74 KB) but crashed under page loads: `CORRUPT HEAP: Bad tail`, a zero
   byte past a LittleFS file handle in PSRAM, every time. **The chip is ESP32
   rev v1.0** (PSRAM cache bug). So: threshold 32 only while BT starts (first
   thing in setup), then **1024** for the rest of runtime (lwIP segments and
   the server's 2.9 KB buffers go to PSRAM, small structs stay internal).
3. Even then, parallel page loads during playback ate the rest and the Wi-Fi
   driver went permanently deaf (still "connected", no ping) after a dip to
   ~10 KB. Fixes: per-connection TCP send window capped at 2 segments
   (`send_window.*`, middleware), AsyncTCP stack 16->8 KB.
- Result while playing: ~55 KB free idle; one page load at 6 parallel: low
  18.7 KB, fine; soak 325 requests at 6/12 parallel: no crash, no wedge,
  0 underruns, 2-9 % requests failed under that abuse.
- `[hb]` heap/Wi-Fi line on serial every 2 s (`main.cpp`), for diagnosis.

**Speaker controls (2026-11-22, later still)**
- Page panel under "Play songs on" (`data/speaker-panel.js`, tests in
  `test/speaker-panel.test.js`): status line, Connect / Disconnect,
  Find speakers (14 s inquiry, list strongest first, tap to play there),
  Turn Bluetooth on/off.
- Firmware: `src/bt_speaker.*` owns the A2DP link (moved out of
  box_player.cpp); `src/speaker_api.*` is `/api/speaker/*`. Chosen speaker
  and on/off live in NVS namespace `lh_bt` (`spk`, `on`). Library levers it
  needs (is_end, is_target_status_active) are protected, exposed by a
  subclass, behaviour unchanged.
- **Bluetooth off = saved setting + restart**, not live: btInUse() returns
  false so controller RAM is freed, modem sleep goes off, send-window cap is
  skipped. Measured: 1 MB from the card 86-238 KB/s with it off vs 24 KB/s
  on; ping 22 ms vs ~100. That is what makes "this device" playback work.
- Verified on hardware: scan found "bat house"; disconnect stays down
  (19 s); Connect back in 9 s; off -> restart -> on -> ML301 back 6 s after
  boot. **Switching to a second speaker: verified by him on 2026-11-22**
  ("testing and switching devices works as it should").
- Search for the chosen speaker is bounded (60 s, `BT_SEARCH_MS`); a
  speaker that was off needs Connect pressed again after that.

**Known limits / next**
- ~~Phone playback of card WAVs is too slow in this build~~ while Bluetooth
  is on (22-40 KB/s, needs 176). **Turn Bluetooth off on the page** for
  phone playback (above).
- ~~A Wi-Fi wedge needs a power cycle.~~ **Watchdog added (2026-11-22,
  later):** `src/net_watchdog.*` pings the gateway every 15 s (3 pings, any
  reply = alive). 3 silent probes in a row: rejoin Wi-Fi (Bluetooth and the
  song keep going). Still silent 3 probes after that: `ESP.restart()`, but
  held while a song plays. Does nothing until the gateway has answered once
  on this network, so a router that drops ping never causes restarts. The
  decision is `src/link_watch.*`, native-tested (test/test_linkwatch).
  Tunables in config.h `WATCH_*`. Log prefix `[watch]`.
  **Drill:** build with `PLATFORMIO_BUILD_FLAGS="-D LAKEHORSE_WATCHDOG_DRILL=1"`
  and every probe after arming reads as failed. Seen on hardware: rejoin at
  ~45 s, restart ~50 s later, clean boot, repeat; with a song playing the
  restart was held. Never ship the drill build. Not yet seen: a real wedge
  being caught (none has happened since the send-window fix). The ping
  task costs ~3 KB internal RAM (idle free 50.8 KB with it).
- The real fix for RAM is a **rev3 ESP32-WROVER-E** (no PSRAM bug, so
  everything small can live in PSRAM; 74 KB free measured that way). Must
  stay classic ESP32: S3/C3/C6 have no Bluetooth Classic, so no A2DP.
- **Box-side auto-advance + saved volume (2026-11-22, late):** when a song
  ends the reader task starts the next WAV on the card itself (order:
  `src/track_order.*`, case-insensitive name sort, matching the page's
  `localeCompare` for plain names), skips up to 5 unplayable files, stops
  after the last (no wrap, same as the page). `sdstore::nextAfter` does one
  directory pass. Page follows via the new `advanced(name)` event
  (player-box.js sees `ended` bump while the box is still playing).
  Volume: saved to NVS `lh_bt`/`vol` 2 s after the last change (reader task,
  not the request), loaded at boot; the page adopts the box's volume when it
  takes over the box instead of pushing its own. Reader stack 4096 -> 6144.
  **Verified on hardware:** volume 0.4 survived a reset; Mango Tree World ->
  This Is War with no page polling, 0 underruns, `ended` 1. Not done: a page
  opened mid-song does not pick up what the box is already playing.
- **Speaker buttons work (2026-11-22, late):** `src/speaker_keys.*` maps AVRCP
  passthrough keys (PLAY toggles, PAUSE/STOP pause, FORWARD = next song,
  BACKWARD = restart); the BT callback only records the key and the reader
  task acts under the lock (`handleSpeakerKeyLocked`). ML301 sends 0x46 on
  pause and 0x44 on play; presses with nothing loaded do nothing. Verified by
  him: pause/play several times from the speaker, page shows paused.
  FORWARD/BACKWARD are mapped but not yet tried on hardware.
- `pio` lives at `~/.platformio/penv/bin/pio`. Opening the serial port on
  this Mac resets the board (DTR/RTS held low did not help).
- macOS blocks command-line Bluetooth (TCC kills IOBluetooth scripts), so
  ML301 cannot be disconnected from the Mac by Claude; he has to.

### Superseded: Module 6 Wi-Fi check (earlier the same night)


Re-measured `radio-core2` on a clean link (ping 0 % loss to router and box,
rssi -59), no firmware change: **1 MB SD range 200-270 KB/s** (core 3: ~220),
**harness 12-par x10: 0/130 fail, 0 slow**, LittleFS `app.js` ~100 KB/s
(small file, latency-bound). So core 2.0.17 matches core 3 on Wi-Fi and
**the core-2 move stands**; the suspects list below is moot. The earlier
10 KB/s run had a degraded link despite the 0 % ping at the time.
- Board is still on `radio-core2`. `apIp` = 192.168.4.1 with the AP off is
  cosmetic (core 2 `softAPIP()` default), not AP+STA.
- ~~Next (Module 6 proper)~~ done, see above. Was: add the A2DP source to the radio firmware on
  core 2 and run Wi-Fi + web serving + BT together; watch internal RAM
  (BT costs ~85 KB; minFreeHeap under two streams is 52.6 K now, so it will
  be tight). Then a 1-hour stream test (`tools/stream1h.sh`) with BT playing.

### Superseded: "core 2 is slow on Wi-Fi" (end of earlier session)

**The dilemma:** Bluetooth A2DP to ML301 works only on core 2.0.17; Wi-Fi
file serving is fast only on core 3.3.11.

| | core 3.3.11 (`env:radio`) | core 2.0.17 (`env:radio-core2`) |
|---|---|---|
| A2DP to ML301 | pairs, then drops in ~300 ms | plays steadily |
| 1 MB SD range | ~220 KB/s | **~10 KB/s** (clean link: 0 % loss, rssi -59) |
| harness 12-par x10 | 0/130 fail | 9/130 fail |
| LittleFS `app.js` | fast | ~4 KB/s (so not SD-specific) |

- **Board is flashed with `radio-core2` right now.** To restore the working
  radio: `pio run -e radio -t upload` (costs a ~35 min framework reinstall,
  see the trap note below).
- **Ruled out for the slowdown:** lwIP/Wi-Fi buffer settings: sdkconfig
  TCP_SND_BUF/WND 5744-5760, MSS 1436, RX/TX buffers, BA window are the same
  in both cores.
- **Next suspects, test one at a time on `radio-core2`:** (1) ESP32Async
  AsyncTCP 3.5 / ESPAsyncWebServer 3.12 on core 2. Serve one file from a
  bare sketch, or pin older AsyncTCP; (2) Wi-Fi power save: confirm
  `WiFi.setSleep(false)` actually took on core 2 (`esp_wifi_get_ps`); (3)
  `apIp` reads 192.168.4.1 after join, so check the SoftAP is really off
  (AP+STA would cut throughput).
- **Fallback if core 2 can't be made fast:** stay on core 3 and debug the
  IDF 5.5 A2DP drop (bluedroid trace logs / raise an upstream issue).
- **Measuring rules:** ping the router *and* the box first; trust nothing
  with loss > 0 %. The YouTube video and the metal drawer both cost us loss
  today. Board now lives in the open. Tools: `tools/firstload.py`,
  `tools/stream1h.sh`. Only one session on the serial port at a time.
- The user's "Bluetooth output integration brief" (modules 4-10) is not in
  the repo; ask him to re-paste it if needed.

## 2026-11-22: Module 5 (A2DP spike): works on core 2.0.17, NOT on core 3.3.11

Spike lives in `spike-a2dp/` (own `platformio.ini`, shares `../partitions.csv`),
ESP32-A2DP v1.8.8 (git tag; not in the PIO registry under that name). Plays a
quiet 440 Hz sine to the speaker **"ML301"** (MAC 70:b3:d5:91:33:88).

- **Core 3.3.11 / IDF 5.5.5 (env `spike`): fails.** Pairs (`authentication
  success`, link encrypted), then the sink closes A2DP ~100-300 ms later with
  `disc_rsn=0` (normal), every ~10 s. The speaker's two-tone chimes are that
  connect/disconnect loop, not our audio. Not the cause: SSP, stale bonds, a
  second source (a Mac mini *was* also holding ML301; removing it didn't fix
  this), missing SEP registration (internal SBC, no external codec).
- **Core 2.0.17 / IDF 4.4 (env `spike-core2`, same sketch): works.** Paired,
  `a2dp connected`, steady tone confirmed by ear, no drop for the rest of the
  watch.
- **Gotchas found:** the name match is case-sensitive (`"ML301"`, not
  `"ml301"`). Core 3.x releases Classic BT memory at boot unless the sketch
  defines `bool btClassicInUse(){return true;}` (core 2.x: `btInUse()`);
  without it `esp_bt_controller_init` fails `ESP_ERR_INVALID_STATE`. ESP32-A2DP
  defaults SSP **off**; spike turns it on.
- **Internal RAM cost of the BT stack, idle, no Wi-Fi:** ~85-88 KB (core 3:
  221 K → 133 K free; core 2: 237 K → 152 K). Playing on core 2: free
  136-141 K, minFree 128 K. Wi-Fi + web server not yet combined with it.
- `spike-a2dp/.pio/libdeps/spike/.../BluetoothA2DPSource.cpp` has a local
  `SPIKE ... disc_rsn` log line (diagnostic only; vanishes on lib reinstall).
  The spike also deletes all BT bonds at every boot (diagnostic).

**↳ 2026-11-22, later: ESP32-A2DP v1.8.12 on core 3.3.11 fails the same way**
(auth success, A2DP disconnected ~300 ms later). GitHub search (esp-idf,
arduino-esp32, ESP32-A2DP issues) found no matching report or fix. **Decided:
move the radio to core 2.0.17.** `env:radio-core2` added beside `env:radio`
in `platformio.ini`; first build is to list what breaks.

**↳ Module 6 first pass, `env:radio-core2` (core 2.0.17):** builds with one
change (`main.cpp`: `esp_psram.h`/`esp_psram_init` guarded to core 3; core 2
prints no reason). Flashed: boots, PSRAM 4 MB, LittleFS, SD, rejoins pifi.
Idle internal heap 193 K (core 3: 174 K); minFreeHeap under two streams 52.6 K.
Harness 6-par 0/130 fail. **Throughput NOT yet judged:** 12-par 5/130 fail,
1 MB range 2-17 KB/s, but ping showed 10 % loss to the box and **20 % to the
router**, i.e. a bad link (same trap as Module 4). Re-measure on a clean link
before comparing with core 3's 220 KB/s. `apIp` reads 192.168.4.1 after
joining (core 3: 0.0.0.0); probably `softAPIP()` returning the default with
the AP off on core 2, unconfirmed. Board is on radio-core2 now.

**Decision for him (Module 6 hinges on it), now settled as above:** the radio firmware is on
pioarduino core 3.x because ESPAsyncWebServer 3.x targets it. Either move the
radio to core 2.0.17 (older AsyncTCP/ESPAsyncWebServer, re-verify Modules 0-4),
or keep core 3 and chase the IDF 5.5 A2DP-source drop (try ESP32-A2DP v1.8.12,
then IDF bluedroid A2DP trace logs / upstream issue). Board has the radio
firmware back on it as of this entry (verified: joined pifi, page 200).
- **Trap:** `spike-core2` (espressif32 @ 6.9.0) and `radio` (pioarduino) share
  the `framework-arduinoespressif32` package name, so building one replaces
  the other's framework (~35 min download for 2.0.17 here; the `radio` build
  first failed with a `NoneType` path TypeError until it reinstalled 3.3.11).
  Expect that cost whenever you switch between them.

## 2026-11-22: Module 4 CLOSED, no firmware change needed

Link re-checked on pifi (box 192.168.0.38): ping 0 % loss to router and box,
rssi -60. First-load harness, 13 resources per round: **260 requests (6 and 12
parallel), 0 failures, 0 slower than 3 s.** So the earlier failures were the
degraded Wi-Fi link, not the firmware; the 9-script/CSS merge is **not** done
and not needed. Single 1 MB range: ~220 KB/s.

1-hour stream test (two 256 KB Range loops on `Currency.wav`, status polled
each minute, 60 samples): **0 failed requests**, lowest freeHeap 129,372,
largestFreeBlock flat at 73,716, minFreeHeap 54,088 (no downward trend),
rssi -60 to -71. Budget for Bluetooth: ~54 KB internal RAM low-water mark
under streaming. Next: Module 5 (A2DP spike), which asks for the speaker's
name before flashing.

### Earlier notes on Module 4 (superseded by the above)

Working through the "Bluetooth output integration brief" (modules 4-10). Only
Module 4 has started; no firmware or page change made yet in it.

**First-load lost responses: reproduced, cause not yet found.**
- Harness: `<scratchpad>/firstload.py HOST ITER PARALLEL` fetches the page's
  13 resources (11 static + /api/status + /api/sd), each on a fresh
  connection, PARALLEL at a time. Re-create it if the scratchpad is gone.
- First run, quiet box: 20 x 13 at 6 parallel, **0 failures**, 1 slow (>3 s).
- Browser loop (12 parallel no-store fetches, rounds 300 ms-12 s apart)
  plus the harness at once: requests time out at 8 s, `Failed to fetch` on
  `wavconvert.js` after 13.9 s. **minFreeHeap fell to 39,460 and
  largestFreeBlock to 40,948** (idle normally 174 K / 110 K), so heavy
  parallel load does cut deep into internal RAM even with PSRAM on.
- After that, and **even after a serial reset**: failures at 1 parallel
  (timeouts, `IncompleteRead`), 4-7 s per small file.
- **Ping to the box: 7.5 % loss, 5-96 ms; router 0 % loss.** RSSI -51, ch 1.
  `WiFi.setSleep(false)` is already applied after every `begin()`, so it is
  not modem sleep. Leading suspicion: the link itself was degraded during
  the test (or another client was streaming), which makes this run's numbers
  unreliable. Interrupted mid-check of single-connection throughput.
- Every response is `Connection: close`, so a page load is 13 TCP
  handshakes; lwIP limits are MAX_ACTIVE_TCP 16, ACCEPTMBOX 6, TCP_MSL 60 s.

**Next, in order:**
1. Re-check the link when quiet (ping loss, 1 MB range throughput). Only
   trust failure counts from a link with ~0 % ping loss.
2. If failures persist on a clean link: bundle the 9 scripts + CSS into one
   file each (cuts a cold load from 13 connections to ~5), and/or add
   keep-alive; re-run the harness at 6 and 12 parallel.
3. Then the 1-hour streaming log (minFreeHeap/largestFreeBlock each minute)
   on the fixed firmware, HANDOFF entry, commit.
4. Module 5 (A2DP spike) stops to ask for the speaker's name before flashing.

## 2026-11-21: PSRAM on (Module 3)

`-D BOARD_HAS_PSRAM` in `platformio.ini` brings up **4 MB of PSRAM** (4,194,304
bytes, 4,128,756 largest block). The rev v1.0 cache workaround
(`-mfix-esp32-psram-cache-issue`, MEMW) was already on the compile line from the
framework, confirmed with `pio run -v`; nothing else was needed. `/api/status`
adds `psramSize`, `freePsram`, `largestFreePsramBlock`; the boot line prints
them, or the `esp_psram_init` error if none is found.

Same method as the Module 0 baseline (idle x3, then two 256 KB Range loops on
`Currency.wav` for 60 s). Internal RAM, bytes:

| | Module 0 (no PSRAM) | Module 3 (PSRAM) |
|---|---|---|
| Boot: free / largest / min | 260,752 / 110,580 / 228,552 | 256,080 / 110,580 / 223,872 |
| Idle: freeHeap | 144,024 | 174,204 |
| Idle: largestFreeBlock | 94,196 | 110,580 |
| During streams: freeHeap | 79,196 | 143,596 |
| During streams: largestFreeBlock | 38,900 | 102,388 |
| **minFreeHeap after streams** | **60,156** | **119,104** |
| Stream throughput (2 connections) | 213 KB/s, 50 x 206 | 256 KB/s, 60 x 206 |
| PSRAM free idle / during streams | - | 4,157,904 / 4,124,104 |
| firmware.bin | 1,156,544 | 1,170,528 |

Why internal RAM went up: `CONFIG_SPIRAM_USE_MALLOC` with
`SPIRAM_MALLOC_ALWAYSINTERNAL=4096` sends any `malloc` over 4 KB to PSRAM, so
the 16 KB SD read blocks and the web server's larger buffers moved out. The
throughput difference is within the 10x run-to-run swing noted above, not a
claim. **Watch for:** anything doing DMA from a buffer over 4 KB now gets a
PSRAM buffer, which DMA cannot reach; the SPI driver copies through internal
RAM so SD reads still work (measured above), but an I2S or Bluetooth buffer
should be allocated with `MALLOC_CAP_INTERNAL | MALLOC_CAP_DMA` explicitly.
- **firmware.bin 1,156,544 bytes** of a 1,966,080-byte app0 (58.8 %).
- **`reset reason 7` after a serial reset is not a fault.** Pulsing RTS gives
  `POWERON_RESET` then `RTCWDT_RTC_RESET` on this board's reset circuit, every
  time; a power-on boot reports 1.

## 2026-11-21: v1 plays from an SD card (read this first; older sections below predate it)

**The premise changed.** The box no longer streams the catalogue from Supabase
to the phone. Songs live on a micro SD card in the box, and the phone plays them
straight off it (`GET /sd/<name>`, with Range support, which iOS requires). The
Supabase track list and "Refresh from the band library" button are gone from
the page. The playlist API still exists but the page no longer uses it.

- **Wiring (VSPI):** CS=5, MOSI=23, MISO=19, SCK=18, at 10 MHz (`cfg::SD_*`).
- **Songs go in `/music` on the card.** Only names that pass `track_name.cpp`
  unchanged are listed or served, which also hides macOS `._*` files.
- **Getting songs on (v1):** `tools/song-prep.html` in Chrome or Edge. Pick the
  card, pick songs, name each one; 24/32-bit and float WAVs become 16-bit with
  dither (same sample rate), other files are copied. Shares
  `data/wavconvert.js` with the box's page, so naming and conversion rules
  cannot drift.
  - **↳ 2026-11-21 (Module 1): song-prep's default is now "WAV 44.1 kHz
    16-bit stereo"** (`wav44`). Any file the browser can decode (WAV, MP3,
    M4A, AAC, Ogg) is resampled by `decodeAudioData` on a 44.1 kHz
    `OfflineAudioContext`, mixed to stereo by Web Audio's rules (mono becomes
    L=R), and dithered to 16-bit; a WAV already in that shape is copied. That
    is the A2DP shape, so the box will never need a decoder or resampler. It
    decodes the whole song in memory (~150 MB for 7 min), so it is for
    song-prep on a computer; the box's own upload stays `wav16`. AAC is still
    offered, labelled "browser playback only". Checked in Chrome:
    `JupiterGold 4-26-26.wav` (48 kHz 24-bit, 307.200 s) became a 54,190,120 B
    PCM 44100/16/2 WAV of 307.200 s in 0.6 s; a mono 48 kHz sine came out L=R
    within dither at the same level. Tests: `node test/wavconvert.test.js`.
- **Wi-Fi:** joined to "pifi" at 192.168.0.38, `lakehorseradio.local`.
  `src/wifi_defaults.h` (gitignored, template `wifi_defaults.example.h`) can
  bake credentials into a build; applied once per change of the file.
- **A wedged SD card needs a power cycle, not a reset.** Resetting the ESP32
  mid-write left the card failing `CMD0` until USB was unplugged. Opening the
  serial port resets the board, so never open it during a card write.

**↳ Superseded 2026-11-21 (later the same day): WAV streams fine.** The slow
figures below were partly two sessions testing at once; one connection gives
222-250 KB/s and `wavstream.js` plays WAV over two. AAC is no longer the
default anywhere; see the song-prep note above.

**Streaming speed: solved by sending AAC, not WAV.** The box sends songs at
25-46 KB/s sustained (five one-minute runs from a Mac on the same Wi-Fi; even
from RAM it never beat ~85 KB/s), and a 16-bit WAV plays at 176-192 KB/s, so
WAV stutters however it is buffered. This is why other ESP32 audio projects
stream MP3/AAC. `tools/song-prep.html` now encodes WAVs to **AAC 160 kbps
(20 KB/s)** by default with Chrome's built-in WebCodecs encoder, written as a
plain ADTS `.aac` file (no library). 16-bit WAV is still offered.
- **Pre-buffer** (`data/buffering.js`): holds playback for 8 s of audio,
  doubles the cushion after each stall up to 64 s. Simulated at 36 KB/s with a
  real song: started in 6 s, played 78 s with no stall, cushion grew to 40 s.
- **Kept:** 16 KB read-ahead per stream (card streaming went from 25-36 to
  36-46 KB/s), Nagle off for song responses.
- **Tried and reverted, do not retry blindly:** larger lwIP TCP buffers via
  `custom_sdkconfig` (no gain, and it rebuilds ESP-IDF in ~20 min, needs the
  build dir and project path free of spaces, and overwrites the shared
  framework libs until removed); `ASYNCWEBSERVER_USE_CHUNK_INFLIGHT=0` (no
  measurable gain). The Mac downloads from the internet at 1.3 MB/s on the
  same Wi-Fi, so the ceiling is the ESP32's own send path on this network.
- Not yet heard on a phone.

**2026-11-21 later: WAVs now play over two connections, behind a player layer.**
- **Throughput, same method as above** (five one-minute `curl` runs of
  `Currency.wav`, one connection, Mac on pifi), firmware unchanged:
  **222-250 KB/s**. The 25-46 KB/s above, and 6-108 KB/s measured earlier this
  afternoon, were partly two sessions testing the same box at once, and partly
  the link: single runs swing 10x, so any A/B must be interleaved.
- **Firmware: nothing kept.** Tried and reverted, none beat the shipped code:
  - A blocking socket server on its own task and port: 135-287 KB/s against
    the async server's 180-290, interleaved. The async server is not the limit.
  - Widening one connection's lwIP `snd_buf` at run time (core lock, add to
    `pcb->snd_buf`) to get past the 5744-byte TCP_SND_BUF without rebuilding
    ESP-IDF: **harmful**, 6 KB/s and the heap stayed ~90 KB down. Do not retry.
  - `SD_SPI_HZ` left at 10 MHz: the card reads ~1 MB/s, four times the link.
  - Per-second serial telemetry showed 250-295 KB/s with an occasional 1 s gap
    at zero, RSSI -54 to -59.
- **Page: `data/wavstream.js`** (branch `radio-stream-speed`, merged): WAVs play
  through Web Audio from 256 KB Range chunks fetched two at a time; a third
  connection gets 503 from the box. Preloads the next song's opening.
- **Player layer** (`data/player.js`): the page's buttons (play/pause, next,
  seek, volume) only ever call this, and it hands each call to a backend.
  `player-browser.js` plays in the listener's browser (wavstream for WAV,
  `<audio>` + `buffering.js` for AAC and odd WAVs). `player-box.js` is the v2
  on-box backend, a stub that reports itself unavailable; when it is built,
  swapping it in is the `createPlayer` line in `library.js`. Volume is kept in
  localStorage. Tests: `node test/player.test.js`, `node test/wavstream.test.js`.
- **Measured in Chrome on the Mac, Mango Tree World.wav:**

  | | old `<audio>` page | new page |
  |---|---|---|
  | to first audio | ~14 s | ~3 s |
  | stalls | 19 s stall at 0:16 | none through a whole song |
  | seek | - | ~4.5 s to resume |
  | next song | wait again | starts on its own |

- **iPhone 8 (iOS 16, Safari and Chrome alike): "playing" but no sound** on
  b4c66ae. Most likely the ring/silent switch, which mutes Web Audio but not
  `<audio>`. Fixed blind (no Xcode on this Mac, so no simulator):
  - the `<audio>` element loops 0.1 s of silence while wavstream plays, which
    puts iOS in playback mode and un-mutes Web Audio
    (`navigator.audioSession` does this on iOS 17+ only);
  - one sample of silence is started on the context inside the tap (older
    iOS unlock);
  - if the context is still not running 2 s after the tap, the song plays
    through `<audio>` instead (checked on desktop by forcing the context to
    stay suspended: fell back and played).
  Confirmed on the iPhone 8: audible, starts quickly.
- **Player bar on a phone** is a fixed grid (title / buttons + time / seek /
  labelled volume); a wrapping row had put both sliders side by side. Row
  hover is mouse-only, since a phone kept the last tapped row highlighted.

**Built but off, for v2** (`src/config.h`):
- `SD_UPLOAD_ENABLED` — upload songs from the page. Works as a raw-body POST
  (`/api/sd/upload?name=`); the multipart form version dropped connections
  because the library parses multipart one byte at a time. ~220 KB/s.
- `SD_WRITES_NEED_KEY` — pairing key for upload/delete.

**v2 list, as agreed:** page upload (above), pairing key (above), Bluetooth
A2DP output from the box to a speaker with the page as the remote. Bluetooth
reverses the "never plays audio itself" premise: decoding on the ESP32, Wi-Fi
and BT sharing one radio, and the app partition (1.875 MB) is likely too small
once the BT stack is in. Plan it before building it.
- **↳ 2026-11-21: app0 is now 3.375 MB** (LittleFS 512 KB at 0x370000); see
  `partitions.csv`. Firmware is 1.13 MB of it, so ~2.3 MB is free for BT.

## What this is

An ESP32 in the barn that serves a web player. **It never plays audio itself** —
whoever opens its page streams the mixes from Supabase on their own phone. That
is why it needs no codec, no DAC, no PSRAM and no TLS stack.

## Where things stand

**The Wi-Fi bug is fixed and confirmed on hardware.** Every prior attempt ended in
`Reason: 204 - HANDSHAKE_TIMEOUT`, forever. The cause: `wifi_manager.cpp` raised
the SoftAP first, with no channel argument, which pinned the ESP32's one radio to
channel 1 before the station ever got a turn. The fix, copied from WLED rather
than reinvented: station-first, hotspot only as a fallback, with an explicit AP
channel so it can never silently claim one the station needs.

Confirmed on this box's actual boot log, 2026-09-16:

```
[wifi] boot scan: "barnternet" is on channel 11, SoftAp channel is 1 -- mismatch
[wifi] trying saved network "barnternet"
[wifi] joined "barnternet" as 192.168.2.39
```

The diagnosis was correct — 11 vs 1 — and the box now joins from cold with no
access point raised at all. `/api/status` and `/api/scan` report both channels
(`apChannel`, `stationChannel`, and per-network `channel`) so this is never
invisible again; `data/app.js` shows them in the setup page too.

## What changed this session

- `src/wifi_manager.{h,cpp}` — rewritten station-first with AP fallback, WLED's
  exact reset sequence (`WiFi.disconnect` → `WIFI_MODE_NULL` → hostname while
  still in NULL → explicit `softAPdisconnect` → `WIFI_STA`), an explicit AP
  channel and subnet, the boot-time channel diagnostic above, and SSID/password
  bounds validation in `provision()` (802.11/WPA2 limits) before anything
  touches NVS or the radio.
- `src/captive_portal.{h,cpp}` — **real regression found and fixed.** Wi-Fi being
  station-first means the access point may not exist yet when `portal::begin()`
  used to run, so `DNSServer` was binding to `0.0.0.0` and never revisiting it.
  It now watches `wifinet::isAccessPointActive()` and restarts DNS against the
  live address on every up/down transition — this is what makes the gig
  fallback case (no saved network in range) actually show a setup sheet.
- `src/web_server.cpp`, `data/app.js` — channel reporting, described above.
- **Improv Wi-Fi Serial was implemented, then removed.** A prior pass in this
  session hand-ported WLED's `improv.cpp` for USB provisioning via ESP Web
  Tools. That was reinventing a solved problem — Improv is a published
  standard, and more importantly the premise (USB setup avoids the channel
  conflict) is moot now that station-first fixes the conflict directly. ESP
  Web Tools stays as the browser flasher (`../flasher.html`, `improv: false`
  in its manifest); Wi-Fi setup goes through the existing hotspot setup page.
  If USB provisioning is wanted later, `jnthas/Improv-WiFi-Library` (MIT, in
  the PlatformIO registry) is the off-the-shelf option, not a hand-port.

## Verified so far, on this hardware

1. **Channel-mismatch diagnosis proven** — boot log above.
2. **Cold boot joins station-first**, no AP raised.
4. **mDNS resolves** both ways (`ping`, `curl`) once joined.
7. **Flashed clean via `esptool` CLI** at 115200; `flasher.html` loads, manifest
   parses, no console errors, copy matches the new hotspot-only setup story.

## Not yet verified — needs a decision, not more code

3. **AP torn down on connect** — not exercised this boot, because the AP was
   never raised (the station joined before the fallback timer could fire). The
   logic is symmetric with the raise path and code-reviewed, but unseen live.
5. **Gig case**: no saved network in range → AP comes up → **setup sheet
   actually pops up** (the captive-portal fix above). Testing this for real
   means temporarily forgetting the saved network via the setup page's
   "forget" path, which would need the barnternet password re-entered
   afterwards — not done without asking first.
6. **Audio actually plays** from a phone on barnternet — needs a physical
   phone, not just this Mac.

## Build and flash

```bash
PIO=/Volumes/STUDIOBUNJ/studiobunj/.venvs/pio/bin/pio      # PlatformIO 6.1.19
ESP=/Volumes/STUDIOBUNJ/studiobunj/.venvs/esp/bin/esptool  # esptool 5.4.0

$PIO run -e radio              # compile
$PIO run -e radio -t buildfs   # data/ -> littlefs.bin
$PIO test -e native            # 19/19 must pass, no board needed
python3 tools/make_release.py  # -> ../firmware/lakehorse-radio/ + manifest.json

cd ../firmware/lakehorse-radio
$ESP -p /dev/cu.usbserial-0001 -b 115200 --before default-reset --after hard-reset \
  write-flash --flash-mode dio --flash-freq 40m --flash-size 4MB \
  0x1000 bootloader.bin 0x8000 partitions.bin 0xe000 boot_app0.bin \
  0x10000 firmware.bin 0x370000 littlefs.bin   # 0x1f0000 before 2026-11-21
```

Read the boot log (bounded, unlike `pio device monitor`, which never returns):

```bash
/Volumes/STUDIOBUNJ/studiobunj/.venvs/esp/bin/python <scratchpad>/monitor.py \
  /dev/cu.usbserial-0001 30 --reset
```

If that script is gone it is ~20 lines of pyserial: open at 115200, optionally
pulse DTR/RTS to reset, read for N seconds, print. pyserial lives in the esptool
venv.

## Things that will bite you

- **Upload at 115200, not faster.** A flash read at 460800 on this board and
  cable failed with `Invalid head of packet (0xFF)`. 115200 is clean.
- **The LittleFS offset is never typed twice.** `tools/make_release.py` parses it
  out of `partitions.csv` into `manifest.json`, and both flashers read the
  manifest. It is `0x370000` (it was `0x1f0000` until the 2026-11-21
  repartition; a box still on the old table needs all five images flashed,
  not just the app).
- **`board = esp32dev`, not `esp-wrover-kit`.** The wrover-kit board file
  declares FTDI hwids and this board is a CP2102.
- **PSRAM is deliberately off.** Nothing here needs it.
  - **↳ 2026-11-21: on now**, 4 MB, for the Bluetooth work; see "PSRAM on
    (Module 3)" at the top.
- **The data partition is labelled `spiffs` though it holds LittleFS.**
  `LittleFS.begin()` looks for that label by default.
- **`pio test` needs `test_build_src = yes`** or the sources never compile into
  the test and it fails to link rather than fails to pass.
- **`WiFi.disconnect()` at the very first `resetRadio()` call of a cold boot
  logs `[E][STA.cpp:540] disconnect(): STA disconnect failed! 0x3001:
  ESP_ERR_WIFI_NOT_INIT`.** Framework noise, not ours — the driver genuinely
  isn't initialised yet on that first call. WLED's own `initConnection()` calls
  `WiFi.disconnect(true)` unconditionally at the same point and has the same
  cosmetic line. Harmless; left alone rather than special-cased.
- **macOS has no `timeout`.** A command prefixed with it silently does not run,
  which reads as "no results found".
- **Wi-Fi scanning on this Mac is gated by Location Services**, so
  `system_profiler SPAirPortDataType` returns no network list.

## State

- **Repo root is `esp music v1/`, not `lakehorse-radio/`** — this firmware is a
  subdirectory of the band site's own repo, on branch `lakehorse-radio`, same
  push/commit rules as that project's `CLAUDE.md` (commits named `CR-120: ...`,
  push is Claude's, confirm on the live target rather than trusting git).
- Board: ESP32-D0WDQ6 rev v1.0, 4 MB, MAC `24:62:ab:e2:18:90`.
- **Original flash backed up** at `/Volumes/STUDIOBUNJ/studiobunj/esp32-backup/`,
  `sha256 326805f95a2460bd52cb1483f107a51453549e4ac6d14a281aa5f2faaec7754a`.
- Pairing key on this box: `c437e5fbad3f8042` (survives reflash, lives in NVS).
- Currently joined to barnternet at `192.168.2.39`, channel 11, with the fix
  flashed and running.
- **Not pushed.** Waiting on the fallback-case test decision above before
  pushing — "the push is Claude's" per the repo rule, but the live check for
  firmware is the board, not a website, and items 3/5/6 haven't been seen yet.
- **Stale as of 2026-09-18: two more features landed on this branch since the
  above was written, and neither is reflected here.** `b1dafb3` (release-level
  radio track selection) and `2de64d5` (this file's counterpart for that
  feature). Full state — 7 commits ahead of `origin/main`, clean fast-forward,
  `supabase/schema-v40.sql` applied and verified live, one known display-only
  gap (`lakehorse-radio/data/app.js` still calls `game_tracks` where
  `flasher.html` calls `radio_tracks`) — is in
  `../docs/lakehorse-radio-integration-handoff.md`, not duplicated here.
  **Still not pushed.** `git push -u origin lakehorse-radio` is the single
  outstanding action; nothing else blocks it.

## Shell Module 1: page weight and caching (2026-11-22)

**Status: code done and tested off the board. Not flashed, not compiled for the
firmware, not measured after the change.** Two things need the Mac before this
counts as passed (below).

**Findings before writing code.** ESPAsyncWebServer 3.12.1 (read from
`.pio/libdeps/radio-core2`, plus the project docs at esp32async.github.io) does
handle gzip siblings. `serveStatic` looks for `NAME.gz` before `NAME`
(`setTryGzipFirst` defaults to true), sends `Content-Encoding: gzip`, takes the
Content-Type from the name without `.gz`, and builds the ETag from the CRC in
the gzip trailer. It answers `If-None-Match` with a 304. With no cache setting
it sends `Cache-Control: no-cache`, so today every load revalidates every file
(measured: all 304 in 0.13 to 0.57 s each), which costs a request per file even
when nothing changed. The docs show `setCacheControl` and `setFilter` chained on
`serveStatic` with LittleFS. One catch: it serves the gzip bytes to every client
whether or not the client sent `Accept-Encoding`, which is fine for browsers.
`playlist.json` must stay plain because `playlist_store.cpp` reads and writes it
by that name, so the build skips it.

**What changed**
- `tools/gzip_data.py` (new, a PlatformIO `pre:` script): stages a copy of
  `data/` under `.pio/build/<env>/data-gz/`, gzips html, js, css and json files
  (skipping `playlist.json` and any file where gzip would not be smaller), adds
  `?v=<hash of that file>` to the local script and stylesheet references in
  `index.html`, and points `PROJECT_DATA_DIR` at the copy so `buildfs` and
  `uploadfs` build from it. `data/` is never modified, so the JS tests and the
  plain files stay as they were. Output is byte-identical between runs.
- `platformio.ini`: `extra_scripts = pre:tools/gzip_data.py` in `env:radio` and
  `env:radio-core2` only.
- `src/web_server.cpp`: two `serveStatic` handlers instead of one. The first
  answers `/` and `/index.html` only (filter `isPageRoot`) with
  `Cache-Control: no-cache`, so a repeat visit costs one small 304. The second
  answers everything else with `public, max-age=604800, immutable`, which is
  safe because the hashed URLs change whenever a file does. The query string is
  ignored by the file lookup. Nothing under `/api/*`, `/sd/*` or the captive
  portal was touched.
- `tools/pageload.py` (new): read-only timer that fetches the page the way a
  browser would, prints bytes, wall time, gzip, Cache-Control and ETag per file,
  then checks the repeat visit. Usage: `python3 tools/pageload.py HOST 5`.
- `test/gzip_data.test.py` (new, 14 tests): file selection, deterministic gzip,
  reference versioning, staging, stale cleanup, refusal to wipe a folder it did
  not make. Run with `python3 test/gzip_data.test.py`.

**Measured, Bluetooth on** (box at 192.168.0.38, ML301 connected, paused, read
from a Linux VM on the Mac over Wi-Fi, before any change): `data/` is 110,089
bytes, and the page fetches 12 files, 108,946 bytes. Per file about 0.17 s for
a tiny file up to 0.5 s for the largest (20 KB), with an occasional 2 s stall.
Full first load, 6 connections at a time: 2.9 to 5.0 s over 5 rounds, median
3.6 s. Fetching in parallel was no faster than one at a time, so the box
answers requests one by one and per-request overhead is a large share of the
time. After gzip the page is 38,826 bytes (the image as a whole 39,489),
about 35 percent of the original.

**Expected, not measured:** 12 requests at about 0.17 s each plus 39 KB at
roughly 60 KB/s puts a first load near 2.5 to 3 s, so the under-3-seconds
target is likely but close. Repeat loads should make one request (index.html,
304) and take the other 11 files from the browser cache.

**Unverified, needs the Mac**
1. Build and flash: `pio run -e radio-core2 -t buildfs`, check the staging
   line `gzip_data: 13 files, 109730 bytes -> 39489 bytes` appears, then flash
   the littlefs image to `0x370000` and the new firmware (the cache handlers are
   in firmware, so both are needed). The hook was proven in a scratch native
   project (script runs, `PROJECT_DATA_DIR` is replaced) but the real
   `espressif32` buildfs step and the firmware compile could not be run in the
   sandbox (the toolchain download was blocked).
2. Measure: `python3 tools/pageload.py <box ip> 5` with Bluetooth on, then
   again with it off, and open the page twice in a real browser (the second
   load should show index.html 304 and the rest from cache). Also check the
   page on the iPhone 8 and that `/api/status`, pairing and the captive portal
   still load. If Bluetooth-on first load is over 3 s, the next lever is fewer
   requests (bundle the scripts in the build step), not smaller files.

**Next step:** flash and measure as above. Only then start Module 2. The shell
will add fonts; subfolders in `data/` are copied through untouched, and
`woff2` is already excluded from compression, but fonts referenced from CSS
will need the same `?v=` treatment or a plain `no-cache` policy.

### Module 1 verified on the board (2026-11-22, later): NOT yet at the 3 s target

**Status: flashed (firmware + LittleFS), page/pairing/playback work, first load
is 3.0-3.2 s median, so the under-3-seconds pass is missed by a hair.** Next lever
(waiting on the owner's answer): bundle the scripts into one file at build time.

**A real bug found on hardware, and a stopgap.** First flash of the helper's code
served `index.html` and `style.css` as a 200 with an EMPTY body (about 5 of 6
tries). Raw socket dump: the blank line that ends the headers arrived as
`00 00`. It tracks header-block length: 202 and 226 bytes (2 past a multiple of
4) fail; 112, 209, 233 (and 216, 241, 248, 224 now) are fine. Likely cause: the
unaligned copy of the body onto the header inside the PSRAM-backed lwIP buffer on
the rev v1.0 chip (same family as the earlier "zero byte past a handle" heap
corruption). Stopgap in `web_server.cpp`: `kPageRootCache` / `kPageAssetCache`
are padded (", no-transform", max-age 6048000) so every current file lands on a
good length. **Fragile:** a new file type, or a file with a different number of
size digits (fonts!), can land on a bad length. After ANY change that touches
headers or the file set, run `python3 tools/pageload.py <ip> 3` (now fails loudly on
a short or empty body). A proper fix is open: pad per response with a custom
handler, or move the lwIP segment buffers out of PSRAM.
Lengths 3 mod 4 are untested.

**Measured** (Mac over Wi-Fi, 12 files, 38,826 bytes on the wire, was 108,946):
- Bluetooth on: 3.22 s median (3.08 best, 8.63 worst, one stall), 5 rounds.
- Bluetooth off: 3.01 s median (2.46 best), so bandwidth is not the limit; each
  request costs about 0.25 s and the box answers one at a time.
- Baseline (helper, BT on): 3.6 s median, 108,946 bytes. Gain is about 0.4 s.
- Repeat visit: `/` answers 304 in about 0.55 s; the 11 files carry max-age and
  are skipped. iPhone 8 reload test pending.
- Playback to ML301 after the change: 6 s played, 0 underruns. Bluetooth left ON.

**pageload.py** now gunzips index.html, flags short bodies, prints median.

### Module 1 closed: scripts bundled, first load 1.0 s (2026-11-22)

`tools/gzip_data.py` now joins the ten local scripts into one `bundle.js` at
build time (page order, `\n;\n` between files; `bundle_scripts()`, 20 tests).
The image holds 4 files: index.html.gz, bundle.js.gz (29,461 bytes), style.css.gz,
playlist.json. `data/` is untouched, so the JS tests still load the separate files.

**Measured, Bluetooth on, 7 rounds:** 3 requests, 34,005 bytes, median **1.02 s**
(best 0.76, worst 3.50 once), 0 failed or short bodies. Was 3.22 s with 12
requests. Page loaded in the in-app browser: no console errors, speaker panel
shows ML301, 4 tracks listed. Firmware unchanged since the padding fix; only the
LittleFS image was reflashed.

**Caveats:** one script error now stops every script after it in the bundle.
bundle.js has a 5-digit Content-Length, header 249 bytes (1 past a multiple of 4,
a good length); recheck with `tools/pageload.py` if the headers or file set
change (see the header-length bug above). iPhone 8 not timed by the owner (nothing
visible to compare); Module 1 is accepted on the Mac numbers. Module 2 not started.

## Shell Module 2: frame engine and endpoint (2026-11-22)

**Status: native tests green (24), firmware flashed (`env:radio-core2`, firmware only, LittleFS untouched) and `/api/matrix` verified on the board. Playback with the page polling also checked (below).**

**Built**
- `src/matrix_engine.{h,cpp}`: pure engine, no Arduino. A frame is 64 hex chars (`0` dark to `f` full, row by row from top left), intensity only; colour and brightness belong to whoever draws it. `render(nowMs)` is a pure function of mode, inputs and the clock, so there is no task, timer or heap. Modes: off, bars, title (3x5 font, A-Z 0-9 and `.,!?-:'/+&()_`, scrolls in from the right), dazzle (2x2 camo blotches drifting left), clock (phone time, hours then minutes every 3 s, hours marker top right, seconds bar on the bottom row), image (64 hex chars).
- **Audio reactivity** (added at the owner's request): `feedBands(8 levels 0..8)` is a general input, fresh for 1 s. Bars draws it; Dazzle lifts every tone by up to 4 steps with the mean level. With nothing fed, Bars runs its own test pattern and Dazzle runs unboosted. Nothing feeds it yet; Module 6 does.
- `src/matrix_api.{h,cpp}`: `GET /api/matrix` gives `{ok, mode, title, frame}`. `POST /api/matrix` takes any of `mode`, `title`, `h`+`m`+`s`, `image`, validates all of it first, applies none on a 400. Wired in `web_server.cpp` beside the speaker API.
- `test/test_matrix/` (24 tests: every mode renders only hex, scroll start/loop, clock wrap at midnight and millis wrap on the freshness check, stale audio falls back, bad input leaves state alone, all font glyphs distinct). Run `pio test -e native -f test_matrix`. `platformio.ini` native filter gained `matrix_engine.cpp`.

**Cost:** 232 bytes of static RAM (`.bss`, internal, none from the heap), about 3 KB of flash for the engine. The API adds about 8 KB of flash. Heap per request is one small JSON document (about 200 bytes), freed after the reply.

**On the board (2026-11-22):** GET and POST work; dazzle, title and bars frames returned real pixels; `h=25` rejected with 400 and state unchanged. 56 polls in 20 s (about 2.8/s) with no errors. Free heap: 55,284 right after boot, 45.5k steady after polling (min 44.2k), stable over repeated reads, so no leak seen. That is with Bluetooth on and searching, not connected; the 40,124 figure before the flash was a long-running box, so the two are not a like-for-like cost comparison. The engine itself takes no heap.

**Playback check (ML301 connected):** Mango Tree World played 30 s to ML301 while `/api/matrix` (dazzle) was polled 63 times at about 2 per second: 0 failed polls, 0 underruns, no player error. Free heap while playing 38.4k (min 34,972); the same song with NO matrix polling reads 37.0 to 38.4k, so the matrix costs nothing measurable and the lower figure is playback itself on this firmware (the 50.8 KB in the plan was an older reading). Paused and matrix set to Off afterwards. Bluetooth left on.

**Still to do on the board (was: Not done):** flash, then `curl http://<ip>/api/matrix`, `curl -X POST 'http://<ip>/api/matrix?mode=dazzle'`, check `/api/status` free heap before and after, and confirm playback still has 0 underruns with the page polling at about 4 per second. The `pageload.py` header-length trap (Module 1) applies to any new file type served; this adds JSON API replies only, not static files.

**Next: Module 3**, the virtual matrix window. It needs one decision: colour palette and brightness live in the page.

## Shell Module 3: virtual matrix window (2026-11-22)

**Status: flashed (page image only, 4 files, 38,584 bytes; firmware unchanged) and verified in the in-app browser at 192.168.0.38. NOT yet checked on the iPhone 8.**

**Verified on the board:** `pageload.py` 5 rounds: 3 files, 37,921 bytes, median 0.52 s, 0 failed or short bodies (header-length trap clear). Fresh load with the window closed: 0 requests to `/api/matrix`. Opened: about 2.7 per second, all 200. Dazzle, Title (LAKEHORSE) and Clock each switched through the buttons and the box reported the matching mode and lit pixels; the buttons follow the box's mode. Full view fills the viewport (519 px canvas) and a tap exits. At 375 px wide: canvas 313 px, no horizontal scroll. The console shows 4 `ERR_CONNECTION_TIMED_OUT` lines of unidentified origin (no request to any host but the box appears in resource timing, so probably left over from earlier page loads in that tab); not chased. Matrix left Off.

**Built**
- `data/matrix-window.js` (new): the window. Pure helpers (`parseFrame`, `nextDelay`, `lightAlpha`, `titleFor`, `clockQuery`, `modeRequest`) plus `attach`. Wires itself on load when `#matrixOpen` exists.
- `data/index.html`: a small preview button under the player (the way in, painted from the last frame, never fetches) and the window itself (8x8 canvas, Off/Bars/Title/Dazzle/Clock buttons, brightness slider, Full view, Close). Script added after `speaker-panel.js`, so the build bundles it.
- `data/style.css`: preview, window and the full-view overlay (CSS overlay plus the Fullscreen API where it exists; iPhone Safari has none for ordinary elements).
- `test/matrix-window.test.js` (node): helpers, plus the loop with fakes: no request while closed, one in flight, next poll only after the reply, doubling when slow or failing, stops when hidden, resumes when shown, POSTs carry the playing title and the phone's time, brightness saved, full view toggles.

**Decisions**
- Opens from the preview button only. "Start > Matrix lights" does not exist until Module 4 (the shell); it will call the same `open()`.
- Brightness is the page's own (the frame carries intensity only); it is not sent to the box.
- Image mode has no button yet (needs a picture source); the endpoint supports it.
- Title mode sends the playing track's name, or LAKEHORSE; Clock sends the phone's time when chosen.
- Bars show the demo pattern until Module 6; the window says so.

**Still to do for the Module 3 pass:** flash the image; `python3 tools/pageload.py 192.168.0.38 5` (header-length trap from Module 1 applies: page is now 4 files, bundle.js.gz 32,660 bytes); open the page in a browser, open the window, switch modes, try Full view; confirm in the box's request log or by `pageload`/network panel that nothing hits `/api/matrix` while the window is closed; check on the iPhone 8 (iOS 16: uses aspect-ratio, inset, canvas arc).

## Shell Module 4: shell reskin (2026-11-22)

**Status: built, checked in the in-app browser, and FLASHED (page image only, 43,163 bytes, was 38,649; firmware unchanged). Verified live at 192.168.0.38: `pageload.py` median 0.50 s, 0 failed or short bodies; shell loads, Start menu opens the matrix window, taskbar follows, 0 matrix requests while it is closed, no script errors. iPhone 8 checked by the owner on 2026-11-22 ("iphone tests are good"), which closes the iPhone 8 pass for Modules 3 and 4. The captive-portal sheet (iPhone and Android) is still untested.**

**Built**
- `data/index.html` restructured: every element id kept (checked against the old file; none lost), now inside `.win` windows: PLAYER.EXE (banner, player bar, play-on select, matrix preview, SD list and upload; opens first), SPEAKER.EXE, NETWORK.EXE, MATRIX.EXE (the Module 3 window as a frame). Desktop icons, a Start menu (Player, Network, Speaker, Matrix lights) and a taskbar with START, a button per open window, and a clock. The old header and tagline are gone.
- `data/shell.js` (new): a window is any `.win` element, open unless `hidden`; the taskbar watches that attribute, so a script that opens its own window (the matrix window) needs no call into the shell. Windows that do work on open name `data-opener` / `data-closer` handles (the matrix window starts and stops polling through them). `app.js` calls `LakehorseShell.onStatus(status)` with the reply it already fetches, so the shell makes no request of its own.
- **First run:** with `hasSavedNetwork === false` the Start menu opens, Network is orange ("needs setup"), the callout shows, the tray says NO WI-FI, and the Network window opens. An unreadable status reply is not a first run.
- `data/style.css`: ENIAS palette (ink #0c0e0d, bone #e9e5d6, panel #3b3d39, orange #ff6b2c, teal #5fd0b0), bevelled windows and buttons, system monospace. Windows stack full width at 700 px and under, and sit side by side above it (dragging is not built). Matrix lights are now orange.
- Windows with nothing to show say why (CSS sibling rule): Speaker "built without Bluetooth", Network "setup is only offered on the box's own hotspot".
- `test/shell.test.js` (new). Existing node suites (player, player-box, speaker-panel, matrix-window) and `gzip_data.test.py` still pass.
- `tools/devserver.py` (new): serves `data/` unbundled and forwards `/api/` and `/sd/` to the box, so a page change can be previewed without flashing (POSTs really reach the box). Entry `radio-page` added to the workspace `.claude/launch.json`.

**Decisions**
- No webfonts: the box has no internet, and the page-weight budget from Module 1 stands. Titles use the system monospace; VT323 / IBM Plex Mono remain an open decision (measure the subset sizes first).
- Only working things get icons and menu items. The mockup's Drive B, Games, Links, README, Clock and alarm, Crew profiles and About are deferred and absent, not stubbed.
- Boot splash from the mockup not built (not in the plan).
- The wallpaper is the existing `dazzle.js` pattern, not the mockup's clip-path camo.

**Not yet done:** look at it on the iPhone 8 and the captive-portal sheet on an iPhone and an Android phone. Module 5 (Network and Speaker window contents) is next.

## Shell Module 5: Network and Speaker windows (2026-11-22)

**Status: built and checked in the in-app browser against the real box (via `tools/devserver.py`); page image builds (45,924 bytes, was 43,163). FLASHED 2026-11-22 (page image only; firmware unchanged); live check: `pageload.py` median 0.30 s, 0 failed or short bodies; shell, network list and Optimize box load with no script errors, taskbar shows PLAYER / SPEAKER / NETWORK, Optimize shows ticked (Bluetooth is off), no hidden buttons drawn, 0 matrix requests while closed. The join itself (POST /api/wifi) was NOT exercised: it would change the box's Wi-Fi.**

**Network window**
- `data/network-window.js` (new): scan results as tappable rows with signal bars, strongest first, duplicate names (several channels) merged, hidden networks dropped. The choice goes into a hidden `#ssid` input, which `app.js` `save()` already reads, so saving is unchanged. Also a Show password box, Cancel (clears choice, typed name, password, message) and a rescan that keeps the choice if the network is still there.
- `app.js` `loadScan` now hands results to that list instead of filling a `<select>`. The note "The box drops its own Wi-Fi while it joins. Reconnect your phone to your home Wi-Fi, then open <name>.local" sits under the buttons, with the real mDNS name from `/api/status`.
- **Bug fixed on the way:** the Rescan button passed its click event as `loadScan`'s `again` argument, so a rescan never reset the retry count. It now calls `loadScan()`.
- Not built: the mockup's "Add a backup network" (the firmware keeps one network).

**Speaker window**
- An "Optimize for this device" box in a SPEED group: ticked exactly when Bluetooth is off. Ticking or unticking does the existing Bluetooth switch with its existing confirm and restart (`/api/speaker/bluetooth?on=`); declining the confirm puts the box back to what the box says. Older markup without the box still works. No firmware change. The old Turn-Bluetooth button stays in the markup, hidden, because `speaker-panel.js` wires it.
- Existing controls restyled: status well, full-width speaker rows, Find and Connect buttons.

**Found in the browser, not by tests, and fixed:** (1) emptying the network list detached the note element, so the next lookup by id returned null and the first render threw. The test's fake page kept a map of elements and hid it; it now behaves like a real DOM and fails on the old code. (2) `.btn { display: ... }` beat the `hidden` attribute, so hidden buttons still drew (an empty box beside Find speakers, a stray Turn Bluetooth button; this existed in Module 4 too). Fixed with `.win [hidden] { display: none !important }`. (3) Taskbar labels clipped with three windows open on a 375 px phone; labels now drop ".EXE" and the taskbar is tighter.

**Tests:** new `test/network-window.test.js`; `test/speaker-panel.test.js` gained 5 (Optimize view, tick turns Bluetooth off, decline reverts, untick turns it on, old markup). All page suites and `gzip_data.test.py` pass.

**Bluetooth is OFF on the box** (`/api/speaker` `bluetooth:false`): the owner switched it off during phone testing (confirmed). Left as it was; the Speaker window correctly shows Optimize ticked. Turn it back on from the Speaker window to test Module 6 against the ML301.

**Still to do:** try the Network window on the phone while on the box's own hotspot (the only place the form shows) and the Optimize box on the phone. Module 6 (audio reactivity from samples) is next.

## Shell Module 6: audio reactivity from samples (2026-11-22)

**Built and flashed (firmware + page).** `src/band_levels.{h,cpp}` is an Arduino-free `bands::Meter`: eight Goertzel bins (60 Hz to 8 kHz, an octave apart, +3 dB per band tilt, Welch window, -72 to -18 dBFS mapped to 0..8), one result per 1024 output frames (about 23 ms), kept on a 128-hop timeline. The reader task feeds it the resampled output (`g_meter.feed` just before `ringPush`); `ringFlush` resets it. The reader runs up to 2 s ahead of the speaker, so levels are looked up at `g_played` (`boxplayer::bandsNow()`, lock-free, peak of the last 4 hops), not at read time. `/api/matrix` GET calls it and `matrix::feedBands`; so Bars draws real levels and Dazzle brightens, and with nothing playing Bars falls back to the demo pattern after 1 s. Levels are pre-volume. Memory is about 1.1 KB static internal RAM.

**Tests:** `test/test_bands` (12): silence, each band's centre tone peaks in its own band, louder reads higher and clamps at 8, DC does not light the high bands (bands 5+), chunk size makes no difference, hop boundaries, lookup refuses not-yet-analysed or overwritten frames, peak hold, reset, opposite-phase channels cancel, scale edges. All 102 native tests and all page suites pass. Page note under Bars reworded.

**Hardware check (ML301 connected, Mango Tree World 236 s then This Is War to 306 s, `/api/matrix` polled at about 4 per second):** 0 underruns, 0 failed polls, 555 distinct frames in 580 polls, bars move with the music. Free heap while playing about 37k. **minFreeHeap is 26,024 after a clean reboot** (was 34,972 in Module 3 with dazzle polled): it dropped once, when matrix polling began during playback, then stayed flat through 2 more minutes of polling, a seek and a track change. The meter is static, so I did not find the cause; an earlier run with the UI open and extra status polling reached 18,824. Worth a look before adding more to this path.

**Not done:** levels are only fed when something polls `/api/matrix`, which is right for the virtual window; the real matrix driver (Module 7) must call the same two functions at its own rate. Scale constants are reasoned, not tuned by ear; adjust `kFloorDb`/`kRangeDb`/`kTiltDbPerBand` in `band_levels.cpp` if the bars sit too high or low on your music. Playback stopped and matrix set to Off afterwards.

### Module 6b: phone-mode bars (2026-11-22, later)

**Built, tested in the local preview, page flashed to the box (pageload check clean, bundle 38.7 KB, repeat visit 304 in 0.21 s); not yet tried on a phone.** When the page itself plays the music, the box has no samples, so `data/band-meter.js` (page twin of `band_levels.cpp`, same scale) turns an `AnalyserNode` spectrum into 8 levels. `wavstream.js` now plays every source into a `bus` gain that feeds the volume gain and, in parallel, the analyser (tap is pre-volume, so bars do not shrink with the volume knob; a branch, so it cannot change the sound; skipped when the browser has no `createAnalyser`). `player-browser.js` `bands()` returns levels only while the WAV engine is playing; `library.js` publishes it as `window.LakehorsePhoneBands` (null in box mode). `matrix-window.js` runs an 80 ms local tick while open, and when levels exist and Bars is selected it draws them itself and ignores the box's frame for 400 ms; otherwise the box's frame shows as before. Virtual window only: nothing is sent to the box, and the real matrix still gets bars only in speaker mode.

**Limits:** non-WAV songs (AAC through the `<audio>` element) get no phone bars: routing that element through Web Audio would mute it for any non-same-origin source. While buffering the window falls back to the box frame. The analyser offset (+6 dB) is approximate; in the preview phone bars read about 5 against the box's 6 to 7 on the same song, so raise `ANALYSER_OFFSET_DB` in `band-meter.js` if you want them to match.

**Tests:** new `test/band-meter.test.js`; `test/matrix-window.test.js` gained the phone-mode case (local timer only when a provider exists, local frame drawn, box frame ignored while fresh, close cancels it). All page suites pass. `tools/devserver.py` now passes `Range`/`Content-Range`, so the preview can stream WAVs from the box.

## Session log 2026-11-22: shell and virtual matrix, Modules 2 to 6b

Everything below is built and on the box (firmware and page flashed after each module, each flash on the owner's explicit yes). Detail is in the module sections above; this is the one-page list.

| Module | What landed | Verified |
|---|---|---|
| 2 Frame engine | `src/matrix_engine.{h,cpp}` (pure `render(nowMs)`, modes Off/Bars/Title/Dazzle/Clock/Image, no task or heap), `src/matrix_api.{h,cpp}` (`GET/POST /api/matrix`), 24 native tests | native tests; heap cost nil |
| 3 Virtual matrix window | `data/matrix-window.js`: mode buttons, brightness, full view, no requests while closed, one poll at a time with back-off | iPhone tests good (owner) |
| 4 Shell reskin | `data/shell.js` + `index.html`/`style.css`: windows, taskbar, Start menu, first-run view from `/api/status` `hasSavedNetwork` | iPhone tests good (owner) |
| 5 Network and Speaker windows | `data/network-window.js`, Optimize-for-this-device box in `speaker-panel.js`, rescan fix, `.win [hidden]` CSS fix, taskbar label fix | page suites; Network join and Optimize on phone still untried |
| 6 Audio reactivity (box) | `src/band_levels.{h,cpp}` 8-band Goertzel meter on a timeline keyed to the played frame, fed from the reader task, read through `boxplayer::bandsNow()` into `/api/matrix`; Bars draws it, Dazzle brightens with it; `test/test_bands` (12) | 0 underruns over Mango Tree World (236 s) and 306 s of the next track; minFreeHeap 26,024 after a clean reboot (was 34,972), flat under sustained polling, cause not found |
| 6b Phone-mode bars | `data/band-meter.js`, analyser tap in `wavstream.js`, `bands()` in `player-browser.js`, `window.LakehorsePhoneBands` in `library.js`, local 80 ms draw in `matrix-window.js` | local preview played a WAV and drew bars; not tried on a phone |

**Tooling added:** `tools/devserver.py` (local preview proxying to the box, now passes `Range`), `radio-page` entry in the workspace `launch.json`.

**Test totals at the end:** 102 native C++ tests green; all page suites green (`matrix-window`, `shell`, `network-window`, `speaker-panel`, `band-meter`, plus the older ones).

**Still open:** captive-portal sheet on iPhone and Android; Network form's real join; Optimize on the phone; phone-mode bars on a real phone; the minFreeHeap drop from 34,972 to 26,024 (cause unknown); band-scale tuning by ear; AAC songs get no phone bars; Module 7 (matrix hardware: GPIO 27, 330 ohm resistor, 1000 uF cap, 150 mA limit) waits until it is wired; open decisions in `SHELL-AND-MATRIX-PLAN.md` (phone-mode bars driving the real matrix, font choice, captive-portal behaviour per phone).

## Network window, WLED-style (2026-11-22, late)

**Status: page-only change, tested in the browser against the real box via `tools/devserver.py`; FLASHED 2026-11-22 (`pio run -e radio-core2 -t uploadfs`, page image only, hash verified); live: bundle.js carries the new code, `pageload.py` median 1.24 s, 0 failed or short responses. No firmware change.** Join (`POST /api/wifi`) and Forget were NOT exercised; they would change the box's Wi-Fi.

- **Current network card** (always shown): headline "Connected to X" / "Could not join X: reason" / "Not on a network", then Network, Signal (bars + dBm, omitted at 0 dBm), Address, Name, Channel, Hotspot, from `/api/status`. Refresh button. Forget network button (confirm, `POST /api/wifi/forget`) shown only when a network is saved.
- **Scan + join now work from the home Wi-Fi**, not only the hotspot: the form shows when `viaAccessPoint` OR this device holds the pairing key (`lakehorse.radio.key` in localStorage, stored by `library.js` the first time the page is opened on the hotspot). Mirrors the firmware rule (`/api/wifi`, `/api/wifi/forget` accept AP subnet or `X-Lakehorse-Key`), so no firmware change. `app.js` sends the key header on join and forget.
- Off the hotspot the scan is **on demand** (button "Scan networks"), not automatic, because a scan retunes the radio and can stutter a song. Checked: 0 `/api/scan` requests at load, 2 rows after the button.
- A device never paired still sees the explanation (`#setupAway`, reworded: join the hotspot once to pair).
- Pure helpers `headline`, `currentRows`, `canChange` in `network-window.js`; `test/network-window.test.js` extended (incl. null reply, 0 dBm, no-ssid). All page suites green.
- **Still to do:** try Scan/Join on the phone from home Wi-Fi; Forget and a real join from the home network are untried (a wrong join from home leaves only the hotspot to recover with). Backup network still not built (firmware keeps one).

## Shell Module 7: matrix hardware (2026-11-24) - BUILT and compiled, NOT flashed, NOT verified on hardware

The owner's ESP module was unavailable, so nothing below has run on a board. Software is done and builds (`radio-core2` and `radio-core2-matrixbench` both SUCCESS; `pio test -e native` 144 passed; `node --test test/matrix-window.test.js` passed).

**Built**
- `src/matrix_layout.{h,cpp}`: logical pixel to strip index, serpentine or progressive, four origins. Default serpentine, top left. `test/test_layout` (9 tests: bijection in all 8 layouts, corners, row reversal, names).
- Engine (`matrix_engine`): `Mode::Test` ("test": TL red, TR green, BL blue, BR white at full, the rest dim at level 2), `pixelColor()`, and a box-side `brightness()` (1..100, default 20). New tests in `test/test_matrix`.
- `src/matrix_driver.{h,cpp}`: FastLED WS2812, GPIO 27, GRB. A FreeRTOS task (core 1, priority 1, 4 KB stack, about 15 fps) calls `boxplayer::bandsNow()` then `feedBands()`, `render()`, maps through the layout, scales by brightness. Compiled only with `-D LAKEHORSE_MATRIX=1` (set in `env:radio-core2`; `env:radio` and native are unaffected). Layout saved in NVS namespace "matrix".
- `/api/matrix` now takes `bright` (1-100), `wiring` (serpentine|progressive), `origin` (tl|tr|bl|br), `mode=test`, and returns `brightness`, `wiring`, `origin`, `hardware`, and `colors` (Test mode only). Web handlers and the driver share `matrixdrv::Lock`, because the engine renders into one static buffer.
- Page: a Test button, Test colours painted in the virtual window, and the Brightness slider sends `bright` to the box on release.
- `bench/matrix_bench.cpp` and `env:radio-core2-matrixbench`: panel alone, no Wi-Fi/BT, 150 mA limit before the first show, brightness 16/255, a one-pixel, corner, and slow-fill sequence for about a minute, reset reason logged at boot.

**Decisions**
- Brightness was assumed to "already exist" but lived only in the page (localStorage). Added box-side brightness; the slider sends it. Not yet confirmed with the owner as a permanent rule.
- No earlier matrix bench handoff existed; the bench is its own env.
- Safety: matrix starts 3 s after boot (after Wi-Fi/BT); 150 mA FastLED limit set before the first show; first show is black at brightness 0; brightness ramps in about 1 s; the page value is capped at 40% on the box until a bench pass at higher levels; frames unchanged are not re-shown; Off clears and stops drawing. Brownout detector left alone.
- Wiring decided with the owner: ESP on USB (serial kept), panel 5 V from the dev-kit supply module, ESP 5 V pin not tied to the panel, grounds bridged, supply on first. Owner reports plugging the matrix power in may have crashed the ESP; treat a reset at plug-in as unattributed until reset reason (logged at boot) says otherwise. No capacitor/resistor/level shifter added.

**Audit (reading only; none of this measured)**
- Task: core 1 (Wi-Fi/BT on core 0, async TCP on core 1 but light), priority 1, so audio/Wi-Fi tasks preempt it. Stack 4 KB, high-water mark not logged yet.
- RMT: FastLED uses an RMT channel; A2DP uses none. Coexistence unproven until a song plays with the matrix on.
- Frame buffer: one mutex covers render+copy in both the web handler and the driver, so no torn reads. The audio reader writes band levels only into `band_levels`, read via `bandsNow()`, unchanged.
- Power limit is applied before the first show (checked in `drawTask`).
- Open: heap cost and `minFreeHeap` vs 26,024 not measured.

**Not verified (needs the board)**: bench sequence, every pattern on the panel, corner colours (owner must look: TL red, TR green, BL blue, BR white; if wrong set `wiring`/`origin` via `/api/matrix`), Bars with a song on the speaker, brightness and Off from the page, 0 underruns over a full song, minFreeHeap, pairing/playback unchanged.

**Next session, in order**: power the supply first; flash `radio-core2-matrixbench` (115200), watch serial for resets; if clean, flash `radio-core2` and select Test from the page. If the panel is dark: pin, GRB order, then DIN not DOUT, shared ground, 5 V at the panel; flicker or wrong colours point to a level shifter.

**Unrelated, reported by owner**: iPhone hotspot join failed or dropped in the car. Join code reviewed, nothing found; needs a serial log of one failed attempt. Candidates: hotspot "Maximize Compatibility" off (ESP32 is 2.4 GHz only), hotspot sleeping when idle, `lakehorse.local` not resolving (use the 172.20.10.x address), modem sleep forced on by the Bluetooth build.

## Hotspot retry hold (2026-11-25): built, compiled, flashed and measured on the box; it was not the whole cause, see "Borrowed from WLED" below

**Measured result (2026-11-25, same day, code session):** the hold compiles and its 6 timing tests pass, but on the box it changed nothing visible, because the retry it holds was not what was searching. Details and the fix that did work are under "Borrowed from WLED", item 1 and 2. The text below is the chat session's original write-up, kept as it was.

Written in a chat session, not a code session, on a machine with no PlatformIO, so the firmware has not been built. Only the timing logic was compiled and run (g++ with a small stand-in for Unity): 6 of 6 pass. Run `pio test -e native` for the real result.

**Problem (owner report).** Taken from the house, the box woke up away from its saved network (network audio mode, so Bluetooth was off) and raised its hotspot. An iPhone could not hold a connection to it long enough for the setup sheet to appear. This is the "iPhone hotspot join failed or dropped in the car" item noted at the end of Shell Module 7.

**Suspect, from reading the code, not yet reproduced.** With a saved network out of range, `wifinet::tick()` retried it every `STA_RETRY_INTERVAL_MS` (30 s). Each retry goes through `resetRadio()` (WIFI_MODE_NULL) and then re-raises the hotspot, and the retry is also a scan for a network that is not there, on the one radio. A phone on the hotspot was thrown off every 30 s and had to rejoin.

**Reference: WLED's `handleConnection()`** (read from a fork of its wled.cpp, so check it against current upstream before relying on details). It waits 300000 ms between reconnect attempts when a phone is on its hotspot, against 20000 ms otherwise, and it does not stop retrying altogether. The change below copies that.

**Change.**
- New `src/hotspot_retry.h` (header only, Arduino-free): `intervalMs(normal, withClient, apUp, apClients)` and `due(now, last, interval)`.
- `src/config.h`: `STA_RETRY_INTERVAL_WITH_AP_CLIENT_MS = 300000`, next to `STA_RETRY_INTERVAL_MS`.
- `src/wifi_manager.cpp` `tick()`: the background retry uses the long interval while `WiFi.softAPgetStationNum()` is above zero and the hotspot is up. Nobody on the hotspot: timing unchanged. Include added for `hotspot_retry.h`.
- New `test/test_hotspotretry/test_hotspotretry.cpp` (6 tests, Unity). No change to `platformio.ini` needed (header only, `-I src` already set for the native env).
- Not touched: provisioning, forget, `reconnect()` (used by the link watchdog, which only runs when connected), the fallback hotspot timer, channel handling, Bluetooth.

**Not copied from WLED, on purpose, and probably still needed.** When a phone joins its hotspot while it is searching, WLED also cancels the search (`if (stac) WiFi.disconnect()`, commented "disable search so that AP can work") and restarts it when the last phone leaves. This change does not do that, so a search already running when a phone joins (up to `STA_CONNECT_TIMEOUT_MS`, 20 s), and any searching the Arduino core does by itself between our retries, can still disturb the hotspot. I did not copy it untested because it would also cancel a join the owner starts from the setup page: it needs a "this attempt was asked for by a person" flag set in `provision()` and cleared when the attempt ends, and a board to check the event ordering against the "sta is connecting, cannot set config" wall noted in this file. If the bench test below still shows drops, do that next. Also not yet checked: whether `WiFi.setAutoReconnect` is left at its default (true) on core 2.0.17, which would mean the core keeps scanning on its own.

**To verify (bench).**
1. `pio test -e native` (the new suite plus everything else), then `pio run -e radio-core2`.
2. Flash with a saved network that is out of range (turn the router off or take the box out of range). Watch serial.
3. Join the hotspot from the iPhone. Expect no `[wifi] trying saved network` lines for about 5 minutes while it stays joined, and the setup sheet to open. Note any drops and what the serial log said at that moment.
4. Confirm a normal boot at home still joins the saved network and that playback and pairing are unchanged.
5. Confirm the iPhone setup sheet appears at all: the captive probe paths in `captive_portal.cpp` have never been exercised on a real iPhone or Android.

## Borrowed from WLED (2026-11-25, one code session, items 1 to 4)

Everything below is in the working tree, nothing committed. Box state left: shipping `radio-core2` (now WITHOUT the matrix driver, see "Matrix segmented off"), joined to pifi at 192.168.0.15, `/band-tracks.json` on the card is the real 100-byte starter list, Bluetooth on, ML301 connected. Upstream WLED was not checked (no network lookup was done); the details copied were the ones the chat notes quoted from a fork, and the measured behaviour below is what actually matters.

### Item 1: hotspot retry wait. It does not fix the bug on its own.
- Audit of the chat session's change: logic is right, header is Arduino-free, 6 native tests pass. Whole suite now 169 native tests, all 13 JS and Python test files green. `pio run -e radio-core2` builds.
- **`WiFi.setAutoReconnect` is left at its default (true) on core 2.0.17, and it matters a lot.** `WiFiGeneric.cpp` re-runs `WiFi.disconnect(); WiFi.begin()` on every STA disconnect whose reason is on `_isReconnectableReason`, and `WIFI_REASON_NO_AP_FOUND` (201) is on that list. So with the saved network out of range the core rescans every ~1.7 s on its own.
- **Measured** with the test-only build `env:radio-core2-nowifitest` (the saved network is replaced in memory by one that does not exist, NVS untouched, never the shipping build): serial showed `not connected ... reason 201` every 1.7 s for the whole run and **zero `[wifi] trying saved network` lines**, i.e. our 30 s retry, and so the 300 s hold, never ran. Each scan sweeps channels and pulls the one radio off the hotspot's channel, which is what threw phones off. A Mac asked to join the hotspot during that run could not even find it ("Could not find network").
- Bench method note: the Mac was used as the hotspot client (a phone was not needed for this). macOS drops a no-internet network by itself after about a minute, so the Mac can hold the link ~60 s, not 5 minutes. Opening the serial port resets the board on this Mac, as known.
- **Measured on the owner's iPhone, Bluetooth compiled out (`radio-core2-nowifitest-nobt`):** phone joined at 111.0 s, `search ... paused` logged once, then **no retry line for 300 s**; the next `trying saved network` came at 411.2 s (the 300 s hold, exactly), which re-raises the hotspot and drops the phone for that moment. No drops in between, page and audio worked from Safari. With Bluetooth ON the hold was not the problem, memory was, see the Bluetooth section below.
- Normal boot at home: the shipping build joined pifi at 192.168.0.15 about 7 s after reset, page 200, playback started, 0 underruns, pairing refuses off the hotspot as before.

### Item 2: cancel the search when a phone joins. BUILT (the condition in the brief was met).
- Why built: item 1's bench showed the core searching on its own (above).
- `hotspot_retry.h` gained `searchAction(apUp, apClients, stationConnected, personAttempt, cancelled)` returning None, Cancel or Resume; 8 more native tests (14 in the suite).
- `wifi_manager.cpp`: (a) **auto-reconnect is switched off whenever the hotspot is raised** and back on when it is torn down, so our 30 s tick retry is the only searching while the hotspot is up; (b) `handleHotspotSearch()` runs on the loop task from `tick()` (client count read there, never in the event handler): a phone joining cancels an in-flight attempt with `WiFi.disconnect(false,false)`, and when the last phone leaves (or the hotspot drops) the wait restarts from that moment, so the next retry comes ~30 s later; (c) a join started from the setup page is never cancelled: `provision()` sets `g_personPending`, `beginStationAttempt()` moves it to `g_personAttempt`, cleared on GOT_IP, on a disconnect event, and on tick()'s timeout; it also lifts an earlier cancel. Disconnect is only issued if an attempt is actually in flight (an idle disconnect only logs a driver error), and the "sta is connecting, cannot set config" wall is untouched because nothing here calls `begin()` or sets config.
- Known small exposure: a late STA_DISCONNECTED event from `resetRadio()` could clear `g_personAttempt` early; the 10 ms settle delays in `resetRadio()` make that very unlikely, and the same window already exists for `g_associating`.
- **Measured on the bench build (Mac as client):** after the hotspot came up at 17.5 s there were no more self-scans (the log has no reason-201 line until the phone had come and gone); `a phone joined the hotspot, search ... paused` at 28.7 s; no retry lines while it stayed (~58 s); `hotspot is empty again, search resumes` at 86.7 s; `trying saved network` at 116.8 s, **30 s later**, as designed. Same on a second run (pause 27.5 s, resume 87.7 s, retry 120.6 s).
- The retry itself still re-raises the hotspot, so every 30 s with nobody on it (and every 300 s with someone on it) the hotspot blinks. Unchanged design, now the only blink.

### Item 3: small card-file endpoint. BUILT and tested on the box.
- `POST /api/sd/card-file?name=band-tracks.json`, raw body (`Content-Type: application/octet-stream`, a form content type is not read as a raw body and answers "no file arrived"). Same rules as the song upload: pairing key when `SD_WRITES_NEED_KEY` is on (it is off at present, so the 401 path was not exercised on the box, it is the same `authorised()` check as the other routes), `SD_UPLOAD_ENABLED`, SD mounted, and the one-upload slot `g_uploadOwner`.
- Allowlist `cfg::CARD_FILE_NAMES` and cap `cfg::CARD_FILE_MAX_BYTES` = 4096 in `config.h` (4096 is the most `alignment_box.cpp` will read back, so a bigger list could not work anyway). Exact name match only; no folders, no `..`, no deletes.
- `card_files.{h,cpp}` (Arduino-free): `nameAllowed`, `validate`. For band-tracks.json the body must parse, be an object, have `version` 1 if present, and a `tracks` array of non-empty strings. Trailing text after the JSON is tolerated because the reader tolerates it. 10 native tests (`test/test_cardfiles`, including that an accepted list is one `bandListContains` reads).
- Write path: whole body held in one allocation (freed with the request, so a dropped connection cannot leak it), validated, written to `/band-tracks.json.part`, size checked, old file moved to `.old`, part renamed in, `.old` removed; on a failed swap the old file is put back. A bad upload never touches the old file.
- **Box results:** good upload 200; bad JSON 400; wrong shape 400; 5000 bytes 413; names `playlist.json`, `music/band-tracks.json`, `../band-tracks.json` 400; empty 400; a second upload while a slow one ran 503 ("another upload is already in progress") and the slow one still completed 200; an upload killed after 3 s did not lock the slot (the next good one went through). Final push by `tools/push_card_file.py` restored the real list.
- Heap: a card-file upload costs a transient 3 to 4 KB (minFreeHeap 20,408 to 16,660 across the whole test session on the matrix-free build).
- Tool: `tools/push_card_file.py [FILE] [HOST] [--key KEY]` (defaults band-tracks.json, lakehorseradio.local; key also from `LAKEHORSE_KEY`, never printed). Test `test/push_card_file.test.py`.
- Not verified: the band flag actually changing after a push (the box has no read-back route; the firmware checks the written size, and the reader is the already tested piece 1 code).

### Item 4: page updates over Wi-Fi. NOT BUILT, found not safe. What would make it safe is below.
Read from the core (2.0.17 `Update` library) and this firmware, nothing was written to the partition:
- The core can write the filesystem partition while the box runs: `Update.begin(size, U_SPIFFS)` finds the partition labelled `spiffs` (our LittleFS one) and `size` is checked against it, so an image larger than 512 KB is refused before writing.
- **It erases and writes sector by sector from the first byte** (`Updater.cpp`, `_writeBuffer`), in place, with no second copy. From the first chunk the live LittleFS is damaged while it is still mounted, so the page, the Wi-Fi setup sheet and the saved playlist are served from a partition being erased underneath them.
- **A failed or interrupted write leaves a partition that cannot mount.** `playlist_store.cpp` mounts with `LittleFS.begin(formatOnFail=true)`, so the next boot formats it: an empty filesystem, no page. NVS (saved Wi-Fi, pairing key), the app, SD playback and the JSON API all survive, so the box still boots and plays through the API.
- **There is no recovery page served from firmware.** Every HTML page, including the Wi-Fi setup sheet the hotspot shows, is in LittleFS (the only text compiled in is the default playlist JSON). So after a bad write a box away from its network has no way to be set up from a browser, and USB is the only recovery. The card-free recovery that does exist is re-running the push tool at the box over a network it already knows, because the upload route itself would live in firmware.
- Also: a fresh image replaces `playlist.json`, which is user data written at run time into the same partition; any push would have to carry it or read it back first.
- By the brief's own test (still boots, still plays, still answers a small built-in recovery page from firmware) this is not safe today, so no route, tool or interrupted-upload test was made.
- **What would make it safe, in order:** (1) a small recovery page compiled into firmware (PROGMEM), served for `/` whenever LittleFS has no `index.html`, with the Wi-Fi setup form and an image upload; (2) stage the image on the SD card first (route writes `/page-update.bin`, checks size, LittleFS magic and a hash), then write the partition from the staged file with the page handlers quiet, and keep a pending marker so a boot that finds the staged file and a bad filesystem simply re-writes it, which makes an interrupted write self-healing whenever a card is present; (3) carry `playlist.json` across. With (1) and (2) the interrupted-upload test becomes a meaningful pass criterion.

### Matrix segmented off (owner's call, 2026-11-25)
- Found while chasing "the captive portal comes up but is blank": with the LED matrix driver built in (`-D LAKEHORSE_MATRIX=1`, it was in `env:radio-core2`), internal heap at idle was **6.8 KB free** against **20.4 KB** with it off (A/B on the same code, matrix driver the only difference; the box as found before today's flash had 21.2 KB). In hotspot mode with Bluetooth on that low-water mark was 5.3 KB and the web server answered one request and then stalled for the whole sheet.
- `platformio.ini`: the flag is out of `env:radio-core2` and lives in the new `env:radio-core2-matrix` (same firmware plus the driver). Nothing else about the matrix was touched; its code, tests and page window are as they were. When the matrix section is picked up, either build that env or win back the ~13.5 KB (smaller RMT buffers, move the frame buffer to PSRAM, or the board swap).
- After the change the setup sheet rendered the full shell page (player and games windows) on the Mac at 192.168.4.1. It showed "Checking the card..." and no song list inside the minute the Mac stayed (see below); `/api/sd` answers in 0.4 s at home.

### Hotspot with Bluetooth ON starves the network stack; with it off the hotspot works (owner's iPhone, 2026-11-25)
- With the bench build that has Bluetooth on (`radio-core2-nowifitest`), the iPhone stayed joined (no kicks: the earlier "bouncing back to pifi" was iOS auto-join preferring a known network), but the setup sheet and Safari could not load the page, a song stalled at "buffer 0 of 4 seconds", and the box logged `WiFiUdp endPacket(): could not send data: 12` (ENOMEM) on its DNS replies, 56 times in two minutes, with free heap ~20 KB and largest block ~8 KB. HTTP to the box also died within seconds of a client joining.
- With Bluetooth compiled out (`env:radio-core2-nowifitest-nobt`, the owner's "network audio mode"), same code: boot free heap 259 KB instead of 160 KB, ~180 KB free at idle, ~100 KB low-water while a phone was on, **0 ENOMEM lines**, and from the iPhone over the hotspot **the page loaded in Safari and audio played**. The phone joined and stayed.
- Conclusion: the fixes for the search loop are right, and the remaining hotspot failure is internal-heap pressure from the Bluetooth stack (Bluetooth on leaves ~20 KB free once a client is on the hotspot). Bluetooth off is fine today. To use the hotspot with Bluetooth on, internal heap has to go up or lwIP has to be given room: candidates are fewer simultaneous TCP clients in AP mode, smaller AsyncTCP queue (`CONFIG_ASYNC_TCP_QUEUE_SIZE=128`), moving more buffers to PSRAM (careful, the pbuf PSRAM bug), or the board swap. Not attempted here.
- `env:radio-core2-nowifitest-nobt` is a bench env only, like `-nowifitest`.

### Heap, against the last recorded figures
| Moment | minFreeHeap |
|---|---|
| Box as found, before today (pre-matrix firmware, joined, ML301 connected, idle) | 21,248 |
| Module 8 piece 1 after a 4 play run (matrix era) | 16,240 |
| This work, matrix off, idle after boot | 20,408 (0.8 KB under the as-found figure) |
| same, after the card-file test session | 16,660 |
| Final shipping flash, 30 s after boot while ML301 connects | 15,320 |
| Playing Mango Tree World, 0 underruns | 19,160 |
| Matrix on (the old shipping env), idle | 6,864 to 7,320 |
Today's code (card-file route, search pause) accounts for under 1 KB at idle plus the transient upload cost above. The big movement is the matrix driver.

### Left for the owner (iPhone, a minute or two)
1. Done on 2026-11-25 with the owner's iPhone (see item 1). Still worth a look: Android and the captive probe paths, and a way to run the hotspot with Bluetooth on.
2. Songs and games listing inside the setup sheet itself was not confirmed; Safari at 192.168.4.1 with Bluetooth off works. With Bluetooth on the hotspot cannot serve pages (heap), and the old 30 to 40 KB/s note stands.

## Join any network, keep Bluetooth on (2026-11-25, Opus) - reading written BEFORE code

Replaces the hotspot-memory brief's direction. Owner's idea: instead of the box's own hotspot (which starves with Bluetooth on), the box joins a network: home Wi-Fi, a venue's, or the owner's phone hotspot. As a station the box runs no AP, DHCP or captive DNS, which is the setup that already works with Bluetooth on at home.

Reading, settled act-first:
- **Several saved networks** (up to `cfg::SAVED_NETWORKS_MAX` = 5), most recent first. Slot 0 keeps the old NVS keys (`ssid`/`pass`) so the network already saved survives the update. Names only ever leave the box (status `saved`), never passwords.
- **Which one:** boot scans once (blocking, nothing else running yet) and tries the strongest saved network in range; background retries walk the list in turn. Joining moves that network to the front.
- **Page:** Network window lists saved networks with "Use now" and "Forget"; the join form says any Wi-Fi works, including a phone hotspot; a "Can't find your network?" help block covers 2.4 GHz only (iPhone Maximize Compatibility, Android 2.4 GHz band, router band settings, WPA3-only, hotel login pages); an "Open in browser" button opens the box's page at its current address.
- **Best practice:** add the phone hotspot while at home through the normal page (works with Bluetooth on). Away from home the box then finds it alone.
- **First-time setup away from home** (a network never saved) still needs the box's own hotspot, which cannot serve pages with Bluetooth on. Setup boot: when a phone joins the box's hotspot while Bluetooth is running and the box is on no network, the box restarts once with Bluetooth skipped for that boot only (RTC flag, nothing saved). After it joins a network, or once the hotspot has been empty a few minutes, it restarts again with Bluetooth back. Cost: the speaker is silent during first-time setup only.
- Plan B, not built: Bluetooth's run-time allocations steered to PSRAM by task, and trimmed Wi-Fi buffers. Only if the box's own hotspot has to work with Bluetooth on.

### Built, flashed, verified at home (2026-11-25, Opus). Phone steps NOT yet run.
- **Code:** `saved_networks.h` (list logic, 13 native tests), `setup_boot.h` (setup-boot decision, 8 native tests), `wifi_manager.cpp` (list in NVS behind a mutex, boot scan picks the strongest saved network, retries walk the list, the joined one moves to the front, `use()` / `forget(ssid)` / `savedNames()`, hotspot held `AP_TEARDOWN_GRACE_MS` after a join; a setup boot raises the hotspot at once), `bt_speaker.cpp` (RTC-only setup-boot mark, `btInUse()` false that boot so the controller memory goes back, `restart(forSetup)`), `main.cpp` (`setupBootTick()`), `web_server.cpp` (`saved` + `setupBoot` in status, `POST /api/wifi/use`, `/api/wifi/forget` takes `ssid`, same hotspot-or-key rule). Page: saved list with Use now / Forget, "Add a network" text saying any Wi-Fi works, a 2.4 GHz help block (iPhone Maximize Compatibility, Android AP band, router band, WPA3-only, sign-in Wi-Fi), an "Open in browser" link that points at the box's new address once joined, a setup-boot note, failure hints. JS tests extended.
- **Tests:** native 190/190 (169 + 21 new), every `test/*.test.js`, `box.test.mjs` and `test/*.test.py` green. `radio-core2` builds (RAM 31.0%, flash 53.0%).
- **Flashed** `radio-core2` + page image (hash verified; the box's `playlist.json` matched `data/` first, so nothing was lost).
- **On the box at home:** the network saved before the update came back as slot 0 (`saved: ["pifi"]`, joined 192.168.0.15). Boot log: `boot scan: saved "pifi" heard at -47 dBm on channel 1`, then joined; one transient `reason 2` before the join, recovered by itself. ML301 reconnected. `/api/wifi/use` and `/api/wifi/forget` answer 401 from the home network without the key. Served page has the new markup and bundle code.
- **Heap with ML301 connected:** idle free 17,844 / largest 8,180 / min 14,076; after 3 page loads free 19,404 / largest 9,716 / **min 12,160** (earlier figures in this file: 15,320 at boot settle, 9,804 after game sweeps). The list costs well under 1 KB.
- **Seen, not caused by this as far as I can tell, not A/B tested:** with Bluetooth connected, 20% ping loss to the box and occasional 1 to 3 s TCP connects (one `/api/status` timed out at 6 s). Matches the long-standing "Bluetooth on: modem sleep, slow Wi-Fi" note; worth an A/B against the previous firmware if it bothers anyone.
- **Not verified (needs the owner's phone; this Mac cannot be a hotspot client without dropping the session):** (1) adding a network and Use now / Forget from a paired phone; (2) the box joining a phone hotspot with Bluetooth on and the page plus playback working there; (3) the setup boot: a phone joining "Lakehorse Radio" with Bluetooth on restarts the box without Bluetooth, the setup sheet loads, and after a join the box restarts with Bluetooth back.

**Owner test, about 10 minutes, iPhone:**
1. At home: on the iPhone turn Personal Hotspot on, with Maximize Compatibility on. Open the box page (lakehorseradio.local), Network, Add a network: pick the iPhone's hotspot, type its password, Join. Expect the box to move to the hotspot. Switch nothing on the phone (it is the hotspot). Open the page by tapping Open in browser from the Network window on the next visit, or open `http://lakehorseradio.local`. If the name does not load from the hotspot iPhone, read the box's address off its serial log or the router and report it: then the page needs to show the address in a better way.
2. On the hotspot with ML301 playing: play a song to the phone from the page. Report whether it loads and plays.
3. Forget the iPhone hotspot from the saved list (or switch the hotspot off): the box should go back to pifi within about 30 s.
4. Optional, away-from-home setup: with no saved network in range, join "Lakehorse Radio" from the phone. The box restarts once (Bluetooth rests), the setup sheet should load. Add a network; once joined, about 20 s later the box restarts with Bluetooth back.

### Pairing from home (2026-11-25, later): built after the owner's first test failed
- **What happened:** the owner tapped Forget network at `lakehorseradio.local`. The page showed its "the box will start its own hotspot" warning, the box refused (401, phone not paired at that address), and nothing changed. Two causes: the pairing key is kept per address (paired at 192.168.4.1 is not paired at lakehorseradio.local), and the key was only handed out over the box's hotspot, which is down whenever the box is on a network. The page also showed Forget to an unpaired phone.
- **Fix:** `pair_window.h` (7 native tests): hold the dev board's **BOOT** button (GPIO 0) 3 s, or power the box on (unplug/plug; a software restart does not count), and `/api/pair` answers on any network for 2 minutes (`cfg::PAIR_*`). The Network window shows "Pair this phone" with those instructions to an unpaired visitor and hides Forget and the network controls from it. Status carries `pairOpen`.
- Verified: after a serial/esptool reset (not a power-on) `pairOpen` is false and `/api/pair` from pifi is refused with the instructions. The BOOT button and the power-on path were not exercised (need hands on the box).

### Audit of this work (2026-11-25, end of session)
Fixed during the audit, flashed:
1. **`onAccessPointSubnet()` trusted any 192.168.4.x client even with the hotspot down** (`softAPIP()` keeps reporting 192.168.4.1). Pre-existing, but with the box now joining venue networks a guest on a 192.168.4.x network would have been treated as "at the box": network changes without a key, and the key handed out. Now requires the hotspot to be up.
2. **`g_ssid` (an Arduino String) shared between the loop and web tasks unguarded.** Now read and written under `g_listMutex` (`currentSsid()`).
3. **Setup boot could keep Bluetooth off for good** if the hotspot failed to come up (the empty timer reset while the hotspot was down). Now only a phone on the hotspot resets it.
4. Help text: if `lakehorseradio.local` does not open on an iPhone hotspot, try 172.20.10.2, .3, ...

Known trade-offs, not changed (owner's call):
- **The hotspot is open (no password).** With Bluetooth on and no saved network in range, any phone that joins "Lakehorse Radio" (iOS auto-joins open networks it has joined before) restarts the box into a setup boot, Bluetooth off. While that phone stays joined Bluetooth stays off; 3 min after it leaves the box restarts with Bluetooth. Fix if it bites: a hotspot password, at the cost of typing it once per phone.
- **Power-on pairing window:** for 2 minutes after a power cut anyone on the same network can pair (one shared key, full rights). Same model as WPS. Fix if it bites: BOOT button only.
- **Strongest saved network wins at boot.** At home with the phone hotspot also on, the box may pick the hotspot. Turn the hotspot off, or Use now on home.
- **Bluetooth on = slow, lossy Wi-Fi** (modem sleep): 20% ping loss and 1 to 3 s connects seen at home. Pre-existing; affects every network equally, the phone hotspot included.

Unknowns only the phone test can answer, in order of risk:
1. Does `lakehorseradio.local` resolve from the iPhone that is hosting the hotspot? If not, the box is reachable only by trying 172.20.10.x. If that is common, the next fix is the box showing its address somewhere the owner can see it (the ML301 announcing it is not possible; options: the page on the previous network shows "last known address", or a fixed address request).
2. Does the iPhone hotspot keep a modem-sleeping ESP32 client joined for a whole session?
3. In the iOS setup sheet, does "Open in browser" open Safari or stay inside the sheet?
4. Does a song stream to the phone over the hotspot with Bluetooth playing on ML301 (the original goal)?

### Morning plan (owner + next session)
1. At the box: unplug and plug it in (or hold BOOT 3 s). Within 2 minutes, phone on pifi, open `lakehorseradio.local`, Network, **Pair this phone**.
2. iPhone: Personal Hotspot on, Maximize Compatibility on. Network, Add a network: the iPhone hotspot, Join. Keep the Personal Hotspot screen open while it joins.
3. Open `http://lakehorseradio.local` on that iPhone (or 172.20.10.2, .3, ...). Report which address worked.
4. With ML301 playing from the box, play a song to the phone. Report: loads? plays? drops?
5. Turn the hotspot off: the box should be back on pifi within about a minute.
6. Optional: setup boot (no saved network in range, join "Lakehorse Radio"), steps in the "Owner test" list above.
Next session: read the owner's answers to the four unknowns first; if (1) fails, build the address display; if (4) fails, then and only then plan B (Bluetooth run-time memory to PSRAM).


## Shell Module 9: help and look (2026-11-25) - BUILT, flashed, not yet seen on an iPhone 8

**Start state.** Repo toplevel `esp music v1`, branch `lakehorse-radio`, commit `a53c5a3`, working tree dirty (about 49 entries, mostly another session's uncommitted work). Nothing committed or pushed by this session, as briefed.

**What exists.**
- `data/frame.js`: every `.win-title` gets a "?" button and the close button becomes a skull SVG (aria-label "Close <title>", 44 px target).
- `data/help.js`: What's this? mode. A transparent full-page catcher takes the next tap, `elementFromPoint` finds the target, the nearest `data-help` picks the text, a bubble shows it, and the tap does nothing else. "?" then a title bar explains the window. Help window index (Start > Help) is built from `help.json` on first open.
- `data/help.json`: 86 entries, plain text, written from the code as it stands. Includes the no-control features (BOOT button, power-on pairing, speaker buttons, saved networks, phone hotspot, hotspot setup boot, alignment scoring, band-tracks.json, alignment pattern, tube look, drive-b.json). Fetched lazily with `cache:'no-cache'` because the box serves assets with a 70-day immutable cache. Missing or malformed file gives "Help could not be loaded" and the page works.
- `data/lens.js`: Start > "Screen: tube/clean", remembered in localStorage `lakehorse.lens`. Five fixed inline layers (noise, scanlines, roll, tear, vignette), all pointer-events none, text-shadow fringe excluded from inputs and the bubble, `prefers-reduced-motion` stops animation.
- Look: windows 22 px, buttons/inputs/panels/taskbar items 14 px, title bars 20 px top, taskbar 26 px top, balloons/badges 18 px, panels clip. Bevel colours unchanged.
- Test: `test/help-coverage.test.js` (every interactive element has a `data-help` that exists; every entry is reachable from an element or the Help index), plus `test/help.test.js`.

**Decisions.**
- Left out on purpose: the warp filter (a filter on body breaks position:fixed and moves tap targets) and backdrop-filter bands (costly on an iPhone 8). Roll and tear are plain gradient layers.
- Network work untouched: in `network-window.js`, `speaker-panel.js`, `library.js`, `shell.js` and the Network part of `index.html` only `data-help` attributes were added. No `src/` Wi-Fi, pairing or setup-boot code touched. `network-window.test.js` and the native savednets, setupboot and pairwindow suites were identical before and after.
- Matrix driver kept off: `env:radio-core2` has no `LAKEHORSE_MATRIX` flag, boot log says "built without the LED driver", `/api/matrix` reports `hardware:false`. Driver code not deleted. Only addition: the driver feeds alignment points before render (inside the `LAKEHORSE_MATRIX` block, never compiled in).

## Shell Module 8, pieces 2 and 3: Drive B and the Alignment pattern (2026-11-25) - BUILT, flashed, verified on the box except as listed

**What exists.**
- `data/drive-b.js` + Drive B desktop icon, Start entry and window: file list, ENIAS panel with big percent, 8x8 lattice (locked nodes teal and joined by thin lines, unlocked nodes orange rings at fixed per-node offsets), short event log built from what the page sees, balloons that hint and never state the rule.
- Data: `data/drive-b.json`, four PLACEHOLDER files at thresholds 0, 25, 60, 100 (LOG_0417.TXT text, CREW_MANIFEST.DAT text, TX_PROMO.WAV download, SHOW_TICKETS.LNK link). Gzipped by `tools/gzip_data.py` like other json (test added). Locked file: half-garbled name, status resolving toward its threshold, tap stutters and shows "read error: try after the next track". Unlocked: text in a viewer, download via anchor, link in a new tab (javascript: and `//` URLs refused). Malformed or missing file: window still opens, empty list.
- Requests: `/api/status` only while the window is open: on open, about 1.5 s after a song change, and every 20 s (paused when the tab is hidden). None when closed. Snap animation on newly locked nodes, flash on the node of a finished song.
- Matrix: `Mode::Alignment` in `matrix_engine`. Points 0 to 6400, clamped; 100 per node. Locked nodes steady and bright, in diagonals outward from the bottom-left corner. Unlocked points wander at dim level with disorder proportional to the missing share; the node being earned glows as its share fills. Pure function of points, seed and clock. In the pattern list and the virtual window ("Align"), 64-char frame. 11 native tests: deterministic, monotone, correct at 0 and 6400, clamp, cell order pinned.
- Phone-mode song reporting from the page is NOT built. Only songs the box plays count; the help text says so.

**Audit before flashing.** Points are clamped in `setAlignment`. The web handler reads `alignment::snapshot()` (copy) so no shared mutable state with the engine. Malformed or missing `help.json` / `drive-b.json` leave the shell and Drive B usable (unit tests).

**Measured on the box (192.168.0.15, Bluetooth on).**
- Native 208/208 (was 197). All JS and Python tests green, unchanged suites identical.
- Full song (Mango Tree World) at volume 0.04: 0 underruns; total 0 to 100. Volume restored to 0.4, playback stopped.
- Drive B percent equals `/api/status` (1%, 1 of 64 at 100 points; 3%, 2 of 64 at 200 after a level-clear event), snap animation seen, locked file shows the read error, unlocked file opens in the viewer. Matrix alignment frame at 200 points has 2 locked nodes, `hardware:false`.
- Page on the wire: 65,275 bytes (bundle 51,544, css 7,300, html 6,431).
- **First load did NOT meet Module 1's 1.0 s.** pageload.py: best 4.9 to 8.2 s, median about 15 s with several 15 s timeouts. The link itself is bad with Bluetooth on (ping 7% loss, 9 to 120 ms; single curl of the bundle 3 to 8 s, some resets), so this is not cleanly attributable; no A/B against the earlier page was run. A repeat visit answers 304 in about 0.35 s. The in-app browser lost the bundle and css to connection resets twice, so the on-box UI check ran the real box-served bundle fetched with retries and evaluated in the page; CSS-dependent looks were checked on the dev server only.
- **minFreeHeap 9,544 now** (12,628 after the song; last recorded in this file 12,160 and 15,320). It is lower than before. It follows page loads and a song on a saturated link, so it may be the test load rather than the code, but it is not proven; to settle it, reboot, load the page three times, read minFreeHeap, and compare with the previous build.

**Reset.** Alignment total reset to 0 with `env:radio-core2-aligntest` (`POST /api/test/align-reset`), then shipping `env:radio-core2` reflashed (upload speed 115200, flash never erased). Verified: test route 404, total 0, `/api/matrix` mode off.

**Not verified.** Lens smoothness and touch behaviour on the iPhone 8. What's this? and skull on every window were checked on the dev server, and Drive B and shell wiring on the box, not each window on the box. Network and pairing phone test is still pending from the other session. Real matrix hardware: untouched.


## Follow-up 2026-11-25: first load, heap, box check, phone-mode song reporting

**First load (was 1.0 s target; first pass measured a 15 s median).** Cause found, not the link alone: three parallel large responses (css, bundle, late files) stall on this box with Bluetooth on (3 in parallel took 13 to 40 s or came back short; the same files one after another took 2 s). The in-app browser's connection resets were the same thing. Fix, all in the build: `tools/gzip_data.py` now
- folds `style.css` and `bundle.js` into `index.html` when the page carries `<!-- inline-critical -->`, so the first screen is ONE request (50.9 KB gzipped, was 65.3 KB over three);
- moves `help.js`, `drive-b.js` and `wavconvert.js` (tags marked `data-late`) into `late.js`, fetched 800 ms after the page's load event by a tiny inline loader (`document.currentScript` is read at parse time, a bug I caught on the box and pinned with a test). Before late.js arrives the "?" button, Drive B and in-browser WAV conversion do nothing; on a good link that is about a second.
- Measured on the box with `tools/pageload.py` (page plus late.js, 8 to 10 rounds, 0 failed): best 0.67 to 1.24 s, median 1.46 to 1.55 s, worst 2.7 to 4 s. Page alone by curl: 0.8 to 1.1 s. Repeat visit: 304 in 0.3 to 0.7 s. So the page itself is close to 1.0 s; the whole first load including late.js is about 1.5 s median, so the 1.0 s target is still not met by the full pageload.py figure. Tests: 27 in `test/gzip_data.test.py`.

**minFreeHeap.** Static RAM A/B: building the shipping firmware with my three matrix files reverted to HEAD gives 101,660 bytes used; with them 101,668 (8 bytes). So the firmware change is not the cause. Heap dips with page traffic: 20,932 to 24,000 fresh after boot, 11,240 after 14 loads, 9,720 after about 10 more, 9,544 earlier. Last figure recorded before (12,160 after 3 loads) is therefore comparable, not a regression, but the floor under repeated loads sits near 10 KB with Bluetooth on.

**Box check in the real browser (the full box-served page).** All 7 windows open and close with the skull; What's this? gave the right bubble on controls in Player, Speaker, Network, Matrix and Drive B (the Games window has no plain button to sample); the Help index built 29 entries; the lens toggle works and reads "Screen: tube/clean". Found and fixed: the "?" and skull buttons were 28 px tall; their tap area is now 44 px tall (padding pseudo-element, overflow visible).
Note: the in-app browser pane stalls pages whenever the box is saturated, and once the box stopped answering altogether (host down for more than 5 minutes). I opened its serial port, which resets it, and it came back on Wi-Fi at once; the cause of that outage was not captured. Watch for it.

**Phone-mode song reporting is now built.** `data/align-report.js` tracks time actually listened (position steps of at most 1.5 s, so seeking to the end earns nothing) for songs the browser backend plays from the card: 95% listened counts as full, 50% as partial, leaving earlier counts nothing; it reports when the song changes, stops, or the page is hidden. The box player gets no tracker, so nothing counts twice. Firmware: `POST /api/alignment/event` now accepts a song id that is a playlist title OR a file listed in `/band-tracks.json` on the card (`alignment::isBandSong`). Verified on the box: an unknown name answers 400, "Mango Tree World.wav" credits +10 as partial, the same event again is a repeat and adds 0. Not tried: a real song played in a phone browser (the pane could not stream a 40 MB WAV through this link). `test/align-report.test.js` covers the tracker. The help text for Alignment scoring was updated.
The total was reset to 0 again afterwards the same way as before (aligntest build, reset, shipping `radio-core2` reflashed; the test route answers 404, total 0). All native (208), JS and Python tests pass.

## Network changes are open while building (2026-11-25, on the owner's word)
The owner could not configure Wi-Fi: the Network window hides the list from a phone with no pairing key (a lost key, a cleared Safari, a different address all do it), and BOOT pairing is not acceptable to ship. `cfg::NETWORK_CHANGES_NEED_KEY` (config.h, default false, same pattern as `SD_WRITES_NEED_KEY`) now makes `/api/wifi` join, use and forget accept anyone on the network, and `/api/status` carries `networkOpen:true` so the page always offers the list. Set it true before the box goes anywhere shared: then the old rule returns (box hotspot or pairing key, BOOT or power-on window). Flashed (firmware and page); verified: status `networkOpen:true`, `wifi/use` and `wifi/forget` from an unpaired client answer "not saved" instead of 401. `network-window.test.js` has two new cases; native 208/208. A real phone test of joining or leaving a network is still pending. Hotspot pairing from the page was NOT built: it only matters with the lock on, and it would touch the setup-boot code that has not yet had its iPhone test.

Pair button returned (2026-11-25): with setup open to everyone, a phone holding no key still sees an optional "Pair this phone" row under the form (`#pairIntro`, app.js applyStatus). Flashed with the page image. Phone hotspot not seen by the box on the first iPhone test; retrying with Maximize Compatibility on.

## Host mode (2026-11-25, owner request)
Network window button "Host its own network" (`#hostBtn`, shown only while joined to a network): `POST /api/wifi/host` -> `wifinet::hostMode()` sets a flag, `tick()` drops the station (nothing forgotten), raises the "Lakehorse Radio" hotspot and starts no attempts while `g_hostMode` holds. Leaves host mode when `use()` or `provision()` picks a network (reconnect() from the watchdog is ignored while hosting); a restart returns to the saved networks as usual (not persisted on purpose). `/api/status` carries `hostMode` and reports station idle and an empty ssid while hosting; the page shows a note with 192.168.4.1. Verified on the box from the Mac: host -> hotspot answered at 192.168.4.1 with `viaAccessPoint:true`, stayed hosting after 45 s with both saved networks kept, `wifi/use pifi` put it back on pifi. Not tried on a phone. Native 208/208; JS tests pass. No native test for the Arduino-only radio part.
Scan note: the page now says a phone's own hotspot will not appear in the scan while that phone shows the page; type the name instead (2026-11-25).
