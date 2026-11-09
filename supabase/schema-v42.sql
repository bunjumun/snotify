-- schema-v42 (CR-177, step 1): a release has a date.
--
-- First step of the release-strategy plan (docs/release-strategy-plan.md): the
-- campaign calendar, the pre-release countdown and backward-dated checklist
-- tasks all hang off one date on the release. Purely additive: a nullable
-- column, one extra key in get_releases, one new RPC. Idempotent.
--
-- NOTE: on_radio / set_release_radio (CR-120) were applied live without a repo
-- file. get_releases below is the LIVE definition read on 2026-11-09 plus
-- release_date, so on_radio is preserved. set_release_radio is recorded here
-- verbatim so the repo matches the database.

alter table releases add column if not exists release_date date;

create or replace function get_releases(b text, p text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', r.id, 'title', r.title, 'on_radio', r.on_radio,
        'release_date', r.release_date,
        'songs', coalesce((
          select jsonb_agg(s.folder order by rs.position)
          from release_songs rs join songs s on s.id = rs.song_id
          where rs.release_id = r.id and s.trashed_at is null), '[]'::jsonb))
      order by r.position, r.created_at)
    from releases r where r.band = lower(b)), '[]'::jsonb);
end $$;

-- Pass null to clear the date.
create or replace function set_release_date(b text, p text, rid uuid, d date) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  update releases set release_date = d where id = rid and band = lower(b);
  if not found then raise exception 'release not found'; end if;
end $$;

-- Recorded for the repo only (already live, unchanged):
-- create or replace function set_release_radio(b text, p text, rid uuid, on_ boolean) returns void
-- language plpgsql security definer set search_path = public as $$
-- begin perform _require_pass(b, p);
--   update releases set on_radio = on_ where id = rid and band = lower(b);
--   if not found then raise exception 'release not found'; end if; end $$;
