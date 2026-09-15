#include "web_server.h"

// ArduinoJson must be visible before ESPAsyncWebServer: the server only
// compiles its JSON handler when it can see ArduinoJson.h, and if this include
// order is wrong the failure is "unknown type name AsyncCallbackJsonWebHandler"
// rather than anything mentioning JSON.
#include <ArduinoJson.h>
#include <AsyncJson.h>
#include <ESPAsyncWebServer.h>
#include <LittleFS.h>
#include <WiFi.h>

#include "captive_portal.h"
#include "config.h"
#include "device_key.h"
#include "playlist_store.h"
#include "playlist_validate.h"
#include "wifi_manager.h"

namespace web {
namespace {

AsyncWebServer g_server(cfg::HTTP_PORT);
AsyncCorsMiddleware g_cors;

// Three mixes that are known to exist and stream. The 49 MB .wav in the same
// bucket is deliberately left out: it is the same music, but a phone on a barn
// connection stalls on it, and a radio that appears to hang on track four is
// worse than one with three tracks.
const char kDefaultPlaylist[] = R"JSON({
  "version": 1,
  "source": "baked-in default",
  "tracks": [
    {"title":"Mango Tree World","url":"https://twgukeyoayfqldnojrkg.supabase.co/storage/v1/object/public/tracks/lakehorse/Mango%20Tree%20World/Mango%20Tree%20World%20MIX%208-18-26.mp3"},
    {"title":"Jupiter Gold","url":"https://twgukeyoayfqldnojrkg.supabase.co/storage/v1/object/public/tracks/lakehorse/Jupiter%20Gold/JupiterGold%204-26-26.mp3"},
    {"title":"Light","url":"https://twgukeyoayfqldnojrkg.supabase.co/storage/v1/object/public/tracks/lakehorse/Light/LAKEHORSE%20-%20Light%20Lessons%20-%2002%20Light.mp3"}
  ]
})JSON";

void sendJson(AsyncWebServerRequest* request, int code, const String& payload) {
  request->send(code, "application/json", payload);
}

void sendError(AsyncWebServerRequest* request, int code, const char* reason) {
  JsonDocument doc;
  doc["ok"] = false;
  doc["error"] = reason;
  String out;
  serializeJson(doc, out);
  sendJson(request, code, out);
}

// The pairing key is handed out only to clients on the box's own access point.
// Being on that AP means being within a few metres of the box, which is the
// proximity check this wants. Anyone on the wider barn network is refused.
bool onAccessPointSubnet(AsyncWebServerRequest* request) {
  if (request->client() == nullptr) return false;
  const IPAddress remote = request->client()->remoteIP();
  const IPAddress ap = WiFi.softAPIP();
  return remote[0] == ap[0] && remote[1] == ap[1] && remote[2] == ap[2];
}

bool authorised(AsyncWebServerRequest* request) {
  if (!request->hasHeader("X-Lakehorse-Key")) return false;
  return devkey::matches(request->header("X-Lakehorse-Key"));
}

const char* stateName(wifinet::StationState s) {
  switch (s) {
    case wifinet::StationState::Idle: return "idle";
    case wifinet::StationState::Connecting: return "connecting";
    case wifinet::StationState::Connected: return "connected";
    case wifinet::StationState::Failed: return "failed";
  }
  return "unknown";
}

void handleStatus(AsyncWebServerRequest* request) {
  JsonDocument doc;
  doc["ok"] = true;
  doc["firmware"] = cfg::FIRMWARE_VERSION;
  doc["mdns"] = String(cfg::MDNS_HOST) + ".local";
  doc["apSsid"] = cfg::AP_SSID;
  doc["apIp"] = wifinet::accessPointIp();
  doc["station"] = stateName(wifinet::stationState());
  doc["ssid"] = wifinet::stationSsid();
  doc["ip"] = wifinet::stationIp();
  doc["hasSavedNetwork"] = wifinet::hasSavedNetwork();
  // Lets the page tell a listener standing at the box from one on the network,
  // so it can explain the right thing rather than the same thing twice.
  doc["viaAccessPoint"] = onAccessPointSubnet(request);
  doc["freeHeap"] = (uint32_t)ESP.getFreeHeap();

  String out;
  serializeJson(doc, out);
  sendJson(request, 200, out);
}

void handlePair(AsyncWebServerRequest* request) {
  if (!onAccessPointSubnet(request)) {
    sendError(request, 403,
              "join the Lakehorse Radio hotspot to pair with this box");
    return;
  }
  JsonDocument doc;
  doc["ok"] = true;
  doc["key"] = devkey::value();
  String out;
  serializeJson(doc, out);
  sendJson(request, 200, out);
}

void handleGetPlaylist(AsyncWebServerRequest* request) {
  const String stored = playlist::load();
  if (stored.length() == 0) {
    request->send(200, "application/json", kDefaultPlaylist);
    return;
  }
  sendJson(request, 200, stored);
}

void handleScan(AsyncWebServerRequest* request) {
  JsonDocument doc;
  const int16_t result = WiFi.scanComplete();

  if (result == WIFI_SCAN_RUNNING) {
    doc["scanning"] = true;
  } else if (result == WIFI_SCAN_FAILED) {
    // Nothing has been started yet, or the last one failed. Kick off an async
    // scan and tell the caller to come back; a blocking scan here would stall
    // the whole async server for several seconds.
    WiFi.scanNetworks(/*async=*/true);
    doc["scanning"] = true;
  } else {
    doc["scanning"] = false;
    JsonArray nets = doc["networks"].to<JsonArray>();
    for (int16_t i = 0; i < result; ++i) {
      JsonObject n = nets.add<JsonObject>();
      n["ssid"] = WiFi.SSID(i);
      n["rssi"] = WiFi.RSSI(i);
      n["open"] = WiFi.encryptionType(i) == WIFI_AUTH_OPEN;
    }
    WiFi.scanDelete();
  }

  String out;
  serializeJson(doc, out);
  sendJson(request, 200, out);
}

void registerPlaylistWrite() {
  auto* handler = new AsyncCallbackJsonWebHandler(
      "/api/playlist", [](AsyncWebServerRequest* request, JsonVariant& json) {
        if (!authorised(request)) {
          sendError(request, 401, "missing or wrong X-Lakehorse-Key");
          return;
        }

        JsonDocument doc;
        doc.set(json);

        const playlist::Result verdict = playlist::validate(doc);
        if (verdict != playlist::Result::Ok) {
          sendError(request, 400, playlist::describe(verdict));
          return;
        }

        // Re-serialise rather than storing the raw body: what lands on flash is
        // then guaranteed to be something we parsed and accepted, not whatever
        // arrived on the wire.
        String normalised;
        serializeJson(doc, normalised);

        if (normalised.length() > cfg::PLAYLIST_MAX_BYTES) {
          sendError(request, 413, "playlist too large");
          return;
        }
        if (!playlist::store(normalised)) {
          sendError(request, 500, "could not write the playlist to flash");
          return;
        }

        JsonDocument reply;
        reply["ok"] = true;
        reply["tracks"] = doc["tracks"].as<JsonArrayConst>().size();
        String out;
        serializeJson(reply, out);
        sendJson(request, 200, out);
      });
  handler->setMethod(HTTP_POST);
  handler->setMaxContentLength(cfg::PLAYLIST_MAX_BYTES);
  g_server.addHandler(handler);
}

void registerWifiWrite() {
  auto* handler = new AsyncCallbackJsonWebHandler(
      "/api/wifi", [](AsyncWebServerRequest* request, JsonVariant& json) {
        // Provisioning is allowed from the access point without a key: a box
        // that has never been set up cannot have handed one out yet, and being
        // on its AP already means standing next to it. From anywhere else a
        // key is required, so nobody on the barn network can move the box.
        if (!onAccessPointSubnet(request) && !authorised(request)) {
          sendError(request, 401, "join the Lakehorse Radio hotspot to change the network");
          return;
        }

        const String ssid = json["ssid"] | "";
        const String password = json["password"] | "";
        if (ssid.length() == 0) {
          sendError(request, 400, "ssid is required");
          return;
        }

        if (!wifinet::provision(ssid, password)) {
          sendError(request, 500, "could not save the network");
          return;
        }

        // Answers "saved, trying" and never "connected". The reply has to leave
        // before the radio retunes the access point to the new network's
        // channel, which briefly drops the very phone that asked.
        JsonDocument reply;
        reply["ok"] = true;
        reply["saved"] = ssid;
        reply["note"] = "trying now, check status in a few seconds";
        String out;
        serializeJson(reply, out);
        sendJson(request, 200, out);
      });
  handler->setMethod(HTTP_POST);
  handler->setMaxContentLength(512);
  g_server.addHandler(handler);
}

}  // namespace

const char* defaultPlaylist() { return kDefaultPlaylist; }

void begin() {
  g_cors.setOrigin("*");
  g_cors.setMethods("GET, POST, OPTIONS");
  g_cors.setHeaders("Content-Type, X-Lakehorse-Key");
  // Must stay false while the origin is "*": browsers reject the combination,
  // and the symptom is a CORS error that names neither setting.
  g_cors.setAllowCredentials(false);
  g_server.addMiddleware(&g_cors);

  g_server.on("/api/status", HTTP_GET, handleStatus);
  g_server.on("/api/pair", HTTP_GET, handlePair);
  g_server.on("/api/playlist", HTTP_GET, handleGetPlaylist);
  g_server.on("/api/scan", HTTP_GET, handleScan);

  g_server.on("/api/wifi/forget", HTTP_POST, [](AsyncWebServerRequest* request) {
    if (!onAccessPointSubnet(request) && !authorised(request)) {
      sendError(request, 401, "not allowed from this network");
      return;
    }
    wifinet::forget();
    sendJson(request, 200, "{\"ok\":true}");
  });

  registerPlaylistWrite();
  registerWifiWrite();

  g_server.serveStatic("/", LittleFS, "/").setDefaultFile("index.html");

  // Last, and only last. The portal's catch-all claims everything nothing
  // above wanted, so registering it earlier would swallow the API.
  portal::attach(g_server);

  g_server.begin();
  Serial.printf("[http] listening on port %u\n", cfg::HTTP_PORT);
}

}  // namespace web
