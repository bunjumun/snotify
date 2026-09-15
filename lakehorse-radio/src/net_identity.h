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

// Loads the saved hostname and registers the WiFi event handler. Safe to call
// before WiFi is up; the responder itself starts when an address arrives.
void begin();

// The name this box answers to, without the .local suffix.
String hostname();

// Validates, stores and immediately re-advertises. Returns an error string on
// a bad name, or nullptr on success, so the caller can tell the user WHY the
// name was refused rather than just that it was.
const char* setHostname(const String& wanted);

bool isAdvertising();

}  // namespace netid
