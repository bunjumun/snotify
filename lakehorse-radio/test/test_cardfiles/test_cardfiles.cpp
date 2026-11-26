//
// Host-side tests for the card-file name and content checks (src/card_files.h).
// Run with: pio test -e native
//
#include <string.h>
#include <unity.h>

#include <string>

#include "alignment.h"
#include "card_files.h"
#include "config.h"

using cardfiles::Result;

namespace {
Result band(const char* body) { return cardfiles::validate("band-tracks.json", body, strlen(body)); }
}  // namespace

void only_the_exact_allowlisted_name_is_accepted() {
  TEST_ASSERT_TRUE(cardfiles::nameAllowed("band-tracks.json"));
  TEST_ASSERT_FALSE(cardfiles::nameAllowed("Band-Tracks.json"));
  TEST_ASSERT_FALSE(cardfiles::nameAllowed("band-tracks.json "));
  TEST_ASSERT_FALSE(cardfiles::nameAllowed(" band-tracks.json"));
  TEST_ASSERT_FALSE(cardfiles::nameAllowed("/band-tracks.json"));
  TEST_ASSERT_FALSE(cardfiles::nameAllowed("music/band-tracks.json"));
  TEST_ASSERT_FALSE(cardfiles::nameAllowed("../band-tracks.json"));
  TEST_ASSERT_FALSE(cardfiles::nameAllowed("band-tracks.json.part"));
  TEST_ASSERT_FALSE(cardfiles::nameAllowed("playlist.json"));
  TEST_ASSERT_FALSE(cardfiles::nameAllowed(""));
  TEST_ASSERT_FALSE(cardfiles::nameAllowed(nullptr));
}

void a_good_band_list_passes() {
  TEST_ASSERT_EQUAL(Result::Ok, band("{\"version\":1,\"tracks\":[\"A.wav\",\"B C.wav\"]}"));
}

void version_may_be_left_out_and_the_list_may_be_empty() {
  TEST_ASSERT_EQUAL(Result::Ok, band("{\"tracks\":[\"A.wav\"]}"));
  TEST_ASSERT_EQUAL(Result::Ok, band("{\"version\":1,\"tracks\":[]}"));
}

void an_unknown_version_is_refused() {
  TEST_ASSERT_EQUAL(Result::WrongShape, band("{\"version\":2,\"tracks\":[\"A.wav\"]}"));
  TEST_ASSERT_EQUAL(Result::WrongShape, band("{\"version\":\"1\",\"tracks\":[\"A.wav\"]}"));
}

void malformed_json_is_refused() {
  TEST_ASSERT_EQUAL(Result::NotJson, band("{\"tracks\":[\"A.wav\""));
  TEST_ASSERT_EQUAL(Result::NotJson, band("not json at all"));
}

void the_wrong_shape_is_refused() {
  TEST_ASSERT_EQUAL(Result::WrongShape, band("[]"));
  TEST_ASSERT_EQUAL(Result::WrongShape, band("\"tracks\""));
  TEST_ASSERT_EQUAL(Result::WrongShape, band("{\"version\":1}"));
  TEST_ASSERT_EQUAL(Result::WrongShape, band("{\"tracks\":\"A.wav\"}"));
  TEST_ASSERT_EQUAL(Result::WrongShape, band("{\"tracks\":[\"A.wav\",3]}"));
  TEST_ASSERT_EQUAL(Result::WrongShape, band("{\"tracks\":[\"A.wav\",\"\"]}"));
  TEST_ASSERT_EQUAL(Result::WrongShape, band("{\"tracks\":[\"A.wav\",null]}"));
  TEST_ASSERT_EQUAL(Result::WrongShape, band("{\"tracks\":{\"0\":\"A.wav\"}}"));
}

void empty_and_oversize_bodies_are_refused() {
  TEST_ASSERT_EQUAL(Result::Empty, cardfiles::validate("band-tracks.json", "", 0));
  TEST_ASSERT_EQUAL(Result::Empty, cardfiles::validate("band-tracks.json", nullptr, 5));
  std::string big = "{\"tracks\":[\"";
  big.append(cfg::CARD_FILE_MAX_BYTES, 'a');
  big += ".wav\"]}";
  TEST_ASSERT_EQUAL(Result::TooBig, cardfiles::validate("band-tracks.json", big.data(), big.size()));
}

void a_body_at_exactly_the_cap_is_still_checked_not_refused_for_size() {
  std::string body = "{\"tracks\":[\"";
  body.append(cfg::CARD_FILE_MAX_BYTES - body.size() - 7, 'a');
  body += ".wav\"]}";
  TEST_ASSERT_EQUAL(cfg::CARD_FILE_MAX_BYTES, body.size());
  TEST_ASSERT_EQUAL(Result::Ok, cardfiles::validate("band-tracks.json", body.data(), body.size()));
}

void a_name_off_the_list_is_refused_before_the_body_is_looked_at() {
  TEST_ASSERT_EQUAL(Result::NameNotAllowed,
                    cardfiles::validate("playlist.json", "{\"tracks\":[]}", 13));
}

void a_list_that_passes_is_one_the_alignment_reader_reads() {
  // The point of validating: whatever is accepted here is what piece 1 reads.
  const char* body = "{\"version\":1,\"tracks\":[\"Mango Tree World.wav\"]}";
  TEST_ASSERT_EQUAL(Result::Ok, band(body));
  TEST_ASSERT_TRUE(alignment::bandListContains(body, strlen(body), "Mango Tree World.wav"));
  TEST_ASSERT_FALSE(alignment::bandListContains(body, strlen(body), "Other.wav"));
}

void every_result_has_words() {
  for (Result r : {Result::Ok, Result::NameNotAllowed, Result::Empty, Result::TooBig,
                   Result::NotJson, Result::WrongShape}) {
    TEST_ASSERT_TRUE(strlen(cardfiles::describe(r)) > 0);
  }
}

void setUp() {}
void tearDown() {}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(only_the_exact_allowlisted_name_is_accepted);
  RUN_TEST(a_good_band_list_passes);
  RUN_TEST(version_may_be_left_out_and_the_list_may_be_empty);
  RUN_TEST(an_unknown_version_is_refused);
  RUN_TEST(malformed_json_is_refused);
  RUN_TEST(the_wrong_shape_is_refused);
  RUN_TEST(empty_and_oversize_bodies_are_refused);
  RUN_TEST(a_body_at_exactly_the_cap_is_still_checked_not_refused_for_size);
  RUN_TEST(a_name_off_the_list_is_refused_before_the_body_is_looked_at);
  RUN_TEST(a_list_that_passes_is_one_the_alignment_reader_reads);
  RUN_TEST(every_result_has_words);
  return UNITY_END();
}
