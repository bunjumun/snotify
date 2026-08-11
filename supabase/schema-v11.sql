-- S'notify v11 — the lyric drawer grows up into a document.
-- Paste into Supabase → SQL Editor → Run. Idempotent; additive over v3–v10.
--
-- v9 gave the words drafts and suggestions. What it did not give them was the
-- pair of habits everyone already has from Google Docs:
--
--   Commenting  — a note hung on a phrase you highlighted. It never touches the
--                 words. It threads, it gets reactions, it gets assigned to
--                 somebody, and when the argument is over it is RESOLVED rather
--                 than deleted, so the reasoning survives in a history.
--   Suggesting  — a tracked change. What you add shows in your colour, what you
--                 remove shows struck through, and the owner accepts or rejects
--                 it. A rejected suggestion is not destroyed either.
--
-- So this migration is mostly about the states a suggestion can be in and the
-- things that can hang off one:
--
--   status    open → applied (a draft took it) | rejected | resolved
--   anchor    which characters a comment was hung on, not just which line
--   reactions {"👍": ["Ana","Bo"]} — quick agreement without another reply
--   assignee  a name this is somebody's job to answer
--   kind      + 'delete', a suggestion that a line should go entirely
--
-- Anchors are safe for the same reason line numbers were: a draft's body never
-- changes, so character 12 of line 3 is character 12 of line 3 forever. When a
-- new draft is written the client re-finds the quote; if the words are gone the
-- comment stays behind on the draft it was written against, exactly as before.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table lyric_suggestions add column if not exists anchor      jsonb;
alter table lyric_suggestions add column if not exists reactions   jsonb not null default '{}'::jsonb;
alter table lyric_suggestions add column if not exists assignee    text;
alter table lyric_suggestions add column if not exists resolved_by text;
alter table lyric_suggestions add column if not exists resolved_at timestamptz;

-- Widen the two check constraints written in v9.
alter table lyric_suggestions drop constraint if exists lyric_sug_kind_chk;
alter table lyric_suggestions add  constraint lyric_sug_kind_chk
  check (kind in ('replace', 'insert', 'delete', 'note'));

alter table lyric_suggestions drop constraint if exists lyric_sug_status_chk;
alter table lyric_suggestions add  constraint lyric_sug_status_chk
  check (status in ('open', 'applied', 'rejected', 'resolved'));

create index if not exists lyric_sug_status on lyric_suggestions (draft_id, status);

-- ---------------------------------------------------------------------------
-- Helper: this suggestion belongs to a song in THIS band. Every write below
-- goes through it, so a right password for band A can never touch band B.
-- ---------------------------------------------------------------------------
create or replace function _lyric_owns(b text, sug uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (
    select 1 from lyric_suggestions s
      join lyric_drafts d on d.id = s.draft_id
     where s.id = sug and d.song_id like lower(b) || '/%') then
    raise exception using errcode = '42501', message = 'no such suggestion in this band';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Write a comment or a suggestion. Replaces the v9 signature: same arguments
-- plus the anchor and an optional assignee. Dropped first rather than
-- overloaded — PostgREST cannot choose between two candidates that differ only
-- by defaulted arguments.
-- ---------------------------------------------------------------------------
drop function if exists add_lyric_suggestion(text, text, uuid, int, text, text, text, uuid);

create or replace function add_lyric_suggestion(b text, p text, draft uuid, ln int,
                                                 kind text, txt text, who text,
                                                 parent uuid default null,
                                                 anchor jsonb default null,
                                                 assign text default null)
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
  if kind not in ('replace', 'insert', 'delete', 'note') then
    raise exception 'a suggestion replaces a line, inserts one, removes one, or is a comment';
  end if;
  if anchor is not null and length(anchor::text) > 2000 then
    raise exception 'that anchor is too big';
  end if;

  if parent is not null then
    select * into par from lyric_suggestions where id = parent;
    if not found then raise exception 'original suggestion not found'; end if;
    if par.parent_id is not null then
      raise exception 'replies can only be one level deep';
    end if;
    -- a reply always sits on its parent's line and in its parent's draft, so a
    -- tweak can never drift onto a different line than the thing it tweaks
    draft  := par.draft_id;
    ln     := par.line_no;
    anchor := par.anchor;
    if kind <> 'note' then kind := par.kind; end if;
  end if;

  insert into lyric_suggestions (draft_id, parent_id, line_no, kind, text, name, anchor, assignee)
    values (draft, parent, greatest(0, ln), kind, txt, coalesce(who, ''),
            anchor, nullif(trim(coalesce(assign, '')), ''))
    returning * into row_out;
  return to_jsonb(row_out);
end $$;

-- ---------------------------------------------------------------------------
-- Resolve, reject, reopen. The row is never destroyed: a resolved comment and
-- a rejected suggestion both stay in the history, which is the whole reason
-- this is a status and not a delete.
--
-- 'applied' is not settable here — only add_lyric_draft may say that a draft
-- took a suggestion, because only a draft can be the proof of it.
-- ---------------------------------------------------------------------------
create or replace function set_lyric_status(b text, p text, sug uuid, st text,
                                            who text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare row_out lyric_suggestions;
begin
  perform _require_pass(b, p);
  perform _lyric_owns(b, sug);
  if st not in ('open', 'rejected', 'resolved') then
    raise exception 'a thread is open, resolved or rejected';
  end if;
  update lyric_suggestions s
     set status      = st,
         resolved_by = case when st = 'open' then null else nullif(trim(coalesce(who, '')), '') end,
         resolved_at = case when st = 'open' then null else now() end
   where s.id = sug or s.parent_id = sug;         -- a thread resolves together
  select * into row_out from lyric_suggestions where id = sug;
  return to_jsonb(row_out);
end $$;

-- ---------------------------------------------------------------------------
-- A reaction is agreement without another reply. Stored as
-- {"👍": ["Ana","Bo"]} and toggled by name — this site has no accounts, so a
-- name is all anyone has, and a second click from the same name takes it back.
-- ---------------------------------------------------------------------------
create or replace function react_lyric(b text, p text, sug uuid, emo text,
                                       who text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cur jsonb; was jsonb; now_arr jsonb; nm text;
begin
  perform _require_pass(b, p);
  perform _lyric_owns(b, sug);
  if emo is null or trim(emo) = '' or length(emo) > 12 then
    raise exception 'that is not an emoji';
  end if;
  nm := coalesce(nullif(trim(who), ''), 'someone');

  select coalesce(s.reactions, '{}'::jsonb) into cur from lyric_suggestions s where s.id = sug;
  was := coalesce(cur -> emo, '[]'::jsonb);
  if was @> to_jsonb(nm) then
    select coalesce(jsonb_agg(v), '[]'::jsonb) into now_arr
      from jsonb_array_elements_text(was) t(v) where v <> nm;
  else
    if jsonb_array_length(was) >= 40 then raise exception 'that is enough of that'; end if;
    now_arr := was || to_jsonb(nm);
  end if;

  if jsonb_array_length(now_arr) = 0
    then cur := cur - emo;
    else cur := jsonb_set(cur, array[emo], now_arr);
  end if;
  if length(cur::text) > 4000 then raise exception 'too many reactions'; end if;

  update lyric_suggestions set reactions = cur where id = sug;
  return cur;
end $$;

-- ---------------------------------------------------------------------------
-- Make it somebody's job. A name, not an account — the same honour system the
-- rest of the site runs on. Null clears it.
-- ---------------------------------------------------------------------------
create or replace function assign_lyric(b text, p text, sug uuid, to_who text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  perform _lyric_owns(b, sug);
  if to_who is not null and length(to_who) > 60 then
    raise exception 'that name is too long';
  end if;
  update lyric_suggestions
     set assignee = nullif(trim(coalesce(to_who, '')), '')
   where id = sug;
end $$;

notify pgrst, 'reload schema';
