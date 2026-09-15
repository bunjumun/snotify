#include "playlist_store.h"

#include <LittleFS.h>

#include "config.h"

namespace playlist {

bool beginStorage() {
  if (LittleFS.begin(/*formatOnFail=*/true)) {
    // Report the mount positively, with numbers. Logging only on failure means
    // a healthy boot and a boot where this was never reached look identical in
    // the log, and "no error appeared" is not evidence that it worked.
    Serial.printf("[fs] LittleFS mounted, %u of %u bytes used\n",
                  (unsigned)LittleFS.usedBytes(), (unsigned)LittleFS.totalBytes());
    if (!LittleFS.exists(cfg::PLAYLIST_PATH)) {
      Serial.println(F("[fs] no stored playlist, the baked-in default will be served"));
    }
    return true;
  }
  // A second failure after a format attempt means the flash itself is not
  // answering. Say so loudly: every other symptom of this looks like an empty
  // playlist, which is exactly the kind of silent wrong answer to avoid.
  Serial.println(F("[fs] LittleFS would not mount, even after formatting"));
  return false;
}

bool store(const String& body) {
  File tmp = LittleFS.open(cfg::PLAYLIST_TMP_PATH, FILE_WRITE);
  if (!tmp) {
    Serial.println(F("[fs] could not open the temporary playlist for writing"));
    return false;
  }

  const size_t written = tmp.print(body);
  tmp.close();

  if (written != body.length()) {
    Serial.printf("[fs] short write: %u of %u bytes\n",
                  (unsigned)written, (unsigned)body.length());
    LittleFS.remove(cfg::PLAYLIST_TMP_PATH);
    return false;
  }

  // Rename is not guaranteed to replace an existing file on every LittleFS
  // build, so remove the old one first. The window between these two calls is
  // the only moment a power cut loses the playlist, and the baked-in default
  // covers that case.
  LittleFS.remove(cfg::PLAYLIST_PATH);
  if (!LittleFS.rename(cfg::PLAYLIST_TMP_PATH, cfg::PLAYLIST_PATH)) {
    Serial.println(F("[fs] rename of the temporary playlist failed"));
    return false;
  }

  return true;
}

String load() {
  if (!LittleFS.exists(cfg::PLAYLIST_PATH)) return String();

  File f = LittleFS.open(cfg::PLAYLIST_PATH, FILE_READ);
  if (!f) return String();

  // Refuse to read back something larger than we would ever have accepted.
  // A corrupt length here would otherwise try to allocate the heap away.
  if (f.size() > cfg::PLAYLIST_MAX_BYTES) {
    Serial.printf("[fs] stored playlist is implausibly large (%u bytes), ignoring\n",
                  (unsigned)f.size());
    f.close();
    return String();
  }

  String out = f.readString();
  f.close();
  return out;
}

}  // namespace playlist
