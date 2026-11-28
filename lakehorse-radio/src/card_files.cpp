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

// guestbook.json: {"v":1,"entries":[E...],"trash":[E...]}, E = {"id":int,"h":handle,
// "m":message,"t":seconds,"k":owner-hash}. Only the shape and the sizes are checked;
// who may edit what is the page's business (it is an honour-system guest book).
bool guestEntryOk(JsonVariantConst v) {
  if (!v.is<JsonObjectConst>()) return false;
  if (!v["id"].is<int>() || v["id"].as<long>() < 0) return false;
  if (!v["t"].is<long>() || v["t"].as<long>() < 0) return false;
  const char* h = v["h"].is<const char*>() ? v["h"].as<const char*>() : nullptr;
  const char* m = v["m"].is<const char*>() ? v["m"].as<const char*>() : nullptr;
  const char* k = v["k"].is<const char*>() ? v["k"].as<const char*>() : nullptr;
  if (h == nullptr || h[0] == '\0' || strlen(h) > cfg::GUESTBOOK_HANDLE_MAX) return false;
  if (m == nullptr || m[0] == '\0' || strlen(m) > cfg::GUESTBOOK_MESSAGE_MAX) return false;
  if (!v["i"].isNull() && !v["i"].is<int>()) return false;
  return k != nullptr && k[0] != '\0' && strlen(k) <= 16;
}

Result validateGuestbook(const char* body, size_t len) {
  JsonDocument doc;
  if (deserializeJson(doc, body, len)) return Result::NotJson;
  if (!doc.is<JsonObjectConst>()) return Result::WrongShape;
  JsonVariantConst version = doc["v"];
  if (!version.isNull() && !(version.is<int>() && version.as<int>() == 1)) return Result::WrongShape;
  if (!doc["entries"].is<JsonArrayConst>() || !doc["trash"].is<JsonArrayConst>()) return Result::WrongShape;
  size_t count = 0;
  for (const char* key : {"entries", "trash"}) {
    for (JsonVariantConst e : doc[key].as<JsonArrayConst>()) {
      if (++count > cfg::GUESTBOOK_MAX_ENTRIES || !guestEntryOk(e)) return Result::WrongShape;
    }
  }
  return Result::Ok;
}

// "gbimg-<1 to 6 digits>.jpg": the one picture a guest book entry may carry.
bool isGuestImageName(const char* name) {
  if (name == nullptr || strncmp(name, "gbimg-", 6) != 0) return false;
  size_t i = 6, digits = 0;
  while (name[i] >= '0' && name[i] <= '9') { ++i; ++digits; }
  return digits >= 1 && digits <= 6 && strcmp(name + i, ".jpg") == 0;
}

Result validateGuestImage(const char* body, size_t len) {
  if (len > cfg::GUESTBOOK_IMAGE_MAX_BYTES) return Result::TooBig;
  const unsigned char* b = reinterpret_cast<const unsigned char*>(body);
  if (len < 4 || b[0] != 0xFF || b[1] != 0xD8 || b[2] != 0xFF) return Result::WrongShape;
  return Result::Ok;
}

}  // namespace

bool nameAllowed(const char* name) {
  if (name == nullptr) return false;
  if (isGuestImageName(name)) return true;
  for (const char* allowed : cfg::CARD_FILE_NAMES) {
    if (strcmp(name, allowed) == 0) return true;
  }
  return false;
}

Result validate(const char* name, const char* body, size_t len) {
  if (!nameAllowed(name)) return Result::NameNotAllowed;
  if (body == nullptr || len == 0) return Result::Empty;
  if (len > cfg::CARD_FILE_MAX_BYTES) return Result::TooBig;
  if (strcmp(name, "band-tracks.json") == 0) {
    return len > cfg::BAND_FILE_MAX_BYTES ? Result::TooBig : validateBandTracks(body, len);
  }
  if (isGuestImageName(name)) return validateGuestImage(body, len);
  if (strcmp(name, "guestbook.json") == 0) return validateGuestbook(body, len);
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
