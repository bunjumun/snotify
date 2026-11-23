#include "alignment_test_routes.h"

#ifdef LAKEHORSE_ALIGN_TEST
#include "alignment_box.h"

namespace aligntest {
namespace {
constexpr size_t kMaxBody = 4096;
struct Body {
  size_t len;
  char data[kMaxBody];
};
}  // namespace

void attach(AsyncWebServer& server) {
  server.on("/api/test/align-reset", HTTP_POST, [](AsyncWebServerRequest* r) {
    alignment::testReset();
    r->send(200, "application/json", "{\"ok\":true}");
  });
  server.on(
      "/api/test/band-tracks", HTTP_POST,
      [](AsyncWebServerRequest* r) {
        Body* b = static_cast<Body*>(r->_tempObject);
        const bool ok = b && alignment::testWriteBandList(b->data, b->len);
        r->send(ok ? 200 : 400, "application/json", ok ? "{\"ok\":true}" : "{\"ok\":false}");
      },
      nullptr,
      [](AsyncWebServerRequest* r, uint8_t* data, size_t len, size_t index, size_t total) {
        if (total == 0 || total > kMaxBody) return;
        if (index == 0) r->_tempObject = calloc(1, sizeof(Body));
        Body* b = static_cast<Body*>(r->_tempObject);
        if (!b || index + len > kMaxBody) return;
        memcpy(b->data + index, data, len);
        b->len = index + len;
      });
}
}  // namespace aligntest
#endif
