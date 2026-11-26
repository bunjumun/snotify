# Brief: keep the hotspot usable with Bluetooth on (internal heap)

Project: Lakehorse Radio, ESP32-WROVER (4 MB flash, 4 MB PSRAM, rev v1.0 chip), folder `esp music v1/lakehorse-radio`. Read `HANDOFF.md` "Borrowed from WLED" first, then "START HERE (2026-11-23, night)" (the PSRAM pbuf bug), then `src/wifi_manager.cpp`, `src/config.h`, `src/bt_speaker.cpp`, `platformio.ini`. Build with `/Volumes/STUDIOBUNJ/studiobunj/.venvs/pio/bin/pio`. Core 2.0.17 (`env:radio-core2`). Upload at 115200, never erase flash, opening the serial port resets the board.

## The dilemma
Away from home the box raises its own hotspot "Lakehorse Radio" so a phone can open the page and play songs. With Bluetooth ON (the A2DP source that plays to the ML301 speaker) the hotspot does not work: internal heap is about 20 KB free with a phone joined, largest block about 8 KB, and the network stack starves. With Bluetooth compiled out it works well (about 180 KB free, 100 KB low-water with a phone on).

Measured on the owner's iPhone, same code, only Bluetooth differing:
- **BT on** (`env:radio-core2-nowifitest`): phone stays joined, but the setup sheet and Safari cannot load the page, songs stall at "buffer 0 of 4 seconds", and the log shows `WiFiUdp.cpp:185 endPacket(): could not send data: 12` (ENOMEM) on DNS replies, 56 times in two minutes. HTTP dies within seconds of a client joining.
- **BT off** (`env:radio-core2-nowifitest-nobt`): page loads in Safari, audio plays, 0 ENOMEM, phone held the hotspot for 300 s.
- The Bluetooth stack costs roughly 80 KB of internal RAM (boot free heap 259 KB without, 160 KB with).
- Separately, the 8x8 LED matrix driver costs about 13.5 KB internal heap (idle min free 6.8 KB with it, 20.4 KB without). It is segmented out of `env:radio-core2` into `env:radio-core2-matrix`; do not re-enable it as part of this.

## Why the obvious fixes do not work
- **SD card**: storage, not RAM. Nothing the network stack needs can live there.
- **PSRAM for lwIP pbufs**: this chip revision drops bytes on Wi-Fi copies out of PSRAM (it corrupted HTTP headers). `RUNTIME_PSRAM_THRESHOLD` is already set to 1600 so pbufs stay internal. Do not lower it.
- **Stop Bluetooth whenever a phone joins the hotspot**: works (it is the BT-off result) but is the compromise the owner wants to avoid, since the box speaker goes silent while someone is on the hotspot.

## What the owner wants
Hotspot page and phone playback working with Bluetooth still available, without a big loss of function. Find the best trade, measure it, and say plainly what it costs.

## Directions to evaluate (measure each, keep what pays)
1. Where the 80 KB goes: A2DP source buffers, controller memory, task stacks. Use `heap_caps_print_heap_info`, `esp_get_free_heap_size`, and per-task stack watermarks. Can BT controller/host memory go to PSRAM (`CONFIG_BT_ALLOCATION_FROM_SPIRAM_FIRST`, or the Arduino core's `btStart` variants), and can A2DP audio ring buffers use PSRAM? Bluetooth is not subject to the Wi-Fi PSRAM fault, only Wi-Fi/lwIP is.
2. BT only when needed: start the stack on demand (when a speaker is chosen or a song is sent to it) and release it after idle, rather than holding it from boot. Check `BT_RESTART_DELAY_MS` and the reboot-based toggle in `bt_speaker.cpp`; a clean runtime stop/start may not be possible on this core, in which case consider deferring start until after the hotspot is idle.
3. Wi-Fi memory: `CONFIG_ESP32_WIFI_STATIC_RX_BUFFER_NUM` / dynamic buffers, TX buffer type, lwIP `TCP_SND_BUF`, `MEMP_NUM_*`, max AP stations (`softAP(..., max_connection)` set to 1 or 2), AsyncTCP queue (`CONFIG_ASYNC_TCP_QUEUE_SIZE=128`) and stack (8192). The arduino-esp32 prebuilt libs limit what can change without a custom sdkconfig; check `pioarduino` custom sdkconfig options and what the 2.0.17 libs allow.
4. Hotspot-mode behaviour: limit concurrent connections, send the setup sheet a tiny page instead of the full shell (the shell is the large HTML/JS bundle), stop captive DNS replies from allocating under pressure, shed load when `ESP.getMaxAllocHeap()` drops below a threshold.
5. Trade variants if nothing else gives enough: pause BT only while a phone is actively loading the page, then resume; or drop A2DP buffering size during hotspot clients.

## Success criteria (all measured on the box, hotspot test build, owner's iPhone if possible)
- With Bluetooth ON and connected to the ML301, a phone joined to the hotspot loads the page in Safari and plays a song, with zero `could not send data: 12` lines over 5 minutes and `minFreeHeap` reported before and after.
- The ML301 keeps playing or reconnects normally after the phone leaves.
- Home behaviour unchanged: the box joins the saved network, page, pairing and playback work, 0 underruns. All native tests (`pio test -e native`, currently 169) and the JS/Python tests stay green.

## Test method and rules
- Bench builds ignore the saved network without erasing it: `env:radio-core2-nowifitest` (BT on) and `env:radio-core2-nowifitest-nobt`. Add a similar bench env for any variant; never leave one as the shipped firmware, and reflash `env:radio-core2` at the end.
- A Mac makes a poor hotspot client (macOS leaves a no-internet network after about a minute and disconnects the machine running the session). Use a phone, or a second Mac reached over the home network.
- Snapshot nothing on the XR18, do not touch `bt_speaker` behaviour beyond what this brief needs, do not change `partitions.csv`, do not erase flash, no matrix or Signal Jam work, do not commit. Delete any `tools/__pycache__` you create.
- Write findings into `HANDOFF.md` under "Borrowed from WLED" (new subsection), with the heap numbers before and after each change.
