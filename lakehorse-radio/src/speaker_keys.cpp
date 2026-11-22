#include "speaker_keys.h"

namespace speakerkeys {

namespace {
constexpr uint8_t kPlay = 0x44;
constexpr uint8_t kStop = 0x45;
constexpr uint8_t kPause = 0x46;
constexpr uint8_t kForward = 0x4B;
constexpr uint8_t kBackward = 0x4C;
}  // namespace

Action actionFor(uint8_t key, bool released, bool playing) {
  if (released) return Action::None;
  switch (key) {
    case kPlay: return playing ? Action::Pause : Action::Resume;
    case kPause:
    case kStop: return Action::Pause;
    case kForward: return Action::Next;
    case kBackward: return Action::Restart;
    default: return Action::None;
  }
}

}  // namespace speakerkeys
