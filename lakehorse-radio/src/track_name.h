#pragma once
//
// What makes a legal stored track name.
//
// Its own file, and free of every Arduino header, so the rules can be tested on
// a laptop. A filename arrives from a browser's multipart upload and from a URL
// on the way back out, so it is untrusted both ways, and the failure here is
// not cosmetic: a name like "../../etc" or ".Spotlight-V100" must never reach
// the filesystem call.
//
// The policy is to clean rather than reject where cleaning is safe (a phone
// happily sends "Mango Tree's Mix #2.wav"), and to reject where it is not (no
// name left, wrong extension, hidden file).
//
#include <stddef.h>

namespace trackname {

enum class Result { Ok, Empty, TooLong, BadExtension, Hidden };

const char* describe(Result r);

// Strips any directory part, replaces characters outside [A-Za-z0-9 ._()-]
// with '_', and requires an audio extension. `out` receives the safe name and
// must hold maxLen + 1 bytes.
Result sanitise(const char* in, char* out, size_t maxLen);

// MIME type for a stored file, chosen from its extension. Falls back to
// application/octet-stream for anything unrecognised.
const char* contentType(const char* name);

}  // namespace trackname
