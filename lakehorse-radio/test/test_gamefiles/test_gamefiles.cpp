//
// Host-side tests for the /game/ path rules.
// Run with: pio test -e native
//
#include <string.h>
#include <unity.h>

#include "game_files.h"

namespace {
constexpr size_t kMax = 100;
char out[kMax + 1];
gamefiles::Result run(const char* in) { return gamefiles::resolve(in, out, kMax); }
}  // namespace

void empty_path_serves_index() {
  TEST_ASSERT_EQUAL(gamefiles::Result::Ok, run(""));
  TEST_ASSERT_EQUAL_STRING("index.html", out);
}

void trailing_slash_serves_index_in_that_folder() {
  TEST_ASSERT_EQUAL(gamefiles::Result::Ok, run("sub/"));
  TEST_ASSERT_EQUAL_STRING("sub/index.html", out);
}

void accepts_nested_asset() {
  TEST_ASSERT_EQUAL(gamefiles::Result::Ok, run("src/audio/Director.js"));
  TEST_ASSERT_EQUAL_STRING("src/audio/Director.js", out);
}

void accepts_gzipped_sibling() {
  TEST_ASSERT_EQUAL(gamefiles::Result::Ok, run("game.js.gz"));
  TEST_ASSERT_EQUAL_STRING("text/javascript; charset=utf-8", gamefiles::contentType("game.js.gz"));
}

void rejects_parent_traversal() {
  TEST_ASSERT_EQUAL(gamefiles::Result::BadPath, run("../Music/a.wav"));
  TEST_ASSERT_EQUAL(gamefiles::Result::BadPath, run("a/../../b.js"));
}

void rejects_hidden_and_backslash_and_empty_segment() {
  TEST_ASSERT_EQUAL(gamefiles::Result::BadPath, run(".Spotlight-V100/x.js"));
  TEST_ASSERT_EQUAL(gamefiles::Result::BadPath, run("a\\b.js"));
  TEST_ASSERT_EQUAL(gamefiles::Result::BadPath, run("a%2e%2e/b.js"));
}

void rejects_unservable_extension() {
  TEST_ASSERT_EQUAL(gamefiles::Result::BadExtension, run("notes.txt"));
  TEST_ASSERT_EQUAL(gamefiles::Result::BadExtension, run("game"));
}

void rejects_too_long() {
  char longName[kMax + 20];
  memset(longName, 'a', sizeof(longName));
  memcpy(longName + sizeof(longName) - 4, ".js", 4);
  TEST_ASSERT_EQUAL(gamefiles::Result::TooLong, run(longName));
}

void setUp() {}
void tearDown() {}

int main() {
  UNITY_BEGIN();
  RUN_TEST(empty_path_serves_index);
  RUN_TEST(trailing_slash_serves_index_in_that_folder);
  RUN_TEST(accepts_nested_asset);
  RUN_TEST(accepts_gzipped_sibling);
  RUN_TEST(rejects_parent_traversal);
  RUN_TEST(rejects_hidden_and_backslash_and_empty_segment);
  RUN_TEST(rejects_unservable_extension);
  RUN_TEST(rejects_too_long);
  return UNITY_END();
}
