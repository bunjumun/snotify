#include "pcm_format.h"

#include <string.h>

namespace pcm {

namespace {

constexpr uint16_t kFormatPcm = 1;
constexpr uint16_t kFormatExtensible = 0xFFFE;
constexpr uint32_t kRiffHeaderBytes = 12;
constexpr uint32_t kChunkHeaderBytes = 8;
constexpr uint32_t kMinFmtBytes = 16;
// WAVE_FORMAT_EXTENSIBLE keeps the real format tag at this offset in fmt.
constexpr uint32_t kExtensibleSubFormatOffset = 24;

uint16_t rd16(const uint8_t* p) { return (uint16_t)(p[0] | (p[1] << 8)); }
uint32_t rd32(const uint8_t* p) {
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

int16_t lerp(int16_t a, int16_t b, uint32_t phase) {
  // 12-bit fraction keeps (b - a) * frac inside int32 for full-scale swings.
  const int32_t frac = (int32_t)(phase >> 4);
  return (int16_t)(a + (((int32_t)b - a) * frac >> 12));
}

}  // namespace

const char* describe(WavResult r) {
  switch (r) {
    case WavResult::Ok: return "ok";
    case WavResult::NotWav: return "not a WAV file";
    case WavResult::NoFormat: return "WAV has no format chunk";
    case WavResult::NotPcm: return "WAV is compressed; only plain PCM plays";
    case WavResult::NotSixteenBit: return "WAV is not 16-bit; convert it with song-prep";
    case WavResult::BadChannels: return "WAV must be mono or stereo";
    case WavResult::BadRate: return "WAV sample rate is out of range";
    case WavResult::NoData: return "WAV has no audio data in its header area";
  }
  return "unknown";
}

WavResult parseWav(const uint8_t* buf, size_t len, uint64_t fileSize, WavInfo& out) {
  if (len < kRiffHeaderBytes || memcmp(buf, "RIFF", 4) != 0 || memcmp(buf + 8, "WAVE", 4) != 0) {
    return WavResult::NotWav;
  }
  bool haveFmt = false;
  size_t pos = kRiffHeaderBytes;
  while (pos + kChunkHeaderBytes <= len) {
    const uint8_t* chunk = buf + pos;
    const uint32_t size = rd32(chunk + 4);
    const uint8_t* body = chunk + kChunkHeaderBytes;
    if (memcmp(chunk, "fmt ", 4) == 0) {
      if (size < kMinFmtBytes || pos + kChunkHeaderBytes + kMinFmtBytes > len) {
        return WavResult::NoFormat;
      }
      uint16_t format = rd16(body);
      if (format == kFormatExtensible && size >= kExtensibleSubFormatOffset + 2 &&
          pos + kChunkHeaderBytes + kExtensibleSubFormatOffset + 2 <= len) {
        format = rd16(body + kExtensibleSubFormatOffset);
      }
      if (format != kFormatPcm) return WavResult::NotPcm;
      out.channels = rd16(body + 2);
      out.sampleRate = rd32(body + 4);
      out.blockAlign = rd16(body + 12);
      const uint16_t bits = rd16(body + 14);
      if (bits != 16) return WavResult::NotSixteenBit;
      if (out.channels < 1 || out.channels > 2) return WavResult::BadChannels;
      if (out.sampleRate < kMinInputRate || out.sampleRate > kMaxInputRate) {
        return WavResult::BadRate;
      }
      out.blockAlign = (uint16_t)(out.channels * 2);
      haveFmt = true;
    } else if (memcmp(chunk, "data", 4) == 0) {
      if (!haveFmt) return WavResult::NoFormat;
      out.dataOffset = (uint32_t)(pos + kChunkHeaderBytes);
      uint64_t avail = fileSize > out.dataOffset ? fileSize - out.dataOffset : 0;
      uint64_t bytes = size < avail ? size : avail;
      bytes -= bytes % out.blockAlign;
      out.dataBytes = (uint32_t)bytes;
      return WavResult::Ok;
    }
    // Chunks are padded to an even length.
    pos += kChunkHeaderBytes + size + (size & 1);
  }
  return haveFmt ? WavResult::NoData : WavResult::NoFormat;
}

uint32_t byteOffsetFor(const WavInfo& info, float seconds) {
  if (!(seconds > 0.0f) || info.blockAlign == 0) return 0;
  const double frames = (double)seconds * info.sampleRate;
  const double bytes = frames * info.blockAlign;
  if (bytes >= info.dataBytes) return info.dataBytes;
  const uint32_t b = (uint32_t)bytes;
  return b - b % info.blockAlign;
}

size_t toStereo(const uint8_t* raw, size_t bytes, uint16_t channels, StereoFrame* out) {
  if (channels == 1) {
    const size_t n = bytes / 2;
    for (size_t i = 0; i < n; i++) {
      const int16_t s = (int16_t)rd16(raw + 2 * i);
      out[i] = {s, s};
    }
    return n;
  }
  const size_t n = bytes / 4;
  for (size_t i = 0; i < n; i++) {
    out[i] = {(int16_t)rd16(raw + 4 * i), (int16_t)rd16(raw + 4 * i + 2)};
  }
  return n;
}

void Resampler::reset(uint32_t inRate, uint32_t outRate) {
  step_ = (uint32_t)(((uint64_t)inRate << 16) / outRate);
  phase_ = kOne;
  prev_ = {0, 0};
}

size_t Resampler::process(const StereoFrame* in, size_t inCount, size_t& consumed,
                          StereoFrame* out, size_t outCap) {
  size_t idx = 0;
  size_t n = 0;
  for (;;) {
    while (phase_ >= kOne) {
      if (idx >= inCount) {
        consumed = idx;
        return n;
      }
      prev_ = in[idx++];
      phase_ -= kOne;
    }
    if (idx >= inCount || n >= outCap) break;
    out[n++] = {lerp(prev_.left, in[idx].left, phase_), lerp(prev_.right, in[idx].right, phase_)};
    phase_ += step_;
  }
  consumed = idx;
  return n;
}

uint16_t gainFromVolume(float v) {
  if (!(v > 0.0f)) return 0;
  if (v >= 1.0f) return kUnityGain;
  return (uint16_t)(v * v * kUnityGain + 0.5f);
}

void applyVolume(StereoFrame* frames, size_t n, uint16_t gain) {
  if (gain >= kUnityGain) return;
  for (size_t i = 0; i < n; i++) {
    frames[i].left = (int16_t)(((int32_t)frames[i].left * gain) >> 8);
    frames[i].right = (int16_t)(((int32_t)frames[i].right * gain) >> 8);
  }
}

}  // namespace pcm
