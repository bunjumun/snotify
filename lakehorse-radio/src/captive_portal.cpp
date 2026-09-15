#include "captive_portal.h"

#include <DNSServer.h>
#include <WiFi.h>

#include "config.h"

namespace portal {
namespace {

DNSServer g_dns;
bool g_running = false;

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
  return host.startsWith(cfg::MDNS_HOST);
}

void redirectToPortal(AsyncWebServerRequest* request) {
  AsyncWebServerResponse* response = request->beginResponse(302, "text/plain", "");
  response->addHeader("Location", portalUrl());
  // A portal redirect must never be cached, or the phone keeps following a
  // stale one long after the box has joined a network.
  response->addHeader("Cache-Control", "no-store");
  request->send(response);
}

}  // namespace

void begin() {
  // Answer every name with our own address. This is what turns an ordinary
  // web server into a captive portal.
  g_dns.setErrorReplyCode(DNSReplyCode::NoError);
  g_running = g_dns.start(cfg::DNS_PORT, "*", WiFi.softAPIP());

  if (!g_running) {
    Serial.println(F("[portal] DNS server would not start, no setup sheet will appear"));
  } else {
    Serial.printf("[portal] capturing DNS at %s\n", WiFi.softAPIP().toString().c_str());
  }
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
  if (g_running) g_dns.processNextRequest();
}

}  // namespace portal
