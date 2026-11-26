#include "matrix_api.h"

// ArduinoJson before ESPAsyncWebServer; see web_server.cpp for why.
#include <ArduinoJson.h>
#include <ESPAsyncWebServer.h>

#include "alignment_box.h"
#include "box_player.h"
#include "matrix_driver.h"
#include "matrix_engine.h"
#include "matrix_layout.h"

namespace matrixapi {
namespace {

// Fixed, so the same total always draws the same wandering on the page's
// virtual window and the real panel.
constexpr uint32_t kAlignSeed = 0x4C4Bu;

// Callers hold matrixdrv::Lock: the engine renders into one shared buffer that
// the LED task also uses.
void sendFrame(AsyncWebServerRequest* request, const char* error = nullptr) {
  JsonDocument doc;
  doc["ok"] = error == nullptr;
  if (error) doc["error"] = error;
  doc["mode"] = matrix::modeName(matrix::mode());
  doc["title"] = matrix::title();
  uint8_t levels[matrix::kBands];
  if (boxplayer::bandsNow(levels)) matrix::feedBands(levels, millis());
  // The Alignment pattern reads the box's saved total (one short mutex hold).
  if (matrix::mode() == matrix::Mode::Alignment) matrix::setAlignment(alignment::snapshot().points, kAlignSeed);
  doc["frame"] = matrix::render(millis());
  doc["brightness"] = matrix::brightness();
  doc["wiring"] = matrixlayout::wiringName(matrixdrv::wiring());
  doc["origin"] = matrixlayout::originName(matrixdrv::origin());
  doc["hardware"] = matrixdrv::hardwareBuilt();
  if (matrix::mode() == matrix::Mode::Test) {
    // Colours of the four marked corners, so the virtual window can paint the
    // same picture the real panel shows: "index:rrggbb" pairs.
    JsonArray colors = doc["colors"].to<JsonArray>();
    uint8_t rgb[3];
    for (int i = 0; i < matrix::kPixels; ++i) {
      if (!matrix::pixelColor(i, rgb)) continue;
      char buf[16];
      snprintf(buf, sizeof(buf), "%d:%02x%02x%02x", i, rgb[0], rgb[1], rgb[2]);
      colors.add(buf);
    }
  }
  String out;
  serializeJson(doc, out);
  request->send(error ? 400 : 200, "application/json", out);
}

void handleGet(AsyncWebServerRequest* request) {
  matrixdrv::Lock lock;
  sendFrame(request);
}

bool param(AsyncWebServerRequest* request, const char* name, String* out) {
  if (!request->hasParam(name)) return false;
  *out = request->getParam(name)->value();
  return true;
}

void handlePost(AsyncWebServerRequest* request) {
  matrixdrv::Lock lock;
  // Check everything first, apply after, so a bad value changes nothing.
  String modeText, titleText, imageText, hText, mText, sText, brightText, wiringText, originText;
  const bool hasMode = param(request, "mode", &modeText);
  const bool hasTitle = param(request, "title", &titleText);
  const bool hasImage = param(request, "image", &imageText);
  const bool hasH = param(request, "h", &hText);
  const bool hasM = param(request, "m", &mText);
  const bool hasS = param(request, "s", &sText);
  const bool hasBright = param(request, "bright", &brightText);
  const bool hasWiring = param(request, "wiring", &wiringText);
  const bool hasOrigin = param(request, "origin", &originText);

  matrix::Mode mode = matrix::Mode::Off;
  if (hasMode && !matrix::modeFromName(modeText.c_str(), &mode)) {
    sendFrame(request, "mode must be off, bars, title, dazzle, clock, image, test or alignment");
    return;
  }
  uint32_t h = 0, m = 0, s = 0;
  if (hasH || hasM || hasS) {
    if (!(hasH && hasM && hasS)) {
      sendFrame(request, "h, m and s go together");
      return;
    }
    if (!matrix::parseUint(hText.c_str(), 23, &h) ||
        !matrix::parseUint(mText.c_str(), 59, &m) ||
        !matrix::parseUint(sText.c_str(), 59, &s)) {
      sendFrame(request, "time must be h 0-23, m 0-59, s 0-59");
      return;
    }
  }
  uint32_t bright = 0;
  if (hasBright && !matrix::parseUint(brightText.c_str(), 100, &bright)) {
    sendFrame(request, "bright must be 1-100");
    return;
  }
  if (hasBright && bright < 1) {
    sendFrame(request, "bright must be 1-100");
    return;
  }
  matrixlayout::Wiring wiring = matrixdrv::wiring();
  matrixlayout::Origin origin = matrixdrv::origin();
  if (hasWiring && !matrixlayout::wiringFromName(wiringText.c_str(), &wiring)) {
    sendFrame(request, "wiring must be serpentine or progressive");
    return;
  }
  if (hasOrigin && !matrixlayout::originFromName(originText.c_str(), &origin)) {
    sendFrame(request, "origin must be tl, tr, bl or br");
    return;
  }
  if (hasImage && imageText.length() != (unsigned)matrix::kPixels) {
    sendFrame(request, "image must be 64 hex characters");
    return;
  }

  const uint32_t now = millis();
  if (hasTitle) matrix::setTitle(titleText.c_str(), now);
  if (hasH && !matrix::setClock((uint8_t)h, (uint8_t)m, (uint8_t)s, now)) {
    sendFrame(request, "time out of range");
    return;
  }
  if (hasImage && !matrix::setImage(imageText.c_str())) {
    sendFrame(request, "image must be 64 hex characters");
    return;
  }
  if (hasBright) matrix::setBrightness((uint8_t)bright);
  if (hasWiring || hasOrigin) matrixdrv::setLayout(wiring, origin);
  if (hasMode) matrix::setMode(mode, now);
  sendFrame(request);
}

}  // namespace

void attach(AsyncWebServer& server) {
  server.on("/api/matrix", HTTP_GET, handleGet);
  server.on("/api/matrix", HTTP_POST, handlePost);
}

}  // namespace matrixapi
