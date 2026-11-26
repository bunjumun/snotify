#pragma once
//
// The Bluetooth link: which speaker the box plays to, and whether Bluetooth
// is on at all. box_player.h makes the sound; this file decides where it goes.
//
// Split out of box_player.cpp (2026-11-22) when the page grew controls for it.
// Until then the speaker was a compile-time name and the link a fixed fact of
// the build; now the listener can find speakers, pick one, disconnect, and
// switch Bluetooth off.
//
// Bluetooth off is a saved setting that takes effect on a restart, not a live
// switch, for two reasons found the hard way (HANDOFF.md, Module 6):
//   - with Bluetooth on, IDF 4.4 forces Wi-Fi modem sleep, which slows page
//     downloads to 22-40 KB/s, too slow for a phone to play a WAV from the
//     card. Off at boot, the controller's memory is handed back
//     (btInUse() returns false) and Wi-Fi runs at full speed;
//   - starting Bluetooth only works at boot, before anything else allocates
//     (config.h, BT_START_PSRAM_THRESHOLD). Starting it later would put the
//     web server's small structures in PSRAM, which corrupts on this chip.
//
// Finding speakers uses ESP32-A2DP's own discovery loop. A search runs for a
// bounded window rather than forever, because Bluetooth inquiry shares the
// radio with Wi-Fi and slows every page load while it runs.
//
#include <Arduino.h>

#include <vector>

struct Frame;  // ESP32-A2DP's stereo frame (A2DPVolumeControl.h)

namespace btspeaker {

using FillFn = int32_t (*)(Frame* frames, int32_t count);

// The speaker's own buttons. `key` is the AVRCP passthrough code and
// `released` false for the press. Runs on the Bluetooth stack's task, so it
// must only record the key, never do the work (see box_player.cpp).
using KeyFn = void (*)(uint8_t key, bool released);

struct Found {
  String name;
  int rssi;
};

struct Info {
  bool built;      // false when compiled without Bluetooth
  bool on;         // the saved setting (and what this boot is running)
  bool connected;
  bool scanning;   // a "find speakers" window is open
  bool searching;  // looking for the chosen speaker to connect to it
  String speaker;  // the chosen speaker's name
  std::vector<Found> found;
};

// Starts Bluetooth if the saved setting says on. First thing in setup():
// see the file header for why it must come before everything else.
void begin(FillFn fill, KeyFn onKey);

// From loop(): ends search windows, finishes a speaker change, and carries
// out a restart that setEnabled() scheduled.
void tick();

// The saved on/off setting, which is also what this boot is running. Valid
// before begin().
bool enabled();

// True when Bluetooth is running, so Wi-Fi must keep modem sleep on.
bool needsModemSleep();

// Cheap, for status polls: no list copy.
bool connected();

Info info();

// Lists nearby speakers for cfg::BT_SCAN_MS. Results arrive in info().found.
void scan();

// Makes `name` the speaker, saved across restarts, and connects to it.
// Only a name seen by scan() (or the current one) is accepted. Returns an
// empty string on success, otherwise a reason fit to show the listener.
String choose(const String& name);

void connect();
void disconnect();

// Saves the setting and restarts the box shortly after, so the reply to the
// request that asked still reaches the page.
String setEnabled(bool on);

// True when this boot skipped Bluetooth so the box's own hotspot can serve
// the setup page (setup_boot.h). Only ever true for one boot at a time.
bool isSetupBoot();

// Restarts now. forSetup: the next boot skips Bluetooth, once. Otherwise the
// next boot runs the saved setting as usual.
void restart(bool forSetup);

}  // namespace btspeaker
