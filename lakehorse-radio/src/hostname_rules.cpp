#include "hostname_rules.h"

#include <string.h>

namespace hostrules {

const char* describe(Result r) {
  switch (r) {
    case Result::Ok: return "ok";
    case Result::Empty: return "the name cannot be empty";
    case Result::TooLong: return "the name is too long";
    case Result::IllegalCharacter:
      return "use only letters, numbers and hyphens, with no dots or spaces";
    case Result::EdgeHyphen: return "the name cannot start or end with a hyphen";
  }
  return "unknown error";
}

Result normalise(const char* in, char* out, size_t maxLen) {
  if (in == nullptr) return Result::Empty;

  const size_t len = strnlen(in, maxLen + 1);
  if (len == 0) return Result::Empty;
  if (len > maxLen) return Result::TooLong;

  for (size_t i = 0; i < len; ++i) {
    const char c = in[i];
    const bool upper = (c >= 'A' && c <= 'Z');
    const bool lower = (c >= 'a' && c <= 'z');
    const bool digit = (c >= '0' && c <= '9');
    const bool hyphen = (c == '-');

    // A dot is rejected rather than trimmed. Someone typing "radio.local"
    // means the whole name, and quietly keeping only "radio" would leave them
    // looking for an address the box is not answering to.
    if (!upper && !lower && !digit && !hyphen) return Result::IllegalCharacter;

    out[i] = upper ? (char)(c - 'A' + 'a') : c;
  }
  out[len] = '\0';

  if (out[0] == '-' || out[len - 1] == '-') return Result::EdgeHyphen;
  return Result::Ok;
}

}  // namespace hostrules
