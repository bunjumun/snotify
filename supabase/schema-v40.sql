-- S'notify v40 — the band-wide Log feed finally shows comments, and resolves
-- (2026-10-19, follow-up to CR-80 / schema-v35).
--
-- Ask: "make global snalbum site 'log' include most recent comments and
-- resolved comments".
--
-- v35 meant to include comments and assumed `comments.song_id` was the song's
-- bare comment_key. It is `band || '/' || comment_key` (schema-v3, and every
-- other comment RPC filters it as `like lower(b) || '/%'`). So the join matched
-- 0 of 200 live comments and no 'comment' row has ever been returned. Fixed here.
--
-- Also:
--   * comments are soft-deleted (`deleted_at`), which v35 predates: filtered.
--   * a new 'resolved' kind, timed by `resolved_at`. A resolve is news the
--     original comment row cannot carry (it happens days later), and the old
--     comment row still shows, as v35 intended. A reopened thread has
--     resolved = false and drops out.
--   * every row gains `who`: the author for a comment, the resolver for a
--     resolve (falling back to the author when resolved_by was left blank).
--     The page treats it as optional, so an older cached page still works; it
--     shows a 'resolved' row as a generic update until it reloads.
--
-- Same signature as v35, so create-or-replace is enough. Additive and
-- idempotent: running it twice changes nothing.

create or replace function recent_updates(b text, p text, lim int default 5) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  return coalesce((
    select jsonb_agg(jsonb_build_object('kind', kind, 'label', label, 'who', who,
             'at', to_char(at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')) order by at desc)
    from (
      select kind, label, who, at from (
        select 'song' as kind, s.title as label, null::text as who, s.created_at as at
          from songs s
          where s.band = lower(b) and s.trashed_at is null
        -- A freshly uploaded song's first mix is usually named after the song
        -- itself ("Title — Title" out of the folder importer), which reads as
        -- a stutter — so the mix name is only appended when it actually says
        -- something the song title didn't.
        union all
        select 'mix' as kind,
               s.title || case when v.name is distinct from s.title then ' — ' || v.name else '' end as label,
               null::text as who,
               v.created_at as at
          from versions v join songs s on s.id = v.song_id
          where s.band = lower(b) and v.trashed_at is null and s.trashed_at is null
        union all
        -- comments.song_id is band || '/' || comment_key, not the song's id.
        select 'comment' as kind, left(c.text, 100) as label,
               nullif(trim(coalesce(c.name, '')), '') as who, c.created_at as at
          from comments c join songs s on s.band || '/' || s.comment_key = c.song_id
          where s.band = lower(b) and s.trashed_at is null and c.deleted_at is null
        union all
        select 'resolved' as kind, left(c.text, 100) as label,
               coalesce(nullif(trim(coalesce(c.resolved_by, '')), ''),
                        nullif(trim(coalesce(c.name, '')), '')) as who,
               c.resolved_at as at
          from comments c join songs s on s.band || '/' || s.comment_key = c.song_id
          where s.band = lower(b) and s.trashed_at is null and c.deleted_at is null
            and c.resolved and c.resolved_at is not null
        union all
        -- Only the version marked live: a doc going through five drafts before
        -- publishing is one event, the publish, not five.
        select 'log' as kind, ld.title || ' — ' || lv.name as label, null::text as who, lv.updated_at as at
          from lore_versions lv join lore_docs ld on ld.id = lv.doc_id
          where ld.band = lower(b) and lv.trashed_at is null and lv.active
      ) all_events
      order by at desc
      limit lim
    ) top
  ), '[]'::jsonb);
end $$;
