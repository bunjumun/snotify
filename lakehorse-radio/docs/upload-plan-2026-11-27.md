# Upload plan: Bluetooth-ready tracks, pause/cancel, FLAC as transfer format

Written 2026-11-27 after the sliced-upload fix (commit e2b1f6d) and browser FLAC decode (9be9035). Nothing below is built yet.

## Goals
1. Every uploaded track ends up Bluetooth-ready: 16-bit PCM WAV, 44.1 kHz, stereo.
2. Pause / Resume / Cancel buttons on an upload in progress.
3. Smaller transfers (the Wi-Fi is the bottleneck): send FLAC, let the box decode it once after the transfer.
4. Fix the stale page note ("prepare them with song prep").

## Facts this rests on
- Box plays only 16-bit PCM WAV (`src/pcm_format.cpp`; accepts 1-2 channels, 8-96 kHz). It has no FLAC decoder.
- Browser side: `data/wavconvert.js` already has `format: 'wav44'` (decode, mix to stereo, 44.1 kHz, dither to 16-bit) and sliced upload with resume (`data/library.js` `sendSliced`, firmware `openUploadFile`).
- `.part` files are deleted on boot (`sd_store.cpp removeLeftovers`).
- Box internal RAM is tight (~80 KB free at idle). Rev v1.0 chip has the PSRAM cache bug: only large buffers (16 KB+) may live in PSRAM (`config.h` notes).
- LittleFS is 512 KB, ~104 KB used, so ~400 KB free for page assets. This rules out shipping a large WASM encoder from the box.
- FLAC is ~50-60% of the WAV size, so a transfer as FLAC is roughly 40-50% shorter.

## Phase A: page + one small firmware route (low risk, do first)
1. **Bluetooth-ready for everything.** `library.js` calls `toBlob(file, progress, {format: 'wav44'})`. Already-ready WAVs (16-bit, 44.1 kHz, stereo) pass through; 24/32-bit WAVs that are already 44.1 kHz stereo keep the streaming path (no whole-song decode); everything else (mono, 48 kHz, MP3, M4A, AAC, OGG, FLAC) is decoded and resampled in the browser. Cost: whole-song decode in memory (~150 MB per 7 min), fine on a computer, may fail on a phone, so show a clear error ("this file is too big for this browser to convert") instead of a hang.
2. **Pause / Resume.** `sendSliced` gets a `paused` flag checked between slices; Pause finishes the in-flight slice, then waits. Resume continues from the same offset. The `.part` stays on the card meanwhile. Edge: an idle `.part` is deleted on box reboot, so Resume after a reboot gets a 409 and restarts from 0 (already handled by the 409 path).
3. **Cancel.** Page: abort the in-flight XHR, stop the loop. Firmware: new `POST /api/sd/upload-cancel?name=` that removes `<name>.part` (name through `trackname::sanitise`, same guard as delete). Needs a firmware flash.
4. **UI.** Pause/Resume toggle and Cancel button next to the progress bar (`#sdBar`), shown only during an upload; status line shows "paused at X MB". Disable the file picker while an upload runs (already done).
5. **Note text.** Replace the sentence with: "Every song is converted to 44.1 kHz 16-bit stereo WAV in your browser, so it plays on the page and over Bluetooth."
6. **Tests.** Node tests for the pause/cancel state logic (extract the slice loop's control flow into a small testable function), and for `wav44` choice per input type with the stub decoder.

Verification: upload 24-bit 48 kHz WAV, mono MP3, FLAC; confirm each lands as 44.1 kHz stereo 16-bit (size = 44 + frames x 4); pause mid-upload, wait, resume; cancel mid-upload and confirm no `.part` remains (`/api/sd` plus a reboot-free check of free space).

## Phase B: FLAC as the transfer format, box decodes once (firmware, needs your OK)
This is a new dependency and a background job on the box, so it is gated on your go-ahead.
1. **Design.** Browser does all format work first (decode, resample, stereo, 16-bit), then sends the result as FLAC. The box never resamples: it only turns 16-bit FLAC into the same bytes as a 16-bit WAV. This keeps firmware simple and resolves the conflict between goals 1 and 3.
2. **Upload.** Same sliced route, name ends `.flac`. Stored as `<name>.flac.part`, committed to `/music/<name>.flac`.
3. **Decode job.** After commit, a single background task (own small stack, low priority) streams SD to SD: FLAC frames to PCM to `<name>.wav.part`, then rename; delete the `.flac` only after the WAV is verified (size = 44 + samples x channels x 2, and header consistent). Library: microFLAC (esphome-libs/micro-flac, ESP32-tuned) or dr_flac. Memory: block buffer 16-64 KB (max block size x channels x 4), put in PSRAM (it is large, so allowed), decoder object ~200 B. One job at a time, and refuse to start while a song streams or an upload runs.
4. **Reporting.** `GET /api/sd` lists `.flac` pending files with state; `POST /api/sd/upload` answers `{done:true, converting:true}`; page shows "converting on the box..." and polls `/api/sd/convert-status`. On failure: delete both parts, keep the `.flac` for retry, report the reason.
5. **Boot recovery.** On boot, delete `.wav.part`; if a `.flac` exists without its `.wav`, resume the decode.
6. **Risks to measure first (a spike, 1-2 hours):** decode speed vs SD write speed on this card (expect SD-bound), heap low-water during decode with Wi-Fi up, behavior with Bluetooth on (compile-time BT is on by default; box needs RAM), and the 8x8 matrix build's lower RAM.
Decision for you: Phase B only pays off with Phase C (or FLAC inputs you already have).

## Phase C: browser WAV to FLAC encoder (so WAV and MP3 inputs shrink too)
- **First check:** does this Chrome/Safari `AudioEncoder.isConfigSupported({codec:'flac', ...})`? The WebCodecs FLAC registration exists, but support is optional and not confirmed shipping. Test in the target browsers before building anything.
- If supported: use it (no dependency, no page size cost).
- If not: a WASM encoder (libflac.js) is hundreds of KB, which does not fit comfortably in the box's 512 KB LittleFS alongside the page. Options: skip Phase C (FLAC inputs only), or make the page load the encoder from a user-provided file/URL (awkward), or enlarge the filesystem partition (reflash, partition change, riskier).
- Recommendation: do the support check; if it fails, stop after Phase B and accept that only existing FLAC files shrink.

## Order and effort
A (about half a day, one firmware flash for cancel) -> support check for C (15 min) -> B spike (measure) -> B build -> C if supported.

## Open questions for you
1. OK to make wav44 (everything converted to 44.1 kHz stereo) the default for every upload? Mono and 48 kHz files lose their original rate; sizes grow for MP3/AAC.
2. Is a phone ever the uploading device? If yes, whole-song decode may fail there; we could cap file size or warn.
3. Phase B/C: worth the new dependency and background job, or is Phase A plus a better Wi-Fi enough?
