#pragma once
//
// The 8x8 matrix frame engine: decides what each of the 64 lights shows, and
// nothing else. No LED driver and no audio tap live here (plan modules 7 and
// 6); the same frame will feed the virtual window on the page now and the real
// matrix later, which is why it is one pure unit with no Arduino in it.
//
// Why it is shaped like this:
//
//   * A frame is a pure function of (mode, its inputs, the clock). Nothing
//     ticks: render(nowMs) works out the picture on demand, so there is no
//     task, no timer and no heap. The endpoint renders when asked, and the
//     real matrix driver will do the same at its own refresh rate. The cost
//     is the static state below (about 300 bytes of internal RAM, none from
//     the heap), which is also why it stays out of PSRAM: this chip (rev
//     v1.0) has the PSRAM cache fault, and a 64-byte buffer is not worth it.
//
//   * A frame is 64 characters, row by row from the top left, each one a
//     brightness from '0' (dark) to 'f' (full) in lowercase hex. It carries
//     intensity only. Colour, and the overall brightness slider, belong to
//     whoever draws it, so the engine needs no settings of its own.
//
//   * Time is passed in (millis()), never read, so tests can step it.
//     Differences use unsigned subtraction, so the 49-day millis wrap does
//     not matter.
//
//   * One writer at a time. The web server's task owns every call today.
//     Module 6 will feed band levels from the audio reader task: that is one
//     byte-array write racing a read that tolerates any mix of old and new
//     bytes, so it needs no lock, but nothing else may be shared across tasks.
//
#include <stddef.h>
#include <stdint.h>

namespace matrix {

constexpr int kSize = 8;
constexpr int kPixels = kSize * kSize;
constexpr int kBands = 8;
// Glyphs kept for the title; anything longer is cut, not wrapped.
constexpr int kTitleMax = 63;

enum class Mode : uint8_t { Off, Bars, Title, Dazzle, Clock, Image, Test, Alignment };

// Back to the power-on state: Off, no title, no clock, no picture, no audio.
// Tests call it between cases; the firmware never needs to.
void reset();

// "off", "bars", "title", "dazzle", "clock", "image", "test", "alignment".
const char* modeName(Mode mode);
bool modeFromName(const char* name, Mode* out);

// Switching modes restarts that mode's animation from its beginning (the title
// starts scrolling in from the right edge again).
void setMode(Mode mode, uint32_t nowMs);
Mode mode();

// Text for the Title mode, reduced to what the font can draw: letters (shown
// as capitals), digits and a few marks. Other characters become '?', and a
// multi-byte UTF-8 character counts as one '?'. Restarts the scroll.
void setTitle(const char* text, uint32_t nowMs);
// What setTitle kept, as it will be drawn.
const char* title();

// The phone's time of day, so the box needs no clock of its own. It runs on
// from here by millis() until set again; until it is set the clock shows "--".
// Out-of-range values are rejected (false) and change nothing.
bool setClock(uint8_t hour, uint8_t minute, uint8_t second, uint32_t nowMs);

// A still picture: exactly 64 hex characters, same layout as a frame. Anything
// else is rejected (false) and the previous picture stays.
bool setImage(const char* hex64);

// Band heights, 0 (nothing) to 8 (full column), left to right. Bars draws
// these while they are fresh (fed within the last second) and its built-in
// test pattern otherwise, so it moves with nothing connected.
void feedBands(const uint8_t levels[kBands], uint32_t nowMs);

// Test pattern for checking the real panel's wiring: the four corners lit
// (top left red, top right green, bottom left blue, bottom right white) and
// everything else dim. The frame carries intensity only, so the colours come
// from here: true and rgb filled for those four pixels while mode is Test,
// false for every other pixel and every other mode (use the default colour).
bool pixelColor(int index, uint8_t rgb[3]);

// ENIAS alignment (ALIGNMENT-BRIEF.md): the pattern behind Drive B. `points` is
// the box's alignment total in hundredths of a node (0..6400, anything higher
// is held at 6400); node n locks when points reach (n + 1) * 100. Locked nodes
// are steady full-bright pixels; every other node is a dim point wandering
// around its own cell, and the wandering shrinks as the total rises, so the
// frame settles from scattered into a tidy pattern. The one node being earned
// glows brighter as its share fills. For a given (points, seed, time) the
// frame is always the same. Setting the mode is separate: this only stores the
// input, so the web task and the LED task can both call it before render().
constexpr uint16_t kAlignMaxPoints = 6400;
constexpr uint16_t kAlignNodePoints = 100;
void setAlignment(uint16_t points, uint32_t seed);
uint16_t alignmentPoints();
// Cell of node n (0..63): x column and y row on the matrix, row 0 on top. Nodes
// lock outward from the bottom-left corner one diagonal at a time (column plus
// distance from the bottom row), left to right along each diagonal: (0,7),
// (0,6), (1,7), (0,5), (1,6), (2,7), ... The Drive B lattice on the page uses
// the same order (data/drive-b.js, nodeCell).
// False for n out of range.
bool alignmentCell(int node, int* x, int* y);

// Overall brightness for whoever draws the frame, 1..100, default 20 (the real
// matrix runs off a USB port, so it starts low). Out of range is refused (false)
// and changes nothing. The frame itself is unaffected.
bool setBrightness(uint8_t percent);
uint8_t brightness();

// The frame for this instant: kPixels characters then a NUL. The pointer is to
// one static buffer, valid until the next render().
const char* render(uint32_t nowMs);

// Whole-string unsigned decimal, at most `max`. For the endpoint's parameters,
// kept here so the edge cases are tested: empty, signs, spaces, trailing
// junk and overflow are all refused.
bool parseUint(const char* text, uint32_t max, uint32_t* out);

}  // namespace matrix
