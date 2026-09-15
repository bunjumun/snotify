#include "net_identity.h"

#include <ESPmDNS.h>
#include <Preferences.h>
#include <WiFi.h>

#include "config.h"
#include "hostname_rules.h"

namespace netid {
namespace {

bool g_advertising = false;
String g_host;

String readSavedHost() {
  Preferences prefs;
  if (!prefs.begin(cfg::NVS_NAMESPACE, /*readOnly=*/true)) return String();
  const String saved =
      prefs.isKey(cfg::NVS_KEY_HOST) ? prefs.getString(cfg::NVS_KEY_HOST, "") : String();
  prefs.end();
  return saved;
}

void startResponder() {
  // end() before begin() so a reconnect re-registers cleanly rather than
  // stacking a second responder on the first.
  MDNS.end();
  g_advertising = false;

  if (!MDNS.begin(g_host.c_str())) {
    Serial.println(F("[mdns] responder failed to start"));
    return;
  }

  MDNS.setInstanceName(cfg::MDNS_INSTANCE);
  MDNS.addService("http", "tcp", cfg::HTTP_PORT);
  MDNS.addServiceTxt("http", "tcp", "fw", cfg::FIRMWARE_VERSION);

  g_advertising = true;
  Serial.printf("[mdns] advertising %s.local\n", g_host.c_str());
}

void onGotIp(WiFiEvent_t, WiFiEventInfo_t) { startResponder(); }

void onDisconnected(WiFiEvent_t, WiFiEventInfo_t) { g_advertising = false; }

}  // namespace

void begin() {
  g_host = readSavedHost();
  if (g_host.length() == 0) g_host = cfg::MDNS_HOST_DEFAULT;
  Serial.printf("[mdns] this box answers to %s.local\n", g_host.c_str());

  WiFi.onEvent(onGotIp, ARDUINO_EVENT_WIFI_STA_GOT_IP);
  WiFi.onEvent(onDisconnected, ARDUINO_EVENT_WIFI_STA_DISCONNECTED);
}

String hostname() { return g_host; }

const char* setHostname(const String& wanted) {
  char clean[cfg::MDNS_HOST_MAX_LEN + 1];
  const hostrules::Result verdict =
      hostrules::normalise(wanted.c_str(), clean, cfg::MDNS_HOST_MAX_LEN);
  if (verdict != hostrules::Result::Ok) return hostrules::describe(verdict);

  Preferences prefs;
  if (!prefs.begin(cfg::NVS_NAMESPACE, /*readOnly=*/false)) {
    return "could not save the name";
  }
  prefs.putString(cfg::NVS_KEY_HOST, clean);
  prefs.end();

  g_host = clean;
  Serial.printf("[mdns] renamed to %s.local\n", g_host.c_str());

  // Re-advertise straight away, but only if the station is actually up. The
  // responder cannot start without an address, and calling begin() without one
  // fails silently rather than erroring.
  if (WiFi.status() == WL_CONNECTED) startResponder();
  return nullptr;
}

bool isAdvertising() { return g_advertising; }

}  // namespace netid
