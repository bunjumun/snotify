-- S'notify v16 — a comment can say what kind of comment it is.
-- Paste into Supabase → SQL Editor → Run. Idempotent; additive over v3–v15.
--
-- "The hats are clipping at 1:12" and "this bit gives me chills" are both
-- comments, and in a list of thirty they look identical. One is work and one
-- is why you bother, and only one of them belongs on a to-do list.
--
-- So a comment can carry categories — as many as fit, or none at all, which
-- is what every comment written before today has and what the site keeps
-- treating as a plain note.
--
-- Stored as slugs, not as the words on screen: the wording can be reworded in
-- the client without a migration, and old rows keep meaning what they meant.

alter table comments add column if not exists tags text[];

-- The known set. Anything else is rejected rather than quietly stored, so a
-- typo in a client can't invent a category nobody can filter on.
create or replace function _valid_tags(t text[]) returns boolean
language sql immutable as $$
  select t is null or (
    array_length(t, 1) is null or (
      array_length(t, 1) <= 5
      and not exists (
        select 1 from unnest(t) x
        where x not in ('technical', 'production', 'enthusiasm', 'thought', 'other'))
    ))
$$;

-- add_comment gains tg — a different signature, so the old one goes rather
-- than leaving two overloads for PostgREST to choose between. Every existing
-- call shape still resolves here, because tg has a default.
drop function if exists add_comment(text, text, text, real, text, text, text, uuid, uuid, jsonb, jsonb);

create or replace function add_comment(b text, p text, sid text, time_s real,
                                       txt text, who text, ver text, vid uuid,
                                       parent_id uuid default null,
                                       reg jsonb default null,
                                       sk jsonb default null,
                                       tg text[] default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
-- pid/tsec shadow the parent_id/time_s parameters, whose names collide with
-- comments' own columns. ("reg"/"tg" are named to avoid the same collision
-- with comments.region and comments.tags.)
declare row_out comments; parent comments;
        pid uuid := parent_id; tsec real := time_s; rgn jsonb := reg; skt jsonb := sk;
        tgs text[] := tg;
begin
  perform _require_pass(b, p);
  if sid not like lower(b) || '/%' then
    raise exception using errcode = '42501', message = 'comment outside this band';
  end if;
  if coalesce(trim(txt), '') = '' and skt is null then
    raise exception 'comment text required';
  end if;
  if not _valid_region(rgn) then
    raise exception 'region must be {x,y,w,h} as fractions between 0 and 1';
  end if;
  if not _valid_sketch(skt) then
    raise exception 'sketch must be an array of {c,w,p} strokes in 0–1 coordinates';
  end if;
  if not _valid_tags(tgs) then
    raise exception 'unknown comment category';
  end if;
  if pid is not null then
    select * into parent from comments where comments.id = pid and comments.song_id = sid;
    if not found then
      raise exception 'original comment not found';
    end if;
    if parent.parent_id is not null then
      raise exception 'replies can only be one level deep';
    end if;
    tsec := parent.time_s;
    ver  := parent.version;
    vid  := parent.version_id;
    rgn  := parent.region;
  end if;
  insert into comments (song_id, time_s, text, name, version, version_id, parent_id, region, sketch, tags)
    values (sid, tsec, coalesce(nullif(trim(txt), ''), ''), coalesce(who, ''),
            coalesce(ver, ''), vid, pid, rgn, skt, nullif(tgs, '{}'))
    returning * into row_out;
  return to_jsonb(row_out) || jsonb_build_object('dismissed_versions', '[]'::jsonb);
end $$;

-- Categorising after the fact. A note often only turns out to be a job once
-- someone reads it back, so this is separate from editing the words.
create or replace function set_comment_tags(b text, p text, cid uuid, tg text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  if not _valid_tags(tg) then
    raise exception 'unknown comment category';
  end if;
  update comments set tags = nullif(tg, '{}')
   where id = cid and song_id like lower(b) || '/%';
end $$;

notify pgrst, 'reload schema';
