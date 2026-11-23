#include "band_levels.h"

#include <math.h>
#include <string.h>

namespace bands {
namespace {

constexpr float kPi = 3.14159265358979f;
constexpr float kFloorDb = -72.0f;   // maps to level 0
constexpr float kRangeDb = 54.0f;    // floor to floor+range maps to 0..8
constexpr float kTiltDbPerBand = 3.0f;
constexpr float kFreq[kBands] = {60, 120, 250, 500, 1000, 2000, 4000, 8000};

// Welch window mean is 2/3, so a full-scale sine's bin magnitude is
// (2/3)*N/2 in sample units; dividing by that gives amplitude 1.0.
constexpr float kWindowGain = (2.0f / 3.0f) * (float)kHop / 2.0f;

float coeff(int band) {
  return 2.0f * cosf(2.0f * kPi * kFreq[band] / (float)pcm::kOutputRate);
}

}  // namespace

float bandFrequency(int band) { return kFreq[band]; }

uint8_t levelFromAmplitude(float amplitude, int band) {
  if (!(amplitude > 1e-6f)) return 0;
  const float db = 20.0f * log10f(amplitude) + kTiltDbPerBand * (float)band;
  const float level = (db - kFloorDb) / kRangeDb * 8.0f;
  if (level <= 0.0f) return 0;
  if (level >= 8.0f) return 8;
  return (uint8_t)(level + 0.5f);
}

void Meter::reset() {
  memset(s1_, 0, sizeof(s1_));
  memset(s2_, 0, sizeof(s2_));
  inHop_ = 0;
  done_.store(0, std::memory_order_release);
  memset(levels_, 0, sizeof(levels_));
}

void Meter::feed(const pcm::StereoFrame* frames, size_t n) {
  static float c[kBands];
  static bool ready = false;
  if (!ready) {
    for (int b = 0; b < kBands; ++b) c[b] = coeff(b);
    ready = true;
  }
  for (size_t i = 0; i < n; ++i) {
    // Mono, scaled to +-1, then the Welch weight for this position in the hop.
    const float x = ((float)frames[i].left + (float)frames[i].right) * (0.5f / 32768.0f);
    const float pos = ((float)inHop_ + 0.5f) / (float)kHop;
    const float v = x * (4.0f * pos * (1.0f - pos));
    for (int b = 0; b < kBands; ++b) {
      const float s0 = v + c[b] * s1_[b] - s2_[b];
      s2_[b] = s1_[b];
      s1_[b] = s0;
    }
    if (++inHop_ == kHop) finishHop();
  }
}

void Meter::finishHop() {
  static float c[kBands];
  for (int b = 0; b < kBands; ++b) c[b] = coeff(b);
  const uint32_t slot = done_.load(std::memory_order_relaxed) % kHistory;
  for (int b = 0; b < kBands; ++b) {
    const float power = s1_[b] * s1_[b] + s2_[b] * s2_[b] - c[b] * s1_[b] * s2_[b];
    const float amplitude = sqrtf(power > 0.0f ? power : 0.0f) / kWindowGain;
    levels_[slot][b] = levelFromAmplitude(amplitude, b);
    s1_[b] = s2_[b] = 0.0f;
  }
  inHop_ = 0;
  done_.fetch_add(1, std::memory_order_release);
}

bool Meter::levelsAt(uint32_t playedFrame, uint8_t out[kBands]) const {
  const uint32_t done = done_.load(std::memory_order_acquire);
  const uint32_t target = playedFrame / kHop;
  if (target >= done) return false;                    // not analysed yet
  if (done - target > kHistory - kPeakHops) return false;  // overwritten
  memset(out, 0, kBands);
  const uint32_t first = target >= kPeakHops - 1 ? target - (kPeakHops - 1) : 0;
  for (uint32_t h = first; h <= target; ++h) {
    for (int b = 0; b < kBands; ++b) {
      const uint8_t v = levels_[h % kHistory][b];
      if (v > out[b]) out[b] = v;
    }
  }
  return true;
}

}  // namespace bands
