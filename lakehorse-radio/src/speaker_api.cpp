#include "speaker_api.h"

// ArduinoJson before ESPAsyncWebServer; see web_server.cpp for why.
#include <ArduinoJson.h>
#include <ESPAsyncWebServer.h>

#include "box_player.h"
#include "bt_speaker.h"

namespace speakerapi {
namespace {

void sendInfo(AsyncWebServerRequest* request, const String& error = String()) {
  const btspeaker::Info i = btspeaker::info();
  JsonDocument doc;
  doc["ok"] = error.length() == 0;
  if (error.length()) doc["error"] = error;
  doc["built"] = i.built;
  doc["bluetooth"] = i.on;
  doc["connected"] = i.connected;
  doc["scanning"] = i.scanning;
  doc["searching"] = i.searching;
  doc["speaker"] = i.speaker;
  JsonArray found = doc["found"].to<JsonArray>();
  for (const btspeaker::Found& f : i.found) {
    JsonObject o = found.add<JsonObject>();
    o["name"] = f.name;
    o["rssi"] = f.rssi;
  }
  String out;
  serializeJson(doc, out);
  request->send(error.length() ? 400 : 200, "application/json", out);
}

void handleInfo(AsyncWebServerRequest* request) { sendInfo(request); }

void handleScan(AsyncWebServerRequest* request) {
  btspeaker::scan();
  sendInfo(request);
}

void handleChoose(AsyncWebServerRequest* request) {
  if (!request->hasParam("name")) {
    sendInfo(request, "name is required");
    return;
  }
  // The song would carry on into silence while the link moves; pause it so
  // the listener resumes it on the new speaker.
  boxplayer::pause();
  sendInfo(request, btspeaker::choose(request->getParam("name")->value()));
}

void handleConnect(AsyncWebServerRequest* request) {
  btspeaker::connect();
  sendInfo(request);
}

void handleDisconnect(AsyncWebServerRequest* request) {
  boxplayer::pause();
  btspeaker::disconnect();
  sendInfo(request);
}

void handleBluetooth(AsyncWebServerRequest* request) {
  if (!request->hasParam("on")) {
    sendInfo(request, "on is required");
    return;
  }
  const String v = request->getParam("on")->value();
  if (v != "0" && v != "1") {
    sendInfo(request, "on must be 0 or 1");
    return;
  }
  boxplayer::stop();
  sendInfo(request, btspeaker::setEnabled(v == "1"));
}

}  // namespace

void attach(AsyncWebServer& server) {
  // POST for every change, as with /api/player, so a prefetch cannot act.
  server.on("/api/speaker", HTTP_GET, handleInfo);
  server.on("/api/speaker/scan", HTTP_POST, handleScan);
  server.on("/api/speaker/choose", HTTP_POST, handleChoose);
  server.on("/api/speaker/connect", HTTP_POST, handleConnect);
  server.on("/api/speaker/disconnect", HTTP_POST, handleDisconnect);
  server.on("/api/speaker/bluetooth", HTTP_POST, handleBluetooth);
}

}  // namespace speakerapi
