#include "matrix_driver.h"

#include <Arduino.h>
#include <Preferences.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <freertos/task.h>

#include "matrix_engine.h"

#ifdef LAKEHORSE_MATRIX
#include <FastLED.h>

#include "alignment_box.h"
#include "box_player.h"
#endif

namespace matrixdrv {
namespace {

using matrixlayout::Origin;
using matrixlayout::Wiring;

SemaphoreHandle_t g_lock = nullptr;
volatile Wiring g_wiring = Wiring::Serpentine;
volatile Origin g_origin = Origin::TopLeft;

constexpr const char* kPrefsNs = "matrix";

void loadLayout() {
  Preferences p;
  if (!p.begin(kPrefsNs, true)) return;
  const uint8_t w = p.getUChar("wire", (uint8_t)Wiring::Serpentine);
  const uint8_t o = p.getUChar("org", (uint8_t)Origin::TopLeft);
  p.end();
  if (w <= (uint8_t)Wiring::Progressive) g_wiring = (Wiring)w;
  if (o <= (uint8_t)Origin::BottomRight) g_origin = (Origin)o;
}

#ifdef LAKEHORSE_MATRIX

constexpr uint8_t kDataPin = 27;
constexpr uint8_t kLedCount = matrixlayout::kPixels;
// A computer USB port is the supply while this is bench-tested.
constexpr uint8_t kSupplyVolts = 5;
constexpr uint16_t kMaxMilliamps = 150;
// Page brightness above this is held here until the panel has passed a bench
// test at higher levels. 40% of 255.
constexpr uint8_t kBrightnessCapPct = 40;
constexpr uint32_t kStartDelayMs = 3000;  // let Wi-Fi and Bluetooth settle first
constexpr uint32_t kFrameMs = 66;         // about 15 frames a second
constexpr uint8_t kRampStepPct = 8;       // ~1 s from dark to full at 15 fps
constexpr uint8_t kDefaultRgb[3] = {255, 107, 44};  // the virtual window's orange
constexpr uint32_t kTaskStack = 4096;

CRGB g_leds[kLedCount];

uint8_t hexLevel(char c) {
  if (c >= '0' && c <= '9') return (uint8_t)(c - '0');
  if (c >= 'a' && c <= 'f') return (uint8_t)(c - 'a' + 10);
  return 0;
}

uint8_t targetBrightness255() {
  uint8_t pct = matrix::brightness();
  if (pct > kBrightnessCapPct) pct = kBrightnessCapPct;
  return (uint8_t)((pct * 255u) / 100u);
}

void clearAndShow() {
  FastLED.clear(true);  // clear the buffer and push it
}

void drawTask(void*) {
  vTaskDelay(pdMS_TO_TICKS(kStartDelayMs));
  // Limit before the first show, then show black so the strip's random
  // power-up colours are gone before anything is lit.
  FastLED.setMaxPowerInVoltsAndMilliamps(kSupplyVolts, kMaxMilliamps);
  FastLED.setBrightness(0);
  clearAndShow();

  char last[matrixlayout::kPixels + 1] = {0};
  uint8_t shownBrightness = 0;
  Wiring lastWiring = Wiring::Serpentine;
  Origin lastOrigin = Origin::TopLeft;
  bool wasOff = true;
  bool haveLast = false;
  uint8_t colours[matrixlayout::kPixels][3];
  TickType_t wake = xTaskGetTickCount();
  for (;;) {
    char frame[matrixlayout::kPixels + 1];
    bool off;
    {
      Lock lock;
      uint8_t levels[matrix::kBands];
      const uint32_t now = millis();
      if (boxplayer::bandsNow(levels)) matrix::feedBands(levels, now);
      if (matrix::mode() == matrix::Mode::Alignment) matrix::setAlignment(alignment::snapshot().points, 0x4C4Bu);
      off = matrix::mode() == matrix::Mode::Off;
      memcpy(frame, matrix::render(now), sizeof(frame));
      for (int i = 0; i < matrixlayout::kPixels; ++i) {
        if (!matrix::pixelColor(i, colours[i])) memcpy(colours[i], kDefaultRgb, 3);
      }
    }
    const Wiring w = g_wiring;
    const Origin o = g_origin;
    if (off) {
      if (!wasOff) {
        shownBrightness = 0;
        FastLED.setBrightness(0);
        clearAndShow();
        haveLast = false;
      }
      wasOff = true;
    } else {
      if (wasOff) shownBrightness = 0;  // ramp up again from dark
      wasOff = false;
      const uint8_t target = targetBrightness255();
      uint8_t next = shownBrightness;
      if (next < target) {
        const uint16_t step = (uint16_t)(255u * kRampStepPct / 100u);
        next = (uint8_t)min<uint16_t>(target, next + step);
      } else if (next > target) {
        next = target;
      }
      const bool changed = !haveLast || next != shownBrightness || w != lastWiring ||
                           o != lastOrigin || memcmp(frame, last, sizeof(frame)) != 0;
      if (changed) {
        for (int i = 0; i < matrixlayout::kPixels; ++i) {
          const int p = matrixlayout::physicalIndex(i, w, o);
          const uint8_t level = hexLevel(frame[i]);
          g_leds[p] = CRGB((colours[i][0] * level) / 15, (colours[i][1] * level) / 15,
                           (colours[i][2] * level) / 15);
        }
        FastLED.setBrightness(next);
        FastLED.show();
        memcpy(last, frame, sizeof(frame));
        shownBrightness = next;
        lastWiring = w;
        lastOrigin = o;
        haveLast = true;
      }
    }
    vTaskDelayUntil(&wake, pdMS_TO_TICKS(kFrameMs));
  }
}

void startTask() {
  FastLED.addLeds<WS2812, kDataPin, GRB>(g_leds, kLedCount);
  // Core 1 shares with the async web task, which is lightly loaded; Wi-Fi
  // and Bluetooth sit on core 0. Priority 1 (same as loop) so audio and
  // Wi-Fi tasks always preempt it.
  xTaskCreatePinnedToCore(drawTask, "matrix", kTaskStack, nullptr, 1, nullptr, 1);
}

#endif  // LAKEHORSE_MATRIX

}  // namespace

Lock::Lock() {
  if (g_lock) xSemaphoreTake(g_lock, portMAX_DELAY);
}
Lock::~Lock() {
  if (g_lock) xSemaphoreGive(g_lock);
}

void begin() {
  g_lock = xSemaphoreCreateMutex();
  loadLayout();
#ifdef LAKEHORSE_MATRIX
  startTask();
  Serial.println(F("[matrix] driver on GPIO 27, 150 mA limit, starts in 3 s"));
#else
  Serial.println(F("[matrix] built without the LED driver"));
#endif
}

Wiring wiring() { return g_wiring; }
Origin origin() { return g_origin; }

void setLayout(Wiring w, Origin o) {
  g_wiring = w;
  g_origin = o;
  Preferences p;
  if (p.begin(kPrefsNs, false)) {
    p.putUChar("wire", (uint8_t)w);
    p.putUChar("org", (uint8_t)o);
    p.end();
  }
}

bool hardwareBuilt() {
#ifdef LAKEHORSE_MATRIX
  return true;
#else
  return false;
#endif
}

}  // namespace matrixdrv
