#pragma once
//
// Sample handling for the box player: reading a WAV header, turning its PCM
// into the 44.1 kHz 16-bit stereo an A2DP source sends, and volume.
//
// Free of Arduino headers so it runs on a laptop (test/test_pcm). Everything
// here is pure: the player owns the file, the ring buffer and the threads.
//
#include <stddef.h>
#include <stdint.h>

namespace pcm {

// What A2DP (SBC) carries. The ESP32 A2DP source is fixed at this rate.
constexpr uint32_t kOutputRate = 44100;
constexpr uint32_t kMinInputRate = 8000;
constexpr uint32_t kMaxInputRate = 96000;

struct WavInfo {
  uint32_t sampleRate;
  uint16_t channels;
  uint16_t blockAlign;  // bytes per frame
  uint32_t dataOffset;  // file offset of the first sample
  uint32_t dataBytes;   // whole frames only, clamped to the file
};

enum class WavResult { Ok, NotWav, NoFormat, NotPcm, NotSixteenBit, BadChannels, BadRate, NoData };

const char* describe(WavResult r);

// `buf` holds the start of the file (4 KB covers every header seen so far).
// `fileSize` clamps the data size, which half-written files get wrong.
WavResult parseWav(const uint8_t* buf, size_t len, uint64_t fileSize, WavInfo& out);

// Byte offset into the data chunk for a start time, frame-aligned and clamped.
uint32_t byteOffsetFor(const WavInfo& info, float seconds);

struct StereoFrame {
  int16_t left;
  int16_t right;
};

// 16-bit little-endian interleaved PCM (1 or 2 channels) to stereo frames.
// Returns frames written; a trailing partial frame is ignored.
size_t toStereo(const uint8_t* raw, size_t bytes, uint16_t channels, StereoFrame* out);

// Linear-interpolating sample-rate converter. Good enough for 48 -> 44.1 kHz
// into a Bluetooth speaker; SBC itself costs more than linear interpolation.
// Holds one input frame back between calls, so it is stateful: reset() on
// every new track or seek.
class Resampler {
 public:
  void reset(uint32_t inRate, uint32_t outRate);
  // Writes at most outCap frames; `consumed` says how many input frames were
  // taken (always <= inCount). Call again with the rest until consumed covers
  // the input.
  size_t process(const StereoFrame* in, size_t inCount, size_t& consumed, StereoFrame* out,
                 size_t outCap);

 private:
  static constexpr uint32_t kOne = 1u << 16;
  uint32_t step_ = kOne;   // input frames per output frame, 16.16
  uint32_t phase_ = kOne;  // position of the next output past prev_, 16.16
  StereoFrame prev_{0, 0};
};

// Volume 0..1 from the page to a gain where kUnityGain is 1.0. Squared, so
// the slider feels even rather than all happening in the bottom quarter.
constexpr uint16_t kUnityGain = 256;
uint16_t gainFromVolume(float v);
void applyVolume(StereoFrame* frames, size_t n, uint16_t gain);

}  // namespace pcm
