# Lakehorse Radio: shell and virtual matrix plan (2026-11-22)

Status: design agreed, nothing built. Mockups: https://claude.ai/artifact/RE4wj9H6tigS4ziEgkLP61 (phone screens plus one desktop screen). This file is the handoff for the code session. Read BRAINSTORM-BRIEF.md and HANDOFF.md first, and FEATURE-IDEAS.md for the wider idea list.

## What is being built

A "crashed spaceship OS" front end for the box (the ship is called the ENIAS), styled like an old desktop from a parallel reality: dark gray windows, dazzle-camo wallpaper, desktop icons, a taskbar with a Start button, and a Start menu that holds settings. The music player is open the moment the page loads. One page serves phones and wide screens, with windows stacked full-width on a phone and floating on a wide screen.

When no home Wi-Fi is saved, the captive portal serves the same page with the Start menu open and Network highlighted. A virtual matrix window shows exactly what the 8x8 LED matrix would show, and works with no matrix attached. It also has a full-screen mode. The real matrix driver comes last.

## Will it run on this box? Findings and the checks that settle them

- **Flash:** LittleFS is 512 KB and the page is 136 KB today. The shell is estimated at roughly 250 KB with fonts, uncompressed. It fits and needs no partition change.
- **Load speed with Bluetooth on:** pages download at only 22 to 40 KB/s, so 250 KB would take 6 to 11 seconds on every load. The server uses plain serveStatic with no cache headers and the data folder holds no .gz files. Fix: ship gzip copies of the page files (serveStatic should serve a .gz sibling automatically, to be verified) and set cache headers. This is Module 1 and must pass before any shell work.
- **Fonts:** the box's own network has no internet, so Google Fonts will not load. Use subsetted woff2 files for VT323 and IBM Plex Mono (both open-licensed), or system monospace if the files cost too much. Measure the sizes.
- **RAM:** the engine is small. The 64-pixel frame buffer and pattern state must be static globals in internal RAM, not heap or PSRAM, because this chip (rev v1.0) has the PSRAM cache fault. Keep any new task to about 4 KB of stack, or run the engine from an existing task, and record free heap before and after. Idle free heap is about 50.8 KB while Bluetooth plays.
- **Polling:** the virtual matrix polls only while its window is open, one request at a time, about four per second, backing off if responses are slow and pausing when the tab is hidden. Sending a 64-character frame keeps each reply tiny.
- **Audio-reactive patterns:** the box only has samples when it plays the audio itself (speaker mode). In phone mode the browser plays the audio, so bars there have to come from the page (Web Audio analyser). First version: bars from the box in speaker mode, and from the page in phone mode for the virtual window only. Pushing page levels to the real matrix is a later decision.
- **Old iPhones:** the mockups use clip-path, repeating gradients, inset and accent-color, which iOS 16 on the iPhone 8 supports. Test on that phone.
- **Captive portal sheet:** the sheet phones open after joining is a limited browser. Keep the first-run view to Wi-Fi setup and tell the user to open lakehorseradio.local in their normal browser afterwards. Test on an iPhone and an Android phone.
- **Speaker toggle:** "Optimize for this device" is the existing Bluetooth off setting plus a restart (about 10 seconds), so the busy page covers it. No new firmware behavior.

## Modules (one at a time, stop and report after each, with a code audit)

1. **Page weight and caching.** Measure current page load time with Bluetooth on and off. Add gzip copies of the page files and cache headers. Pass: first load under about 3 seconds at the Bluetooth-on speed, repeat loads served from cache. Stop.
2. **Frame engine and endpoint.** Native-tested C++: a 64-pixel buffer, pattern functions (sound bars fed by a test source, song title scroll with a small bitmap font, dazzle drift, clock from phone time, image frames, off), and `GET /api/matrix` returning a 64-character frame plus the mode name. No LED driver and no audio tap yet. Pass: native tests green, free heap cost recorded. Stop.
   - **↳ DONE 2026-11-22, see HANDOFF.md "Shell Module 2".**
3. **Virtual matrix window.** The window from the mockup with mode buttons, brightness and full-screen view, opened from Start > Matrix lights and by tapping the small preview in the player. Pass: renders on the iPhone 8, no extra requests while closed. Stop.
4. **Shell reskin.** Desktop, taskbar, Start menu and window frames around the existing player, which opens first. First-run view chosen by whether a home network is saved. Keep existing behavior and tests passing. Stop.
   - **↳ Built 2026-11-22, see HANDOFF.md "Shell Module 4"; awaiting flash and iPhone 8 check.**
5. **Network and Speaker windows.** Network setup including the "box drops its own Wi-Fi while joining" note, and the Speaker window with the existing speaker controls and the Optimize ticker. Stop.
   - **↳ Built 2026-11-22, see HANDOFF.md "Shell Module 5"; awaiting flash.**
6. **Audio reactivity from samples.** (Widened 2026-11-22 at the owner's request: reactivity is a matrix feature, not just a bars mode. The engine takes eight band levels as a general input; Bars draws them and Dazzle brightens with them, and later patterns can use them too.) Compute eight band levels in the reader task from the PCM it already reads (a Goertzel or bucketed approach), and feed the engine. Pass: no underruns over a full song. Stop.
   - **↳ DONE 2026-11-22, see HANDOFF.md "Shell Module 6".** 0 underruns over a full song; minFreeHeap 26,024 (one-time dip, flat after).
7. **Matrix hardware.** The bench test from the earlier Module 1 handoff (GPIO 27, 330 ohm data resistor, 1000 uF capacitor, 150 mA limit on a computer USB port), then the driver reading the same frame buffer. Do this when the matrix is wired.

8. **ENIAS alignment and Drive B.** Full brief, credit rules and the save design are in ALIGNMENT-BRIEF.md. In short: a per-track band flag, a point counter in NVS fed by finished songs and cleared game levels at equal weight, a small event endpoint, the Drive B window, and a matrix Alignment pattern. Pass: counter survives a reboot, an unflagged track never counts, a skip before 50% never counts. Stop.
   - **↳ Piece 1 (flag, counter, event endpoint, status total) built 2026-11-23, native tests green and verified on the box (minFreeHeap A/B still open), see HANDOFF.md "Shell Module 8, piece 1". Drive B window, matrix pattern and game reporting not started.**

Deferred: games, clock and alarm screens, crew profiles, the FLAC question, and the board swap.

## Open decisions

- Whether phone-mode bars should ever drive the real matrix.
- Font choice once sizes are measured.
- Exact captive-portal behavior on each phone type.
