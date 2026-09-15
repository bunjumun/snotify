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
  g_ssid = ssid;
  g_state = StationState::Connecting;
  g_lastAttemptMs = millis();

  Serial.printf("[wifi] trying saved network \"%s\"\n", ssid.c_str());
  WiFi.begin(ssid.c_str(), password.c_str());
}

void onWiFiEvent(WiFiEvent_t event, WiFiEventInfo_t info) {
  switch (event) {
    case ARDUINO_EVENT_WIFI_STA_GOT_IP:
      g_state = StationState::Connected;
      Serial.printf("[wifi] joined \"%s\" as %s\n",
                    g_ssid.c_str(), WiFi.localIP().toString().c_str());
      break;

    case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
      // Distinguish "never got on" from "was on and dropped", because only the
      // second is worth shouting about. Either way the retry timer in tick()
      // picks it up; we do not reconnect from inside the event handler, which
      // runs on the event task and should not block.
      if (g_state == StationState::Connected) {
        Serial.println(F("[wifi] dropped the network, will retry"));
      }
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
  attemptSaved();
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

  WiFi.disconnect(/*wifioff=*/false, /*eraseap=*/true);
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
  WiFi.disconnect(/*wifioff=*/false, /*eraseap=*/true);
  return true;
}

StationState stationState() { return g_state; }
String stationSsid() { return g_ssid; }
String stationIp() {
  return g_state == StationState::Connected ? WiFi.localIP().toString() : String();
}
String accessPointIp() { return WiFi.softAPIP().toString(); }
bool hasSavedNetwork() { return g_haveSaved; }

}  // namespace wifinet
