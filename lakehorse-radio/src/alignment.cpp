#include "alignment.h"

#include <ArduinoJson.h>
#include <string.h>

namespace alignment {

// ---- the numbers: tune here and nowhere else (ALIGNMENT-BRIEF.md) ----
const uint16_t kPointsFull = 100;
const uint16_t kPointsPartial = 10;
const uint16_t kPointsClear = 100;
const uint16_t kPointsAttempt = 5;
const uint16_t kNodePoints = 100;
const uint16_t kNodeCount = 64;
const uint16_t kMaxPoints = kNodePoints * kNodeCount;  // 6400
const float kPartialFraction = 0.5f;
const uint32_t kRepeatWindowMs = 10000;
const uint8_t kMaxLevelId = 31;
const size_t kMaxIdLength = 47;  // fits Recent::id with its terminator
// ----------------------------------------------------------------------

namespace {

uint16_t pointsFor(Result r) {
  switch (r) {
    case Result::Full: return kPointsFull;
    case Result::Partial: return kPointsPartial;
    case Result::Clear: return kPointsClear;
    case Result::Attempt: return kPointsAttempt;
  }
  return 0;
}

bool resultFitsSource(Source s, Result r) {
  if (s == Source::Song) return r == Result::Full || r == Result::Partial;
  return r == Result::Clear || r == Result::Attempt;
}

// Strict 0..kMaxLevelId, digits only.
bool parseLevel(const char* id, uint8_t& out) {
  const size_t n = strlen(id);
  if (n == 0 || n > 2) return false;
  if (n == 2 && id[0] == '0') return false;  // one spelling per level ("01" would dodge the repeat window)
  unsigned v = 0;
  for (size_t i = 0; i < n; ++i) {
    if (id[i] < '0' || id[i] > '9') return false;
    v = v * 10 + (unsigned)(id[i] - '0');
  }
  if (v > kMaxLevelId) return false;
  out = (uint8_t)v;
  return true;
}

}  // namespace

void Counter::begin(Storage* storage) {
  storage_ = storage;
  points_ = 0;
  levels_ = 0;
  memset(recent_, 0, sizeof recent_);
  nextRecent_ = 0;
  if (!storage_) return;
  uint16_t p = 0;
  uint32_t l = 0;
  if (storage_->load(p, l)) {
    points_ = p > kMaxPoints ? kMaxPoints : p;
    levels_ = l;
  }
}

uint16_t Counter::nodes() const { return points_ / kNodePoints; }

uint8_t Counter::percent() const { return (uint8_t)((uint32_t)points_ * 100u / kMaxPoints); }

bool Counter::isRepeat(Source s, const char* id, Result r, uint32_t now) const {
  for (const Recent& e : recent_) {
    if (e.used && e.source == s && e.result == r && strcmp(e.id, id) == 0 &&
        (uint32_t)(now - e.at) < kRepeatWindowMs) {
      return true;
    }
  }
  return false;
}

void Counter::remember(Source s, const char* id, Result r, uint32_t now) {
  // Reuse this event's own slot if it has one (an expired earlier copy),
  // otherwise take the next slot round-robin.
  size_t slot = nextRecent_;
  bool reuse = false;
  for (size_t i = 0; i < kRecent; ++i) {
    const Recent& e = recent_[i];
    if (e.used && e.source == s && e.result == r && strcmp(e.id, id) == 0) {
      slot = i;
      reuse = true;
      break;
    }
  }
  Recent& e = recent_[slot];
  e.used = true;
  e.source = s;
  e.result = r;
  e.at = now;
  strncpy(e.id, id, sizeof e.id - 1);
  e.id[sizeof e.id - 1] = '\0';
  if (!reuse) nextRecent_ = (nextRecent_ + 1) % kRecent;
}

EventResult Counter::submit(Source source, const char* id, Result result, uint32_t nowMs) {
  const EventResult invalid{Outcome::Invalid, 0, points_};
  if (!id || !id[0] || strlen(id) > kMaxIdLength) return invalid;
  if (!resultFitsSource(source, result)) return invalid;
  uint8_t level = 0;
  if (source == Source::Level && !parseLevel(id, level)) return invalid;

  if (isRepeat(source, id, result, nowMs)) return {Outcome::Repeat, 0, points_};
  remember(source, id, result, nowMs);

  const uint32_t before = points_;
  uint32_t after = before + pointsFor(result);
  if (after > kMaxPoints) after = kMaxPoints;
  const uint32_t levelsBefore = levels_;
  if (source == Source::Level && result == Result::Clear) levels_ |= (1u << level);

  points_ = (uint16_t)after;
  if (storage_ && (points_ != before || levels_ != levelsBefore)) {
    storage_->save(points_, levels_);  // on failure the total still counts until reboot
  }
  return {Outcome::Credited, (uint16_t)(after - before), points_};
}

bool resultForLeaving(float fraction, bool reachedEnd, Result& out) {
  if (!(fraction >= kPartialFraction)) return false;  // also false for NaN
  out = reachedEnd ? Result::Full : Result::Partial;
  return true;
}

bool bandListContains(const char* json, size_t length, const char* name) {
  if (!json || !name || !name[0]) return false;
  JsonDocument doc;
  if (deserializeJson(doc, json, length)) return false;
  JsonArrayConst tracks = doc["tracks"].as<JsonArrayConst>();
  for (JsonVariantConst v : tracks) {
    const char* s = v.as<const char*>();
    if (s && strcmp(s, name) == 0) return true;
  }
  return false;
}

bool playlistHasTitle(const char* json, size_t length, const char* title) {
  if (!json || !title || !title[0]) return false;
  JsonDocument doc;
  if (deserializeJson(doc, json, length)) return false;
  JsonArrayConst tracks = doc["tracks"].as<JsonArrayConst>();
  for (JsonVariantConst t : tracks) {
    const char* s = t["title"].as<const char*>();
    if (s && strcmp(s, title) == 0) return true;
  }
  return false;
}

}  // namespace alignment
