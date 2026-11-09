-- schema-v44 (CR-177): campaign posts take several collaborators.
--
-- assignees is a plain text[] of names, the same free-text identity the
-- checklist assignee and comment authors already use (mp_name on the device),
-- so no people table is needed. Additive: a column with an empty default, one
-- extra key in get_campaign, and save_campaign_post learns the key. When
-- 'assignees' is absent from a save the column is left alone; an empty array
-- clears it. Idempotent.

alter table release_campaign add column if not exists assignees text[] not null default '{}';

create or replace function get_campaign(b text, p text, rid uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', c.id, 'offset_days', c.offset_days, 'platform', c.platform, 'slot', c.slot,
        'asset_kind', c.asset_kind, 'status', c.status, 'copy', c.copy, 'link', c.link,
        'result', c.result, 'assignees', to_jsonb(c.assignees))
        order by c.offset_days, c.position, c.created_at)
    from release_campaign c where c.release_id = rid and c.band = lower(b)), '[]'::jsonb);
end $$;

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
        result      = coalesce(post->>'result', result),
        assignees   = case when post ? 'assignees'
                        then array(select jsonb_array_elements_text(post->'assignees'))
                        else assignees end
      where id = (post->>'id')::uuid and release_id = rid and band = lower(b)
      returning id into pid;
    if pid is null then raise exception 'post not found'; end if;
  else
    insert into release_campaign (release_id, band, offset_days, platform, slot, asset_kind, status, copy, link, result, assignees, position)
      values (rid, lower(b), coalesce((post->>'offset_days')::int, 0), coalesce(post->>'platform', ''),
              coalesce(post->>'slot', ''), coalesce(post->>'asset_kind', ''), coalesce(post->>'status', 'idea'),
              coalesce(post->>'copy', ''), coalesce(post->>'link', ''), coalesce(post->>'result', ''),
              case when post ? 'assignees' then array(select jsonb_array_elements_text(post->'assignees')) else '{}' end,
              coalesce((select max(position) + 1 from release_campaign where release_id = rid), 0))
      returning id into pid;
  end if;
  return pid;
end $$;
