# Lakehorse Radio: progress brief (2026-11-22)

Covers the work since the project was handed to Claude Code at Module 6 (Bluetooth playback).

## What the box does now
- Plays WAV songs from its SD card through a **Bluetooth speaker** (ML301 tested). The web page works as the remote: play, pause, seek, volume, and moving on to the next song.
- The page's **"Play songs on"** chooser picks **this device** (the phone plays the song) or **the box's speaker**.
- New **speaker panel** on the page:
  - Connect and Disconnect.
  - Find speakers: lists nearby speakers; tap one to play there. The box remembers the choice.
  - Turn Bluetooth on/off: the box restarts, and the page reloads by itself.
  - **The user has tested switching between speakers, and it works.**
- **Wi-Fi watchdog:** if the router stops answering, the box rejoins Wi-Fi. If that doesn't help, it restarts, but never during a song.

## Constraints learned (they shape any future idea)
- **The chip is an early ESP32 revision (v1.0).** Its PSRAM has a known fault, so small, busy data can't live there. Bluetooth fills most of the remaining internal RAM, leaving about 50 KB free while playing.
- **Bluetooth on means Wi-Fi power saving is forced on.** Songs then download at 22–40 KB/s, and a WAV needs 176. So with Bluetooth on, the phone can't play songs stored on the card. With Bluetooth off they download at 86–238 KB/s and play fine. **That's why the on/off switch exists: the box serves either the phone or a speaker, not both at once.**
- Bluetooth can only start at boot, which is why switching it on or off needs a restart.
- The fix for the hardware limits is a newer **ESP32-WROVER-E (revision 3)**, about $10. It must stay a classic ESP32: the S3, C3 and C6 have no Bluetooth Classic, so they can't send audio to a speaker.

## Still open / ideas to brainstorm
- **Swap to the newer board?** It would lift the RAM limits and might allow phone and speaker playback together.
- **Small gaps:**
  - Volume goes back to full after a restart.
  - The speaker's own buttons (pause, skip) are ignored by the box.
  - Turning Bluetooth on or off takes a restart of about 10 s.
- **Only WAV plays on the speaker.** MP3 or AAC would need decoding on the box, which is a real RAM question on this chip.
- **The box doesn't move on to the next song by itself.** The open page does that, so with the page closed, playback stops after one song.
- **Robustness:** the watchdog has passed a simulated test but hasn't yet caught a real Wi-Fi hang.

## Where the details live
`lakehorse-radio/HANDOFF.md`, in the "START HERE" section. The code is on the `lakehorse-radio` branch (latest commit 929262a).
