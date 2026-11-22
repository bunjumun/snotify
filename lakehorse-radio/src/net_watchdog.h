#pragma once
//
// Pings the gateway and recovers a Wi-Fi link that went deaf while still
// "connected" (the wedge in link_watch.h): rejoin first, restart only if that
// did not help and nothing is playing. Serial log only, prefix [watch].
//
namespace netwatch {

// Call from loop(). Cheap when nothing is due.
void tick();

}  // namespace netwatch
