-- S'notify v26 - clearing several progress ticks in one call.
-- Idempotent; additive over v3-v25. Nothing here drops, deletes or retypes a
-- column. ASCII only, same as v25.
--
-- CR-42 - TICK OR CLEAR A WHOLE CATEGORY, OR THE WHOLE LIST.
--   His words: "add 'select all' option to the song checklist" and "allow to
--   click entire category such as 'arrangement' and tick all boxes in that
--   category as well".
--
--   Ticking many was already possible: progress_set_many shipped in v25, early,
--   because it was the same insert with a list instead of a value. Clearing
--   many was not, and it needs to be. A control that can fill twenty-four boxes
--   in one click and then needs twenty-four round trips to undo is not a pair
--   of controls, it is a trap - and the undo is the half people reach for when
--   they have just made a mistake, which is the worst moment to be slow.
--
--   This is the same delete progress_set already performs when a box is
--   unticked, with a list instead of one key. It is scoped to one band, one
--   scope, one ref, and an explicit list of task keys: it cannot clear a whole
--   band, and it cannot touch a song it was not handed. Unticking is the
--   literal undo of ticking and is not the destructive kind of delete that
--   stops to ask - no mix, no comment, no file and no row of his own authoring
--   is reachable from here.

create or replace function progress_clear_many(b text, p text, scope_in text,
                                               ref_in text, keys text[])
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  if scope_in not in ('song','album') then
    raise exception using errcode = '22023', message = 'scope must be song or album';
  end if;
  -- An empty or null list clears nothing, rather than everything. Worth being
  -- explicit about: the difference between those two readings is the whole
  -- record's progress, and "= any(null)" is false for every row rather than an
  -- error, so a bug upstream would fail silently in the safe direction. This
  -- makes the safe direction deliberate instead of lucky.
  if keys is null or array_length(keys, 1) is null then return; end if;
  delete from progress_tasks
   where band = lower(b) and scope = scope_in and ref = ref_in
     and task_key = any(keys);
end $$;

notify pgrst, 'reload schema';
