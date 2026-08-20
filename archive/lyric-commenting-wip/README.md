# Lyric commenting and suggesting, archived unbuilt

Google-Docs-style commenting and suggesting on lyrics: comment on a phrase
without touching it, or propose the edit itself and let someone accept it.
Threads sit in the margin beside the lines they belong to.

Started 2026-08-10, CSS and markup done, JavaScript never started. It sat as a
`git stash` on `main` for ten days and was flagged as a loose end on every audit
pass since. Archived here on 2026-08-20 at his word ("ARCHIVE this section of
code"), so the work is kept and the stash stops being an open question.

## What is here

`lyric-commenting-2026-08-10.patch` — the stash verbatim, 218 insertions and 59
deletions against `music.html` as it stood at `cf28817`. CSS and markup only.

## Its database side already shipped

`lyric_drafts` and `lyric_suggestions` are live and `lyric_drafts` holds a row,
so there is real data behind an interface nobody can open. That is the reason
this is archived rather than deleted: finishing it later is a live option and
the tables are waiting.

## To bring it back

    git checkout -b lyric-commenting
    git apply --3way archive/lyric-commenting-wip/lyric-commenting-2026-08-10.patch

`music.html` has moved a long way since 10 August, so expect conflicts and
treat the patch as a design reference rather than a drop-in.
