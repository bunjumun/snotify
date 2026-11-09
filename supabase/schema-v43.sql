-- schema-v43 (CR-177, step 2): the release campaign calendar.
--
-- A campaign is a list of dated posts hung off a release. Each post stores
-- offset_days (days from releases.release_date, negative = before), never a
-- calendar date, so moving the release date moves the whole campaign.
-- Additive and idempotent. RLS on, zero anon policies, every access through
-- the password-checked RPCs, same posture as releases (v37).

create table if not exists release_campaign (
  id          uuid primary key default gen_random_uuid(),
  release_id  uuid not null references releases(id) on delete cascade,
  band        text not null references bands(slug),
  offset_days int  not null default 0,
  platform    text not null default '',
  slot        text not null default '',
  asset_kind  text not null default '',
  status      text not null default 'idea'
              check (status in ('idea', 'asset_ready', 'scheduled', 'posted')),
  copy        text not null default '',
  link        text not null default '',
  result      text not null default '',
  position    int  not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists release_campaign_rel on release_campaign (release_id, offset_days, position);
alter table release_campaign enable row level security;

create or replace function get_campaign(b text, p text, rid uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', c.id, 'offset_days', c.offset_days, 'platform', c.platform, 'slot', c.slot,
        'asset_kind', c.asset_kind, 'status', c.status, 'copy', c.copy, 'link', c.link,
        'result', c.result) order by c.offset_days, c.position, c.created_at)
    from release_campaign c where c.release_id = rid and c.band = lower(b)), '[]'::jsonb);
end $$;

-- Insert when post has no id, otherwise update only the keys present.
create or replace function save_campaign_post(b text, p text, rid uuid, post jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  perform _require_pass(b, p);
  if not exists (select 1 from releases where id = rid and band = lower(b)) then
    raise exception 'release not found';
  end if;
  if post ? 'id' and post->>'id' is not null then
    update release_campaign set
        offset_days = coalesce((post->>'offset_days')::int, offset_days),
        platform    = coalesce(post->>'platform', platform),
        slot        = coalesce(post->>'slot', slot),
        asset_kind  = coalesce(post->>'asset_kind', asset_kind),
        status      = coalesce(post->>'status', status),
        copy        = coalesce(post->>'copy', copy),
        link        = coalesce(post->>'link', link),
        result      = coalesce(post->>'result', result)
      where id = (post->>'id')::uuid and release_id = rid and band = lower(b)
      returning id into pid;
    if pid is null then raise exception 'post not found'; end if;
  else
    insert into release_campaign (release_id, band, offset_days, platform, slot, asset_kind, status, copy, link, result, position)
      values (rid, lower(b), coalesce((post->>'offset_days')::int, 0), coalesce(post->>'platform', ''),
              coalesce(post->>'slot', ''), coalesce(post->>'asset_kind', ''), coalesce(post->>'status', 'idea'),
              coalesce(post->>'copy', ''), coalesce(post->>'link', ''), coalesce(post->>'result', ''),
              coalesce((select max(position) + 1 from release_campaign where release_id = rid), 0))
      returning id into pid;
  end if;
  return pid;
end $$;

create or replace function delete_campaign_post(b text, p text, pid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  delete from release_campaign where id = pid and band = lower(b);
end $$;

-- Bulk insert from a template: posts is an array of {offset_days, platform, slot, asset_kind, copy}.
create or replace function generate_campaign(b text, p text, rid uuid, posts jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform _require_pass(b, p);
  if not exists (select 1 from releases where id = rid and band = lower(b)) then
    raise exception 'release not found';
  end if;
  insert into release_campaign (release_id, band, offset_days, platform, slot, asset_kind, copy, position)
    select rid, lower(b), (x.v->>'offset_days')::int, coalesce(x.v->>'platform', ''),
           coalesce(x.v->>'slot', ''), coalesce(x.v->>'asset_kind', ''), coalesce(x.v->>'copy', ''),
           coalesce((select max(position) + 1 from release_campaign where release_id = rid), 0) + x.i
      from jsonb_array_elements(posts) with ordinality as x(v, i);
  get diagnostics n = row_count;
  return n;
end $$;
