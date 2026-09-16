#include "captive_portal.h"

#include <DNSServer.h>
#include <WiFi.h>

#include "config.h"
#include "net_identity.h"
#include "wifi_manager.h"

namespace portal {
namespace {

DNSServer g_dns;
bool g_running = false;

// Whether the access point was up the last time this was checked. Wi-Fi is
// station-first now (see wifi_manager.h): the access point may not exist at
// boot, may come up minutes later as a fallback, and may come down again once
// the station joins. DNSServer binds to whatever address you hand it once and
// never revisits that choice, so it has to be restarted every time this flag
// actually changes, not just started once and left alone.
bool g_apWasActive = false;

// Where a captured request gets sent. Always the AP address rather than the
// mDNS name: a phone deciding whether it is behind a portal has not resolved
// anything yet, and .local would need a second lookup to succeed first.
String portalUrl() {
  return String("http://") + WiFi.softAPIP().toString() + "/";
}

// True when the request was addressed to us by address rather than by one of
// the probe domains we are impersonating.
bool addressedToUs(AsyncWebServerRequest* request) {
  const String host = request->host();
  if (host.length() == 0) return true;
  if (host.startsWith(WiFi.softAPIP().toString())) return true;
  if (WiFi.status() == WL_CONNECTED && host.startsWith(WiFi.localIP().toString())) return true;
  // The name is settable now, so ask for the live one rather than a constant.
  return host.startsWith(netid::hostname());
}

void redirectToPortal(AsyncWebServerRequest* request) {
  AsyncWebServerResponse* response = request->beginResponse(302, "text/plain", "");
  response->addHeader("Location", portalUrl());
  // A portal redirect must never be cached, or the phone keeps following a
  // stale one long after the box has joined a network.
  response->addHeader("Cache-Control", "no-store");
  request->send(response);
}

// Notices the access point coming up or going down and follows it. Called
// from both begin() and tick(): begin() covers the case where the AP is
// already up the moment this runs (nothing saved, so wifinet::begin() raised
// it synchronously), and tick() catches every later transition -- the
// fallback timer raising it minutes into a boot, or it coming down again once
// the station connects.
void syncToAccessPoint() {
  const bool apActive = wifinet::isAccessPointActive();
  if (apActive == g_apWasActive) return;
  g_apWasActive = apActive;

  if (!apActive) {
    if (g_running) {
      g_dns.stop();
      g_running = false;
      Serial.println(F("[portal] access point down, DNS capture stopped"));
    }
    return;
  }

  // The access point just came up. Bind to whatever address it is actually
  // running at right now -- never trust a value cached from before it
  // existed, which is exactly the bug this function exists to fix.
  if (g_running) g_dns.stop();
  g_dns.setErrorReplyCode(DNSReplyCode::NoError);
  g_running = g_dns.start(cfg::DNS_PORT, "*", WiFi.softAPIP());

  if (!g_running) {
    Serial.println(F("[portal] DNS server would not start, no setup sheet will appear"));
  } else {
    Serial.printf("[portal] capturing DNS at %s\n", WiFi.softAPIP().toString().c_str());
  }
}

}  // namespace

void begin() {
  syncToAccessPoint();
}

void attach(AsyncWebServer& server) {
  // The probe URLs each OS uses. Answering these with a redirect rather than
  // the expected body is precisely what raises the setup sheet.
  const char* probes[] = {
      "/generate_204",           // Android
      "/gen_204",                // Android, older
      "/hotspot-detect.html",    // iOS and macOS
      "/library/test/success.html",  // iOS, older
      "/success.txt",            // Firefox
      "/canonical.html",         // Firefox and some Linux desktops
      "/ncsi.txt",               // Windows
      "/connecttest.txt",        // Windows 10 and 11
      "/redirect",               // Windows
  };
  for (const char* path : probes) {
    server.on(path, HTTP_GET, redirectToPortal);
  }

  server.onNotFound([](AsyncWebServerRequest* request) {
    // A CORS preflight must never be turned into a redirect: the browser is
    // asking permission, and a 302 reads as a refusal.
    if (request->method() == HTTP_OPTIONS) {
      request->send(204);
      return;
    }
    if (addressedToUs(request)) {
      request->send(404, "text/plain", "Not found");
      return;
    }
    redirectToPortal(request);
  });
}

void tick() {
  syncToAccessPoint();
  if (g_running) g_dns.processNextRequest();
}

}  // namespace portal
