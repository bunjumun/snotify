-- schema-v45 (CR-177): promo outreach targets per release.
--
-- Local blogs, music-coverage social accounts, radio, playlists, press: who to
-- pitch, how to reach them, and where each pitch stands. Contact fields are
-- links, not a contacts system: a profile/site URL, an email (rendered as
-- mailto), and one more contact link (a DM link, a submission form). Status
-- walks to_pitch -> pitched -> followed_up -> covered (or passed).
-- Additive and idempotent; RLS on, zero anon policies, same as release_campaign.

create table if not exists release_targets (
  id           uuid primary key default gen_random_uuid(),
  release_id   uuid not null references releases(id) on delete cascade,
  band         text not null references bands(slug),
  name         text not null default '',
  kind         text not null default 'blog',
  profile_url  text not null default '',
  email        text not null default '',
  contact_url  text not null default '',
  location     text not null default '',
  status       text not null default 'to_pitch'
               check (status in ('to_pitch', 'pitched', 'followed_up', 'covered', 'passed')),
  last_touched date,
  notes        text not null default '',
  position     int  not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists release_targets_rel on release_targets (release_id, position);
alter table release_targets enable row level security;

create or replace function get_targets(b text, p text, rid uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', t.id, 'name', t.name, 'kind', t.kind, 'profile_url', t.profile_url, 'email', t.email,
        'contact_url', t.contact_url, 'location', t.location, 'status', t.status,
        'last_touched', t.last_touched, 'notes', t.notes) order by t.position, t.created_at)
    from release_targets t where t.release_id = rid and t.band = lower(b)), '[]'::jsonb);
end $$;

-- Insert when tgt has no id, otherwise update only the keys present.
-- last_touched: '' clears it.
create or replace function save_target(b text, p text, rid uuid, tgt jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  perform _require_pass(b, p);
  if not exists (select 1 from releases where id = rid and band = lower(b)) then
    raise exception 'release not found';
  end if;
  if tgt ? 'id' and tgt->>'id' is not null then
    update release_targets set
        name         = coalesce(tgt->>'name', name),
        kind         = coalesce(tgt->>'kind', kind),
        profile_url  = coalesce(tgt->>'profile_url', profile_url),
        email        = coalesce(tgt->>'email', email),
        contact_url  = coalesce(tgt->>'contact_url', contact_url),
        location     = coalesce(tgt->>'location', location),
        status       = coalesce(tgt->>'status', status),
        last_touched = case when tgt ? 'last_touched' then nullif(tgt->>'last_touched', '')::date else last_touched end,
        notes        = coalesce(tgt->>'notes', notes)
      where id = (tgt->>'id')::uuid and release_id = rid and band = lower(b)
      returning id into tid;
    if tid is null then raise exception 'target not found'; end if;
  else
    insert into release_targets (release_id, band, name, kind, profile_url, email, contact_url, location, notes, position)
      values (rid, lower(b), coalesce(tgt->>'name', ''), coalesce(tgt->>'kind', 'blog'),
              coalesce(tgt->>'profile_url', ''), coalesce(tgt->>'email', ''), coalesce(tgt->>'contact_url', ''),
              coalesce(tgt->>'location', ''), coalesce(tgt->>'notes', ''),
              coalesce((select max(position) + 1 from release_targets where release_id = rid), 0))
      returning id into tid;
  end if;
  return tid;
end $$;

create or replace function delete_target(b text, p text, tid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  delete from release_targets where id = tid and band = lower(b);
end $$;
