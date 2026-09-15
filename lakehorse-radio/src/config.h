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

// The SoftAP the box always broadcasts. Deliberately open, with no password:
// it is a jukebox in a barn, the only thing reachable on it is this firmware,
// and a password on the AP is one more thing to tell people at a gig.
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

// NVS namespace holding the saved Wi-Fi credentials. Nothing else goes here.
constexpr const char* NVS_NAMESPACE = "lakehorse";
constexpr const char* NVS_KEY_SSID = "ssid";
constexpr const char* NVS_KEY_PASS = "pass";

}  // namespace cfg
