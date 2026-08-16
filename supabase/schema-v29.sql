-- S'notify v29 - a folder names one row PER KIND, not one row.
-- Idempotent and additive over v3-v28. Two function bodies, no table changes.
-- ASCII only, deliberately: see the 15 Aug note about clipboard transport.
--
-- THE BUG THIS FIXES. On 16 Aug he uploaded artwork through the art page under
-- the piece name "This Is War". A song called This Is War already existed, with
-- folder 'This Is War'. ensure_song looked the row up on (band, folder) alone
-- and handed back the AUDIO song, so the image was filed as a mix of it. The
-- art page lists kind = 'art' only, so the picture he had just uploaded was
-- nowhere to be found, and he binned it.
--
-- WHY IT HAD NEVER HAPPENED BEFORE. His other art pieces are Lessons and Light,
-- whose songs have folders 'lessons' and 'light'. A song's folder comes from the
-- audio import; an art piece's comes from what he types. folder = f is
-- case-sensitive, so those two pairs missed each other by luck rather than by
-- design. "This Is War" was typed with the same capitals on both sides.
--
-- THE RULE, STATED. Audio and artwork are two different things that may
-- perfectly well share a name, and the schema has always said so - songs.kind is
-- what separates them, and get_library takes a kind. The lookup simply did not
-- read it. Making kind part of the identity is what the rest of the system
-- already assumes.

-- ---------------------------------------------------------------------------
-- ensure_song: find or create, now keyed by kind as well as folder.
--
-- Backward compatible by construction. Every caller passes the kind it is
-- importing, and every existing row already carries that kind, so every lookup
-- that used to succeed still finds the same row. The only behaviour that
-- changes is the one that was wrong: a lookup for one kind can no longer return
-- a row of the other.
--
-- coalesce on both sides rather than on one. Rows predating the kind column
-- read as 'audio', which is what they were, and a caller passing null means
-- audio too. Comparing a coalesced column against a raw argument would leave
-- null = null returning null, and the row would be invisible rather than found.
-- ---------------------------------------------------------------------------
create or replace function ensure_song(b text, f text, k text default 'audio') returns uuid
language plpgsql security definer set search_path = public as $$
declare sid uuid; ckey text; top int;
begin
  select id into sid from songs
   where band = lower(b) and folder = f
     and coalesce(kind, 'audio') = coalesce(k, 'audio');
  if sid is not null then return sid; end if;
  ckey := coalesce(nullif(_slugify(f), ''), 'song');
  select coalesce(min(position) - 1, 0) into top from songs where band = lower(b);
  insert into songs (band, folder, title, comment_key, position, kind)
    values (lower(b), f, f, ckey, top, coalesce(k, 'audio'))
    returning id into sid;
  return sid;
end $$;
revoke execute on function ensure_song(text, text, text) from public, anon, authenticated;
grant  execute on function ensure_song(text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- set_song_link: only artwork gets linked, so only artwork gets updated.
--
-- Once two rows can share a folder, "update songs ... where folder = f" would
-- write the link onto the song as well as onto the picture of it. art.html is
-- the only caller and it always means the artwork, so the qualifier costs
-- nothing and closes the hole before anyone can fall in it. The signature is
-- unchanged, so no page needs redeploying for this.
--
-- The target check stays unqualified on purpose: linking to a song is the
-- point, and any row by that folder name is a legitimate thing to point at.
-- ---------------------------------------------------------------------------
create or replace function set_song_link(b text, p text, f text, target text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  if target is not null and not exists (
      select 1 from songs where band = lower(b) and folder = target) then
    raise exception 'nothing to link to by that name';
  end if;
  update songs set linked_folder = target
   where band = lower(b) and folder = f and coalesce(kind, 'audio') = 'art';
end $$;
