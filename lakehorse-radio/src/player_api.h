#pragma once
//
// /api/player/*: the page's remote control for box playback (box_player.h).
// Its own file so web_server.cpp stays about serving and setup.
//
//   GET  /api/player                 status
//   POST /api/player/play?name=&t=   start a stored WAV, optionally at t seconds
//   POST /api/player/pause | resume | stop
//   POST /api/player/seek?t=
//   POST /api/player/volume?v=       0..1
//
// Every command answers with the same status object as GET.
//
class AsyncWebServer;

namespace playerapi {

// Registers the routes. Must run before the static handler and the captive
// portal's catch-all, which would otherwise swallow them.
void attach(AsyncWebServer& server);

}  // namespace playerapi
