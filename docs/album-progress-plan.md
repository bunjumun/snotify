# Album and song progress, from his "album progress strategy" doc

**Status: plan only, nothing built.** Written 2026-08-16 against
`album progress strategy.rtf` at the repo root, which he wrote on the 16th and
pointed at from the notebook: *"check out doc called 'album progress strategy'
in the musicplayer folder, I'd like to add this to the player &lt;musicplayer"*.

It is a plan and not code because the item trips three of the four things the
notebook rule says to stop and plan for: it needs a schema migration, it needs
a new surface on two pages, and it is comfortably more than a session. The
doc's own §1 says the base framework wins any conflict, which is the licence
used below wherever the shape it describes does not fit what the site already
is.

## What the doc asks for

Two checklists with fixed weights, one per song (five phases, 22 leaf tasks) and
one per album (five phases, 15 leaf tasks, one of which is "the mean of the
songs"). A percentage bar for each, clicking a bar drops an accordion of the
phase-grouped checklist, clicking a leaf opens an inspector with status,
assignee, notes, a dynamic list of labelled links, and an optional due date.
Ticking a late task offers to backfill everything before it. Assignee and link
count show as small badges in the collapsed list.

## What the site already is, and what that forces

`projects` are albums, `songs` hang off them, `versions` are the mixes stacked
on a song, `comments` hang off versions. Every write already carries the band
and its password, and RLS is written per band. Two consequences:

1. **Progress is band data, so it goes in tables with the same band gate**, not
   in `localStorage`. Two members must see the same bar or the feature is
   worthless.
2. **The checklist definition is code, not data.** The weights and the task
   names are a design decision he has already made in the doc, and putting them
   in a table invites a half-edited checklist that no longer sums to 100. They
   live in one JS module, versioned by a `checklist_version` integer stored on
   each row, so a future re-cut of the list does not silently rewrite what a
   band already ticked.

## Schema, additive, one migration (v25)

```
progress_tasks
  id            uuid pk
  band          text            not null      -- same gate as everything else
  scope         text            not null      -- 'song' | 'album'
  song_id       uuid null references songs(id) on delete cascade
  project_id    uuid null references projects(id) on delete cascade
  task_key      text            not null      -- stable slug, e.g. 'trk.main_vocals'
  checklist_version int         not null default 1
  done          boolean         not null default false
  done_at       timestamptz null
  assignee      text null
  notes         text null
  due_on        date null
  updated_at    timestamptz     not null default now()
  unique (band, scope, coalesce(song_id, project_id), task_key)

progress_links
  id            uuid pk
  task_id       uuid references progress_tasks(id) on delete cascade
  label         text not null
  url           text not null
  sort          int  not null default 0
```

Notes on that shape, each of which is a decision worth arguing with:

- **A row exists only once a task has been touched.** An untouched checklist is
  zero rows, so turning the feature on costs nothing and adding a task to the
  list later does not need a backfill.
- **`task_key` is a slug, never the display name.** The doc's names are long
  English sentences and he will reword them.
- **Percentages are not stored.** They are summed in the page from the weights
  in the module, so a change to the weights takes effect everywhere at once and
  there is no cached number to go stale. The album's "song completion average"
  phase is computed the same way, from the songs, and never written down.
- **`done_at` is kept** because the timeline items sitting in his LATER list
  ("Album progress timeline", "Song progress timeline") will want it, and it is
  free to record now and impossible to recover later.

## The surfaces

- **Song bar** on the song row in the player, beside the existing controls.
- **Album bar** at the top of the album, on `music.html`.
- Both are a thin bar with the percentage; clicking either drops the accordion
  in place rather than navigating, per the doc.
- The inspector reuses the existing modal shell that the share builder and the
  upload window already use, so it inherits the band gate, the escape handling
  and the styling rather than growing a fourth dialog idiom.
- Badges in the collapsed row: assignee initials and a link count, exactly as
  the doc asks.

## Phasing, so that something is usable early

1. **v25 migration plus the checklist module and the two bars, tick only.** No
   inspector, no links, no assignee. This alone answers "how far along is the
   record", which is the whole point of the item.
2. **The inspector**: assignee, notes, due date.
3. **Links**, which is the only part needing a second table and the only part
   that overlaps a LATER item (reference tracks on a comment). Worth building
   after he has used phase 1, because if reference links land here they may not
   need to land there.
4. **Cascade backfill prompt**, last, because it is the only destructive-feeling
   control in the feature and it is much easier to judge once the list is real.

## What the doc does not settle, and what I would assume

- **Who may tick.** Everything on the site today is band-wide with one password,
  so a tick is anonymous and anyone in the band can undo it. Assumed, unless he
  says a tick should carry a name.
- **Whether the album's 50% "song average" counts songs that have not started.**
  Assumed yes: an album of ten songs with one finished is 5% of that phase, not
  50%. The other reading makes the bar leap about as songs are added.
- **Whether songs not on an album exist.** If they can, the album bar has to
  ignore them; the schema above allows it either way.
- **The weights do sum to 100 in both lists.** Checked. A test in the module
  asserts it, because a hand-edited weight that quietly makes the maximum 97 is
  precisely the sort of defect nobody reports.
