#pragma once
//
// The real 8x8 WS2812 matrix: a small task that renders the same frame the
// virtual window shows and pushes it to the LEDs. Everything that touches the
// frame engine from another task (the web endpoint) must hold Lock, because
// the engine renders into one shared buffer.
//
#include <stdint.h>

#include "matrix_layout.h"

namespace matrixdrv {

// Creates the lock, loads the saved panel layout, and (in builds that have the
// LED driver, LAKEHORSE_MATRIX) starts the draw task. Call once, before the web
// server starts, and after Wi-Fi and Bluetooth are up.
void begin();

// Hold this around any call into matrix:: from a task other than the driver's.
class Lock {
 public:
  Lock();
  ~Lock();
  Lock(const Lock&) = delete;
  Lock& operator=(const Lock&) = delete;
};

// Panel wiring. Setting it saves it (NVS) and redraws on the next tick.
matrixlayout::Wiring wiring();
matrixlayout::Origin origin();
void setLayout(matrixlayout::Wiring w, matrixlayout::Origin o);

// Whether the LED driver is compiled into this build.
bool hardwareBuilt();

}  // namespace matrixdrv
