-- schema-v41 (CR-169): recent_updates carries the ids the What's new log needs
-- to link each row to its context and to reply in place: song id and title,
-- mix (version) id, comment id, parent id and the comment's time in the song.
-- Same signature as v40 and purely additive keys in the returned jsonb, so an
-- older cached page ignores them and keeps working. Idempotent.

create or replace function recent_updates(b text, p text, lim int default 5) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  return coalesce((
    select jsonb_agg(jsonb_build_object('kind', kind, 'label', label, 'who', who, 'song_id', song_id, 'song', song,
             'version_id', version_id, 'comment_id', comment_id, 'parent_id', parent_id, 'time_s', time_s,
             'at', to_char(at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')) order by at desc)
    from (
      select kind, label, who, song_id, song, version_id, comment_id, parent_id, time_s, at from (
        select 'song' as kind, s.title as label, null::text as who, s.id as song_id, s.title as song,
               null::uuid as version_id, null::uuid as comment_id, null::uuid as parent_id, null::real as time_s, s.created_at as at
          from songs s
          where s.band = lower(b) and s.trashed_at is null
        -- A freshly uploaded song's first mix is usually named after the song
        -- itself ("Title — Title" out of the folder importer), which reads as
        -- a stutter — so the mix name is only appended when it actually says
        -- something the song title didn't.
        union all
        select 'mix' as kind,
               s.title || case when v.name is distinct from s.title then ' — ' || v.name else '' end as label,
               null::text as who, s.id as song_id, s.title as song,
               v.id as version_id, null::uuid as comment_id, null::uuid as parent_id, null::real as time_s,
               v.created_at as at
          from versions v join songs s on s.id = v.song_id
          where s.band = lower(b) and v.trashed_at is null and s.trashed_at is null
        union all
        -- comments.song_id is band || '/' || comment_key, not the song's id.
        select 'comment' as kind, left(c.text, 100) as label,
               nullif(trim(coalesce(c.name, '')), '') as who, s.id as song_id, s.title as song,
               c.version_id as version_id, c.id as comment_id, c.parent_id as parent_id, c.time_s as time_s, c.created_at as at
          from comments c join songs s on s.band || '/' || s.comment_key = c.song_id
          where s.band = lower(b) and s.trashed_at is null and c.deleted_at is null
        union all
        select 'resolved' as kind, left(c.text, 100) as label,
               coalesce(nullif(trim(coalesce(c.resolved_by, '')), ''),
                        nullif(trim(coalesce(c.name, '')), '')) as who,
               s.id as song_id, s.title as song, c.version_id as version_id, c.id as comment_id,
               c.parent_id as parent_id, c.time_s as time_s, c.resolved_at as at
          from comments c join songs s on s.band || '/' || s.comment_key = c.song_id
          where s.band = lower(b) and s.trashed_at is null and c.deleted_at is null
            and c.resolved and c.resolved_at is not null
        union all
        -- Only the version marked live: a doc going through five drafts before
        -- publishing is one event, the publish, not five.
        select 'log' as kind, ld.title || ' — ' || lv.name as label, null::text as who, null::uuid as song_id, null::text as song,
               null::uuid as version_id, null::uuid as comment_id, null::uuid as parent_id, null::real as time_s, lv.updated_at as at
          from lore_versions lv join lore_docs ld on ld.id = lv.doc_id
          where ld.band = lower(b) and lv.trashed_at is null and lv.active
      ) all_events
      order by at desc
      limit lim
    ) top
  ), '[]'::jsonb);
end $$;
