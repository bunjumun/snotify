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
constexpr bool SD_UPLOAD_ENABLED = false;
// Whether uploading and deleting songs needs the pairing key. Off while the box
// is being tried out on a home network, where anyone who can reach it is
// someone you let in. Turn it on before the box goes anywhere shared: with it
// off, anyone on the network can fill or empty the card.
constexpr bool SD_WRITES_NEED_KEY = false;
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

// NVS namespace holding the saved Wi-Fi credentials. Nothing else goes here.
constexpr const char* NVS_NAMESPACE = "lakehorse";
constexpr const char* NVS_KEY_SSID = "ssid";
constexpr const char* NVS_KEY_PASS = "pass";
// Fingerprint of the last wifi_defaults.h applied, so it is applied once per
// change of that file rather than on every boot. See wifi_seed.h.
constexpr const char* NVS_KEY_SEED = "seed";

}  // namespace cfg
