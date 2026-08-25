# Skill scripting audit — 2026-08-25

Scope taken for the QUEUE item "identify any steps in my existing skills that
can be programmatic scripts... review my entire conversation history to
identify any skills you should create": this project's and the user-level
skills' own SKILL.md files, plus the pattern evidence already sitting in this
project's ledger and notebook (which is itself a condensed record of past
sessions). A raw mine of every session transcript across every project was not
attempted — that is a larger, separate pass; flagged in the outbox.

## Already scripted (the pattern to keep following)

- `~/.claude/scripts/notes_entities.py` — repairs stripped entities on note
  read, escapes them on write. Exactly the shape this audit recommends
  elsewhere: a mechanical, order-sensitive text transform pulled out of prose
  instructions into a script that can't be misremembered.
- `~/.claude/skills/gtr/scripts/worktree-up.sh` — the gtr skill already
  externalizes its git-worktree mechanics into a script rather than describing
  the git commands in prose.

## New: verify-live.sh

`music-player/scripts/verify-live.sh` (built this pass). The single most
repeated manual step in the entire ledger — "hashed off the live site to
confirm" — appears independently by hand in at least a dozen COMPLETED
entries, each time as a freshly typed curl+shasum+compare. Replaced with:

```bash
scripts/verify-live.sh index.html game/src/entities/Diver.js
```

Prints MATCH/MISMATCH per file against `https://bunjumun.github.io/snotify`
(override with `SNALBUM_LIVE_URL`). Tested against the live site this pass —
both files matched.

## Candidates not built (smaller payoff, listed for a decision)

- **git-state snapshot.** `git branch --show-current`, `git status --short`,
  `git worktree list`, `git stash list` are run as a group at the start of
  nearly every audit pass and before every ship. Worth a one-line script only
  if the manual four-command form is actually causing friction — it isn't
  costing correctness today, just a few tokens each run.
- **Note read/repair wrapper.** The `get_note_content | notes_entities.py
  repair` pipe is already one line; scripting it further (e.g. a Python
  wrapper that calls the MCP tool directly) would need shell access to the MCP
  layer that isn't cleanly available outside the agent, so left as prose.

## Skills worth creating

Nothing new stood out as clearly missing. The two most recently created
user-level skills (`improve-system`, `grant-writing-assistant`) already cover
the two gaps that kept recurring in the ledger (stale/duplicate note content,
and the grant-writing request). No third gap showed up in the ledger's own
history of repeated manual work — the repeated *manual work* was the live-hash
step, and that's now a script rather than a skill, since it's deterministic
with no judgment calls in it.

If a deeper pass across raw session transcripts (not just this ledger) turns
up a different repeated judgment-call pattern, that's the next candidate for a
skill — but that mine is its own session-sized task, not folded into this one.
