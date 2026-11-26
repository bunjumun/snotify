//
// Host-side tests for the saved-network list (src/saved_networks.h).
// Run with: pio test -e native
//
#include <unity.h>

#include "saved_networks.h"

using savednets::Net;
using savednets::List;

namespace {
List three() { return {{"home", "pw-home-1"}, {"phone", "pw-phone-1"}, {"barn", ""}}; }
}  // namespace

void remembering_a_new_network_puts_it_first() {
  const List out = savednets::remember(three(), "venue", "pw-venue-1", 5);
  TEST_ASSERT_EQUAL(4, (int)out.size());
  TEST_ASSERT_EQUAL_STRING("venue", out[0].ssid.c_str());
  TEST_ASSERT_EQUAL_STRING("home", out[1].ssid.c_str());
}

void remembering_a_known_network_moves_it_and_updates_the_password() {
  const List out = savednets::remember(three(), "barn", "newpassword", 5);
  TEST_ASSERT_EQUAL(3, (int)out.size());
  TEST_ASSERT_EQUAL_STRING("barn", out[0].ssid.c_str());
  TEST_ASSERT_EQUAL_STRING("newpassword", out[0].password.c_str());
  TEST_ASSERT_EQUAL_STRING("home", out[1].ssid.c_str());
  TEST_ASSERT_EQUAL_STRING("phone", out[2].ssid.c_str());
}

void remembering_past_the_limit_drops_the_oldest() {
  const List out = savednets::remember(three(), "venue", "pw-venue-1", 3);
  TEST_ASSERT_EQUAL(3, (int)out.size());
  TEST_ASSERT_EQUAL_STRING("venue", out[0].ssid.c_str());
  TEST_ASSERT_EQUAL_STRING("phone", out[2].ssid.c_str());
}

void remembering_leaves_the_original_untouched() {
  const List before = three();
  savednets::remember(before, "venue", "pw-venue-1", 5);
  TEST_ASSERT_EQUAL(3, (int)before.size());
  TEST_ASSERT_EQUAL_STRING("home", before[0].ssid.c_str());
}

void promoting_moves_a_network_first_and_keeps_its_password() {
  const List out = savednets::promote(three(), "phone");
  TEST_ASSERT_EQUAL_STRING("phone", out[0].ssid.c_str());
  TEST_ASSERT_EQUAL_STRING("pw-phone-1", out[0].password.c_str());
  TEST_ASSERT_EQUAL(3, (int)out.size());
}

void promoting_an_unknown_network_changes_nothing() {
  const List out = savednets::promote(three(), "nope");
  TEST_ASSERT_TRUE(savednets::sameOrder(out, three()));
}

void forgetting_removes_only_that_network() {
  const List out = savednets::forget(three(), "phone");
  TEST_ASSERT_EQUAL(2, (int)out.size());
  TEST_ASSERT_EQUAL(-1, savednets::indexOf(out, "phone"));
  TEST_ASSERT_EQUAL_STRING("barn", out[1].ssid.c_str());
}

void forgetting_an_unknown_network_changes_nothing() {
  TEST_ASSERT_EQUAL(3, (int)savednets::forget(three(), "nope").size());
}

void best_in_range_picks_the_strongest_saved_network() {
  const std::vector<savednets::Seen> seen = {{"cafe", -40}, {"barn", -60}, {"phone", -50}};
  TEST_ASSERT_EQUAL(1, savednets::bestInRange(three(), seen));
}

void best_in_range_uses_the_strongest_sighting_of_a_name() {
  const std::vector<savednets::Seen> seen = {{"home", -80}, {"barn", -60}, {"home", -45}};
  TEST_ASSERT_EQUAL(0, savednets::bestInRange(three(), seen));
}

void best_in_range_is_minus_one_when_nothing_saved_is_seen() {
  const std::vector<savednets::Seen> seen = {{"cafe", -40}};
  TEST_ASSERT_EQUAL(-1, savednets::bestInRange(three(), seen));
  TEST_ASSERT_EQUAL(-1, savednets::bestInRange(List{}, seen));
  TEST_ASSERT_EQUAL(-1, savednets::bestInRange(three(), {}));
}

void next_walks_the_list_and_wraps() {
  TEST_ASSERT_EQUAL(1, savednets::next(0, 3));
  TEST_ASSERT_EQUAL(0, savednets::next(2, 3));
  TEST_ASSERT_EQUAL(0, savednets::next(7, 3));
  TEST_ASSERT_EQUAL(0, savednets::next(0, 1));
  TEST_ASSERT_EQUAL(0, savednets::next(0, 0));
}

void valid_follows_the_802_11_limits() {
  TEST_ASSERT_TRUE(savednets::valid("home", ""));
  TEST_ASSERT_TRUE(savednets::valid("home", "12345678"));
  TEST_ASSERT_FALSE(savednets::valid("", "12345678"));
  TEST_ASSERT_FALSE(savednets::valid("home", "short"));
  TEST_ASSERT_FALSE(savednets::valid(std::string(33, 'a'), ""));
  TEST_ASSERT_FALSE(savednets::valid("home", std::string(64, 'p')));
}

void setUp() {}
void tearDown() {}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(remembering_a_new_network_puts_it_first);
  RUN_TEST(remembering_a_known_network_moves_it_and_updates_the_password);
  RUN_TEST(remembering_past_the_limit_drops_the_oldest);
  RUN_TEST(remembering_leaves_the_original_untouched);
  RUN_TEST(promoting_moves_a_network_first_and_keeps_its_password);
  RUN_TEST(promoting_an_unknown_network_changes_nothing);
  RUN_TEST(forgetting_removes_only_that_network);
  RUN_TEST(forgetting_an_unknown_network_changes_nothing);
  RUN_TEST(best_in_range_picks_the_strongest_saved_network);
  RUN_TEST(best_in_range_uses_the_strongest_sighting_of_a_name);
  RUN_TEST(best_in_range_is_minus_one_when_nothing_saved_is_seen);
  RUN_TEST(next_walks_the_list_and_wraps);
  RUN_TEST(valid_follows_the_802_11_limits);
  return UNITY_END();
}
