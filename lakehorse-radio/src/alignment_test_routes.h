#pragma once
// Test-firmware only (env:radio-core2-aligntest, -D LAKEHORSE_ALIGN_TEST).
// Two routes for bench verification of the alignment counter: write
// /band-tracks.json onto the card, and reset the total to zero. Never in the
// production firmware.
#ifdef LAKEHORSE_ALIGN_TEST
#include <ESPAsyncWebServer.h>
namespace aligntest {
void attach(AsyncWebServer& server);
}
#endif
