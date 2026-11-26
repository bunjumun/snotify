#pragma once
//
// How often the box may retry its saved Wi-Fi network while its own hotspot is up.
//
// Found 2026-11-25: taken away from home, the box raised its hotspot but a
// phone could not stay joined long enough for the setup sheet to appear. The
// background retry of the (out of range) saved network ran every 30 s, and each
// retry resets the one radio, so a phone on the hotspot was thrown off and
// had to rejoin every time. A setup sheet needs a steady link for the few
// seconds it takes to join, get an address and finish its probe.
//
// The rule, borrowed from WLED's handleConnection(): while at least one phone is
// joined to the hotspot, wait a much longer time between retries (WLED uses five
// minutes against twenty seconds). With nobody on the hotspot the timing is
// unchanged. A retry that is already running is left to finish. Retrying at all,
// rather than never, means a box left with a phone attached still finds its home
// network when it comes back in range.
//
// Only the decision lives here, free of Arduino, so `pio test -e native` can
// drive it (test/test_hotspotretry). wifi_manager.cpp asks and carries it out.
//
#include <stdint.h>

namespace hotspotretry {

// The wait between retries. `apClients` only counts while the hotspot is up.
inline uint32_t intervalMs(uint32_t normalMs, uint32_t withClientMs, bool apUp, int apClients) {
  return (apUp && apClients > 0) ? withClientMs : normalMs;
}

// True when `intervalMs` has passed since `lastAttemptMs`. Both are millis();
// the subtraction is correct across the 49 day rollover.
inline bool due(uint32_t now, uint32_t lastAttemptMs, uint32_t intervalMs) {
  return (uint32_t)(now - lastAttemptMs) >= intervalMs;
}

// ---- Cancel the station search while a phone is on the hotspot (WLED does the same) ----
//
// Measured 2026-11-25 on the box (HANDOFF.md, "Borrowed from WLED"): Arduino core 2.0.17
// leaves setAutoReconnect(true), and WIFI_REASON_NO_AP_FOUND is on its "reconnectable"
// list, so with the saved network out of range the core re-ran a full channel scan every
// ~1.7 s on its own, with no retry line from us at all. Every scan pulls the one radio
// off the hotspot's channel, which is what threw phones off. The retry hold above cannot
// reach that. Two parts fix it, both in wifi_manager.cpp:
//   1. auto-reconnect is off for as long as the hotspot is up (our own 30 s tick retry
//      is the only searching left), and
//   2. a search that is running when a phone joins is cancelled (WiFi.disconnect), and
//      the wait for the next one restarts when the last phone leaves.
//
// `personAttempt` is true while a join the owner asked for from the setup page is in
// flight (set in provision(), cleared when that attempt ends). That one is never
// cancelled, and it lifts an earlier cancel so the attempt is not blocked.
// After the owner taps Join or Use now, the box keeps trying that one network
// for a while instead of giving up after one attempt: an iPhone only shows its
// hotspot once it has left the box's page and opened the Personal Hotspot
// screen, which takes longer than one attempt.
inline bool inJoinWindow(uint32_t now, uint32_t startedMs, uint32_t windowMs, bool active) {
  return active && (uint32_t)(now - startedMs) < windowMs;
}

enum class SearchAction { None, Cancel, Resume };

inline SearchAction searchAction(bool apUp, int apClients, bool stationConnected,
                                 bool personAttempt, bool cancelled) {
  const bool phoneOnHotspot = apUp && apClients > 0;
  if (cancelled) {
    // Back to normal once the last phone has gone, the hotspot is down, or the owner
    // started a join of their own.
    return (!phoneOnHotspot || personAttempt) ? SearchAction::Resume : SearchAction::None;
  }
  if (!phoneOnHotspot || stationConnected || personAttempt) return SearchAction::None;
  return SearchAction::Cancel;
}

}  // namespace hotspotretry
