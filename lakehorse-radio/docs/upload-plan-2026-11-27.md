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

## Decisions (owner, 2026-11-27)
1. wav44 for every upload: **yes**.
2. Phone uploads: **not needed**, so whole-song decode is acceptable (a clear error still shows if memory runs out).
3. Phase B: **worth it if the hardware can handle it**. Decided to measure first (spike) before committing.

## Status
- **Phase A built 2026-11-27** (not yet committed when this was written): `data/sliceupload.js` (pause/resume/cancel/retry loop, `test/sliceupload.test.js`), wav44 default in `data/library.js`, 24/32-bit 44.1 kHz stereo WAVs still stream (no whole-song decode), new `POST /api/sd/upload-cancel?name=` in `src/web_server.cpp`, Pause/Cancel buttons, note text fixed.
- **Phase C support check: FLAC encoding is NOT available.** Chromium 156 (the Claude app's browser): `AudioEncoder.isConfigSupported({codec:'flac'})` returns `supported: false`; AAC is supported. Safari and Firefox not checked (Chrome is the one that matters for uploads from a computer).
- **Consequence for Phase B:** without a browser FLAC encoder, only files that are already FLAC could shrink in transfer, and the browser would still have to decode them to check/convert the shape. The only route to shrinking WAV/MP3 uploads is a WASM FLAC encoder (libflac.js, ~100 KB gzipped, which may fit the ~400 KB free in LittleFS; to be measured) plus the on-box FLAC decoder job. Phase B is therefore on hold pending that decision.

## Encoder size measured (2026-11-27)
libflacjs 5.6.0 (`dist/libflac.min.wasm.js` 110 KB, `libflac.min.wasm.wasm` 131 KB): **26 KB + 57 KB = about 84 KB gzipped**. The LittleFS image now holds about 89 KB gzipped of 512 KB, so the encoder would bring it to about 173 KB. It fits with room to spare, which removes the earlier objection to Phase C. Still to check: the box serves `.wasm` with the right MIME type, and that libflac.js encodes a 7-minute song in the browser at a usable speed.

## Phase C built (2026-11-27): browser FLAC encoder
- `data/flacencode.js` wraps libflac.js (`data/libflac.min.wasm.js` + `.wasm`, MIT, `data/libflac.LICENSE.txt`). Takes 16-bit interleaved PCM at any rate/channels, writes FLAC to a sink with back-pressure. Header carries the exact length.
- `test/flacencode.test.js` (5 tests, real library): stereo, mono with odd chunks, silence, full-scale extremes, and 7 minutes of stereo all **decode back bit-exact**. 7 minutes encodes in 0.8 s in Node.
- Real browser (Chromium 156, library loaded by script tag, `.wasm` served as `application/wasm`): 60 s of stereo encoded in 132 ms, no errors.
- **Not wired into uploads yet, on purpose.** The box cannot play FLAC until Phase B (on-box decode) exists, so sending FLAC now would store unplayable files.
- **Integration notes for when B lands:**
  - `tools/gzip_data.py` folds every local `<script>` into `bundle.js`. libflac (110 KB, 26 KB gzipped) must be loaded on demand when an upload starts, not bundled for every visitor.
  - `.wasm` is not in `COMPRESS_EXTENSIONS`, so it would be stored raw (131 KB). Total with the encoder ~245 KB of the 512 KB image. Fine; gzipping the wasm would need the library's loader to cope with `Content-Encoding`, which browsers handle transparently, but the box's MIME type for `.wasm` still needs checking (instantiateStreaming wants `application/wasm`; the loader falls back if not).
  - FLAC is lossless: the box gets back exactly the 44.1 kHz 16-bit stereo samples wavconvert.js produced, so the on-box decoder only has to write them out behind a WAV header.

## Phase B spike result (2026-11-27): the box CAN decode FLAC
Built `env:radio-core2-flacspike` (flag `LAKEHORSE_FLAC_SPIKE`, `src/flac_spike.cpp`, dr_flac 0.13.5 vendored as `src/dr_flac.h`, public domain/MIT-0; +52 KB flash, no change to the shipping env). Decode runs in its own task (core 0, priority 1, 8 KB stack), buffers in PSRAM. Test: 90 s of 44.1 kHz 16-bit stereo, 11.0 MB FLAC to a 15.9 MB WAV, on the real box, Wi-Fi up.
- **Bit-exact:** output WAV data identical to the source (CRC and full byte compare); the FLAC arrived intact through the sliced upload (one dropped slice retried).
- **Speed:** 54.6-54.9 s for 90 s of audio (1.65x realtime) over 3 runs. Split: SD read 15.4 s, SD write 17.7 s, the rest decode CPU plus a 1-tick yield per 4096 frames. A 7-minute song decodes in about 4.3 minutes. Dropping or shortening the yield would shave some.
- **Web server stayed responsive** during decode: /api/status 20-130 ms throughout (same as idle).
- **Heap:** internal free 80 KB before; the box's overall low-water mark was 51.9 KB and did not go lower during decode. PSRAM use returned to the pre-run figure (no leak). Not yet tested: Bluetooth connected and playing during a decode.
- **Honest payoff:** transfer measured at 36 KB/s. This FLAC is 69% of its WAV (a dithered 24-bit master is noisy; not the 50% hoped). For a 7-minute song: WAV 77 MB = about 36 min to send; FLAC 53 MB = about 24 min plus about 4 min decode on the box = about 28 min. A saving of roughly 20%, bought with a decoder in firmware, a recovery path and a new failure mode. Worth it only if the Wi-Fi cannot be improved, so improving the link first is the cheaper win.
- **Not built:** the production decode job (upload as `.flac`, commit, convert, verify, boot recovery, status route), and the page side switch to FLAC.
- Left on the card by the test: `Clip.flac` and `Clip.decoded.wav` (my test files; delete from the page).

## Phase B built (2026-11-28): FLAC is now the transfer format
- Page: `data/flacsend.js` encodes the converted 44.1 kHz 16-bit WAV to FLAC (libflac loaded only when an upload starts) and sends `Song.flac`; falls back to the WAV if the encoder will not load or the FLAC is not smaller. After the last slice it POSTs `/api/sd/convert` and polls `/api/sd/convert-status`.
- Box: `src/flac_convert.cpp` (dr_flac, own task on core 0, priority 1) writes `Song.wav.part`, checks frame count and byte size, commits, then deletes the `.flac`. On any failure the `.part` is removed and the `.flac` kept. Boot recovery: a `.flac` left on the card is converted 15 s after start-up. The spike env and files were removed.
- Gotcha: `/api/sd` GET also matches every path under it, so `/api/sd/convert-status` is registered before it.
- Verified on the box: 30 s noisy stereo song, 5.29 MB WAV sent as 2.44 MB FLAC, converted on the box, output byte-identical (CRC match). Boot recovery verified (first run hit a stale-size check bug, fixed; the kept `.flac` converted by itself after reflash).
- Not tested: conversion while Bluetooth is playing; a multi-minute song end to end.
