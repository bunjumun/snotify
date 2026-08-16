-- S'notify v28 - a finished track sent back for a remix.
-- Idempotent; additive over v3-v27. ASCII only, same as v25 to v27.
--
-- CR-47 - REOPENING A RELEASED TRACK.
--   His words: "light and lessons are released so they should read 100 with all
--   criteria clicked. i want to be able to mark them if i adjust the mix and
--   plan to remix. tis woul dfrop them to mixed but not masted yet level if
--   ticked", and "this function should be possible for any completed tracks".
--
-- WHY THIS IS A FLAG AND NOT JUST UNTICKING TWO BOXES.
--   Unticking mastering and release on a finished song already produces the
--   right number. What it does not produce is the right MEANING: the result is
--   indistinguishable from a song that was never mastered in the first place,
--   and those two are opposite situations. One is work not yet done; the other
--   is finished work deliberately reopened. A record with three tracks at 79%
--   reads as badly behind if they were never finished and as nearly done if
--   they are all out and one is being remixed. The flag is what tells them
--   apart, on the row and in the list.
--
-- WHY IT CLEARS ITSELF.
--   The flag exists to explain why a released track is not at 100. The moment it
--   is back at 100 there is nothing left to explain, so the page drops it rather
--   than leaving him a second thing to remember to switch off. Anything that
--   needs turning off by hand eventually gets left on, and a stale "remixing"
--   badge on a finished record is worse than no badge at all.
--
--   Kept as a timestamp rather than a boolean, because "since when" is free to
--   record here and impossible to recover afterwards - the same reasoning as
--   done_at in v25, and the album progress timeline in his LATER list will want
--   it.

create table if not exists progress_remix (
  band   text not null references bands(slug),
  scope  text not null check (scope in ('song','album')),
  ref    text not null,
  since  timestamptz not null default now(),
  primary key (band, scope, ref)
);

alter table progress_remix enable row level security;

create or replace function progress_remix_set(b text, p text, scope_in text,
                                              ref_in text, on_in boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  if scope_in not in ('song','album') then
    raise exception using errcode = '22023', message = 'scope must be song or album';
  end if;
  if on_in then
    insert into progress_remix (band, scope, ref)
      values (lower(b), scope_in, ref_in)
      on conflict (band, scope, ref) do nothing;   -- keep the ORIGINAL since
  else
    delete from progress_remix
     where band = lower(b) and scope = scope_in and ref = ref_in;
  end if;
end $$;

-- progress_shape already carries everything else that reshapes a checklist, and
-- any page drawing a bar needs all of it at once. Adding the flags here rather
-- than as a fifth call keeps that true.
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
      from progress_hidden h where h.band = lower(b)), '[]'::jsonb),
    'remix', coalesce((
      select jsonb_agg(jsonb_build_object(
               'scope', r.scope, 'ref', r.ref, 'since', r.since))
      from progress_remix r where r.band = lower(b)), '[]'::jsonb)
  ) into out;
  return out;
end $$;

notify pgrst, 'reload schema';
