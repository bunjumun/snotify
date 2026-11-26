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

## Standing rule: every usable feature has help (decided 2026-11-25, widened the same day)

Features are meant to be stumbled on and used without explanation, but anyone who wonders what something does can ask, about literally every usable feature, not just each window. Nothing explains itself unprompted.

- **What's this? mode, Windows 95 style.** Every window has a "?" in its title bar. Tapping it turns the next tap into a question: tap any button, slider, icon, list row, taskbar item or Start menu entry, and a small help bubble explains that one thing instead of doing it. Tapping the window's "?" and then its title bar explains the window as a whole.
- **Help index.** A Help entry in the Start menu lists every feature, including the ones with no button on screen: the BOOT button pairing window, power-on pairing, the speaker's own buttons, saved networks and the phone hotspot, the ENIAS alignment rule, matrix patterns, hidden mechanics as they are added. This is the one place hidden rules may be stated plainly. ENIAS lore can flavor the text, but every entry must actually explain.
- **One data file.** All text lives in data/help.json, keyed by a feature id. Every interactive element in the page carries a data-help attribute naming its entry. A later tutorial mode walks the same entries in order and holds no text of its own.
- **Kept current by rule.** Any code session that adds or changes a usable feature, on the page or in firmware, adds or updates its help entry in the same pass. A feature is not done without it.
- **Enforced by a test.** Every interactive element in index.html (buttons, inputs, links, icons, menu entries) must have a data-help that exists in help.json, and every help.json entry must be reachable from either an element or the Help index, so a feature without help, or help for a feature that is gone, fails the tests.
- **Retroactive.** Everything already built gets its entries in Module 9 below.

## Standing rule: parallel-dimension look (decided 2026-11-25)

The shell must not read as a copy of a real operating system. Every boxed element has smooth rounded corners: generous curves, not a subtle rounding (owner asked for "more curvy"): windows about 22 px, buttons, inputs, list panels and taskbar items about 14 px, title bars rounded 20 px at the top to match their window, the taskbar about 26 px at its top corners, note balloons and badges about 18 px. Rounded panels clip their contents (overflow hidden) so highlighted rows and bars follow the curve. Square corners are not used anywhere, except the matrix pixels themselves. Every window's close button is a skull icon instead of an X, drawn inline as SVG in the bone color (#e9e5d6) on the button face, keeping a 44 px touch target and an aria-label such as "Close". The bevel colors stay as they are. The design canvas mockups were updated to this look on 2026-11-25; Drive B's copy is in design-ref/Drive.dc.html. Any session building or changing page UI follows this, and the next page-work session applies it to everything already built.

## Standing rule: vintage control screen lens (decided 2026-11-25)

The owner wants the whole UI to look like a weird vintage control screen seen through glass, and wants it to lean into weird, while staying easy to read (owner, same day: "more legible, fx more subtle"). The canvas values after that pass are the target: text fringing about 0.6 px at about 30% strength, scanlines at about 14%, noise under 5%, a light vignette, a warp of about 2 px, and a rolling band and tear that are barely there until you notice them. Legibility wins any conflict with an effect. The design canvas shows the target (CSS and SVG in each artboard's helmet style, classes crt and crt-fx): the screen corners curved like a tube face, scanlines, red and cyan color fringing on text, a soft phosphor glow, film noise, a glare highlight, a dark vignette that keeps the taskbar readable, a slow green rolling band that hue-shifts what passes under it, an occasional horizontal tear that jumps, a faint flicker, and a slight wavy warp from an SVG displacement filter.

Limits to respect when building it on the page:
- A true lens bulge cannot be done to live HTML without moving what the eye sees away from where a finger taps. Keep the warp tiny (a few px, as in the mockup) so taps still land, and fake the bulge with the curved corners and vignette.
- The full-screen SVG warp filter and the backdrop-filter bands are the expensive parts. Measure on the iPhone 8 first; if scrolling or the player stutters, drop the warp filter before anything else, then the rolling band. Scanlines, fringing, noise and vignette are cheap overlays.
- Every layer is pointer-events none and sits above the shell, below help bubbles and the setup sheet's form fields, which stay crisp and unfringed.
- prefers-reduced-motion stops the animated layers, and a Start menu setting (for example Optics: tube or clean) turns the lens down for anyone who finds it hard to read. Its help entry explains it.
- Overlay images are inline (data URIs), never fetched, so the lens costs no extra requests on the box.

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
   - **↳ 2026-11-24: software built and compiled, NOT flashed or verified on hardware (board unavailable). See HANDOFF.md "Shell Module 7".**

8. **ENIAS alignment and Drive B.** Full brief, credit rules and the save design are in ALIGNMENT-BRIEF.md. In short: a per-track band flag, a point counter in NVS fed by finished songs and cleared game levels at equal weight, a small event endpoint, the Drive B window, and a matrix Alignment pattern. Pass: counter survives a reboot, an unflagged track never counts, a skip before 50% never counts. Stop.
   - **↳ Piece 1 (flag, counter, event endpoint, status total) built 2026-11-23, native tests green and verified on the box (minFreeHeap A/B still open), see HANDOFF.md "Shell Module 8, piece 1". Drive B window, matrix pattern and game reporting not started.**
   - **↳ Pieces 2 and 3 built and flashed 2026-11-25 (Drive B window, drive-b.json, Alignment matrix pattern); native 208/208. Phone-mode song reporting built the same day (align-report.js, see HANDOFF.md follow-up). See HANDOFF.md "Shell Module 8, pieces 2 and 3".**

9. **Help for everything already built.** (Added 2026-11-25, see the standing rule above.) Build What's this? mode into the shared window frame and the Help index in the Start menu, then write data/help.json entries for every usable feature that exists today: every control in the Player, Network, Speaker, Matrix and game windows, the desktop icons, the taskbar, the Start menu, and the features with no on-screen control (BOOT button and power-on pairing, speaker buttons, saved networks and phone hotspot joining, the hotspot setup boot, alignment scoring, band-tracks.json). Read the text from the code as it stands, not from the plan; leave out anything not actually working. Help bubbles work at phone width on the iPhone 8, touch targets at least 44 px, no extra requests until help is used. Add the coverage test from the standing rule. In the same pass, apply the parallel-dimension look (rounded corners, skull close buttons) and the vintage control screen lens to every window and control already built. Stop.
   - **↳ BUILT and flashed 2026-11-25, see HANDOFF.md "Shell Module 9". Coverage test passes (62 controls, 86 entries). Lens smoothness on the iPhone 8 not yet judged.**

## Borrowed from WLED (2026-11-25)

WLED is the working example the owner pointed to. These are the parts worth taking, in the order to do them. Details of what was read are in the chat notes; WLED code was read from a fork's copy, so recheck against current WLED before leaning on any detail.

- **Hotspot retry wait.** Built and measured 2026-11-25, see HANDOFF.md "Borrowed from WLED" item 1. The long wait is in, but on its own it did nothing: the Arduino core (2.0.17, auto-reconnect on by default, "network not found" counted as retryable) rescans by itself every ~1.7 s, so our 30 s retry never ran. Fixed by item 2.
- **Cancel the search when a phone joins the hotspot.** Built 2026-11-25 (the brief's condition was met). Auto-reconnect is off while the hotspot is up, a phone joining cancels an in-flight search, and the wait restarts when the last phone leaves; a join started from the setup page is never cancelled. Measured on the box with a Mac as the client: paused on join, no retry lines while joined (~58 s, a phone test for the full 5 minutes is still open), retry 30 s after it left. Native tests cover the decision.
- **Small card-file endpoint.** Built and tested on the box 2026-11-25: `POST /api/sd/card-file?name=band-tracks.json`, allowlist and 4 KB cap in config.h, content checked and swapped in via a temporary name so a bad upload leaves the old file; pairing-key and one-upload rules shared with the song upload. Tool: `tools/push_card_file.py`.
- **Page updates over Wi-Fi.** Checked 2026-11-25 and NOT built: the core can write the page partition, but it erases in place from the first byte, a failed write leaves a filesystem that reformats empty at the next boot, and no recovery page is served from firmware (the setup sheet itself lives in that partition). Safe only with a firmware-served recovery page plus staging the image on the SD card first; both are written up in HANDOFF.md item 4.
- **Left out on purpose.** Whole-firmware OTA (blocked by the single app slot in a 4 MB chip, see FEATURE-IDEAS.md) and a full file editor.

Deferred: games, clock and alarm screens, crew profiles, the FLAC question, and the board swap.

## Open decisions

- **Hotspot connection bug (owner report, 2026-11-25): cause found and fixed on the bench, an iPhone test is still open.** Away from home the box raised its hotspot but a phone could not stay on it. The suspect in this entry was the 30 s retry, and the retry hold built for it did not change anything: measured on the box, the Arduino core's own auto-reconnect rescans for the missing saved network every ~1.7 s, pulling the radio off the hotspot's channel, with no retry line from our code at all. Fixed 2026-11-25 by turning auto-reconnect off while the hotspot is up and cancelling any running search when a phone joins (HANDOFF.md "Borrowed from WLED" items 1 and 2). With that and the matrix driver taken out of the normal build (it left 6.8 KB of heap and the web server stalled), the Mac got the setup sheet with the full page at 192.168.4.1 and stayed joined until macOS left on its own after ~a minute. Still open: a real iPhone holding the hotspot for 5 minutes (expect one pause line and no retry line), the sheet listing songs and games with Bluetooth off, and the captive probe paths on Android.
- Whether phone-mode bars should ever drive the real matrix.
- Font choice once sizes are measured.
- Exact captive-portal behavior on each phone type.
