#pragma once
//
// Small files the box lets a computer replace at the SD card root over Wi-Fi.
//
// Why this exists: band-tracks.json (the per-track band flag the alignment counter
// reads) used to need a card reader every time the song list changed, because the song
// upload only takes audio into /music and the game upload only writes under /game/.
// This is deliberately NOT a file editor: a short list of exact names in
// cfg::CARD_FILE_NAMES, a small size cap, and a content check per name, so the file that
// replaces the old one is one the box can actually read. Nothing here deletes.
//
// Pure logic, free of Arduino, so `pio test -e native` runs it (test/test_cardfiles).
// web_server.cpp does the HTTP and the card; it only calls these two checks.
//
#include <stddef.h>

namespace cardfiles {

enum class Result { Ok, NameNotAllowed, Empty, TooBig, NotJson, WrongShape };

// True only for a name on cfg::CARD_FILE_NAMES, compared exactly: no folders, no
// "..", no case folding, no trailing or leading space. nullptr is not allowed.
bool nameAllowed(const char* name);

// Checks `len` bytes at `body` against what the reader of `name` expects. For
// band-tracks.json that is {"version":1,"tracks":["Song.wav", ...]}: an object, a
// "tracks" array of non-empty strings, and "version" 1 when present. Anything else is
// refused, so a bad upload can never replace a good file. `name` must already have
// passed nameAllowed(); an allowed name with no check here is refused (NameNotAllowed).
Result validate(const char* name, const char* body, size_t len);

// The reason, in the words the upload tool prints.
const char* describe(Result r);

}  // namespace cardfiles
