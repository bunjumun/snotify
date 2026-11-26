#include "matrix_layout.h"

#include <string.h>

namespace matrixlayout {

int physicalIndex(int logical, Wiring wiring, Origin origin) {
  if (logical < 0 || logical >= kPixels) return -1;
  int x = logical % kSize;
  int y = logical / kSize;
  const bool right = origin == Origin::TopRight || origin == Origin::BottomRight;
  const bool bottom = origin == Origin::BottomLeft || origin == Origin::BottomRight;
  // Position measured from the strip's starting corner.
  const int col = right ? kSize - 1 - x : x;
  const int row = bottom ? kSize - 1 - y : y;
  const bool reversed = wiring == Wiring::Serpentine && (row % 2 == 1);
  return row * kSize + (reversed ? kSize - 1 - col : col);
}

const char* wiringName(Wiring w) {
  return w == Wiring::Progressive ? "progressive" : "serpentine";
}

const char* originName(Origin o) {
  switch (o) {
    case Origin::TopRight: return "tr";
    case Origin::BottomLeft: return "bl";
    case Origin::BottomRight: return "br";
    case Origin::TopLeft: break;
  }
  return "tl";
}

bool wiringFromName(const char* name, Wiring* out) {
  if (!name || !out) return false;
  if (strcmp(name, "serpentine") == 0) { *out = Wiring::Serpentine; return true; }
  if (strcmp(name, "progressive") == 0) { *out = Wiring::Progressive; return true; }
  return false;
}

bool originFromName(const char* name, Origin* out) {
  if (!name || !out) return false;
  static const Origin all[] = {Origin::TopLeft, Origin::TopRight, Origin::BottomLeft,
                               Origin::BottomRight};
  for (Origin o : all) {
    if (strcmp(name, originName(o)) == 0) { *out = o; return true; }
  }
  return false;
}

}  // namespace matrixlayout
