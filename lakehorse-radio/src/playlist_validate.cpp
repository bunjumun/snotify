#include "playlist_validate.h"

#include <string.h>

#ifdef LAKEHORSE_NATIVE_TEST
// The host build has no config.h from the Arduino tree; keep the limits in one
// place by including the same header, which is plain C++ and needs no core.
#endif
#include "config.h"

namespace playlist {

const char* describe(Result r) {
  switch (r) {
    case Result::Ok: return "ok";
    case Result::NotAnObject: return "playlist must be a JSON object";
    case Result::MissingTracks: return "playlist needs a \"tracks\" array";
    case Result::TooManyTracks: return "too many tracks";
    case Result::TrackNotAnObject: return "every track must be an object";
    case Result::TitleMissingOrEmpty: return "every track needs a non-empty title";
    case Result::TitleTooLong: return "track title is too long";
    case Result::UrlMissingOrEmpty: return "every track needs a non-empty url";
    case Result::UrlTooLong: return "track url is too long";
    case Result::UrlNotHttps: return "track urls must start with https://";
  }
  return "unknown error";
}

Result validate(const JsonDocument& doc) {
  if (!doc.is<JsonObjectConst>()) return Result::NotAnObject;

  JsonArrayConst tracks = doc["tracks"].as<JsonArrayConst>();
  // An absent or non-array "tracks" is a malformed payload. An EMPTY array is
  // not: clearing the playlist is a legitimate thing to want to do.
  if (tracks.isNull()) return Result::MissingTracks;
  if (tracks.size() > cfg::PLAYLIST_MAX_TRACKS) return Result::TooManyTracks;

  for (JsonVariantConst entry : tracks) {
    if (!entry.is<JsonObjectConst>()) return Result::TrackNotAnObject;

    const char* title = entry["title"].as<const char*>();
    if (title == nullptr || title[0] == '\0') return Result::TitleMissingOrEmpty;
    if (strnlen(title, cfg::TRACK_TITLE_MAX_LEN + 1) > cfg::TRACK_TITLE_MAX_LEN) {
      return Result::TitleTooLong;
    }

    const char* url = entry["url"].as<const char*>();
    if (url == nullptr || url[0] == '\0') return Result::UrlMissingOrEmpty;
    const size_t url_len = strnlen(url, cfg::TRACK_URL_MAX_LEN + 1);
    if (url_len > cfg::TRACK_URL_MAX_LEN) return Result::UrlTooLong;

    // strncmp rather than a starts_with helper, so this stays dependency-free
    // and compiles identically on the host and the device.
    if (strncmp(url, cfg::REQUIRED_URL_PREFIX, strlen(cfg::REQUIRED_URL_PREFIX)) != 0) {
      return Result::UrlNotHttps;
    }
  }

  return Result::Ok;
}

}  // namespace playlist
