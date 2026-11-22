#include "player_api.h"

// ArduinoJson before ESPAsyncWebServer; see web_server.cpp for why.
#include <ArduinoJson.h>
#include <ESPAsyncWebServer.h>

#include "box_player.h"
#include "config.h"
#include "sd_store.h"
#include "track_name.h"

namespace playerapi {
namespace {

void sendJson(AsyncWebServerRequest* request, int code, const String& payload) {
  request->send(code, "application/json", payload);
}

void sendError(AsyncWebServerRequest* request, int code, const String& reason) {
  JsonDocument doc;
  doc["ok"] = false;
  doc["error"] = reason;
  String out;
  serializeJson(doc, out);
  sendJson(request, code, out);
}

// Query value as a float, or `fallback` if absent or not a number.
float floatParam(AsyncWebServerRequest* request, const char* name, float fallback) {
  if (!request->hasParam(name)) return fallback;
  const String v = request->getParam(name)->value();
  char* end = nullptr;
  const float f = strtof(v.c_str(), &end);
  if (end == v.c_str() || !isfinite(f)) return fallback;
  return f;
}

bool endsWithWav(const char* name) {
  const size_t n = strlen(name);
  return n > 4 && strcasecmp(name + n - 4, ".wav") == 0;
}

void handleStatus(AsyncWebServerRequest* request) {
  const boxplayer::Status s = boxplayer::status();
  JsonDocument doc;
  doc["ok"] = true;
  doc["built"] = s.built;
  doc["speaker"] = s.speaker;
  doc["connected"] = s.connected;
  doc["state"] = boxplayer::stateName(s.state);
  doc["track"] = s.track;
  doc["position"] = s.position;
  doc["duration"] = s.duration;
  doc["volume"] = s.volume;
  // A counter rather than a flag, so a page polling once a second cannot miss
  // the end of a song or see the same end twice.
  doc["ended"] = s.ended;
  doc["underruns"] = s.underruns;
  doc["error"] = s.error;
  String out;
  serializeJson(doc, out);
  sendJson(request, 200, out);
}

void handlePlay(AsyncWebServerRequest* request) {
  if (!request->hasParam("name")) {
    sendError(request, 400, "name is required");
    return;
  }
  // Same rule as delete: only a name that survives sanitise() unchanged is one
  // this box could have stored, so nothing else reaches the filesystem.
  const String wanted = request->getParam("name")->value();
  char safe[cfg::TRACK_FILE_NAME_MAX_LEN + 1];
  if (trackname::sanitise(wanted.c_str(), safe, cfg::TRACK_FILE_NAME_MAX_LEN) !=
          trackname::Result::Ok ||
      wanted != safe) {
    sendError(request, 400, "that is not a stored track name");
    return;
  }
  if (!endsWithWav(safe)) {
    sendError(request, 415, "the box plays WAV files only");
    return;
  }
  if (!sdstore::exists(safe)) {
    sendError(request, 404, "no such track");
    return;
  }
  const String err = boxplayer::play(safe, floatParam(request, "t", 0.0f));
  if (err.length()) {
    sendError(request, 422, err);
    return;
  }
  handleStatus(request);
}

// Wraps a no-argument command so each route answers with fresh status.
template <void (*Fn)()>
void simple(AsyncWebServerRequest* request) {
  Fn();
  handleStatus(request);
}

void handleSeek(AsyncWebServerRequest* request) {
  if (!request->hasParam("t")) {
    sendError(request, 400, "t is required");
    return;
  }
  boxplayer::seek(floatParam(request, "t", 0.0f));
  handleStatus(request);
}

void handleVolume(AsyncWebServerRequest* request) {
  if (!request->hasParam("v")) {
    sendError(request, 400, "v is required");
    return;
  }
  boxplayer::setVolume(floatParam(request, "v", 1.0f));
  handleStatus(request);
}

}  // namespace

void attach(AsyncWebServer& server) {
  // Commands are POST so a link preview or prefetch can never start a song.
  // No pairing key: anyone who can reach the page can already play the music
  // on their phone, and the box speaker is the same music in the same room.
  server.on("/api/player", HTTP_GET, handleStatus);
  server.on("/api/player/play", HTTP_POST, handlePlay);
  server.on("/api/player/pause", HTTP_POST, simple<boxplayer::pause>);
  server.on("/api/player/resume", HTTP_POST, simple<boxplayer::resume>);
  server.on("/api/player/stop", HTTP_POST, simple<boxplayer::stop>);
  server.on("/api/player/seek", HTTP_POST, handleSeek);
  server.on("/api/player/volume", HTTP_POST, handleVolume);
}

}  // namespace playerapi
