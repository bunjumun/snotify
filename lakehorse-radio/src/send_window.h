#pragma once
//
// Caps how much unacknowledged data one HTTP connection may queue.
//
// Why: with Bluetooth up, about 36 KB of internal RAM is left, and every byte
// a connection has in flight is held twice in it, once by lwIP until it is
// acknowledged and once by the Wi-Fi driver's dynamic TX buffer until it goes
// out. At lwIP's default 5,760-byte window, one ordinary page load (six
// parallel connections) needs far more than is free; the Wi-Fi driver then
// cannot get receive buffers and the box goes permanently deaf on the network
// while still believing it is connected (2026-11-22).
//
// The cap is lwIP's per-connection snd_buf, lowered before the response
// starts. lwIP gives snd_buf back only as data is acknowledged, so the lower
// value holds for the life of the connection.
//
class AsyncClient;

namespace sendwindow {

// Call from the AsyncTCP task, before anything is written to the connection.
void cap(AsyncClient* client);

}  // namespace sendwindow
