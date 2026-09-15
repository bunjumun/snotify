#pragma once
//
// Captive portal — the thing that makes a phone pop up a setup page when it
// joins the box's access point.
//
// The mechanism, because it is less magical than it looks: every operating
// system probes a known URL on its own domain the moment it joins a network,
// and decides "this network has internet" from the answer. Apple asks
// captive.apple.com for a page containing the word Success; Android asks
// gstatic.com for an empty 204. We run a DNS server that answers EVERY name
// with our own address, so those probes arrive here, and we answer them with a
// redirect instead of what they wanted. The OS concludes it is behind a portal
// and opens the sheet.
//
// The honest limitation, which the setup page itself also states: that sheet is
// a cut-down webview, and on a network with no real internet it cannot play
// audio from the open web. It is the right place to CONFIGURE the box and the
// wrong place to listen from. The page says so rather than appearing broken.
//
#include <ESPAsyncWebServer.h>

namespace portal {

// Starts the wildcard DNS server on the access-point address.
void begin();

// Registers the probe routes and the catch-all redirect on the shared server.
// Call this AFTER the real routes are registered: onNotFound only fires for
// requests nothing else claimed.
void attach(AsyncWebServer& server);

// Must be called from loop(). DNSServer is polled, not interrupt-driven, and a
// portal that stops answering DNS stops being a portal.
void tick();

}  // namespace portal
