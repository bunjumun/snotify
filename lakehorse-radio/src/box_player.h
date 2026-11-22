#pragma once
//
// Playing songs on the box itself: WAV files from the SD card, out over
// Bluetooth A2DP to one speaker (cfg::BT_SPEAKER_NAME).
//
// This is the v2 half of the design in main.cpp's header. The page becomes a
// remote: it calls play/pause/seek here through /api/player/* and polls
// status(). The phone makes no sound in this mode.
//
// Three parties, three threads, and the shape follows from keeping them apart:
//   - the web server (AsyncTCP task) issues commands; they take a mutex and
//     return quickly, so a request never waits on Bluetooth;
//   - a reader task pulls PCM off the card, converts it to 44.1 kHz stereo and
//     fills a ring buffer in PSRAM;
//   - the Bluetooth stack's own task pulls frames out of the ring through the
//     A2DP data callback. It must never block or touch the card, so it only
//     ever takes a spinlock for the copy and plays silence if the ring is dry.
//
// Only built with -D LAKEHORSE_BT=1 (env:radio-core2). Without it every call
// reports that Bluetooth is not in this build, so env:radio on core 3, where
// A2DP drops the speaker after 300 ms (HANDOFF.md, Module 5), still builds.
//
#include <Arduino.h>

namespace boxplayer {

enum class State { Stopped, Playing, Paused };

struct Status {
  bool built;      // false when compiled without Bluetooth
  bool connected;  // A2DP link to the speaker is up
  State state;
  String track;    // name on the card, empty when stopped
  float position;  // seconds actually sent to the speaker
  float duration;
  float volume;    // 0..1
  uint32_t ended;  // increments each time a song plays to its end
  uint32_t underruns;
  String error;    // last play() failure, cleared by the next good play
  const char* speaker;
};

// Starts the Bluetooth stack and the reader task. Call after the SD card is
// mounted and after Wi-Fi, so the radio coexistence settles on a running link.
void begin();

// `safeName` must already have passed trackname::sanitise unchanged. Returns
// an empty string on success, otherwise a reason fit to show the listener.
String play(const char* safeName, float startSeconds);
void pause();
void resume();
void stop();
void seek(float seconds);
void setVolume(float v);

Status status();
const char* stateName(State s);

}  // namespace boxplayer
