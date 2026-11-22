#pragma once
//
// Deciding when a Wi-Fi link that says "connected" is actually dead.
//
// Found 2026-11-22 with Bluetooth on: after internal RAM dipped to ~10 KB the
// box stayed associated (WiFi.status() 3, a healthy RSSI) and answered
// nothing at all, not even ping, until it was power-cycled. Nothing in the
// Wi-Fi driver notices, because by its own lights nothing is wrong. So the box
// asks the one question that does notice: does the gateway still answer?
//
// This file is only the decision, kept free of Arduino so `pio test -e
// native` can drive it (test/test_linkwatch). net_watchdog.cpp does the pings
// and carries out what it says.
//
// The rules, in order of how much they cost the listener:
//   - a probe that gets any reply clears everything;
//   - nothing is ever done until the gateway has answered at least once on
//     this link ("armed"). Some routers drop ICMP, and a box that restarted
//     forever because its router ignores ping would be worse than the wedge;
//   - after `failsToReconnect` failed probes in a row: drop and rejoin the
//     network. Bluetooth is untouched, so a song on the box keeps playing;
//   - if that happens `reconnectsBeforeRestart` times without a single reply
//     in between: restart the box, but only when the caller says a restart is
//     allowed (nothing playing). Until then it holds, and asks again on every
//     later failed probe.
//
#include <stdint.h>

namespace linkwatch {

enum class Action { None, Reconnect, Restart };

struct Policy {
  uint8_t failsToReconnect;
  uint8_t reconnectsBeforeRestart;
};

class Watch {
 public:
  explicit Watch(Policy policy) : policy_(policy) {}

  // A different network (the gateway changed): disarm and start over, since
  // the new router has not yet shown it answers ping.
  void reset();

  // One probe's result. `restartAllowed` is false while a song is playing.
  Action onProbe(bool answered, bool restartAllowed);

  bool armed() const { return armed_; }
  uint8_t failures() const { return failures_; }
  uint8_t reconnects() const { return reconnects_; }

 private:
  Policy policy_;
  bool armed_ = false;
  uint8_t failures_ = 0;
  uint8_t reconnects_ = 0;
};

}  // namespace linkwatch
