//
// Host-side tests for the pairing window (src/pair_window.h).
// Run with: pio test -e native
//
#include <unity.h>

#include "pair_window.h"

using pairwindow::Window;

namespace {
constexpr uint32_t kOpenMs = 120000;
constexpr uint32_t kHoldMs = 3000;
}  // namespace

void a_new_window_is_closed() {
  const Window w;
  TEST_ASSERT_FALSE(pairwindow::isOpen(w, 5000, kOpenMs));
}

void opening_lasts_exactly_the_window() {
  const Window w = pairwindow::open(Window{}, 1000);
  TEST_ASSERT_TRUE(pairwindow::isOpen(w, 1000, kOpenMs));
  TEST_ASSERT_TRUE(pairwindow::isOpen(w, 1000 + kOpenMs - 1, kOpenMs));
  TEST_ASSERT_FALSE(pairwindow::isOpen(w, 1000 + kOpenMs, kOpenMs));
}

void opening_survives_the_millis_rollover() {
  const Window w = pairwindow::open(Window{}, 0xFFFFFF00u);
  TEST_ASSERT_TRUE(pairwindow::isOpen(w, 0x00000100u, kOpenMs));
}

void a_short_press_does_not_open_it() {
  Window w;
  w = pairwindow::button(w, true, 0, kHoldMs);
  w = pairwindow::button(w, true, kHoldMs - 1, kHoldMs);
  w = pairwindow::button(w, false, kHoldMs + 10, kHoldMs);
  TEST_ASSERT_FALSE(pairwindow::isOpen(w, kHoldMs + 20, kOpenMs));
}

void holding_long_enough_opens_it() {
  Window w;
  w = pairwindow::button(w, true, 500, kHoldMs);
  w = pairwindow::button(w, true, 500 + kHoldMs, kHoldMs);
  TEST_ASSERT_TRUE(pairwindow::isOpen(w, 500 + kHoldMs, kOpenMs));
}

void releasing_restarts_the_hold() {
  Window w;
  w = pairwindow::button(w, true, 0, kHoldMs);
  w = pairwindow::button(w, false, 2000, kHoldMs);
  w = pairwindow::button(w, true, 2500, kHoldMs);
  w = pairwindow::button(w, true, 4000, kHoldMs);
  TEST_ASSERT_FALSE(pairwindow::isOpen(w, 4000, kOpenMs));
  w = pairwindow::button(w, true, 2500 + kHoldMs, kHoldMs);
  TEST_ASSERT_TRUE(pairwindow::isOpen(w, 2500 + kHoldMs, kOpenMs));
}

void a_button_held_from_millis_zero_still_counts() {
  Window w;
  w = pairwindow::button(w, true, 0, kHoldMs);
  w = pairwindow::button(w, true, kHoldMs, kHoldMs);
  TEST_ASSERT_TRUE(pairwindow::isOpen(w, kHoldMs, kOpenMs));
}

void setUp() {}
void tearDown() {}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(a_new_window_is_closed);
  RUN_TEST(opening_lasts_exactly_the_window);
  RUN_TEST(opening_survives_the_millis_rollover);
  RUN_TEST(a_short_press_does_not_open_it);
  RUN_TEST(holding_long_enough_opens_it);
  RUN_TEST(releasing_restarts_the_hold);
  RUN_TEST(a_button_held_from_millis_zero_still_counts);
  return UNITY_END();
}
