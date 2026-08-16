# His own song workflow, and what it does to the song checklist

**Status: built and live. This is CR-35.** Captured and shipped 2026-08-16,
fourth run, immediately after CR-34 phase 1.

He pasted his real songwriting-to-release process into the session while CR-34
phase 1 was being written up and asked for it to be interpolated into the
progress meter. He answered four design questions, said to disregard the request,
then said to continue it, noting the disregard had come in late. Built on the
four answers below.

**Nothing was lost in the swap.** The `progress_tasks` table was confirmed empty
immediately before the song list was replaced — zero rows, at either scope — so
no band had ticked anything under the version 1 list and there was no migration
to do. `CHECKLIST_VERSION` still moves to 2, because a stored row claiming a
list that no longer exists is worth being able to spot later.

## The four answers, in his words

1. **Which checklist wins.** *"option one but tailor naming and criteria to the
   assets that exist on the site already when possible"* — his workflow
   **replaces** the Gemini song checklist that shipped in phase 1. The album
   checklist is untouched. The qualifier is the important half: task names and
   the criteria for ticking them should point at things that actually exist on
   this site — a version on the stack, a scratch upload, the to-do comments, an
   attached reference track, the lyrics, the starred mix — rather than at
   generic studio nouns.
2. **Weights: by actual effort**, so vocals and editing carry the most points
   and mixing carries few. **With one exception he specified:** *"for mixing
   just have me verify when we are in mix phase, when we are revising mixes and
   when we have chosen a final mix and ready to move to next phase"* — so
   Mixing is three ticks and they are states, not jobs: in the mix phase /
   revising mixes / final mix chosen and ready to move on.
3. **Release lives at both levels.** A song gets its own Release stage, and the
   album keeps the distribution, ISRC/UPC and manufacturing tasks it already
   has. Accepted with the duplication that implies: a song on a record can be
   released as a single ahead of it, and that is a real thing he does.
4. **Songwriting is three boxes, not five:** *"idea, prototypes, and written"*.
   His own doc lists five (Inception, Gestation, Development, Writing,
   Refining); he collapsed the middle. "Prototypes" is his word and is not the
   same as Gestation — it points at something recordable, which lines up with
   answer 1: a prototype is a scratch or demo version sitting on the song.

## What was built: nine stages, 27 leaves, 100 points

Weights are effort-ordered per answer 2, so the bar measures work remaining
rather than how much each stage matters. That is why mixing is only 9 despite
being the thing that makes or breaks a record.

| # | Stage | Weight | Leaves |
|---|---|---|---|
| 1 | Songwriting | 12 | idea 3 · prototypes 4 · written through 5 |
| 2 | Recording: foundation | 10 | tempo settled 4 · main instrument tracked 6 |
| 3 | Arrangement | 15 | body 7 · filler 4 · atmospheres 4 |
| 4 | Editing | 18 | body 8 · filler and atmospheres 4 · gain staging 3 · rough mix uploaded 3 |
| 5 | Mixing | 9 | in the mix phase 2 · revising 3 · final chosen 4 |
| 6 | Vocals | 22 | 8 takes 5 · comp to 4 (4) · comp to 2 (4) · pitch correct 3 · comp to 1 (3) · vocal mixed 3 |
| 7 | Sweetening | 6 | automation and builds 3 · doubles and transition effects 3 |
| 8 | Mastering | 5 | master EQ 2 · compression and limiting 3 |
| 9 | Release | 3 | artwork and lyrics attached 1 · out on Soundcloud or a distributor 2 |

Editing at 18 and Vocals at 22 are the two heaviest, which is his own account of
where the hours go. Mixing's three leaves are **states, not jobs** — the exact
thing he asked for, because a mix is not a checklist, it is a place a song is in.

**Named against things on the site**, per answer 1. A prototype is a scratch
version on the stack. A rough mix is an upload the band can comment on. Revising
mixes is the to-do list filling and emptying. The final mix is the one wearing
the star. Artwork and lyrics are the attachments the song already supports. Each
of those is a box he can settle by looking at the page instead of by
remembering.

## What is still open

- **The weights are a first cut.** Effort-ordered was agreed; these particular
  numbers were not. They live in one file, one line each, and changing one moves
  every bar on the site at once with nothing cached to disagree.
- **Sweetening sits after Vocals here**, matching the order in his write-up. If
  he sweetens while the vocal is still being comped, the two should swap — it
  changes nothing about the arithmetic, only the reading order and what the
  phase-4 cascade backfill would consider "prior".
- **The album checklist is untouched** and is still the generated one. He only
  replaced the song list. Its "song completion average" phase keeps working
  unchanged, because both lists are out of 100.
