-- S'notify v9 — lyrics, with suggestions.
-- Paste into Supabase → SQL Editor → Run. Idempotent; additive over v3–v8.
--
-- Mixes stack and can be commented on; artwork stacks and can be commented on;
-- the words had nowhere to live. Lyrics attach to the SONG, not to a mix — one
-- set of words across every version of the track.
--
-- The loop: anyone writes a draft, anyone suggests a line in its place, anyone
-- else can tweak or argue with that suggestion, and suggestions stay invisible
-- until someone goes looking. Accepting some of them — or just editing the
-- words directly — writes a NEW draft. Earlier drafts are never rewritten, so
-- the band can always go back and see what was proposed at the time.
--
-- A draft's body is immutable once written. That is what makes a plain line
-- number a safe anchor: within one draft, line 7 is line 7 forever. Carrying a
-- suggestion into a new draft means copying the row with a new line number,
-- which the client computes — it is already diffing the two bodies to draw the
-- truncation stars, and one diff in one place beats two that can disagree.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
-- `n` is a label and never changes: "draft 3" means the same draft forever,
-- even after the stack is reordered. `position` is the order you see them in,
-- exactly as versions carry both a name and a position.
create table if not exists lyric_drafts (
  id         uuid primary key default gen_random_uuid(),
  song_id    text not null,               -- '<band>/<comment_key>', as comments use
  n          int  not null,               -- stable label, 1 upwards
  position   int  not null default 0,     -- 0 = top of the stack
  body       text not null default '',
  name       text not null default '',    -- self-reported, same as a comment
  base_id    uuid references lyric_drafts(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (song_id, n)
);
alter table lyric_drafts enable row level security;
create index if not exists lyric_drafts_song on lyric_drafts (song_id, position);
alter table lyric_drafts add column if not exists position int not null default 0;

-- A suggestion replaces a line, inserts one, or — with a parent — is a tweak of
-- or a note on someone else's suggestion. Replies go one level deep, the same
-- limit comments have: a thread about one line, not a tree.
create table if not exists lyric_suggestions (
  id         uuid primary key default gen_random_uuid(),
  draft_id   uuid not null references lyric_drafts(id) on delete cascade,
  parent_id  uuid references lyric_suggestions(id) on delete cascade,
  line_no    int  not null,               -- replace: this line. insert: before it.
  kind       text not null default 'replace',
  text       text not null,
  name       text not null default '',
  status     text not null default 'open',
  applied_in uuid references lyric_drafts(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table lyric_suggestions enable row level security;
create index if not exists lyric_sug_draft  on lyric_suggestions (draft_id, line_no);
create index if not exists lyric_sug_parent on lyric_suggestions (parent_id);
alter table lyric_suggestions add column if not exists parent_id uuid references lyric_suggestions(id) on delete cascade;

do $$ begin
  alter table lyric_suggestions add constraint lyric_sug_kind_chk
    check (kind in ('replace', 'insert', 'note'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table lyric_suggestions add constraint lyric_sug_status_chk
    check (status in ('open', 'applied'));
exception when duplicate_object then null; end $$;

-- RLS on, zero anon policies — same posture as every table since v3. All
-- access flows through the SECURITY DEFINER functions below.

-- ---------------------------------------------------------------------------
-- Helper: the words belong to a song in THIS band, like a comment does.
-- ---------------------------------------------------------------------------
create or replace function _lyric_guard(b text, sid text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if sid is null or sid not like lower(b) || '/%' then
    raise exception using errcode = '42501', message = 'lyrics outside this band';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Read: one call returns every draft and every suggestion for the song. The
-- pool is a handful of rows and the drawer needs all of it to draw the draft
-- picker and the counts — the same reasoning as get_comments.
-- ---------------------------------------------------------------------------
create or replace function get_lyrics(b text, p text, sid text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  perform _lyric_guard(b, sid);
  return jsonb_build_object(
    'drafts', coalesce((
      select jsonb_agg(to_jsonb(d) order by d.position, d.n)
      from lyric_drafts d where d.song_id = sid), '[]'::jsonb),
    'suggestions', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.created_at)
      from lyric_suggestions s
      join lyric_drafts d on d.id = s.draft_id
      where d.song_id = sid), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- Write a draft. Draft 1 is just a body; every later one records what it grew
-- from, which suggestions it took, and which of the ones it did not take are
-- still worth carrying. A draft written by hand rather than by accepting
-- anything is the same call with an empty `applied`.
--
-- `carry` is [{id, line_no}] — the suggestions that survive, with their line
-- number in the NEW body. Anything left off simply stays where it is: still
-- open, still attached to the draft it was written against. That is the point
-- of the rule Bunjumun set — a line dropped from a draft takes its suggestions
-- out of view without destroying them, and the star at the gap is how you find
-- them again.
-- ---------------------------------------------------------------------------
create or replace function add_lyric_draft(b text, p text, sid text, body text,
                                            who text, base uuid default null,
                                            applied uuid[] default '{}',
                                            carry jsonb default '[]')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare row_out lyric_drafts; nxt int; top int;
begin
  perform _require_pass(b, p);
  perform _lyric_guard(b, sid);

  select coalesce(max(d.n), 0) + 1 into nxt from lyric_drafts d where d.song_id = sid;
  select coalesce(max(d.position), -1) + 1 into top from lyric_drafts d where d.song_id = sid;

  insert into lyric_drafts (song_id, n, position, body, name, base_id)
    values (sid, nxt, top, coalesce(body, ''), coalesce(who, ''), base)
    returning * into row_out;

  -- what this draft took
  if applied is not null and array_length(applied, 1) is not null then
    update lyric_suggestions s
       set status = 'applied', applied_in = row_out.id
     where (s.id = any(applied) or s.parent_id = any(applied))
       and s.draft_id in (select d.id from lyric_drafts d where d.song_id = sid);
  end if;

  -- what it carries forward, re-anchored to the new body. A carried suggestion
  -- brings its replies with it, so a conversation about a line survives the
  -- draft it started on.
  insert into lyric_suggestions (draft_id, line_no, kind, text, name, created_at, parent_id)
  select row_out.id, (c->>'line_no')::int, s.kind, s.text, s.name, s.created_at, null
    from jsonb_array_elements(coalesce(carry, '[]')) c
    join lyric_suggestions s on s.id = (c->>'id')::uuid
   where s.status = 'open' and s.parent_id is null
     and s.draft_id in (select d.id from lyric_drafts d where d.song_id = sid);

  return to_jsonb(row_out);
end $$;

-- ---------------------------------------------------------------------------
-- Suggest a line, tweak someone else's suggestion, or leave a note on one.
-- Named `ln`/`txt` rather than after the columns they land in, for the usual
-- ambiguity reason.
-- ---------------------------------------------------------------------------
create or replace function add_lyric_suggestion(b text, p text, draft uuid, ln int,
                                                 kind text, txt text, who text,
                                                 parent uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare row_out lyric_suggestions; owner text; par lyric_suggestions;
begin
  perform _require_pass(b, p);
  select d.song_id into owner from lyric_drafts d where d.id = draft;
  if owner is null then raise exception 'draft not found'; end if;
  perform _lyric_guard(b, owner);
  if coalesce(trim(txt), '') = '' then
    raise exception 'suggestion text required';
  end if;
  if kind not in ('replace', 'insert', 'note') then
    raise exception 'a suggestion replaces a line, inserts one, or is a note';
  end if;

  if parent is not null then
    select * into par from lyric_suggestions where id = parent;
    if not found then raise exception 'original suggestion not found'; end if;
    if par.parent_id is not null then
      raise exception 'replies can only be one level deep';
    end if;
    -- a reply always sits on its parent's line and in its parent's draft, so a
    -- tweak can never drift onto a different line than the thing it tweaks
    draft := par.draft_id;
    ln    := par.line_no;
    if kind <> 'note' then kind := par.kind; end if;
  end if;

  insert into lyric_suggestions (draft_id, parent_id, line_no, kind, text, name)
    values (draft, parent, greatest(0, ln), kind, txt, coalesce(who, ''))
    returning * into row_out;
  return to_jsonb(row_out);
end $$;

-- Honour system, same trust level as delete_comment: any bandmate can remove a
-- suggestion. The client asks first when the name on it isn't yours. Deleting a
-- suggestion takes its replies with it.
create or replace function delete_lyric_suggestion(b text, p text, sug uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  delete from lyric_suggestions s
   where s.id = sug
     and s.draft_id in (
       select d.id from lyric_drafts d where d.song_id like lower(b) || '/%');
end $$;

-- ---------------------------------------------------------------------------
-- The stack: delete a draft, or reorder it. Editing a draft's words in place is
-- deliberately not offered — a draft records what the band had at a moment, and
-- the way to change it is to write the next one.
-- ---------------------------------------------------------------------------
create or replace function delete_lyric_draft(b text, p text, draft uuid) returns void
language plpgsql security definer set search_path = public as $$
declare owner text;
begin
  perform _require_pass(b, p);
  select d.song_id into owner from lyric_drafts d where d.id = draft;
  if owner is null then return; end if;
  perform _lyric_guard(b, owner);
  delete from lyric_drafts d where d.id = draft;
end $$;

-- Position only; `n` is the label and stays put, so "draft 3" survives being
-- moved. Same shape as reorder_versions.
create or replace function reorder_lyric_drafts(b text, p text, sid text, ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  perform _lyric_guard(b, sid);
  update lyric_drafts d set position = ord.i - 1
    from unnest(ids) with ordinality ord(did, i)
   where d.id = ord.did and d.song_id = sid;
end $$;

notify pgrst, 'reload schema';
