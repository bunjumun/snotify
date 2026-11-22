#include "wifi_manager.h"

#include <Preferences.h>
#include <WiFi.h>

#include "bt_speaker.h"
#include "config.h"
#include "net_identity.h"

namespace wifinet {
namespace {

StationState g_state = StationState::Idle;
String g_ssid;
uint32_t g_lastAttemptMs = 0;
bool g_haveSaved = false;

// Whether the fallback access point is currently up. Latches true the moment
// it is raised and stays true through every retry after that — see
// beginStationAttempt() below for why a retry does not clear it — until
// AP_TEARDOWN_ON_CONNECT actually tears it down.
bool g_apActive = false;

// Whether the station has connected at least once since boot (or since the
// credentials currently saved were last changed — provision() and forget()
// both reset this). Gates the fallback timer in tick(): WLED's default
// AP_BEHAVIOR_BOOT_NO_CONN raises the access point only for the FIRST
// connection attempt, not on every later drop, so a barn router rebooting
// mid-session does not flash the hotspot on and off while nobody is there to
// see it. Once true, the fallback timer never fires again until this is
// cleared.
bool g_everConnected = false;

// Set by onWiFiEvent() when the station gets an address and the access point
// needs to come down; drained by tick(). Not acted on inside the event
// handler itself, for the same reason g_reconnectPending below is drained in
// tick() rather than at the point that requests it — see that comment.
bool g_apTeardownPending = false;

// Why the last attempt failed, in the radio's own words, kept so the setup page
// can say "the password was not accepted" instead of nothing at all. A box that
// fails silently is indistinguishable from a box that is still trying.
uint8_t g_lastReason = 0;

// Reconfiguring the radio is deliberately NOT done inside the HTTP handler.
// The station refuses a new config while it is mid-association ("sta is
// connecting, cannot set config"), so a provisioning request that lands during
// a retry was simply dropped. These two carry the request out to tick(), which
// disconnects first, waits, and only then begins.
bool g_reconnectPending = false;

// The same deferral as g_reconnectPending, for forgetting a network, and it
// exists because skipping it panicked the box on real hardware. forget() used
// to drop the station and raise the access point from inside the HTTP handler
// that asked for it. Dropping the station destroys every TCP connection on
// that interface -- including the one carrying the request being served -- and
// AsyncTCP's service task then dereferences the freed pcb:
//
//   Guru Meditation Error: Core 1 panic'ed (LoadProhibited)
//   tcp_recved <- AsyncClient::_recv <- _async_service_task
//
// So the handler now only erases NVS and sets this, and every radio call
// happens back in tick(), by which time the reply has left.
bool g_forgetPending = false;

// True from the moment begin() is called until the radio reports either an
// address or a failure.
//
// A timer cannot substitute for this, and trying one was the bug: the station
// stays in its connecting state for the whole WPA handshake, which on a
// rejected password runs a full ten seconds before it times out. Any begin()
// inside that window is refused outright with ESP_ERR_WIFI_STATE and thrown
// away, so a retry or a freshly typed password did nothing at all. Waiting on
// the radio's own events is the only thing that is actually true.
bool g_associating = false;

Preferences g_prefs;

// Reads the saved credentials out of NVS. The password is handed straight to
// WiFi.begin() and deliberately never stored in a longer-lived String than it
// has to be, never printed, and never exposed by any HTTP route.
bool readSaved(String& ssid, String& password) {
  if (!g_prefs.begin(cfg::NVS_NAMESPACE, /*readOnly=*/true)) return false;
  // isKey() first: getString() on a missing key logs an ERROR line from the
  // Preferences library itself, so a perfectly normal first boot prints two
  // scary-looking errors. Checking first keeps a clean boot log actually clean,
  // which matters because that log is how anyone diagnoses this box.
  const bool present = g_prefs.isKey(cfg::NVS_KEY_SSID);
  ssid = present ? g_prefs.getString(cfg::NVS_KEY_SSID, "") : String();
  password = (present && g_prefs.isKey(cfg::NVS_KEY_PASS))
                 ? g_prefs.getString(cfg::NVS_KEY_PASS, "")
                 : String();
  g_prefs.end();
  return ssid.length() > 0;
}

// The handful of reasons that actually happen in a barn, in plain words. The
// rest fall through to a number, which is still better than silence.
const char* describeReason(uint8_t reason) {
  switch (reason) {
    case WIFI_REASON_NO_AP_FOUND:
      return "that network was not found";
    case WIFI_REASON_AUTH_FAIL:
    case WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT:
    case WIFI_REASON_HANDSHAKE_TIMEOUT:
      return "the password was not accepted";
    case WIFI_REASON_AUTH_EXPIRE:
      return "the network dropped the connection";
    case WIFI_REASON_BEACON_TIMEOUT:
      return "the network went out of range";
    default:
      return "could not join";
  }
}

// WLED's disconnect-then-settle-then-hard-reset sequence, run before every
// single station attempt from here on — boot, a provisioning request, and
// every background retry alike, not just the first. This is "the whole fix":
// WiFi.disconnect(true) plus a hard reset to WIFI_MODE_NULL clears whatever
// state the radio was previously in (a running access point, or a join that
// never completed) before asking for a clean one. WLED's own comment on the
// MODE_NULL step: "required on reconnects when mode is already WIFI_STA."
// Skipping it is how the original bug worked: the access point started first,
// pinned the radio to its channel, and the station's join against a different
// channel simply never completed.
void resetRadio() {
  WiFi.disconnect(true);
  delay(cfg::WIFI_MODE_TRANSITION_DELAY_MS);
  WiFi.mode(WIFI_MODE_NULL);
  delay(cfg::WIFI_MODE_TRANSITION_DELAY_MS);

  // Set while still in WIFI_MODE_NULL, not after: WLED's own comment on this
  // is "so that WiFi.mode(WIFI_STA) below actually applies the hostname" --
  // setting it here leaves it pending, and the mode transition just below is
  // what commits it to the driver. Calling it while already in WIFI_STA
  // (unchanged) is a no-op on this core, which is why this has to sit here
  // rather than anywhere more obvious.
  WiFi.setHostname(netid::hostname().c_str());

  // Belt-and-braces beyond what WIFI_MODE_NULL already tore down as a side
  // effect, same as WLED does before every reconnect, not just the first.
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_STA);
}

// Raises the fallback access point (or re-asserts it after resetRadio() has
// just torn it down — softAP() is safe to call again to do that). Always the
// same fixed channel: the ESP32 has one radio and one tuner, so a SoftAp
// started with no channel argument silently claims channel 1 and then fights
// any station trying to join a network on any other channel, which is the bug
// this whole file exists to fix. Passing AP_CHANNEL explicitly is not
// optional.
void raiseAccessPoint() {
  // Explicit, not left to the core's default happening to match: the same
  // "leaving it implicit is how the bug got in" principle AP_CHANNEL exists
  // for, applied to the subnet too. 192.168.4.1 is what the flasher and docs
  // already assume.
  WiFi.softAPConfig(IPAddress(192, 168, 4, 1), IPAddress(192, 168, 4, 1),
                     IPAddress(255, 255, 255, 0));
  const bool apUp = WiFi.softAP(cfg::AP_SSID, cfg::AP_PASSWORD, cfg::AP_CHANNEL);
  if (!apUp) {
    // Nothing else in this firmware can recover from this, and a box with no
    // AP and no saved network is a brick with a power light. Say so.
    Serial.println(F("[wifi] the access point failed to start"));
    // Not left stale-true: a caller re-raising after a resetRadio() teardown
    // (see beginStationAttempt()) trusts this flag to know whether the AP it
    // just tore down actually came back.
    g_apActive = false;
    return;
  }
  g_apActive = true;
  Serial.printf("[wifi] access point \"%s\" up on channel %u at %s\n", cfg::AP_SSID,
                (unsigned)cfg::AP_CHANNEL, WiFi.softAPIP().toString().c_str());
}

// Tears the fallback access point down once the station has an address.
// Idempotent, so a stray extra call (there should not be one) is harmless.
void lowerAccessPoint() {
  if (!g_apActive) return;
  WiFi.softAPdisconnect(true);
  g_apActive = false;
  Serial.println(F("[wifi] access point disabled (connected)"));
}

// Plan verification step 1: prove the channel-mismatch diagnosis on every real
// boot, before trusting anything downstream of it, by scanning for the saved
// network and logging its channel next to the SoftAp's. Filtering the scan to
// one SSID (rather than sweeping and searching the results) makes it quick,
// and a blocking scan is the right call specifically here: nothing else has
// started yet — no access point, no web server, nothing async waiting on the
// radio — so there is nothing for a few blocking seconds to stall. Runs once
// per boot, before the station's first attempt to associate, exactly as the
// plan specifies; it stays in as a permanent boot-time diagnostic rather than
// a one-off check, because the whole point is that the mismatch is otherwise
// invisible.
void logBootChannelDiagnostic(const String& ssid) {
  if (ssid.length() == 0) {
    Serial.println(F("[wifi] no saved network; skipping the boot channel scan"));
    return;
  }

  const int16_t found =
      WiFi.scanNetworks(/*async=*/false, /*show_hidden=*/false, /*passive=*/false,
                         cfg::WIFI_SCAN_DWELL_MS, /*channel=*/0, ssid.c_str());
  if (found <= 0) {
    Serial.printf("[wifi] boot scan: \"%s\" not in range (SoftAp channel is %u)\n",
                  ssid.c_str(), (unsigned)cfg::AP_CHANNEL);
  } else {
    const int32_t netChannel = WiFi.channel(0);
    const bool matches = netChannel == (int32_t)cfg::AP_CHANNEL;
    Serial.printf("[wifi] boot scan: \"%s\" is on channel %d, SoftAp channel is %u%s\n",
                  ssid.c_str(), (int)netChannel, (unsigned)cfg::AP_CHANNEL,
                  matches ? "" : " -- mismatch");
  }
  WiFi.scanDelete();
}

// The actual station attempt, reached from attemptSaved() below whichever way
// it was triggered (boot, a provisioning request, or a background retry).
//
// If the fallback access point is already up, resetRadio() above has just
// physically torn it down — there is one radio — so it is put straight back
// up here before WiFi.begin() is called, rather than left down for the whole
// attempt the way WLED's own default behaviour would leave it. That keeps the
// interruption to the sub-second blip this file already documents as the cost
// of AP_STA (a joined phone is briefly kicked off and has to reassociate)
// instead of turning it into a multi-second gap on every ~30 s retry, which is
// the one thing a box at a gig cannot do.
void beginStationAttempt(const String& ssid, const String& password) {
  // resetRadio() already leaves the radio in WIFI_STA; only the AP, which it
  // just physically tore down, needs putting back if it was up before.
  resetRadio();

  if (g_apActive) raiseAccessPoint();

  g_ssid = ssid;
  g_state = StationState::Connecting;
  g_lastAttemptMs = millis();
  g_associating = true;

  Serial.printf("[wifi] trying saved network \"%s\"\n", ssid.c_str());
  WiFi.begin(ssid.c_str(), password.c_str());

  // Modem sleep makes mDNS replies unreliable: the radio is asleep when the
  // query arrives and the box simply does not answer, which presents as
  // "lakehorse.local sometimes works". Costs power we are not saving anyway,
  // since this thing is mains-powered. Re-applied after every begin() because
  // the mode transition above can reset it, the same reason WLED re-applies
  // its own sleep and TX-power settings on every reconnect rather than once.
  //
  // Except with Bluetooth in the build: IDF 4.4's Wi-Fi/BT coexistence
  // requires modem sleep, and esp_bt_controller_enable aborts in
  // coex_core_enable without it (seen 2026-11-22, boot loop). mDNS may get
  // flakier there; the box's IP still works.
  WiFi.setSleep(btspeaker::needsModemSleep());
}

// Reads NVS and, if anything is saved, starts (or leaves running, if one is
// already in flight) a station attempt via beginStationAttempt(). Returns
// false only when there is nothing saved at all, which is begin()'s signal to
// raise the access point immediately instead.
bool attemptSaved() {
  String ssid, password;
  if (!readSaved(ssid, password)) {
    g_haveSaved = false;
    g_state = StationState::Idle;
    return false;
  }

  g_haveSaved = true;

  // Refuse to begin() on top of an association already in flight. The caller
  // leaves the request pending and tick() comes back once the radio has
  // settled one way or the other.
  if (g_associating) return true;

  beginStationAttempt(ssid, password);
  return true;
}

void onWiFiEvent(WiFiEvent_t event, WiFiEventInfo_t info) {
  switch (event) {
    case ARDUINO_EVENT_WIFI_STA_GOT_IP:
      g_state = StationState::Connected;
      g_lastReason = 0;
      g_associating = false;
      g_everConnected = true;
      // Not torn down here: this handler runs on the WiFi event task and
      // should not make further WiFi-mutating calls any more than it should
      // block (see the DISCONNECTED case below), so the actual
      // softAPdisconnect() happens in tick() once g_apTeardownPending is seen.
      if (cfg::AP_TEARDOWN_ON_CONNECT && g_apActive) g_apTeardownPending = true;
      Serial.printf("[wifi] joined \"%s\" as %s\n",
                    g_ssid.c_str(), WiFi.localIP().toString().c_str());
      break;

    case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
      // Distinguish "never got on" from "was on and dropped", because only the
      // second is worth shouting about. Either way the retry timer in tick()
      // picks it up; we do not reconnect from inside the event handler, which
      // runs on the event task and should not block.
      g_associating = false;
      g_lastReason = info.wifi_sta_disconnected.reason;
      Serial.printf("[wifi] not connected: %s (reason %u)\n",
                    describeReason(g_lastReason), (unsigned)g_lastReason);
      g_state = StationState::Failed;
      break;

    default:
      break;
  }
}

}  // namespace

void begin() {
  WiFi.onEvent(onWiFiEvent);

  // Start from a known-clean radio state before anything else touches it,
  // same as WLED does at the top of every connection attempt, then put the
  // radio into station mode long enough to run the boot diagnostic below.
  // The access point is deliberately NOT raised here even when nothing is
  // saved: attemptSaved() reports that below and begin() raises it through
  // exactly the same call the fallback timer in tick() uses, so there is one
  // place in this file that turns the hotspot on, not two.
  resetRadio();

  String ssid, password;
  readSaved(ssid, password);
  logBootChannelDiagnostic(ssid);

  // If there is a saved network, attemptSaved() below runs resetRadio() again
  // on a radio nothing has touched since the reset just above -- harmless
  // (~10-20ms) and not worth restructuring two call paths to avoid.
  if (!attemptSaved()) raiseAccessPoint();
}

// A pending access-point teardown, set from the event handler once the
// station gets an address, is drained here rather than acted on there — see
// onWiFiEvent()'s GOT_IP case for why. Returns true if it handled one, so
// tick() knows there is nothing further to do this pass.
bool drainApTeardown() {
  if (!g_apTeardownPending) return false;
  g_apTeardownPending = false;
  lowerAccessPoint();
  return true;
}

// Carries out a forget() that the HTTP handler only asked for. Drops the
// station and puts the hotspot up, so the box stays reachable to be
// re-provisioned -- nothing else will bring it back, since the fallback timer
// only counts from an attempt and there is nothing left to attempt.
bool drainForget() {
  if (!g_forgetPending) return false;
  g_forgetPending = false;
  WiFi.disconnect(/*wifioff=*/false, /*eraseap=*/true);
  if (!g_apActive) raiseAccessPoint();
  return true;
}

// A pending reconnect is handled here and out of the request handler that
// asked for it. Returns true if tick() should stop for this pass, whether
// because a reconnect just started or because one is still being waited out.
bool drainPendingReconnect() {
  if (!g_reconnectPending) return false;
  // Wait out whatever is in flight. Nothing else here can make that faster,
  // and interrupting it is what produced ESP_ERR_WIFI_STATE.
  if (g_associating) return true;
  g_reconnectPending = false;
  attemptSaved();
  return true;
}

// The hotspot is a fallback of last resort, not a permanent fixture: it comes
// up once, AP_FALLBACK_AFTER_MS after the first attempt of this connection
// episode, if the station still has not got on — WLED's AP_BEHAVIOR_BOOT_NO_CONN.
// It does not re-raise itself after a LATER drop once the box has connected at
// least once (g_everConnected): a router that reboots mid-session should be
// waited out quietly in the background, not answered by flashing the hotspot
// on and off for however long it takes to come back.
void maybeRaiseFallbackAp(uint32_t now) {
  if (g_apActive || g_everConnected) return;
  if (now - g_lastAttemptMs <= cfg::AP_FALLBACK_AFTER_MS) return;
  Serial.println(F("[wifi] no connection yet, raising the access point as a fallback"));
  raiseAccessPoint();
}

void tick() {
  if (drainForget()) return;
  if (drainApTeardown()) return;
  if (drainPendingReconnect()) return;

  if (g_state == StationState::Connected) return;
  if (!g_haveSaved) return;

  const uint32_t now = millis();
  maybeRaiseFallbackAp(now);

  if (g_state == StationState::Connecting) {
    // Subtraction on unsigned millis is correct across the 49-day rollover;
    // comparing the timestamps directly would not be.
    if (now - g_lastAttemptMs < cfg::STA_CONNECT_TIMEOUT_MS) return;
    Serial.println(F("[wifi] saved network did not answer in time"));
    g_state = StationState::Failed;
    g_lastAttemptMs = now;
    return;
  }

  if (now - g_lastAttemptMs < cfg::STA_RETRY_INTERVAL_MS) return;

  // Route the retry through the same disconnect-then-settle path a provisioning
  // request uses. Calling attemptSaved() straight from here hit exactly the
  // same wall ("sta is connecting, cannot set config"): the previous attempt is
  // often still associating when the retry timer fires, so the retry was being
  // thrown away and the box just kept failing on the original attempt.
  g_lastAttemptMs = now;
  g_reconnectPending = true;
}

bool provision(const String& ssid, const String& password) {
  // The one boundary both the HTTP setup page and anything else that might
  // call this in future have to pass through, so it is the one place this
  // needs enforcing. 802.11 caps an SSID at 32 bytes; WPA2-PSK requires an
  // 8-63 byte password, except an open network, which has none at all.
  if (ssid.length() == 0 || ssid.length() > 32) return false;
  if (password.length() != 0 && (password.length() < 8 || password.length() > 63)) return false;

  if (!g_prefs.begin(cfg::NVS_NAMESPACE, /*readOnly=*/false)) {
    Serial.println(F("[wifi] could not open NVS to save credentials"));
    return false;
  }
  const bool okSsid = g_prefs.putString(cfg::NVS_KEY_SSID, ssid) > 0;
  // An open network has an empty password, so a zero-length write is a success
  // here and must not be treated as a failure.
  g_prefs.putString(cfg::NVS_KEY_PASS, password);
  g_prefs.end();

  if (!okSsid) {
    Serial.println(F("[wifi] writing the SSID to NVS failed"));
    return false;
  }

  // A new network gets its own fair run at the fallback timer, rather than
  // inheriting "already connected once" from whatever was saved before.
  g_everConnected = false;

  // Deferred to tick() for the reason spelled out on g_forgetPending above:
  // the attempt begins with resetRadio(), which tears interfaces down, and
  // this runs on the web server's task with a live request still in hand.
  // Set here rather than read back from NVS a moment from now, so a status
  // poll in between does not claim there is nothing saved.
  g_haveSaved = true;
  g_reconnectPending = true;
  return true;
}

bool forget() {
  if (!g_prefs.begin(cfg::NVS_NAMESPACE, /*readOnly=*/false)) return false;
  g_prefs.remove(cfg::NVS_KEY_SSID);
  g_prefs.remove(cfg::NVS_KEY_PASS);
  g_prefs.end();

  g_haveSaved = false;
  g_state = StationState::Idle;
  g_ssid = "";
  g_reconnectPending = false;
  g_everConnected = false;

  // Every radio call this needs happens in tick() instead -- dropping the
  // station from here kills the connection the caller is still being answered
  // on. See g_forgetPending above for the panic that taught us this.
  g_forgetPending = true;
  return true;
}

void reconnect() {
  if (!g_haveSaved) return;
  g_lastAttemptMs = millis();
  g_reconnectPending = true;
}

StationState stationState() { return g_state; }
uint8_t lastFailureReason() { return g_lastReason; }
const char* lastFailureText() {
  return g_lastReason ? describeReason(g_lastReason) : "";
}
String stationSsid() { return g_ssid; }
String stationIp() {
  return g_state == StationState::Connected ? WiFi.localIP().toString() : String();
}
String accessPointIp() { return WiFi.softAPIP().toString(); }
bool hasSavedNetwork() { return g_haveSaved; }
bool isAccessPointActive() { return g_apActive; }

uint8_t accessPointChannel() {
  // While it is up the radio may have followed the station onto a different
  // channel than the one it was raised with (that following-behaviour is the
  // other half of "one radio, one tuner" — see the file header); report the
  // channel actually running rather than assume it is still AP_CHANNEL.
  return g_apActive ? (uint8_t)WiFi.channel() : cfg::AP_CHANNEL;
}

uint8_t stationChannel() {
  return g_state == StationState::Connected ? (uint8_t)WiFi.channel() : 0;
}

}  // namespace wifinet
