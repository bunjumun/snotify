# Lakehorse Radio

A small ESP32 box that serves a web player. Join it, open the page, and **your
phone** plays the band's catalogue. The box itself never makes a sound.

That is the whole design, and it is why this is a small build rather than a hard
one: the ESP32 does no audio decoding, holds no credentials, and does no TLS. It
serves about 24 KB of static files and a playlist, and the phone does the rest.

## The one thing to understand before using it

A phone joined to the box's **own hotspot** has no route to the internet, and the
music lives on the internet. Playback in that mode only works if the phone keeps
mobile data switched on alongside the Wi-Fi. The captive setup sheet a phone pops
up is a cut-down webview and **cannot play audio at all**.

So there are two modes, and the player page tells you which one you are in:

| Mode | How | Works for listening? |
|---|---|---|
| Box and phone both on the barn network | Set the box up once, then open `lakehorseradio.local` | **Yes, reliably.** Use this. |
| Phone joined directly to the box's hotspot | Join "Lakehorse Radio" | Setup: yes. Listening: only with mobile data on, and not from the captive sheet. |

The hotspot exists for two jobs: putting the box on a network in the first place,
and being reachable at a gig where there is no network at all.

## Layout

| File | What it does |
|---|---|
| `src/main.cpp` | Ordering only. Every step depends on the one above it. |
| `src/config.h` | Every tunable, each with its reason. |
| `src/wifi_manager.*` | Access point and station, both always on. Credentials in NVS. |
| `src/captive_portal.*` | Wildcard DNS and the OS probe URLs that raise the setup sheet. |
| `src/web_server.*` | One server, both audiences. API, static files, CORS. |
| `src/playlist_validate.*` | Pure validation. Runs on a laptop, so it is actually tested. |
| `src/playlist_store.*` | LittleFS, with a write-then-rename so a power cut cannot corrupt. |
| `src/bt_speaker.*` | The Bluetooth link: chosen speaker, find/connect/disconnect, Bluetooth on/off. |
| `src/speaker_api.*` | `/api/speaker/*`, the page's Bluetooth controls. |
| `data/speaker-panel.js` | The page's speaker panel. |
| `src/box_player.*` | Bluetooth playback: SD WAV to an A2DP speaker (core-2 build only). |
| `src/pcm_format.*` | WAV headers, resampling to 44.1 kHz, volume. Pure, tested on a laptop. |
| `src/player_api.*` | `/api/player/*`, the page's remote for box playback. |
| `src/net_watchdog.*` | Wi-Fi watchdog: pings the gateway, rejoins, restarts as a last resort. |
| `src/link_watch.*` | The watchdog's decision rules (native-tested). |
| `src/send_window.*` | Per-connection TCP send cap, so page loads fit beside Bluetooth. |
| `src/device_key.*` | Per-box pairing key, generated on first boot, handed out only over the hotspot. |
| `src/net_identity.*` | mDNS, restarted on every reconnect because it does not survive one. |
| `data/` | The player page, flashed as a LittleFS image. |

## Building

Needs PlatformIO. The platform is the **pioarduino** fork, because the official
`platformio/platform-espressif32` has never shipped Arduino core 3.x and
ESPAsyncWebServer 3.x requires it.

```bash
pio run -e radio          # compile
pio run -t upload         # bootloader, partitions, boot_app0 and app in one go
pio run -t uploadfs       # the data/ folder as a LittleFS image
pio device monitor        # 115200
pio test -e native        # validation unit tests, no board needed
```

Then collect a release the browser flasher can use:

```bash
python3 tools/make_release.py
```

That writes `../firmware/lakehorse-radio/` with the four images and a
`manifest.json`. **The manifest is the point.** It reads the LittleFS offset out
of `partitions.csv` rather than repeating it, so the browser flasher can never
drift from the partition table. The original spec for this project hardcoded that
offset as `0x290000`, which was wrong, and a wrong filesystem offset fails
silently: the board boots and serves nothing.

## Flash offsets

Fixed by the classic ESP32 boot ROM. **The S3 and C3 put the bootloader at 0x0
instead**, which is the usual way people brick a board by copying offsets from
the wrong tutorial.

| Offset | Image |
|---|---|
| `0x1000` | bootloader |
| `0x8000` | partition table |
| `0xe000` | boot_app0 |
| `0x10000` | firmware |
| `0x370000` | LittleFS, from `partitions.csv` (was `0x1F0000` before 2026-11-21) |

## Notes that cost time to learn

- **Upload speed is 115200 on purpose.** A flash read at 460800 on this board
  and cable failed with `Invalid head of packet (0xFF)`. 115200 was clean.
- **PSRAM is deliberately off.** The chip reports 1.8 V flash by strapping pin,
  which is the WROVER signature, so there probably is some. Nothing here needs
  it, and turning it on drags in the rev v1.0 cache workaround for no gain.
- **The data partition is labelled `spiffs` even though it holds LittleFS.**
  `LittleFS.begin()` looks for that label by default. Renaming it means passing
  the label at every call site.
- **mDNS is restarted on every `GOT_IP`**, not once at boot. Calling
  `MDNS.begin()` before the station has an address silently does nothing, and
  the responder does not survive a reconnect on its own.
- **The box's name is settable** on the setup page and kept in NVS, defaulting
  to `lakehorseradio`. Two boxes on one network would otherwise both claim the
  same name. An illegal name is refused with a reason rather than accepted and
  silently never advertised, which is what mDNS does with one.
- **The network scan can legitimately fail.** The radio will not scan while it
  is busy associating, so `WiFi.scanNetworks()` returns a failure that must be
  reported. Reporting it as "still scanning" leaves the page polling for ever,
  which is what the first build did.
