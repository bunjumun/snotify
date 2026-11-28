#pragma once
//
// Lakehorse Radio — every tunable in the firmware, in one place.
//
// The band site's house rule is that a number lives in config with its
// rationale and is read at the use site, never hardcoded twice. Same rule
// here. If you find yourself typing a literal into a .cpp, it belongs in this
// file instead, with a sentence saying why it is that value.
//
#include <stddef.h>
#include <stdint.h>

namespace cfg {

// ---------- Identity ----------

// The mDNS name, WITHOUT the .local suffix. ESPmDNS appends it: pass
// "lakehorseradio" to be reachable at lakehorseradio.local. Passing the suffix
// here produces lakehorseradio.local.local, which resolves for nobody.
//
// This is only the DEFAULT. The name is settable from the setup page and kept
// in NVS, so more than one box can live on the same network without a clash.
constexpr const char* MDNS_HOST_DEFAULT = "lakehorseradio";
constexpr const char* MDNS_INSTANCE = "Lakehorse Radio";
constexpr size_t MDNS_HOST_MAX_LEN = 32;
constexpr const char* NVS_KEY_HOST = "host";

// The SoftAP the box falls back to whenever it has no saved network, or
// hasn't yet reached the one it has (see AP_TEARDOWN_ON_CONNECT below).
// Deliberately open, with no password: it is a jukebox in a barn, the only
// thing reachable on it is this firmware, and a password on the AP is one
// more thing to tell people at a gig.
constexpr const char* AP_SSID = "Lakehorse Radio";
constexpr const char* AP_PASSWORD = nullptr;

constexpr const char* FIRMWARE_VERSION = "1.0.0";

// ---------- Networking ----------

constexpr uint16_t HTTP_PORT = 80;
constexpr uint16_t DNS_PORT = 53;

// How long to wait for a saved network before giving up on this attempt.
// Deliberately generous: a barn router that has just been power-cycled can take
// a while to hand out a lease.
constexpr uint32_t STA_CONNECT_TIMEOUT_MS = 20000;

// How long a first connection attempt runs before the hotspot is raised as a
// way back in. WLED uses 12 seconds for the same decision and it is a good
// number: long enough that a healthy join is never interrupted, short enough
// that a box with a wrong password is reachable before anyone gives up on it.
constexpr uint32_t AP_FALLBACK_AFTER_MS = 12000;

// The hotspot's channel. Passing one explicitly is not optional, and omitting
// it is what broke this firmware's first version. The ESP32 has one radio and
// one tuner, so an access point and a station cannot sit on different channels;
// a SoftAP started with no channel argument silently takes channel 1 and then
// fights every attempt to join a network on any other channel. The symptom is
// an endless WPA handshake timeout that looks exactly like a wrong password.
//
// It only matters when both run at once, which after this rewrite is rare, but
// leaving it implicit is how the bug got in.
constexpr uint8_t AP_CHANNEL = 1;

// The hotspot exists as a fallback, not as a permanent fixture. It comes up
// when there is no saved network, or when the first attempt to reach one has
// failed, and it is torn down the moment the box joins a network. That is
// WLED's AP_BEHAVIOR_BOOT_NO_CONN, and it is the arrangement that keeps the
// tuner free for the job that matters.
constexpr bool AP_TEARDOWN_ON_CONNECT = true;

// WLED's own value for the settle time it gives the radio on each side of a
// WiFi.mode(WIFI_MODE_NULL) reset: "wait for hardware to be ready" before the
// mode change, "give the WiFi stack time to complete the mode transition"
// after it. Copied rather than guessed, same as the reset itself.
constexpr uint32_t WIFI_MODE_TRANSITION_DELAY_MS = 5;

// How long the boot-time diagnostic scan lingers on each channel while
// looking for the saved network, so it can log that network's channel next
// to the SoftAP's before either radio role has actually started. Matches the
// WiFi library's own default dwell time; named here so it is not a bare
// literal repeated at the call site, not because the value itself is tuned.
constexpr uint32_t WIFI_SCAN_DWELL_MS = 300;

// After a disconnect, how long before trying the saved network again. Long
// enough not to hammer a router that is genuinely down, short enough that the
// box rejoins on its own after a power cut without anyone touching it.
constexpr uint32_t STA_RETRY_INTERVAL_MS = 30000;
// After Join or Use now: keep retrying the chosen network this often, for this
// long, so the owner can switch to their phone's hotspot screen (hotspot_retry.h).
constexpr uint32_t STA_RETRY_DURING_JOIN_MS = 4000;
constexpr uint32_t JOIN_KEEP_TRYING_MS = 180000;
// Retry interval while a phone is joined to the box's own hotspot (see
// hotspot_retry.h). WLED waits five minutes in the same situation.
constexpr uint32_t STA_RETRY_INTERVAL_WITH_AP_CLIENT_MS = 300000;

// How many networks the box remembers (saved_networks.h). Home, a venue or
// two and a phone hotspot fit; each costs two small NVS strings. Slot 0 uses
// the original NVS_KEY_SSID / NVS_KEY_PASS keys so the network saved before
// the list existed is kept; slot n uses those keys with n appended.
constexpr size_t SAVED_NETWORKS_MAX = 5;

// With Bluetooth on, the box's own hotspot cannot serve pages (internal heap),
// so a phone joining it restarts the box once without Bluetooth (setup_boot.h).
// In that setup boot: how long the box stays on a newly joined network before
// restarting with Bluetooth back, long enough for the setup page to read and
// show its new address...
constexpr uint32_t SETUP_JOINED_HOLD_MS = 20000;
// ...and how long the hotspot may sit empty before giving up on setup and
// restarting with Bluetooth back.
constexpr uint32_t SETUP_EMPTY_LIMIT_MS = 180000;
// How long the hotspot stays up after the station joins a network, so a
// phone that set it up can still read the box's new address before it goes.
constexpr uint32_t AP_TEARDOWN_GRACE_MS = 15000;

// Pairing from any network (pair_window.h): the dev board's BOOT button,
// how long to hold it, and how long the window stays open.
constexpr uint8_t PAIR_BUTTON_PIN = 0;
constexpr uint32_t PAIR_HOLD_MS = 3000;
constexpr uint32_t PAIR_WINDOW_MS = 120000;

// ---------- Playlist limits ----------
//
// These are validation boundaries, not preferences. Anything arriving at
// POST /api/playlist is untrusted: it comes off the network from whoever can
// reach the box. Every one of these is a rejection threshold.

// A generous ceiling on the request body. The real playlists are a few KB;
// this is sized so a malicious or buggy client cannot make us allocate the
// heap away, while leaving room for a catalogue far larger than the band has.
constexpr size_t PLAYLIST_MAX_BYTES = 16384;

constexpr size_t PLAYLIST_MAX_TRACKS = 200;
constexpr size_t TRACK_TITLE_MAX_LEN = 200;
constexpr size_t TRACK_URL_MAX_LEN = 1024;

// Audio must be HTTPS. Not style: the player page is served over plain HTTP
// from this box, so an http:// audio URL would work today and break the moment
// anyone opens the same player from the HTTPS band site, where the browser
// blocks it as mixed content. Rejecting it here means the failure surfaces
// when the playlist is pushed, with a message, rather than as silence later.
constexpr const char* REQUIRED_URL_PREFIX = "https://";

// ---------- Storage ----------

constexpr const char* PLAYLIST_PATH = "/playlist.json";
// Written first, then renamed over the live file, so a power cut during a
// write leaves the previous playlist intact rather than a half-written one.
constexpr const char* PLAYLIST_TMP_PATH = "/playlist.json.tmp";

// ---------- SD card (music stored on the box) ----------
//
// Wiring on VSPI, proven by sd-test: CS=5, MOSI=23, MISO=19, SCK=18. GPIO12 is
// avoided because it is a boot strapping pin, and 16/17 because the WROVER's
// PSRAM sits on them.
constexpr uint8_t SD_PIN_CS = 5;
constexpr uint8_t SD_PIN_MOSI = 23;
constexpr uint8_t SD_PIN_MISO = 19;
constexpr uint8_t SD_PIN_SCK = 18;

// sd-test mounted at 4 MHz to be safe. 10 MHz is a compromise: roughly twice
// as fast for a 100 MB upload, and still forgiving of jumper-wire wiring.
// Raise it only with short wires; corruption shows up as failed writes.
constexpr uint32_t SD_SPI_HZ = 10000000;

// Everything uploaded lives in one folder, so the rest of the card (macOS's
// .Spotlight-V100 and friends) is never listed, served or deleted by the API.
constexpr const char* SD_MUSIC_DIR = "/music";
// Where an upload lands until it is complete. Renamed over the real name only
// on the last byte, so a dropped connection never leaves a half-file that
// looks like a finished track.
constexpr const char* SD_PART_SUFFIX = ".part";
// FAT long names allow 255, but this bounds the URL and the JSON listing.
constexpr size_t TRACK_FILE_NAME_MAX_LEN = 100;
// Most files a listing will report; bounds the JSON document's size.
constexpr size_t SD_LIST_MAX_FILES = 200;
// Uploading from the page is built and works (a raw-body POST, about 220 KB/s
// over Wi-Fi, so a 100 MB mix takes around 8 minutes) but is off in this
// version: songs go onto the card from a computer, in the /music folder. Turn it
// on for the next version.
constexpr bool SD_UPLOAD_ENABLED = true;
// Whether uploading and deleting songs needs the pairing key. Off while the box
// is being tried out on a home network, where anyone who can reach it is
// someone you let in. Turn it on before the box goes anywhere shared: with it
// off, anyone on the network can fill or empty the card.
constexpr bool SD_WRITES_NEED_KEY = false;

// Whether changing the box's Wi-Fi (join, use, forget) needs the pairing key or
// the box's own hotspot. Off while the box is being built and tried out on a
// home network, so the owner is never locked out of the network window by a
// forgotten key or a cleared browser. Turn it on before the box goes anywhere
// shared: with it off, anyone on the same network can change which Wi-Fi it uses.
constexpr bool NETWORK_CHANGES_NEED_KEY = false;
// Uploads are gathered into blocks this big before touching the card. A
// multiple of the 512-byte sector, and big enough to amortise the card's
// per-write overhead without costing much RAM.
constexpr size_t SD_WRITE_BLOCK_BYTES = 16384;
// How much of a song is read from the card at once while it is being sent.
// Allocated per listener for the length of the song; 16 KB reads measured
// about 1 MB/s from this card, far above what Wi-Fi can carry.
constexpr size_t SD_READ_BLOCK_BYTES = 16384;
// URL prefix the stored files are served under.
constexpr const char* SD_URL_PREFIX = "/sd/";
// The browser game (Lakehorse Swimulator) is plain files in <SD>/game/, served
// under /game/. Flash holds only the page; anything big lives on the card.
constexpr const char* SD_GAME_DIR = "/game";
constexpr const char* GAME_URL_PREFIX = "/game/";
constexpr size_t GAME_PATH_MAX_LEN = 120;
// Revalidate each visit: a replaced file must show up, and an ETag-less
// stream cannot be revalidated, so keep it short rather than immutable.
constexpr const char* GAME_CACHE_CONTROL = "public, max-age=3600";

// ---------- Playing on the box (Bluetooth A2DP out to a speaker) ----------
// Wi-Fi modem sleep is now decided at run time: btspeaker::needsModemSleep().
// IDF 4.4 requires it whenever Bluetooth is running, and it is off otherwise
// for mDNS reliability (wifi_manager.cpp).
// Serial heartbeat interval (main.cpp): heap and Wi-Fi state, for diagnosis.
constexpr uint32_t HEARTBEAT_MS = 2000;
// Most unacknowledged bytes one HTTP connection may queue in a Bluetooth
// build (send_window.h). Two segments: ESPAsyncWebServer will not send the
// next part of a large response until it has room for two whole segments
// (ASYNC_RESPONCE_BUFF_SIZE), so anything smaller stalls big files for good.
constexpr uint16_t HTTP_SEND_WINDOW = 2 * 1436;
// Bluetooth's own structures go to PSRAM, and nothing else's. While the stack
// starts, malloc() requests of this size and up go to PSRAM first; after it,
// the core default (CONFIG_SPIRAM_MALLOC_ALWAYSINTERNAL, 4096) comes back.
// Why so narrow, both found 2026-11-22:
//   - with the default throughout, Bluetooth left 12 KB of internal RAM and
//     Bluedroid asserted out of memory connecting to the speaker;
//   - with 32 throughout, internal RAM was fine (74 KB) but the box crashed
//     under page loads: "CORRUPT HEAP: Bad tail", a zero byte past a LittleFS
//     file handle in PSRAM, every time. This board is ESP32 rev v1.0, the
//     revision with the PSRAM cache bug, and the compiler workaround does not
//     cover every case. Small, busy structures in PSRAM are not safe on it.
// Bluetooth started this way streamed cleanly in the same tests.
constexpr size_t BT_START_PSRAM_THRESHOLD = 32;
// After Bluetooth is up: buffers of this size and up (the web server's 2.9 KB
// send buffers, the 16 KB SD read blocks) go to PSRAM; everything smaller stays
// internal. That includes lwIP's TCP segments (pbufs, at most ~1,508 bytes:
// 72 of header room plus a 1,436-byte MSS), and it MUST: this was 1024 until
// 2026-11-23, which put every full segment in PSRAM, and on this rev v1.0 chip
// the Wi-Fi driver's copy out of a PSRAM pbuf drops bytes. The last (length
// mod 4) bytes of a response's header block arrived as zeros (that was the
// "header length matters" bug noted in web_server.cpp) and bodies came back
// short, deterministically per file: /game/index.html, three.core, config.js
// failed every time. Small structures such as LittleFS file handles, seen
// corrupted in PSRAM, stay internal as before.
constexpr size_t RUNTIME_PSRAM_THRESHOLD = 1600;
// Bluedroid finishes its profile setup on its own task after start()
// returns; the low threshold is held this long so that lands in PSRAM too.
constexpr uint32_t BT_START_SETTLE_MS = 1500;
// Bluetooth's own saved settings (bt_speaker.h), apart from the Wi-Fi ones.
constexpr const char* BT_NVS_NAMESPACE = "lh_bt";
constexpr const char* BT_NVS_KEY_ON = "on";
constexpr const char* BT_NVS_KEY_SPEAKER = "spk";
// The box's volume, saved in thousandths so it survives a power cut. Same
// namespace: it is the speaker's volume, not the page's.
constexpr const char* BT_NVS_KEY_VOLUME = "vol";
// The volume is written this long after the last change, so dragging the
// slider (a request per movement) costs one flash write, not hundreds.
constexpr uint32_t BOX_VOLUME_SAVE_DELAY_MS = 2000;
// When a song ends, the box starts the next one on the card by itself, in
// the page's order (track_order.h), and stops after the last. Without it the
// box went quiet after one song unless a page was open to say what is next.
constexpr bool BOX_AUTO_ADVANCE = true;
// Songs tried in a row before giving up, so one unplayable file (a format
// the box refuses) is skipped rather than ending the run.
constexpr int BOX_ADVANCE_TRIES = 5;
// "Find speakers" listens this long: one full inquiry (10 x 1.28 s) plus a
// little. Inquiry slows Wi-Fi while it runs, so it is never open-ended.
constexpr uint32_t BT_SCAN_MS = 14000;
// How long the box looks for the chosen speaker by name before giving up
// until asked again (a speaker not in pairing mode never answers).
constexpr uint32_t BT_SEARCH_MS = 60000;
// Pause between saving the Bluetooth on/off setting and restarting, so the
// reply reaches the page first.
constexpr uint32_t BT_RESTART_DELAY_MS = 800;
// The default speaker's advertised name, exact case: ESP32-A2DP matches it with
// strcmp, and "ml301" was never found while "ML301" was (HANDOFF.md, Module 5).
constexpr const char* BT_SPEAKER_NAME = "ML301";
// Name the box shows to other Bluetooth devices.
constexpr const char* BT_LOCAL_NAME = "Lakehorse Radio";
// PCM queued between the card and the speaker, in 44.1 kHz stereo frames,
// held in PSRAM. Two seconds rides out a slow card read or a burst of web
// traffic on the card's SPI bus; it costs 352 KB of the 4 MB PSRAM.
constexpr size_t BOX_RING_FRAMES = 88200;
// Sound starts once this much is queued, so a song does not open on a gap.
constexpr size_t BOX_PRIME_FRAMES = 22050;
// Bytes read from the card per pass. Internal RAM (the SD driver copies from
// it), so kept small; 4 KB is 23 ms of 48 kHz stereo.
constexpr size_t BOX_READ_BYTES = 4096;
// The reader task: core 1 beside AsyncTCP, since Bluetooth and Wi-Fi share
// core 0. Below AsyncTCP's priority so a page load is never starved.
constexpr uint32_t BOX_READER_STACK = 6144;
constexpr uint32_t BOX_READER_PRIORITY = 2;
constexpr int BOX_READER_CORE = 1;
// Reader sleep when there is nothing to do (buffer full, paused, stopped).
constexpr uint32_t BOX_READER_IDLE_MS = 10;

// ---------- Wi-Fi watchdog (net_watchdog.h, link_watch.h) ----------
// How often the gateway is pinged. Fifteen seconds puts a deaf box back on
// the network within about a minute and a half, for a few hundred bytes of
// traffic a minute.
constexpr uint32_t WATCH_PROBE_EVERY_MS = 15000;
// One probe is this many pings; any single reply counts as alive, so one
// dropped packet under modem sleep (RTT ~100 ms) is never mistaken for a wedge.
constexpr uint32_t WATCH_PINGS_PER_PROBE = 3;
constexpr uint32_t WATCH_PING_INTERVAL_MS = 300;
constexpr uint32_t WATCH_PING_TIMEOUT_MS = 1500;
// A probe whose end never arrives is counted as failed after this long.
constexpr uint32_t WATCH_PROBE_DEADLINE_MS = 10000;
// Failed probes in a row before rejoining Wi-Fi (45 s at the rate above):
// long enough to ride out a router briefly busy, short enough to matter.
constexpr uint8_t WATCH_FAILS_TO_RECONNECT = 3;
// Rejoins that may go unanswered before a restart. One: rejoining is free
// and keeps the song, but if it did not work once, a second try rarely does.
constexpr uint8_t WATCH_RECONNECTS_BEFORE_RESTART = 1;

// NVS namespace holding the saved Wi-Fi credentials. Nothing else goes here.
constexpr const char* NVS_NAMESPACE = "lakehorse";
constexpr const char* NVS_KEY_SSID = "ssid";
constexpr const char* NVS_KEY_PASS = "pass";
// Fingerprint of the last wifi_defaults.h applied, so it is applied once per
// change of that file rather than on every boot. See wifi_seed.h.
constexpr const char* NVS_KEY_SEED = "seed";

// ---- Small card files (POST /api/sd/card-file, src/card_files.h) ----
// The ONLY names the box will write at the card root over Wi-Fi. Exact,
// case-sensitive, no folders, no deletes. Add a name here and a content check in
// card_files.cpp together; a name with no check is refused.
constexpr const char* CARD_FILE_NAMES[] = {"band-tracks.json", "guestbook.json"};
// Largest body accepted, and it is held in RAM for the length of the request, so it
// is small on purpose (a body over the 1600-byte PSRAM threshold lives in PSRAM, not
// the scarce internal heap). The cap is the largest of the per-file limits below.
constexpr size_t CARD_FILE_MAX_BYTES = 12288;
// band-tracks.json stays at 4 KB: that is what alignment_box.cpp is willing to read back
// (kBandListMaxBytes), so a bigger list would upload fine and then flag nothing.
constexpr size_t BAND_FILE_MAX_BYTES = 4096;
// guestbook.json (GET /api/guestbook, written by the page through card-file): the page
// keeps live + trashed entries at or under GUESTBOOK_MAX_ENTRIES, so the file fits the cap.
constexpr size_t GUESTBOOK_MAX_ENTRIES = 40;
constexpr size_t GUESTBOOK_HANDLE_MAX = 24;
constexpr size_t GUESTBOOK_IMAGE_MAX_BYTES = 8192;  // one small JPEG per entry: gbimg-<id>.jpg
constexpr size_t GUESTBOOK_MESSAGE_MAX = 240;  // bytes; the page allows 140 characters

}  // namespace cfg
