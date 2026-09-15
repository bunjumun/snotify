#pragma once
//
// Playlist validation — the one piece of this firmware that is pure logic.
//
// It is split out from playlist_store deliberately. Storage touches LittleFS
// and can only run on the device; validation touches nothing but a JSON
// document, so it compiles and runs on a laptop under `pio test -e native`.
// That split is what makes the boundary checks actually testable rather than
// something we claim works because the board did not crash.
//
// Everything here treats its input as hostile. A playlist arrives over the
// network from anyone who can reach the box.
//
#include <ArduinoJson.h>
#include <stddef.h>

namespace playlist {

enum class Result {
  Ok,
  NotAnObject,
  MissingTracks,
  TooManyTracks,
  TrackNotAnObject,
  TitleMissingOrEmpty,
  TitleTooLong,
  UrlMissingOrEmpty,
  UrlTooLong,
  UrlNotHttps,
};

// A human-readable reason, returned to the caller of POST /api/playlist so a
// rejected push says what was wrong instead of just failing.
const char* describe(Result r);

// Validates a parsed playlist document in place. Does not modify it.
Result validate(const JsonDocument& doc);

}  // namespace playlist
