#include "card_files.h"

#include <ArduinoJson.h>
#include <string.h>

#include "config.h"

namespace cardfiles {
namespace {

Result validateBandTracks(const char* body, size_t len) {
  JsonDocument doc;
  if (deserializeJson(doc, body, len)) return Result::NotJson;
  if (!doc.is<JsonObjectConst>()) return Result::WrongShape;

  // "version" is optional for the reader but, when given, only 1 is a format this
  // firmware knows.
  JsonVariantConst version = doc["version"];
  if (!version.isNull() && !(version.is<int>() && version.as<int>() == 1)) {
    return Result::WrongShape;
  }

  if (!doc["tracks"].is<JsonArrayConst>()) return Result::WrongShape;
  for (JsonVariantConst t : doc["tracks"].as<JsonArrayConst>()) {
    const char* s = t.is<const char*>() ? t.as<const char*>() : nullptr;
    if (s == nullptr || s[0] == '\0') return Result::WrongShape;
  }
  return Result::Ok;
}

}  // namespace

bool nameAllowed(const char* name) {
  if (name == nullptr) return false;
  for (const char* allowed : cfg::CARD_FILE_NAMES) {
    if (strcmp(name, allowed) == 0) return true;
  }
  return false;
}

Result validate(const char* name, const char* body, size_t len) {
  if (!nameAllowed(name)) return Result::NameNotAllowed;
  if (body == nullptr || len == 0) return Result::Empty;
  if (len > cfg::CARD_FILE_MAX_BYTES) return Result::TooBig;
  if (strcmp(name, "band-tracks.json") == 0) return validateBandTracks(body, len);
  return Result::NameNotAllowed;  // allowed by name but nothing here knows how to check it
}

const char* describe(Result r) {
  switch (r) {
    case Result::Ok: return "ok";
    case Result::NameNotAllowed: return "that file name is not one the box accepts";
    case Result::Empty: return "the file is empty";
    case Result::TooBig: return "the file is too big";
    case Result::NotJson: return "the file is not valid JSON";
    case Result::WrongShape: return "the file is not in the format the box reads";
  }
  return "refused";
}

}  // namespace cardfiles
