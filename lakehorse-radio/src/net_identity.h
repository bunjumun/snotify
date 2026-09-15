#pragma once
//
// mDNS — being findable as lakehorse.local.
//
// This is its own file for one reason: the responder has to be restarted every
// time the station gets an address, and that is easy to get wrong in a way that
// looks like a network problem rather than a code problem.
//
// Two traps, both of them documented ESP32 behaviour rather than theory:
//
//   1. MDNS.begin() before the station has an IP silently does nothing. It does
//      not fail loudly, it just never answers a query. So this module listens
//      for GOT_IP itself rather than being called once from setup().
//   2. The responder does not reliably survive a reconnect. There is no
//      MDNS.update() on ESP32 (that is the ESP8266 API); calling begin() again
//      is the supported way to bring it back, so that is what happens on every
//      GOT_IP, not just the first.
//
#include <Arduino.h>

namespace netid {

// Registers the WiFi event handler. Safe to call before WiFi is up; the
// responder itself starts when an address arrives.
void begin();

bool isAdvertising();

}  // namespace netid
