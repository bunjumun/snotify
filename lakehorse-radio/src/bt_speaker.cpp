#include "bt_speaker.h"

#include "config.h"

#if !LAKEHORSE_BT

namespace btspeaker {
namespace {
const char* const kNotBuilt = "Bluetooth is not in this firmware build";
}
void begin(FillFn, KeyFn) {}
void tick() {}
bool enabled() { return false; }
bool needsModemSleep() { return false; }
bool connected() { return false; }
Info info() {
  Info i{};
  i.speaker = cfg::BT_SPEAKER_NAME;
  return i;
}
void scan() {}
String choose(const String&) { return kNotBuilt; }
void connect() {}
void disconnect() {}
String setEnabled(bool) { return kNotBuilt; }
bool isSetupBoot() { return false; }
void restart(bool) { ESP.restart(); }
}  // namespace btspeaker

#else

#include <Preferences.h>
#include <esp_gap_bt_api.h>
#include <esp_heap_caps.h>
#include <nvs.h>

#include <atomic>

#include "BluetoothA2DPSource.h"

namespace {

// Read before setup() runs (see btInUse below), so through the plain NVS API:
// nvs_flash_init has run by then, Preferences is not needed and not assumed.
bool savedOn() {
  nvs_handle_t h;
  if (nvs_open(cfg::BT_NVS_NAMESPACE, NVS_READONLY, &h) != ESP_OK) return true;
  uint8_t on = 1;
  nvs_get_u8(h, cfg::BT_NVS_KEY_ON, &on);
  nvs_close(h);
  return on != 0;
}

// A setup boot (setup_boot.h) skips Bluetooth for exactly one boot. The mark
// lives in RTC memory, which survives ESP.restart() but not a power cut, and
// nothing is written to flash: a box unplugged mid-setup comes back normal.
// The magic number makes a power-on's random RTC contents read as "not set".
constexpr uint32_t kSetupBootMagic = 0x5E7B00A1;
RTC_NOINIT_ATTR uint32_t g_setupBootMark;

bool setupMarked() { return g_setupBootMark == kSetupBootMagic; }

// What this boot actually runs: the saved setting, unless this is a setup boot.
bool runsThisBoot() { return savedOn() && !setupMarked(); }

}  // namespace

// The core frees Bluetooth Classic memory at boot unless the sketch claims it
// (initArduino, after nvs_flash_init). Claimed only when the saved setting is
// on: with Bluetooth off, the ~40 KB the controller reserves goes back to the
// heap. Without the claim, esp_bt_controller_init fails ESP_ERR_INVALID_STATE.
#if ESP_ARDUINO_VERSION_MAJOR >= 3
bool btClassicInUse(void) { return runsThisBoot(); }
#else
bool btInUse(void) { return runsThisBoot(); }
#endif

namespace btspeaker {
namespace {

// ESP32-A2DP keeps the levers this file needs protected. Nothing here changes
// its behaviour; these only expose what its own state machine already reads.
class BoxSource : public BluetoothA2DPSource {
 public:
  // The library restarts discovery every time it stops unless is_end is set.
  void keepSearching(bool v) { is_end = !v; }
  // Whether the 10 s heartbeat redials the last speaker's address.
  void allowRedial(bool v) { is_target_status_active = v; }
  bool discovering() { return discovery_active; }
  bool hasLastSpeaker() { return has_last_connection(); }
};

BoxSource g_src;
bool g_on = false;
// This boot skipped Bluetooth for network setup (setup_boot.h).
bool g_setupBoot = false;

constexpr size_t kNameLen = 64;
constexpr size_t kMaxFound = 8;
struct Slot {
  char name[kNameLen];
  int8_t rssi;
};

// Written by the Bluetooth task, read by the web server: one spinlock, held
// only for short copies.
portMUX_TYPE g_mux = portMUX_INITIALIZER_UNLOCKED;
Slot g_found[kMaxFound];
size_t g_foundCount = 0;
char g_target[kNameLen] = {0};

std::atomic<bool> g_wantConnect{true};
// Whether the library's remembered address belongs to g_target. False after
// choose() picks a new speaker, until that one has connected once.
std::atomic<bool> g_lastIsTarget{true};
std::atomic<uint32_t> g_scanUntil{0};
std::atomic<uint32_t> g_searchUntil{0};
std::atomic<bool> g_searchAfterDrop{false};
uint32_t g_restartAt = 0;

bool before(uint32_t until, uint32_t now) {
  return until != 0 && (int32_t)(until - now) > 0;
}

bool searchWanted(uint32_t now) {
  return before(g_scanUntil, now) ||
         (before(g_searchUntil, now) && !g_src.is_connected());
}

void record(const char* name, int rssi) {
  if (!name || !*name || strlen(name) >= kNameLen) return;
  portENTER_CRITICAL(&g_mux);
  size_t i = 0;
  while (i < g_foundCount && strcmp(g_found[i].name, name) != 0) i++;
  if (i == g_foundCount && g_foundCount < kMaxFound) {
    strcpy(g_found[i].name, name);
    g_foundCount++;
  }
  if (i < g_foundCount) g_found[i].rssi = (int8_t)rssi;
  portEXIT_CRITICAL(&g_mux);
}

bool isTarget(const char* name) {
  portENTER_CRITICAL(&g_mux);
  const bool match = strcmp(name, g_target) == 0;
  portEXIT_CRITICAL(&g_mux);
  return match;
}

// Bluetooth task: every audio-capable device discovery sees. True connects.
// Never while already connected: the library would dial over a live link.
bool onFound(const char* name, esp_bd_addr_t, int rssi) {
  record(name, rssi);
  return g_wantConnect && !g_src.is_connected() && isTarget(name);
}

// Bluetooth task, just before the library decides whether to search again.
void onDiscovery(esp_bt_gap_discovery_state_t state) {
  if (state == ESP_BT_GAP_DISCOVERY_STOPPED) g_src.keepSearching(searchWanted(millis()));
}

void onConnection(esp_a2d_connection_state_t state, void*) {
  Serial.printf("[box] speaker %s\n", g_src.to_str(state));
  if (state == ESP_A2D_CONNECTION_STATE_CONNECTED) {
    g_lastIsTarget = true;
    g_searchUntil = 0;
    g_src.allowRedial(true);  // a later drop redials this speaker
  }
}

void startDiscovery() {
  g_src.keepSearching(true);
  if (!g_src.discovering()) esp_bt_gap_start_discovery(ESP_BT_INQ_MODE_GENERAL_INQUIRY, 10, 0);
}

// Looks for g_target by name. The heartbeat must not redial meanwhile: it
// would dial the previous speaker's address.
void startSearch() {
  g_wantConnect = true;
  g_src.allowRedial(false);
  g_searchUntil = millis() + cfg::BT_SEARCH_MS;
  startDiscovery();
}

void saveTarget(const String& name) {
  Preferences prefs;
  if (!prefs.begin(cfg::BT_NVS_NAMESPACE, false)) return;
  prefs.putString(cfg::BT_NVS_KEY_SPEAKER, name);
  prefs.end();
}

}  // namespace

void begin(FillFn fill, KeyFn onKey) {
  g_on = runsThisBoot();
  g_setupBoot = setupMarked();
  // Read once and cleared at once, so the boot after this one is normal
  // whatever happens next.
  g_setupBootMark = 0;
  {
    Preferences prefs;
    String name = cfg::BT_SPEAKER_NAME;
    if (prefs.begin(cfg::BT_NVS_NAMESPACE, true)) {
      name = prefs.getString(cfg::BT_NVS_KEY_SPEAKER, name);
      prefs.end();
    }
    strlcpy(g_target, name.c_str(), kNameLen);
  }
  if (g_setupBoot) {
    Serial.println(F("[box] setup boot: bluetooth skipped so the hotspot can serve the setup page"));
    return;
  }
  if (!g_on) {
    Serial.println(F("[box] bluetooth is switched off (saved setting)"));
    return;
  }

  g_src.set_local_name(cfg::BT_LOCAL_NAME);
  // Secure Simple Pairing. ESP32-A2DP defaults it off; without it ML301
  // accepted the link and dropped A2DP ~6 s later (HANDOFF.md, Module 5).
  g_src.set_ssp_enabled(true);
  // Reconnect to the last speaker by address on boot, so once paired it comes
  // back without pairing mode. Falls back to discovery by name.
  g_src.set_auto_reconnect(true);
  g_src.set_ssid_callback(onFound);
  g_src.set_discovery_mode_callback(onDiscovery);
  g_src.set_on_connection_state_changed(onConnection);
  g_src.set_data_callback_in_frames(fill);
  // Without this the library never starts the AVRCP target, and the speaker's
  // buttons go nowhere.
  g_src.set_avrc_passthru_command_callback(onKey);
  // A boot with no remembered speaker searches, but not forever.
  g_searchUntil = millis() + cfg::BT_SEARCH_MS;
  Serial.printf("[box] before bt: free %u, largest %u\n", (unsigned)ESP.getFreeHeap(),
                (unsigned)ESP.getMaxAllocHeap());
  // See config.h: Bluedroid's structures go to PSRAM, nobody else's.
  heap_caps_malloc_extmem_enable(cfg::BT_START_PSRAM_THRESHOLD);
  g_src.start(g_target);
  delay(cfg::BT_START_SETTLE_MS);
  heap_caps_malloc_extmem_enable(cfg::RUNTIME_PSRAM_THRESHOLD);
  Serial.printf("[box] bluetooth up, looking for \"%s\": free %u, largest %u\n", g_target,
                (unsigned)ESP.getFreeHeap(), (unsigned)ESP.getMaxAllocHeap());
}

void tick() {
  if (g_restartAt && (int32_t)(millis() - g_restartAt) >= 0) {
    Serial.println(F("[box] restarting to apply the Bluetooth setting"));
    Serial.flush();
    ESP.restart();
  }
  if (!g_on) return;
  // A speaker change waits for the old link to finish dropping.
  if (g_searchAfterDrop && !g_src.is_connected()) {
    g_searchAfterDrop = false;
    startSearch();
  }
}

bool enabled() {
  static const bool on = savedOn();
  return on;
}

bool needsModemSleep() { return g_on; }

bool connected() { return g_on && g_src.is_connected(); }

Info info() {
  Info i{};
  i.built = true;
  i.on = g_on;
  const uint32_t now = millis();
  i.connected = g_on && g_src.is_connected();
  i.scanning = g_on && before(g_scanUntil, now);
  i.searching = g_on && !i.connected && (before(g_searchUntil, now) || g_searchAfterDrop);
  // Copied out raw: a String would allocate, and nothing may allocate with
  // the spinlock held.
  Slot copy[kMaxFound];
  char target[kNameLen];
  size_t n;
  portENTER_CRITICAL(&g_mux);
  n = g_foundCount;
  memcpy(copy, g_found, sizeof(copy));
  memcpy(target, g_target, sizeof(target));
  portEXIT_CRITICAL(&g_mux);
  i.speaker = target;
  for (size_t k = 0; k < n; k++) i.found.push_back({String(copy[k].name), copy[k].rssi});
  return i;
}

void scan() {
  if (!g_on) return;
  portENTER_CRITICAL(&g_mux);
  g_foundCount = 0;
  portEXIT_CRITICAL(&g_mux);
  g_scanUntil = millis() + cfg::BT_SCAN_MS;
  startDiscovery();
}

String choose(const String& name) {
  if (!g_on) return "Bluetooth is off";
  if (name.length() == 0 || name.length() >= kNameLen) return "that is not a speaker name";
  bool seen = isTarget(name.c_str());
  const bool same = seen;
  portENTER_CRITICAL(&g_mux);
  for (size_t k = 0; k < g_foundCount && !seen; k++) seen = strcmp(g_found[k].name, name.c_str()) == 0;
  portEXIT_CRITICAL(&g_mux);
  if (!seen) return "that speaker was not found; search again";

  if (same) {
    connect();
    return "";
  }
  portENTER_CRITICAL(&g_mux);
  strlcpy(g_target, name.c_str(), kNameLen);
  portEXIT_CRITICAL(&g_mux);
  saveTarget(name);
  g_lastIsTarget = false;
  g_wantConnect = true;
  Serial.printf("[box] speaker chosen: \"%s\"\n", name.c_str());
  if (g_src.is_connected()) {
    g_src.disconnect();
    g_searchAfterDrop = true;
  } else {
    startSearch();
  }
  return "";
}

void connect() {
  if (!g_on || g_src.is_connected()) return;
  g_wantConnect = true;
  if (g_lastIsTarget && g_src.hasLastSpeaker()) {
    g_src.allowRedial(true);  // the heartbeat dials it within 10 s
  } else {
    startSearch();
  }
}

void disconnect() {
  if (!g_on) return;
  g_wantConnect = false;
  g_searchUntil = 0;
  g_searchAfterDrop = false;
  g_src.disconnect();  // also stops the heartbeat redialling
}

bool isSetupBoot() { return g_setupBoot; }

void restart(bool forSetup) {
  g_setupBootMark = forSetup ? kSetupBootMagic : 0;
  Serial.println(forSetup ? F("[box] restarting without bluetooth for network setup")
                          : F("[box] restarting with bluetooth back"));
  Serial.flush();
  ESP.restart();
}

String setEnabled(bool on) {
  Preferences prefs;
  if (!prefs.begin(cfg::BT_NVS_NAMESPACE, false)) return "could not save the setting";
  prefs.putUChar(cfg::BT_NVS_KEY_ON, on ? 1 : 0);
  prefs.end();
  Serial.printf("[box] bluetooth switched %s; restarting\n", on ? "on" : "off");
  g_restartAt = millis() + cfg::BT_RESTART_DELAY_MS;
  if (g_restartAt == 0) g_restartAt = 1;
  return "";
}

}  // namespace btspeaker

#endif  // LAKEHORSE_BT
