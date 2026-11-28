#pragma once
// SPIKE (2026-11-27, docs/upload-plan-2026-11-27.md Phase B): measures whether
// the box can turn a 16-bit FLAC on the SD card into the WAV it came from, with
// Wi-Fi and Bluetooth up, and how much internal heap that costs. Compiled only
// into env:radio-core2-flacspike; never part of the shipping firmware.
#ifdef LAKEHORSE_FLAC_SPIKE
class AsyncWebServer;
namespace flacspike {
void registerRoutes(AsyncWebServer& server);
}
#endif
