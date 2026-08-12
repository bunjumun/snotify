-- S'music v21 — Band assets holds more than one document.
-- Paste into Supabase -> SQL Editor -> Run. Idempotent; additive over v3–v20.
--
-- v19 built the lore document and hardcoded slug = 'lore' into every function,
-- which was fine for exactly one document and stopped being fine the moment
-- there was a second one. The ship's log wants the same treatment — drafts,
-- ordering, one of them live, read by the game — and it should not need its own
-- copy of five functions to get it.
--
-- So the slug becomes a parameter, defaulting to 'lore' so every existing call
-- from the page keeps working untouched. `lore_docs` already had the column and
-- the unique (band, slug) constraint; nothing about the tables changes.

-- ---------------------------------------------------------------------------
-- Drop the old signatures first.
--
-- `create or replace` matches on the argument list, so adding a `d` parameter
-- would leave the v19 functions in place beside the new ones as overloads —
-- and then every existing call that passes only (b) or (b, p) matches BOTH,
-- which PostgREST refuses to resolve: "could not choose the best candidate
-- function". The page would break the moment this was applied, so the old ones
-- have to go rather than accumulate.
-- ---------------------------------------------------------------------------
drop function if exists lore_active(text);
drop function if exists lore_list(text, text);
drop function if exists lore_save(text, text, text, text, uuid);
drop function if exists lore_reorder(text, text, uuid[]);

-- ---------------------------------------------------------------------------
-- Public read, per document. What the game calls.
-- ---------------------------------------------------------------------------
create or replace function lore_active(b text default 'lakehorse', d text default 'lore')
returns jsonb
language sql stable security definer set search_path = public as $BODY$
  select jsonb_build_object(
           'name',    v.name,
           'body',    v.body,
           'updated', v.updated_at)
  from lore_docs doc
  join lore_versions v on v.doc_id = doc.id
  where doc.band = lower(b) and doc.slug = coalesce(nullif(d, ''), 'lore')
    and v.active and v.trashed_at is null
  limit 1
$BODY$;

revoke all on function lore_active(text, text) from public;
grant execute on function lore_active(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- And the band-gated half.
-- ---------------------------------------------------------------------------
create or replace function lore_list(b text, p text, d text default 'lore')
returns jsonb
language plpgsql security definer set search_path = public as $BODY$
declare out_json jsonb;
begin
  perform _require_pass(b, p);
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
  from lore_docs doc
  join lore_versions v on v.doc_id = doc.id
  where doc.band = lower(b) and doc.slug = coalesce(nullif(d, ''), 'lore')
    and v.trashed_at is null;
  return out_json;
end $BODY$;

create or replace function lore_save(b text, p text, nm text, body_in text,
                                     vid uuid default null, d text default 'lore')
returns uuid
language plpgsql security definer set search_path = public as $BODY$
declare did uuid; out_id uuid; n int; slug_in text := coalesce(nullif(d, ''), 'lore');
begin
  perform _require_pass(b, p);

  select id into did from lore_docs where band = lower(b) and slug = slug_in;
  if did is null then
    insert into lore_docs (band, slug, title)
      values (lower(b), slug_in, initcap(replace(slug_in, '-', ' ')))
      returning id into did;
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
      raise exception using errcode = '42501', message = 'draft not in this document';
    end if;
  end if;

  return out_id;
end $BODY$;

-- set_active, reorder and trash already find the document through the version
-- id, so they never needed the slug — they are re-declared here only because
-- reorder scopes by document and has to stop scoping by 'lore'.
create or replace function lore_reorder(b text, p text, ids uuid[], d text default 'lore')
returns void
language plpgsql security definer set search_path = public as $BODY$
declare did uuid;
begin
  perform _require_pass(b, p);
  select id into did from lore_docs
   where band = lower(b) and slug = coalesce(nullif(d, ''), 'lore');
  if did is null then return; end if;
  update lore_versions v
     set position = t.ord - 1
    from unnest(ids) with ordinality as t(vid, ord)
   where v.id = t.vid and v.doc_id = did;
end $BODY$;

create or replace function lore_set_active(b text, p text, vid uuid)
returns void
language plpgsql security definer set search_path = public as $BODY$
declare did uuid;
begin
  perform _require_pass(b, p);
  -- The document is found through the version, so this works for any slug.
  select doc.id into did from lore_docs doc
   join lore_versions v on v.doc_id = doc.id
   where v.id = vid and doc.band = lower(b);
  if did is null then
    raise exception using errcode = '42501', message = 'draft not in this band';
  end if;
  update lore_versions set active = false where doc_id = did and active;
  update lore_versions set active = true, updated_at = now() where id = vid;
end $BODY$;

create or replace function lore_trash(b text, p text, vid uuid)
returns void
language plpgsql security definer set search_path = public as $BODY$
declare is_active boolean;
begin
  perform _require_pass(b, p);
  select v.active into is_active
    from lore_versions v join lore_docs doc on doc.id = v.doc_id
   where v.id = vid and doc.band = lower(b);
  if is_active is null then
    raise exception using errcode = '42501', message = 'draft not in this band';
  end if;
  if is_active then
    raise exception 'that draft is the live one — make another one active first';
  end if;
  update lore_versions set trashed_at = now() where id = vid;
end $BODY$;

revoke all on function lore_list(text, text, text)                          from public;
revoke all on function lore_save(text, text, text, text, uuid, text)        from public;
revoke all on function lore_reorder(text, text, uuid[], text)               from public;
grant execute on function lore_list(text, text, text)                        to anon, authenticated;
grant execute on function lore_save(text, text, text, text, uuid, text)      to anon, authenticated;
grant execute on function lore_reorder(text, text, uuid[], text)             to anon, authenticated;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Documents the game reads, and what it does with each:
--
--   lore   Q:/A: pairs become fish/diver exchanges; failing that the prose
--          itself does, a sentence at a time. See game/src/game/LoreFeed.js.
--   log    the ship's log. Each entry is a heading line starting with # and the
--          prose under it, and they are found in the order they're written.
--          See game/src/game/LogFeed.js.
--
-- Both fall back to the copy compiled into the game when no draft is live, so
-- neither can leave the game with nothing to say.
-- ---------------------------------------------------------------------------
