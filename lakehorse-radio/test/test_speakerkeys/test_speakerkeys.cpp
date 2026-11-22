//
// Host-side tests for the speaker-button mapping. Run with: pio test -e native
//
#include <unity.h>

#include "speaker_keys.h"

using speakerkeys::Action;
using speakerkeys::actionFor;

void play_toggles_by_current_state() {
  TEST_ASSERT_EQUAL(Action::Pause, actionFor(0x44, false, true));
  TEST_ASSERT_EQUAL(Action::Resume, actionFor(0x44, false, false));
}

void pause_and_stop_only_pause() {
  TEST_ASSERT_EQUAL(Action::Pause, actionFor(0x46, false, true));
  TEST_ASSERT_EQUAL(Action::Pause, actionFor(0x46, false, false));
  TEST_ASSERT_EQUAL(Action::Pause, actionFor(0x45, false, true));
}

void skip_buttons_map_to_next_and_restart() {
  TEST_ASSERT_EQUAL(Action::Next, actionFor(0x4B, false, true));
  TEST_ASSERT_EQUAL(Action::Restart, actionFor(0x4C, false, true));
}

void a_release_does_nothing() {
  TEST_ASSERT_EQUAL(Action::None, actionFor(0x44, true, true));
  TEST_ASSERT_EQUAL(Action::None, actionFor(0x4B, true, true));
}

void unknown_keys_do_nothing() {
  TEST_ASSERT_EQUAL(Action::None, actionFor(0x41, false, true));  // volume up
  TEST_ASSERT_EQUAL(Action::None, actionFor(0x00, false, false));
}

void setUp() {}
void tearDown() {}

int main() {
  UNITY_BEGIN();
  RUN_TEST(play_toggles_by_current_state);
  RUN_TEST(pause_and_stop_only_pause);
  RUN_TEST(skip_buttons_map_to_next_and_restart);
  RUN_TEST(a_release_does_nothing);
  RUN_TEST(unknown_keys_do_nothing);
  return UNITY_END();
}
