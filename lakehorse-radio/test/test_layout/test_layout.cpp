//
// Host-side tests for the panel layout mapping. Run: pio test -e native -f test_layout
//
#include <unity.h>

#include "matrix_layout.h"

using namespace matrixlayout;

namespace {
const Wiring kWirings[] = {Wiring::Serpentine, Wiring::Progressive};
const Origin kOrigins[] = {Origin::TopLeft, Origin::TopRight, Origin::BottomLeft,
                           Origin::BottomRight};
}  // namespace

void setUp() {}
void tearDown() {}

void every_logical_pixel_maps_to_one_distinct_index_in_every_layout() {
  for (Wiring w : kWirings) {
    for (Origin o : kOrigins) {
      bool seen[kPixels] = {false};
      for (int i = 0; i < kPixels; ++i) {
        const int p = physicalIndex(i, w, o);
        TEST_ASSERT_TRUE(p >= 0 && p < kPixels);
        TEST_ASSERT_FALSE_MESSAGE(seen[p], originName(o));
        seen[p] = true;
      }
    }
  }
}

void default_layout_serpentine_top_left_corners() {
  const Wiring w = Wiring::Serpentine;
  const Origin o = Origin::TopLeft;
  TEST_ASSERT_EQUAL(0, physicalIndex(0, w, o));    // top left
  TEST_ASSERT_EQUAL(7, physicalIndex(7, w, o));    // top right
  TEST_ASSERT_EQUAL(63, physicalIndex(56, w, o));  // bottom left: row 7 is odd, so reversed
  TEST_ASSERT_EQUAL(56, physicalIndex(63, w, o));
}

void serpentine_reverses_odd_rows_only() {
  const Wiring w = Wiring::Serpentine;
  const Origin o = Origin::TopLeft;
  TEST_ASSERT_EQUAL(15, physicalIndex(8, w, o));   // row 1, first column
  TEST_ASSERT_EQUAL(8, physicalIndex(15, w, o));
  TEST_ASSERT_EQUAL(16, physicalIndex(16, w, o));  // row 2 runs forward
}

void progressive_never_reverses() {
  for (Origin o : kOrigins) {
    const int a = physicalIndex(8, Wiring::Progressive, o);
    const int b = physicalIndex(9, Wiring::Progressive, o);
    TEST_ASSERT_EQUAL(o == Origin::TopRight || o == Origin::BottomRight ? -1 : 1, b - a);
  }
}

void origin_puts_strip_start_on_the_named_corner() {
  const int corner[4] = {0, 7, 56, 63};  // logical TL, TR, BL, BR
  for (int k = 0; k < 4; ++k) {
    for (Wiring w : kWirings) {
      TEST_ASSERT_EQUAL(0, physicalIndex(corner[k], w, kOrigins[k]));
    }
  }
}

void progressive_corner_indices_for_top_left() {
  const Wiring w = Wiring::Progressive;
  const Origin o = Origin::TopLeft;
  TEST_ASSERT_EQUAL(7, physicalIndex(7, w, o));
  TEST_ASSERT_EQUAL(56, physicalIndex(56, w, o));
  TEST_ASSERT_EQUAL(63, physicalIndex(63, w, o));
}

void bottom_right_serpentine_corners() {
  const Wiring w = Wiring::Serpentine;
  const Origin o = Origin::BottomRight;
  TEST_ASSERT_EQUAL(0, physicalIndex(63, w, o));
  TEST_ASSERT_EQUAL(7, physicalIndex(56, w, o));  // strip runs left along the bottom row
  TEST_ASSERT_EQUAL(56, physicalIndex(0, w, o));  // top left: row 7 is odd, so it ends at 56
}

void out_of_range_is_rejected() {
  TEST_ASSERT_EQUAL(-1, physicalIndex(-1, Wiring::Serpentine, Origin::TopLeft));
  TEST_ASSERT_EQUAL(-1, physicalIndex(64, Wiring::Serpentine, Origin::TopLeft));
}

void names_round_trip_and_reject_junk() {
  for (Wiring w : kWirings) {
    Wiring x = Wiring::Serpentine;
    TEST_ASSERT_TRUE(wiringFromName(wiringName(w), &x));
    TEST_ASSERT_EQUAL((int)w, (int)x);
  }
  for (Origin o : kOrigins) {
    Origin x = Origin::TopLeft;
    TEST_ASSERT_TRUE(originFromName(originName(o), &x));
    TEST_ASSERT_EQUAL((int)o, (int)x);
  }
  Origin keep = Origin::BottomLeft;
  TEST_ASSERT_FALSE(originFromName("TL", &keep));
  TEST_ASSERT_FALSE(originFromName(nullptr, &keep));
  TEST_ASSERT_EQUAL((int)Origin::BottomLeft, (int)keep);
  Wiring wk = Wiring::Progressive;
  TEST_ASSERT_FALSE(wiringFromName("snake", &wk));
  TEST_ASSERT_EQUAL((int)Wiring::Progressive, (int)wk);
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(every_logical_pixel_maps_to_one_distinct_index_in_every_layout);
  RUN_TEST(default_layout_serpentine_top_left_corners);
  RUN_TEST(serpentine_reverses_odd_rows_only);
  RUN_TEST(progressive_never_reverses);
  RUN_TEST(origin_puts_strip_start_on_the_named_corner);
  RUN_TEST(progressive_corner_indices_for_top_left);
  RUN_TEST(bottom_right_serpentine_corners);
  RUN_TEST(out_of_range_is_rejected);
  RUN_TEST(names_round_trip_and_reject_junk);
  return UNITY_END();
}
