# Guber Eats handoff

Single file: `index.html` (vanilla ES module + vendored `../vendor/three.module.min.js`). Crazy Taxi-style delivery game for the Lakehorse suite. Serve `esp music v1/` and open `/guber-eats/`. Add `?mute` for silent testing. Console handle: `window.GuberEats` (game, Economy, Decades, Difficulties, GameConfig).

## State (2026-11-22)
- Built and checked by script: driving, pickup/delivery, tips, lottery maths (incl. broke/negative cash), tax years (Struggle refund delayed), death + estate screen, decade progression, Depression unlock (`localStorage` key `guberEats.v1`).
- **Not tested by hand:** live keyboard feel, drift/boost, traffic and pedestrian reactions, any audio.
- Look: dazzle-camo painter shared with theme-dazzle.css / Swimulator; HUD copy avoids em dashes (house style), except the user-specified "Pay Now (Just Kidding — Retry)".
- Vehicle: faded black cargo van (`buildVan`, `fadedBlack`, `sprayText`): sun-bleached black with rust runs, "lakehorse" spray-painted on both flanks, plate LKEHRSE front and back, side windows rolled down partway and leaking smoke at all times (`Game.fumes`, emitted in `carFx`). Era only changes the proportions. The dazzle stays on the world, not the van (changed 2026-11-22 at the user's word).
  * **↳ PROPOSED 2026-11-25 — the van carries dazzle stripes again, contrasts with the road (faded black was nearly the road colour), and changes body style by difficulty: Ford Econoline (struggle), nice minivan (middle class), Mercedes-style minivan (nepo).** Said in a van design session; design board is a Claude artifact (https://claude.ai/artifact/GhqSveBgLufbUH6kXgSJVc). **Ported into `buildVan` the same day (uncommitted):** `VAN_TIERS` holds the three profiles, extruded into the body with a profile-cut flank decal per side (`vanFlankCanvas`), tier from `this.diff.id`; `buildVanSpeakers` makes the roof speakers; `SynthAudio.level()` (analyser tapped on both music paths) drives the pulse in `Game.render`. Cab-window smoke is now Struggle only. Checked in the preview for all three tiers (builds, decals read, no console errors, level 0 to 0.54 on beats); not checked: every era, the box, real phones. Agreed in the same session: two-tone black-over-light bodies, per-tier lettering (spray / as-is / vinyl decal), roof speakers per tier whose cones pulse and emit rings from the game's own audio analyser (user: "i agree about the pulse"). Buildings went grey and derelict the same day (`greyDecay`, `decayOverlay`, wall desaturation in `GRIME_ALBEDO`, `LookConfig.grime` 1.0 to 1.3); uncommitted. Asked whether he wants it as a rule; acting on it meanwhile.

## Controls
Keyboard, plus a standard-mapping gamepad (added 2026-11-22, checked with a simulated pad only, not real hardware): RT gas, LT brake/reverse, left stick or D-pad steer, A drift, X or RB dash, Y reset, Start pause or begin. Analog fields `throttle`, `brake`, `steer` feed `VehiclePhysics.step`; keyboard supplies 0 or 1. Browsers only see a pad after a first button press, and a pad press does not unlock audio, so the first keyboard key or click is still needed for sound.

## Audio
- Main theme is the song **Currency**, streamed through an `<audio>` element and filtered per era (`GameConfig.theme.era`: AM radio in the 40s, gramophone for the Depression, full range from the 80s).
- Sources tried in order (`GameConfig.theme.sources`): `../tracks/lakehorse/Currency/theme.m4a` (does not exist yet), then `../lakehorse-radio/music/Currency Mix 8-24-26.wav` (126 MB master, **gitignored**, works only from this checkout).
- If neither loads, the procedural Web Audio synth plays. SFX are always synth.
- **To ship on the live site:** encode a compressed copy to `tracks/lakehorse/Currency/theme.m4a` and commit it. No code change needed.

## Run it
Preview server: `guber-eats` entry in `claude m4/.claude/launch.json` (python http.server, port 8778, rooted at `esp music v1/`). Open `/guber-eats/?mute`. Save key: `localStorage['guberEats.v1']` ({depressionUnlocked, maxDecade, bestWorth}).

## Decisions
- Currency is **not** going on the live site. The master `../lakehorse-radio/music/Currency Mix 8-24-26.wav` (126 MB) is gitignored. Plan: test from the Lakehorse Radio box. Game HTML plus `../vendor/three.*.min.js` go on the SD card (LittleFS is only 512 KB), audio chosen in that environment, `theme.sources` pointed at the SD file.
- No album-page door: `../index.html` depends on the Supabase gate, which is restricted (see project-supabase-storage-quota-lockout). Add a Guber Eats door card beside the Swimulator's once it is back.
- Nothing is committed or pushed.

## Prompts already given to the user (for the radio project's agent)
1. Serve the game from the SD card (copy index.html and vendor files, check .html/.js Content-Type, link from the radio page, set theme.sources).
2. Re-copy the SD copy after the gamepad change, preserving its box-specific edits.
The SD copy lags this file whenever the game changes (it does not have touch support either). Re-copy using prompt 2's pattern and keep the box's `theme.sources` edit.

## Next
1. Play it by hand and tune: handling, tip values, order timers, difficulty balance, deliveries per decade.
2. Real checks: a physical gamepad, a real phone (see the touch section's untested list), listen to the Currency era filters.
3. Re-sync the SD copy after any change.
4. Album-page door once Supabase is back; commit and push only on the user's word.

## Look and dynamics pass (2026-11-22, not committed, not on box SD)
Rule: the dazzle camo stays the hero, so new assets reuse its skins or its light/dark pair; no window grids over the walls.
- World: sun shadow map following the van (desktop only; `LOW` skips it, quality step-down turns it off), crossings at every junction painted as dazzle panels (skewed, angle-flipping, accent every third; one canvas per axis) with an accent stop line (`BoxBatch.quad`), ~100 instanced street lamps (not solid) with night light pools, paving joints in the sidewalk texture, rooftop plant rooms/antennas (own `decoRng`, city layout unchanged), drifting clouds in day eras, headlight pool on the van at night.
- "HELL IS REAL" billboard (after the user's painting): 2 in plazas (solid), 3 on tall roofs; canvas in `CityBuilder.build`.
- Dynamics: steered front wheels, brake lights brighten on brake, camera leans into corners (`ChaseCamera.roll`), pedestrian walk bob.
- Checked in the preview: loads cold, no console errors, shadows/lamps/crossings/billboard render. Not checked: night eras, frame cost with shadows, phone.

## Crash costs, insurance, billing calendar (2026-11-22, not committed, not on box SD)
- Calendar: `GameConfig.year.seconds` is 1200 (20 min = 1 year, the one tunable). Month = /12: rent is a lump (`rentShare` 45% of burn, `Economy.monthEnd`); quarter = /4: insurance premium (accrues pro-rata, billed quarterly); year: tax return. Burn per second unchanged. `depressionYears` dropped 3 to 1 (a year is ~20 min now).
- Crashes bill net worth via `Economy.charge(kind, speed, flat)`: building (impact event, 1 s global cooldown), traffic, props (flat), pedestrian (`distracted` 25% of peds don't dive, so they can be hit). Repair prices in `GameConfig.repair`, severity from speed (`GameConfig.severity`, under 4 m/s free). Vehicle health damage unchanged.
- Insurance per difficulty (`Difficulties[x].insurance`): Nepo 85% cover, Middle 55%, Struggle 0% (full bill, no premium). Each insured claim adds 8% to the next premium (cap 60%), one step decays per clean quarter.
- CEO: one top-hat pedestrian with a gold beam (`Pedestrians.buildCeo/updateCeo`); hitting him stops premium accrual for 120 s, no repair charge, respawns after 90 s. HUD line `hCover` shows cover, surcharge and waiver countdown. Estate screen lists repairs, covered, premiums.
- Checked: `Economy.charge` per difficulty (Struggle pays the full bill, scrape free, deductible floor, surcharge cap), 1200 s tick sim (4 premiums, rent lumps, burn matches), wall bill once with cooldown, CEO hit waives, HUD text. Not driven by hand: distracted-pedestrian hit, real play balance (all numbers are first guesses).

## Touch controls (2026-11-23, not on the box SD yet, not committed)
- Third input source in `Input` (`this.touch`, merged by max/clamp like the gamepad). Pointer Events per pointer id. Left: analog steer pad (finger offset from centre = steer, positive left). Right: GAS, BRAKE, DRIFT held; DASH, RESET, PAUSE fire on press. Enabled by `pointer:coarse` or `?touch`; `body.touch` gates all the CSS, so desktop is unchanged.
- Portrait on a touch device while in a run: "Turn your phone sideways" overlay and the run pauses. Page hidden: run pauses; page shown: AudioContext resumes.
- `QUALITY[]` at the top: level 0 = desktop, 1 = phone start (pixel ratio 1.25, fog x0.6, traffic x0.6, 24 pedestrians); `?low` forces it. In play, average frame time over 3 s above 26 ms steps one level down (fog and pixel ratio at once; traffic only on the next decade load). `game.perf.ms` and `game.q` are the console handles.
- Checked: simulated pointers (gas + steer together: throttle 1, steer 1, heading changed), dash/reset/pause taps, 812x375 layout screenshot, 375x812 overlay + pause, forced slow frames stepped quality 1 to 2, no console errors. **Not tested on a real phone:** real multi-touch feel, iOS pull-to-refresh and pinch blocking, safe-area insets, real frame times (the test pane renders at about 1 fps), audio unlock on iOS.


## Box SD re-sync (2026-11-22, late)
Pushed only `/game/guber-eats/index.html` + `.gz` to the box (192.168.0.38) via `push_game.py` with a one-folder source; nothing else on the card touched. Box-specific edit = the injected `<script>window.LAKEHORSE_BOX = true;</script>` before the import map (same as `pack_game.py`); the old SD copy's other diffs were just source drift. `theme.sources` is NOT edited on the card: `LAKEHORSE_BOX` switches `startTheme()` to `/api/sd`. Vendor three files already on the card, Content-Type text/html + text/javascript OK, plain and gz copies byte-identical to the build.
Checked cold on the box (desktop Chrome pane, `?mute`): comes up by itself, 0 console errors (one Three `PCFSoftShadowMap deprecated` warning), shadows on, 1940s era, dazzle crossings + lamps visible, 2 flank `lakehorse` textures, both plates, HELL IS REAL texture (rose H), 5 signs in scene, 16 clouds.
Found: the LKEHRSE plate text (66px Courier, 7 chars) is wider than the 256px plate canvas, so the L and E clip at the edges. Source not changed.
Not verified: night eras, real frame times with shadows on a real client, phone, audio (muted).

## Box port of money changes + iOS audio fix (2026-11-23)
- Box (192.168.0.38) `/game/guber-eats/index.html` + `.gz` re-pushed from this source; only box edit is the injected `LAKEHORSE_BOX` script. Plain and gz byte-identical to the build. Checked cold: 0 console errors, year 1200, `hCover` present, `charge('building',24)` on Struggle paid = bill (90). Pre-port box copy backed up in the session scratchpad only.
- iPhone 8 reported no audio. Likely causes, fixed but NOT confirmed on the phone: (1) `play()` ran after the async `/api/sd` fetch, outside the tap, and a rejection dropped the element so nothing retried; (2) each track was a new `Audio()`, blocked from track two; (3) silent switch mutes Web Audio. Now: one reused element, tap/touch/key hook retries `play()`, `navigator.audioSession.type='playback'` (iOS 16.4+). Desktop check: plays and advances to the next track. If still silent on the phone, next suspect is `createMediaElementSource` on iOS with an 84 MB range-streamed WAV (try skipping it on iOS).
- Open: Swimulator laggy on the phone (reported 2026-11-23), not investigated. LKEHRSE plate text still clips.
- Dropout log added (2026-11-23): `GuberEats.game.audio.stalls` lists `waiting`/`stalled` events with `sinceCrashMs`. Dropouts not reproduced here (no stalls; `crash()` < 2 ms). Box stream is ~176 KB/s against ~220 KB/s measured throughput, so Wi-Fi underrun is the leading guess. Box copy re-pushed with the log.
- LKEHRSE plate clipping fixed (56px + maxWidth 226 on a 256px canvas), pushed to the box. iOS media-element fallback deliberately not built: it cannot be tested without the phone, and a graph-connected element cannot be reverted to direct output.

## Verified on the box without a phone (2026-11-23)
- All 9 eras load with no errors (night eras 1980s, 2020s: fog 330, light pools added). Played into the 2020s: lamps, dazzle crossings, `Insured 55%`, LKEHRSE plate fully visible.
- Money on Middle: ped 88 / traffic 38.5 / building 90 bills, cover 55% with deductible floor, surcharge +8% per claim (4 claims = 32%). Distracted pedestrians ~20% (9 of 44), a hit calls `pedHit` and bills; a normal pedestrian dives instead. CEO hit through the real `Pedestrians.update`: state `gone`, premiums waived 111 s, no repair charge, HUD line shows the countdown.
- Still unverifiable here: real frame cost (test pane renders about 1 fps), iPhone 8 audio and touch feel, long-run money balance by hand.

## Dirty-world graphics pass (2026-11-23, not committed)
User asked for "state of the art graphics of a dirty world" that still runs from the radio box. All in `index.html`, section **Look** above `class Game`; tunables in `LookConfig`. No new files (+~15 KB, 57 KB gz).
- **Every tier (box/phones too):** `grimeMaterial()` patches the static city's Lambert materials (only `W.group`; van/traffic/peds move, so world-space noise would swim): soot blotches, rain streaks down walls, kick-line soot at wall bases, per-building weathering, oil stains, wet puddles on flat ground with sky reflection + sun glint (wetter at night). Phones use 2 noise octaves, desktop 3. Renderer uses ACES filmic; sun x1.9, hemisphere x0.65 (`key`/`fill`).
- **Desktop only (`PostFX`, quality 0):** half-float 4x MSAA target with depth, 4-level bloom (additive glows x3.2, textured light pools x1.35, brake lights x3.2), depth-only SSAO, ACES, era grade (Depression sepia moved here from the CSS filter), vignette, grain, edge fringing, dash zoom blur. `?post` forces it on a phone, `?nopost` disables. Quality step-down drops it.
- `PCFSoftShadowMap` swapped for `PCFShadowMap` (r185 deprecation warning).
- Checked in the preview: 1940s/1960s day, 1980s night, 2020s dash, `?low` phone path; no console errors. Not checked: frame cost on a real phone or the iPhone 8, all 9 eras by eye.
- Design canvas with the HUD direction and before/after: https://claude.ai/artifact/8834b88XY7FKMXZ8TKEQt2 (HUD board is a proposal only; the in-game HUD is unchanged).
- **Box:** pushed to `/game/guber-eats/index.html` + `.gz` (LAKEHORSE_BOX injected, byte-checked). Mistake on the way: the first push used the folder itself as source and landed on `/game/index.html` (the Swimulator). Restored from `lakehorse-radio/build/sd-game/index.html(.gz)` (Nov 22 22:53 pack), byte-identical on read-back. **Box not verified cold:** right after, it returned 0-byte bodies for `/game/vendor/three.*.min.js` with freeHeap ~19.7 KB, largestFreeBlock ~10.7 KB (healthy idle was ~144 KB). Not investigated or rebooted; a reboot is the first thing to try. Push method that works: source dir must CONTAIN a `guber-eats/` folder.
- **Rebooted the box (2026-11-23, at the user's word)** via a serial hardware reset (`esptool --after hard_reset chip_id` on `/dev/cu.usbserial-0001`, no flash write; there is no HTTP reboot endpoint). Back in ~6 s. Heap right after boot 37.6 KB, settling to ~21.8 KB free / ~12 KB largest block. Serving is now **flaky box-wide, not just this game**: browser fetches of `three.module`, `three.core` and the Swimulator's `config.js` fail at random (`Failed to fetch` / `ERR_INVALID_HTTP_RESPONSE`), one plain three.core read came back 151 bytes short, curl fails intermittently too. So the game still has not loaded cold from the box. Leading guess: the Bluetooth stack leaves too little internal RAM for the async web server (the Module 0 baseline was ~144 KB idle). That is radio-firmware work, not game work.
- **Box verified (2026-11-23, after the radio session's lwIP/PSRAM firmware fix):** cold load from `http://192.168.0.38/game/guber-eats/?mute` came up by itself, every request 200, no error panel, grime shaders compiled (3 programs), `LAKEHORSE_BOX` set. Firmware change is uncommitted in `lakehorse-radio/`; see its HANDOFF.

## Easier driving, items, DOINKS (2026-11-25, DONE, committed)
Wired in `index.html` and checked in the browser (muted): cold load, console clean, a forced full doink run (`GuberEats.game.doinks.stash = 8`): pull, rise, hold, taper; stash reset to 0, +1 banked dash, cash.
- `Game.onBaggie` (callouts, DOINK READY), `startTrip/tickTrip/endTrip` (order timers, eco drain and damage frozen until the taper; camera orbits via `ChaseCamera.orbit/liftTo`), `PostFX uTrip` (wobble, aberration, hue, saturation) with a no-PostFX fallback (CSS filter on `#gl`) plus a 2-D ring/vignette overlay on `#fx`. HUD: stash `n/8`, banked dashes, nearest-DOINK hint. First-delivery tutorial banner (`save.doinkTutorial`).
- Not hand-tested: how the trip LOOKS and sounds with sound on (only checked muted, numbers only); keyboard feel of the easier driving; box and phone.
## DEMO MODE (2026-11-25, DONE in both games, committed)
- Guber: `?demo` or the title button "Demo: watch it play". `class Autopilot` feeds the same input fields (Input.state returns `game.demo.inp`). Routes along the street grid, takes baggies when nearby, a ready DOINK before an order with time to spare, auto-restarts after a wreck. `Save.noWrite` stops all writes. `?demo` autostart: first gesture only unlocks sound, the next key/touch exits.
- Swimulator (`game/`): `src/game/Autopilot.js`, start-screen button, `?demo`. Easy tank, lighter given, intro skipped, `Progress.noWrite`. Checked 60 s: baggies, bong hit, trip, nothing in localStorage. Exit reloads the page without `?demo`.
- Soak: Guber ran about 3 minutes with 1 delivery plus a doink; longer runs and the `?low`/touch paths not run.
## Demo and alignment points (2026-11-25, BUILT, FLASHED, SYNCED, verified on the box)
- Firmware: `Result::DemoClear` (+10) and `DemoAttempt` (+1; 10% of 5 rounds up), reached with `&demo=1` on `/api/alignment/event` (level clear or attempt only, else 400). A demo clear never sets the level bit. 214 native tests pass, `env:radio-core2` builds. Needs a flash to take effect; before that, `demo=1` is ignored and a demo run would be credited as a REAL clear/attempt, so do NOT re-sync the games to the box before flashing.
- Games report only on the box (`window.LAKEHORSE_BOX`): Guber level ids are the decades 0..8, the Depression is 9; the Swimulator is 16 (`core/Box.js`). Clear = decade completed / Depression survived / chest opened. Attempt = 10 s or more of play that ends without a clear (death, quit to title, demo exit, Swimulator page close). Demo sends `demo=1`.
- Swimulator demo never opens the chest, so it earns attempts only (+1 each).
- Checked with a stubbed fetch in the browser (right URLs, demo flag); not against a live box.
- **Done 2026-11-25:** firmware flashed over USB (hash verified, NVS kept, boot shows `[align] 0 points`); both games pushed with `pack_game.py` + `push_game.py` (14 files, 0 failed; Guber, index and bundle byte-identical on the box). **Box IP is now 192.168.0.15** (DHCP on "pifi"; the old 192.168.0.38 is gone). New firmware answers `demo=1` on a song/partial with 400. End to end: `?demo` on the box, 17 s, `exitDemo()` took the total 0 to 1 (the one real test credit left on the counter).
- The DOINK build and demo are now on the box. Not tested there: sound, a doink run, touch.
## Music gaps on the box (reported 2026-11-25, NOT investigated on hardware)
Box was unreachable from here (no ping to 192.168.0.38). Playback is a single `<audio>` streaming `/sd/*.wav` over the box's Wi-Fi. After a gap, run `GuberEats.game.audio.stalls` in the console: `waiting`/`stalled` entries mean the box ran dry (network or firmware: see the lakehorse-radio PSRAM note in its HANDOFF); no entries means the page main thread. The DOINK build is NOT on the box yet.
## Web site
All edits live in the main folders (`guber-eats/`, `game/`), so the site copy can be updated later from the `lakehorse-radio` branch once site access returns.

## Box sync of van-per-difficulty build (2026-11-25, eb7f707, DONE)
- Box DHCP address moved: now **192.168.0.15** (was .38; .38 no longer answers). Found by probing `/api/status` on the ARP neighbours; `lakehorse.local` did not resolve.
- Packed with `pack_game.py <scratch dir>` (not `build/sd-game`), copied only `guber-eats/` into a one-folder source, `push_game.py 192.168.0.15 <that dir>`: 2 files, 0 failed. `/game/index.html` still the Swimulator.
- Read back: plain and gz copies byte-identical to the pack (LAKEHORSE_BOX injected once, gz decompresses to the plain).
- Heap before: free ~81 KB, largest block 69.6 KB, min 52,152. After: free ~80 KB, largest 65.5-69.6 KB, min unchanged.
- Cold load of `/game/guber-eats/?mute`: starts by itself, `LAKEHORSE_BOX` true, error panel hidden, 0 console errors, three vendor files 200. `startRun('normal')` for middle / nepo / struggle: state `play`, vans build (tier matches, 40 / 45 / 35 meshes, 4 wheels, roof speakers present).
- Not checked: looks on screen, sound, phone.

## Bigger, more frequent baggies + faster demo (2026-11-25, pushed to box 192.168.0.15)
- `GameConfig.doink`: `baggies` 14 → 32, `bagRespawn` 45 → 18 s, new `bagScale` 3.4, `bagRadius` 4 → 7. `Doinks.sizeBag()` sizes each bag (eighth ≈ van length, half ≈ 1.6x that) and lifts it by its size; ring 3.6–5.0.
- Autopilot: cruise `vt` 32 → 42 (turn taper over 0.8 rad instead of 0.9), bag approach cap 24 → 34, dash chance 0.4 → 0.9/s past 70 m.
- Box: plain and gz read-back byte-identical, Swimulator untouched, heap 64 KB free / 51 KB block before, 72 / 53 KB after, min unchanged. Cold load clean, 32 bags, scales 3.4 / 4.1 / 5.5 for eighth / quarter / half.
- Demo stepped headlessly (1800 x 1/30 s, `?demo`): avg speed 14.7, peak 49 (dash), 3 pickups, health 93 after 60 s, no crash or console errors. **Not measured:** old-vs-new speed A/B, how the big bags look on screen (preview pane renders ~1 fps), phone.

## Next-of-kin gift card on death (2026-11-25)
- `showEstate()`: when the final balance is positive, the estate screen's satire block now opens with "You died with $X ... enter your next of kin's name and address so we can send them a Guber Eats gift card for that amount", two `data-joke` inputs (name, address). Same satire rules as the card fields: read by nothing, stored nowhere, sent nowhere, wiped on Retry / Main menu. A negative balance is unchanged (no kin block).

## NPC vehicles + faster demo (2026-11-26)
- Why: the player drove minutes without meeting another vehicle. The old fleet was one kind of car seeded uniformly over the whole map (about one car per km of lane). `Traffic` is rewritten; every number is in `GameConfig.npc`.
- Kinds: car, bus, truck (heavy: shove you below `heavyWreck` m/s instead of wrecking), moto (fast, weaves in its lane), parked (curb obstacles), cop, rival. About 40 per run on desktop (14 cars, 3 bus, 3 truck, 4 moto, 11 parked, 3 cop, 2 rival); `?low`/q>0 gets 1 cop, 1 rival, half the parked.
- Density: the fleet is seeded around the start and any vehicle more than `recycleDist` (280 m) away is re-seeded 45 to 230 m out, so encounters are constant. Beyond `drawDist` (240 m) meshes are hidden.
- Cops: `Game.heat` rises on hitting vehicles over 8 m/s (+0.45) and pedestrians (+0.6), decays 0.035/s. Above 0.25 cops within 250 m chase along the street grid (`steerLane`, no building clipping); contact is a BUSTED fine (`eco.wage * 40`, heat reset), not a wreck.
- Rivals: Guber vans that go for the pickup nearest the player when you hold no order and take it within 18 m (`OrderManager.steal`, 30 s cooldown per rival). Ramming one pays a stunt.
- Bug fixed on the way: the collision normal in `Traffic.update` pointed the wrong way (pushed car and van together, threw the wreck at the player).
- Demo autopilot: cruise 48 (was 42), brakes late for pickups/drops on a stopping curve (it crawled the last 40 m at dT*0.2) and for street corners, steers round vehicles and slows only to what the gap needs (was a crawl to 4 m/s), dashes more often, drops a stuck optional goal for 20 s. Demo damage is x0.4. Headless 180 s run: avg 25.7 m/s (was 14.7), 2 deliveries, health 85, no errors.
- Not checked: how it looks with sound, cops' siren (silent), real phone, the box under the heavier scene (heap before/after not measured), long soak. Demo can still die on a bad street; it auto-restarts.

## Civilians, order stealing, DOINK invincibility (2026-11-26)
- Civilians: cars, trucks and motos are flat-colour (`Traffic.civSkins`, 10 colours). Dazzle camo is now only the Guber livery and government vehicles (buses, cops). Car count 1.2 → 1.8 x `dec.traffic`, so ~22 civilians against 2 rivals.
- Rivals carry orders (`c.order`, green bag on the roof). Half spawn carrying (`carryOnSpawn`); empty ones take pickups at any time (even while you hold an order) and deliver them to the drop. `OrderManager.makeOrder/rivalTake/adopt/release` replace the old `steal`.
- Collision with a rival: it carries and you do not, you take the order (fresh clock from where you are, no tips or combo carried). You carry and it does not, it takes yours (no failure fee). Either swap is a shove, not a wreck, then `stealGrace` (6 s) of shove-only contact on that van. Both carrying or both empty: wrecks as before. Civilians, cops, heavies unchanged.
- `Game.invincible()`: true during the whole DOINK trip (pull to taper) and while a banked doink dash burns (`car.boostBanked`; a free boost used first does not count). It blocks damage, repair bills and cop fines. Hitting a rival then launches and explodes it, takes its order if you have none, and pays its cash (`c.cash` x wage). Your own order can never be lost while invincible.
- All tunables are in `GameConfig.npc` (`carryOnSpawn, stealGrace, rivalDropRadius, cashMin/Max, launchSpeed/Lift`).
- Checked headless (swap both ways, grace, both-carrying wreck, invincible launch + cash, civilian wreck; no console errors). Not checked: feel on a phone, sound, the box. SD copy under `lakehorse-radio/build/sd-game` is stale: re-run `tools/pack_game.py` to ship it.

## 1970s to now, living buildings, Digital DOINK, Bernstain files (2026-11-27)
- **Eras:** `Decades.list` is now 1970s to 2020s (6 levels). Depression bonus and 40s/50s/60s removed (save field `depressionUnlocked` gone, `maxDecade` clamped). **Alignment level ids are now 0..5 (1970s..2020s)**, not 0..8: the box firmware's meaning of ids 0..8 is unchanged, so old credits map to different decades.
- **Economy:** each era has `top` (top-1% income share, .08 to .20) and `rent` (rent share of burn, .34 to .50). `Decades.gap(dec)` 0..1 widens the families: `Economy.startMul/payMul` (Nepo start x.6 to x2.0, pay +20%; Struggle x1.3 to x.7, pay -20%). Check: 1970s nepo/middle/struggle start 6017/1324/130, 2020s 50000/3000/175.
- **Buildings:** `BoxBatch.add` returns its vertex range; each building keeps `parts`. `W.paintWalls(age)` repaints the 6 wall canvases by age (palette mixes era colour to grey, `decayOverlay(cv, rng, age)`), run at era load (age .12) and after each delivery (to 1.0 at quota), plus `uGrime`. Config `GameConfig.age`.
- **Block razing:** DOINK flight altitude is now `mean building height x doink.cruiseFrac` (was tallest + 30), so it clips roofs. `Game.flyCrash` -> `explodeBlock(key)`: `CityBuilder.razeBlock` zeroes the block's vertices and removes its colliders; after `razeDelay` 3.5 s `growBlock` regrows clean new buildings (own meshes, `W.freshMats`, age 0) over 2.5 s; `CityBuilder.tick` runs it. No damage (trip is invincible).
- **Digital DOINK:** every 3rd DOINK hit (`GameConfig.digital`), glitch cyan/magenta wire cone at a random free spot 110 m+ away. Touch: $10,000 x wage, heat 0, health 100, `Economy.forgive()` refunds repair bills and fines since the last wipe (`eco.record`), ends the hunt.
- **Nepo:** every 5th billed crash (`GameConfig.nepo`): repair refunded plus 1.5x the bill, "DAD'S LAWYER GOT THAT ONE RULED IN YOUR FAVOR".
- **Bernstain files:** `class Files`, 14 folders on sidewalks worth 1/4 or 1/2 (shuffled deck), respawn 30 s. A whole file: banner "ONE BERNSTAIN FILE COLLECTED / You know too much", `Game.hunted`: 4 army trucks (2 on `?low`) wake near you and chase with every cop at up to 46 m/s; contact is a heavy hit (no fine). Ends on any DOINK or Digital DOINK. Red vignette `#hunt`, HUD rows `hFiles`/`hHunt`, corner minimap `#mini` (hidden on touch).
- **Checked headless:** all 6 eras build, nepo deltas -6 x4 then +54, file pickup sets hunt and wakes army, 3 trips spawn a digital DOINK and pickup works, a real flight razed 9 blocks which all regrew, demo 60 s no errors. **Not checked:** how it looks (preview tab was hidden/paused, no screenshot), sound, phone, vehicle silhouette tweaks (era styles unchanged), the box under the extra meshes.
- Autopilot (added same day): goes for a Digital DOINK first, never targets folders (it only gets one if its route crosses it, at the user's word), and while hunted drops the order clocks to chase bags/DOINK (headless: 600 s picked up 3 folders by chance; forced hunts with a full stash ended in 7-17 s; a hunt with an empty stash can still kill the demo, which auto-restarts). Live site is down until 2026-12-05: GitHub push and box only.

## Whistle + razed-block folders (2026-11-27)
- A whole Bernstain file still starts the hunt, and now also `Files.spawnWhistle()`: a silver whistle with a gold beam at the city-centre intersection (`cRoad(round(N/2))`). Driving into it (`GameConfig.files.whistleRadius` 9 m) calls `Game.blowWhistle()`: hunt off, `nextDecade()` (so the era's delivery quota is skipped; last era goes to victory). One whistle at a time; gone on era load/death. Minimap dot, HUD hint row (`hHunt`) with distance, demo autopilot goes for it first.
- `explodeBlock` now calls `Files.drop(cx, cz)`: 2-3 one-shot folders (`dropMin/dropMax`) fall onto the streets round the block, no respawn and no expiry: they stay until collected.
- Checked headless: drop count, pickup removes it, whole file spawns whistle at (38,38), touching it moves 1970s to 1980s, no console errors. Not checked: how the whistle looks close up, sound, phone, box. Live site down until 2026-12-05: GitHub push and box only; SD copy needs `tools/pack_game.py`.
