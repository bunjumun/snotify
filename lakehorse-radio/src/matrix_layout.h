#pragma once
//
// Maps a logical pixel (row-major, top-left origin, as the frame and the
// virtual window use) to its physical position on the LED strip. Panels differ:
// the strip can start in any corner and either snake back and forth
// (serpentine) or restart each row on the same side (progressive). Pure
// functions, so a wrong default is fixed by a setting, not by new code.
//
#include <stdint.h>

namespace matrixlayout {

enum class Wiring : uint8_t { Serpentine, Progressive };
// The corner where the strip's first LED sits, seen as the panel faces you.
enum class Origin : uint8_t { TopLeft, TopRight, BottomLeft, BottomRight };

constexpr int kSize = 8;
constexpr int kPixels = kSize * kSize;

// logical: 0..63, row by row from the top left. Returns the strip index
// 0..63, or -1 when logical is out of range.
int physicalIndex(int logical, Wiring wiring, Origin origin);

// "serpentine"/"progressive" and "tl"/"tr"/"bl"/"br"; false leaves *out alone.
const char* wiringName(Wiring w);
const char* originName(Origin o);
bool wiringFromName(const char* name, Wiring* out);
bool originFromName(const char* name, Origin* out);

}  // namespace matrixlayout
