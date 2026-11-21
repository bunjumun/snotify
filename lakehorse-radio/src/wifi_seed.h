#pragma once
//
// Factory Wi-Fi settings, applied from a file that is never committed.
//
// The saved network lives in NVS and survives reflashing, which is usually what
// you want and exactly what hurts when the router changes: the box keeps trying
// the old network and only comes back through its hotspot. This lets a build
// carry the right network instead.
//
// The credentials sit in src/wifi_defaults.h, which is gitignored. A password
// in a tracked file ends up in git history for good, so the committed template
// is wifi_defaults.example.h and the real one exists on one disk only.
//
// It is applied ONCE per change of that file, not on every boot. A fingerprint
// of what was applied is kept in NVS, so editing the setup page afterwards is
// not silently undone by the next reset, while editing the file and reflashing
// is picked up. With no wifi_defaults.h, or an empty SSID, this does nothing.
//
namespace wifiseed {

// Call after netid::begin() (it sets the .local name) and before
// wifinet::begin() (which reads the saved network).
void apply();

}  // namespace wifiseed
