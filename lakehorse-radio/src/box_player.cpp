#include "box_player.h"

#include "config.h"

const char* boxplayer::stateName(State s) {
  switch (s) {
    case State::Stopped: return "stopped";
    case State::Playing: return "playing";
    case State::Paused: return "paused";
  }
  return "unknown";
}

#if !LAKEHORSE_BT

namespace boxplayer {
namespace {
const char* const kNotBuilt = "Bluetooth is not in this firmware build";
}
void begin() {}
String play(const char*, float) { return kNotBuilt; }
void pause() {}
void resume() {}
void stop() {}
void seek(float) {}
void setVolume(float) {}
Status status() {
  Status s{};
  s.built = false;
  s.state = State::Stopped;
  s.volume = 1.0f;
  s.speaker = cfg::BT_SPEAKER_NAME;
  return s;
}
}  // namespace boxplayer

#else

#include <SD.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <freertos/task.h>

#include <atomic>

#include "BluetoothA2DPSource.h"
#include "bt_speaker.h"
#include "pcm_format.h"
#include "sd_store.h"

namespace boxplayer {
namespace {

using pcm::StereoFrame;

// ---- ring buffer: reader task writes, Bluetooth task reads ----
// Indices and the copy itself sit under one spinlock. Copies are at most a
// few KB from PSRAM (tens of microseconds), and holding the lock across them
// means a flush (play, seek, stop) can never interleave with a half-done read.
portMUX_TYPE g_ringMux = portMUX_INITIALIZER_UNLOCKED;
StereoFrame* g_ring = nullptr;
size_t g_head = 0;  // next write
size_t g_tail = 0;  // next read
size_t g_count = 0;

// ---- shared flags: plain atomics, read by the Bluetooth callback ----
std::atomic<int> g_state{(int)State::Stopped};
std::atomic<bool> g_primed{false};
std::atomic<bool> g_eof{false};
std::atomic<bool> g_endedPending{false};
std::atomic<uint32_t> g_played{0};  // output frames sent since the last flush
std::atomic<uint32_t> g_underruns{0};
std::atomic<uint32_t> g_ended{0};
std::atomic<uint16_t> g_gain{pcm::kUnityGain};
std::atomic<uint32_t> g_volumeMilli{1000};

// ---- track state: under g_lock, owned by commands and the reader ----
SemaphoreHandle_t g_lock = nullptr;
File g_file;
pcm::WavInfo g_info{};
pcm::Resampler g_resampler;
uint32_t g_remaining = 0;  // data bytes left to read
float g_seekBase = 0.0f;
String g_track;
String g_error;

// Reader scratch. Raw bytes in internal RAM for the SD driver; the converted
// frames in PSRAM, since only the CPU touches them.
uint8_t g_raw[cfg::BOX_READ_BYTES];
StereoFrame* g_conv = nullptr;
StereoFrame* g_out = nullptr;
constexpr size_t kOutFrames = 1024;

size_t ringFree() {
  portENTER_CRITICAL(&g_ringMux);
  const size_t f = cfg::BOX_RING_FRAMES - g_count;
  portEXIT_CRITICAL(&g_ringMux);
  return f;
}

size_t ringCount() {
  portENTER_CRITICAL(&g_ringMux);
  const size_t c = g_count;
  portEXIT_CRITICAL(&g_ringMux);
  return c;
}

// Caller has checked there is room.
void ringPush(const StereoFrame* src, size_t n) {
  portENTER_CRITICAL(&g_ringMux);
  for (size_t done = 0; done < n;) {
    const size_t run = min(n - done, cfg::BOX_RING_FRAMES - g_head);
    memcpy(g_ring + g_head, src + done, run * sizeof(StereoFrame));
    g_head = (g_head + run) % cfg::BOX_RING_FRAMES;
    done += run;
  }
  g_count += n;
  portEXIT_CRITICAL(&g_ringMux);
}

size_t ringPop(StereoFrame* dst, size_t n) {
  portENTER_CRITICAL(&g_ringMux);
  const size_t take = min(n, g_count);
  for (size_t done = 0; done < take;) {
    const size_t run = min(take - done, cfg::BOX_RING_FRAMES - g_tail);
    memcpy(dst + done, g_ring + g_tail, run * sizeof(StereoFrame));
    g_tail = (g_tail + run) % cfg::BOX_RING_FRAMES;
    done += run;
  }
  g_count -= take;
  portEXIT_CRITICAL(&g_ringMux);
  return take;
}

void ringFlush() {
  portENTER_CRITICAL(&g_ringMux);
  g_head = g_tail = g_count = 0;
  portEXIT_CRITICAL(&g_ringMux);
  g_played = 0;
  g_primed = false;
  g_eof = false;
  g_endedPending = false;
}

// Bluetooth task. Always returns `count`: the library sends whatever is in
// the buffer, so a short return would only shorten the packet, not pause.
int32_t fillFrames(Frame* frames, int32_t count) {
  StereoFrame* out = reinterpret_cast<StereoFrame*>(frames);
  size_t got = 0;
  if ((State)g_state.load() == State::Playing && g_primed) {
    got = ringPop(out, (size_t)count);
    pcm::applyVolume(out, got, g_gain);
    g_played += got;
    if (got < (size_t)count) {
      if (g_eof) {
        g_endedPending = true;
      } else {
        g_underruns++;
      }
    }
  }
  if (got < (size_t)count) memset(out + got, 0, ((size_t)count - got) * sizeof(StereoFrame));
  return count;
}
static_assert(sizeof(Frame) == sizeof(StereoFrame), "A2DP frame layout changed");

void closeTrackLocked() {
  if (g_file) g_file.close();
  g_remaining = 0;
  g_track = "";
  g_state = (int)State::Stopped;
  ringFlush();
}

// One pass of the reader: read a block, convert, queue. Under g_lock.
// Returns true if it did any work.
bool readOnceLocked() {
  if ((State)g_state.load() == State::Stopped || !g_file || g_eof) return false;
  // Worst case output for a full read: every input frame becomes
  // 44100/rate output frames, plus one for the resampler's held frame.
  const size_t inFramesMax = cfg::BOX_READ_BYTES / g_info.blockAlign;
  const size_t outMax = inFramesMax * pcm::kOutputRate / g_info.sampleRate + 2;
  if (ringFree() < outMax) return false;

  const size_t want = min((uint32_t)cfg::BOX_READ_BYTES, g_remaining);
  const size_t got = want ? g_file.read(g_raw, want) : 0;
  if (got == 0) {
    g_eof = true;
    return true;
  }
  g_remaining -= got;
  if (g_remaining == 0) g_eof = true;

  const size_t inFrames = pcm::toStereo(g_raw, got, g_info.channels, g_conv);
  for (size_t off = 0; off < inFrames;) {
    size_t used = 0;
    const size_t n = g_resampler.process(g_conv + off, inFrames - off, used, g_out, kOutFrames);
    ringPush(g_out, n);
    off += used;
    if (used == 0 && n == 0) break;  // cannot happen; guards an endless loop
  }
  return true;
}

void readerTask(void*) {
  for (;;) {
    bool worked = false;
    xSemaphoreTake(g_lock, portMAX_DELAY);
    worked = readOnceLocked();
    if (!g_primed && (ringCount() >= cfg::BOX_PRIME_FRAMES || g_eof)) g_primed = true;
    if (g_endedPending) {
      Serial.printf("[box] ended \"%s\"\n", g_track.c_str());
      closeTrackLocked();
      g_ended++;
    }
    xSemaphoreGive(g_lock);
    if (!worked) vTaskDelay(pdMS_TO_TICKS(cfg::BOX_READER_IDLE_MS));
  }
}

// Opens `path` and positions it at `startSeconds`. Under g_lock.
String openLocked(const String& path, float startSeconds) {
  if (g_file) g_file.close();
  g_file = SD.open(path, FILE_READ);
  if (!g_file) return "could not open that song on the card";
  const size_t n = g_file.read(g_raw, sizeof g_raw);
  const pcm::WavResult r = pcm::parseWav(g_raw, n, g_file.size(), g_info);
  if (r != pcm::WavResult::Ok) {
    g_file.close();
    return pcm::describe(r);
  }
  const uint32_t skip = pcm::byteOffsetFor(g_info, startSeconds);
  if (!g_file.seek(g_info.dataOffset + skip)) {
    g_file.close();
    return "could not seek in that song";
  }
  g_remaining = g_info.dataBytes - skip;
  g_seekBase = (float)skip / g_info.blockAlign / g_info.sampleRate;
  g_resampler.reset(g_info.sampleRate, pcm::kOutputRate);
  ringFlush();
  return "";
}

class Lock {
 public:
  Lock() { xSemaphoreTake(g_lock, portMAX_DELAY); }
  ~Lock() { xSemaphoreGive(g_lock); }
};

}  // namespace

void begin() {
  if (!btspeaker::enabled()) {
    // Bluetooth switched off: no reader, no 352 KB ring. play() says why.
    btspeaker::begin(fillFrames);
    g_error = "Bluetooth is off";
    return;
  }
  g_lock = xSemaphoreCreateMutex();
  g_ring = static_cast<StereoFrame*>(ps_malloc(cfg::BOX_RING_FRAMES * sizeof(StereoFrame)));
  g_conv = static_cast<StereoFrame*>(
      ps_malloc((cfg::BOX_READ_BYTES / 2) * sizeof(StereoFrame)));  // mono worst case
  g_out = static_cast<StereoFrame*>(ps_malloc(kOutFrames * sizeof(StereoFrame)));
  if (!g_lock || !g_ring || !g_conv || !g_out) {
    // Without PSRAM the ring does not fit; say so and leave playback dead
    // rather than half-working. Status keeps reporting built=true so the page
    // shows the error, not "not in this build".
    Serial.println(F("[box] no memory for the audio buffer; box playback disabled"));
    g_error = "no memory for the audio buffer";
    return;
  }
  xTaskCreatePinnedToCore(readerTask, "boxreader", cfg::BOX_READER_STACK, nullptr,
                          cfg::BOX_READER_PRIORITY, nullptr, cfg::BOX_READER_CORE);

  btspeaker::begin(fillFrames);
}

String play(const char* safeName, float startSeconds) {
  if (!btspeaker::enabled()) return "Bluetooth is off";
  if (!g_lock || !g_ring) return "box playback is not running";
  if (!sdstore::mounted()) return "no SD card";
  Lock lock;
  const String err = openLocked(sdstore::path(safeName), startSeconds);
  if (err.length()) {
    closeTrackLocked();
    g_error = err;
    Serial.printf("[box] play \"%s\" failed: %s\n", safeName, err.c_str());
    return err;
  }
  g_track = safeName;
  g_error = "";
  g_state = (int)State::Playing;
  Serial.printf("[box] play \"%s\" at %.1f s (%u Hz, %u ch)\n", safeName, g_seekBase,
                (unsigned)g_info.sampleRate, (unsigned)g_info.channels);
  return "";
}

void pause() {
  if (!g_lock) return;
  Lock lock;
  if ((State)g_state.load() == State::Playing) g_state = (int)State::Paused;
}

void resume() {
  if (!g_lock) return;
  Lock lock;
  if ((State)g_state.load() == State::Paused) g_state = (int)State::Playing;
}

void stop() {
  if (!g_lock) return;
  Lock lock;
  closeTrackLocked();
}

void seek(float seconds) {
  if (!g_lock) return;
  Lock lock;
  if ((State)g_state.load() == State::Stopped || !g_track.length()) return;
  const State was = (State)g_state.load();
  const String err = openLocked(sdstore::path(g_track.c_str()), seconds);
  if (err.length()) {
    g_error = err;
    closeTrackLocked();
    return;
  }
  g_state = (int)was;
}

void setVolume(float v) {
  if (!(v >= 0.0f)) v = 0.0f;
  if (v > 1.0f) v = 1.0f;
  g_volumeMilli = (uint32_t)(v * 1000.0f + 0.5f);
  g_gain = pcm::gainFromVolume(v);
}

Status status() {
  Status s{};
  s.built = true;
  s.connected = btspeaker::connected();
  s.speaker = btspeaker::info().speaker;
  s.volume = g_volumeMilli / 1000.0f;
  s.ended = g_ended;
  s.underruns = g_underruns;
  if (!g_lock) {
    s.state = State::Stopped;
    s.error = g_error;
    return s;
  }
  Lock lock;
  s.state = (State)g_state.load();
  s.track = g_track;
  s.error = g_error;
  if (s.state != State::Stopped && g_info.sampleRate) {
    s.position = g_seekBase + (float)g_played / pcm::kOutputRate;
    s.duration = (float)g_info.dataBytes / g_info.blockAlign / g_info.sampleRate;
  }
  return s;
}

}  // namespace boxplayer

#endif  // LAKEHORSE_BT
