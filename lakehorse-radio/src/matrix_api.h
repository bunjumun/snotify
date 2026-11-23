#pragma once
//
// /api/matrix: the 8x8 lights as the page (and later the real matrix) see them.
//
//   GET  /api/matrix    {"ok":true,"mode":"bars","title":"...","frame":"<64 hex>"}
//   POST /api/matrix    any of: mode=off|bars|title|dazzle|clock|image,
//                       title=<text>, h= m= s= (all three: the phone's time),
//                       image=<64 hex>. Answers with the same object as GET.
//
// POST for every change, as with /api/speaker, so a prefetch cannot act. The
// request is checked whole before any of it is applied: a bad value answers
// 400 with {"ok":false,"error":...} and changes nothing. The frame is rendered
// when asked (matrix_engine.h), so the box does no work while nobody looks.
//
class AsyncWebServer;

namespace matrixapi {

// Must run before the static handler and the captive portal's catch-all.
void attach(AsyncWebServer& server);

}  // namespace matrixapi
