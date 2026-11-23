#pragma once
//
// Eight band levels from the music the box is playing, for the matrix bars
// (matrix_engine.h feedBands). Arduino-free, so it runs on a laptop
// (test/test_bands).
//
// Why it is shaped like this:
//
//   * The reader task fills a two-second ring ahead of the speaker, so levels
//     worked out as it reads would run up to two seconds early. Instead each
//     1024-frame hop's levels go on a timeline keyed by the output-frame number
//     they cover, and levelsAt() looks up the hop that is being played now.
//     The caller supplies the played-frame count (box_player.cpp g_played).
//
//   * Goertzel, one bin per band, run sample by sample as frames arrive. That
//     needs no sample buffer and no FFT table: the working state is a few
//     dozen bytes, which matters on a chip whose internal heap bottoms out near
//     35 KB with Bluetooth playing. A Welch window (4x(1-x)) is applied on the
//     fly to keep a loud bass note from smearing into the next band.
//
//   * Bands are an octave apart, 60 Hz to 8 kHz, and each is lifted 3 dB per
//     step to offset music's roughly 3 dB per octave fall, so a full mix does
//     not read as all bass. The scale is -72 dBFS to -18 dBFS across 0 to 8.
//     These constants were set from reasoning and checked by eye on the real
//     page; change them in band_levels.cpp, nowhere else.
//
//   * The timeline is written by one task (the reader) and read by another
//     (the web server), with no lock: a hop is published by bumping an atomic
//     count after its eight bytes are in place, and a torn read after a reset
//     only ever draws one odd frame of bars.
//
#include <atomic>
#include <stddef.h>
#include <stdint.h>

#include "pcm_format.h"

namespace bands {

constexpr int kBands = 8;
constexpr uint32_t kHop = 1024;     // output frames per analysis hop (about 23 ms)
constexpr uint32_t kHistory = 128;  // hops kept: about 3 s, more than the 2 s ring
constexpr uint32_t kPeakHops = 4;   // a level is the loudest of this many hops up to now

class Meter {
 public:
  // Forget everything: new track, seek or stop. Frame numbers restart at 0.
  void reset();

  // Output-rate (44.1 kHz) stereo frames, in order. Any chunk size.
  void feed(const pcm::StereoFrame* frames, size_t n);

  // Levels 0..8 for the audio at output frame `playedFrame`. False when that
  // frame has not been analysed yet (the reader is behind or just started) or
  // is older than the timeline.
  bool levelsAt(uint32_t playedFrame, uint8_t out[kBands]) const;

  uint32_t hopsDone() const { return done_.load(std::memory_order_acquire); }

 private:
  void finishHop();

  float s1_[kBands];
  float s2_[kBands];
  uint32_t inHop_ = 0;  // frames into the current hop
  std::atomic<uint32_t> done_{0};
  uint8_t levels_[kHistory][kBands];
};

// The pieces, exposed for tests.
uint8_t levelFromAmplitude(float amplitude, int band);  // amplitude 1.0 = full-scale sine
float bandFrequency(int band);

}  // namespace bands
