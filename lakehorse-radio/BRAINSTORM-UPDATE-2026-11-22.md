# Lakehorse Radio: build update for the brainstorm chat (2026-11-22)

Modules 2 to 6 of the shell-and-virtual-matrix plan are done and flashed to the box. Details: HANDOFF.md ("Session log 2026-11-22").

**What exists now**
- **Matrix engine** on the box: one 64-light frame, modes Off, Bars, Title (scrolling song name), Dazzle (camo drift), Clock (phone time), Image. No LED hardware needed; `GET/POST /api/matrix`.
- **Virtual matrix window** in the page: mode buttons, brightness, full view. Shows exactly what the real matrix will show.
- **Shell**: the page is now the ENIAS desktop: windows, taskbar, Start menu, first-run view when no Wi-Fi is saved. Network and Speaker windows (with "Optimize for this device") live inside it.
- **Audio reactivity**: the box analyses the music it plays into 8 bands, time-aligned to what the speaker is actually playing, and feeds the matrix. Bars follow the music; Dazzle brightens with it.
- **Phone-mode bars**: when the phone plays the music, the page analyses it itself and draws the same bars in the virtual window (WAV songs only).

**Checked on hardware:** a full 4-minute song to the ML301 speaker with 0 audio dropouts, matrix polling the whole time; iPhone tests of the shell and matrix window were good.

**Not done / open**
- Real matrix hardware (Module 7) waits until it is wired.
- Not yet tried: captive-portal sheet on iPhone and Android, joining Wi-Fi from the Network window, Optimize on a phone, phone-mode bars on a phone.
- Free memory during playback dipped lower than before (35k to 26k, stable); cause unknown.
- Bar sensitivity is reasoned, not tuned by ear.
- Phone-mode bars do not drive the real matrix; AAC songs get no phone bars.

**Good brainstorm topics next:** which patterns should react to the bands besides Bars and Dazzle; should phone-mode bars ever drive the real matrix; font choice for the scrolling title; what the first-run portal should say on each phone type.
