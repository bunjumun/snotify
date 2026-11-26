//
// Host-side tests for the hotspot retry timing (src/hotspot_retry.h).
// Run with: pio test -e native
//
#include <unity.h>

#include "hotspot_retry.h"

using hotspotretry::due;
using hotspotretry::intervalMs;
using hotspotretry::SearchAction;
using hotspotretry::searchAction;

namespace {
constexpr uint32_t kNormal = 30000;
constexpr uint32_t kWithClient = 300000;
}  // namespace

void nobody_on_the_hotspot_keeps_the_normal_interval() {
  TEST_ASSERT_EQUAL_UINT32(kNormal, intervalMs(kNormal, kWithClient, true, 0));
}

void a_phone_on_the_hotspot_uses_the_long_interval() {
  TEST_ASSERT_EQUAL_UINT32(kWithClient, intervalMs(kNormal, kWithClient, true, 1));
  TEST_ASSERT_EQUAL_UINT32(kWithClient, intervalMs(kNormal, kWithClient, true, 4));
}

void a_client_count_is_ignored_when_the_hotspot_is_down() {
  TEST_ASSERT_EQUAL_UINT32(kNormal, intervalMs(kNormal, kWithClient, false, 2));
}

void due_only_once_the_interval_has_passed() {
  TEST_ASSERT_FALSE(due(29999, 0, kNormal));
  TEST_ASSERT_TRUE(due(30000, 0, kNormal));
  TEST_ASSERT_FALSE(due(299999, 0, kWithClient));
  TEST_ASSERT_TRUE(due(300000, 0, kWithClient));
}

void a_phone_that_joins_mid_wait_stretches_the_wait_and_never_shortens_it() {
  // Last attempt at 0. At 20 s nobody is on the hotspot, so a retry is not yet due.
  TEST_ASSERT_FALSE(due(20000, 0, intervalMs(kNormal, kWithClient, true, 0)));
  // A phone joins at 25 s: the retry that would have fired at 30 s does not.
  TEST_ASSERT_FALSE(due(30000, 0, intervalMs(kNormal, kWithClient, true, 1)));
  // It still comes eventually, so a box left with a phone attached can rejoin home.
  TEST_ASSERT_TRUE(due(300000, 0, intervalMs(kNormal, kWithClient, true, 1)));
}

void survives_the_millis_rollover() {
  const uint32_t last = 0xFFFFFFFFu - 5000u;
  TEST_ASSERT_FALSE(due(10000u, last, kNormal));
  TEST_ASSERT_TRUE(due(30000u, last, kNormal));
}

// searchAction(apUp, apClients, stationConnected, personAttempt, cancelled)
void a_phone_joining_during_a_search_cancels_it() {
  TEST_ASSERT_EQUAL(SearchAction::Cancel, searchAction(true, 1, false, false, false));
  TEST_ASSERT_EQUAL(SearchAction::Cancel, searchAction(true, 3, false, false, false));
}

void nothing_is_cancelled_with_no_phone_or_no_hotspot() {
  TEST_ASSERT_EQUAL(SearchAction::None, searchAction(true, 0, false, false, false));
  TEST_ASSERT_EQUAL(SearchAction::None, searchAction(false, 2, false, false, false));
}

void a_join_the_owner_started_is_never_cancelled() {
  TEST_ASSERT_EQUAL(SearchAction::None, searchAction(true, 1, false, true, false));
}

void nothing_is_cancelled_once_the_station_is_connected() {
  TEST_ASSERT_EQUAL(SearchAction::None, searchAction(true, 1, true, false, false));
}

void a_cancelled_search_stays_cancelled_while_a_phone_is_on() {
  TEST_ASSERT_EQUAL(SearchAction::None, searchAction(true, 1, false, false, true));
  TEST_ASSERT_EQUAL(SearchAction::None, searchAction(true, 2, false, false, true));
}

void the_search_resumes_when_the_last_phone_leaves() {
  TEST_ASSERT_EQUAL(SearchAction::Resume, searchAction(true, 0, false, false, true));
}

void the_search_resumes_when_the_hotspot_goes_down() {
  TEST_ASSERT_EQUAL(SearchAction::Resume, searchAction(false, 0, true, false, true));
  TEST_ASSERT_EQUAL(SearchAction::Resume, searchAction(false, 1, false, false, true));
}

void an_owner_join_lifts_an_earlier_cancel() {
  TEST_ASSERT_EQUAL(SearchAction::Resume, searchAction(true, 1, false, true, true));
}

void setUp() {}
void tearDown() {}


void the_join_window_is_open_right_after_join_and_until_it_runs_out() {
  TEST_ASSERT_TRUE(hotspotretry::inJoinWindow(1000, 1000, 180000, true));
  TEST_ASSERT_TRUE(hotspotretry::inJoinWindow(180999, 1000, 180000, true));
  TEST_ASSERT_FALSE(hotspotretry::inJoinWindow(181000, 1000, 180000, true));
}

void the_join_window_is_shut_when_not_started() {
  TEST_ASSERT_FALSE(hotspotretry::inJoinWindow(1000, 1000, 180000, false));
}

void the_join_window_survives_millis_rollover() {
  TEST_ASSERT_TRUE(hotspotretry::inJoinWindow(5000, 0xFFFFF000u, 180000, true));
  TEST_ASSERT_FALSE(hotspotretry::inJoinWindow(200000, 0xFFFFF000u, 180000, true));
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(nobody_on_the_hotspot_keeps_the_normal_interval);
  RUN_TEST(a_phone_on_the_hotspot_uses_the_long_interval);
  RUN_TEST(a_client_count_is_ignored_when_the_hotspot_is_down);
  RUN_TEST(due_only_once_the_interval_has_passed);
  RUN_TEST(a_phone_that_joins_mid_wait_stretches_the_wait_and_never_shortens_it);
  RUN_TEST(survives_the_millis_rollover);
  RUN_TEST(a_phone_joining_during_a_search_cancels_it);
  RUN_TEST(nothing_is_cancelled_with_no_phone_or_no_hotspot);
  RUN_TEST(a_join_the_owner_started_is_never_cancelled);
  RUN_TEST(nothing_is_cancelled_once_the_station_is_connected);
  RUN_TEST(a_cancelled_search_stays_cancelled_while_a_phone_is_on);
  RUN_TEST(the_search_resumes_when_the_last_phone_leaves);
  RUN_TEST(the_search_resumes_when_the_hotspot_goes_down);
  RUN_TEST(an_owner_join_lifts_an_earlier_cancel);
  RUN_TEST(the_join_window_is_open_right_after_join_and_until_it_runs_out);
  RUN_TEST(the_join_window_is_shut_when_not_started);
  RUN_TEST(the_join_window_survives_millis_rollover);
  return UNITY_END();
}
