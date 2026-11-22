#include "net_watchdog.h"

#include <Arduino.h>
#include <WiFi.h>
#include <atomic>

#include "lwip/ip_addr.h"
#include "ping/ping_sock.h"

#include "box_player.h"
#include "config.h"
#include "link_watch.h"
#include "wifi_manager.h"

namespace netwatch {
namespace {

// The ping session runs on its own small task (esp_ping) and reports through
// these two flags; tick() reads them on the loop task. One session is kept
// for as long as the gateway stays the same, because each new session is a
// new task stack carved out of the internal RAM Bluetooth left behind.
std::atomic<bool> g_replied{false};
std::atomic<bool> g_done{false};

esp_ping_handle_t g_session = nullptr;
uint32_t g_gateway = 0;  // the address g_session pings
bool g_inFlight = false;
uint32_t g_lastProbeMs = 0;
uint32_t g_probeStartMs = 0;

linkwatch::Watch g_watch({cfg::WATCH_FAILS_TO_RECONNECT, cfg::WATCH_RECONNECTS_BEFORE_RESTART});

void onReply(esp_ping_handle_t, void*) { g_replied = true; }
void onEnd(esp_ping_handle_t, void*) { g_done = true; }

// Makes sure g_session targets `gateway`. A new gateway is a new network, so
// the watch is disarmed until that router has shown it answers ping.
bool ensureSession(uint32_t gateway) {
  if (g_session && gateway == g_gateway) return true;
  if (g_session) {
    esp_ping_delete_session(g_session);
    g_session = nullptr;
  }
  g_watch.reset();

  esp_ping_config_t config = ESP_PING_DEFAULT_CONFIG();
  config.count = cfg::WATCH_PINGS_PER_PROBE;
  config.interval_ms = cfg::WATCH_PING_INTERVAL_MS;
  config.timeout_ms = cfg::WATCH_PING_TIMEOUT_MS;
  ip_addr_set_ip4_u32(&config.target_addr, gateway);

  esp_ping_callbacks_t cbs = {};
  cbs.on_ping_success = onReply;
  cbs.on_ping_end = onEnd;

  const esp_err_t err = esp_ping_new_session(&config, &cbs, &g_session);
  if (err != ESP_OK) {
    Serial.printf("[watch] cannot start a ping session: %s\n", esp_err_to_name(err));
    g_session = nullptr;
    return false;
  }
  g_gateway = gateway;
  return true;
}

bool songPlaying() {
  return boxplayer::status().state == boxplayer::State::Playing;
}

void act(linkwatch::Action action) {
  switch (action) {
    case linkwatch::Action::None:
      return;
    case linkwatch::Action::Reconnect:
      Serial.printf("[watch] gateway silent for %u probes: rejoining Wi-Fi\n",
                    (unsigned)cfg::WATCH_FAILS_TO_RECONNECT);
      wifinet::reconnect();
      return;
    case linkwatch::Action::Restart:
      Serial.println(F("[watch] rejoining did not bring the gateway back: restarting"));
      Serial.flush();
      ESP.restart();
      return;
  }
}

// Collects a finished probe, or gives up on one that never finished: a
// session whose end never arrives is itself a sign the network stack is stuck.
void collect(uint32_t now) {
  bool answered;
  if (g_done) {
    answered = g_replied;
  } else if (now - g_probeStartMs > cfg::WATCH_PROBE_DEADLINE_MS) {
    esp_ping_stop(g_session);
    answered = false;
  } else {
    return;
  }
  g_inFlight = false;

#if LAKEHORSE_WATCHDOG_DRILL
  // Test build only (HANDOFF.md): once armed, pretend the gateway went quiet,
  // so the rejoin and restart paths can be watched on real hardware.
  if (g_watch.armed()) answered = false;
#endif

  const bool armed = g_watch.armed();
  const linkwatch::Action action = g_watch.onProbe(answered, !songPlaying());
  // Unarmed silence is a router that ignores ping, not news.
  if (!answered && armed) {
    Serial.printf("[watch] gateway did not answer (failures %u, rejoins %u)\n",
                  (unsigned)g_watch.failures(), (unsigned)g_watch.reconnects());
  }
  act(action);
}

}  // namespace

void tick() {
  const uint32_t now = millis();
  if (g_inFlight) {
    collect(now);
    return;
  }
  // Only a station that believes it is connected is checked. A plain outage
  // (router off, out of range) is wifi_manager's to retry; restarting would
  // not bring a router back.
  if (wifinet::stationState() != wifinet::StationState::Connected) return;
  if (now - g_lastProbeMs < cfg::WATCH_PROBE_EVERY_MS) return;
  g_lastProbeMs = now;

  const uint32_t gateway = (uint32_t)WiFi.gatewayIP();
  if (gateway == 0 || !ensureSession(gateway)) return;

  g_replied = false;
  g_done = false;
  if (esp_ping_start(g_session) != ESP_OK) return;
  g_inFlight = true;
  g_probeStartMs = now;
}

}  // namespace netwatch
