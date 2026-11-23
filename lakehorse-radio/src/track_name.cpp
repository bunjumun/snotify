#include "track_name.h"

#include <string.h>

namespace trackname {
namespace {

struct Ext {
  const char* ext;
  const char* mime;
};

// The formats a phone's <audio> element will stream. WAV is here because the
// band masters are WAV; the page converts 24-bit ones to 16-bit before upload.
const Ext kExtensions[] = {
    {"wav", "audio/wav"},  {"mp3", "audio/mpeg"}, {"m4a", "audio/mp4"},
    {"aac", "audio/aac"},  {"ogg", "audio/ogg"},  {"opus", "audio/ogg"},
    {"flac", "audio/flac"},
};

char lower(char c) { return (c >= 'A' && c <= 'Z') ? (char)(c + 32) : c; }

const Ext* findExtension(const char* name) {
  const char* dot = strrchr(name, '.');
  if (dot == nullptr || dot[1] == '\0') return nullptr;
  for (const Ext& e : kExtensions) {
    const char* a = dot + 1;
    const char* b = e.ext;
    while (*a != '\0' && *b != '\0' && lower(*a) == *b) { ++a; ++b; }
    if (*a == '\0' && *b == '\0') return &e;
  }
  return nullptr;
}

}  // namespace

const char* describe(Result r) {
  switch (r) {
    case Result::Ok: return "ok";
    case Result::Empty: return "the file has no name";
    case Result::TooLong: return "the file name is too long";
    case Result::BadExtension:
      return "only wav, mp3, m4a, aac, ogg and opus files can be stored";
    case Result::Hidden: return "hidden files cannot be stored";
  }
  return "unknown error";
}

Result sanitise(const char* in, char* out, size_t maxLen) {
  if (in == nullptr) return Result::Empty;

  // Drop everything up to the last separator of either kind: Windows browsers
  // have been seen to send a full path, and a '/' must never survive.
  const char* base = in;
  for (const char* p = in; *p != '\0'; ++p) {
    if (*p == '/' || *p == '\\') base = p + 1;
  }

  const size_t len = strnlen(base, maxLen + 1);
  if (len == 0) return Result::Empty;
  if (len > maxLen) return Result::TooLong;
  if (base[0] == '.') return Result::Hidden;

  for (size_t i = 0; i < len; ++i) {
    const char c = base[i];
    const bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
                    (c >= '0' && c <= '9') || c == ' ' || c == '.' ||
                    c == '-' || c == '_' || c == '(' || c == ')';
    out[i] = ok ? c : '_';
  }
  out[len] = '\0';

  if (findExtension(out) == nullptr) return Result::BadExtension;
  return Result::Ok;
}

const char* contentType(const char* name) {
  const Ext* e = (name == nullptr) ? nullptr : findExtension(name);
  return e != nullptr ? e->mime : "application/octet-stream";
}

}  // namespace trackname
