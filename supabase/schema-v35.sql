-- S'notify v35 — recent band-wide updates, in the Log drawer's dead state
-- (CR-80, 23 Aug).
--
-- The original ask: "When the log button is hit in album view, currently
-- nothing happens. Make it so it shows the 5 most recent band wide site
-- updates or changes." Checked and there is no such dormant button anywhere
-- (CR-80's first pass in the ledger) — but there is a Log button that is
-- always on screen in the player's dock (`#vlogToggle`, the changelog
-- drawer), and its own `renderVlog()` already had a real dead state: with no
-- `activeSong` it showed nothing but "Play a song to see its version
-- history." His outbox answer is what connects the two: "The log button is
-- visible even when a track is not selected and in that state currently does
-- nothing. I'm suggesting a use of it in this state. Do it." — reusing the
-- original ask to fill the existing button's existing empty state, rather
-- than building a second, separate Log button in album view. Smaller than
-- the plan on file: no new UI element, one new RPC and one branch in a
-- function that already existed.
--
-- Which sources count, since that was the real open question and "do it"
-- didn't answer it: songs, mixes and comments (new content), and a lore/
-- ship's-log document going live (a real publish, not every autosave — see
-- `active` below). Left out on purpose: progress_tasks (checklist ticks) —
-- the plan on file already flagged this as the one source that would drown
-- everything else out, 71 ticks a week against a song landing once a month —
-- and music_folders (organising the list is not band news). Resolved
-- comments still show; a note being resolved doesn't erase that it happened.

create or replace function recent_updates(b text, p text, lim int default 5) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  return coalesce((
    select jsonb_agg(jsonb_build_object('kind', kind, 'label', label,
             'at', to_char(at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')) order by at desc)
    from (
      select kind, label, at from (
        select 'song' as kind, s.title as label, s.created_at as at
          from songs s
          where s.band = lower(b) and s.trashed_at is null
        -- A freshly uploaded song's first mix is usually named after the song
        -- itself ("Title — Title" out of the folder importer), which reads as
        -- a stutter — so the mix name is only appended when it actually says
        -- something the song title didn't.
        union all
        select 'mix' as kind,
               s.title || case when v.name is distinct from s.title then ' — ' || v.name else '' end as label,
               v.created_at as at
          from versions v join songs s on s.id = v.song_id
          where s.band = lower(b) and v.trashed_at is null and s.trashed_at is null
        union all
        -- comments.song_id is the song's stable key (comment_key), not its id —
        -- same join _song_json uses to hand comments back to the player.
        select 'comment' as kind, left(c.text, 100) as label, c.created_at as at
          from comments c join songs s on s.comment_key = c.song_id
          where s.band = lower(b) and s.trashed_at is null
        union all
        -- Only the version marked live: a doc going through five drafts before
        -- publishing is one event, the publish, not five.
        select 'log' as kind, ld.title || ' — ' || lv.name as label, lv.updated_at as at
          from lore_versions lv join lore_docs ld on ld.id = lv.doc_id
          where ld.band = lower(b) and lv.trashed_at is null and lv.active
      ) all_events
      order by at desc
      limit lim
    ) top
  ), '[]'::jsonb);
end $$;
