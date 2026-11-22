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
- Volume resets to 1.0 on reboot (not stored). Speaker's own buttons (AVRCP)
  are not handled: pausing on the speaker freezes position on the page.
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
