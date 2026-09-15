#pragma once
//
// Playlist storage — the LittleFS half, kept apart from validation so the
// validation can be tested on a laptop.
//
// The ordering here is the whole point. A playlist push writes to a temporary
// file, flushes it, and only then renames it over the live one. A power cut at
// any moment therefore leaves either the old playlist or the new one, never a
// half-written file that parses as empty and makes the radio look broken.
//
#include <Arduino.h>

namespace playlist {

// Mounts LittleFS, formatting it if the mount fails. A format-on-fail is right
// for this device: the filesystem holds only the web player and a playlist,
// both of which are reflashed from the build, so there is nothing here worth
// preserving at the cost of an unbootable box.
bool beginStorage();

// Replaces the stored playlist. `body` is the raw request payload and is
// assumed to have been validated already. Returns false if the write or the
// rename failed, having left the previous playlist in place.
bool store(const String& body);

// Reads the stored playlist. Returns an empty string if there is not a
// readable one, which the caller should treat as "serve the baked-in default".
String load();

}  // namespace playlist
