-- S'notify v36 — comment trashcan (CR-85, 23 Aug).
--
-- His ask, quoted in full: "Allow restoration of deleted comments from
-- 'trashcan' anything deleted will be in the trashcan until permanently
-- deleted just as a desktop does it." Answered "go" on the manual-purge-only
-- reading in the outbox (no auto-expiry).
--
-- Comments already had a hard delete (delete_comment, v3). This gives them
-- the same soft-delete shape songs and versions have had since v7
-- (trashed_at, get_trash, restore_*) rather than inventing a new pattern:
-- deleted_at on the row, delete_comment sets it instead of removing the row,
-- restore_comment clears it, purge_comment is the only path that actually
-- deletes. Comments carry no storage object, so purge needs no edge
-- function the way song/version forever-delete does.

alter table comments add column if not exists deleted_at timestamptz;

-- ---------------------------------------------------------------------------
-- get_comments must stop returning trashed rows to the normal view — it never
-- filtered on this column before because the column did not exist.
-- ---------------------------------------------------------------------------
create or replace function get_comments(b text, p text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  return coalesce((
    select jsonb_agg(
             to_jsonb(c) || jsonb_build_object('dismissed_versions', coalesce((
               select jsonb_agg(d.version_id) from comment_dismissals d where d.comment_id = c.id
             ), '[]'::jsonb))
           order by c.created_at)
    from comments c where c.song_id like lower(b) || '/%' and c.deleted_at is null), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- delete_comment: soft delete, matching trash_song/trash_version rather than
-- the hard delete it did since v3.
-- ---------------------------------------------------------------------------
create or replace function delete_comment(b text, p text, cid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  update comments set deleted_at = now()
    where id = cid and song_id like lower(b) || '/%' and deleted_at is null;
end $$;

create or replace function restore_comment(b text, p text, cid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  update comments set deleted_at = null
    where id = cid and song_id like lower(b) || '/%' and deleted_at is not null;
end $$;

-- Manual purge only, per his answer — no auto-expiry job.
create or replace function purge_comment(b text, p text, cid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  delete from comments
    where id = cid and song_id like lower(b) || '/%' and deleted_at is not null;
end $$;

-- ---------------------------------------------------------------------------
-- get_comment_trash — same shape as get_trash's rows: enough to list and act
-- on, not the full comment (region/sketch/tags aren't needed to restore or
-- purge one).
-- ---------------------------------------------------------------------------
create or replace function get_comment_trash(b text, p text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', c.id, 'song_id', c.song_id, 'text', c.text,
             'name', c.name, 'created_at', c.created_at, 'deleted_at', c.deleted_at)
           order by c.deleted_at desc)
    from comments c where c.song_id like lower(b) || '/%' and c.deleted_at is not null), '[]'::jsonb);
end $$;
