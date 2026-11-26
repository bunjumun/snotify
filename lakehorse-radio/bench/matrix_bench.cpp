//
// Matrix bench test: isolated from the radio (no Wi-Fi, no Bluetooth, no web).
// Wiring: panel DIN on GPIO 27, panel 5 V from the bench supply, grounds
// bridged to the ESP, ESP on USB. Power the panel supply BEFORE flashing or
// resetting; read the serial log (115200).
//
// Sequence at low brightness, 150 mA limit applied before the first show:
//   1. one pixel (index 0), 4 s
//   2. corner markers (red TL, green TR, blue BL, white BR as logical corners
//      of the default serpentine / top-left layout), 6 s
//   3. slow fill, one pixel per 300 ms, then slow clear
// Repeats for about a minute, then holds the corner frame. Logs the reset
// reason at boot so a brownout is named, not guessed.
//
#include <Arduino.h>
#include <FastLED.h>
#include <esp_system.h>

#include "matrix_layout.h"

namespace {
constexpr uint8_t kPin = 27;
constexpr int kCount = 64;
constexpr uint8_t kBrightness = 16;  // out of 255
constexpr uint32_t kRunMs = 60000;
CRGB leds[kCount];

int phys(int logical) {
  return matrixlayout::physicalIndex(logical, matrixlayout::Wiring::Serpentine,
                                     matrixlayout::Origin::TopLeft);
}

void corners() {
  FastLED.clear();
  leds[phys(0)] = CRGB::Red;
  leds[phys(7)] = CRGB::Green;
  leds[phys(56)] = CRGB::Blue;
  leds[phys(63)] = CRGB::White;
  FastLED.show();
}
}  // namespace

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.printf("\n[bench] reset reason %d (1=power-on 15=brownout 3=software)\n",
                (int)esp_reset_reason());
  FastLED.addLeds<WS2812, kPin, GRB>(leds, kCount);
  FastLED.setMaxPowerInVoltsAndMilliamps(5, 150);  // before the first show
  FastLED.setBrightness(0);
  FastLED.clear(true);  // black first: the strip powers up in random colours
  FastLED.setBrightness(kBrightness);
  Serial.println(F("[bench] limit 150 mA, brightness 16/255, panel dark"));
}

void loop() {
  static uint32_t start = millis();
  const uint32_t now = millis();
  if (now - start > kRunMs) {
    static bool done = false;
    if (!done) {
      done = true;
      corners();
      Serial.println(F("[bench] done, holding the corner frame. No resets means pass."));
    }
    delay(1000);
    return;
  }
  Serial.printf("[bench] t=%us step 1: one pixel\n", (unsigned)((now - start) / 1000));
  FastLED.clear();
  leds[phys(0)] = CRGB::Red;
  FastLED.show();
  delay(4000);
  Serial.println(F("[bench] step 2: corners"));
  corners();
  delay(6000);
  Serial.println(F("[bench] step 3: slow fill"));
  FastLED.clear();
  for (int i = 0; i < kCount; ++i) {
    leds[phys(i)] = CRGB(40, 40, 40);
    FastLED.show();
    delay(300);
  }
  for (int i = kCount - 1; i >= 0; --i) {
    leds[phys(i)] = CRGB::Black;
    FastLED.show();
    delay(60);
  }
  Serial.printf("[bench] heartbeat free heap %u\n", (unsigned)ESP.getFreeHeap());
}
