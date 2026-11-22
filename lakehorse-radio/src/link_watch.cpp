#include "link_watch.h"

namespace linkwatch {

void Watch::reset() {
  armed_ = false;
  failures_ = 0;
  reconnects_ = 0;
}

Action Watch::onProbe(bool answered, bool restartAllowed) {
  if (answered) {
    armed_ = true;
    failures_ = 0;
    reconnects_ = 0;
    return Action::None;
  }
  if (!armed_) return Action::None;

  // Saturate rather than wrap: a restart held off for a long song keeps
  // failing probes, and must not count its way back round to zero.
  if (failures_ < policy_.failsToReconnect) failures_++;
  if (failures_ < policy_.failsToReconnect) return Action::None;

  if (reconnects_ < policy_.reconnectsBeforeRestart) {
    reconnects_++;
    failures_ = 0;
    return Action::Reconnect;
  }
  return restartAllowed ? Action::Restart : Action::None;
}

}  // namespace linkwatch
