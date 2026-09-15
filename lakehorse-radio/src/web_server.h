#pragma once
//
// The HTTP surface — one AsyncWebServer serving both audiences.
//
// There is deliberately only one server on one port. The setup page and the
// player are the same site: a phone on the box's access point and a phone on
// the barn network hit identical routes, and the page decides what to show from
// /api/status rather than from which door it came in.
//
// Route order matters here and is not alphabetical. The API is registered
// first, then the static files, and the captive-portal catch-all last, because
// onNotFound only fires for requests nothing else claimed.
//
#include <Arduino.h>

namespace web {

void begin();

// The playlist served when nothing has been stored yet, or when what was
// stored turned out to be unreadable. Exposed so main() can seed storage on
// first boot rather than leaving a new box looking empty.
const char* defaultPlaylist();

}  // namespace web
