#pragma once
//
// /api/speaker/*: the page's Bluetooth controls (bt_speaker.h). Apart from
// /api/player, which is the transport (play, pause, seek), because these
// change where sound goes rather than what plays.
//
//   GET  /api/speaker                 settings, link state, speakers found
//   POST /api/speaker/scan            look for speakers for a few seconds
//   POST /api/speaker/choose?name=    play to this speaker from now on
//   POST /api/speaker/connect | disconnect
//   POST /api/speaker/bluetooth?on=   0 or 1; saved, then the box restarts
//
// Every command answers with the same object as GET.
//
class AsyncWebServer;

namespace speakerapi {

// Must run before the static handler and the captive portal's catch-all.
void attach(AsyncWebServer& server);

}  // namespace speakerapi
