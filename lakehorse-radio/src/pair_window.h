#pragma once
//
// Pairing a phone from the home network, by proving you are at the box.
//
// The pairing key used to be handed out only over the box's own hotspot
// (GET /api/pair). Found 2026-11-25: a box already on a saved network has no
// hotspot up, and a phone's saved key belongs to the address it was paired
// at (192.168.4.1 is not lakehorseradio.local to Safari), so the owner could
// see the Network window at home but not change anything, and could not
// reach the hotspot to pair either.
//
// Two ways to open a short pairing window, both of which need hands on the
// box, the same idea as WPS on a router: hold the BOOT button for a few
// seconds, or power the box on (unplug, plug in). A software restart does
// not count, since the page can cause one. While the window is open
// /api/pair answers on any network.
//
// Only the timing lives here, Arduino free, so `pio test -e native` drives it
// (test/test_pairwindow). Each function returns a new Window.
//
#include <stdint.h>

namespace pairwindow {

struct Window {
  bool opened = false;      // a window has been opened at least once
  uint32_t openedAt = 0;
  bool pressed = false;     // the button was down last time it was read
  uint32_t pressedAt = 0;
  bool consumed = false;    // this press already opened a window
};

inline Window open(const Window& w, uint32_t now) {
  Window out = w;
  out.opened = true;
  out.openedAt = now;
  return out;
}

inline bool isOpen(const Window& w, uint32_t now, uint32_t openMs) {
  return w.opened && (uint32_t)(now - w.openedAt) < openMs;
}

// Feed the button state each loop. Held for `holdMs` opens the window once
// per press.
inline Window button(const Window& w, bool down, uint32_t now, uint32_t holdMs) {
  Window out = w;
  if (!down) {
    out.pressed = false;
    out.consumed = false;
    return out;
  }
  if (!w.pressed) {
    out.pressed = true;
    out.pressedAt = now;
    return out;
  }
  if (!w.consumed && (uint32_t)(now - w.pressedAt) >= holdMs) {
    out = open(out, now);
    out.consumed = true;
  }
  return out;
}

}  // namespace pairwindow
