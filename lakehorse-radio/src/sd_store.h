#pragma once
//
// Music stored on the SD card — the card half of the radio.
//
// The box still never decodes audio. It only keeps files and hands them to
// whoever asks, exactly as it hands out the web player from flash; the phone
// does the playing. Files live in one folder (cfg::SD_MUSIC_DIR) so nothing
// else on the card is ever listed, served or deleted through the API.
//
// A missing or unreadable card is a normal condition, not a fault: the radio
// carries on as the streaming player it always was, and mounted() says false.
//
#include <Arduino.h>
#include <ArduinoJson.h>

namespace sdstore {

// Mounts the card, creates the music folder, and deletes any half-written
// uploads a power cut left behind. Safe to call when no card is present.
bool begin();

bool mounted();

uint64_t totalBytes();
uint64_t freeBytes();

// Adds one {name, size} object per stored track to `out`, skipping unfinished
// uploads and anything not a regular file.
void list(JsonArray out);

// `name` must already have passed trackname::sanitise.
String path(const char* name);
String partPath(const char* name);

bool exists(const char* name);
bool remove(const char* name);

// Moves a finished upload into place, replacing any file of the same name.
bool commit(const char* name);

}  // namespace sdstore
