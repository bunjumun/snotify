//
// Host-side tests for stored-track filename rules.
// Run with: pio test -e native
//
#include <string.h>
#include <unity.h>

#include "track_name.h"

namespace {
constexpr size_t kMax = 100;

trackname::Result run(const char* in, char* out) {
  return trackname::sanitise(in, out, kMax);
}
}  // namespace

void accepts_a_plain_wav_name() {
  char out[kMax + 1];
  TEST_ASSERT_EQUAL(trackname::Result::Ok, run("Currency Mix 8-24-26.wav", out));
  TEST_ASSERT_EQUAL_STRING("Currency Mix 8-24-26.wav", out);
}

void accepts_an_upper_case_extension() {
  char out[kMax + 1];
  TEST_ASSERT_EQUAL(trackname::Result::Ok, run("song.MP3", out));
}

void replaces_unsafe_characters() {
  char out[kMax + 1];
  TEST_ASSERT_EQUAL(trackname::Result::Ok, run("Mango's Mix #2.wav", out));
  TEST_ASSERT_EQUAL_STRING("Mango_s Mix _2.wav", out);
}

void strips_a_unix_path() {
  char out[kMax + 1];
  TEST_ASSERT_EQUAL(trackname::Result::Ok, run("../../etc/song.wav", out));
  TEST_ASSERT_EQUAL_STRING("song.wav", out);
}

void strips_a_windows_path() {
  char out[kMax + 1];
  TEST_ASSERT_EQUAL(trackname::Result::Ok, run("C:\\Users\\me\\song.wav", out));
  TEST_ASSERT_EQUAL_STRING("song.wav", out);
}

void rejects_a_name_that_is_only_a_path() {
  char out[kMax + 1];
  TEST_ASSERT_EQUAL(trackname::Result::Empty, run("folder/", out));
}

void rejects_a_dot_dot() {
  char out[kMax + 1];
  TEST_ASSERT_NOT_EQUAL(trackname::Result::Ok, run("..", out));
}

void rejects_a_hidden_file() {
  char out[kMax + 1];
  TEST_ASSERT_EQUAL(trackname::Result::Hidden, run(".DS_Store", out));
}

void rejects_an_empty_name() {
  char out[kMax + 1];
  TEST_ASSERT_EQUAL(trackname::Result::Empty, run("", out));
  TEST_ASSERT_EQUAL(trackname::Result::Empty, run(nullptr, out));
}

void rejects_a_non_audio_extension() {
  char out[kMax + 1];
  TEST_ASSERT_EQUAL(trackname::Result::BadExtension, run("notes.txt", out));
  TEST_ASSERT_EQUAL(trackname::Result::BadExtension, run("noextension", out));
  TEST_ASSERT_EQUAL(trackname::Result::BadExtension, run("trailingdot.", out));
}

void rejects_an_extension_that_only_starts_like_one() {
  char out[kMax + 1];
  TEST_ASSERT_EQUAL(trackname::Result::BadExtension, run("song.wavx", out));
  TEST_ASSERT_EQUAL(trackname::Result::BadExtension, run("song.wa", out));
}

void rejects_an_over_long_name() {
  char longName[200];
  memset(longName, 'a', sizeof(longName));
  memcpy(longName + 150, ".wav", 5);
  char out[kMax + 1];
  TEST_ASSERT_EQUAL(trackname::Result::TooLong, run(longName, out));
}

void maps_extensions_to_content_types() {
  TEST_ASSERT_EQUAL_STRING("audio/wav", trackname::contentType("a.wav"));
  TEST_ASSERT_EQUAL_STRING("audio/mpeg", trackname::contentType("a.MP3"));
  TEST_ASSERT_EQUAL_STRING("application/octet-stream", trackname::contentType("a.bin"));
}

void setUp() {}
void tearDown() {}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(accepts_a_plain_wav_name);
  RUN_TEST(accepts_an_upper_case_extension);
  RUN_TEST(replaces_unsafe_characters);
  RUN_TEST(strips_a_unix_path);
  RUN_TEST(strips_a_windows_path);
  RUN_TEST(rejects_a_name_that_is_only_a_path);
  RUN_TEST(rejects_a_dot_dot);
  RUN_TEST(rejects_a_hidden_file);
  RUN_TEST(rejects_an_empty_name);
  RUN_TEST(rejects_a_non_audio_extension);
  RUN_TEST(rejects_an_extension_that_only_starts_like_one);
  RUN_TEST(rejects_an_over_long_name);
  RUN_TEST(maps_extensions_to_content_types);
  return UNITY_END();
}
