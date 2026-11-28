#include "flac_convert.h"

#include <Arduino.h>
#include <ESPAsyncWebServer.h>
#include <SD.h>
#include <esp_heap_caps.h>

#include "config.h"
#include "pcm_format.h"
#include "sd_store.h"
#include "track_name.h"

// dr_flac (public domain / MIT-0). No stdio, no Ogg: the callbacks read the SD
// card directly. Allocations of 16 KB and up go to PSRAM (the one use the rev
// v1.0 chip allows, see config.h); small ones stay in internal RAM.
#define DR_FLAC_NO_STDIO
#define DR_FLAC_NO_OGG
#define DR_FLAC_NO_WCHAR
#define DR_FLAC_IMPLEMENTATION
#include "dr_flac.h"

namespace flacconv {
namespace {

constexpr size_t PSRAM_MIN_BYTES = 16384;
constexpr size_t OUT_FRAMES = 4096;       // frames decoded per round
constexpr size_t WRITE_BLOCK = 16384;     // same block the upload path uses
constexpr uint32_t BOOT_DELAY_MS = 15000; // let Wi-Fi and Bluetooth settle first
constexpr uint64_t FREE_MARGIN = 1024 * 1024;
constexpr size_t MAX_PENDING_SCAN = 16;

void* allocFn(size_t n, void*) {
  if (n >= PSRAM_MIN_BYTES) {
    void* p = heap_caps_malloc(n, MALLOC_CAP_SPIRAM);
    if (p) return p;
  }
  return malloc(n);
}
void* reallocFn(void* p, size_t n, void*) { return realloc(p, n); }
void freeFn(void* p, void*) { free(p); }

// What the page polls. Written by the job task, read by the web task; word
// sized fields, and `error` is only trusted once `running` is false.
struct Status {
  volatile bool running = false;
  char name[cfg::TRACK_FILE_NAME_MAX_LEN + 1] = "";
  char error[96] = "";
  uint32_t frames = 0;
  uint32_t totalFrames = 0;
  uint32_t converted = 0;  // songs finished since boot
} g;

portMUX_TYPE g_startLock = portMUX_INITIALIZER_UNLOCKED;
volatile bool g_taskAlive = false;

void put32(uint8_t* p, uint32_t v) { p[0] = v; p[1] = v >> 8; p[2] = v >> 16; p[3] = v >> 24; }
void put16(uint8_t* p, uint16_t v) { p[0] = v; p[1] = v >> 8; }

void header(uint8_t* h, uint32_t channels, uint32_t rate, uint32_t dataBytes) {
  memcpy(h, "RIFF", 4); put32(h + 4, 36 + dataBytes); memcpy(h + 8, "WAVEfmt ", 8);
  put32(h + 16, 16); put16(h + 20, 1); put16(h + 22, channels); put32(h + 24, rate);
  put32(h + 28, rate * channels * 2); put16(h + 32, channels * 2); put16(h + 34, 16);
  memcpy(h + 36, "data", 4); put32(h + 40, dataBytes);
}

size_t onRead(void* user, void* out, size_t n) {
  return static_cast<File*>(user)->read(static_cast<uint8_t*>(out), n);
}
drflac_bool32 onSeek(void* user, int offset, drflac_seek_origin origin) {
  File* f = static_cast<File*>(user);
  const uint32_t base = origin == DRFLAC_SEEK_CUR ? f->position() : 0;
  return f->seek(base + offset) ? DRFLAC_TRUE : DRFLAC_FALSE;
}
drflac_bool32 onTell(void* user, drflac_int64* cursor) {
  *cursor = static_cast<File*>(user)->position();
  return DRFLAC_TRUE;
}

bool endsWithFlac(const String& n) { return n.endsWith(".flac") || n.endsWith(".FLAC"); }

// "Song.flac" -> "Song.wav"
String wavNameFor(const String& flacName) {
  return flacName.substring(0, flacName.length() - 5) + ".wav";
}

// First .flac in the music folder not in `skip`, or "". Collect-then-use, like
// sd_store: nothing is deleted while the directory is open.
String nextPending(const String& skip) {
  File dir = SD.open(cfg::SD_MUSIC_DIR);
  if (!dir) return "";
  String found;
  for (File f = dir.openNextFile(); f; f = dir.openNextFile()) {
    String n(f.name());
    const int slash = n.lastIndexOf('/');
    if (slash >= 0) n = n.substring(slash + 1);
    if (f.isDirectory() || !endsWithFlac(n) || n == skip) continue;
    found = n;
    break;
  }
  dir.close();
  return found;
}

// Converts one song. Returns nullptr on success or a literal reason. On any
// failure the .wav.part is removed and the .flac is kept, so nothing is lost
// and a retry is possible.
const char* convertOne(const String& flacName) {
  const String wavName = wavNameFor(flacName);
  char safeWav[cfg::TRACK_FILE_NAME_MAX_LEN + 1];
  if (trackname::sanitise(wavName.c_str(), safeWav, cfg::TRACK_FILE_NAME_MAX_LEN) !=
          trackname::Result::Ok || wavName != safeWav) {
    return "the song's name cannot become a .wav";
  }
  const String in = sdstore::path(flacName.c_str());
  const String part = sdstore::partPath(safeWav);

  File src = SD.open(in, FILE_READ);
  if (!src) return "cannot open the .flac";

  drflac_allocation_callbacks cb = {nullptr, allocFn, reallocFn, freeFn};
  drflac* flac = drflac_open(onRead, onSeek, onTell, &src, &cb);
  if (!flac) { src.close(); return "not a FLAC file the box can read"; }

  const uint32_t channels = flac->channels;
  const uint32_t rate = flac->sampleRate;
  const uint64_t total = flac->totalPCMFrameCount;
  const char* why = nullptr;
  if (flac->bitsPerSample != 16) why = "only 16-bit FLAC is handled";
  else if (channels < 1 || channels > 2) why = "only mono or stereo FLAC is handled";
  else if (total == 0 || total > 0x7FFFFFFFull / (channels * 2)) why = "the FLAC does not say how long it is";
  else if (rate < 8000 || rate > 96000) why = "sample rate out of range";
  if (why) { drflac_close(flac); src.close(); return why; }

  const uint32_t dataBytes = static_cast<uint32_t>(total) * channels * 2;
  if (sdstore::freeBytes() < static_cast<uint64_t>(dataBytes) + 44 + FREE_MARGIN) {
    drflac_close(flac); src.close();
    return "not enough space left on the SD card to convert this song";
  }
  g.totalFrames = static_cast<uint32_t>(total);

  if (SD.exists(part)) SD.remove(part);
  File dst = SD.open(part, FILE_WRITE);
  uint8_t* block = static_cast<uint8_t*>(heap_caps_malloc(WRITE_BLOCK, MALLOC_CAP_SPIRAM));
  int16_t* pcm = static_cast<int16_t*>(heap_caps_malloc(OUT_FRAMES * channels * 2, MALLOC_CAP_SPIRAM));
  if (!dst || !block || !pcm) {
    free(block); free(pcm); drflac_close(flac); src.close();
    if (dst) { dst.close(); SD.remove(part); }
    return "could not set up the conversion";
  }

  size_t fill = 44;
  header(block, channels, rate, dataBytes);
  bool ok = true;
  uint32_t frames = 0;
  while (ok) {
    const drflac_uint64 n = drflac_read_pcm_frames_s16(flac, OUT_FRAMES, pcm);
    if (n == 0) break;
    const uint8_t* raw = reinterpret_cast<const uint8_t*>(pcm);
    size_t bytes = n * channels * 2;
    frames += n;
    while (bytes && ok) {
      const size_t take = min(bytes, WRITE_BLOCK - fill);
      memcpy(block + fill, raw, take); fill += take; raw += take; bytes -= take;
      if (fill == WRITE_BLOCK) { ok = dst.write(block, fill) == fill; fill = 0; }
    }
    g.frames = frames;
    vTaskDelay(1);  // let the Wi-Fi and the player run
  }
  if (ok && fill) ok = dst.write(block, fill) == fill;
  dst.close();
  // Size is read after the close: a File still open can report a stale size.
  uint32_t written = 0;
  { File check = SD.open(part, FILE_READ); if (check) { written = check.size(); check.close(); } }
  src.close();
  drflac_close(flac);
  free(block); free(pcm);

  if (!ok) why = "writing to the SD card failed";
  else if (frames != g.totalFrames) why = "the FLAC ended early or is damaged";
  else if (written != 44 + dataBytes) why = "the finished WAV is the wrong size";
  if (!why && !sdstore::commit(safeWav)) why = "could not move the finished WAV into place";
  if (why) { SD.remove(part); return why; }
  SD.remove(in);  // only after the WAV is verified and in place
  Serial.printf("[flac] %s -> %s (%u frames)\n", flacName.c_str(), safeWav, (unsigned)frames);
  return nullptr;
}

void jobTask(void* arg) {
  const bool atBoot = arg != nullptr;
  if (atBoot) vTaskDelay(pdMS_TO_TICKS(BOOT_DELAY_MS));
  String failed;
  for (;;) {
    const String next = nextPending(failed);
    if (next.length() == 0) break;
    g.frames = 0; g.totalFrames = 0; g.error[0] = '\0';
    snprintf(g.name, sizeof(g.name), "%s", next.c_str());
    const char* why = convertOne(next);
    if (why) {
      snprintf(g.error, sizeof(g.error), "%s", why);
      Serial.printf("[flac] %s failed: %s\n", next.c_str(), why);
      failed = next;  // keep the .flac, carry on with any other
    } else {
      ++g.converted;
    }
  }
  g.running = false;
  g_taskAlive = false;
  vTaskDelete(nullptr);
}

// Starts the job if none is running. Low priority, core 0 (off AsyncTCP's core),
// 8 KB stack since dr_flac keeps its big state on the heap.
bool kick(bool atBoot) {
  if (!sdstore::mounted()) return false;
  bool start = false;
  portENTER_CRITICAL(&g_startLock);
  if (!g_taskAlive) { g_taskAlive = true; g.running = true; start = true; }
  portEXIT_CRITICAL(&g_startLock);
  if (!start) return true;  // already running: it will pick up new files itself
  if (xTaskCreatePinnedToCore(jobTask, "flacconv", 8192, atBoot ? &g : nullptr, 1, nullptr, 0) != pdPASS) {
    g.running = false; g_taskAlive = false;
    return false;
  }
  return true;
}

void handleStatus(AsyncWebServerRequest* request) {
  char buf[320];
  const bool running = g.running;
  snprintf(buf, sizeof(buf),
           "{\"running\":%s,\"name\":\"%s\",\"frames\":%u,\"totalFrames\":%u,\"converted\":%u,\"error\":\"%s\"}",
           running ? "true" : "false", g.name, (unsigned)g.frames, (unsigned)g.totalFrames,
           (unsigned)g.converted, running ? "" : g.error);
  request->send(200, "application/json", buf);
}

}  // namespace

void begin() {
  if (!sdstore::mounted()) return;
  if (nextPending("").length() > 0) kick(true);
}

bool start() { return kick(false); }

void registerRoutes(AsyncWebServer& server) {
  server.on("/api/sd/convert-status", HTTP_GET, handleStatus);
}

}  // namespace flacconv
