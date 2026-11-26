//
// Host-side tests for the matrix frame engine. Run with: pio test -e native -f test_matrix
//
#include <string.h>
#include <string>
#include <unity.h>

#include "alignment.h"
#include "matrix_engine.h"

using namespace matrix;

namespace {
std::string rows(const char* f) {  // 8 lines, for readable failures
  std::string s;
  for (int y = 0; y < kSize; ++y) {
    s.append(f + y * kSize, kSize);
    s += '\n';
  }
  return s;
}
int lit(const char* f) {
  int n = 0;
  for (int i = 0; i < kPixels; ++i) n += f[i] != '0';
  return n;
}
std::string off() { return std::string(kPixels, '0'); }
}  // namespace

void setUp() { reset(); }
void tearDown() {}

void frame_is_64_hex_chars_and_off_is_dark() {
  const char* f = render(1234);
  TEST_ASSERT_EQUAL(kPixels, (int)strlen(f));
  TEST_ASSERT_EQUAL_STRING(off().c_str(), f);
}

void every_mode_renders_only_hex() {
  setTitle("Hello", 0);
  setClock(12, 34, 56, 0);
  Mode all[] = {Mode::Off, Mode::Bars, Mode::Title, Mode::Dazzle, Mode::Clock};
  for (Mode m : all) {
    setMode(m, 0);
    for (uint32_t t = 0; t < 20000; t += 137) {
      const char* f = render(t);
      TEST_ASSERT_EQUAL(kPixels, (int)strlen(f));
      for (int i = 0; i < kPixels; ++i) {
        TEST_ASSERT_TRUE((f[i] >= '0' && f[i] <= '9') || (f[i] >= 'a' && f[i] <= 'f'));
      }
    }
  }
}

void mode_names_round_trip() {
  Mode all[] = {Mode::Off, Mode::Bars, Mode::Title, Mode::Dazzle, Mode::Clock, Mode::Image};
  for (Mode m : all) {
    Mode back = Mode::Off;
    TEST_ASSERT_TRUE(modeFromName(modeName(m), &back));
    TEST_ASSERT_EQUAL((int)m, (int)back);
  }
  Mode x = Mode::Bars;
  TEST_ASSERT_FALSE(modeFromName("BARS", &x));
  TEST_ASSERT_FALSE(modeFromName("", &x));
  TEST_ASSERT_FALSE(modeFromName(nullptr, &x));
  TEST_ASSERT_EQUAL((int)Mode::Bars, (int)x);  // untouched on failure
}

void bars_test_pattern_moves_with_nothing_fed() {
  setMode(Mode::Bars, 0);
  const std::string a = render(0);
  const std::string b = render(900);
  TEST_ASSERT_TRUE(a != b);
  TEST_ASSERT_TRUE(lit(b.c_str()) > 0);
}

void bars_draw_fed_levels_from_the_bottom() {
  setMode(Mode::Bars, 0);
  const uint8_t lv[kBands] = {0, 1, 2, 3, 4, 5, 8, 8};
  feedBands(lv, 100);
  const char* f = render(200);
  for (int x = 0; x < kBands; ++x) {
    int h = 0;
    for (int y = 0; y < kSize; ++y) h += f[y * kSize + x] != '0';
    TEST_ASSERT_EQUAL_MESSAGE(lv[x], h, rows(f).c_str());
    // contiguous from the bottom row, tip brightest
    if (h) {
      TEST_ASSERT_EQUAL('f', f[(kSize - h) * kSize + x]);
    }
  }
}

void bars_clamp_levels_above_eight() {
  setMode(Mode::Bars, 0);
  const uint8_t lv[kBands] = {200, 9, 255, 0, 0, 0, 0, 0};
  feedBands(lv, 0);
  const char* f = render(1);
  int h0 = 0;
  for (int y = 0; y < kSize; ++y) h0 += f[y * kSize] != '0';
  TEST_ASSERT_EQUAL(8, h0);
}

void bars_fall_back_to_test_pattern_when_audio_goes_stale() {
  setMode(Mode::Bars, 0);
  const uint8_t silent[kBands] = {0};
  feedBands(silent, 0);
  TEST_ASSERT_EQUAL_STRING(off().c_str(), render(500));  // fresh silence is dark
  TEST_ASSERT_TRUE(lit(render(1001 + 5000)) > 0);        // stale: test pattern
}

void fresh_check_survives_millis_wrap() {
  setMode(Mode::Bars, 0);
  const uint8_t silent[kBands] = {0};
  feedBands(silent, 0xFFFFFF00u);
  TEST_ASSERT_EQUAL_STRING(off().c_str(), render(0x00000010u));  // 272 ms later
}

void dazzle_drifts_and_lifts_with_audio() {
  setMode(Mode::Dazzle, 0);
  const std::string a = render(0);
  const std::string b = render(5000);
  TEST_ASSERT_TRUE(a != b);
  TEST_ASSERT_EQUAL(kPixels, lit(a.c_str()));  // every pixel has some light
  const uint8_t loud[kBands] = {8, 8, 8, 8, 8, 8, 8, 8};
  feedBands(loud, 0);
  const std::string c = render(0);
  int sumA = 0, sumC = 0;
  for (int i = 0; i < kPixels; ++i) {
    sumA += strtol(std::string(1, a[i]).c_str(), nullptr, 16);
    sumC += strtol(std::string(1, c[i]).c_str(), nullptr, 16);
  }
  TEST_ASSERT_TRUE(sumC > sumA);
}

void dazzle_is_deterministic() {
  setMode(Mode::Dazzle, 0);
  const std::string a = render(777);
  TEST_ASSERT_EQUAL_STRING(a.c_str(), render(777));
}

void title_is_sanitised() {
  setTitle("abc é!", 0);
  TEST_ASSERT_EQUAL_STRING("ABC ?!", title());
  setTitle("a\xF0\x9F\x8E\xB5z", 0);  // 4-byte emoji -> one '?'
  TEST_ASSERT_EQUAL_STRING("A?Z", title());
  setTitle(nullptr, 0);
  TEST_ASSERT_EQUAL_STRING("", title());
  std::string longText(200, 'x');
  setTitle(longText.c_str(), 0);
  TEST_ASSERT_EQUAL(kTitleMax, (int)strlen(title()));
}

void title_scrolls_in_from_the_right() {
  setTitle("I", 0);
  setMode(Mode::Title, 0);
  TEST_ASSERT_EQUAL_STRING(off().c_str(), render(0));  // nothing on screen yet
  // I is ###/.#./.#./.#./### ; first column to appear is its leftmost, at x=7.
  const char* f = render(120);
  TEST_ASSERT_EQUAL('f', f[1 * kSize + 7]);  // top bar of I
  TEST_ASSERT_EQUAL('0', f[2 * kSize + 7]);  // stem is not in column 0
  TEST_ASSERT_EQUAL('f', f[5 * kSize + 7]);  // bottom bar
  TEST_ASSERT_EQUAL('0', f[0 * kSize + 7]);  // row above the glyph
  TEST_ASSERT_EQUAL('0', f[6 * kSize + 7]);
}

void title_leaves_and_loops() {
  setTitle("I", 0);
  setMode(Mode::Title, 0);
  const uint32_t cycleMs = (4 + 8) * 120;
  TEST_ASSERT_EQUAL_STRING(render(120), render(120 + cycleMs));
  // a moment when the text has fully gone
  bool sawBlankAfterText = false;
  for (uint32_t t = 120; t < cycleMs; t += 120) {
    if (lit(render(t)) == 0) sawBlankAfterText = true;
  }
  TEST_ASSERT_TRUE(sawBlankAfterText);
}

void empty_title_is_dark() {
  setMode(Mode::Title, 0);
  TEST_ASSERT_EQUAL_STRING(off().c_str(), render(5000));
}

void setting_a_title_restarts_the_scroll() {
  setTitle("HELLO", 0);
  setMode(Mode::Title, 0);
  setTitle("HELLO", 9000);
  TEST_ASSERT_EQUAL_STRING(off().c_str(), render(9000));
}

void clock_unset_shows_dashes() {
  setMode(Mode::Clock, 0);
  const char* f = render(0);  // hours phase
  TEST_ASSERT_EQUAL('f', f[3 * kSize + 0]);  // dash middle row, first glyph
  TEST_ASSERT_EQUAL('f', f[3 * kSize + 2]);
  TEST_ASSERT_EQUAL('0', f[2 * kSize + 1]);
}

void clock_rejects_out_of_range_and_keeps_old_time() {
  TEST_ASSERT_TRUE(setClock(1, 2, 3, 0));
  TEST_ASSERT_FALSE(setClock(24, 0, 0, 0));
  TEST_ASSERT_FALSE(setClock(0, 60, 0, 0));
  TEST_ASSERT_FALSE(setClock(0, 0, 60, 0));
  setMode(Mode::Clock, 0);
  // hours phase shows "01": ones digit 1 at cols 4..6, stem is col 5
  const char* f = render(0);
  TEST_ASSERT_EQUAL('f', f[2 * kSize + 5]);
}

void clock_advances_with_millis_and_alternates_hours_minutes() {
  setClock(9, 59, 58, 1000);
  setMode(Mode::Clock, 0);
  const std::string h0 = render(1000);          // hours phase (0..2999) "09"
  const std::string m0 = render(3000);          // minutes phase "59"
  TEST_ASSERT_TRUE(h0 != m0);
  // 2 s later it is 10:00:00, still hours phase of its own window? 4000 ms is
  // minutes phase; check at 6000 (hours phase) that hour has become 10.
  const std::string h1 = render(6000);          // 10:00:03
  TEST_ASSERT_TRUE(h0 != h1);
  TEST_ASSERT_EQUAL('f', h1[1 * kSize + 7]);    // hours marker
  TEST_ASSERT_EQUAL('0', m0[1 * kSize + 7]);    // minutes: no marker
}

void clock_seconds_bar_always_shows_at_least_one() {
  setClock(0, 0, 0, 0);
  setMode(Mode::Clock, 0);
  const char* f = render(0);
  TEST_ASSERT_EQUAL('6', f[7 * kSize + 0]);
  TEST_ASSERT_EQUAL('0', f[7 * kSize + 1]);
  const char* g = render(59000);  // 59 s -> all 8
  TEST_ASSERT_EQUAL('6', g[7 * kSize + 7]);
}

void clock_wraps_at_midnight() {
  setClock(23, 59, 59, 0);
  setMode(Mode::Clock, 0);
  const std::string a = render(0);          // hours phase 23
  const std::string b = render(6000);       // 00:00:05, hours phase "00"
  TEST_ASSERT_TRUE(a != b);
  TEST_ASSERT_EQUAL('f', b[1 * kSize + 0]); // zero is ### on top row
  TEST_ASSERT_EQUAL('f', b[2 * kSize + 0]);
  TEST_ASSERT_EQUAL('0', b[3 * kSize + 1]); // zero hollow
}

void image_round_trips_and_validates() {
  std::string img;
  for (int i = 0; i < kPixels; ++i) img += "0123456789ABCDEF"[i % 16];
  TEST_ASSERT_TRUE(setImage(img.c_str()));
  setMode(Mode::Image, 0);
  std::string want = img;
  for (char& c : want) if (c >= 'A' && c <= 'F') c = (char)(c - 'A' + 'a');
  TEST_ASSERT_EQUAL_STRING(want.c_str(), render(0));

  TEST_ASSERT_FALSE(setImage("0123"));
  TEST_ASSERT_FALSE(setImage(nullptr));
  std::string bad = img;
  bad[10] = 'g';
  TEST_ASSERT_FALSE(setImage(bad.c_str()));
  TEST_ASSERT_EQUAL_STRING(want.c_str(), render(0));  // old picture kept
}

void image_mode_without_a_picture_is_dark() {
  setMode(Mode::Image, 0);
  TEST_ASSERT_EQUAL_STRING(off().c_str(), render(0));
}

void parse_uint_edges() {
  uint32_t v = 99;
  TEST_ASSERT_TRUE(parseUint("0", 59, &v));
  TEST_ASSERT_EQUAL(0, v);
  TEST_ASSERT_TRUE(parseUint("59", 59, &v));
  TEST_ASSERT_EQUAL(59, v);
  TEST_ASSERT_TRUE(parseUint("007", 59, &v));
  TEST_ASSERT_EQUAL(7, v);
  v = 99;
  TEST_ASSERT_FALSE(parseUint("60", 59, &v));
  TEST_ASSERT_FALSE(parseUint("", 59, &v));
  TEST_ASSERT_FALSE(parseUint("-1", 59, &v));
  TEST_ASSERT_FALSE(parseUint("+1", 59, &v));
  TEST_ASSERT_FALSE(parseUint(" 1", 59, &v));
  TEST_ASSERT_FALSE(parseUint("1x", 59, &v));
  TEST_ASSERT_FALSE(parseUint("99999999999999999999", 59, &v));
  TEST_ASSERT_FALSE(parseUint(nullptr, 59, &v));
  TEST_ASSERT_EQUAL(99, v);
}

void font_has_no_duplicate_or_blank_look_alikes() {
  // Each glyph is drawn alone and read back as the three columns that scroll
  // through x=0; every printable one must differ from every other, which
  // catches a copy-pasted glyph.
  const char* set = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,!?-:'/+&()_";
  const int n = (int)strlen(set);
  for (int i = 0; i < n; ++i) {
    char t[2] = {set[i], 0};
    reset();
    setTitle(t, 0);
    TEST_ASSERT_EQUAL_STRING(t, title());  // supported, not turned into '?'
  }
  std::string shapes[64];
  for (int i = 0; i < n; ++i) {
    char t[2] = {set[i], 0};
    reset();
    setTitle(t, 0);
    setMode(Mode::Title, 0);
    for (int step = 8; step < 11; ++step) {
      const char* f = render((uint32_t)step * 120);
      for (int y = 0; y < kSize; ++y) shapes[i] += f[y * kSize + 0];
    }
  }
  for (int i = 0; i < n; ++i) {
    for (int j = i + 1; j < n; ++j) {
      TEST_ASSERT_TRUE_MESSAGE(shapes[i] != shapes[j], (std::string(1, set[i]) + " == " + set[j]).c_str());
    }
  }
}

void test_mode_marks_four_corners_and_dims_the_rest() {
  setMode(Mode::Test, 0);
  const char* f = render(0);
  TEST_ASSERT_EQUAL('f', f[0]);
  TEST_ASSERT_EQUAL('f', f[7]);
  TEST_ASSERT_EQUAL('f', f[56]);
  TEST_ASSERT_EQUAL('f', f[63]);
  int dim = 0;
  for (int i = 0; i < kPixels; ++i) {
    if (i == 0 || i == 7 || i == 56 || i == 63) continue;
    TEST_ASSERT_TRUE_MESSAGE(f[i] > '0' && f[i] < 'f', rows(f).c_str());
    ++dim;
  }
  TEST_ASSERT_EQUAL(60, dim);
}

void test_mode_is_static_and_named() {
  setMode(Mode::Test, 0);
  const std::string a = render(0);
  TEST_ASSERT_EQUAL_STRING(a.c_str(), render(99999));
  Mode m = Mode::Off;
  TEST_ASSERT_TRUE(modeFromName("test", &m));
  TEST_ASSERT_EQUAL((int)Mode::Test, (int)m);
  TEST_ASSERT_EQUAL_STRING("test", modeName(Mode::Test));
}

void test_mode_corner_colours_red_green_blue_white() {
  uint8_t c[3];
  setMode(Mode::Test, 0);
  TEST_ASSERT_TRUE(pixelColor(0, c));
  TEST_ASSERT_TRUE(c[0] == 255 && c[1] == 0 && c[2] == 0);
  TEST_ASSERT_TRUE(pixelColor(7, c));
  TEST_ASSERT_TRUE(c[0] == 0 && c[1] == 255 && c[2] == 0);
  TEST_ASSERT_TRUE(pixelColor(56, c));
  TEST_ASSERT_TRUE(c[0] == 0 && c[1] == 0 && c[2] == 255);
  TEST_ASSERT_TRUE(pixelColor(63, c));
  TEST_ASSERT_TRUE(c[0] == 255 && c[1] == 255 && c[2] == 255);
  TEST_ASSERT_FALSE(pixelColor(1, c));    // dim pixels use the default colour
  TEST_ASSERT_FALSE(pixelColor(64, c));
  TEST_ASSERT_FALSE(pixelColor(-1, c));
}

void pixel_colour_is_absent_outside_test_mode() {
  uint8_t c[3];
  setMode(Mode::Bars, 0);
  TEST_ASSERT_FALSE(pixelColor(0, c));
  setMode(Mode::Off, 0);
  TEST_ASSERT_FALSE(pixelColor(63, c));
}

void brightness_defaults_low_and_validates() {
  TEST_ASSERT_EQUAL(20, brightness());
  TEST_ASSERT_TRUE(setBrightness(55));
  TEST_ASSERT_EQUAL(55, brightness());
  TEST_ASSERT_TRUE(setBrightness(1));
  TEST_ASSERT_TRUE(setBrightness(100));
  TEST_ASSERT_FALSE(setBrightness(0));
  TEST_ASSERT_FALSE(setBrightness(101));
  TEST_ASSERT_EQUAL(100, brightness());  // unchanged by refusals
  reset();
  TEST_ASSERT_EQUAL(20, brightness());
}

// ---- Alignment pattern (Drive B, ALIGNMENT-BRIEF.md) ----
namespace {
std::string alignFrame(uint16_t points, uint32_t seed, uint32_t t) {
  setAlignment(points, seed);
  setMode(Mode::Alignment, 0);
  return std::string(render(t));
}
int full(const std::string& f) {
  int n = 0;
  for (char c : f) n += c == 'f';
  return n;
}
}  // namespace

void alignment_mode_is_named_and_round_trips() {
  TEST_ASSERT_EQUAL_STRING("alignment", modeName(Mode::Alignment));
  Mode back = Mode::Off;
  TEST_ASSERT_TRUE(modeFromName("alignment", &back));
  TEST_ASSERT_EQUAL((int)Mode::Alignment, (int)back);
}

void alignment_at_zero_has_no_locked_nodes_but_is_not_dark() {
  const std::string f = alignFrame(0, 7, 1000);
  TEST_ASSERT_EQUAL(0, full(f));
  TEST_ASSERT_TRUE(lit(f.c_str()) >= 12);  // scattered dim points, not a blank panel
  for (char c : f) TEST_ASSERT_TRUE(c <= '9');  // nothing near full
}

void alignment_at_full_is_every_pixel_locked_and_still() {
  const std::string a = alignFrame(6400, 7, 0);
  TEST_ASSERT_EQUAL_STRING(std::string(kPixels, 'f').c_str(), a.c_str());
  TEST_ASSERT_EQUAL_STRING(a.c_str(), alignFrame(6400, 7, 123456).c_str());
}

void alignment_points_above_the_full_bar_are_held() {
  TEST_ASSERT_EQUAL_STRING(std::string(kPixels, 'f').c_str(),
                           alignFrame(65535, 3, 500).c_str());
  setAlignment(65535, 3);
  TEST_ASSERT_EQUAL(kAlignMaxPoints, alignmentPoints());
}

void alignment_is_deterministic_for_a_total_seed_and_time() {
  TEST_ASSERT_EQUAL_STRING(alignFrame(2300, 99, 4200).c_str(), alignFrame(2300, 99, 4200).c_str());
  TEST_ASSERT_FALSE(alignFrame(2300, 99, 4200) == alignFrame(2300, 100, 4200));
}

void alignment_locked_nodes_grow_one_at_a_time_and_never_vanish() {
  std::string prev(kPixels, '0');
  int prevFull = 0;
  for (int nodes = 0; nodes <= 64; ++nodes) {
    const std::string f = alignFrame((uint16_t)(nodes * 100), 5, 777);
    TEST_ASSERT_EQUAL(nodes, full(f));          // exactly the locked ones are full
    TEST_ASSERT_TRUE(full(f) >= prevFull);      // monotone
    for (int n = 0; n < nodes; ++n) {           // each locked node sits in its own cell
      int x, y;
      TEST_ASSERT_TRUE(alignmentCell(n, &x, &y));
      TEST_ASSERT_EQUAL_CHAR('f', f[y * kSize + x]);
    }
    prevFull = full(f);
  }
}

void alignment_a_partly_earned_node_glows_but_is_not_locked() {
  const std::string f = alignFrame(1099, 5, 777);  // 10 locked, the 11th at 99%
  TEST_ASSERT_EQUAL(10, full(f));
  const std::string g = alignFrame(1000, 5, 777);
  TEST_ASSERT_EQUAL(10, full(g));
}

void alignment_settles_as_points_rise() {
  // Wandering shrinks: the share of unlocked nodes sitting on their own cell
  // rises with alignment (measured over many time steps).
  auto atHome = [](uint16_t points) {
    int home = 0, total = 0;
    for (uint32_t step = 0; step < 40; ++step) {
      const std::string f = alignFrame(points, 11, step * 350 + 10);
      for (int n = points / 100 + 1; n < 64; ++n) {
        int x, y;
        alignmentCell(n, &x, &y);
        ++total;
        home += f[y * kSize + x] != '0';
      }
    }
    return total ? home * 100 / total : 100;
  };
  TEST_ASSERT_TRUE(atHome(5600) > atHome(3200));
  TEST_ASSERT_TRUE(atHome(3200) > atHome(400));
}

void alignment_wanders_over_time_at_low_alignment_only() {
  TEST_ASSERT_FALSE(alignFrame(300, 5, 0) == alignFrame(300, 5, 3500));
  const std::string a = alignFrame(6400, 5, 0);
  TEST_ASSERT_EQUAL_STRING(a.c_str(), alignFrame(6400, 5, 3500).c_str());
}

void alignment_cells_cover_the_panel_once_in_the_agreed_order() {
  bool seen[kPixels] = {false};
  for (int n = 0; n < kPixels; ++n) {
    int x, y;
    TEST_ASSERT_TRUE(alignmentCell(n, &x, &y));
    TEST_ASSERT_FALSE(seen[y * kSize + x]);
    seen[y * kSize + x] = true;
  }
  int x, y;
  TEST_ASSERT_FALSE(alignmentCell(64, &x, &y));
  TEST_ASSERT_FALSE(alignmentCell(-1, &x, &y));
  // The page lattice (test/drive-b.test.js) pins these same first cells.
  const int want[10][2] = {{0, 7}, {0, 6}, {1, 7}, {0, 5}, {1, 6}, {2, 7}, {0, 4}, {1, 5}, {2, 6}, {3, 7}};
  for (int n = 0; n < 10; ++n) {
    alignmentCell(n, &x, &y);
    TEST_ASSERT_EQUAL(want[n][0], x);
    TEST_ASSERT_EQUAL(want[n][1], y);
  }
  alignmentCell(63, &x, &y);
  TEST_ASSERT_EQUAL(7, x);
  TEST_ASSERT_EQUAL(0, y);
}

void alignment_total_matches_the_counter_cap() {
  TEST_ASSERT_EQUAL(alignment::kMaxPoints, kAlignMaxPoints);
  TEST_ASSERT_EQUAL(alignment::kNodePoints, kAlignNodePoints);
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(frame_is_64_hex_chars_and_off_is_dark);
  RUN_TEST(every_mode_renders_only_hex);
  RUN_TEST(mode_names_round_trip);
  RUN_TEST(bars_test_pattern_moves_with_nothing_fed);
  RUN_TEST(bars_draw_fed_levels_from_the_bottom);
  RUN_TEST(bars_clamp_levels_above_eight);
  RUN_TEST(bars_fall_back_to_test_pattern_when_audio_goes_stale);
  RUN_TEST(fresh_check_survives_millis_wrap);
  RUN_TEST(dazzle_drifts_and_lifts_with_audio);
  RUN_TEST(dazzle_is_deterministic);
  RUN_TEST(title_is_sanitised);
  RUN_TEST(title_scrolls_in_from_the_right);
  RUN_TEST(title_leaves_and_loops);
  RUN_TEST(empty_title_is_dark);
  RUN_TEST(setting_a_title_restarts_the_scroll);
  RUN_TEST(clock_unset_shows_dashes);
  RUN_TEST(clock_rejects_out_of_range_and_keeps_old_time);
  RUN_TEST(clock_advances_with_millis_and_alternates_hours_minutes);
  RUN_TEST(clock_seconds_bar_always_shows_at_least_one);
  RUN_TEST(clock_wraps_at_midnight);
  RUN_TEST(image_round_trips_and_validates);
  RUN_TEST(image_mode_without_a_picture_is_dark);
  RUN_TEST(parse_uint_edges);
  RUN_TEST(test_mode_marks_four_corners_and_dims_the_rest);
  RUN_TEST(test_mode_is_static_and_named);
  RUN_TEST(test_mode_corner_colours_red_green_blue_white);
  RUN_TEST(pixel_colour_is_absent_outside_test_mode);
  RUN_TEST(brightness_defaults_low_and_validates);
  RUN_TEST(font_has_no_duplicate_or_blank_look_alikes);
  RUN_TEST(alignment_mode_is_named_and_round_trips);
  RUN_TEST(alignment_at_zero_has_no_locked_nodes_but_is_not_dark);
  RUN_TEST(alignment_at_full_is_every_pixel_locked_and_still);
  RUN_TEST(alignment_points_above_the_full_bar_are_held);
  RUN_TEST(alignment_is_deterministic_for_a_total_seed_and_time);
  RUN_TEST(alignment_locked_nodes_grow_one_at_a_time_and_never_vanish);
  RUN_TEST(alignment_a_partly_earned_node_glows_but_is_not_locked);
  RUN_TEST(alignment_settles_as_points_rise);
  RUN_TEST(alignment_wanders_over_time_at_low_alignment_only);
  RUN_TEST(alignment_cells_cover_the_panel_once_in_the_agreed_order);
  RUN_TEST(alignment_total_matches_the_counter_cap);
  return UNITY_END();
}
