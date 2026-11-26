#pragma once
//
// Setting the box up on a brand-new network away from home, with Bluetooth on.
//
// The box's own hotspot cannot serve pages while Bluetooth is running (the
// access point, DHCP and captive DNS starve the internal heap Bluetooth has
// taken; HANDOFF.md, 2026-11-25). Saving networks ahead of time avoids the
// hotspot entirely (saved_networks.h), but a network the box has never seen
// can only be given to it through that hotspot.
//
// Bluetooth can only start at boot (bt_speaker.h), so it cannot be paused for
// a minute and resumed. Instead: when a phone joins the hotspot while
// Bluetooth is running and the box is on no network, the box restarts once
// with Bluetooth skipped for that one boot (a "setup boot"; nothing is saved,
// the flag lives in RTC memory and is gone on the next boot). In a setup
// boot, once the box has joined a network and held it long enough for the
// page to learn its new address, or once the hotspot has sat empty for a few
// minutes, it restarts again with Bluetooth back. The speaker is silent only
// while a new network is being set up.
//
// Only the decision lives here, Arduino free, so `pio test -e native` drives
// it (test/test_setupboot). main.cpp gathers the state and restarts.
//
#include <stdint.h>

namespace setupboot {

enum class Action { None, RestartForSetup, RestartWithBluetooth };

struct State {
  bool btRunning;           // Bluetooth was started this boot
  bool setupBoot;           // this boot skipped Bluetooth for setup
  bool apUp;                // the box's own hotspot is up
  int apClients;            // phones joined to it
  bool stationConnected;    // the box is on a network
  uint32_t msSinceApEmpty;  // how long the hotspot has had nobody on it
  uint32_t msSinceConnected;  // how long the station has been connected
};

inline Action decide(const State& s, uint32_t emptyLimitMs, uint32_t joinedHoldMs) {
  if (s.setupBoot) {
    if (s.stationConnected) {
      return s.msSinceConnected >= joinedHoldMs ? Action::RestartWithBluetooth : Action::None;
    }
    if (s.apClients > 0) return Action::None;
    return s.msSinceApEmpty >= emptyLimitMs ? Action::RestartWithBluetooth : Action::None;
  }
  if (s.btRunning && s.apUp && s.apClients > 0 && !s.stationConnected) {
    return Action::RestartForSetup;
  }
  return Action::None;
}

}  // namespace setupboot
