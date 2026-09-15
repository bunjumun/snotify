#pragma once
//
// Wi-Fi — always both an access point and a station, at the same time.
//
// Why AP_STA permanently rather than the usual "AP only until provisioned":
// this box lives in a barn and also goes to gigs. On the barn network everyone
// reaches it at lakehorse.local. At a gig with no network at all, the AP is the
// only way in. Dropping the AP after provisioning would make the second case
// require a laptop and a reflash, so the AP stays up for ever.
//
// The cost of AP_STA, and it is a real one: when the station connects, the ESP32
// moves its access point onto the station's channel, because the radio has one
// tuner. Any phone already joined to the AP is briefly kicked off and has to
// reassociate. That is why provisioning reports success before it switches over
// rather than after, when the reply might never reach the phone that asked.
//
// Credentials live in NVS and nowhere else. They are never compiled in, never
// written to the filesystem the web server can read, and never logged.
//
#include <Arduino.h>

namespace wifinet {

enum class StationState { Idle, Connecting, Connected, Failed };

// Brings up the access point immediately, then tries any saved network in the
// background. The AP is up before this returns, so the box is reachable even if
// the saved network never answers.
void begin();

// Must be called from loop(). Handles the retry timer; the actual connection
// events arrive as callbacks.
void tick();

// Saves credentials and attempts them. Returns false only if the write failed;
// a wrong password reports success here and fails asynchronously, which is why
// the caller must report "trying" rather than "connected".
bool provision(const String& ssid, const String& password);

// Forgets the saved network and drops the station. The AP is untouched, so the
// box stays reachable to be re-provisioned.
bool forget();

StationState stationState();
String stationSsid();
String stationIp();
String accessPointIp();
bool hasSavedNetwork();

}  // namespace wifinet
