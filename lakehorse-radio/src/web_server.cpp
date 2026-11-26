#include "web_server.h"

// ArduinoJson must be visible before ESPAsyncWebServer: the server only
// compiles its JSON handler when it can see ArduinoJson.h, and if this include
// order is wrong the failure is "unknown type name AsyncCallbackJsonWebHandler"
// rather than anything mentioning JSON.
#include <ArduinoJson.h>
#include <AsyncJson.h>
#include <ESPAsyncWebServer.h>
#include <LittleFS.h>
#include "game_files.h"
#include <SD.h>
#include <WiFi.h>

#include <memory>
#include <new>

#include "alignment_box.h"
#ifdef LAKEHORSE_ALIGN_TEST
#include "alignment_test_routes.h"
#endif
#include "captive_portal.h"
#include "card_files.h"
#include "config.h"
#include "device_key.h"
#include "matrix_api.h"
#include "net_identity.h"
#include "bt_speaker.h"
#include "player_api.h"
#include "speaker_api.h"
#include "send_window.h"
#include "playlist_store.h"
#include "playlist_validate.h"
#include "sd_store.h"
#include "track_name.h"
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
  // Only while the hotspot is actually up. softAPIP() keeps reporting
  // 192.168.4.1 after it is torn down, and now that the box joins other
  // people's networks, a venue network on 192.168.4.x would otherwise count
  // as "standing at the box": no key needed, and the key handed out.
  if (!wifinet::isAccessPointActive()) return false;
  const IPAddress remote = request->client()->remoteIP();
  const IPAddress ap = WiFi.softAPIP();
  return remote[0] == ap[0] && remote[1] == ap[1] && remote[2] == ap[2];
}

bool authorised(AsyncWebServerRequest* request) {
  if (!request->hasHeader("X-Lakehorse-Key")) return false;
  return devkey::matches(request->header("X-Lakehorse-Key"));
}

// Who may change the box's Wi-Fi: anyone while cfg::NETWORK_CHANGES_NEED_KEY is
// off, otherwise someone on the box's hotspot or holding the pairing key.
bool mayChangeNetwork(AsyncWebServerRequest* request) {
  return !cfg::NETWORK_CHANGES_NEED_KEY || onAccessPointSubnet(request) || authorised(request);
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
  doc["mdns"] = netid::hostname() + ".local";
  doc["hostname"] = netid::hostname();
  doc["apSsid"] = cfg::AP_SSID;
  doc["apIp"] = wifinet::accessPointIp();
  // The bug that started this rewrite was a station and an access point
  // silently sitting on different channels, with nothing anywhere to show it.
  // Both channels ride in the same response so a mismatch is something the
  // page can display, not something only a serial log can catch.
  doc["apChannel"] = wifinet::accessPointChannel();
  // Hosting its own hotspot is a deliberate state, not a failed join.
  const bool hosting = wifinet::inHostMode();
  doc["station"] = hosting ? "idle" : stateName(wifinet::stationState());
  doc["ssid"] = hosting ? String() : wifinet::stationSsid();
  doc["ip"] = wifinet::stationIp();
  doc["stationChannel"] = wifinet::stationChannel();
  doc["hasSavedNetwork"] = wifinet::hasSavedNetwork();
  doc["hostMode"] = wifinet::inHostMode();
  // Names only, never passwords: the page lists them with Use now / Forget.
  JsonArray saved = doc["saved"].to<JsonArray>();
  for (const String& name : wifinet::savedNames()) saved.add(name);
  // This boot skipped Bluetooth so the hotspot can serve setup (setup_boot.h).
  doc["setupBoot"] = btspeaker::isSetupBoot();
  // Pairing open on any network right now (pair_window.h).
  doc["pairOpen"] = devkey::pairWindowOpen();
  doc["lastFailure"] = wifinet::lastFailureText();
  doc["lastFailureCode"] = wifinet::lastFailureReason();
  // Lets the page tell a listener standing at the box from one on the network,
  // so it can explain the right thing rather than the same thing twice.
  doc["viaAccessPoint"] = onAccessPointSubnet(request);
  doc["networkOpen"] = !cfg::NETWORK_CHANGES_NEED_KEY;  // the page offers setup to everyone
  // All three are internal RAM only on core 3.x (Esp.cpp), so they stay
  // comparable whether or not PSRAM is enabled. largestFreeBlock is the
  // biggest single allocation that can still succeed; minFreeHeap is the low
  // water mark since boot, which is what a new feature has to fit under.
  doc["freeHeap"] = (uint32_t)ESP.getFreeHeap();
  doc["largestFreeBlock"] = (uint32_t)ESP.getMaxAllocHeap();
  doc["minFreeHeap"] = (uint32_t)ESP.getMinFreeHeap();
  // External PSRAM, reported separately from the internal figures above.
  // All three read 0 when the board has none or it failed to start; the boot
  // log says which.
  doc["psramSize"] = (uint32_t)ESP.getPsramSize();
  doc["freePsram"] = (uint32_t)ESP.getFreePsram();
  doc["largestFreePsramBlock"] = (uint32_t)ESP.getMaxAllocPsram();
  doc["rssi"] = WiFi.RSSI();
  doc["sdNeedsKey"] = cfg::SD_WRITES_NEED_KEY;
  doc["sdUpload"] = cfg::SD_UPLOAD_ENABLED;
  const alignment::Snapshot align = alignment::snapshot();
  JsonObject alignObj = doc["alignment"].to<JsonObject>();
  alignObj["points"] = align.points;
  alignObj["nodes"] = align.nodes;
  alignObj["percent"] = align.percent;

  String out;
  serializeJson(doc, out);
  sendJson(request, 200, out);
}

void handlePair(AsyncWebServerRequest* request) {
  if (!onAccessPointSubnet(request) && !devkey::pairWindowOpen()) {
    sendError(request, 403,
              "hold the box's BOOT button for 3 seconds (or unplug it and plug it back in), "
              "then pair within 2 minutes");
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

// POST /api/alignment/event?source=song|level&id=...&result=full|partial|clear|attempt[&demo=1]
// Phone-mode songs and every level report here (ALIGNMENT-BRIEF.md). A song id
// is accepted only if it is a title in the playlist or a band-list file on the card; a level
// id is a number 0..31. Answers with the new total; a repeat of the same event
// inside 10 seconds is acknowledged and not counted.
void handleAlignmentEvent(AsyncWebServerRequest* request) {
  if (!request->hasParam("source") || !request->hasParam("id") || !request->hasParam("result")) {
    sendError(request, 400, "source, id and result are required");
    return;
  }
  const String src = request->getParam("source")->value();
  const String res = request->getParam("result")->value();
  const String id = request->getParam("id")->value();
  alignment::Source source;
  if (src == "song") source = alignment::Source::Song;
  else if (src == "level") source = alignment::Source::Level;
  else { sendError(request, 400, "source must be song or level"); return; }
  alignment::Result result;
  if (res == "full") result = alignment::Result::Full;
  else if (res == "partial") result = alignment::Result::Partial;
  else if (res == "clear") result = alignment::Result::Clear;
  else if (res == "attempt") result = alignment::Result::Attempt;
  else { sendError(request, 400, "result must be full, partial, clear or attempt"); return; }
  // demo=1: the autopilot played. A tenth of the credit, and a clear never ticks the level.
  if (request->hasParam("demo") && request->getParam("demo")->value() == "1") {
    if (result == alignment::Result::Clear) result = alignment::Result::DemoClear;
    else if (result == alignment::Result::Attempt) result = alignment::Result::DemoAttempt;
    else { sendError(request, 400, "demo only applies to level clear or attempt"); return; }
  }
  if (id.length() == 0 || id.length() > alignment::kMaxIdLength) {
    sendError(request, 400, "id is empty or too long");
    return;
  }
  if (source == alignment::Source::Song) {
    String playlistJson = playlist::load();
    if (playlistJson.length() == 0) playlistJson = kDefaultPlaylist;
    // A playlist title, or a file the page played from the card that is on the band list.
    if (!alignment::playlistHasTitle(playlistJson.c_str(), playlistJson.length(), id.c_str()) &&
        !alignment::isBandSong(id.c_str())) {
      sendError(request, 400, "that song is not in the playlist or on the band list");
      return;
    }
  }
  const alignment::EventResult r = alignment::submitEvent(source, id.c_str(), result);
  if (r.outcome == alignment::Outcome::Invalid) {
    sendError(request, 400, "that event does not fit (song: full or partial; level 0-31: clear or attempt)");
    return;
  }
  const alignment::Snapshot snap = alignment::snapshot();
  JsonDocument doc;
  doc["ok"] = true;
  doc["credited"] = r.outcome == alignment::Outcome::Credited;
  doc["repeat"] = r.outcome == alignment::Outcome::Repeat;
  doc["added"] = r.added;
  doc["points"] = snap.points;
  doc["nodes"] = snap.nodes;
  doc["percent"] = snap.percent;
  String out;
  serializeJson(doc, out);
  sendJson(request, 200, out);
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
    //
    // The return value matters and used to be ignored, which was a real bug:
    // the radio refuses to start a scan while it is busy associating, so after
    // the first provisioning attempt every later scan failed to start while
    // this still answered "scanning". The page then polled a scan that was
    // never going to finish, and the network list simply never appeared again.
    // Absence of a scan was being reported as a scan in progress.
    const int16_t started = WiFi.scanNetworks(/*async=*/true);
    if (started == WIFI_SCAN_FAILED) {
      doc["scanning"] = false;
      doc["error"] = "the radio is busy, type the network name instead";
      Serial.println(F("[scan] could not start, radio busy"));
    } else {
      doc["scanning"] = true;
    }
  } else {
    doc["scanning"] = false;
    JsonArray nets = doc["networks"].to<JsonArray>();
    for (int16_t i = 0; i < result; ++i) {
      JsonObject n = nets.add<JsonObject>();
      n["ssid"] = WiFi.SSID(i);
      n["rssi"] = WiFi.RSSI(i);
      n["open"] = WiFi.encryptionType(i) == WIFI_AUTH_OPEN;
      // Same reasoning as apChannel/stationChannel in handleStatus(): a
      // network's channel used to be invisible, and it is exactly the number
      // that would have shown this box's original bug before it shipped.
      n["channel"] = WiFi.channel(i);
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
        const IPAddress from = request->client() ? request->client()->remoteIP() : IPAddress();
        const bool viaAp = onAccessPointSubnet(request);
        Serial.printf("[wifi] provisioning request from %s (via AP: %s)\n",
                      from.toString().c_str(), viaAp ? "yes" : "no");

        if (!mayChangeNetwork(request)) {
          sendError(request, 401, "join the Lakehorse Radio hotspot to change the network");
          return;
        }

        const String ssid = json["ssid"] | "";
        const String password = json["password"] | "";
        if (ssid.length() == 0) {
          sendError(request, 400, "ssid is required");
          return;
        }

        // The .local name is optional and set in the same step, because that is
        // the one moment the owner is thinking about how to reach this box.
        // Validated before the network is touched, so a bad name fails loudly
        // instead of leaving the box joined but unreachable by name.
        if (json["hostname"].is<const char*>()) {
          const char* problem = netid::setHostname(json["hostname"].as<const char*>());
          if (problem != nullptr) {
            sendError(request, 400, problem);
            return;
          }
        }

        Serial.printf("[wifi] asked to join \"%s\"\n", ssid.c_str());
        if (!wifinet::provision(ssid, password)) {
          sendError(request, 400,
                    "could not save the network: check the name, and that the password "
                    "is 8 to 63 characters or empty for an open network");
          return;
        }

        // Answers "saved, trying" and never "connected". The reply has to leave
        // before the radio retunes the access point to the new network's
        // channel, which briefly drops the very phone that asked.
        JsonDocument reply;
        reply["ok"] = true;
        reply["saved"] = ssid;
        reply["note"] = "trying now, check status in a few seconds";
        reply["mdns"] = netid::hostname() + ".local";
        String out;
        serializeJson(reply, out);
        sendJson(request, 200, out);
      });
  handler->setMethod(HTTP_POST);
  handler->setMaxContentLength(512);
  g_server.addHandler(handler);
}

// ---------- Music on the SD card ----------
//
// Four routes: list, upload, delete, and serve. Serving is hand-written rather
// than serveStatic() because iOS Safari will not play an <audio> source that
// cannot answer a Range request, and this library's static handler does not.
// Without ranges the same files would play on a laptop and silently not on an
// iPhone.

struct UploadState {
  int code;
  const char* error;  // always a string literal, never freed
  bool finished;
  char name[cfg::TRACK_FILE_NAME_MAX_LEN + 1];
};

// _tempObject is free()d by the library when the request ends, so it has to be
// malloc'd, not new'd.
UploadState* uploadState(AsyncWebServerRequest* request) {
  if (request->_tempObject == nullptr) {
    request->_tempObject = calloc(1, sizeof(UploadState));
  }
  return static_cast<UploadState*>(request->_tempObject);
}

void rejectUpload(UploadState* s, int code, const char* why) {
  if (s->error != nullptr) return;  // keep the first reason, it is the cause
  s->code = code;
  s->error = why;
}

// Runs once per received chunk. The checks happen on the first chunk, because
// by then the headers are in and nothing has been written yet; later chunks of
// a rejected upload are simply dropped, since a handler cannot answer early.
// The one upload allowed at a time, cleared when its connection ends for any
// reason, so a dropped phone cannot lock everyone else out.
const AsyncWebServerRequest* g_uploadOwner = nullptr;

void handleUploadChunk(AsyncWebServerRequest* request, uint8_t* data, size_t len,
                       size_t index, size_t total) {
  UploadState* s = uploadState(request);
  if (s == nullptr) return;
  const bool final = (index + len == total);
  // The body is the raw file, not multipart: the library's multipart parser
  // walks every byte through a state machine and measured far too slow here.
  // The name rides in the query string instead.
  const String filename =
      request->hasParam("name") ? request->getParam("name")->value() : String();

  if (index == 0) {
    if (!cfg::SD_UPLOAD_ENABLED) {
      rejectUpload(s, 403, "uploading from the page is switched off in this version");
    } else if (cfg::SD_WRITES_NEED_KEY && !authorised(request)) {
      rejectUpload(s, 401, "missing or wrong X-Lakehorse-Key");
    } else if (!sdstore::mounted()) {
      rejectUpload(s, 503, "there is no SD card in the box");
    } else {
      const trackname::Result verdict =
          trackname::sanitise(filename.c_str(), s->name, cfg::TRACK_FILE_NAME_MAX_LEN);
      if (verdict != trackname::Result::Ok) {
        rejectUpload(s, 400, trackname::describe(verdict));
      } else if (request->contentLength() > sdstore::freeBytes()) {
        rejectUpload(s, 507, "not enough space left on the SD card");
      } else if (g_uploadOwner != nullptr) {
        rejectUpload(s, 503, "another upload is already in progress");
      } else {
        g_uploadOwner = request;
        request->onDisconnect([]() {
          g_uploadOwner = nullptr;
        });
        request->_tempFile = SD.open(sdstore::partPath(s->name), FILE_WRITE);
        if (!request->_tempFile) {
          rejectUpload(s, 500, "could not create the file on the SD card");
        }
      }
    }
  }

  if (s->error != nullptr || !request->_tempFile) return;

  // Writes arrive as ~1.4 KB TCP segments. Handing each straight to the card
  // costs a partial-sector write apiece, and measured about 200 KB/s with
  // uploads dropping mid-way; gathering them into whole blocks is what makes
  // the card keep up. One shared block is enough because only one upload may
  // run at a time (see g_uploadOwner).
  static uint8_t block[cfg::SD_WRITE_BLOCK_BYTES];
  static size_t fill = 0;
  if (index == 0) fill = 0;

  bool ok = true;
  size_t off = 0;
  while (ok && off < len) {
    const size_t n = min(len - off, sizeof(block) - fill);
    memcpy(block + fill, data + off, n);
    fill += n;
    off += n;
    if (fill == sizeof(block)) {
      ok = request->_tempFile.write(block, fill) == fill;
      fill = 0;
    }
  }
  if (ok && final && fill > 0) {
    ok = request->_tempFile.write(block, fill) == fill;
    fill = 0;
  }
  if (!ok) {
    Serial.printf("[sd] write failed near byte %u\n", (unsigned)index);
    request->_tempFile.close();
    SD.remove(sdstore::partPath(s->name));
    g_uploadOwner = nullptr;
    rejectUpload(s, 500, "writing to the SD card failed");
    return;
  }

  if (final) {
    request->_tempFile.close();
    if (sdstore::commit(s->name)) {
      s->finished = true;
      Serial.printf("[sd] stored %s\n", s->name);
    } else {
      rejectUpload(s, 500, "could not move the finished file into place");
    }
  }
}

void handleUploadDone(AsyncWebServerRequest* request) {
  const UploadState* s = static_cast<UploadState*>(request->_tempObject);
  if (s != nullptr && s->error != nullptr) {
    sendError(request, s->code, s->error);
    return;
  }
  if (s == nullptr || !s->finished) {
    sendError(request, 400, "no file arrived");
    return;
  }
  JsonDocument doc;
  doc["ok"] = true;
  doc["name"] = s->name;
  String out;
  serializeJson(doc, out);
  sendJson(request, 200, out);
}

// ---------- Game files onto the SD card ----------
//
// Same raw-body shape as the track upload, but the name is a relative path under
// /game/ (?path=guber-eats/index.html) checked by gamefiles::resolve, so a URL
// can never leave that folder. Exists so the game pack can be pushed over Wi-Fi
// (tools/push_game.py) instead of pulling the card. Shares g_uploadOwner: one
// upload of any kind at a time.
struct GameUploadState {
  int code;
  const char* error;
  bool finished;
  char path[cfg::GAME_PATH_MAX_LEN + 1];
};

void handleGameUploadChunk(AsyncWebServerRequest* request, uint8_t* data, size_t len,
                           size_t index, size_t total) {
  if (request->_tempObject == nullptr) request->_tempObject = calloc(1, sizeof(GameUploadState));
  GameUploadState* s = static_cast<GameUploadState*>(request->_tempObject);
  if (s == nullptr) return;
  const bool final = (index + len == total);
  auto reject = [s](int code, const char* why) {
    if (s->error == nullptr) { s->code = code; s->error = why; }
  };

  if (index == 0) {
    const String wanted = request->hasParam("path") ? request->getParam("path")->value() : String();
    if (!cfg::SD_UPLOAD_ENABLED) {
      reject(403, "uploading is switched off in this version");
    } else if (cfg::SD_WRITES_NEED_KEY && !authorised(request)) {
      reject(401, "missing or wrong X-Lakehorse-Key");
    } else if (!sdstore::mounted()) {
      reject(503, "there is no SD card in the box");
    } else if (wanted.length() == 0 || wanted.endsWith("/") ||
               gamefiles::resolve(wanted.c_str(), s->path, cfg::GAME_PATH_MAX_LEN) !=
                   gamefiles::Result::Ok) {
      reject(400, "not an allowed game file path");
    } else if (request->contentLength() > sdstore::freeBytes()) {
      reject(507, "not enough space left on the SD card");
    } else if (g_uploadOwner != nullptr) {
      reject(503, "another upload is already in progress");
    } else {
      g_uploadOwner = request;
      request->onDisconnect([]() { g_uploadOwner = nullptr; });
      // Make /game and each parent folder; mkdir on an existing one is harmless.
      String dir = cfg::SD_GAME_DIR;
      SD.mkdir(dir);
      for (const char* c = s->path; *c; ++c) {
        if (*c == '/') SD.mkdir(dir + "/" + String(s->path).substring(0, c - s->path));
      }
      const String full = String(cfg::SD_GAME_DIR) + "/" + s->path;
      SD.remove(full + cfg::SD_PART_SUFFIX);
      request->_tempFile = SD.open(full + cfg::SD_PART_SUFFIX, FILE_WRITE);
      if (!request->_tempFile) reject(500, "could not create the file on the SD card");
    }
  }
  if (s->error != nullptr || !request->_tempFile) return;

  // Gather ~1.4 KB TCP segments into whole blocks, as handleUploadChunk does.
  static uint8_t block[cfg::SD_WRITE_BLOCK_BYTES];
  static size_t fill = 0;
  if (index == 0) fill = 0;
  bool ok = true;
  size_t off = 0;
  while (ok && off < len) {
    const size_t n = min(len - off, sizeof(block) - fill);
    memcpy(block + fill, data + off, n);
    fill += n;
    off += n;
    if (fill == sizeof(block)) {
      ok = request->_tempFile.write(block, fill) == fill;
      fill = 0;
    }
  }
  if (ok && final && fill > 0) {
    ok = request->_tempFile.write(block, fill) == fill;
    fill = 0;
  }
  const String full = String(cfg::SD_GAME_DIR) + "/" + s->path;
  if (!ok) {
    request->_tempFile.close();
    SD.remove(full + cfg::SD_PART_SUFFIX);
    g_uploadOwner = nullptr;
    reject(500, "writing to the SD card failed");
    return;
  }
  if (final) {
    request->_tempFile.close();
    if (SD.exists(full)) SD.remove(full);
    if (SD.rename(full + cfg::SD_PART_SUFFIX, full)) {
      s->finished = true;
      Serial.printf("[game] stored %s\n", s->path);
    } else {
      reject(500, "could not move the finished file into place");
    }
  }
}

void handleGameUploadDone(AsyncWebServerRequest* request) {
  const GameUploadState* s = static_cast<GameUploadState*>(request->_tempObject);
  if (s != nullptr && s->error != nullptr) {
    sendError(request, s->code, s->error);
    return;
  }
  if (s == nullptr || !s->finished) {
    sendError(request, 400, "no file arrived");
    return;
  }
  JsonDocument doc;
  doc["ok"] = true;
  doc["path"] = s->path;
  String out;
  serializeJson(doc, out);
  sendJson(request, 200, out);
}

// ---------- One small file at the card root ----------
//
// POST /api/sd/card-file?name=band-tracks.json, raw body, same shape and the same two
// rules as the song upload: the pairing key when cfg::SD_WRITES_NEED_KEY is on, and one
// upload at a time (g_uploadOwner). The name must be on cfg::CARD_FILE_NAMES and the
// body must pass cardfiles::validate before anything touches the card, so a bad upload
// leaves the old file exactly as it was. The body is held in RAM (at most
// cfg::CARD_FILE_MAX_BYTES, in one allocation that the request frees with its
// _tempObject, so a dropped connection cannot leak it), written to "<name>.part",
// checked by size, then swapped in. Not a file editor: no other names, no folders, no
// deletes.
struct CardFileState {
  int code;
  const char* error;
  bool finished;
  size_t length;
  char name[32];
  char body[1];  // really contentLength() bytes, see the calloc below
};

void handleCardFileChunk(AsyncWebServerRequest* request, uint8_t* data, size_t len,
                         size_t index, size_t total) {
  if (index == 0 && request->_tempObject == nullptr) {
    // Size the allocation only once the length is known to be sane; a refused
    // request gets the small fixed part and no body buffer at all.
    const size_t declared = request->contentLength();
    const size_t bodyBytes = (declared > 0 && declared <= cfg::CARD_FILE_MAX_BYTES) ? declared : 0;
    request->_tempObject = calloc(1, sizeof(CardFileState) + bodyBytes);
  }
  CardFileState* s = static_cast<CardFileState*>(request->_tempObject);
  if (s == nullptr) return;
  // A refused upload gives the one-upload slot back at once, but only if it holds it:
  // a request turned away because another upload is running must not free that one's.
  auto reject = [s, request](int code, const char* why) {
    if (s->error == nullptr) { s->code = code; s->error = why; }
    if (g_uploadOwner == request) g_uploadOwner = nullptr;
  };

  if (index == 0) {
    const String wanted = request->hasParam("name") ? request->getParam("name")->value() : String();
    const size_t declared = request->contentLength();
    if (!cfg::SD_UPLOAD_ENABLED) {
      reject(403, "uploading is switched off in this version");
    } else if (cfg::SD_WRITES_NEED_KEY && !authorised(request)) {
      reject(401, "missing or wrong X-Lakehorse-Key");
    } else if (!sdstore::mounted()) {
      reject(503, "there is no SD card in the box");
    } else if (wanted.length() >= sizeof(s->name) || !cardfiles::nameAllowed(wanted.c_str())) {
      reject(400, cardfiles::describe(cardfiles::Result::NameNotAllowed));
    } else if (declared == 0 || total != declared) {
      reject(400, "the file is empty or has no length");
    } else if (declared > cfg::CARD_FILE_MAX_BYTES) {
      reject(413, cardfiles::describe(cardfiles::Result::TooBig));
    } else if (g_uploadOwner != nullptr) {
      reject(503, "another upload is already in progress");
    } else {
      g_uploadOwner = request;
      request->onDisconnect([]() { g_uploadOwner = nullptr; });
      strlcpy(s->name, wanted.c_str(), sizeof(s->name));
    }
  }
  if (s->error != nullptr) return;
  if (index + len > cfg::CARD_FILE_MAX_BYTES || index + len > request->contentLength()) {
    reject(400, "the body is longer than it said");
    return;
  }
  memcpy(s->body + index, data, len);
  s->length = index + len;
  if (index + len != total) return;

  // Whole body is in. Everything below runs once, on the last chunk.
  const cardfiles::Result verdict = cardfiles::validate(s->name, s->body, s->length);
  if (verdict != cardfiles::Result::Ok) {
    reject(400, cardfiles::describe(verdict));
    return;
  }
  const String finalPath = String("/") + s->name;
  const String partPath = finalPath + cfg::SD_PART_SUFFIX;
  const String oldPath = finalPath + ".old";
  SD.remove(partPath);
  File f = SD.open(partPath, FILE_WRITE);
  if (!f) {
    reject(500, "could not create the file on the SD card");
    return;
  }
  const bool wrote = f.write(reinterpret_cast<const uint8_t*>(s->body), s->length) == s->length;
  f.close();
  File check = SD.open(partPath, FILE_READ);
  const bool sizeOk = check && check.size() == s->length;
  if (check) check.close();
  if (!wrote || !sizeOk) {
    SD.remove(partPath);
    reject(500, "writing to the SD card failed");
    return;
  }
  // FAT rename will not overwrite, so the old file is moved aside first and put back if
  // the swap fails: at no point is the only good copy deleted before the new one is in.
  SD.remove(oldPath);
  const bool hadOld = SD.exists(finalPath);
  if (hadOld && !SD.rename(finalPath, oldPath)) {
    SD.remove(partPath);
    reject(500, "could not replace the old file");
    return;
  }
  if (!SD.rename(partPath, finalPath)) {
    if (hadOld) SD.rename(oldPath, finalPath);
    SD.remove(partPath);
    reject(500, "could not move the finished file into place");
    return;
  }
  if (hadOld) SD.remove(oldPath);
  s->finished = true;
  if (g_uploadOwner == request) g_uploadOwner = nullptr;
  Serial.printf("[card] stored %s (%u bytes)\n", s->name, (unsigned)s->length);
}

void handleCardFileDone(AsyncWebServerRequest* request) {
  const CardFileState* s = static_cast<CardFileState*>(request->_tempObject);
  if (s != nullptr && s->error != nullptr) {
    sendError(request, s->code, s->error);
    return;
  }
  if (s == nullptr || !s->finished) {
    sendError(request, 400, "no file arrived");
    return;
  }
  JsonDocument doc;
  doc["ok"] = true;
  doc["name"] = s->name;
  doc["bytes"] = (uint32_t)s->length;
  String out;
  serializeJson(doc, out);
  sendJson(request, 200, out);
}

// Removes ONE file under /game/ (?path=src/core/Game.js.gz). Same path rules as
// the game upload, so a URL can never leave /game/, and folders are refused, so
// this cannot wipe a tree. Exists so stale files left by an earlier pack can be cleared without a card reader.
void handleGameDelete(AsyncWebServerRequest* request) {
  if (cfg::SD_WRITES_NEED_KEY && !authorised(request)) {
    sendError(request, 401, "missing or wrong X-Lakehorse-Key");
    return;
  }
  if (!sdstore::mounted()) {
    sendError(request, 503, "there is no SD card in the box");
    return;
  }
  const String wanted = request->hasParam("path") ? request->getParam("path")->value() : String();
  char safe[cfg::GAME_PATH_MAX_LEN + 1];
  if (wanted.length() == 0 || wanted.endsWith("/") ||
      gamefiles::resolve(wanted.c_str(), safe, cfg::GAME_PATH_MAX_LEN) != gamefiles::Result::Ok) {
    sendError(request, 400, "not an allowed game file path");
    return;
  }
  const String full = String(cfg::SD_GAME_DIR) + "/" + safe;
  File f = SD.open(full, FILE_READ);
  if (!f) {
    sendError(request, 404, "no such file");
    return;
  }
  const bool isDir = f.isDirectory();
  f.close();
  if (isDir) {
    sendError(request, 400, "folders are not removed here");
    return;
  }
  if (!SD.remove(full)) {
    sendError(request, 500, "could not delete the file");
    return;
  }
  Serial.printf("[game] removed %s\n", safe);
  JsonDocument doc;
  doc["ok"] = true;
  doc["path"] = safe;
  String out;
  serializeJson(doc, out);
  sendJson(request, 200, out);
}

void handleSdList(AsyncWebServerRequest* request) {
  JsonDocument doc;
  doc["ok"] = true;
  doc["mounted"] = sdstore::mounted();
  doc["totalBytes"] = (double)sdstore::totalBytes();
  doc["freeBytes"] = (double)sdstore::freeBytes();
  JsonArray files = doc["files"].to<JsonArray>();
  sdstore::list(files);
  String out;
  serializeJson(doc, out);
  sendJson(request, 200, out);
}

void handleSdDelete(AsyncWebServerRequest* request) {
  if (cfg::SD_WRITES_NEED_KEY && !authorised(request)) {
    sendError(request, 401, "missing or wrong X-Lakehorse-Key");
    return;
  }
  if (!request->hasParam("name")) {
    sendError(request, 400, "name is required");
    return;
  }
  // Re-run the filename rules on the way back in. The name comes straight off
  // the URL, and only a name that survives sanitise() unchanged is one this box
  // could ever have stored.
  const String wanted = request->getParam("name")->value();
  char safe[cfg::TRACK_FILE_NAME_MAX_LEN + 1];
  if (trackname::sanitise(wanted.c_str(), safe, cfg::TRACK_FILE_NAME_MAX_LEN) !=
          trackname::Result::Ok ||
      wanted != safe) {
    sendError(request, 400, "that is not a stored track name");
    return;
  }
  if (!sdstore::remove(safe)) {
    sendError(request, 404, "no such track");
    return;
  }
  sendJson(request, 200, "{\"ok\":true}");
}

// Parses "bytes=a-b", "bytes=a-" and "bytes=-n". Returns false for anything
// else, which the caller answers by sending the whole file.
bool parseRange(const String& header, size_t total, size_t& first, size_t& last) {
  if (!header.startsWith("bytes=") || total == 0) return false;
  const String spec = header.substring(6);
  const int dash = spec.indexOf('-');
  if (dash < 0 || spec.indexOf(',') >= 0) return false;
  const String a = spec.substring(0, dash);
  const String b = spec.substring(dash + 1);
  if (a.length() == 0) {  // suffix form: the last n bytes
    const size_t n = (size_t)b.toInt();
    if (n == 0) return false;
    first = n >= total ? 0 : total - n;
    last = total - 1;
    return true;
  }
  first = (size_t)a.toInt();
  last = b.length() == 0 ? total - 1 : (size_t)b.toInt();
  if (last >= total) last = total - 1;
  return first <= last;
}

// One song being sent: the open file and the block of it last read.
struct SdStream {
  File file;
  std::unique_ptr<uint8_t[]> block;
  size_t blockStart = 0;
  size_t blockLen = 0;
};

void sendOpenedFile(AsyncWebServerRequest* request, File opened, const char* mime,
                    bool gzipped, const char* cacheControl);

void handleSdFile(AsyncWebServerRequest* request) {
  if (!sdstore::mounted()) {
    request->send(503, "text/plain", "no SD card");
    return;
  }
  const String wanted = request->url().substring(strlen(cfg::SD_URL_PREFIX));
  char safe[cfg::TRACK_FILE_NAME_MAX_LEN + 1];
  if (trackname::sanitise(wanted.c_str(), safe, cfg::TRACK_FILE_NAME_MAX_LEN) !=
          trackname::Result::Ok ||
      wanted != safe) {
    request->send(404, "text/plain", "not found");
    return;
  }
  File opened = SD.open(sdstore::path(safe), FILE_READ);
  if (!opened || opened.isDirectory()) {
    request->send(404, "text/plain", "not found");
    return;
  }
  sendOpenedFile(request, opened, trackname::contentType(safe), false, nullptr);
}

// Streams an open SD file, honouring Range. Shared by the song route (/sd/*)
// and the game route (/game/*); `gzipped` adds Content-Encoding.
void sendOpenedFile(AsyncWebServerRequest* request, File opened, const char* mime,
                    bool gzipped, const char* cacheControl) {
  // Bulk data: never hold a packet back waiting to coalesce it.
  if (request->client()) request->client()->setNoDelay(true);

  const size_t total = opened.size();
  size_t first = 0;
  size_t last = total > 0 ? total - 1 : 0;
  const bool ranged =
      request->hasHeader("Range") && parseRange(request->header("Range"), total, first, last);
  const size_t length = total == 0 ? 0 : last - first + 1;

  auto stream = std::make_shared<SdStream>();
  stream->file = opened;
  stream->block.reset(new (std::nothrow) uint8_t[cfg::SD_READ_BLOCK_BYTES]);
  if (!stream->block) {
    request->send(503, "text/plain", "busy, try again");
    return;
  }

  // The filler is asked for a TCP segment's worth at a time. Reading the card
  // that finely measured 25-36 KB/s, a fifth of what a WAV needs, so the card is
  // read a whole block at a time and segments are cut from the block.
  // Shared so the lambda, which outlives this function, keeps the file and the
  // block alive exactly as long as the response is being sent.
  AsyncWebServerResponse* response = request->beginResponse(
      mime, length,
      [stream, first, length](uint8_t* buffer, size_t maxLen, size_t sent) -> size_t {
        if (sent >= length) return 0;
        const size_t pos = first + sent;
        if (pos < stream->blockStart || pos >= stream->blockStart + stream->blockLen) {
          const size_t want = min((size_t)cfg::SD_READ_BLOCK_BYTES, first + length - pos);
          if (stream->file.position() != pos) stream->file.seek(pos);
          stream->blockStart = pos;
          stream->blockLen = stream->file.read(stream->block.get(), want);
          if (stream->blockLen == 0) return 0;
        }
        const size_t offset = pos - stream->blockStart;
        const size_t n = min(maxLen, min(stream->blockLen - offset, length - sent));
        memcpy(buffer, stream->block.get() + offset, n);
        return n;
      });
  response->addHeader("Accept-Ranges", "bytes");
  if (gzipped) response->addHeader("Content-Encoding", "gzip");
  if (cacheControl != nullptr) response->addHeader("Cache-Control", cacheControl);
  if (ranged) {
    response->setCode(206);
    response->addHeader("Content-Range",
                        String("bytes ") + first + "-" + last + "/" + total);
  }
  request->send(response);
}

// The page's own files are gzipped at build time (tools/gzip_data.py), so the
// image holds app.js.gz and no app.js. serveStatic() looks for NAME.gz first
// (ESPAsyncWebServer 3.12.1, AsyncStaticWebHandler::_searchFile), answers with
// Content-Encoding: gzip, and takes the ETag from the CRC at the end of the
// gzip file, so a changed file always gets a new ETag.
//
// Caching is split in two. index.html must be re-checked every time (one small
// 304 when nothing changed), because it is what names the other files. The
// build adds ?v=<hash> to each script and stylesheet reference in it, so those
// URLs change whenever a file does and can be kept for a week without a request.
// The handler ignores the query string when it looks the file up.
// CAUSE FOUND 2026-11-23: the note below was lwIP's TCP segments living in
// PSRAM (RUNTIME_PSRAM_THRESHOLD was 1024, see config.h); it is 1600 now and
// header length no longer matters. The padding is kept because it is harmless.
// HEADER LENGTH MATTERS ON THIS BOARD (found 2026-11-22 on hardware). When a
// response's header block is 2 bytes past a multiple of 4 (202 and 226 bytes
// were seen), the last two header bytes, the blank line that ends the headers,
// arrive as 0x00 0x00 and clients see a 200 with no body. Lengths of 0 and 1
// past a multiple of 4 (112, 209, 233, and now 216, 241, 248) are fine. Most
// likely the unaligned copy of the body into the PSRAM-backed TCP buffer on the
// rev v1.0 chip. These two strings are padded with ", no-transform" (harmless,
// and right for gzip bodies) and a longer max-age to land on good lengths for
// the current files. Adding a file type or a file whose size has a different
// number of digits can move a header onto a bad length again: run
// tools/pageload.py, which checks every body, after any change here.
constexpr const char* kPageRootCache = "no-cache, no-transform";
constexpr const char* kPageAssetCache = "public, max-age=6048000, immutable, no-transform";

bool isPageRoot(AsyncWebServerRequest* request) {
  const String url = request->url();
  return url == "/" || url == "/index.html";
}

// The game: /game/<path> is read from <SD>/game/<path>. A pre-gzipped
// <path>.gz beside it is preferred when the phone accepts gzip, because the
// radio link is slow. Path rules live in game_files.h.
void handleGameFile(AsyncWebServerRequest* request) {
  if (!sdstore::mounted()) {
    request->send(503, "text/plain", "no SD card");
    return;
  }
  const String wanted = request->url().substring(strlen(cfg::GAME_URL_PREFIX));
  char safe[cfg::GAME_PATH_MAX_LEN + 1];
  if (gamefiles::resolve(wanted.c_str(), safe, cfg::GAME_PATH_MAX_LEN) !=
      gamefiles::Result::Ok) {
    request->send(404, "text/plain", "not found");
    return;
  }
  const String base = String(cfg::SD_GAME_DIR) + "/" + safe;
  const bool acceptsGzip = request->hasHeader("Accept-Encoding") &&
                           request->header("Accept-Encoding").indexOf("gzip") >= 0;
  bool gzipped = false;
  File opened;
  if (acceptsGzip) {
    opened = SD.open(base + ".gz", FILE_READ);
    gzipped = opened && !opened.isDirectory();
  }
  if (!gzipped) opened = SD.open(base, FILE_READ);
  if (!opened || opened.isDirectory()) {
    request->send(404, "text/plain", "not found");
    return;
  }
  sendOpenedFile(request, opened, gamefiles::contentType(safe), gzipped,
                 cfg::GAME_CACHE_CONTROL);
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
#if LAKEHORSE_BT
  // Before any handler writes a byte; see send_window.h for why. Only while
  // Bluetooth runs: switched off, RAM is plentiful and the cap only slows
  // pages down.
  if (btspeaker::enabled()) {
    g_server.addMiddleware([](AsyncWebServerRequest* request, ArMiddlewareNext next) {
      sendwindow::cap(request->client());
      next();
    });
  }
#endif

  g_server.on("/api/status", HTTP_GET, handleStatus);
  g_server.on("/api/pair", HTTP_GET, handlePair);
  g_server.on("/api/playlist", HTTP_GET, handleGetPlaylist);
  g_server.on("/api/scan", HTTP_GET, handleScan);
  g_server.on("/api/alignment/event", HTTP_POST, handleAlignmentEvent);

  g_server.on("/api/wifi/forget", HTTP_POST, [](AsyncWebServerRequest* request) {
    if (!mayChangeNetwork(request)) {
      sendError(request, 401, "not allowed from this network");
      return;
    }
    const String ssid = request->hasParam("ssid", true) ? request->getParam("ssid", true)->value()
                                                         : String();
    if (!wifinet::forget(ssid)) {
      sendError(request, 404, "that network is not saved");
      return;
    }
    sendJson(request, 200, "{\"ok\":true}");
  });

  // Leaves the network and serves the box's own hotspot; saved networks stay.
  g_server.on("/api/wifi/host", HTTP_POST, [](AsyncWebServerRequest* request) {
    if (!mayChangeNetwork(request)) {
      sendError(request, 401, "not allowed from this network");
      return;
    }
    wifinet::hostMode();
    sendJson(request, 200, "{\"ok\":true}");
  });

  // Joins a network that is already saved, now. Same rule as the others.
  g_server.on("/api/wifi/use", HTTP_POST, [](AsyncWebServerRequest* request) {
    if (!mayChangeNetwork(request)) {
      sendError(request, 401, "not allowed from this network");
      return;
    }
    const String ssid = request->hasParam("ssid", true) ? request->getParam("ssid", true)->value()
                                                         : String();
    if (!wifinet::use(ssid)) {
      sendError(request, 404, "that network is not saved");
      return;
    }
    sendJson(request, 200, "{\"ok\":true}");
  });

  g_server.on("/api/sd", HTTP_GET, handleSdList);
  g_server.on("/api/sd/delete", HTTP_POST, handleSdDelete);
  g_server.on("/api/sd/upload", HTTP_POST, handleUploadDone, nullptr, handleUploadChunk);
  g_server.on("/api/sd/game-upload", HTTP_POST, handleGameUploadDone, nullptr, handleGameUploadChunk);
  g_server.on("/api/sd/game-delete", HTTP_POST, handleGameDelete);
  g_server.on("/api/sd/card-file", HTTP_POST, handleCardFileDone, nullptr, handleCardFileChunk);
  g_server.on("/sd/*", HTTP_GET, handleSdFile);
  // Wildcard first: the library treats the plain "/game" as a prefix too, so
  // registered first it redirected every /game/... URL back to /game/ forever.
  g_server.on("/game/*", HTTP_GET, handleGameFile);
  g_server.on("/game", HTTP_GET, [](AsyncWebServerRequest* r) { r->redirect("/game/"); });
#ifdef LAKEHORSE_ALIGN_TEST
  aligntest::attach(g_server);
#endif
  playerapi::attach(g_server);
  speakerapi::attach(g_server);
  matrixapi::attach(g_server);

  registerPlaylistWrite();
  registerWifiWrite();

  // Order matters: the first handler that accepts the request answers it, so
  // the filtered index.html handler must come before the catch-all one.
  AsyncStaticWebHandler& pageRoot = g_server.serveStatic("/", LittleFS, "/");
  pageRoot.setDefaultFile("index.html").setCacheControl(kPageRootCache);
  pageRoot.setFilter(isPageRoot);
  g_server.serveStatic("/", LittleFS, "/")
      .setCacheControl(kPageAssetCache);

  // Last, and only last. The portal's catch-all claims everything nothing
  // above wanted, so registering it earlier would swallow the API.
  portal::attach(g_server);

  g_server.begin();
  Serial.printf("[http] listening on port %u\n", cfg::HTTP_PORT);
}

}  // namespace web
