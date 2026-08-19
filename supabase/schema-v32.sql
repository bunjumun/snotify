-- S'notify v32 — the progress inspector (phase 2 of the album-progress plan).
--
-- No new columns. progress_tasks already carries assignee, notes and due_on
-- from v25; nothing has ever written them. This adds the write path and
-- changes progress_set's untick branch, per the comment already sitting in
-- v25: "Phase 2 changes this... this function grows a branch that keeps the
-- row when any of those fields is set."

-- ---------------------------------------------------------------------------
-- Write: assignee, notes, due date. Upserts a row even when the task is not
-- ticked, because an unticked task can now carry something worth keeping —
-- "remind me to finish the vocals" does not require the vocals be done.
-- done/done_at are untouched here; this function never ticks or unticks.
-- ---------------------------------------------------------------------------
-- progress_all's own WHERE clause only ever selected done rows, from before a
-- row could exist without being done. An unticked task carrying a due date or
-- a note would have been written successfully and then never read back,
-- which is a silent loss rather than an error. Widened to match what a row
-- can now be.
create or replace function progress_all(b text, p text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare out jsonb;
begin
  perform _require_pass(b, p);
  return coalesce((select jsonb_agg(jsonb_build_object(
           'scope', t.scope, 'ref', t.ref, 'key', t.task_key,
           'done', t.done, 'done_at', t.done_at,
           'assignee', t.assignee, 'notes', t.notes, 'due_on', t.due_on,
           'v', t.checklist_version))
    from progress_tasks t
   where t.band = lower(b)
     and (t.done or t.assignee is not null or t.notes is not null or t.due_on is not null)),
  '[]'::jsonb);
end $$;

create or replace function progress_set_meta(b text, p text, scope_in text,
                                             ref_in text, key_in text,
                                             assignee_in text, notes_in text,
                                             due_in date,
                                             ver_in int default 1) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  if scope_in not in ('song','album') then
    raise exception using errcode = '22023', message = 'scope must be song or album';
  end if;
  insert into progress_tasks (band, scope, ref, task_key, checklist_version,
                              done, assignee, notes, due_on, updated_at)
    values (lower(b), scope_in, ref_in, key_in, ver_in, false,
            nullif(trim(assignee_in), ''), nullif(trim(notes_in), ''), due_in, now())
    on conflict (band, scope, ref, task_key) do update set
      assignee = nullif(trim(assignee_in), ''),
      notes = nullif(trim(notes_in), ''),
      due_on = due_in,
      updated_at = now();
end $$;

-- ---------------------------------------------------------------------------
-- progress_set, untick branch: keep the row if it carries meta.
--
-- Was an unconditional delete. A task with a due date and a note attached,
-- then unticked because the work is not actually done yet, would have thrown
-- both away with the tick — exactly backwards, since the note is most useful
-- while the task is still open. Deleting stays the right move for a bare tick
-- with nothing else on it: that is the common case and the row is genuinely
-- nothing once done is false.
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
    update progress_tasks set done = false, done_at = null, updated_at = now()
     where band = lower(b) and scope = scope_in and ref = ref_in
       and task_key = key_in
       and (assignee is not null or notes is not null or due_on is not null);
    delete from progress_tasks
     where band = lower(b) and scope = scope_in and ref = ref_in
       and task_key = key_in
       and assignee is null and notes is null and due_on is null;
  end if;
end $$;

notify pgrst, 'reload schema';
