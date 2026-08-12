-- S'music v19 — Band assets: the lore document, stacked by draft.
-- Paste into Supabase -> SQL Editor -> Run. Idempotent; additive over v3–v18.
--
-- The band's story has been living in an RTF on one person's laptop. That was
-- fine while one person was writing it and nothing downstream read it, and it
-- stopped being fine the moment the game started telling that story back: the
-- fish dialogue, the ship's log and the lore doc could drift apart silently,
-- because nothing errors when a game tells a version of the story that the
-- document no longer says.
--
-- So the document moves here and gets the same treatment every other asset on
-- this site gets: versions, stacked, reorderable, with ONE of them marked
-- active. The game reads the active draft and nothing else. Write a new draft,
-- leave it inactive, and the game carries on telling the old one until you
-- promote it — which is the point. Drafts are for drafting.
--
-- Access follows the same split as v18's game_tracks(), and for the same
-- reason. Reading the ACTIVE draft is public and password-free, because the
-- game is a public page and cannot hold a band password without handing it to
-- anyone who views source. Everything else — listing drafts, writing them,
-- reordering, promoting — is behind the band password. So the exposure is
-- exactly "the one draft you deliberately made live", and never the drafts you
-- haven't finished.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists lore_docs (
  id          uuid primary key default gen_random_uuid(),
  band        text not null,
  slug        text not null default 'lore',
  title       text not null default 'Lore document',
  created_at  timestamptz not null default now(),
  unique (band, slug)
);

create table if not exists lore_versions (
  id          uuid primary key default gen_random_uuid(),
  doc_id      uuid not null references lore_docs(id) on delete cascade,
  name        text not null,
  body        text not null default '',
  -- Same ordering convention as songs and versions: position first, then
  -- newest, so "the top of the stack" means one thing everywhere on this site.
  position    int not null default 0,
  active      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  trashed_at  timestamptz
);

create index if not exists lore_versions_doc on lore_versions (doc_id, position, created_at desc);

-- Exactly one live draft per document, enforced by the database rather than by
-- whichever page happened to write last.
create unique index if not exists lore_one_active
  on lore_versions (doc_id) where active and trashed_at is null;

alter table lore_docs enable row level security;
alter table lore_versions enable row level security;
-- No policies, deliberately. Every read and write goes through a function
-- below, so there is no path to these tables that skips the password check.

-- ---------------------------------------------------------------------------
-- lore_active — what the game reads. Public, no password.
--
-- Returns the one active draft, or null if the band has never promoted one, in
-- which case the game falls back to the lore compiled into its own source. It
-- is safe for this to be public in a way that "the newest draft" would not be:
-- active is a deliberate act.
-- ---------------------------------------------------------------------------
create or replace function lore_active(b text default 'lakehorse')
returns jsonb
language sql stable security definer set search_path = public as $BODY$
  select jsonb_build_object(
           'name',    v.name,
           'body',    v.body,
           'updated', v.updated_at)
  from lore_docs d
  join lore_versions v on v.doc_id = d.id
  where d.band = lower(b) and d.slug = 'lore'
    and v.active and v.trashed_at is null
  limit 1
$BODY$;

revoke all on function lore_active(text) from public;
grant execute on function lore_active(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Everything below is band-password gated through _require_pass, exactly like
-- the library edits in v3.
-- ---------------------------------------------------------------------------

-- The whole stack, newest-shaped first, for the Band assets page.
create or replace function lore_list(b text, p text)
returns jsonb
language plpgsql security definer set search_path = public as $BODY$
declare out_json jsonb;
begin
  perform _require_pass(b, p);
  -- position, then newest — the same order the music page stacks versions in.
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id',       v.id,
             'name',     v.name,
             'body',     v.body,
             'position', v.position,
             'active',   v.active,
             'created',  v.created_at,
             'updated',  v.updated_at)
           order by v.position, v.created_at desc), '[]'::jsonb) into out_json
  from lore_docs d
  join lore_versions v on v.doc_id = d.id
  where d.band = lower(b) and d.slug = 'lore' and v.trashed_at is null;
  return out_json;
end $BODY$;

-- Write a draft. Omit id for a new one; pass it to overwrite an existing one.
-- The first draft a band ever saves becomes the active one, because a document
-- nobody has promoted yet is more useful live than not.
create or replace function lore_save(b text, p text, nm text, body_in text, vid uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $BODY$
declare did uuid; out_id uuid; n int;
begin
  perform _require_pass(b, p);

  select id into did from lore_docs where band = lower(b) and slug = 'lore';
  if did is null then
    insert into lore_docs (band, slug) values (lower(b), 'lore') returning id into did;
  end if;

  if vid is null then
    select coalesce(max(position), -1) + 1 into n from lore_versions where doc_id = did;
    insert into lore_versions (doc_id, name, body, position)
      values (did, coalesce(nullif(trim(nm), ''), 'Draft'), coalesce(body_in, ''), n)
      returning id into out_id;
    -- Nothing live yet? Then this is live.
    if not exists (select 1 from lore_versions
                   where doc_id = did and active and trashed_at is null) then
      update lore_versions set active = true where id = out_id;
    end if;
  else
    update lore_versions
       set name = coalesce(nullif(trim(nm), ''), name),
           body = coalesce(body_in, body),
           updated_at = now()
     where id = vid and doc_id = did
     returning id into out_id;
    if out_id is null then
      raise exception using errcode = '42501', message = 'draft not in this band';
    end if;
  end if;

  return out_id;
end $BODY$;

-- Promote a draft. The unique index guarantees one winner; clearing first keeps
-- it from tripping over itself mid-statement.
create or replace function lore_set_active(b text, p text, vid uuid)
returns void
language plpgsql security definer set search_path = public as $BODY$
declare did uuid;
begin
  perform _require_pass(b, p);
  select d.id into did from lore_docs d
   join lore_versions v on v.doc_id = d.id
   where v.id = vid and d.band = lower(b) and d.slug = 'lore';
  if did is null then
    raise exception using errcode = '42501', message = 'draft not in this band';
  end if;
  update lore_versions set active = false where doc_id = did and active;
  update lore_versions set active = true, updated_at = now() where id = vid;
end $BODY$;

-- Reorder the stack. Takes the ids in the order you want them.
create or replace function lore_reorder(b text, p text, ids uuid[])
returns void
language plpgsql security definer set search_path = public as $BODY$
declare did uuid;
begin
  perform _require_pass(b, p);
  select id into did from lore_docs where band = lower(b) and slug = 'lore';
  if did is null then return; end if;
  update lore_versions v
     set position = t.ord - 1
    from unnest(ids) with ordinality as t(vid, ord)
   where v.id = t.vid and v.doc_id = did;
end $BODY$;

-- Soft delete, matching how the library trashes things. The active draft can't
-- be trashed out from under the game — promote another one first.
create or replace function lore_trash(b text, p text, vid uuid)
returns void
language plpgsql security definer set search_path = public as $BODY$
declare is_active boolean;
begin
  perform _require_pass(b, p);
  select v.active into is_active
    from lore_versions v join lore_docs d on d.id = v.doc_id
   where v.id = vid and d.band = lower(b) and d.slug = 'lore';
  if is_active is null then
    raise exception using errcode = '42501', message = 'draft not in this band';
  end if;
  if is_active then
    raise exception 'that draft is the live one — make another one active first';
  end if;
  update lore_versions set trashed_at = now() where id = vid;
end $BODY$;

revoke all on function lore_list(text, text)                    from public;
revoke all on function lore_save(text, text, text, text, uuid)  from public;
revoke all on function lore_set_active(text, text, uuid)        from public;
revoke all on function lore_reorder(text, text, uuid[])         from public;
revoke all on function lore_trash(text, text, uuid)             from public;
grant execute on function lore_list(text, text)                   to anon, authenticated;
grant execute on function lore_save(text, text, text, text, uuid) to anon, authenticated;
grant execute on function lore_set_active(text, text, uuid)       to anon, authenticated;
grant execute on function lore_reorder(text, text, uuid[])        to anon, authenticated;
grant execute on function lore_trash(text, text, uuid)            to anon, authenticated;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- What the game does with the body it gets back.
--
-- Prose is prose — write the story however you like. The game only looks for
-- exchange lines, which are any pair of lines marked as a question and an
-- answer. All of these work, case-insensitively:
--
--   Q: You're not from the water. Where do you come from?
--   A: A planet called Earth. It is not there any more.
--
--   Ask: ...        Say: ...
--   Fish: ...       Diver: ...
--
-- Every pair found replaces one line of the game's built-in conversation, in
-- order. Find none and the game keeps its own — so a document that is pure
-- prose changes nothing and breaks nothing. See game/src/game/LoreFeed.js.
-- ---------------------------------------------------------------------------
