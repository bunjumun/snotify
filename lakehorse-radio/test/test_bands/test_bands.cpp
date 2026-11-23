//
// Host-side tests for the band meter. Run with: pio test -e native -f test_bands
//
#include <math.h>
#include <string.h>
#include <vector>
#include <unity.h>

#include "band_levels.h"

using bands::Meter;
using bands::kBands;
using bands::kHop;
using pcm::StereoFrame;

namespace {
std::vector<StereoFrame> sine(double hz, double amp, size_t frames, double phase = 0) {
  std::vector<StereoFrame> v(frames);
  for (size_t i = 0; i < frames; ++i) {
    const double s = amp * 32767.0 * sin(2.0 * M_PI * hz * (double)i / 44100.0 + phase);
    v[i] = {(int16_t)lrint(s), (int16_t)lrint(s)};
  }
  return v;
}
void levels(const std::vector<StereoFrame>& in, uint8_t out[kBands], uint32_t hop = 3) {
  Meter m;
  m.reset();
  m.feed(in.data(), in.size());
  TEST_ASSERT_TRUE(m.levelsAt(hop * kHop, out));
}
int argmax(const uint8_t* v) {
  int best = 0;
  for (int i = 1; i < kBands; ++i) if (v[i] > v[best]) best = i;
  return best;
}
}  // namespace

void setUp() {}
void tearDown() {}

void silence_reads_zero_on_every_band() {
  std::vector<StereoFrame> z(kHop * 6, StereoFrame{0, 0});
  uint8_t out[kBands];
  levels(z, out);
  for (int b = 0; b < kBands; ++b) TEST_ASSERT_EQUAL(0, out[b]);
}

void a_sine_at_each_band_centre_peaks_in_that_band() {
  for (int b = 0; b < kBands; ++b) {
    uint8_t out[kBands];
    levels(sine(bands::bandFrequency(b), 0.3, kHop * 6), out);
    TEST_ASSERT_EQUAL_MESSAGE(b, argmax(out), "wrong band peaked");
    TEST_ASSERT_TRUE_MESSAGE(out[b] >= 3, "own band too quiet");
    if (b > 0) TEST_ASSERT_TRUE_MESSAGE(out[b - 1] + 2 <= out[b], "left neighbour too loud");
    if (b < kBands - 1) TEST_ASSERT_TRUE_MESSAGE(out[b + 1] + 2 <= out[b], "right neighbour too loud");
  }
}

void louder_reads_higher_and_never_above_eight() {
  uint8_t quiet[kBands], mid[kBands], full[kBands];
  levels(sine(1000, 0.0005, kHop * 6), quiet);
  levels(sine(1000, 0.003, kHop * 6), mid);
  levels(sine(1000, 1.0, kHop * 6), full);
  TEST_ASSERT_TRUE(quiet[4] < mid[4]);
  TEST_ASSERT_TRUE(mid[4] < full[4]);
  TEST_ASSERT_TRUE(quiet[4] >= 1);
  for (int b = 0; b < kBands; ++b) TEST_ASSERT_TRUE(full[b] <= 8);
  TEST_ASSERT_EQUAL(8, full[4]);
}

void six_db_down_is_about_one_level_lower() {
  uint8_t a[kBands], b[kBands];
  levels(sine(1000, 0.4, kHop * 6), a);
  levels(sine(1000, 0.2, kHop * 6), b);
  TEST_ASSERT_TRUE(a[4] - b[4] >= 0 && a[4] - b[4] <= 2);
}

void a_steady_offset_does_not_light_the_high_bands() {
  std::vector<StereoFrame> dc(kHop * 6, StereoFrame{12000, 12000});
  uint8_t out[kBands];
  levels(dc, out);
  for (int b = 5; b < kBands; ++b) TEST_ASSERT_EQUAL(0, out[b]);
}

void chunk_size_makes_no_difference() {
  const auto in = sine(440, 0.3, kHop * 6);
  Meter whole, parts;
  whole.reset();
  parts.reset();
  whole.feed(in.data(), in.size());
  size_t sizes[] = {1, 7, 1000, 5000, 333};
  size_t off = 0, k = 0;
  while (off < in.size()) {
    const size_t n = std::min(sizes[k++ % 5], in.size() - off);
    parts.feed(in.data() + off, n);
    off += n;
  }
  TEST_ASSERT_EQUAL(whole.hopsDone(), parts.hopsDone());
  for (uint32_t h = 3; h < whole.hopsDone(); ++h) {
    uint8_t a[kBands], b[kBands];
    TEST_ASSERT_TRUE(whole.levelsAt(h * kHop, a));
    TEST_ASSERT_TRUE(parts.levelsAt(h * kHop, b));
    TEST_ASSERT_EQUAL_MEMORY(a, b, kBands);
  }
}

void hops_complete_every_1024_frames() {
  Meter m;
  m.reset();
  std::vector<StereoFrame> z(kHop - 1, StereoFrame{0, 0});
  m.feed(z.data(), z.size());
  TEST_ASSERT_EQUAL(0, m.hopsDone());
  m.feed(z.data(), 1);
  TEST_ASSERT_EQUAL(1, m.hopsDone());
  m.feed(z.data(), z.size());
  m.feed(z.data(), 2);
  TEST_ASSERT_EQUAL(2, m.hopsDone());
}

void lookup_refuses_what_is_not_analysed_yet_or_too_old() {
  Meter m;
  m.reset();
  uint8_t out[kBands];
  TEST_ASSERT_FALSE(m.levelsAt(0, out));  // nothing yet
  std::vector<StereoFrame> z(kHop * 2, StereoFrame{0, 0});
  m.feed(z.data(), z.size());
  TEST_ASSERT_TRUE(m.levelsAt(0, out));
  TEST_ASSERT_TRUE(m.levelsAt(kHop, out));
  TEST_ASSERT_FALSE(m.levelsAt(2 * kHop, out));  // the reader has not got there
  // Run far past the timeline: the earliest frames are gone.
  std::vector<StereoFrame> big(kHop * (bands::kHistory + 10), StereoFrame{0, 0});
  m.feed(big.data(), big.size());
  TEST_ASSERT_FALSE(m.levelsAt(0, out));
  TEST_ASSERT_TRUE(m.levelsAt((m.hopsDone() - 1) * kHop, out));
}

void a_level_is_the_loudest_of_the_last_few_hops() {
  Meter m;
  m.reset();
  // One loud hop then quiet ones: the lookup just after it still shows the hit.
  auto loud = sine(1000, 0.8, kHop);
  std::vector<StereoFrame> quiet(kHop * 6, StereoFrame{0, 0});
  m.feed(quiet.data(), kHop * 2);
  m.feed(loud.data(), loud.size());
  m.feed(quiet.data(), kHop * 4);
  uint8_t at_hit[kBands], later[kBands], much_later[kBands];
  TEST_ASSERT_TRUE(m.levelsAt(2 * kHop, at_hit));
  TEST_ASSERT_TRUE(m.levelsAt(4 * kHop, later));       // within the 4-hop peak hold
  TEST_ASSERT_TRUE(m.levelsAt(7 * kHop - 1, much_later));  // past it
  TEST_ASSERT_TRUE(at_hit[4] >= 5);
  TEST_ASSERT_EQUAL(at_hit[4], later[4]);
  TEST_ASSERT_EQUAL(0, much_later[4]);
}

void reset_restarts_frame_numbers_and_forgets_a_partial_hop() {
  Meter m;
  m.reset();
  auto s = sine(1000, 0.5, kHop * 3 + 500);
  m.feed(s.data(), s.size());
  m.reset();
  TEST_ASSERT_EQUAL(0, m.hopsDone());
  uint8_t out[kBands];
  TEST_ASSERT_FALSE(m.levelsAt(0, out));
  // The 500 stray frames must not count towards the first hop of the next song.
  std::vector<StereoFrame> z(kHop - 1, StereoFrame{0, 0});
  m.feed(z.data(), z.size());
  TEST_ASSERT_EQUAL(0, m.hopsDone());
}

void mono_is_the_mean_of_the_channels() {
  // Opposite-phase channels cancel to silence.
  std::vector<StereoFrame> a(kHop * 6);
  auto s = sine(1000, 0.5, kHop * 6);
  for (size_t i = 0; i < a.size(); ++i) a[i] = {s[i].left, (int16_t)-s[i].left};
  uint8_t out[kBands];
  levels(a, out);
  for (int b = 0; b < kBands; ++b) TEST_ASSERT_EQUAL(0, out[b]);
}

void level_scale_edges() {
  TEST_ASSERT_EQUAL(0, bands::levelFromAmplitude(0.0f, 0));
  TEST_ASSERT_EQUAL(0, bands::levelFromAmplitude(-1.0f, 0));
  TEST_ASSERT_EQUAL(0, bands::levelFromAmplitude(NAN, 0));
  TEST_ASSERT_EQUAL(8, bands::levelFromAmplitude(1.0f, 0));
  TEST_ASSERT_EQUAL(8, bands::levelFromAmplitude(100.0f, 7));
  // The tilt lifts higher bands: the same quiet amplitude reads louder there.
  TEST_ASSERT_TRUE(bands::levelFromAmplitude(0.003f, 7) > bands::levelFromAmplitude(0.003f, 0));
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(silence_reads_zero_on_every_band);
  RUN_TEST(a_sine_at_each_band_centre_peaks_in_that_band);
  RUN_TEST(louder_reads_higher_and_never_above_eight);
  RUN_TEST(six_db_down_is_about_one_level_lower);
  RUN_TEST(a_steady_offset_does_not_light_the_high_bands);
  RUN_TEST(chunk_size_makes_no_difference);
  RUN_TEST(hops_complete_every_1024_frames);
  RUN_TEST(lookup_refuses_what_is_not_analysed_yet_or_too_old);
  RUN_TEST(a_level_is_the_loudest_of_the_last_few_hops);
  RUN_TEST(reset_restarts_frame_numbers_and_forgets_a_partial_hop);
  RUN_TEST(mono_is_the_mean_of_the_channels);
  RUN_TEST(level_scale_edges);
  return UNITY_END();
}
