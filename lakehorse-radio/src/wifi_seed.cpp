#include "wifi_seed.h"

#include <Arduino.h>
#include <Preferences.h>

#include "config.h"
#include "net_identity.h"

// Optional by design: a fresh clone has no wifi_defaults.h and must still build.
#if __has_include("wifi_defaults.h")
#include "wifi_defaults.h"
#else
#define LAKEHORSE_WIFI_SSID ""
#define LAKEHORSE_WIFI_PASSWORD ""
#endif

#ifndef LAKEHORSE_MDNS_HOST
#define LAKEHORSE_MDNS_HOST ""
#endif

namespace wifiseed {
namespace {

// FNV-1a over ssid, password and host. Not security: it only has to notice that
// the file changed, and it keeps the password itself out of a second NVS key.
uint32_t fingerprint(const String& ssid, const String& pass, const String& host) {
  uint32_t h = 2166136261u;
  const String all = ssid + '\n' + pass + '\n' + host;
  for (size_t i = 0; i < all.length(); ++i) {
    h ^= (uint8_t)all[i];
    h *= 16777619u;
  }
  return h;
}

}  // namespace

void apply() {
  const String ssid = LAKEHORSE_WIFI_SSID;
  const String pass = LAKEHORSE_WIFI_PASSWORD;
  const String host = LAKEHORSE_MDNS_HOST;
  if (ssid.length() == 0) return;

  // Same bounds provision() enforces; a bad value here must not reach NVS.
  const bool passOk = pass.length() == 0 || (pass.length() >= 8 && pass.length() <= 63);
  if (ssid.length() > 32 || !passOk) {
    Serial.println(F("[seed] wifi_defaults.h has an illegal SSID or password, ignoring it"));
    return;
  }

  const uint32_t want = fingerprint(ssid, pass, host);

  Preferences prefs;
  if (!prefs.begin(cfg::NVS_NAMESPACE, /*readOnly=*/false)) {
    Serial.println(F("[seed] could not open NVS"));
    return;
  }
  const uint32_t have = prefs.getUInt(cfg::NVS_KEY_SEED, 0);
  if (have == want) {
    prefs.end();
    return;
  }

  prefs.putString(cfg::NVS_KEY_SSID, ssid);
  prefs.putString(cfg::NVS_KEY_PASS, pass);
  prefs.putUInt(cfg::NVS_KEY_SEED, want);
  prefs.end();
  // The SSID is not a secret worth hiding from the serial log; the password is
  // never printed anywhere in this firmware.
  Serial.printf("[seed] applied the Wi-Fi network \"%s\" from wifi_defaults.h\n",
                ssid.c_str());

  if (host.length() > 0) {
    const char* problem = netid::setHostname(host.c_str());
    if (problem != nullptr) {
      Serial.printf("[seed] hostname \"%s\" rejected: %s\n", host.c_str(), problem);
    }
  }
}

}  // namespace wifiseed
