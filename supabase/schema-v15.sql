-- S'notify v15 — starring a mix, and the favourite that falls out of it.
-- Paste into Supabase → SQL Editor → Run. Idempotent; additive over v3–v14.
--
-- A stack of five mixes and no record of which one anybody actually liked.
-- The band argues it out in comments and then forgets, and the newest mix
-- wins by default because it happens to be on top.
--
-- So each person stars the mixes they'd keep. It is a vote, not a verdict:
-- everyone's star is their own and can be taken back, and the mix holding the
-- most of them is what the site calls the current favourite. Nobody declares
-- it — it is just where the stars ended up.
--
-- There are no accounts, so a star is signed with the same self-reported name
-- comments already carry. That is the honour system this whole site runs on:
-- it attributes, it does not enforce.

create table if not exists version_stars (
  version_id uuid not null references versions(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);
-- One star per person per mix. Folded, so someone who types their name with a
-- different capital on a different day is still the same single voter.
create unique index if not exists version_stars_one on version_stars (version_id, lower(name));
create index if not exists version_stars_ver on version_stars (version_id);

alter table version_stars enable row level security;
-- No policies, deliberately: like every other table here, nothing reads or
-- writes this with the publishable key. Everything goes through the functions
-- below, which check the band password first.

-- One song as the JSON shape the clients expect. Overridden again here so each
-- version carries who starred it, alongside its changelog and its peaks.
create or replace function _song_json(s songs) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'folder', s.folder,
    'id',     s.comment_key,
    'title',  s.title,
    'artist', s.artist,
    'album',  s.album,
    'cover',  s.cover,
    'kind',   s.kind,
    'link',   s.linked_folder,
    'reference', s.reference,
    'lyrics', s.lyrics_url,
    'versions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', v.id, 'name', v.name, 'src', v.src,
               'date', coalesce(to_char(v.date, 'YYYY-MM-DD'), ''),
               'changelog', v.changelog, 'changes', v.changes,
               'peaks', v.peaks,
               -- the names, not just the tally: the client has to know whether
               -- one of them is yours before it can draw your star filled in
               'stars', coalesce((select jsonb_agg(st.name order by st.created_at)
                                  from version_stars st where st.version_id = v.id), '[]'::jsonb),
               'created_at', v.created_at)
             order by v.position, v.created_at desc)
      from versions v where v.song_id = s.id and v.trashed_at is null), '[]'::jsonb))
$$;

-- Toggle one person's star on one mix. Band-scoped through a join to songs, so
-- a right password for one band cannot vote in another's library.
create or replace function star_version(b text, p text, vid uuid, who text, on_ boolean)
returns void language plpgsql security definer set search_path = public as $$
declare nm text;
begin
  perform _require_pass(b, p);
  nm := nullif(btrim(coalesce(who, '')), '');
  if nm is null then
    raise exception 'put your name in before starring a mix';
  end if;
  if length(nm) > 60 then
    raise exception 'that name is too long';
  end if;
  -- the mix has to belong to this band
  if not exists (select 1 from versions v join songs s on s.id = v.song_id
                  where v.id = vid and s.band = lower(b)) then
    raise exception 'no such mix in this band';
  end if;

  if on_ then
    insert into version_stars (version_id, name) values (vid, nm)
      on conflict (version_id, lower(name)) do nothing;
  else
    delete from version_stars where version_id = vid and lower(name) = lower(nm);
  end if;
end $$;

notify pgrst, 'reload schema';
