#include "wifi_manager.h"

#include <Preferences.h>
#include <WiFi.h>

#include <mutex>

#include "bt_speaker.h"
#include "config.h"
#include "hotspot_retry.h"
#include "net_identity.h"
#include "saved_networks.h"

namespace wifinet {
namespace {

StationState g_state = StationState::Idle;
String g_ssid;
uint32_t g_lastAttemptMs = 0;

// Every network the box remembers, most recent first (saved_networks.h), and
// which one the next attempt uses. Written from the web task (provision,
// forget, use) and read on the loop task, so every touch holds g_listMutex.
// Passwords live here and in NVS only; nothing prints or serves them.
savednets::List g_nets;
int g_tryIndex = 0;
std::mutex g_listMutex;

// Set on GOT_IP, drained in tick(): the joined network moves to the front of
// the list (an NVS write, so not on the event task), and the moment is kept
// for the hotspot teardown grace.
volatile bool g_promotePending = false;

// Host mode: the owner asked the box to leave its network and serve its own
// hotspot, keeping every saved network. Lasts until a network is chosen (use,
// join) or the box restarts. g_hostPending carries the request from the web
// task to tick(), which owns the radio.
volatile bool g_hostMode = false;
// The keep-trying window after Join or Use now (hotspot_retry.h, inJoinWindow).
volatile bool g_joinWindow = false;
volatile uint32_t g_joinStartMs = 0;
volatile bool g_hostPending = false;
volatile uint32_t g_connectedAtMs = 0;

// g_ssid is written on the loop task and read by status polls and forget()
// on the web task; an Arduino String is not safe to share unguarded.
String currentSsid() {
  std::lock_guard<std::mutex> lock(g_listMutex);
  return g_ssid;
}

bool haveSaved() {
  std::lock_guard<std::mutex> lock(g_listMutex);
  return !g_nets.empty();
}

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

// Join the owner started from the setup page (provision()), as opposed to a
// background retry. g_personPending is set by the HTTP handler and moved to
// g_personAttempt when beginStationAttempt() actually starts it; the attempt flag is
// cleared when that attempt ends (address, failure, or tick()'s timeout). A phone
// joining the hotspot cancels a background search but never one of these, see
// handleHotspotSearch(). volatile: written from the event task and the web task,
// read from the loop task; each is a single bool, so no lock is needed.
volatile bool g_personPending = false;
volatile bool g_personAttempt = false;

// True while the station search is cancelled because a phone is on the hotspot.
// Loop task only.
bool g_searchCancelled = false;

Preferences g_prefs;

// NVS key for slot `i`: the original key for slot 0, so the network saved
// before the list existed is still found, and the key with the number
// appended after that ("ssid1", "pass1", ...).
String slotKey(const char* base, size_t i) {
  return i == 0 ? String(base) : String(base) + String((unsigned)i);
}

// Reads every saved network out of NVS, in order, stopping at the first empty
// slot. isKey() first: getString() on a missing key logs an ERROR line from
// the Preferences library itself, which makes a clean boot log look broken.
savednets::List loadList() {
  savednets::List out;
#ifdef LAKEHORSE_WIFI_UNREACHABLE_TEST
  // Bench-only (env:radio-core2-nowifitest, never in the shipping build): pretend
  // the only saved network is one that does not exist, so the away-from-home path
  // can be tested at the desk. NVS is neither read nor written, so the real saved
  // networks survive and the shipping firmware joins them again after a reflash.
  out.push_back(savednets::Net{"lakehorse-test-no-such-network", ""});
  return out;
#endif
  if (!g_prefs.begin(cfg::NVS_NAMESPACE, /*readOnly=*/true)) return out;
  for (size_t i = 0; i < cfg::SAVED_NETWORKS_MAX; ++i) {
    const String ssidKey = slotKey(cfg::NVS_KEY_SSID, i);
    if (!g_prefs.isKey(ssidKey.c_str())) break;
    const String ssid = g_prefs.getString(ssidKey.c_str(), "");
    if (ssid.length() == 0) break;
    const String passKey = slotKey(cfg::NVS_KEY_PASS, i);
    const String pass =
        g_prefs.isKey(passKey.c_str()) ? g_prefs.getString(passKey.c_str(), "") : String();
    out.push_back(savednets::Net{ssid.c_str(), pass.c_str()});
  }
  g_prefs.end();
  return out;
}

// Writes the whole list, and clears the slots past its end so a shorter list
// does not leave a forgotten network behind to be read back next boot.
bool storeList(const savednets::List& list) {
#ifdef LAKEHORSE_WIFI_UNREACHABLE_TEST
  (void)list;
  return true;
#endif
  if (!g_prefs.begin(cfg::NVS_NAMESPACE, /*readOnly=*/false)) {
    Serial.println(F("[wifi] could not open NVS to save networks"));
    return false;
  }
  bool ok = true;
  for (size_t i = 0; i < cfg::SAVED_NETWORKS_MAX; ++i) {
    const String ssidKey = slotKey(cfg::NVS_KEY_SSID, i);
    const String passKey = slotKey(cfg::NVS_KEY_PASS, i);
    if (i < list.size()) {
      ok = g_prefs.putString(ssidKey.c_str(), list[i].ssid.c_str()) > 0 && ok;
      // An open network has an empty password; a zero-length write is fine.
      g_prefs.putString(passKey.c_str(), list[i].password.c_str());
    } else {
      if (g_prefs.isKey(ssidKey.c_str())) g_prefs.remove(ssidKey.c_str());
      if (g_prefs.isKey(passKey.c_str())) g_prefs.remove(passKey.c_str());
    }
  }
  g_prefs.end();
  if (!ok) Serial.println(F("[wifi] writing a network name to NVS failed"));
  return ok;
}

// The network the next attempt uses. The password is handed straight to
// WiFi.begin() and never printed or exposed by any HTTP route.
bool readSaved(String& ssid, String& password) {
  std::lock_guard<std::mutex> lock(g_listMutex);
  if (g_nets.empty()) return false;
  if (g_tryIndex < 0 || (size_t)g_tryIndex >= g_nets.size()) g_tryIndex = 0;
  const savednets::Net& n = g_nets[(size_t)g_tryIndex];
  ssid = n.ssid.c_str();
  password = n.password.c_str();
  return true;
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
  // The Arduino core's own search loop would otherwise rescan every ~1.7 s for the
  // out-of-range saved network and keep pulling the radio off the hotspot's channel
  // (measured 2026-11-25). Our tick() retry is the only searching while the hotspot
  // is up; auto-reconnect comes back when it is torn down (lowerAccessPoint()).
  WiFi.setAutoReconnect(false);
  Serial.printf("[wifi] access point \"%s\" up on channel %u at %s\n", cfg::AP_SSID,
                (unsigned)cfg::AP_CHANNEL, WiFi.softAPIP().toString().c_str());
}

// Tears the fallback access point down once the station has an address.
// Idempotent, so a stray extra call (there should not be one) is harmless.
void lowerAccessPoint() {
  if (!g_apActive) return;
  WiFi.softAPdisconnect(true);
  g_apActive = false;
  g_searchCancelled = false;
  WiFi.setAutoReconnect(true);
  Serial.println(F("[wifi] access point disabled (connected)"));
}

// Boot scan: which saved network to try first. Nothing else has started
// yet (no access point, no web server, nothing async waiting on the radio),
// so a blocking scan stalls nothing. The strongest saved network in range
// goes first; with none in range the most recent is tried, and the retries
// walk the list from there. Each saved network heard is logged with its
// channel next to the hotspot's, the diagnostic this scan began life as
// (one radio, one tuner: a mismatch is otherwise invisible).
void pickBootNetwork() {
  std::vector<savednets::Seen> seen;
  const int16_t found = WiFi.scanNetworks(/*async=*/false, /*show_hidden=*/false,
                                          /*passive=*/false, cfg::WIFI_SCAN_DWELL_MS);
  for (int16_t i = 0; i < found; ++i) {
    seen.push_back(savednets::Seen{WiFi.SSID(i).c_str(), (int)WiFi.RSSI(i)});
  }
  std::lock_guard<std::mutex> lock(g_listMutex);
  for (int16_t i = 0; i < found; ++i) {
    if (savednets::indexOf(g_nets, seen[(size_t)i].ssid) < 0) continue;
    Serial.printf("[wifi] boot scan: saved \"%s\" heard at %d dBm on channel %d (hotspot channel %u)\n",
                  seen[(size_t)i].ssid.c_str(), seen[(size_t)i].rssi, (int)WiFi.channel(i),
                  (unsigned)cfg::AP_CHANNEL);
  }
  WiFi.scanDelete();
  const int best = savednets::bestInRange(g_nets, seen);
  g_tryIndex = best >= 0 ? best : 0;
  if (best < 0) {
    Serial.printf("[wifi] boot scan: none of %u saved networks in range\n",
                  (unsigned)g_nets.size());
  }
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

  {
    std::lock_guard<std::mutex> lock(g_listMutex);
    g_ssid = ssid;
  }
  g_state = StationState::Connecting;
  g_lastAttemptMs = millis();
  g_associating = true;
  g_personAttempt = g_personPending;
  g_personPending = false;

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
    g_state = StationState::Idle;
    return false;
  }

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
      g_personAttempt = false;
      g_connectedAtMs = millis();
      g_promotePending = true;
      // Not torn down here: this handler runs on the WiFi event task and
      // should not make further WiFi-mutating calls any more than it should
      // block (see the DISCONNECTED case below), so the actual
      // softAPdisconnect() happens in tick() once g_apTeardownPending is seen.
      if (cfg::AP_TEARDOWN_ON_CONNECT && g_apActive) g_apTeardownPending = true;
      Serial.printf("[wifi] joined \"%s\" as %s\n",
                    currentSsid().c_str(), WiFi.localIP().toString().c_str());
      break;

    case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
      // Distinguish "never got on" from "was on and dropped", because only the
      // second is worth shouting about. Either way the retry timer in tick()
      // picks it up; we do not reconnect from inside the event handler, which
      // runs on the event task and should not block.
      g_associating = false;
      g_personAttempt = false;
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

  {
    std::lock_guard<std::mutex> lock(g_listMutex);
    g_nets = loadList();
  }
  if (haveSaved()) pickBootNetwork();
  else Serial.println(F("[wifi] no saved networks; skipping the boot scan"));

  // A setup boot exists because a phone is waiting on the hotspot
  // (setup_boot.h), so the hotspot comes up at once rather than after the
  // usual fallback wait. beginStationAttempt() keeps it up across the attempt.
  if (btspeaker::isSetupBoot()) raiseAccessPoint();

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
  // Held a little while so a phone that set the box up from the hotspot can
  // still read the box's new address off it (cfg::AP_TEARDOWN_GRACE_MS).
  if (millis() - g_connectedAtMs < cfg::AP_TEARDOWN_GRACE_MS) return false;
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

// WLED's "disable search so that AP can work": a search for the saved network that is
// still running when a phone joins the hotspot is cancelled, and the wait for the next
// one restarts once the last phone has left. The client count is read here on the loop
// task, never inside the Wi-Fi event handler. A join the owner started from the setup
// page is never cancelled (see hotspot_retry.h for the decision and its tests).
// Returns true if it acted, so tick() stops for this pass.
bool handleHotspotSearch(uint32_t now) {
  const int apClients = g_apActive ? (int)WiFi.softAPgetStationNum() : 0;
  const bool personAttempt = g_personAttempt || g_personPending;
  switch (hotspotretry::searchAction(g_apActive, apClients,
                                      g_state == StationState::Connected, personAttempt,
                                      g_searchCancelled)) {
    case hotspotretry::SearchAction::Cancel:
      g_searchCancelled = true;
      // Only an attempt actually in flight needs stopping; disconnecting an idle
      // station just logs a driver error.
      if (g_associating) WiFi.disconnect(/*wifioff=*/false, /*eraseap=*/false);
      g_associating = false;
      g_state = StationState::Failed;
      g_lastAttemptMs = now;
      Serial.println(F("[wifi] a phone joined the hotspot, search for the saved network paused"));
      return true;
    case hotspotretry::SearchAction::Resume:
      g_searchCancelled = false;
      // Count the usual wait from now rather than searching at once, so a phone that
      // is only reconnecting is not met by a scan.
      g_lastAttemptMs = now;
      Serial.println(F("[wifi] the hotspot is empty again, search for the saved network resumes"));
      return false;
    case hotspotretry::SearchAction::None:
      break;
  }
  return false;
}

// The network just joined moves to the front of the list, so it is the first
// guess next boot. Written only when the order actually changes.
void drainPromote() {
  if (!g_promotePending) return;
  g_promotePending = false;
  std::lock_guard<std::mutex> lock(g_listMutex);
  const savednets::List next = savednets::promote(g_nets, g_ssid.c_str());
  g_tryIndex = 0;
  if (savednets::sameOrder(next, g_nets)) return;
  g_nets = next;
  storeList(g_nets);
}

// Carries out hostMode(): drops the station without forgetting anything and
// puts the hotspot up. While g_hostMode holds, tick() starts no attempt.
void drainHostMode() {
  g_hostPending = false;
  g_reconnectPending = false;
  g_personPending = false;
  g_apTeardownPending = false;
  g_searchCancelled = false;
  WiFi.disconnect(/*wifioff=*/false, /*eraseap=*/false);
  g_associating = false;
  g_state = StationState::Idle;
  if (!g_apActive) raiseAccessPoint();
  Serial.println(F("[wifi] host mode: serving its own hotspot, saved networks kept"));
}

void tick() {
  drainPromote();
  if (g_hostPending) { drainHostMode(); return; }
  if (g_hostMode && !g_reconnectPending) return;
  if (drainForget()) return;
  if (drainApTeardown()) return;
  if (drainPendingReconnect()) return;
  const bool saved = haveSaved();
  if (saved && handleHotspotSearch(millis())) return;

  if (g_state == StationState::Connected) { g_joinWindow = false; return; }
  if (!saved) return;

  const uint32_t now = millis();
  maybeRaiseFallbackAp(now);

  if (g_state == StationState::Connecting) {
    // Subtraction on unsigned millis is correct across the 49-day rollover;
    // comparing the timestamps directly would not be.
    if (now - g_lastAttemptMs < cfg::STA_CONNECT_TIMEOUT_MS) return;
    Serial.println(F("[wifi] saved network did not answer in time"));
    g_personAttempt = false;
    g_state = StationState::Failed;
    g_lastAttemptMs = now;
    return;
  }

  // Retry the saved network far less often while a phone is joined to the
  // hotspot: a retry resets the one radio and throws that phone off, and a
  // phone cannot finish the setup sheet if it is kicked off every 30 s (found
  // 2026-11-25, see hotspot_retry.h). WLED does the same with a 5 minute wait.
  const int apClients = g_apActive ? (int)WiFi.softAPgetStationNum() : 0;
  const bool joining =
      hotspotretry::inJoinWindow(now, g_joinStartMs, cfg::JOIN_KEEP_TRYING_MS, g_joinWindow);
  if (!joining) g_joinWindow = false;
  const uint32_t retryMs = joining ? cfg::STA_RETRY_DURING_JOIN_MS
                                   : hotspotretry::intervalMs(cfg::STA_RETRY_INTERVAL_MS,
                                                              cfg::STA_RETRY_INTERVAL_WITH_AP_CLIENT_MS,
                                                              g_apActive, apClients);
  if (!hotspotretry::due(now, g_lastAttemptMs, retryMs)) return;

  // Route the retry through the same disconnect-then-settle path a provisioning
  // request uses. Calling attemptSaved() straight from here hit exactly the
  // same wall ("sta is connecting, cannot set config"): the previous attempt is
  // often still associating when the retry timer fires, so the retry was being
  // thrown away and the box just kept failing on the original attempt.
  g_lastAttemptMs = now;
  if (joining) {
    // Same network again, still counted as the owner's own join so a phone on
    // the hotspot does not cancel it.
    g_personPending = true;
  } else {
    // The last one did not answer: the next retry tries the next saved network.
    std::lock_guard<std::mutex> lock(g_listMutex);
    g_tryIndex = savednets::next(g_tryIndex, g_nets.size());
  }
  g_reconnectPending = true;
}

bool provision(const String& ssid, const String& password) {
  // The one boundary both the HTTP setup page and anything else that might
  // call this in future have to pass through, so it is the one place this
  // needs enforcing (saved_networks.h, valid()).
  if (!savednets::valid(ssid.c_str(), password.c_str())) return false;

  {
    std::lock_guard<std::mutex> lock(g_listMutex);
    const savednets::List next =
        savednets::remember(g_nets, ssid.c_str(), password.c_str(), cfg::SAVED_NETWORKS_MAX);
    if (!storeList(next)) return false;
    g_nets = next;
    g_tryIndex = 0;
  }

  // A new network gets its own fair run at the fallback timer, rather than
  // inheriting "already connected once" from whatever was joined before.
  g_everConnected = false;

  // Deferred to tick(): the attempt begins with resetRadio(), which tears
  // interfaces down, and this runs on the web server's task with a live
  // request still in hand (see g_forgetPending above).
  g_hostMode = false;
  g_hostPending = false;
  g_joinStartMs = millis();
  g_joinWindow = true;
  g_personPending = true;
  g_reconnectPending = true;
  return true;
}

bool use(const String& ssid) {
  {
    std::lock_guard<std::mutex> lock(g_listMutex);
    const int at = savednets::indexOf(g_nets, ssid.c_str());
    if (at < 0) return false;
    g_tryIndex = at;
  }
  g_hostMode = false;
  g_hostPending = false;
  g_joinStartMs = millis();
  g_joinWindow = true;
  g_personPending = true;
  g_reconnectPending = true;
  return true;
}

void hostMode() {
  g_joinWindow = false;
  g_hostMode = true;
  g_hostPending = true;
}

bool inHostMode() { return g_hostMode; }

bool forget(const String& which) {
  const String current = currentSsid();
  const String ssid = which.length() ? which : current;
  bool nowEmpty = false;
  {
    std::lock_guard<std::mutex> lock(g_listMutex);
    const savednets::List next = savednets::forget(g_nets, ssid.c_str());
    if (next.size() == g_nets.size()) return false;
    if (!storeList(next)) return false;
    g_nets = next;
    nowEmpty = g_nets.empty();
    const int at = savednets::indexOf(g_nets, current.c_str());
    g_tryIndex = at >= 0 ? at : 0;
  }

  // Forgetting a network the box is not on changes nothing on the radio.
  if (!nowEmpty && ssid != current) return true;

  g_personPending = false;
  g_personAttempt = false;
  g_searchCancelled = false;
  g_everConnected = false;

  if (!nowEmpty) {
    // Others are left: leave this one and try them, through tick().
    g_lastAttemptMs = millis();
    g_reconnectPending = true;
    return true;
  }

  g_state = StationState::Idle;
  {
    std::lock_guard<std::mutex> lock(g_listMutex);
    g_ssid = "";
  }
  g_reconnectPending = false;
  // Every radio call this needs happens in tick() instead -- dropping the
  // station from here kills the connection the caller is still being answered
  // on. See g_forgetPending above for the panic that taught us this.
  g_forgetPending = true;
  return true;
}

std::vector<String> savedNames() {
  std::vector<String> out;
  std::lock_guard<std::mutex> lock(g_listMutex);
  for (const savednets::Net& n : g_nets) out.push_back(String(n.ssid.c_str()));
  return out;
}

int accessPointClients() { return g_apActive ? (int)WiFi.softAPgetStationNum() : 0; }

void reconnect() {
  if (!haveSaved() || g_hostMode) return;
  g_lastAttemptMs = millis();
  g_reconnectPending = true;
}

StationState stationState() { return g_state; }
uint8_t lastFailureReason() { return g_lastReason; }
const char* lastFailureText() {
  return g_lastReason ? describeReason(g_lastReason) : "";
}
String stationSsid() { return currentSsid(); }
String stationIp() {
  return g_state == StationState::Connected ? WiFi.localIP().toString() : String();
}
String accessPointIp() { return WiFi.softAPIP().toString(); }
bool hasSavedNetwork() { return haveSaved(); }
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
