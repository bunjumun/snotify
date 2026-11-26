#pragma once
//
// Box-side glue for the alignment counter (alignment.h): the NVS save, the
// band-tracks.json check on the SD card, and one mutex around the counter.
//
// Callers: box_player.cpp (song events, from the reader task and the web
// server's task) and web_server.cpp (the event endpoint, phone-mode songs and
// levels). Every entry point takes the same mutex, so the counter is only ever
// touched by one task at a time.
//
#include <Arduino.h>

#include "alignment.h"

namespace alignment {

// Opens the save. Safe to call once, early (after NVS is up). Until it has run
// every call below does nothing.
void begin();

// A song the box was playing has been left. `name` is its file name on the
// card, `fraction` the share played since the last seek (0..1), `reachedEnd`
// true only when it ran out. Credits nothing for a track not listed in
// /band-tracks.json, or one that never played half. Cheap when it credits
// nothing: the card is only read once the half has been passed.
void onTrackLeft(const char* name, float fraction, bool reachedEnd);

struct Snapshot {
  uint16_t points;
  uint16_t nodes;
  uint8_t percent;
};
Snapshot snapshot();

// True when `name` (a file name on the card) is listed in /band-tracks.json.
// The event endpoint uses it for songs the page played from the card.
bool isBandSong(const char* name);

// For the event endpoint. `id` for a song is not checked here; the endpoint
// has already matched it to the playlist.
EventResult submitEvent(Source source, const char* id, Result result);

#ifdef LAKEHORSE_ALIGN_TEST
// Test-firmware only (env:radio-core2-aligntest). Not compiled otherwise.
void testReset();
bool testWriteBandList(const char* json, size_t length);
#endif

}  // namespace alignment
