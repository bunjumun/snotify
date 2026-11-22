// Module 5 spike: can this board act as an A2DP source and play to "ml301"?
// Sends a quiet 440 Hz tone (amplitude 3000 of 32767) so a wrong volume
// cannot hurt anyone's ears. Logs connection state and heap once a second,
// which is the number Module 6 needs (BT stack cost under the ~54 KB
// streaming low-water mark from HANDOFF.md).
#include <Arduino.h>
#include <math.h>
#include "BluetoothA2DPSource.h"
#include "esp_gap_bt_api.h"

// Core 3.x releases Bluetooth Classic memory at boot unless the sketch says it
// uses it (esp32-hal-misc.c initArduino). Without this override the controller
// init fails with ESP_ERR_INVALID_STATE. BLE stays released: saves internal RAM.
#if ESP_ARDUINO_VERSION_MAJOR >= 3
bool btClassicInUse(void) { return true; }
#else
// Core 2.x has the older single hook for the same release-at-boot behaviour.
bool btInUse(void) { return true; }
#endif

// Advertised name, exact case: the library matches with strcmp, and "ml301"
// was never found while "ML301" was seen 50 times in one minute.
static const char* SPEAKER = "ML301";
static const float AMPLITUDE = 3000.0f;
static const float TONE_HZ = 440.0f;
static const float SAMPLE_RATE = 44100.0f;

static BluetoothA2DPSource a2dp;
static float phase = 0.0f;

static int32_t fillFrames(Frame* frames, int32_t count) {
  const float step = 2.0f * (float)M_PI * TONE_HZ / SAMPLE_RATE;
  for (int32_t i = 0; i < count; i++) {
    int16_t s = (int16_t)(sinf(phase) * AMPLITUDE);
    frames[i].channel1 = s;
    frames[i].channel2 = s;
    phase += step;
    if (phase > 2.0f * (float)M_PI) phase -= 2.0f * (float)M_PI;
  }
  return count;
}

static void logHeap(const char* tag) {
  Serial.printf("[%s] free=%u largest=%u min=%u psram=%u\n", tag,
                ESP.getFreeHeap(), ESP.getMaxAllocHeap(), ESP.getMinFreeHeap(),
                ESP.getFreePsram());
}

void setup() {
  Serial.begin(115200);
  delay(500);
  logHeap("boot");
  // Connect straight to ML301's address (seen in the discovery log), so the
  // speaker needs to be on but not in pairing mode while we diagnose.
  a2dp.set_auto_reconnect(false);
  // Secure Simple Pairing. Off by default in ESP32-A2DP 1.8.8; without it
  // ML301 accepted the link and AVRCP, then dropped A2DP ~6 s later with no
  // pairing event ever raised.
  a2dp.set_ssp_enabled(true);
  a2dp.set_data_callback_in_frames(fillFrames);
  a2dp.start(SPEAKER);
  // Diagnostic: forget every stored bond so a speaker that was reset into
  // pairing mode is not offered stale link keys.
  int n = esp_bt_gap_get_bond_device_num();
  if (n > 0) {
    esp_bd_addr_t list[8];
    int count = n > 8 ? 8 : n;
    esp_bt_gap_get_bond_device_list(&count, list);
    for (int i = 0; i < count; i++) esp_bt_gap_remove_bond_device(list[i]);
  }
  Serial.printf("[bonds] removed %d\n", n);
  logHeap("after-start");
}

void loop() {
  static bool wasConnected = false;
  const bool now = a2dp.is_connected();
  if (now != wasConnected) {
    Serial.printf("[a2dp] %s\n", now ? "CONNECTED" : "DISCONNECTED");
    wasConnected = now;
  }
  logHeap(now ? "playing" : "searching");
  delay(1000);
}
