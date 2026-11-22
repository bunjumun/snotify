//
// Host-side tests for the play order. Run with: pio test -e native
//
#include <string.h>
#include <strings.h>
#include <unity.h>

#include "track_order.h"

void orders_by_letter_ignoring_case() {
  TEST_ASSERT_TRUE(trackorder::before("apple.wav", "Banana.wav"));
  TEST_ASSERT_FALSE(trackorder::before("Banana.wav", "apple.wav"));
}

void same_name_is_not_before_itself() {
  TEST_ASSERT_FALSE(trackorder::before("a.wav", "a.wav"));
}

void names_differing_only_in_case_have_one_fixed_order() {
  TEST_ASSERT_TRUE(trackorder::before("A.wav", "a.wav") != trackorder::before("a.wav", "A.wav"));
}

void shorter_prefix_comes_first() {
  TEST_ASSERT_TRUE(trackorder::before("Mix.wav", "Mix 2.wav") == (strcasecmp("Mix.wav", "Mix 2.wav") < 0));
  TEST_ASSERT_TRUE(trackorder::before("Mix", "Mix 2"));
}

void setUp() {}
void tearDown() {}

int main() {
  UNITY_BEGIN();
  RUN_TEST(orders_by_letter_ignoring_case);
  RUN_TEST(same_name_is_not_before_itself);
  RUN_TEST(names_differing_only_in_case_have_one_fixed_order);
  RUN_TEST(shorter_prefix_comes_first);
  return UNITY_END();
}
