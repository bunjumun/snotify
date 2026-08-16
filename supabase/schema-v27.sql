-- S'notify v27 - checklist items of his own, per song and per record.
-- Idempotent; additive over v3-v26. ASCII only, same as v25 and v26.
--
-- CR-45 - ADD OR REMOVE ITEMS ON ONE SONG OR ONE RECORD.
--   His words: "allow me to add or remove tems to album progress list that are
--   unique to particular item i am editing on, these should stretch or compress
--   completion weghts appropriately".
--
--   Two tables, because adding and removing are genuinely different things and
--   folding them into one would mean a row that is sometimes an item and
--   sometimes the absence of one.
--
-- WHY A CUSTOM ITEM IS TICKED THROUGH THE EXISTING MACHINERY.
--   progress_items only DEFINES an item - what it is called, which category it
--   belongs to, how heavy it is. Whether it is DONE is stored in progress_tasks
--   like everything else, under the task key 'c.<uuid>'. So ticking, unticking,
--   the category toggles, tick-everything, the album average and the whole
--   read-only bar on the other two pages all work on custom items on day one,
--   with no code that knows they are custom. The alternative - a `done` column
--   here - would have meant every one of those paths growing a second source of
--   truth to consult.
--
-- WHY REMOVING A BUILT-IN ITEM HIDES IT RATHER THAN DELETING ANYTHING.
--   The built-in checklist lives in code, not in a table, so there is no row to
--   delete. progress_hidden records that one song does not want one of them.
--   That also makes it reversible for free, and it means re-cutting the built-in
--   list later cannot resurrect an item he had already dismissed.

create table if not exists progress_items (
  id         uuid primary key default gen_random_uuid(),
  band       text not null references bands(slug),
  scope      text not null check (scope in ('song','album')),
  ref        text not null,
  phase_key  text not null,          -- which category it sits in
  label      text not null,
  -- Its size RELATIVE to the other items in its category. 0 means "an ordinary
  -- one", resolved in the page to the average of that category's built-ins, so
  -- adding an item never requires him to think about numbers.
  weight     int  not null default 0,
  sort       int  not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists progress_items_ref on progress_items (band, scope, ref);

create table if not exists progress_hidden (
  band      text not null references bands(slug),
  scope     text not null check (scope in ('song','album')),
  ref       text not null,
  task_key  text not null,
  primary key (band, scope, ref, task_key)
);

alter table progress_items  enable row level security;
alter table progress_hidden enable row level security;

-- ---------------------------------------------------------------------------
-- Read: every custom item and every hidden built-in for the band, in one call,
-- for the same reason progress_all is one call - any page drawing a bar needs
-- all of them at once to work out the record's average.
-- ---------------------------------------------------------------------------
create or replace function progress_shape(b text, p text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare out jsonb;
begin
  perform _require_pass(b, p);
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'scope', i.scope, 'ref', i.ref,
               'phase', i.phase_key, 'label', i.label,
               'weight', i.weight, 'sort', i.sort)
             order by i.sort, i.created_at)
      from progress_items i where i.band = lower(b)), '[]'::jsonb),
    'hidden', coalesce((
      select jsonb_agg(jsonb_build_object(
               'scope', h.scope, 'ref', h.ref, 'key', h.task_key))
      from progress_hidden h where h.band = lower(b)), '[]'::jsonb)
  ) into out;
  return out;
end $$;

-- ---------------------------------------------------------------------------
-- Add one item. Returns its id so the page can tick it immediately without a
-- second round trip to find out what it just made.
-- ---------------------------------------------------------------------------
create or replace function progress_item_add(b text, p text, scope_in text,
                                             ref_in text, phase_in text,
                                             label_in text,
                                             weight_in int default 0) returns uuid
language plpgsql security definer set search_path = public as $$
declare new_id uuid; next_sort int;
begin
  perform _require_pass(b, p);
  if scope_in not in ('song','album') then
    raise exception using errcode = '22023', message = 'scope must be song or album';
  end if;
  if coalesce(btrim(label_in), '') = '' then
    raise exception using errcode = '22023', message = 'an item needs a name';
  end if;
  select coalesce(max(sort), 0) + 1 into next_sort
    from progress_items
   where band = lower(b) and scope = scope_in and ref = ref_in and phase_key = phase_in;
  insert into progress_items (band, scope, ref, phase_key, label, weight, sort)
    values (lower(b), scope_in, ref_in, phase_in, btrim(label_in),
            greatest(coalesce(weight_in, 0), 0), next_sort)
    returning id into new_id;
  return new_id;
end $$;

-- ---------------------------------------------------------------------------
-- Remove one item he added, and the tick that went with it.
--
-- This deletes, and it is worth being precise about what. The row being removed
-- is one he typed himself and has just asked to remove; the tick going with it
-- is meaningless once the thing it was about is gone, and leaving it would mean
-- an orphaned row silently counting toward nothing. It cannot reach a mix, a
-- comment, a file, or any built-in item. It is scoped to one band, one song or
-- record, and one id.
-- ---------------------------------------------------------------------------
create or replace function progress_item_del(b text, p text, id_in uuid) returns void
language plpgsql security definer set search_path = public as $$
declare it progress_items;
begin
  perform _require_pass(b, p);
  select * into it from progress_items where id = id_in and band = lower(b);
  if not found then return; end if;          -- already gone, or not this band's
  delete from progress_tasks
   where band = lower(b) and scope = it.scope and ref = it.ref
     and task_key = 'c.' || id_in::text;
  delete from progress_items where id = id_in and band = lower(b);
end $$;

-- ---------------------------------------------------------------------------
-- Hide or restore a built-in item for one song or one record.
--
-- Hiding also clears its tick. A hidden item contributes nothing to the score,
-- so a tick left behind would be invisible and still counted the moment it was
-- restored - which is exactly the kind of thing that makes a percentage move
-- for no reason anyone can explain.
-- ---------------------------------------------------------------------------
create or replace function progress_hide(b text, p text, scope_in text,
                                         ref_in text, key_in text,
                                         hide boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  if scope_in not in ('song','album') then
    raise exception using errcode = '22023', message = 'scope must be song or album';
  end if;
  if hide then
    insert into progress_hidden (band, scope, ref, task_key)
      values (lower(b), scope_in, ref_in, key_in)
      on conflict do nothing;
    delete from progress_tasks
     where band = lower(b) and scope = scope_in and ref = ref_in and task_key = key_in;
  else
    delete from progress_hidden
     where band = lower(b) and scope = scope_in and ref = ref_in and task_key = key_in;
  end if;
end $$;

notify pgrst, 'reload schema';
