//
// Host-side tests for playlist validation.
//
// These exist because every one of these rules is a boundary against untrusted
// input, and "the board did not crash" is not evidence that a boundary holds.
// Run with: pio test -e native
//
#include <ArduinoJson.h>
#include <unity.h>

#include "hostname_rules.h"
#include "playlist_validate.h"

namespace {

playlist::Result check(const char* json) {
  JsonDocument doc;
  const DeserializationError err = deserializeJson(doc, json);
  TEST_ASSERT_FALSE_MESSAGE(err, "test fixture itself is not valid JSON");
  return playlist::validate(doc);
}

}  // namespace

void accepts_a_well_formed_playlist() {
  const char* json =
      R"({"tracks":[{"title":"Mango Tree World","url":"https://example.com/a.mp3"}]})";
  TEST_ASSERT_EQUAL(playlist::Result::Ok, check(json));
}

void accepts_an_empty_track_list() {
  // Clearing the playlist is a legitimate action, not a malformed payload.
  TEST_ASSERT_EQUAL(playlist::Result::Ok, check(R"({"tracks":[]})"));
}

void rejects_a_bare_array() {
  TEST_ASSERT_EQUAL(playlist::Result::NotAnObject, check(R"([])"));
}

void rejects_a_missing_tracks_key() {
  TEST_ASSERT_EQUAL(playlist::Result::MissingTracks, check(R"({"songs":[]})"));
}

void rejects_a_track_that_is_not_an_object() {
  TEST_ASSERT_EQUAL(playlist::Result::TrackNotAnObject, check(R"({"tracks":["nope"]})"));
}

void rejects_an_empty_title() {
  const char* json = R"({"tracks":[{"title":"","url":"https://example.com/a.mp3"}]})";
  TEST_ASSERT_EQUAL(playlist::Result::TitleMissingOrEmpty, check(json));
}

void rejects_a_missing_url() {
  TEST_ASSERT_EQUAL(playlist::Result::UrlMissingOrEmpty,
                    check(R"({"tracks":[{"title":"Light"}]})"));
}

void rejects_plain_http() {
  // The rule that matters most: an http:// URL plays fine from the box today
  // and breaks silently the moment the same player is opened from the HTTPS
  // band site.
  const char* json = R"({"tracks":[{"title":"Light","url":"http://example.com/a.mp3"}]})";
  TEST_ASSERT_EQUAL(playlist::Result::UrlNotHttps, check(json));
}

void rejects_a_protocol_relative_url() {
  const char* json = R"({"tracks":[{"title":"Light","url":"//example.com/a.mp3"}]})";
  TEST_ASSERT_EQUAL(playlist::Result::UrlNotHttps, check(json));
}

void rejects_a_url_that_merely_contains_https() {
  // "starts with" not "contains" — http://evil/?x=https:// must not pass.
  const char* json = R"({"tracks":[{"title":"x","url":"http://evil/?u=https://a"}]})";
  TEST_ASSERT_EQUAL(playlist::Result::UrlNotHttps, check(json));
}


// ---------- Hostname rules ----------
// An illegal mDNS name does not error, it just never gets advertised, so the
// box appears to vanish from the network. These are the rules that stop a
// typed name from doing that.

namespace {
hostrules::Result host(const char* in, char* out = nullptr) {
  char scratch[33];
  return hostrules::normalise(in, out ? out : scratch, 32);
}
}  // namespace

void accepts_the_default_name() {
  TEST_ASSERT_EQUAL(hostrules::Result::Ok, host("lakehorseradio"));
}

void lower_cases_the_name() {
  char out[33];
  TEST_ASSERT_EQUAL(hostrules::Result::Ok, host("LakeHorseRadio", out));
  TEST_ASSERT_EQUAL_STRING("lakehorseradio", out);
}

void accepts_internal_hyphens_and_digits() {
  TEST_ASSERT_EQUAL(hostrules::Result::Ok, host("barn-radio-2"));
}

void rejects_an_empty_name() {
  TEST_ASSERT_EQUAL(hostrules::Result::Empty, host(""));
}

void rejects_a_dot() {
  // Someone typing the whole address means the whole address. Silently keeping
  // just the first label would leave them looking for the wrong name.
  TEST_ASSERT_EQUAL(hostrules::Result::IllegalCharacter, host("radio.local"));
}

void rejects_a_space() {
  TEST_ASSERT_EQUAL(hostrules::Result::IllegalCharacter, host("lakehorse radio"));
}

void rejects_a_leading_hyphen() {
  TEST_ASSERT_EQUAL(hostrules::Result::EdgeHyphen, host("-radio"));
}

void rejects_a_trailing_hyphen() {
  TEST_ASSERT_EQUAL(hostrules::Result::EdgeHyphen, host("radio-"));
}

void rejects_an_over_long_name() {
  TEST_ASSERT_EQUAL(hostrules::Result::TooLong,
                    host("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(accepts_a_well_formed_playlist);
  RUN_TEST(accepts_an_empty_track_list);
  RUN_TEST(rejects_a_bare_array);
  RUN_TEST(rejects_a_missing_tracks_key);
  RUN_TEST(rejects_a_track_that_is_not_an_object);
  RUN_TEST(rejects_an_empty_title);
  RUN_TEST(rejects_a_missing_url);
  RUN_TEST(rejects_plain_http);
  RUN_TEST(rejects_a_protocol_relative_url);
  RUN_TEST(rejects_a_url_that_merely_contains_https);
  RUN_TEST(accepts_the_default_name);
  RUN_TEST(lower_cases_the_name);
  RUN_TEST(accepts_internal_hyphens_and_digits);
  RUN_TEST(rejects_an_empty_name);
  RUN_TEST(rejects_a_dot);
  RUN_TEST(rejects_a_space);
  RUN_TEST(rejects_a_leading_hyphen);
  RUN_TEST(rejects_a_trailing_hyphen);
  RUN_TEST(rejects_an_over_long_name);
  return UNITY_END();
}
