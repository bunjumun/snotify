#pragma once
//
// FLAC to WAV on the card.
//
// The page sends a song as 16-bit FLAC (about two thirds of the WAV's size, so
// a shorter trip over this slow Wi-Fi) and the box turns it back into the exact
// WAV it came from. One background job at a time, low priority, so Wi-Fi and
// the player keep running; measured at 1.65x realtime on this card (the SD
// card, not the CPU, is the limit). See docs/upload-plan-2026-11-27.md.
//
class AsyncWebServer;

namespace flacconv {

// Boot recovery: a .flac left on the card (power cut mid-convert, or the page
// closed before it asked) is converted a few seconds after start-up.
void begin();

// Starts the job unless one is running (it then picks up new files itself).
// False when there is no card.
bool start();

// Registers GET /api/sd/convert-status. The start route lives in web_server.cpp
// beside the other key-checked SD routes.
void registerRoutes(AsyncWebServer& server);

}  // namespace flacconv
