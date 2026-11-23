#pragma once
//
// Which files under /game/ may be served from the SD card.
//
// Its own file, free of Arduino headers, so the rules run on a laptop. The URL
// is untrusted: "/game/../Music/x.wav" or "/game/.Spotlight-V100/..." must
// never reach the filesystem call. Unlike track_name.h this allows
// sub-folders (a game has assets/ and src/ trees), so it validates segment by
// segment instead of flattening the name.
//
#include <stddef.h>

namespace gamefiles {

enum class Result { Ok, TooLong, BadPath, BadExtension };

// `rel` is the URL path after "/game/". An empty path or one ending in '/'
// maps to index.html. On Ok, `out` holds the cleaned relative path (no leading
// slash) and must hold maxLen + 1 bytes. Segments may only use
// [A-Za-z0-9._-], must not start with '.', and the extension must be one of
// the web types in contentType().
Result resolve(const char* rel, char* out, size_t maxLen);

// MIME type from the extension; nullptr when the extension is not servable.
// A trailing ".gz" is looked through (app.js.gz -> javascript).
const char* contentType(const char* name);

}  // namespace gamefiles
