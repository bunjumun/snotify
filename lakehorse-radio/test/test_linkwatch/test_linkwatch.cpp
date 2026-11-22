//
// Host-side tests for the dead-link decision (src/link_watch.h).
// Run with: pio test -e native
//
#include <unity.h>

#include "link_watch.h"

using linkwatch::Action;
using linkwatch::Watch;

namespace {
constexpr linkwatch::Policy kPolicy{3, 1};

Watch armedWatch() {
  Watch w(kPolicy);
  w.onProbe(true, true);
  return w;
}

// Feeds `n` failed probes and returns the last action.
Action failN(Watch& w, int n, bool restartAllowed = true) {
  Action a = Action::None;
  for (int i = 0; i < n; i++) a = w.onProbe(false, restartAllowed);
  return a;
}
}  // namespace

void never_acts_before_the_gateway_has_answered() {
  Watch w(kPolicy);
  TEST_ASSERT_EQUAL(Action::None, failN(w, 50));
  TEST_ASSERT_FALSE(w.armed());
}

void reconnects_after_the_configured_number_of_failures() {
  Watch w = armedWatch();
  TEST_ASSERT_EQUAL(Action::None, failN(w, 2));
  TEST_ASSERT_EQUAL(Action::Reconnect, w.onProbe(false, true));
}

void one_reply_clears_the_count() {
  Watch w = armedWatch();
  failN(w, 2);
  w.onProbe(true, true);
  TEST_ASSERT_EQUAL(Action::None, failN(w, 2));
  TEST_ASSERT_EQUAL(0, w.reconnects());
}

void restarts_when_a_reconnect_did_not_help() {
  Watch w = armedWatch();
  TEST_ASSERT_EQUAL(Action::Reconnect, failN(w, 3));
  TEST_ASSERT_EQUAL(Action::None, failN(w, 2));
  TEST_ASSERT_EQUAL(Action::Restart, w.onProbe(false, true));
}

void a_reply_after_reconnecting_cancels_the_restart() {
  Watch w = armedWatch();
  failN(w, 3);
  w.onProbe(true, true);
  TEST_ASSERT_EQUAL(Action::Reconnect, failN(w, 3));
}

void holds_the_restart_while_a_song_plays_then_takes_it() {
  Watch w = armedWatch();
  failN(w, 3);
  TEST_ASSERT_EQUAL(Action::None, failN(w, 300, /*restartAllowed=*/false));
  TEST_ASSERT_EQUAL(Action::Restart, w.onProbe(false, true));
}

void reset_disarms_for_a_new_network() {
  Watch w = armedWatch();
  failN(w, 2);
  w.reset();
  TEST_ASSERT_EQUAL(Action::None, failN(w, 10));
}

void setUp() {}
void tearDown() {}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(never_acts_before_the_gateway_has_answered);
  RUN_TEST(reconnects_after_the_configured_number_of_failures);
  RUN_TEST(one_reply_clears_the_count);
  RUN_TEST(restarts_when_a_reconnect_did_not_help);
  RUN_TEST(a_reply_after_reconnecting_cancels_the_restart);
  RUN_TEST(holds_the_restart_while_a_song_plays_then_takes_it);
  RUN_TEST(reset_disarms_for_a_new_network);
  return UNITY_END();
}
