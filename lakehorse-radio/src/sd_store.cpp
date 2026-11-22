#include "sd_store.h"

#include <SD.h>
#include <SPI.h>
#include <string.h>

#include "config.h"
#include "track_name.h"
#include "track_order.h"

namespace sdstore {
namespace {

bool g_mounted = false;

bool endsWithPart(const String& name) { return name.endsWith(cfg::SD_PART_SUFFIX); }

// The File API reports names with or without the directory depending on the
// core version; keep only the last path component either way.
String baseName(const char* full) {
  String s(full);
  const int slash = s.lastIndexOf('/');
  return slash >= 0 ? s.substring(slash + 1) : s;
}

void removeLeftovers() {
  File dir = SD.open(cfg::SD_MUSIC_DIR);
  if (!dir) return;
  // Collect first, delete after: removing while iterating a FAT directory can
  // skip entries.
  String doomed[8];
  size_t count = 0;
  for (File f = dir.openNextFile(); f && count < 8; f = dir.openNextFile()) {
    const String name = baseName(f.name());
    if (!f.isDirectory() && endsWithPart(name)) doomed[count++] = name;
  }
  dir.close();
  for (size_t i = 0; i < count; ++i) {
    SD.remove(String(cfg::SD_MUSIC_DIR) + "/" + doomed[i]);
    Serial.printf("[sd] removed unfinished upload %s\n", doomed[i].c_str());
  }
}

// Lists only what /sd/ will actually serve: a name that passes the track rules
// unchanged. A Mac writing to a FAT card leaves a "._Song.wav" beside every
// song (its resource fork), and a stray bench.tmp or notes.txt can turn up too;
// listed, each would be a track that silently refuses to play.
bool servable(const String& name) {
  char safe[cfg::TRACK_FILE_NAME_MAX_LEN + 1];
  return trackname::sanitise(name.c_str(), safe, cfg::TRACK_FILE_NAME_MAX_LEN) ==
             trackname::Result::Ok &&
         name == safe;
}

}  // namespace

bool begin() {
  SPI.begin(cfg::SD_PIN_SCK, cfg::SD_PIN_MISO, cfg::SD_PIN_MOSI, cfg::SD_PIN_CS);
  if (!SD.begin(cfg::SD_PIN_CS, SPI, cfg::SD_SPI_HZ)) {
    Serial.println(F("[sd] no card, continuing as a streaming-only radio"));
    g_mounted = false;
    return false;
  }
  if (!SD.exists(cfg::SD_MUSIC_DIR) && !SD.mkdir(cfg::SD_MUSIC_DIR)) {
    Serial.println(F("[sd] could not create the music folder"));
    g_mounted = false;
    return false;
  }
  g_mounted = true;
  removeLeftovers();
  Serial.printf("[sd] mounted, %llu MB free\n", freeBytes() / (1024ULL * 1024ULL));
  return true;
}

bool mounted() { return g_mounted; }

uint64_t totalBytes() { return g_mounted ? SD.totalBytes() : 0; }

uint64_t freeBytes() {
  if (!g_mounted) return 0;
  const uint64_t total = SD.totalBytes();
  const uint64_t used = SD.usedBytes();
  return used >= total ? 0 : total - used;
}

void list(JsonArray out) {
  if (!g_mounted) return;
  File dir = SD.open(cfg::SD_MUSIC_DIR);
  if (!dir) return;
  size_t count = 0;
  for (File f = dir.openNextFile(); f && count < cfg::SD_LIST_MAX_FILES;
       f = dir.openNextFile()) {
    const String name = baseName(f.name());
    if (f.isDirectory() || endsWithPart(name) || !servable(name)) continue;
    JsonObject o = out.add<JsonObject>();
    o["name"] = name;
    o["size"] = (uint32_t)f.size();
    ++count;
  }
  dir.close();
}

String nextAfter(const char* name) {
  if (!g_mounted) return "";
  File dir = SD.open(cfg::SD_MUSIC_DIR);
  if (!dir) return "";
  String best;
  for (File f = dir.openNextFile(); f; f = dir.openNextFile()) {
    const String n = baseName(f.name());
    if (f.isDirectory() || endsWithPart(n) || !servable(n)) continue;
    if (!n.endsWith(".wav") && !n.endsWith(".WAV")) continue;
    if (!trackorder::before(name, n.c_str())) continue;
    if (!best.length() || trackorder::before(n.c_str(), best.c_str())) best = n;
  }
  dir.close();
  return best;
}

String path(const char* name) { return String(cfg::SD_MUSIC_DIR) + "/" + name; }

String partPath(const char* name) { return path(name) + cfg::SD_PART_SUFFIX; }

bool exists(const char* name) { return g_mounted && SD.exists(path(name)); }

bool remove(const char* name) { return g_mounted && SD.remove(path(name)); }

bool commit(const char* name) {
  if (!g_mounted) return false;
  const String final = path(name);
  // FAT rename refuses to overwrite, and a re-upload of the same name is a
  // legitimate way to replace a track.
  if (SD.exists(final) && !SD.remove(final)) return false;
  return SD.rename(partPath(name), final);
}

}  // namespace sdstore
