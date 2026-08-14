---
name: brief
description: Brief him on where everything stands — what the notebook holds, what was done unattended, what is waiting on him, and what the repo state actually is. Use when he asks for a briefing, a status, "where are we", "what's outstanding", "what did you do", or invokes /brief.
---

# Brief

He cannot sit at the screen while work happens, and he does not want to be
notified. This is the other half of that arrangement: he asks, and gets the whole
picture in one pass. Assume he has been away and remembers nothing.

Read everything before saying anything. A brief built from half the sources is
worse than none, because he will act on it.

## Read, in this order

1. Apple Note **"Snalbum waiting on you"** — what needs him. Load the Notes tool
   first: `ToolSearch select:mcp__Read_and_Write_Apple_Notes__get_note_content`.
   If he has typed answers under any entry, those are the most important text in
   the whole brief and are acted on before anything else.
2. Apple Note **"Snalbum feature ideas"** — the notebook. New items since the
   ledger's last read are the second most important thing.
3. `change requests/LEDGER.md` — what is tracked, and at what status.
4. `git log --oneline origin/main..HEAD`, `git status --short`, and the current
   branch. What is built but not live.

**If the Notes connector is unavailable, say so first and loudly.** A brief that
silently omits the notes looks identical to a brief with nothing to report, and
the whole arrangement rests on him trusting that what he writes gets seen.

## Then say, in this order

Lead with **what needs him**, because that is the only part that is blocked on a
human and the only part he can clear right now. For each, one line on what it is
and one on what happens if he does nothing.

Then **what changed since he last looked**: work done unattended, items that
shipped, new notebook items and how they were read.

Then **what is next** and why that one, per the notebook's order: `[bug]` first,
then QUEUE top to bottom. If the notebook is empty, the next step in
`game/PROGRESS.md`.

Then **anything you got wrong or are unsure about**. This section is not
optional. Unattended work with no supervision needs a place where doubt is said
out loud, and if it is always empty he has no reason to believe the rest.

## Length

Short. He is checking in, not reading a report. If it runs past a screen, the
detail belongs in the ledger and the brief should point at it instead.

Never invent progress. "Nothing moved since Tuesday" is a fine brief and a
common one.
