#include "matrix_engine.h"

#include <string.h>

// See matrix_engine.h for why this is a pure function of the clock with a
// little static state. Everything below is internal RAM, never the heap.

namespace matrix {
namespace {

constexpr uint32_t kBandFreshMs = 1000;  // older levels count as "no audio"
constexpr uint32_t kScrollMs = 120;      // one column of title scroll
constexpr uint32_t kDazzleMs = 250;      // one column of camo drift
constexpr uint32_t kClockPhaseMs = 3000; // hours, then minutes, alternating
constexpr int kGlyphW = 3;
constexpr int kGlyphH = 5;
constexpr int kGlyphStride = kGlyphW + 1;  // one blank column between glyphs
constexpr int kGlyphTop = 1;               // rows 1..5, one above, two below
constexpr char kHex[] = "0123456789abcdef";

// ---- font: 3x5, one 15-character string per glyph, rows top to bottom ----
struct Glyph {
  char c;
  char px[kGlyphW * kGlyphH + 1];
};

const Glyph kFont[] = {
    {' ', "..." "..." "..." "..." "..."},
    {'A', ".#." "#.#" "###" "#.#" "#.#"},
    {'B', "##." "#.#" "##." "#.#" "##."},
    {'C', ".##" "#.." "#.." "#.." ".##"},
    {'D', "##." "#.#" "#.#" "#.#" "##."},
    {'E', "###" "#.." "##." "#.." "###"},
    {'F', "###" "#.." "##." "#.." "#.."},
    {'G', ".##" "#.." "#.#" "#.#" ".##"},
    {'H', "#.#" "#.#" "###" "#.#" "#.#"},
    {'I', "###" ".#." ".#." ".#." "###"},
    {'J', "..#" "..#" "..#" "#.#" ".#."},
    {'K', "#.#" "#.#" "##." "#.#" "#.#"},
    {'L', "#.." "#.." "#.." "#.." "###"},
    {'M', "#.#" "###" "###" "#.#" "#.#"},
    {'N', "##." "#.#" "#.#" "#.#" "#.#"},
    {'O', ".#." "#.#" "#.#" "#.#" ".#."},
    {'P', "##." "#.#" "##." "#.." "#.."},
    {'Q', ".#." "#.#" "#.#" "###" "..#"},
    {'R', "##." "#.#" "##." "#.#" "#.#"},
    {'S', ".##" "#.." ".#." "..#" "##."},
    {'T', "###" ".#." ".#." ".#." ".#."},
    {'U', "#.#" "#.#" "#.#" "#.#" "###"},
    {'V', "#.#" "#.#" "#.#" "#.#" ".#."},
    {'W', "#.#" "#.#" "###" "###" "#.#"},
    {'X', "#.#" "#.#" ".#." "#.#" "#.#"},
    {'Y', "#.#" "#.#" ".#." ".#." ".#."},
    {'Z', "###" "..#" ".#." "#.." "###"},
    {'0', "###" "#.#" "#.#" "#.#" "###"},
    {'1', ".#." "##." ".#." ".#." "###"},
    {'2', "##." "..#" ".#." "#.." "###"},
    {'3', "##." "..#" ".#." "..#" "##."},
    {'4', "#.#" "#.#" "###" "..#" "..#"},
    {'5', "###" "#.." "##." "..#" "##."},
    {'6', ".##" "#.." "###" "#.#" "###"},
    {'7', "###" "..#" ".#." ".#." ".#."},
    {'8', "###" "#.#" "###" "#.#" "###"},
    {'9', "###" "#.#" "###" "..#" "##."},
    {'.', "..." "..." "..." "..." ".#."},
    {',', "..." "..." "..." ".#." "#.."},
    {'!', ".#." ".#." ".#." "..." ".#."},
    {'?', "##." "..#" ".#." "..." ".#."},
    {'-', "..." "..." "###" "..." "..."},
    {':', "..." ".#." "..." ".#." "..."},
    {'\'', ".#." ".#." "..." "..." "..."},
    {'/', "..#" "..#" ".#." "#.." "#.."},
    {'+', "..." ".#." "###" ".#." "..."},
    {'&', ".#." "#.#" ".#." "#.#" ".##"},
    {'(', ".#." "#.." "#.." "#.." ".#."},
    {')', ".#." "..#" "..#" "..#" ".#."},
    {'_', "..." "..." "..." "..." "###"},
};
constexpr size_t kFontLen = sizeof(kFont) / sizeof(kFont[0]);

const Glyph* findGlyph(char c) {
  for (size_t i = 0; i < kFontLen; ++i) {
    if (kFont[i].c == c) return &kFont[i];
  }
  return nullptr;
}

bool glyphPixel(const Glyph* g, int col, int row) {
  return g && col >= 0 && col < kGlyphW && row >= 0 && row < kGlyphH &&
         g->px[row * kGlyphW + col] == '#';
}

// ---- state ----
struct State {
  Mode mode = Mode::Off;
  uint8_t brightness = 20;
  uint32_t modeStartMs = 0;
  char title[kTitleMax + 1] = {0};
  uint8_t titleLen = 0;
  bool clockSet = false;
  uint32_t clockBaseSecs = 0;  // seconds since midnight when it was set
  uint32_t clockBaseMs = 0;
  char image[kPixels + 1] = {0};
  uint16_t alignPoints = 0;
  uint32_t alignSeed = 0x4C4Bu;
  uint8_t bands[kBands] = {0};
  bool bandsFed = false;
  uint32_t bandsMs = 0;
  char frame[kPixels + 1] = {0};
};
State g;

void put(int x, int y, uint8_t level) {
  if (x < 0 || x >= kSize || y < 0 || y >= kSize) return;
  g.frame[y * kSize + x] = kHex[level & 0xF];
}

bool bandsFresh(uint32_t nowMs) {
  return g.bandsFed && (uint32_t)(nowMs - g.bandsMs) <= kBandFreshMs;
}

// ---- patterns ----

// Triangle wave 0..8..0 with a period of 16 steps.
int triangle(uint32_t step) {
  const int p = (int)(step % 16);
  return p <= 8 ? p : 16 - p;
}

void drawBars(uint32_t nowMs) {
  uint8_t h[kBands];
  if (bandsFresh(nowMs)) {
    for (int i = 0; i < kBands; ++i) h[i] = g.bands[i] > 8 ? 8 : g.bands[i];
  } else {
    // Test pattern: each column rises and falls at its own pace.
    for (int i = 0; i < kBands; ++i) {
      h[i] = (uint8_t)triangle(nowMs / (70 + 19 * (uint32_t)i) + 3 * (uint32_t)i);
    }
  }
  for (int x = 0; x < kBands; ++x) {
    for (int k = 0; k < h[x]; ++k) {
      put(x, kSize - 1 - k, k == h[x] - 1 ? 15 : 8);  // brighter tip
    }
  }
}

// Mean band height 0..8, or 0 when there is no audio.
int audioLevel(uint32_t nowMs) {
  if (!bandsFresh(nowMs)) return 0;
  int sum = 0;
  for (int i = 0; i < kBands; ++i) sum += g.bands[i] > 8 ? 8 : g.bands[i];
  return sum / kBands;
}

uint32_t hash2(uint32_t a, uint32_t b) {
  uint32_t h = a * 73856093u ^ b * 19349663u;
  h ^= h >> 13;
  h *= 0x5bd1e995u;
  h ^= h >> 15;
  return h;
}

// Dazzle camouflage: 2x2 blotches in four tones drifting left. With audio
// fresh, every tone is lifted by up to 4 steps, so it swells with the music.
void drawDazzle(uint32_t nowMs) {
  static const uint8_t tones[4] = {1, 4, 8, 11};
  const uint32_t drift = (nowMs - g.modeStartMs) / kDazzleMs;
  const int boost = audioLevel(nowMs) / 2;
  for (int y = 0; y < kSize; ++y) {
    for (int x = 0; x < kSize; ++x) {
      const uint32_t cx = ((uint32_t)x + drift) >> 1;
      const uint8_t base = tones[hash2(cx, (uint32_t)y >> 1) & 3];
      const int v = base + boost;
      put(x, y, (uint8_t)(v > 15 ? 15 : v));
    }
  }
}

void drawTitle(uint32_t nowMs) {
  const int width = g.titleLen * kGlyphStride;
  if (width == 0) return;
  // One full pass is the text plus a screen of blank either side of it.
  const uint32_t cycle = (uint32_t)(width + kSize);
  const uint32_t offset = ((nowMs - g.modeStartMs) / kScrollMs) % cycle;
  for (int x = 0; x < kSize; ++x) {
    const int s = (int)offset + x - kSize;  // column in the text strip
    if (s < 0 || s >= width) continue;
    const int within = s % kGlyphStride;
    if (within >= kGlyphW) continue;  // the gap column
    const Glyph* gl = findGlyph(g.title[s / kGlyphStride]);
    for (int r = 0; r < kGlyphH; ++r) {
      if (glyphPixel(gl, within, r)) put(x, kGlyphTop + r, 15);
    }
  }
}

void drawPair(int x0, int value, bool blank) {
  const char tens = blank ? '-' : (char)('0' + value / 10);
  const char ones = blank ? '-' : (char)('0' + value % 10);
  const Glyph* a = findGlyph(tens);
  const Glyph* b = findGlyph(ones);
  for (int r = 0; r < kGlyphH; ++r) {
    for (int c = 0; c < kGlyphW; ++c) {
      if (glyphPixel(a, c, r)) put(x0 + c, kGlyphTop + r, 15);
      if (glyphPixel(b, c, r)) put(x0 + kGlyphStride + c, kGlyphTop + r, 15);
    }
  }
}

// Hours for three seconds, then minutes for three. A lit pixel in the top
// right corner marks hours; the bottom row is seconds, always at least one.
void drawClock(uint32_t nowMs) {
  const bool hoursPhase = ((nowMs / kClockPhaseMs) % 2) == 0;
  if (!g.clockSet) {
    drawPair(0, 0, true);
    if (hoursPhase) put(7, kGlyphTop, 15);
    return;
  }
  const uint32_t secs = (g.clockBaseSecs + (nowMs - g.clockBaseMs) / 1000) % 86400u;
  const int hour = (int)(secs / 3600);
  const int minute = (int)((secs / 60) % 60);
  const int second = (int)(secs % 60);
  drawPair(0, hoursPhase ? hour : minute, false);
  if (hoursPhase) put(7, kGlyphTop, 15);
  const int lit = second * kSize / 60 + 1;
  for (int x = 0; x < lit && x < kSize; ++x) put(x, kSize - 1, 6);
}

// ---- alignment ----
constexpr uint32_t kAlignWanderMs = 350;  // how often the unlocked points hop
constexpr uint8_t kAlignLocked = 15;      // a locked node, steady and full
constexpr uint8_t kAlignEarningBase = 5;  // the node being earned, 5..9 as it fills
constexpr uint8_t kAlignEarningSpan = 4;
constexpr uint32_t kAlignDimBase = 2;     // an unlocked point, 2..4
constexpr uint32_t kAlignDimSpan = 3;

// Writes the cell of every node, in lock order: diagonals outward from the
// bottom-left corner, left to right along each.
void alignmentOrder(uint8_t xs[kPixels], uint8_t ys[kPixels]) {
  int n = 0;
  for (int d = 0; d <= 2 * (kSize - 1); ++d) {
    const int lo = d > kSize - 1 ? d - (kSize - 1) : 0;
    const int hi = d < kSize - 1 ? d : kSize - 1;
    for (int col = lo; col <= hi; ++col) {
      xs[n] = (uint8_t)col;
      ys[n] = (uint8_t)(kSize - 1 - (d - col));
      ++n;
    }
  }
}

void putMax(int x, int y, uint8_t level) {
  if (x < 0 || x >= kSize || y < 0 || y >= kSize) return;
  char& c = g.frame[y * kSize + x];
  const uint8_t have = (uint8_t)(c <= '9' ? c - '0' : c - 'a' + 10);
  if (level > have) c = kHex[level & 0xF];
}

int clampCell(int v) { return v < 0 ? 0 : (v >= kSize ? kSize - 1 : v); }

void drawAlignment(uint32_t nowMs) {
  uint8_t xs[kPixels], ys[kPixels];
  alignmentOrder(xs, ys);
  const uint32_t points = g.alignPoints > kAlignMaxPoints ? kAlignMaxPoints : g.alignPoints;
  const int locked = (int)(points / kAlignNodePoints);
  const uint32_t share = points % kAlignNodePoints;  // 0..99 of the next node
  const uint32_t disorder = 100u - points * 100u / kAlignMaxPoints;  // 100 .. 0
  const uint32_t step = (nowMs - g.modeStartMs) / kAlignWanderMs;
  const int reach = disorder > 50 ? 2 : 1;
  for (int n = locked; n < kPixels; ++n) {
    const uint32_t h = hash2(g.alignSeed + (uint32_t)n * 2654435761u, step);
    int x = xs[n], y = ys[n];
    if ((h & 0xFFu) * 100u / 256u < disorder) {
      const int span = 2 * reach + 1;
      x += (int)((h >> 8) % (uint32_t)span) - reach;
      y += (int)((h >> 16) % (uint32_t)span) - reach;
    }
    uint8_t level = (uint8_t)(kAlignDimBase + ((h >> 24) % kAlignDimSpan));
    if (n == locked) level = (uint8_t)(kAlignEarningBase + share * kAlignEarningSpan / 100u);
    putMax(clampCell(x), clampCell(y), level);
  }
  for (int n = 0; n < locked; ++n) put(xs[n], ys[n], kAlignLocked);
}

constexpr int kTestCorners[4] = {0, kSize - 1, kPixels - kSize, kPixels - 1};
constexpr uint8_t kTestColours[4][3] = {
    {255, 0, 0}, {0, 255, 0}, {0, 0, 255}, {255, 255, 255}};

void drawTest() {
  for (int i = 0; i < kPixels; ++i) g.frame[i] = '2';  // dim, never dark
  for (int c : kTestCorners) g.frame[c] = 'f';
}

void drawImage() {
  memcpy(g.frame, g.image, kPixels);
}

}  // namespace

void reset() { g = State(); }

const char* modeName(Mode m) {
  switch (m) {
    case Mode::Off: return "off";
    case Mode::Bars: return "bars";
    case Mode::Title: return "title";
    case Mode::Dazzle: return "dazzle";
    case Mode::Clock: return "clock";
    case Mode::Image: return "image";
    case Mode::Test: return "test";
    case Mode::Alignment: return "alignment";
  }
  return "off";
}

bool modeFromName(const char* name, Mode* out) {
  if (!name || !out) return false;
  static const Mode all[] = {Mode::Off,   Mode::Bars,  Mode::Title,
                             Mode::Dazzle, Mode::Clock, Mode::Image, Mode::Test,
                             Mode::Alignment};
  for (Mode m : all) {
    if (strcmp(name, modeName(m)) == 0) {
      *out = m;
      return true;
    }
  }
  return false;
}

void setMode(Mode m, uint32_t nowMs) {
  g.mode = m;
  g.modeStartMs = nowMs;
}

Mode mode() { return g.mode; }

void setTitle(const char* text, uint32_t nowMs) {
  g.titleLen = 0;
  g.title[0] = '\0';
  if (text) {
    for (const unsigned char* p = (const unsigned char*)text;
         *p && g.titleLen < kTitleMax; ++p) {
      if (*p >= 0x80 && *p < 0xC0) continue;  // continuation byte: same glyph
      char c = (char)*p;
      if (c >= 'a' && c <= 'z') c = (char)(c - 'a' + 'A');
      if (!findGlyph(c)) c = '?';
      g.title[g.titleLen++] = c;
    }
    g.title[g.titleLen] = '\0';
  }
  g.modeStartMs = nowMs;  // a new title scrolls in from the right
}

const char* title() { return g.title; }

bool setClock(uint8_t hour, uint8_t minute, uint8_t second, uint32_t nowMs) {
  if (hour > 23 || minute > 59 || second > 59) return false;
  g.clockSet = true;
  g.clockBaseSecs = (uint32_t)hour * 3600u + (uint32_t)minute * 60u + second;
  g.clockBaseMs = nowMs;
  return true;
}

bool setImage(const char* hex64) {
  if (!hex64 || strlen(hex64) != (size_t)kPixels) return false;
  char staged[kPixels + 1];
  for (int i = 0; i < kPixels; ++i) {
    char c = hex64[i];
    if (c >= 'A' && c <= 'F') c = (char)(c - 'A' + 'a');
    if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
    staged[i] = c;
  }
  staged[kPixels] = '\0';
  memcpy(g.image, staged, sizeof(staged));
  return true;
}

void feedBands(const uint8_t levels[kBands], uint32_t nowMs) {
  for (int i = 0; i < kBands; ++i) g.bands[i] = levels[i];
  g.bandsFed = true;
  g.bandsMs = nowMs;
}

bool pixelColor(int index, uint8_t rgb[3]) {
  if (g.mode != Mode::Test || !rgb) return false;
  for (int k = 0; k < 4; ++k) {
    if (kTestCorners[k] != index) continue;
    for (int j = 0; j < 3; ++j) rgb[j] = kTestColours[k][j];
    return true;
  }
  return false;
}

void setAlignment(uint16_t points, uint32_t seed) {
  g.alignPoints = points > kAlignMaxPoints ? kAlignMaxPoints : points;
  g.alignSeed = seed;
}

uint16_t alignmentPoints() { return g.alignPoints; }

bool alignmentCell(int node, int* x, int* y) {
  if (node < 0 || node >= kPixels || !x || !y) return false;
  uint8_t xs[kPixels], ys[kPixels];
  alignmentOrder(xs, ys);
  *x = xs[node];
  *y = ys[node];
  return true;
}

bool setBrightness(uint8_t percent) {
  if (percent < 1 || percent > 100) return false;
  g.brightness = percent;
  return true;
}

uint8_t brightness() { return g.brightness; }

const char* render(uint32_t nowMs) {
  memset(g.frame, '0', kPixels);
  g.frame[kPixels] = '\0';
  switch (g.mode) {
    case Mode::Off: break;
    case Mode::Bars: drawBars(nowMs); break;
    case Mode::Title: drawTitle(nowMs); break;
    case Mode::Dazzle: drawDazzle(nowMs); break;
    case Mode::Clock: drawClock(nowMs); break;
    case Mode::Image:
      if (g.image[0]) drawImage();
      break;
    case Mode::Test: drawTest(); break;
    case Mode::Alignment: drawAlignment(nowMs); break;
  }
  return g.frame;
}

bool parseUint(const char* text, uint32_t max, uint32_t* out) {
  if (!text || !out || !*text) return false;
  uint64_t v = 0;
  for (const char* p = text; *p; ++p) {
    if (*p < '0' || *p > '9') return false;
    v = v * 10 + (uint64_t)(*p - '0');
    if (v > max) return false;
  }
  *out = (uint32_t)v;
  return true;
}

}  // namespace matrix
