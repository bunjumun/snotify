#pragma once
//
// ENIAS alignment: the point counter behind Drive B (ALIGNMENT-BRIEF.md).
//
// Arduino-free, so the credit rules run on a laptop (test/test_alignment).
// Storage (NVS) and the band-track list (SD card) come in from outside
// through small interfaces; alignment_box.cpp is the box-side glue.
//
// Not thread-safe by itself. The glue serialises every call with one mutex,
// because the reader task (song events) and the web server (level events,
// phone-mode songs) are different tasks.
//
#include <stddef.h>
#include <stdint.h>

namespace alignment {

// Tunables (defined in one block at the top of alignment.cpp).
extern const uint16_t kPointsFull;      // flagged song played to the end
extern const uint16_t kPointsPartial;   // flagged song left after passing the half
extern const uint16_t kPointsClear;     // level cleared
extern const uint16_t kPointsAttempt;   // level attempt that ended without a clear
extern const uint16_t kNodePoints;      // points per node
extern const uint16_t kMaxPoints;       // the full bar (64 nodes)
extern const uint16_t kNodeCount;
extern const float kPartialFraction;    // played share a song needs before it earns anything
extern const uint32_t kRepeatWindowMs;  // the same event inside this is ignored
extern const uint8_t kMaxLevelId;       // level ids are 0..kMaxLevelId (bit in a uint32)
extern const size_t kMaxIdLength;

enum class Source : uint8_t { Song, Level };
enum class Result : uint8_t { Full, Partial, Clear, Attempt };
enum class Outcome : uint8_t { Credited, Repeat, Invalid };

struct EventResult {
  Outcome outcome;
  uint16_t added;  // points this event earned (0 at the cap)
  uint16_t total;
};

// The save. One small write per credited event.
class Storage {
 public:
  virtual ~Storage() {}
  virtual bool load(uint16_t& points, uint32_t& levels) = 0;
  virtual bool save(uint16_t points, uint32_t levels) = 0;
};

class Counter {
 public:
  // Reads the save. A missing or unreadable save starts at zero.
  void begin(Storage* storage);

  // `nowMs` is any monotonic millisecond clock (wraparound is fine).
  EventResult submit(Source source, const char* id, Result result, uint32_t nowMs);

  uint16_t points() const { return points_; }
  uint32_t levelsCleared() const { return levels_; }
  uint16_t nodes() const;
  uint8_t percent() const;  // points / 6400, rounded down

 private:
  struct Recent {
    bool used;
    Source source;
    Result result;
    uint32_t at;
    char id[48];
  };
  static constexpr size_t kRecent = 8;

  bool isRepeat(Source s, const char* id, Result r, uint32_t now) const;
  void remember(Source s, const char* id, Result r, uint32_t now);

  Storage* storage_ = nullptr;
  uint16_t points_ = 0;
  uint32_t levels_ = 0;
  Recent recent_[kRecent] = {};
  size_t nextRecent_ = 0;
};

// What leaving a track earns. `fraction` is the share of the track actually
// played since the last seek (0..1). False means nothing; true sets `out`.
// Below the half nothing is earned however the track was left; past it, a
// track that ran out earns Full and one stopped or skipped earns Partial.
bool resultForLeaving(float fraction, bool reachedEnd, Result& out);

// band-tracks.json: {"version":1,"tracks":["Song.wav", ...]}. True only when
// the file parses and lists `name` exactly. Anything malformed flags nothing.
bool bandListContains(const char* json, size_t length, const char* name);

// The page's playlist.json: true when some track's "title" equals `title`.
bool playlistHasTitle(const char* json, size_t length, const char* title);

}  // namespace alignment
