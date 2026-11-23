# ENIAS alignment: feature brief (2026-11-22)

Status: decided, not built. This is Module 8 in SHELL-AND-MATRIX-PLAN.md. The design is the Drive B artboard in the design canvas.

## What it is

The crashed ship's computer is a neural net that drifted out of alignment. Listening to Lakehorse songs and clearing game levels pulls it back, until it reaches 100%. Alignment unlocks the corrupted files on Drive B (lore, promo track downloads, free ticket links) and settles the matrix from scattered pixels into a tidy pattern. Nothing exclusive goes behind it, since it is for fun. The page hints at the rule and never states it.

## Credit rules

The framework is what is decided here: equal weight for songs and levels, partial credit for partial effort, and exact integer math. Every number below is a starting value, to be tuned once the framework is running.

Everything is counted in hundredths of a node, so the math is exact integers. A song and a level are weighted evenly: one full playthrough of either is worth one node.

| Event | Points |
| --- | --- |
| Flagged song played to the end | 100 |
| Flagged song stopped or skipped after passing 50% | 10 |
| Level cleared | 100 |
| Level attempt of at least 10 seconds that ends without a clear | 5 |

So one full playthrough equals 10 listens past halfway equals 20 attempts. An event earns one value only: a song that plays to the end earns 100, not 110, and the clearing attempt of a level earns 100, not 105. The full bar is 64 nodes, 6400 points, and node n lights when points reach n times 100. Alignment percent is points divided by 6400, rounded down. These numbers sit in one constants block so they can be tuned after a few days of real use.

Only flagged tracks count. The track list carries a per-track flag, set on the band's songs when the box is built and off for anything a listener adds. Unflagged music gets the "pattern unrecognized" line and no credit.

## The save

One save for the whole box, stored in NVS (a small namespace such as lh_align): the point total, and a bitmask of levels cleared so far. NVS wear-levels its writes, so one small write per event is fine for the life of the box. Because the save lives on the box, it follows the listener to any phone. This is not the multi-person crew profile, which stays deferred; this version has one shared save.

An erase of the whole flash during development wipes it. Normal firmware uploads and LittleFS image uploads do not touch NVS.

## Who reports what

In speaker mode the box plays the song, so the box counts song events itself when it ends or stops a track. In phone mode the page plays the song and the box never sees it, so the page reports song events. The page must not report songs while the box is playing, or every song would count twice. Levels always come from the page. Both use one small endpoint, shaped like the existing /api calls, taking the source, the track or level id and the result, and returning the new total. The box ignores a repeat of the same event inside 10 seconds. It trusts the client otherwise, since the stakes are a lore file.

## Pieces

1. The track flag and the counter, with the event endpoint and the total on the status endpoint. Testable with curl and a native test, no page work needed.
2. The Drive B window: node lattice, alignment readout, files that resolve as alignment rises, and the short event log.
3. The matrix Alignment pattern, reading the same total.
4. Game reporting, when the games exist. The endpoint is ready before then.

## Pass

The total survives a reboot. An unflagged track never counts. A skip before 50% never counts. Ten half-listens, one full play and twenty attempts each land on exactly 100 points. Two phones see the same alignment.

## Open

Nothing blocks the build. Replays of the same song currently count every time, which is simple but farmable, so a repeat guard is the one thing to revisit once the numbers are being tuned.
