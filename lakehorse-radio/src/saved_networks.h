#pragma once
//
// The networks the box remembers, as a plain list it can reason about.
//
// Until 2026-11-25 the box remembered one network. Taken away from home it
// fell back to its own hotspot, and with Bluetooth on that hotspot cannot
// serve pages: the access point, DHCP and captive DNS together starve the
// internal heap Bluetooth has already taken (HANDOFF.md, "Hotspot with
// Bluetooth ON starves the network stack"). As a station joined to someone
// else's network the box runs none of those, and that is the setup that
// already works with Bluetooth on at home. So the fix is not more memory, it
// is more places to be a station: home, a venue, or the owner's phone
// hotspot, all saved, the box joining whichever is in range.
//
// Most recent first, because "the one you joined last" is the best guess
// for the next boot when two are in range at equal strength, and because
// dropping the oldest is the obvious thing to do when the list is full.
//
// Every function returns a new list and leaves its argument alone. Arduino
// free, so `pio test -e native` can drive it (test/test_savednets);
// wifi_manager.cpp does the NVS and the radio.
//
#include <stddef.h>

#include <string>
#include <vector>

namespace savednets {

struct Net {
  std::string ssid;
  std::string password;
};

using List = std::vector<Net>;

// A network a scan saw, and how strongly.
struct Seen {
  std::string ssid;
  int rssi;
};

// 802.11 caps a name at 32 bytes; WPA2-PSK wants 8 to 63, or nothing at all
// for an open network.
inline bool valid(const std::string& ssid, const std::string& password) {
  if (ssid.empty() || ssid.size() > 32) return false;
  if (password.empty()) return true;
  return password.size() >= 8 && password.size() <= 63;
}

inline int indexOf(const List& list, const std::string& ssid) {
  for (size_t i = 0; i < list.size(); ++i) {
    if (list[i].ssid == ssid) return (int)i;
  }
  return -1;
}

// `ssid` first with this password, any older entry of the same name gone,
// trimmed to `maxCount` by dropping from the end.
inline List remember(const List& list, const std::string& ssid, const std::string& password,
                     size_t maxCount) {
  List out;
  out.push_back(Net{ssid, password});
  for (const Net& n : list) {
    if (out.size() >= maxCount) break;
    if (n.ssid != ssid) out.push_back(n);
  }
  return out;
}

// The same list with `ssid` moved to the front, password kept. Unchanged if
// it is not there.
inline List promote(const List& list, const std::string& ssid) {
  const int at = indexOf(list, ssid);
  if (at < 0) return list;
  List out;
  out.push_back(list[(size_t)at]);
  for (size_t i = 0; i < list.size(); ++i) {
    if ((int)i != at) out.push_back(list[i]);
  }
  return out;
}

inline List forget(const List& list, const std::string& ssid) {
  List out;
  for (const Net& n : list) {
    if (n.ssid != ssid) out.push_back(n);
  }
  return out;
}

// Index of the saved network the scan heard loudest, or -1 when none of them
// was heard. Ties go to the earlier (more recent) entry.
inline int bestInRange(const List& list, const std::vector<Seen>& seen) {
  int best = -1;
  int bestRssi = -1000;
  for (size_t i = 0; i < list.size(); ++i) {
    for (const Seen& s : seen) {
      if (s.ssid == list[i].ssid && s.rssi > bestRssi) {
        best = (int)i;
        bestRssi = s.rssi;
      }
    }
  }
  return best;
}

// The entry to try after `current`, wrapping. 0 for an empty list.
inline int next(int current, size_t count) {
  if (count == 0) return 0;
  const int n = current + 1;
  return (n < 0 || (size_t)n >= count) ? 0 : n;
}

inline bool sameOrder(const List& a, const List& b) {
  if (a.size() != b.size()) return false;
  for (size_t i = 0; i < a.size(); ++i) {
    if (a[i].ssid != b[i].ssid || a[i].password != b[i].password) return false;
  }
  return true;
}

}  // namespace savednets
