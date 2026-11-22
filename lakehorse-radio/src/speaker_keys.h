#pragma once
//
// What the speaker's own buttons do. A Bluetooth speaker sends AVRCP
// "passthrough" commands when its play/pause, skip or back button is pressed;
// the box is the player, so it has to obey or the page and the speaker
// disagree (pausing on the speaker used to freeze the page's position).
//
// Pure, so the mapping can be tested on a laptop. The key codes are the AVRCP
// ones (esp_avrc_api.h, ESP_AVRC_PT_CMD_*); they are repeated here as numbers
// so this file needs nothing from the Bluetooth stack.
//
#include <stdint.h>

namespace speakerkeys {

enum class Action { None, Pause, Resume, Next, Restart };

// `released` is false for the press and true for the release that follows;
// only the press acts, or one tap would do everything twice. `playing` is
// whether a song is playing right now: speakers differ on whether the
// play/pause button sends PLAY for both directions or PAUSE for one, so PLAY
// toggles and PAUSE and STOP only ever pause.
Action actionFor(uint8_t key, bool released, bool playing);

}  // namespace speakerkeys
