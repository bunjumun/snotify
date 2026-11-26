#pragma once
//
// Wi-Fi — station first, the hotspot only as a fallback.
//
// This used to bring the access point and the station up together,
// permanently, on the theory that a barn box and a gig box are the same box
// and both need a door. They are, and both still need one — but starting the
// access point first was the bug. The ESP32 has one radio and one tuner; a
// SoftAP started with no channel argument silently claims channel 1, and a
// station then trying to join a network on any other channel just times out
// on the handshake, forever. It looked exactly like a wrong password. It was
// a channel fight the station could never win, because the access point had
// already claimed the radio before the station ever got a turn.
//
// The fix, copied from WLED rather than reinvented: try the station FIRST,
// with no access point up to contend with. Only if that has not answered
// within AP_FALLBACK_AFTER_MS does the hotspot come up at all, and only for
// as long as the box stays unconnected — the moment the station gets an
// address, the access point is torn down (AP_TEARDOWN_ON_CONNECT). A box with
// no saved network at all, or one whose saved network is genuinely out of
// range for a whole gig, still gets its hotspot and keeps it: nothing here
// changes the gig case, only the order a cold boot tries things in.
//
// One consequence of AP_STA is worth keeping even after this fix, because it
// follows from "one radio, one tuner" and does not go away: once the fallback
// access point IS up, giving the station another try (a background retry, or
// a fresh provisioning request) still needs the same WIFI_MODE_NULL reset
// WLED uses on every reconnect, which physically tears the access point down
// for an instant before this file puts it straight back up. A phone already
// joined to it is briefly kicked off and has to reassociate. That is why
// provisioning reports success before it switches over rather than after,
// when the reply might never reach the phone that asked.
//
// Credentials live in NVS and nowhere else. They are never compiled in, never
// written to the filesystem the web server can read, and never logged.
//
#include <Arduino.h>

#include <vector>

namespace wifinet {

enum class StationState { Idle, Connecting, Connected, Failed };

// Tries the saved network first, before anything else touches the radio. The
// access point is not raised at all unless there is nothing saved, or unless
// AP_FALLBACK_AFTER_MS passes with no answer — see the file header for why
// this order is the fix, not a preference.
void begin();

// Must be called from loop(). Handles the retry timer and the fallback
// access-point timer; the actual connection events arrive as callbacks.
void tick();

// Remembers up to cfg::SAVED_NETWORKS_MAX networks (saved_networks.h): home,
// a venue, a phone hotspot. Boot tries the strongest one in range; retries
// walk the list. A station on any of them is what keeps Bluetooth and the
// page working together, which the box's own hotspot cannot (HANDOFF.md).

// Saves credentials at the front of the list and attempts them. Returns false
// if they are invalid or the write failed;
// a wrong password reports success here and fails asynchronously, which is why
// the caller must report "trying" rather than "connected".
bool provision(const String& ssid, const String& password);

// Forgets one saved network (the current one when `ssid` is empty). If it was
// the one in use the box moves on to the others; with none left the access
// point comes up so the box stays reachable. False if it was not saved.
bool forget(const String& ssid);

// Joins a network that is already saved, now. False if it is not saved.
bool use(const String& ssid);

// Saved network names, most recent first. Never the passwords.
std::vector<String> savedNames();

// Phones on the box's own hotspot; 0 while it is down.
int accessPointClients();

// Drops and rejoins the saved network, through the same path the retry timer
// uses. For net_watchdog.h, when the link says "connected" but is deaf.
void reconnect();

StationState stationState();

// Why the last attempt failed, in words the setup page can show. Empty when
// nothing has failed.
const char* lastFailureText();
uint8_t lastFailureReason();
String stationSsid();
String stationIp();
String accessPointIp();
bool hasSavedNetwork();

// Leaves the current network and serves the box's own hotspot, keeping every
// saved network. Stays that way until use() or provision() picks a network, or
// the box restarts (then it rejoins a saved one as usual). The radio work is
// done by tick(), not by the caller.
void hostMode();
bool inHostMode();

// Whether the fallback hotspot is currently up. False before it has ever been
// needed, and false again once a saved network has answered and
// AP_TEARDOWN_ON_CONNECT has torn it back down.
bool isAccessPointActive();

// The channel the hotspot is broadcasting on, or would use if raised right
// now — meaningful even while it is down, so a diagnostic page can show what
// a fallback access point would land on rather than nothing at all.
uint8_t accessPointChannel();

// The channel the station is joined to, or 0 if nothing is connected. On this
// hardware there is only one radio and hence only one channel, so once both
// figures are meaningful they are always the same number — which is the
// whole story this file exists to tell, in two fields a setup page can put
// side by side instead of asserting it in prose.
uint8_t stationChannel();

}  // namespace wifinet
