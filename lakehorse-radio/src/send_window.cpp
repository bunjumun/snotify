#include "send_window.h"

#include <AsyncTCP.h>
#include <lwip/priv/tcpip_priv.h>
#include <lwip/tcp.h>

#include "config.h"

namespace sendwindow {
namespace {

struct CapCall {
  tcpip_api_call_data call;  // must be first: lwIP casts back to it
  tcp_pcb* pcb;
};

// Runs on the lwIP thread, the only place a pcb may be touched safely.
err_t capOnTcpip(tcpip_api_call_data* data) {
  CapCall* c = reinterpret_cast<CapCall*>(data);
  if (c->pcb && c->pcb->state == ESTABLISHED && c->pcb->snd_buf > cfg::HTTP_SEND_WINDOW) {
    c->pcb->snd_buf = cfg::HTTP_SEND_WINDOW;
  }
  return ERR_OK;
}

}  // namespace

void cap(AsyncClient* client) {
  if (client == nullptr || client->pcb() == nullptr) return;
  CapCall c{};
  c.pcb = client->pcb();
  tcpip_api_call(capOnTcpip, &c.call);
}

}  // namespace sendwindow
