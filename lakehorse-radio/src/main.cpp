//
// Lakehorse Radio — a Wi-Fi jukebox that never makes a sound.
//
// The box does not play music. It serves a small web player, and the phone that
// opens it streams the band's catalogue from the open web. That is the whole
// trick, and it is why this firmware needs no audio hardware, no codec, no
// PSRAM and no TLS stack: about twenty kilobytes of static files and a playlist
// is the entire payload. An ESP32 that tried to decode the audio itself would
// be a far harder build for a worse result.
//
// (2026-11-21: that premise is about to change. On-board Bluetooth playback is
// planned, so PSRAM is now switched on in platformio.ini to give it room; the
// box still plays nothing itself today.)
//
// This file does nothing but ordering, because the ordering is the part that
// bites. Each step below depends on the one above it in a way that fails
// quietly rather than loudly when you get it wrong.
//
#include <Arduino.h>
// esp_psram.h is IDF 5 (core 3.x). Core 2.0.17 (IDF 4.4), which the radio is
// moving to for A2DP (HANDOFF.md, Module 5), has no public re-probe call, so
// there the reason is simply not available.
#if ESP_ARDUINO_VERSION_MAJOR >= 3
#include <esp_psram.h>
#endif
#include <esp_system.h>

#include "captive_portal.h"
#include "config.h"
#include "device_key.h"
#include "net_identity.h"
#include "playlist_store.h"
#include "sd_store.h"
#include "web_server.h"
#include "wifi_manager.h"
#include "wifi_seed.h"

// PSRAM is probed by the framework before setup() runs (only when the build
// defines BOARD_HAS_PSRAM; see platformio.ini), and when the probe fails it
// says nothing: the prebuilt libraries only log errors, and the failure is a
// warning. So "no PSRAM", "PSRAM failed to start" and "PSRAM compiled out"
// all used to print "psram 0 bytes". When none was found, ask once more and
// print the reason, so they can be told apart.
// Retrying is harmless: the earlier failure left PSRAM uninitialised, and GPIO
// 16/17 (the only pins it touches) are not used by this firmware.
void reportPsram() {
  if (psramFound()) {
    Serial.printf("[boot] psram %u bytes, %u free, largest block %u\n",
                  (unsigned)ESP.getPsramSize(), (unsigned)ESP.getFreePsram(),
                  (unsigned)ESP.getMaxAllocPsram());
    return;
  }
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  const esp_err_t why = esp_psram_init();
  Serial.printf("[boot] psram not found (esp_psram_init: %s)\n", esp_err_to_name(why));
#else
  Serial.println(F("[boot] psram not found (core 2.x: no re-probe available)"));
#endif
}

void setup() {
  Serial.begin(115200);
  // The USB-serial bridge needs a moment after a reset before anything printed
  // actually reaches a monitor. Without this the boot banner is routinely lost,
  // which makes a perfectly healthy boot look like a dead board.
  delay(300);

  Serial.println();
  Serial.printf("[boot] Lakehorse Radio %s\n", cfg::FIRMWARE_VERSION);
  Serial.printf("[boot] reset reason %d, free heap %u, largest block %u, min free %u\n",
                (int)esp_reset_reason(), (unsigned)ESP.getFreeHeap(),
                (unsigned)ESP.getMaxAllocHeap(), (unsigned)ESP.getMinFreeHeap());
  reportPsram();

  if (!playlist::beginStorage()) {
    // Carry on regardless. Without a filesystem there is no player UI, but the
    // API and the setup page still answer, which is what someone needs in order
    // to diagnose and reflash. Refusing to boot would remove the only way in.
    Serial.println(F("[boot] continuing without a filesystem"));
  }

  // Before WiFi: this only registers event handlers, and the GOT_IP event it
  // waits for can fire as soon as the station is started below.
  netid::begin();

  // After netid (it may set the .local name) and before wifinet, which reads
  // the saved network. A no-op unless src/wifi_defaults.h exists.
  wifiseed::apply();

  // Before the web server, so the first /api/sd request already knows whether
  // there is a card. Not fatal if there is none.
  sdstore::begin();

  wifinet::begin();

  // After the radio is up, because the key is drawn from the hardware RNG and
  // that is properly seeded only once the radio has started.
  devkey::begin();

  // After the access point exists, because the DNS server binds to its address.
  portal::begin();

  web::begin();

  Serial.println(F("[boot] ready"));
}

void loop() {
  wifinet::tick();

  // DNSServer is polled rather than interrupt-driven. Stop calling this and the
  // captive portal silently stops capturing, which presents as "the setup page
  // does not pop up any more" with nothing in the log.
  portal::tick();

  // The web server is entirely callback-driven on its own task, so this loop
  // has nothing else to do. Yield rather than spin: a busy loop here starves
  // the idle task and eventually trips the watchdog.
  delay(10);
}
