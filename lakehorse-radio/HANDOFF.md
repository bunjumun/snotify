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
