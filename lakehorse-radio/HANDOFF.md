# Lakehorse Radio — handoff

Written 2026-09-15. Read this, then `README.md`, then the plan at
`~/.claude/plans/volumes-studiobunj-studiobunj-downloads-peaceful-rossum.md`.

## What this is

An ESP32 in the barn that serves a web player. **It never plays audio itself** —
whoever opens its page streams the mixes from Supabase on their own phone. That
is why it needs no codec, no DAC, no PSRAM and no TLS stack.

## Where things stand

**Working and verified on the hardware.** Boots cold with nothing driving it,
mounts LittleFS, serves the player, raises its hotspot, captures DNS, generates
a pairing key. The player renders and lists tracks on a real phone.

**The one thing it cannot do is join a network.** Every attempt ends in
`Reason: 204 - HANDSHAKE_TIMEOUT`, for ever.

## The outstanding bug, and it is diagnosed

**Not a wrong password, and not WPA3.** The owner's network is WPA2-PSK
(confirmed: `ipconfig getsummary en1` → `Security : WPA2_PSK`), and he runs WLED
on an ESP32 on that same network without trouble.

The cause is in `src/wifi_manager.cpp`, in `begin()`:

```cpp
WiFi.mode(WIFI_AP_STA);       // permanent, never changes
WiFi.softAP(cfg::AP_SSID);    // NO CHANNEL ARGUMENT -> channel 1
attemptSaved();               // now join a network on some other channel
```

The ESP32 has **one radio and one tuner**. The hotspot comes up first, pins the
radio to channel 1, a phone associates to it, and the station can then never
complete a WPA handshake with an access point on a different channel. It looks
exactly like a wrong password.

`wifi_manager.h` documented this constraint and the code never acted on it.

## What to do next

The plan is approved and specific. WLED is cloned at
`<scratchpad>/wled` — if it is gone, `git clone --depth 1 https://github.com/wled/WLED.git`.
Read `wled00/wled.cpp`, functions `initConnection()`, `initAP()`, `handleConnection()`.

**1. Prove the diagnosis before trusting the rewrite.** Scan at boot, before
associating, and log the target network's channel beside the SoftAP's. If they
differ, it holds. If they match, this is the wrong tree and the password is the
suspect again. Do not skip this.

**2. Station first, hotspot as fallback.** Copy WLED's sequence verbatim:

```cpp
WiFi.disconnect(true); delay(5);
WiFi.mode(WIFI_MODE_NULL); delay(5);   // full driver teardown, kills the AP
WiFi.setHostname(hostname);            // only applies across a mode transition
WiFi.softAPdisconnect(true);
WiFi.mode(WIFI_STA);
WiFi.begin(ssid, pass, 0, bssid);
```

The `WIFI_MODE_NULL` teardown is load-bearing and non-obvious. It is also the
correct cure for the `ESP_ERR_WIFI_STATE` that the current code works around
with an association flag.

WLED's policy (default `AP_BEHAVIOR_BOOT_NO_CONN`): no credentials → AP at once;
attempt running 12 s and never connected → AP; **connected → `softAPdisconnect(true)`**.
Its AP also uses an explicit channel and its own subnet:
`softAPConfig(4.3.2.1, ...)` then `softAP(ssid, pass, apChannel, apHide)`.
Constants are already in `config.h` (`AP_CHANNEL`, `AP_FALLBACK_AFTER_MS`,
`AP_TEARDOWN_ON_CONNECT`); nothing reads them yet.

The captive portal must follow the hotspot. `portal::tick()` should only run
while the AP is up — add `wifinet::isAccessPointActive()` and gate it in
`main.cpp`.

**3. ESP Web Tools for setup over USB.** The owner chose this over extending the
hand-rolled flasher. Credentials arrive over the USB cable from the browser, so
during setup the AP need not exist at all and the channel conflict cannot arise.
Firmware side needs Improv Wi-Fi Serial — model it on `wled00/improv.cpp`.
**Open risk:** our firmware logs on `Serial` at 115200 and Improv shares that
stream. Check how WLED coexists; move logging to `Serial1` or gate it if needed.

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
  0x10000 firmware.bin 0x1f0000 littlefs.bin
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
  cable failed with `Invalid head of packet (0xFF)`. 115200 is clean. A slow
  upload that works beats a fast one that silently corrupts.
- **The LittleFS offset is never typed twice.** `tools/make_release.py` parses it
  out of `partitions.csv` into `manifest.json`, and both flashers read the
  manifest. The original brief hardcoded `0x290000`, which was wrong; it is
  `0x1f0000`. A wrong filesystem offset fails **silently**.
- **`board = esp32dev`, not `esp-wrover-kit`.** The wrover-kit board file
  declares FTDI hwids and this board is a CP2102.
- **PSRAM is deliberately off.** Nothing here needs it.
- **The data partition is labelled `spiffs` though it holds LittleFS.**
  `LittleFS.begin()` looks for that label by default.
- **`pio test` needs `test_build_src = yes`** or the sources never compile into
  the test and it fails to link rather than fails to pass.
- **macOS has no `timeout`.** A command prefixed with it silently does not run,
  which reads as "no results found".
- **Wi-Fi scanning on this Mac is gated by Location Services**, so
  `system_profiler SPAirPortDataType` returns no network list.

## State

- Branch `lakehorse-radio`, commits `f8a0107` and `8cc9b46`. **Not pushed.**
  The push is Claude's per the repo's CLAUDE.md; it has not happened yet because
  the box does not work.
- Board: ESP32-D0WDQ6 rev v1.0, 4 MB, MAC `24:62:ab:e2:18:90`.
- **Original flash backed up** at `/Volumes/STUDIOBUNJ/studiobunj/esp32-backup/`,
  `sha256 326805f95a2460bd52cb1483f107a51453549e4ac6d14a281aa5f2faaec7754a`.
- Pairing key on this box: `c437e5fbad3f8042` (survives reflash, lives in NVS).
- The Apple Notes connector was **not available** this session, so the
  "Snalbum ideas & outbox" notebook was never read. Anything captured there
  since is unseen. `change requests/LEDGER.md` is gitignored and absent from a
  fresh clone, so CR-120 was chosen as the next free number after CR-119, which
  is the highest referenced anywhere in the tree.
