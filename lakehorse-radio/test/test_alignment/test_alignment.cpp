//
// Host-side tests for the alignment counter. Run with: pio test -e native -f test_alignment
//
#include <math.h>
#include <stdio.h>
#include <string.h>
#include <unity.h>

#include "alignment.h"

using namespace alignment;

namespace {

struct FakeStorage : Storage {
  uint16_t points = 0;
  uint32_t levels = 0;
  int saves = 0;
  bool loadOk = true;
  bool saveOk = true;
  bool load(uint16_t& p, uint32_t& l) override {
    if (!loadOk) return false;
    p = points;
    l = levels;
    return true;
  }
  bool save(uint16_t p, uint32_t l) override {
    saves++;
    if (!saveOk) return false;
    points = p;
    levels = l;
    return true;
  }
};

constexpr uint32_t kStep = 11000;  // clear of the repeat window

// A clock that always moves past the repeat window.
struct Clock {
  uint32_t t = 0;
  uint32_t next() { return t += kStep; }
};

EventResult song(Counter& c, Clock& k, const char* id, Result r) {
  return c.submit(Source::Song, id, r, k.next());
}
EventResult level(Counter& c, Clock& k, const char* id, Result r) {
  return c.submit(Source::Level, id, r, k.next());
}

}  // namespace

void setUp() {}
void tearDown() {}

void ten_partials_land_on_100() {
  Counter c; FakeStorage s; Clock k; c.begin(&s);
  for (int i = 0; i < 10; ++i) TEST_ASSERT_EQUAL(Outcome::Credited, song(c, k, "A.wav", Result::Partial).outcome);
  TEST_ASSERT_EQUAL_UINT16(100, c.points());
}

void one_full_is_100() {
  Counter c; FakeStorage s; Clock k; c.begin(&s);
  const EventResult r = song(c, k, "A.wav", Result::Full);
  TEST_ASSERT_EQUAL_UINT16(100, r.added);
  TEST_ASSERT_EQUAL_UINT16(100, c.points());
}

void twenty_attempts_land_on_100() {
  Counter c; FakeStorage s; Clock k; c.begin(&s);
  for (int i = 0; i < 20; ++i) level(c, k, "4", Result::Attempt);
  TEST_ASSERT_EQUAL_UINT16(100, c.points());
}

void a_clear_is_100_not_105_and_sets_its_bit() {
  Counter c; FakeStorage s; Clock k; c.begin(&s);
  const EventResult r = level(c, k, "5", Result::Clear);
  TEST_ASSERT_EQUAL_UINT16(100, r.added);
  TEST_ASSERT_EQUAL_UINT16(100, c.points());
  TEST_ASSERT_EQUAL_HEX32(1u << 5, c.levelsCleared());
  level(c, k, "31", Result::Clear);
  TEST_ASSERT_EQUAL_HEX32((1u << 5) | (1u << 31), c.levelsCleared());
}

void one_event_earns_exactly_one_value() {
  Counter c; FakeStorage s; Clock k; c.begin(&s);
  TEST_ASSERT_EQUAL_UINT16(100, song(c, k, "A.wav", Result::Full).added);
  TEST_ASSERT_EQUAL_UINT16(10, song(c, k, "B.wav", Result::Partial).added);
  TEST_ASSERT_EQUAL_UINT16(5, level(c, k, "1", Result::Attempt).added);
  TEST_ASSERT_EQUAL_UINT16(115, c.points());
}

void cap_holds_at_6400() {
  Counter c; FakeStorage s; Clock k; c.begin(&s);
  for (int i = 0; i < 64; ++i) song(c, k, "A.wav", Result::Full);
  TEST_ASSERT_EQUAL_UINT16(6400, c.points());
  TEST_ASSERT_EQUAL_UINT8(100, c.percent());
  TEST_ASSERT_EQUAL_UINT16(64, c.nodes());
  const int savesAtCap = s.saves;
  const EventResult more = song(c, k, "A.wav", Result::Full);
  TEST_ASSERT_EQUAL(Outcome::Credited, more.outcome);
  TEST_ASSERT_EQUAL_UINT16(0, more.added);
  TEST_ASSERT_EQUAL_UINT16(6400, c.points());
  TEST_ASSERT_EQUAL_INT(savesAtCap, s.saves);  // nothing changed, nothing written
}

void percent_rounds_down_and_nodes_follow_points() {
  Counter c; FakeStorage s; Clock k; c.begin(&s);
  for (int i = 0; i < 6; ++i) song(c, k, "A.wav", Result::Full);  // 600
  TEST_ASSERT_EQUAL_UINT8(9, c.percent());  // 9.375
  TEST_ASSERT_EQUAL_UINT16(6, c.nodes());
  song(c, k, "A.wav", Result::Partial);  // 610
  TEST_ASSERT_EQUAL_UINT16(6, c.nodes());
}

void repeat_inside_ten_seconds_is_ignored() {
  Counter c; FakeStorage s; c.begin(&s);
  TEST_ASSERT_EQUAL(Outcome::Credited, c.submit(Source::Level, "2", Result::Clear, 1000).outcome);
  const EventResult again = c.submit(Source::Level, "2", Result::Clear, 10999);
  TEST_ASSERT_EQUAL(Outcome::Repeat, again.outcome);
  TEST_ASSERT_EQUAL_UINT16(0, again.added);
  TEST_ASSERT_EQUAL_UINT16(100, again.total);
  TEST_ASSERT_EQUAL(Outcome::Credited, c.submit(Source::Level, "2", Result::Clear, 11000).outcome);
  TEST_ASSERT_EQUAL_UINT16(200, c.points());
}

void repeat_window_only_matches_the_same_event() {
  Counter c; FakeStorage s; c.begin(&s);
  c.submit(Source::Level, "2", Result::Clear, 1000);
  TEST_ASSERT_EQUAL(Outcome::Credited, c.submit(Source::Level, "3", Result::Clear, 1001).outcome);
  TEST_ASSERT_EQUAL(Outcome::Credited, c.submit(Source::Level, "2", Result::Attempt, 1002).outcome);
  TEST_ASSERT_EQUAL(Outcome::Credited, c.submit(Source::Song, "2", Result::Full, 1003).outcome);
}

void repeat_window_survives_clock_wraparound() {
  Counter c; FakeStorage s; c.begin(&s);
  c.submit(Source::Song, "A", Result::Full, 0xFFFFFFF0u);
  TEST_ASSERT_EQUAL(Outcome::Repeat, c.submit(Source::Song, "A", Result::Full, 100).outcome);
  TEST_ASSERT_EQUAL(Outcome::Credited, c.submit(Source::Song, "A", Result::Full, 20000).outcome);
}

void many_distinct_events_do_not_lose_a_recent_repeat() {
  Counter c; FakeStorage s; c.begin(&s);
  c.submit(Source::Song, "A", Result::Full, 0);
  for (int i = 0; i < 6; ++i) {  // fewer than the table holds
    char id[8]; snprintf(id, sizeof id, "S%d", i);
    c.submit(Source::Song, id, Result::Partial, 1);
  }
  TEST_ASSERT_EQUAL(Outcome::Repeat, c.submit(Source::Song, "A", Result::Full, 2).outcome);
}

void invalid_events_are_refused_and_earn_nothing() {
  Counter c; FakeStorage s; Clock k; c.begin(&s);
  TEST_ASSERT_EQUAL(Outcome::Invalid, song(c, k, "A", Result::Clear).outcome);
  TEST_ASSERT_EQUAL(Outcome::Invalid, song(c, k, "A", Result::Attempt).outcome);
  TEST_ASSERT_EQUAL(Outcome::Invalid, level(c, k, "1", Result::Full).outcome);
  TEST_ASSERT_EQUAL(Outcome::Invalid, level(c, k, "1", Result::Partial).outcome);
  TEST_ASSERT_EQUAL(Outcome::Invalid, level(c, k, "32", Result::Clear).outcome);
  TEST_ASSERT_EQUAL(Outcome::Invalid, level(c, k, "-1", Result::Clear).outcome);
  TEST_ASSERT_EQUAL(Outcome::Invalid, level(c, k, "01", Result::Clear).outcome);
  TEST_ASSERT_EQUAL(Outcome::Invalid, level(c, k, "x", Result::Clear).outcome);
  TEST_ASSERT_EQUAL(Outcome::Invalid, level(c, k, "", Result::Clear).outcome);
  TEST_ASSERT_EQUAL(Outcome::Invalid, c.submit(Source::Song, nullptr, Result::Full, 1).outcome);
  char tooLong[100]; memset(tooLong, 'a', sizeof tooLong); tooLong[99] = 0;
  TEST_ASSERT_EQUAL(Outcome::Invalid, song(c, k, tooLong, Result::Full).outcome);
  TEST_ASSERT_EQUAL_UINT16(0, c.points());
  TEST_ASSERT_EQUAL_INT(0, s.saves);
}

void each_credited_event_is_one_small_write_and_others_none() {
  Counter c; FakeStorage s; c.begin(&s);
  c.submit(Source::Song, "A", Result::Full, 0);
  TEST_ASSERT_EQUAL_INT(1, s.saves);
  c.submit(Source::Song, "A", Result::Full, 5);  // repeat
  c.submit(Source::Song, "A", Result::Clear, 6); // invalid
  TEST_ASSERT_EQUAL_INT(1, s.saves);
}

void the_total_and_levels_come_back_from_storage() {
  FakeStorage s;
  {
    Counter c; Clock k; c.begin(&s);
    song(c, k, "A", Result::Full);
    level(c, k, "7", Result::Clear);
  }
  Counter again; again.begin(&s);
  TEST_ASSERT_EQUAL_UINT16(200, again.points());
  TEST_ASSERT_EQUAL_HEX32(1u << 7, again.levelsCleared());
}

void a_bad_save_starts_at_zero_and_a_huge_one_is_clamped() {
  FakeStorage s; s.loadOk = false; s.points = 500;
  Counter c; c.begin(&s);
  TEST_ASSERT_EQUAL_UINT16(0, c.points());
  s.loadOk = true; s.points = 65000;
  c.begin(&s);
  TEST_ASSERT_EQUAL_UINT16(6400, c.points());
}

void a_failed_write_still_counts_in_memory() {
  FakeStorage s; s.saveOk = false;
  Counter c; Clock k; c.begin(&s);
  TEST_ASSERT_EQUAL_UINT16(100, song(c, k, "A", Result::Full).total);
}

void works_without_storage() {
  Counter c; c.begin(nullptr);
  TEST_ASSERT_EQUAL_UINT16(100, c.submit(Source::Song, "A", Result::Full, 0).total);
}

void leaving_rules() {
  Result r = Result::Clear;
  TEST_ASSERT_FALSE(resultForLeaving(0.30f, false, r));   // skip at 30%
  TEST_ASSERT_FALSE(resultForLeaving(0.30f, true, r));    // ended, but never played the half
  TEST_ASSERT_FALSE(resultForLeaving(0.0f, false, r));    // seek to 60% then stop: nothing played
  TEST_ASSERT_FALSE(resultForLeaving(0.499f, false, r));
  TEST_ASSERT_FALSE(resultForLeaving(NAN, true, r));
  TEST_ASSERT_TRUE(resultForLeaving(0.5f, false, r));
  TEST_ASSERT_EQUAL(Result::Partial, r);
  TEST_ASSERT_TRUE(resultForLeaving(0.99f, true, r));
  TEST_ASSERT_EQUAL(Result::Full, r);
  TEST_ASSERT_TRUE(resultForLeaving(1.0f, true, r));
}

void unflagged_or_unreadable_band_list_never_flags() {
  const char* good = "{\"version\":1,\"tracks\":[\"Currency.wav\",\"Jupiter Gold.wav\"]}";
  TEST_ASSERT_TRUE(bandListContains(good, strlen(good), "Currency.wav"));
  TEST_ASSERT_TRUE(bandListContains(good, strlen(good), "Jupiter Gold.wav"));
  TEST_ASSERT_FALSE(bandListContains(good, strlen(good), "Someone Elses.wav"));
  TEST_ASSERT_FALSE(bandListContains(good, strlen(good), "currency.wav"));  // exact match
  TEST_ASSERT_FALSE(bandListContains(good, strlen(good), "Currency"));
  TEST_ASSERT_FALSE(bandListContains(good, strlen(good), ""));
  const char* bad[] = {"", "{", "not json", "[\"Currency.wav\"]", "{\"tracks\":\"Currency.wav\"}",
                       "{\"tracks\":[1,2,null]}", "{\"tracks\":[\"Currency.wav\""};
  for (const char* b : bad) TEST_ASSERT_FALSE(bandListContains(b, strlen(b), "Currency.wav"));
  TEST_ASSERT_FALSE(bandListContains(nullptr, 0, "Currency.wav"));
}

void phone_songs_must_match_a_playlist_title() {
  const char* pl = "{\"version\":1,\"tracks\":[{\"title\":\"Mango Tree World\",\"url\":\"x\"},{\"title\":\"Light\",\"url\":\"y\"}]}";
  TEST_ASSERT_TRUE(playlistHasTitle(pl, strlen(pl), "Light"));
  TEST_ASSERT_TRUE(playlistHasTitle(pl, strlen(pl), "Mango Tree World"));
  TEST_ASSERT_FALSE(playlistHasTitle(pl, strlen(pl), "Some Other Song"));
  TEST_ASSERT_FALSE(playlistHasTitle(pl, strlen(pl), ""));
  TEST_ASSERT_FALSE(playlistHasTitle("garbage", 7, "Light"));
  TEST_ASSERT_FALSE(playlistHasTitle(nullptr, 0, "Light"));
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(ten_partials_land_on_100);
  RUN_TEST(one_full_is_100);
  RUN_TEST(twenty_attempts_land_on_100);
  RUN_TEST(a_clear_is_100_not_105_and_sets_its_bit);
  RUN_TEST(one_event_earns_exactly_one_value);
  RUN_TEST(cap_holds_at_6400);
  RUN_TEST(percent_rounds_down_and_nodes_follow_points);
  RUN_TEST(repeat_inside_ten_seconds_is_ignored);
  RUN_TEST(repeat_window_only_matches_the_same_event);
  RUN_TEST(repeat_window_survives_clock_wraparound);
  RUN_TEST(many_distinct_events_do_not_lose_a_recent_repeat);
  RUN_TEST(invalid_events_are_refused_and_earn_nothing);
  RUN_TEST(each_credited_event_is_one_small_write_and_others_none);
  RUN_TEST(the_total_and_levels_come_back_from_storage);
  RUN_TEST(a_bad_save_starts_at_zero_and_a_huge_one_is_clamped);
  RUN_TEST(a_failed_write_still_counts_in_memory);
  RUN_TEST(works_without_storage);
  RUN_TEST(leaving_rules);
  RUN_TEST(unflagged_or_unreadable_band_list_never_flags);
  RUN_TEST(phone_songs_must_match_a_playlist_title);
  return UNITY_END();
}
