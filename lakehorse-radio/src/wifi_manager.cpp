#include "wifi_manager.h"

#include <Preferences.h>
#include <WiFi.h>

#include "config.h"

namespace wifinet {
namespace {

StationState g_state = StationState::Idle;
String g_ssid;
uint32_t g_lastAttemptMs = 0;
bool g_haveSaved = false;

// Why the last attempt failed, in the radio's own words, kept so the setup page
// can say "the password was not accepted" instead of nothing at all. A box that
// fails silently is indistinguishable from a box that is still trying.
uint8_t g_lastReason = 0;

// Reconfiguring the radio is deliberately NOT done inside the HTTP handler.
// The station refuses a new config while it is mid-association ("sta is
// connecting, cannot set config"), so a provisioning request that lands during
// a retry was simply dropped. These two carry the request out to tick(), which
// disconnects first, waits, and only then begins.
bool g_reconnectPending = false;

// True from the moment begin() is called until the radio reports either an
// address or a failure.
//
// A timer cannot substitute for this, and trying one was the bug: the station
// stays in its connecting state for the whole WPA handshake, which on a
// rejected password runs a full ten seconds before it times out. Any begin()
// inside that window is refused outright with ESP_ERR_WIFI_STATE and thrown
// away, so a retry or a freshly typed password did nothing at all. Waiting on
// the radio's own events is the only thing that is actually true.
bool g_associating = false;

Preferences g_prefs;

// Reads the saved credentials out of NVS. The password is handed straight to
// WiFi.begin() and deliberately never stored in a longer-lived String than it
// has to be, never printed, and never exposed by any HTTP route.
bool readSaved(String& ssid, String& password) {
  if (!g_prefs.begin(cfg::NVS_NAMESPACE, /*readOnly=*/true)) return false;
  // isKey() first: getString() on a missing key logs an ERROR line from the
  // Preferences library itself, so a perfectly normal first boot prints two
  // scary-looking errors. Checking first keeps a clean boot log actually clean,
  // which matters because that log is how anyone diagnoses this box.
  const bool present = g_prefs.isKey(cfg::NVS_KEY_SSID);
  ssid = present ? g_prefs.getString(cfg::NVS_KEY_SSID, "") : String();
  password = (present && g_prefs.isKey(cfg::NVS_KEY_PASS))
                 ? g_prefs.getString(cfg::NVS_KEY_PASS, "")
                 : String();
  g_prefs.end();
  return ssid.length() > 0;
}

void attemptSaved() {
  String ssid, password;
  if (!readSaved(ssid, password)) {
    g_haveSaved = false;
    g_state = StationState::Idle;
    return;
  }

  g_haveSaved = true;

  // Refuse to begin() on top of an association already in flight. The caller
  // leaves the request pending and tick() comes back once the radio has
  // settled one way or the other.
  if (g_associating) return;

  g_ssid = ssid;
  g_state = StationState::Connecting;
  g_lastAttemptMs = millis();
  g_associating = true;

  Serial.printf("[wifi] trying saved network \"%s\"\n", ssid.c_str());
  WiFi.begin(ssid.c_str(), password.c_str());
}

// The handful of reasons that actually happen in a barn, in plain words. The
// rest fall through to a number, which is still better than silence.
const char* describeReason(uint8_t reason) {
  switch (reason) {
    case WIFI_REASON_NO_AP_FOUND:
      return "that network was not found";
    case WIFI_REASON_AUTH_FAIL:
    case WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT:
    case WIFI_REASON_HANDSHAKE_TIMEOUT:
      return "the password was not accepted";
    case WIFI_REASON_AUTH_EXPIRE:
      return "the network dropped the connection";
    case WIFI_REASON_BEACON_TIMEOUT:
      return "the network went out of range";
    default:
      return "could not join";
  }
}

void onWiFiEvent(WiFiEvent_t event, WiFiEventInfo_t info) {
  switch (event) {
    case ARDUINO_EVENT_WIFI_STA_GOT_IP:
      g_state = StationState::Connected;
      g_lastReason = 0;
      g_associating = false;
      Serial.printf("[wifi] joined \"%s\" as %s\n",
                    g_ssid.c_str(), WiFi.localIP().toString().c_str());
      break;

    case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
      // Distinguish "never got on" from "was on and dropped", because only the
      // second is worth shouting about. Either way the retry timer in tick()
      // picks it up; we do not reconnect from inside the event handler, which
      // runs on the event task and should not block.
      g_associating = false;
      g_lastReason = info.wifi_sta_disconnected.reason;
      Serial.printf("[wifi] not connected: %s (reason %u)\n",
                    describeReason(g_lastReason), (unsigned)g_lastReason);
      g_state = StationState::Failed;
      break;

    default:
      break;
  }
}

}  // namespace

void begin() {
  // AP first and unconditionally, so that a box with a wrong password saved is
  // still reachable to be corrected. If this ran after the station attempt, a
  // bad saved network would leave no way in for twenty seconds.
  WiFi.mode(WIFI_AP_STA);

  // Modem sleep makes mDNS replies unreliable: the radio is asleep when the
  // query arrives and the box simply does not answer, which presents as
  // "lakehorse.local sometimes works". Costs power we are not saving anyway,
  // since this thing is mains-powered.
  WiFi.setSleep(false);

  WiFi.onEvent(onWiFiEvent);

  const bool apUp = (cfg::AP_PASSWORD == nullptr)
                        ? WiFi.softAP(cfg::AP_SSID)
                        : WiFi.softAP(cfg::AP_SSID, cfg::AP_PASSWORD);
  if (!apUp) {
    // Nothing else in this firmware can recover from this, and a box with no
    // AP and no saved network is a brick with a power light. Say so.
    Serial.println(F("[wifi] the access point failed to start"));
  } else {
    Serial.printf("[wifi] access point \"%s\" up at %s\n",
                  cfg::AP_SSID, WiFi.softAPIP().toString().c_str());
  }

  attemptSaved();
}

void tick() {
  // A pending reconnect is handled first and out here, never in the request
  // handler that asked for it.
  if (g_reconnectPending) {
    // Wait out whatever is in flight. Nothing else here can make that faster,
    // and interrupting it is what produced ESP_ERR_WIFI_STATE.
    if (g_associating) return;
    g_reconnectPending = false;
    attemptSaved();
    return;
  }

  if (g_state == StationState::Connected) return;
  if (!g_haveSaved) return;

  const uint32_t now = millis();

  if (g_state == StationState::Connecting) {
    // Subtraction on unsigned millis is correct across the 49-day rollover;
    // comparing the timestamps directly would not be.
    if (now - g_lastAttemptMs < cfg::STA_CONNECT_TIMEOUT_MS) return;
    Serial.println(F("[wifi] saved network did not answer in time"));
    g_state = StationState::Failed;
    g_lastAttemptMs = now;
    return;
  }

  if (now - g_lastAttemptMs < cfg::STA_RETRY_INTERVAL_MS) return;

  // Route the retry through the same disconnect-then-settle path a provisioning
  // request uses. Calling attemptSaved() straight from here hit exactly the
  // same wall ("sta is connecting, cannot set config"): the previous attempt is
  // often still associating when the retry timer fires, so the retry was being
  // thrown away and the box just kept failing on the original attempt.
  g_lastAttemptMs = now;
  g_reconnectPending = true;
}

bool provision(const String& ssid, const String& password) {
  if (ssid.length() == 0) return false;

  if (!g_prefs.begin(cfg::NVS_NAMESPACE, /*readOnly=*/false)) {
    Serial.println(F("[wifi] could not open NVS to save credentials"));
    return false;
  }
  const bool okSsid = g_prefs.putString(cfg::NVS_KEY_SSID, ssid) > 0;
  // An open network has an empty password, so a zero-length write is a success
  // here and must not be treated as a failure.
  g_prefs.putString(cfg::NVS_KEY_PASS, password);
  g_prefs.end();

  if (!okSsid) {
    Serial.println(F("[wifi] writing the SSID to NVS failed"));
    return false;
  }

  attemptSaved();
  return true;
}

bool forget() {
  if (!g_prefs.begin(cfg::NVS_NAMESPACE, /*readOnly=*/false)) return false;
  g_prefs.remove(cfg::NVS_KEY_SSID);
  g_prefs.remove(cfg::NVS_KEY_PASS);
  g_prefs.end();

  g_haveSaved = false;
  g_state = StationState::Idle;
  g_ssid = "";
  g_reconnectPending = false;
  WiFi.disconnect(/*wifioff=*/false, /*eraseap=*/true);
  return true;
}

StationState stationState() { return g_state; }
uint8_t lastFailureReason() { return g_lastReason; }
const char* lastFailureText() {
  return g_lastReason ? describeReason(g_lastReason) : "";
}
String stationSsid() { return g_ssid; }
String stationIp() {
  return g_state == StationState::Connected ? WiFi.localIP().toString() : String();
}
String accessPointIp() { return WiFi.softAPIP().toString(); }
bool hasSavedNetwork() { return g_haveSaved; }

}  // namespace wifinet
