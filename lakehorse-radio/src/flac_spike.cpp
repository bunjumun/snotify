#ifdef LAKEHORSE_FLAC_SPIKE
#include "flac_spike.h"

#include <Arduino.h>
#include <ESPAsyncWebServer.h>
#include <SD.h>
#include <esp_heap_caps.h>

#include "config.h"
#include "sd_store.h"
#include "track_name.h"

// dr_flac (public domain / MIT-0). No stdio and no Ogg: the callbacks below read
// the SD card directly. Allocations of 16 KB and up go to PSRAM (the one rule the
// rev v1.0 chip allows, see config.h); small ones stay in internal RAM.
#define DR_FLAC_NO_STDIO
#define DR_FLAC_NO_OGG
#define DR_FLAC_NO_WCHAR
#define DR_FLAC_IMPLEMENTATION
#include "dr_flac.h"

namespace flacspike {
namespace {

constexpr size_t PSRAM_MIN_BYTES = 16384;
constexpr size_t OUT_FRAMES = 4096;           // frames decoded per round
constexpr size_t WRITE_BLOCK = 16384;         // same block the upload path uses

void* allocFn(size_t n, void*) {
  if (n >= PSRAM_MIN_BYTES) {
    void* p = heap_caps_malloc(n, MALLOC_CAP_SPIRAM);
    if (p) return p;
  }
  return malloc(n);
}
void* reallocFn(void* p, size_t n, void*) { return realloc(p, n); }
void freeFn(void* p, void*) { free(p); }

struct Result {
  volatile bool running = false;
  volatile bool finished = false;
  char error[96] = "";
  char name[64] = "";
  uint32_t frames = 0;
  uint32_t totalFrames = 0;
  uint32_t channels = 0;
  uint32_t rate = 0;
  uint32_t flacBytes = 0;
  uint32_t wavBytes = 0;
  uint32_t ms = 0;
  uint32_t readMs = 0;     // time inside SD reads of the .flac
  uint32_t writeMs = 0;    // time inside SD writes of the .wav.part
  uint32_t heapMinInternal = 0;
  uint32_t heapFreeInternalBefore = 0;
  uint32_t heapMinPsramBefore = 0;
  uint32_t crc = 0;
} g;

uint32_t crc32Update(uint32_t crc, const uint8_t* d, size_t n) {
  crc = ~crc;
  for (size_t i = 0; i < n; ++i) {
    crc ^= d[i];
    for (int k = 0; k < 8; ++k) crc = (crc >> 1) ^ (0xEDB88320u & (-(int32_t)(crc & 1)));
  }
  return ~crc;
}

void put32(uint8_t* p, uint32_t v) { p[0] = v; p[1] = v >> 8; p[2] = v >> 16; p[3] = v >> 24; }
void put16(uint8_t* p, uint16_t v) { p[0] = v; p[1] = v >> 8; }

void header(uint8_t* h, uint32_t channels, uint32_t rate, uint32_t dataBytes) {
  memcpy(h, "RIFF", 4); put32(h + 4, 36 + dataBytes); memcpy(h + 8, "WAVEfmt ", 8);
  put32(h + 16, 16); put16(h + 20, 1); put16(h + 22, channels); put32(h + 24, rate);
  put32(h + 28, rate * channels * 2); put16(h + 32, channels * 2); put16(h + 34, 16);
  memcpy(h + 36, "data", 4); put32(h + 40, dataBytes);
}

struct Src { File f; uint32_t readMs; };

size_t onRead(void* user, void* out, size_t n) {
  Src* s = static_cast<Src*>(user);
  const uint32_t t = millis();
  const size_t got = s->f.read(static_cast<uint8_t*>(out), n);
  s->readMs += millis() - t;
  return got;
}
drflac_bool32 onSeek(void* user, int offset, drflac_seek_origin origin) {
  Src* s = static_cast<Src*>(user);
  const uint32_t base = origin == DRFLAC_SEEK_CUR ? s->f.position() : 0;
  return s->f.seek(base + offset) ? DRFLAC_TRUE : DRFLAC_FALSE;
}

drflac_bool32 onTell(void* user, drflac_int64* cursor) {
  *cursor = static_cast<Src*>(user)->f.position();
  return DRFLAC_TRUE;
}

void fail(const char* why) {
  snprintf(g.error, sizeof(g.error), "%s", why);
  g.running = false;
  g.finished = true;
}

void trackHeap() {
  const uint32_t m = heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL);
  if (g.heapMinInternal == 0 || m < g.heapMinInternal) g.heapMinInternal = m;
}

void decodeTask(void*) {
  const String in = sdstore::path(g.name);
  String outName = String(g.name);
  outName.replace(".flac", ".decoded.wav");
  const String out = sdstore::path(outName.c_str());

  Src src{SD.open(in, FILE_READ), 0};
  if (!src.f) { fail("cannot open the .flac"); vTaskDelete(nullptr); }
  g.flacBytes = src.f.size();

  drflac_allocation_callbacks cb = {nullptr, allocFn, reallocFn, freeFn};
  drflac* flac = drflac_open(onRead, onSeek, onTell, &src, &cb);
  if (!flac) { src.f.close(); fail("not a FLAC dr_flac can open"); vTaskDelete(nullptr); }
  if (flac->bitsPerSample != 16) {
    drflac_close(flac); src.f.close(); fail("only 16-bit FLAC is handled"); vTaskDelete(nullptr);
  }
  g.channels = flac->channels;
  g.rate = flac->sampleRate;
  g.totalFrames = static_cast<uint32_t>(flac->totalPCMFrameCount);
  const uint32_t dataBytes = g.totalFrames * g.channels * 2;

  if (SD.exists(out)) SD.remove(out);
  File dst = SD.open(out, FILE_WRITE);
  if (!dst) { drflac_close(flac); src.f.close(); fail("cannot create the output"); vTaskDelete(nullptr); }

  // Output staging: one write block, and a decode buffer, both 16 KB+ so PSRAM.
  uint8_t* block = static_cast<uint8_t*>(heap_caps_malloc(WRITE_BLOCK, MALLOC_CAP_SPIRAM));
  int16_t* pcm = static_cast<int16_t*>(heap_caps_malloc(OUT_FRAMES * g.channels * 2, MALLOC_CAP_SPIRAM));
  if (!block || !pcm) {
    free(block); free(pcm); drflac_close(flac); src.f.close(); dst.close(); fail("no PSRAM for buffers");
    vTaskDelete(nullptr);
  }
  size_t fill = 0;
  uint32_t writeMs = 0;
  auto flush = [&]() {
    if (!fill) return true;
    const uint32_t t = millis();
    const bool ok = dst.write(block, fill) == fill;
    writeMs += millis() - t;
    fill = 0;
    return ok;
  };

  uint8_t h[44];
  header(h, g.channels, g.rate, dataBytes);
  memcpy(block, h, 44); fill = 44;
  g.crc = 0;
  const uint32_t t0 = millis();
  bool ok = true;
  while (ok) {
    const drflac_uint64 n = drflac_read_pcm_frames_s16(flac, OUT_FRAMES, pcm);
    if (n == 0) break;
    const uint8_t* raw = reinterpret_cast<const uint8_t*>(pcm);
    size_t bytes = n * g.channels * 2;
    g.crc = crc32Update(g.crc, raw, bytes);
    g.frames += n;
    while (bytes && ok) {
      const size_t take = min(bytes, WRITE_BLOCK - fill);
      memcpy(block + fill, raw, take); fill += take; raw += take; bytes -= take;
      if (fill == WRITE_BLOCK) ok = flush();
    }
    trackHeap();
    vTaskDelay(1);   // let the Wi-Fi and the player run
  }
  if (ok) ok = flush();
  g.ms = millis() - t0;
  g.readMs = src.readMs;
  g.writeMs = writeMs;
  g.wavBytes = dst.size();
  dst.close();
  src.f.close();
  drflac_close(flac);
  free(block); free(pcm);
  trackHeap();
  if (!ok) fail("write to the SD card failed");
  else if (g.frames != g.totalFrames) fail("decoded a different number of frames than the header says");
  else { g.running = false; g.finished = true; }
  vTaskDelete(nullptr);
}

void handleStart(AsyncWebServerRequest* request) {
  if (g.running) { request->send(409, "text/plain", "already running"); return; }
  const String name = request->hasParam("name") ? request->getParam("name")->value() : String();
  char safe[cfg::TRACK_FILE_NAME_MAX_LEN + 1];
  if (trackname::sanitise(name.c_str(), safe, cfg::TRACK_FILE_NAME_MAX_LEN) != trackname::Result::Ok ||
      !String(safe).endsWith(".flac")) {
    request->send(400, "text/plain", "need ?name=<song>.flac");
    return;
  }
  g = Result();
  snprintf(g.name, sizeof(g.name), "%s", safe);
  g.running = true;
  g.heapFreeInternalBefore = heap_caps_get_free_size(MALLOC_CAP_INTERNAL);
  g.heapMinPsramBefore = heap_caps_get_free_size(MALLOC_CAP_SPIRAM);
  g.heapMinInternal = heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL);
  // Own task, 8 KB stack (dr_flac keeps its big state on the heap), low priority
  // so Wi-Fi, Bluetooth and the web server win; core 0 keeps it off AsyncTCP's core.
  xTaskCreatePinnedToCore(decodeTask, "flacspike", 8192, nullptr, 1, nullptr, 0);
  request->send(200, "text/plain", "started");
}

void handleStatus(AsyncWebServerRequest* request) {
  char buf[640];
  snprintf(buf, sizeof(buf),
           "{\"running\":%d,\"finished\":%d,\"error\":\"%s\",\"name\":\"%s\",\"frames\":%u,\"totalFrames\":%u,"
           "\"channels\":%u,\"rate\":%u,\"flacBytes\":%u,\"wavBytes\":%u,\"ms\":%u,\"readMs\":%u,\"writeMs\":%u,"
           "\"heapFreeInternalBefore\":%u,\"heapMinInternalDuring\":%u,\"psramFreeBefore\":%u,\"psramFreeNow\":%u,"
           "\"crc32\":\"%08x\"}",
           (int)g.running, (int)g.finished, g.error, g.name, g.frames, g.totalFrames, g.channels, g.rate,
           g.flacBytes, g.wavBytes, g.ms, g.readMs, g.writeMs, g.heapFreeInternalBefore, g.heapMinInternal,
           g.heapMinPsramBefore, (uint32_t)heap_caps_get_free_size(MALLOC_CAP_SPIRAM), g.crc);
  request->send(200, "application/json", buf);
}

}  // namespace

void registerRoutes(AsyncWebServer& server) {
  server.on("/api/flacspike/start", HTTP_POST, handleStart);
  server.on("/api/flacspike/status", HTTP_GET, handleStatus);
}

}  // namespace flacspike
#endif
