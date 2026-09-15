#include "net_identity.h"

#include <ESPmDNS.h>
#include <WiFi.h>

#include "config.h"

namespace netid {
namespace {

bool g_advertising = false;

void startResponder() {
  // end() before begin() so a reconnect re-registers cleanly rather than
  // stacking a second responder on the first.
  MDNS.end();
  g_advertising = false;

  if (!MDNS.begin(cfg::MDNS_HOST)) {
    Serial.println(F("[mdns] responder failed to start"));
    return;
  }

  MDNS.setInstanceName(cfg::MDNS_INSTANCE);
  MDNS.addService("http", "tcp", cfg::HTTP_PORT);
  MDNS.addServiceTxt("http", "tcp", "fw", cfg::FIRMWARE_VERSION);

  g_advertising = true;
  Serial.printf("[mdns] advertising %s.local\n", cfg::MDNS_HOST);
}

void onGotIp(WiFiEvent_t, WiFiEventInfo_t) { startResponder(); }

void onDisconnected(WiFiEvent_t, WiFiEventInfo_t) { g_advertising = false; }

}  // namespace

void begin() {
  WiFi.onEvent(onGotIp, ARDUINO_EVENT_WIFI_STA_GOT_IP);
  WiFi.onEvent(onDisconnected, ARDUINO_EVENT_WIFI_STA_DISCONNECTED);
}

bool isAdvertising() { return g_advertising; }

}  // namespace netid
