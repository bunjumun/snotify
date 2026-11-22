//
// Host-side tests for the box player's sample handling: WAV headers, mono to
// stereo, the 48 -> 44.1 kHz resampler and volume.
// Run with: pio test -e native
//
#include <string.h>
#include <unity.h>

#include <vector>

#include "pcm_format.h"

namespace {

void put16(std::vector<uint8_t>& b, uint16_t v) {
  b.push_back(v & 0xff);
  b.push_back(v >> 8);
}
void put32(std::vector<uint8_t>& b, uint32_t v) {
  for (int i = 0; i < 4; i++) b.push_back((v >> (8 * i)) & 0xff);
}
void tag(std::vector<uint8_t>& b, const char* t) { b.insert(b.end(), t, t + 4); }

// A header the way song-prep / ffmpeg write it, optionally with a LIST chunk
// before "data" and an arbitrary format tag.
std::vector<uint8_t> header(uint32_t rate, uint16_t ch, uint16_t bits, uint32_t dataBytes,
                            bool withList = false, uint16_t format = 1) {
  std::vector<uint8_t> b;
  tag(b, "RIFF");
  put32(b, 0);  // size, ignored
  tag(b, "WAVE");
  tag(b, "fmt ");
  put32(b, 16);
  put16(b, format);
  put16(b, ch);
  put32(b, rate);
  put32(b, rate * ch * bits / 8);
  put16(b, ch * bits / 8);
  put16(b, bits);
  if (withList) {
    tag(b, "LIST");
    put32(b, 7);  // odd size: chunks are padded to even
    for (int i = 0; i < 8; i++) b.push_back('x');
  }
  tag(b, "data");
  put32(b, dataBytes);
  return b;
}

}  // namespace

void parses_a_plain_44k_stereo_header() {
  auto h = header(44100, 2, 16, 4000);
  pcm::WavInfo info{};
  TEST_ASSERT_EQUAL(pcm::WavResult::Ok, pcm::parseWav(h.data(), h.size(), 44 + 4000, info));
  TEST_ASSERT_EQUAL_UINT32(44100, info.sampleRate);
  TEST_ASSERT_EQUAL_UINT16(2, info.channels);
  TEST_ASSERT_EQUAL_UINT32(44, info.dataOffset);
  TEST_ASSERT_EQUAL_UINT32(4000, info.dataBytes);
  TEST_ASSERT_EQUAL_UINT16(4, info.blockAlign);
}

void skips_a_padded_list_chunk() {
  auto h = header(48000, 2, 16, 400, true);
  pcm::WavInfo info{};
  TEST_ASSERT_EQUAL(pcm::WavResult::Ok, pcm::parseWav(h.data(), h.size(), 2000, info));
  TEST_ASSERT_EQUAL_UINT32(36 + 8 + 8 + 8, info.dataOffset);
}

void clamps_data_size_to_the_file() {
  // A recorder that died mid-take leaves 0 or 0xFFFFFFFF in the data size.
  auto h = header(44100, 2, 16, 0xFFFFFFFF);
  pcm::WavInfo info{};
  TEST_ASSERT_EQUAL(pcm::WavResult::Ok, pcm::parseWav(h.data(), h.size(), 44 + 1002, info));
  TEST_ASSERT_EQUAL_UINT32(1000, info.dataBytes);  // whole frames only
}

void rejects_24_bit() {
  auto h = header(48000, 2, 24, 600);
  pcm::WavInfo info{};
  TEST_ASSERT_EQUAL(pcm::WavResult::NotSixteenBit, pcm::parseWav(h.data(), h.size(), 1000, info));
}

void rejects_compressed_formats() {
  auto h = header(44100, 2, 16, 600, false, 2);  // MS ADPCM
  pcm::WavInfo info{};
  TEST_ASSERT_EQUAL(pcm::WavResult::NotPcm, pcm::parseWav(h.data(), h.size(), 1000, info));
}

void rejects_non_riff() {
  uint8_t junk[64] = {'I', 'D', '3'};
  pcm::WavInfo info{};
  TEST_ASSERT_EQUAL(pcm::WavResult::NotWav, pcm::parseWav(junk, sizeof junk, 1000, info));
}

void rejects_a_header_with_no_data_chunk() {
  auto h = header(44100, 2, 16, 10);
  h.resize(36);  // cut before "data"
  pcm::WavInfo info{};
  TEST_ASSERT_EQUAL(pcm::WavResult::NoData, pcm::parseWav(h.data(), h.size(), 1000, info));
}

void rejects_silly_rates() {
  auto h = header(4000, 2, 16, 10);
  pcm::WavInfo info{};
  TEST_ASSERT_EQUAL(pcm::WavResult::BadRate, pcm::parseWav(h.data(), h.size(), 1000, info));
}

void mono_is_copied_to_both_sides() {
  const uint8_t raw[] = {0x01, 0x00, 0xff, 0xff};  // 1, -1
  pcm::StereoFrame out[2];
  TEST_ASSERT_EQUAL_size_t(2, pcm::toStereo(raw, sizeof raw, 1, out));
  TEST_ASSERT_EQUAL_INT16(1, out[0].left);
  TEST_ASSERT_EQUAL_INT16(1, out[0].right);
  TEST_ASSERT_EQUAL_INT16(-1, out[1].left);
}

void stereo_keeps_sides_and_drops_a_partial_frame() {
  const uint8_t raw[] = {0x02, 0x00, 0x03, 0x00, 0x09};
  pcm::StereoFrame out[2];
  TEST_ASSERT_EQUAL_size_t(1, pcm::toStereo(raw, sizeof raw, 2, out));
  TEST_ASSERT_EQUAL_INT16(2, out[0].left);
  TEST_ASSERT_EQUAL_INT16(3, out[0].right);
}

void same_rate_passes_samples_through() {
  pcm::Resampler r;
  r.reset(44100, 44100);
  pcm::StereoFrame in[4] = {{1, 1}, {2, 2}, {3, 3}, {4, 4}};
  pcm::StereoFrame out[8];
  size_t used = 0;
  const size_t n = r.process(in, 4, used, out, 8);
  TEST_ASSERT_EQUAL_size_t(4, used);
  // One frame stays held back as the left-hand interpolation point.
  TEST_ASSERT_EQUAL_size_t(3, n);
  TEST_ASSERT_EQUAL_INT16(1, out[0].left);
  TEST_ASSERT_EQUAL_INT16(3, out[2].left);
}

void resampling_48k_gives_the_right_frame_count() {
  // One second in must be one second out, across many small calls, or the
  // position shown on the page drifts away from what is heard.
  pcm::Resampler r;
  r.reset(48000, 44100);
  std::vector<pcm::StereoFrame> in(480);
  for (size_t i = 0; i < in.size(); i++) in[i] = {(int16_t)i, (int16_t)-(int16_t)i};
  pcm::StereoFrame out[1024];
  size_t total = 0;
  for (int call = 0; call < 100; call++) {
    size_t off = 0;
    while (off < in.size()) {
      size_t used = 0;
      total += r.process(in.data() + off, in.size() - off, used, out, 64);
      off += used;
    }
  }
  TEST_ASSERT_INT_WITHIN(2, 44100, (int)total);
}

void resampling_interpolates_a_ramp() {
  pcm::Resampler r;
  r.reset(48000, 44100);
  std::vector<pcm::StereoFrame> in(200);
  for (size_t i = 0; i < in.size(); i++) in[i] = {(int16_t)(i * 100), 0};
  pcm::StereoFrame out[256];
  size_t used = 0;
  const size_t n = r.process(in.data(), in.size(), used, out, 256);
  TEST_ASSERT_TRUE(n > 150);
  // Output frame k sits at input position k * 48000/44100.
  for (size_t k = 0; k < n; k++) {
    const double want = k * (48000.0 / 44100.0) * 100.0;
    TEST_ASSERT_INT_WITHIN(3, (int)want, out[k].left);
  }
}

void resampler_never_overflows_out() {
  pcm::Resampler r;
  r.reset(22050, 44100);  // doubling
  std::vector<pcm::StereoFrame> in(100, {5, 5});
  pcm::StereoFrame out[10];
  size_t used = 0;
  TEST_ASSERT_EQUAL_size_t(10, r.process(in.data(), in.size(), used, out, 10));
  TEST_ASSERT_TRUE(used < 100);
}

void interpolation_survives_full_scale_swings() {
  pcm::Resampler r;
  r.reset(48000, 44100);
  pcm::StereoFrame in[6] = {{-32768, 32767}, {32767, -32768}, {-32768, 32767},
                            {32767, -32768}, {-32768, 32767}, {32767, -32768}};
  pcm::StereoFrame out[8];
  size_t used = 0;
  const size_t n = r.process(in, 6, used, out, 8);
  for (size_t k = 0; k < n; k++) {
    TEST_ASSERT_TRUE(out[k].left >= -32768 && out[k].left <= 32767);
  }
}

void volume_scales_and_zero_silences() {
  pcm::StereoFrame f[2] = {{1000, -1000}, {32767, -32768}};
  pcm::applyVolume(f, 2, pcm::gainFromVolume(1.0f));
  TEST_ASSERT_EQUAL_INT16(1000, f[0].left);
  TEST_ASSERT_EQUAL_INT16(-32768, f[1].right);
  pcm::applyVolume(f, 2, pcm::gainFromVolume(0.5f));
  TEST_ASSERT_EQUAL_INT16(250, f[0].left);  // 0.5 squared: a quarter
  pcm::applyVolume(f, 2, pcm::gainFromVolume(0.0f));
  TEST_ASSERT_EQUAL_INT16(0, f[0].left);
  TEST_ASSERT_EQUAL_INT16(0, f[1].left);
}

void gain_clamps_out_of_range_volume() {
  TEST_ASSERT_EQUAL_UINT16(pcm::kUnityGain, pcm::gainFromVolume(7.0f));
  TEST_ASSERT_EQUAL_UINT16(0, pcm::gainFromVolume(-1.0f));
}

void frame_offset_for_seek_is_block_aligned() {
  pcm::WavInfo info{};
  info.sampleRate = 48000;
  info.blockAlign = 4;
  info.dataBytes = 48000 * 4 * 10;
  TEST_ASSERT_EQUAL_UINT32(48000 * 4 * 2, pcm::byteOffsetFor(info, 2.0f));
  TEST_ASSERT_EQUAL_UINT32(info.dataBytes, pcm::byteOffsetFor(info, 99.0f));
  TEST_ASSERT_EQUAL_UINT32(0, pcm::byteOffsetFor(info, -3.0f));
  TEST_ASSERT_EQUAL_UINT32(0, pcm::byteOffsetFor(info, 0.00001f) % 4);
}

void setUp() {}
void tearDown() {}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(parses_a_plain_44k_stereo_header);
  RUN_TEST(skips_a_padded_list_chunk);
  RUN_TEST(clamps_data_size_to_the_file);
  RUN_TEST(rejects_24_bit);
  RUN_TEST(rejects_compressed_formats);
  RUN_TEST(rejects_non_riff);
  RUN_TEST(rejects_a_header_with_no_data_chunk);
  RUN_TEST(rejects_silly_rates);
  RUN_TEST(mono_is_copied_to_both_sides);
  RUN_TEST(stereo_keeps_sides_and_drops_a_partial_frame);
  RUN_TEST(same_rate_passes_samples_through);
  RUN_TEST(resampling_48k_gives_the_right_frame_count);
  RUN_TEST(resampling_interpolates_a_ramp);
  RUN_TEST(resampler_never_overflows_out);
  RUN_TEST(interpolation_survives_full_scale_swings);
  RUN_TEST(volume_scales_and_zero_silences);
  RUN_TEST(gain_clamps_out_of_range_volume);
  RUN_TEST(frame_offset_for_seek_is_block_aligned);
  return UNITY_END();
}
