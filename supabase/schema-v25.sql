-- S'notify v25 - how far along is the record.
-- Idempotent; additive over v3-v24. Nothing here drops, deletes or retypes.
--
-- ASCII ONLY, deliberately. This no longer travels through a clipboard into a
-- browser - as of 15 Aug it goes straight through the Supabase connector - but
-- the file is still the copy he can read before it fires, and a file that is
-- ASCII everywhere is a file that reads the same in every window it is opened
-- in. Cheap to keep, so keep it.
--
-- CR-34 PHASE 1 - THE TWO PROGRESS BARS, TICKING ONLY.
--   From his notebook line: "check out doc called 'album progress strategy' in
--   the musicplayer folder, I'd like to add this to the player". The doc asks
--   for two weighted checklists - 22 leaf tasks on a song, 15 on an album - a
--   percentage bar for each that opens into the list, and later an inspector on
--   every task with an assignee, notes, links and a due date. The plan in
--   docs/album-progress-plan.md phases that; this migration carries all of it,
--   because the columns the inspector needs are free to add now and awkward to
--   add later, and only the ticking is wired up in the page today.
--
-- WHY THE CHECKLIST ITSELF IS NOT IN HERE.
--   The task names and their weights live in progress.js, not in a table. They
--   are a design decision he has already made on paper, and a table invites a
--   half-edited list that no longer sums to 100 with no way to notice. What is
--   stored instead is checklist_version on each row, so that re-cutting the
--   list later cannot silently rewrite what a band has already ticked.
--
-- WHY A ROW EXISTS ONLY ONCE A TASK IS TOUCHED.
--   An untouched checklist is zero rows. Turning this on costs nothing for a
--   band that never opens it, and adding a task to the list later needs no
--   backfill. It also means "not done" and "never looked at" are the same
--   thing in storage, which is true: an unticked box carries no information.
--
-- WHY (band, scope, ref) AND NOT TWO NULLABLE FOREIGN KEYS.
--   The plan said song_id uuid and project_id uuid side by side. projects has
--   no id - its primary key has been slug text since v3 - so that shape could
--   not be built. A single ref column carries the song's FOLDER when the scope
--   is a song and the project's SLUG when it is an album. folder is already the
--   stable song key everywhere else here: project membership, deep links and
--   rename_song all use it, and it survives a retitle where a title does not.
--
--   The cost, stated rather than hidden: one column cannot reference two tables
--   conditionally, so there is no cascade and deleting a song leaves its
--   progress behind. Those rows are invisible - nothing reads a ref that is not
--   in the library - and if a trashed song is restored its progress comes back
--   with it, which is the better of the two failures.
--
-- PERCENTAGES ARE NEVER STORED. They are summed in the page from the weights in
--   the module, so changing a weight takes effect everywhere at once and there
--   is no cached number to go stale. The album's "song completion average"
--   phase is computed the same way, from the songs, and never written down.

create table if not exists progress_tasks (
  id                uuid primary key default gen_random_uuid(),
  band              text not null references bands(slug),
  scope             text not null check (scope in ('song','album')),
  ref               text not null,           -- song folder, or project slug
  task_key          text not null,           -- stable slug from progress.js
  checklist_version int  not null default 1,
  done              boolean not null default false,
  done_at           timestamptz,             -- kept for the timeline items in LATER
  assignee          text,                    -- phase 2, column free to add now
  notes             text,                    -- phase 2
  due_on            date,                    -- phase 2
  updated_at        timestamptz not null default now(),
  unique (band, scope, ref, task_key)
);
create index if not exists progress_band on progress_tasks (band, scope, ref);

-- Phase 3. The table is created now because it is two lines and creating it
-- later would mean a second migration for a feature already agreed; nothing
-- reads or writes it yet.
create table if not exists progress_links (
  id       uuid primary key default gen_random_uuid(),
  task_id  uuid not null references progress_tasks(id) on delete cascade,
  label    text not null,
  url      text not null,
  sort     int  not null default 0
);
create index if not exists progress_links_task on progress_links (task_id, sort);

-- Same posture as every other table here: RLS on, zero anon policies, all
-- access through the SECURITY DEFINER functions below, each of which checks the
-- band password server-side.
alter table progress_tasks enable row level security;
alter table progress_links enable row level security;

-- ---------------------------------------------------------------------------
-- Read: everything the band has ticked, in one call.
--
-- One call rather than one per song, because the album bar needs the mean
-- across every song in it - so a page that draws any bar already needs all of
-- them, and asking per song would be a round trip per row of the library. The
-- whole payload is at most 22 rows per song plus 15 per album, and only for
-- tasks actually touched.
-- ---------------------------------------------------------------------------
create or replace function progress_all(b text, p text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare out jsonb;
begin
  perform _require_pass(b, p);
  select coalesce(jsonb_agg(jsonb_build_object(
           'scope', t.scope, 'ref', t.ref, 'key', t.task_key,
           'done', t.done, 'done_at', t.done_at,
           'assignee', t.assignee, 'notes', t.notes, 'due_on', t.due_on,
           'v', t.checklist_version)), '[]'::jsonb)
    into out
    from progress_tasks t
   where t.band = lower(b) and t.done;
  return out;
end $$;

-- ---------------------------------------------------------------------------
-- Write: one tick.
--
-- Unticking DELETES the row rather than setting done to false. The two are the
-- same state - an unticked box says nothing - and keeping a false row around
-- would mean the "a row exists only once it is touched" rule quietly stops
-- being true after the first mistake. Phase 2 changes this: once a task can
-- carry notes and an assignee, an unticked row has something in it worth
-- keeping, and this function grows a branch that keeps the row when any of
-- those fields is set. It cannot happen yet because nothing can set them.
--
-- Deleting a row this function's own caller just created is not the destructive
-- kind of delete the rules stop for: it is scoped to one band, one task, and it
-- is the literal undo of a tick.
-- ---------------------------------------------------------------------------
create or replace function progress_set(b text, p text, scope_in text,
                                        ref_in text, key_in text,
                                        done_in boolean,
                                        ver_in int default 1) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  if scope_in not in ('song','album') then
    raise exception using errcode = '22023', message = 'scope must be song or album';
  end if;
  if done_in then
    insert into progress_tasks (band, scope, ref, task_key, checklist_version,
                                done, done_at, updated_at)
      values (lower(b), scope_in, ref_in, key_in, ver_in, true, now(), now())
      on conflict (band, scope, ref, task_key) do update set
        done = true,
        done_at = coalesce(progress_tasks.done_at, now()),
        checklist_version = excluded.checklist_version,
        updated_at = now();
  else
    delete from progress_tasks
     where band = lower(b) and scope = scope_in and ref = ref_in
       and task_key = key_in;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Write: the cascade backfill, one call.
--
-- Phase 4 in the plan, and the page does not offer it yet. It is here because
-- it is the same insert as above with a list instead of a value, and shipping
-- it now means phase 4 is a page change with no migration behind it.
-- ---------------------------------------------------------------------------
create or replace function progress_set_many(b text, p text, scope_in text,
                                             ref_in text, keys text[],
                                             ver_in int default 1) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  if scope_in not in ('song','album') then
    raise exception using errcode = '22023', message = 'scope must be song or album';
  end if;
  insert into progress_tasks (band, scope, ref, task_key, checklist_version,
                              done, done_at, updated_at)
    select lower(b), scope_in, ref_in, k, ver_in, true, now(), now()
      from unnest(keys) as k
    on conflict (band, scope, ref, task_key) do update set
      done = true,
      done_at = coalesce(progress_tasks.done_at, now()),
      updated_at = now();
end $$;

notify pgrst, 'reload schema';
