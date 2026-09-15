#pragma once
//
// The pairing key — a proportionate lock, not a security system.
//
// The threat being defended against is a bandmate or a stranger at a gig
// rewriting the set list, not a determined attacker. Anyone who can reach the
// box can already READ the playlist, and should be able to; only writing is
// gated.
//
// How it works, and why this shape:
//
//   * The key is generated on first boot from the hardware RNG and kept in NVS.
//     It is never compiled in, so two boxes never share a key and nothing
//     secret is ever committed to the repo.
//   * It is handed out only to clients on the box's own access-point subnet.
//     Joining that AP means standing next to the box, which is exactly the
//     proximity check a barn appliance wants. Someone on the wider barn network
//     cannot ask for it.
//   * It is not a password anyone types or remembers. The flasher fetches it
//     once while paired to the AP and keeps it.
//
#include <Arduino.h>

namespace devkey {

// Loads the stored key, generating and persisting one if this is first boot.
void begin();

const String& value();

// True if the supplied header matched. Comparison is length-checked first and
// then constant-time, which costs nothing here and avoids making the check
// itself a hint.
bool matches(const String& supplied);

}  // namespace devkey
