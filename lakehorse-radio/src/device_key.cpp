#include "device_key.h"

#include <Preferences.h>
#include <esp_random.h>

#include "config.h"

namespace devkey {
namespace {

String g_key;

// 16 hex characters: 64 bits of hardware randomness. Short enough to read off
// a serial log by eye if someone ever needs to, long enough that guessing it
// over HTTP is not a thing anyone will do.
constexpr size_t KEY_BYTES = 8;
constexpr const char* NVS_KEY_DEVICE = "devkey";

String generate() {
  char buf[KEY_BYTES * 2 + 1];
  for (size_t i = 0; i < KEY_BYTES; ++i) {
    // esp_random() is the hardware RNG and is properly seeded once the radio
    // is up. This is called from setup() after WiFi.begin(), which is why the
    // ordering in main.cpp matters.
    snprintf(&buf[i * 2], 3, "%02x", (unsigned)(esp_random() & 0xFF));
  }
  buf[KEY_BYTES * 2] = '\0';
  return String(buf);
}

}  // namespace

void begin() {
  Preferences prefs;
  if (!prefs.begin(cfg::NVS_NAMESPACE, /*readOnly=*/false)) {
    // Fall back to a session-only key rather than leaving writes ungated.
    // It will not survive a reboot, which is the correct failure direction.
    g_key = generate();
    Serial.println(F("[key] NVS unavailable, using a key that will not persist"));
    return;
  }

  g_key = prefs.isKey(NVS_KEY_DEVICE) ? prefs.getString(NVS_KEY_DEVICE, "") : String();
  if (g_key.length() == 0) {
    g_key = generate();
    prefs.putString(NVS_KEY_DEVICE, g_key);
    Serial.println(F("[key] generated a new pairing key for this box"));
  }
  prefs.end();

  Serial.printf("[key] pairing key: %s\n", g_key.c_str());
}

const String& value() { return g_key; }

bool matches(const String& supplied) {
  if (g_key.length() == 0) return false;
  if (supplied.length() != g_key.length()) return false;

  uint8_t diff = 0;
  for (size_t i = 0; i < g_key.length(); ++i) {
    diff |= (uint8_t)(g_key[i] ^ supplied[i]);
  }
  return diff == 0;
}

}  // namespace devkey
