//
// Host-side tests for the setup boot decision (src/setup_boot.h).
// Run with: pio test -e native
//
#include <unity.h>

#include "setup_boot.h"

using setupboot::Action;
using setupboot::State;
using setupboot::decide;

namespace {
constexpr uint32_t kEmptyLimit = 180000;
constexpr uint32_t kJoinedHold = 20000;

// A normal boot with Bluetooth running, hotspot up, nobody on it, no network.
State base() {
  State s;
  s.btRunning = true;
  s.setupBoot = false;
  s.apUp = true;
  s.apClients = 0;
  s.stationConnected = false;
  s.msSinceApEmpty = 0;
  s.msSinceConnected = 0;
  return s;
}
}  // namespace

void a_phone_on_the_hotspot_with_bluetooth_running_restarts_into_setup() {
  State s = base();
  s.apClients = 1;
  TEST_ASSERT_EQUAL((int)Action::RestartForSetup, (int)decide(s, kEmptyLimit, kJoinedHold));
}

void nothing_happens_with_nobody_on_the_hotspot() {
  TEST_ASSERT_EQUAL((int)Action::None, (int)decide(base(), kEmptyLimit, kJoinedHold));
}

void nothing_happens_when_bluetooth_is_off_by_choice() {
  State s = base();
  s.btRunning = false;
  s.apClients = 1;
  TEST_ASSERT_EQUAL((int)Action::None, (int)decide(s, kEmptyLimit, kJoinedHold));
}

void nothing_happens_once_the_box_is_on_a_network() {
  State s = base();
  s.apClients = 1;
  s.stationConnected = true;
  TEST_ASSERT_EQUAL((int)Action::None, (int)decide(s, kEmptyLimit, kJoinedHold));
}

void a_setup_boot_never_restarts_into_setup_again() {
  State s = base();
  s.btRunning = false;
  s.setupBoot = true;
  s.apClients = 1;
  TEST_ASSERT_EQUAL((int)Action::None, (int)decide(s, kEmptyLimit, kJoinedHold));
}

void a_setup_boot_brings_bluetooth_back_after_joining_and_the_hold() {
  State s = base();
  s.btRunning = false;
  s.setupBoot = true;
  s.stationConnected = true;
  s.msSinceConnected = kJoinedHold - 1;
  TEST_ASSERT_EQUAL((int)Action::None, (int)decide(s, kEmptyLimit, kJoinedHold));
  s.msSinceConnected = kJoinedHold;
  TEST_ASSERT_EQUAL((int)Action::RestartWithBluetooth, (int)decide(s, kEmptyLimit, kJoinedHold));
}

void a_setup_boot_gives_up_when_the_hotspot_stays_empty() {
  State s = base();
  s.btRunning = false;
  s.setupBoot = true;
  s.msSinceApEmpty = kEmptyLimit - 1;
  TEST_ASSERT_EQUAL((int)Action::None, (int)decide(s, kEmptyLimit, kJoinedHold));
  s.msSinceApEmpty = kEmptyLimit;
  TEST_ASSERT_EQUAL((int)Action::RestartWithBluetooth, (int)decide(s, kEmptyLimit, kJoinedHold));
}

void a_setup_boot_waits_while_a_phone_is_still_on() {
  State s = base();
  s.btRunning = false;
  s.setupBoot = true;
  s.apClients = 1;
  s.msSinceApEmpty = kEmptyLimit * 2;
  TEST_ASSERT_EQUAL((int)Action::None, (int)decide(s, kEmptyLimit, kJoinedHold));
}

void setUp() {}
void tearDown() {}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(a_phone_on_the_hotspot_with_bluetooth_running_restarts_into_setup);
  RUN_TEST(nothing_happens_with_nobody_on_the_hotspot);
  RUN_TEST(nothing_happens_when_bluetooth_is_off_by_choice);
  RUN_TEST(nothing_happens_once_the_box_is_on_a_network);
  RUN_TEST(a_setup_boot_never_restarts_into_setup_again);
  RUN_TEST(a_setup_boot_brings_bluetooth_back_after_joining_and_the_hold);
  RUN_TEST(a_setup_boot_gives_up_when_the_hotspot_stays_empty);
  RUN_TEST(a_setup_boot_waits_while_a_phone_is_still_on);
  return UNITY_END();
}
