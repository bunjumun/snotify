#pragma once
//
// What makes a legal .local name.
//
// Its own file, and free of every Arduino header, so the rules can be tested on
// a laptop. A hostname arrives from a form over the network, so it is untrusted
// input like any other, and getting it wrong is not harmless: mDNS silently
// fails to advertise an illegal name, which presents as "the box vanished from
// the network" rather than as a rejected form.
//
// The rules are a single DNS label per RFC 1123: letters, digits and hyphens,
// no leading or trailing hyphen. Case is folded to lower, because mDNS
// comparison is case-insensitive and echoing back a different case than the
// user gets in their browser is just confusing.
//
#include <stddef.h>

namespace hostrules {

enum class Result { Ok, Empty, TooLong, IllegalCharacter, EdgeHyphen };

const char* describe(Result r);

// `out` receives the lower-cased name and must hold maxLen + 1 bytes.
Result normalise(const char* in, char* out, size_t maxLen);

}  // namespace hostrules
