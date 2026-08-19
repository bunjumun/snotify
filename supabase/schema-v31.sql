-- S'notify v31 - a changelog bullet can carry a reference of its own.
--
-- STATUS, WRITTEN AFTER THE FACT AND DELIBERATELY NOT TIDIED AWAY. This ran
-- against the live database on 2026-08-19 and then the feature it was built
-- for was not the feature he wanted. He clarified mid-session: a to-do is
-- resolved by clicking, the to-do list works as desired, and what he wanted
-- was to attach a video to a resolved to-do and have it reachable from the
-- comment that spawned it. A to-do IS that root comment, and comments have
-- carried a reference slot since v22, so CR-58 needed no schema at all - it
-- put the existing chip on the to-do row. See the ledger.
--
-- So log_refs, _valid_log_refs and set_log_ref exist in the database and
-- nothing calls them. _song_json_sel does now emit a log_refs key per version,
-- which every client ignores; that is an empty object per version and is the
-- only cost. Left in place rather than dropped: dropping is his call, and the
-- column is exactly what the still-unbuilt "attach a link to a log item"
-- reading would need if he ever wants that after all.
--
-- The original rationale follows, unchanged.
-- Idempotent and additive over v3-v30. One new column, one validator, one
-- setter, and _song_json_sel restated so the column travels.
-- ASCII only: see the 15 Aug note about clipboard transport.
--
-- WHY. He asked to attach a YouTube link to a log item on a mix revision, so
-- that "re-cut the second chorus" can point at the thing it is talking about.
-- References already exist at three scopes - song, mix version, comment - with
-- one validator and one modal serving all of them (v22). This is the fourth,
-- and it deliberately reuses that shape rather than inventing a link type: the
-- YouTube handling, the in/out section and the A/B player all come for free.
--
-- THE HARD PART IS IDENTITY, NOT STORAGE. A log item has none. Bullets are
-- derived at read time by verBullets(), either from the `changes` jsonb array
-- or by splitting `changelog` on newlines, so a bullet is a position in a list
-- and nothing more. Key a link by that position alone and any future edit that
-- inserts a line silently re-points every link below it at the wrong bullet -
-- a failure nobody would ever report, because a link that opens the wrong
-- video looks exactly like a link somebody attached carelessly.
--
-- So the key is the index AND the value records the bullet text it was
-- attached to, under `forText`. Nothing here enforces a match; the client
-- compares and says "this link was attached to a different line" rather than
-- pretending. Detectable beats silent. Storing text rather than a hash is
-- deliberate too - when it does drift, the stale value is readable by a human
-- deciding what the link meant.
--
-- `cid` IS RESERVED AND UNUSED TODAY. His line continues: the link should also
-- reach the original comment when the log item was made by resolving a to-do.
-- Resolving a to-do does not create a log item yet - that is a separate QUEUE
-- line, still unbuilt - so there is nothing to carry the association. The key
-- is validated and stored so that half drops in without another migration.

-- ---------------------------------------------------------------------------
-- The column. An object, not an array: keys are bullet indexes as text, so
-- attaching to bullet 3 of nine writes one key rather than rewriting a
-- nine-slot array, and a version with no links costs an empty object.
-- ---------------------------------------------------------------------------
alter table versions add column if not exists log_refs jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- Every value is a reference, plus two optional keys of our own.
--
-- _valid_reference only inspects the keys it names, so the extra forText and
-- cid pass through it untouched and are checked here. Same CASE-not-AND
-- discipline as v22, for the same reason: AND is not guaranteed to
-- short-circuit, and a cast reached on the wrong type raises instead of
-- returning false.
-- ---------------------------------------------------------------------------
create or replace function _valid_log_refs(r jsonb) returns boolean
language sql immutable as $$
  select r is null or (
    jsonb_typeof(r) = 'object'
    and not exists (
      select 1 from jsonb_each(r) as e(k, v)
      where not (
        -- the key is a non-negative integer written as text
        e.k ~ '^[0-9]{1,4}$'
        and _valid_reference(e.v)
        and case when e.v->'forText' is null then true
                 when jsonb_typeof(e.v->'forText') <> 'string' then false
                 else length(e.v->>'forText') <= 500 end
        and case when e.v->'cid' is null then true
                 else jsonb_typeof(e.v->'cid') = 'string' end
      )
    )
  )
$$;

-- ---------------------------------------------------------------------------
-- Set or clear one bullet's link.
--
-- ref null removes the key rather than storing a null, so an untouched bullet
-- and a cleared one are the same absence and the client has one case to read.
-- Band-scoped through the join to songs, the same guard set_version_reference
-- uses in v22: a right password for one band cannot reach another's stack.
-- ---------------------------------------------------------------------------
create or replace function set_log_ref(b text, p text, vid uuid, idx int, ref jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare out_refs jsonb;
begin
  perform _require_pass(b, p);
  if idx is null or idx < 0 or idx > 9999 then
    raise exception 'log item index out of range';
  end if;
  if ref is not null and not _valid_reference(ref) then
    raise exception 'a reference needs a kind of url, embed or file, and a src';
  end if;
  if not exists (select 1 from versions v join songs s on s.id = v.song_id
                  where v.id = vid and s.band = lower(b)) then
    raise exception 'no such mix in this band';
  end if;
  update versions
     set log_refs = case when ref is null
                         then coalesce(log_refs, '{}'::jsonb) - idx::text
                         else coalesce(log_refs, '{}'::jsonb) || jsonb_build_object(idx::text, ref) end
   where id = vid
   returning log_refs into out_refs;
  if not _valid_log_refs(out_refs) then
    raise exception 'that would leave the log links malformed';
  end if;
  return out_refs;
end $$;

-- ---------------------------------------------------------------------------
-- _song_json_sel restated so log_refs travels with each version.
--
-- Verbatim from v24 apart from the one added key. Restated rather than patched
-- because there is no way to add a key to a function body in place, and the
-- shape the clients read is defined here in full or not at all.
-- ---------------------------------------------------------------------------
create or replace function _song_json_sel(s songs, vids uuid[]) returns jsonb
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
               'reference', v.reference,
               'log_refs', coalesce(v.log_refs, '{}'::jsonb),
               'stars', coalesce((select jsonb_agg(st.name order by st.created_at)
                                  from version_stars st where st.version_id = v.id), '[]'::jsonb),
               'created_at', v.created_at)
             order by v.position, v.created_at desc)
      from versions v
      where v.song_id = s.id and v.trashed_at is null
        and (vids is null or v.id = any(vids))), '[]'::jsonb))
$$;
