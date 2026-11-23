#include "alignment_box.h"

#include <Preferences.h>
#include <SD.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>

#include "sd_store.h"

namespace alignment {
namespace {

const char* const kNvsNamespace = "lh_align";
const char* const kKeyPoints = "pts";  // uint16
const char* const kKeyLevels = "lvl";  // uint32
const char* const kBandListPath = "/band-tracks.json";
// A list of a few dozen songs is under 2 KB. Anything bigger is not one of ours.
const size_t kBandListMaxBytes = 4096;

class NvsStorage : public Storage {
 public:
  bool load(uint16_t& points, uint32_t& levels) override {
    Preferences prefs;
    if (!prefs.begin(kNvsNamespace, true)) return false;  // never saved yet
    points = prefs.getUShort(kKeyPoints, 0);
    levels = prefs.getUInt(kKeyLevels, 0);
    prefs.end();
    return true;
  }
  bool save(uint16_t points, uint32_t levels) override {
    Preferences prefs;
    if (!prefs.begin(kNvsNamespace, false)) {
      Serial.println(F("[align] could not open the save"));
      return false;
    }
    // Preferences skips the flash write when a value is unchanged.
    const size_t a = prefs.putUShort(kKeyPoints, points);
    const size_t b = prefs.putUInt(kKeyLevels, levels);
    prefs.end();
    if (a == 0 || b == 0) {
      Serial.println(F("[align] the save write failed"));
      return false;
    }
    return true;
  }
};

NvsStorage g_storage;
Counter g_counter;
SemaphoreHandle_t g_mutex = nullptr;

class Guard {
 public:
  Guard() { xSemaphoreTake(g_mutex, portMAX_DELAY); }
  ~Guard() { xSemaphoreGive(g_mutex); }
};

// Reads /band-tracks.json fresh each time (a few hundred bytes, only after a
// track has passed the half). No card, no file, too large or malformed all mean
// "not flagged".
bool isBandTrack(const char* name) {
  if (!sdstore::mounted()) return false;
  File f = SD.open(kBandListPath, FILE_READ);
  if (!f) return false;
  const size_t size = f.size();
  if (f.isDirectory() || size == 0 || size > kBandListMaxBytes) {
    f.close();
    return false;
  }
  char* buf = static_cast<char*>(malloc(size));
  if (!buf) {
    f.close();
    return false;
  }
  const size_t got = f.read(reinterpret_cast<uint8_t*>(buf), size);
  f.close();
  const bool hit = got == size && bandListContains(buf, size, name);
  free(buf);
  return hit;
}

const char* resultName(Result r) {
  switch (r) {
    case Result::Full: return "full";
    case Result::Partial: return "partial";
    case Result::Clear: return "clear";
    case Result::Attempt: return "attempt";
  }
  return "?";
}

}  // namespace

void begin() {
  if (g_mutex) return;
  g_mutex = xSemaphoreCreateMutex();
  if (!g_mutex) {
    Serial.println(F("[align] no mutex; alignment is off"));
    return;
  }
  Guard guard;
  g_counter.begin(&g_storage);
  Serial.printf("[align] %u points (%u%%), levels 0x%08x\n", (unsigned)g_counter.points(),
                (unsigned)g_counter.percent(), (unsigned)g_counter.levelsCleared());
}

void onTrackLeft(const char* name, float fraction, bool reachedEnd) {
  if (!g_mutex || !name || !name[0]) return;
  Result result;
  if (!resultForLeaving(fraction, reachedEnd, result)) return;
  if (!isBandTrack(name)) {
    Serial.printf("[align] \"%s\" is not a band track, no credit\n", name);
    return;
  }
  Guard guard;
  const EventResult r = g_counter.submit(Source::Song, name, result, millis());
  Serial.printf("[align] \"%s\" %s at %.0f%%: +%u, total %u (stack spare %u)\n", name,
                resultName(result), fraction * 100.0f, (unsigned)r.added, (unsigned)r.total,
                (unsigned)uxTaskGetStackHighWaterMark(nullptr));
}

Snapshot snapshot() {
  if (!g_mutex) return {0, 0, 0};
  Guard guard;
  return {g_counter.points(), g_counter.nodes(), g_counter.percent()};
}

EventResult submitEvent(Source source, const char* id, Result result) {
  if (!g_mutex) return {Outcome::Invalid, 0, 0};
  Guard guard;
  return g_counter.submit(source, id, result, millis());
}

#ifdef LAKEHORSE_ALIGN_TEST
void testReset() {
  if (!g_mutex) return;
  Guard guard;
  Preferences prefs;
  if (prefs.begin(kNvsNamespace, false)) {
    prefs.putUShort(kKeyPoints, 0);
    prefs.putUInt(kKeyLevels, 0);
    prefs.end();
  }
  g_counter.begin(&g_storage);
}

bool testWriteBandList(const char* json, size_t length) {
  if (!sdstore::mounted() || length == 0 || length > kBandListMaxBytes) return false;
  SD.remove(kBandListPath);
  File f = SD.open(kBandListPath, FILE_WRITE);
  if (!f) return false;
  const size_t n = f.write(reinterpret_cast<const uint8_t*>(json), length);
  f.close();
  return n == length;
}
#endif

}  // namespace alignment
