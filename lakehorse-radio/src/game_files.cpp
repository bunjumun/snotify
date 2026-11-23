#include "game_files.h"

#include <string.h>

namespace gamefiles {
namespace {

struct Ext {
  const char* ext;
  const char* mime;
};

const Ext kExtensions[] = {
    {"html", "text/html; charset=utf-8"},
    {"js", "text/javascript; charset=utf-8"},
    {"mjs", "text/javascript; charset=utf-8"},
    {"css", "text/css; charset=utf-8"},
    {"json", "application/json"},
    {"png", "image/png"},
    {"jpg", "image/jpeg"},
    {"svg", "image/svg+xml"},
    {"woff2", "font/woff2"},
    {"glb", "model/gltf-binary"},
    {"wav", "audio/wav"},
    {"mp3", "audio/mpeg"},
    {"ogg", "audio/ogg"},
};

char lower(char c) { return (c >= 'A' && c <= 'Z') ? (char)(c + 32) : c; }

bool isEnd(const char* name, size_t len, const char* suffix) {
  const size_t n = strlen(suffix);
  if (len < n) return false;
  for (size_t i = 0; i < n; ++i) {
    if (lower(name[len - n + i]) != suffix[i]) return false;
  }
  return true;
}

bool segmentChar(char c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
         c == '.' || c == '-' || c == '_';
}

}  // namespace

const char* contentType(const char* name) {
  if (name == nullptr) return nullptr;
  size_t len = strlen(name);
  if (isEnd(name, len, ".gz")) len -= 3;
  for (const Ext& e : kExtensions) {
    char dotted[8];
    dotted[0] = '.';
    strncpy(dotted + 1, e.ext, sizeof(dotted) - 2);
    dotted[sizeof(dotted) - 1] = '\0';
    if (isEnd(name, len, dotted)) return e.mime;
  }
  return nullptr;
}

Result resolve(const char* rel, char* out, size_t maxLen) {
  if (rel == nullptr) return Result::BadPath;
  while (*rel == '/') ++rel;  // "/game//x" is the same file as "/game/x"

  static const char kIndex[] = "index.html";
  const size_t relLen = strnlen(rel, maxLen + 2);
  const bool wantsIndex = relLen == 0 || rel[relLen - 1] == '/';
  const size_t total = relLen + (wantsIndex ? sizeof(kIndex) - 1 : 0);
  if (total > maxLen) return Result::TooLong;

  memcpy(out, rel, relLen);
  if (wantsIndex) memcpy(out + relLen, kIndex, sizeof(kIndex));
  else out[relLen] = '\0';

  // Walk segment by segment: each must be non-empty, safe, and not hidden.
  const char* seg = out;
  for (const char* p = out;; ++p) {
    if (*p == '/' || *p == '\0') {
      if (p == seg) return Result::BadPath;           // empty segment ("a//b")
      if (seg[0] == '.') return Result::BadPath;      // hidden, "." or ".."
      if (*p == '\0') break;
      seg = p + 1;
    } else if (!segmentChar(*p)) {
      return Result::BadPath;
    }
  }

  if (contentType(out) == nullptr) return Result::BadExtension;
  return Result::Ok;
}

}  // namespace gamefiles
