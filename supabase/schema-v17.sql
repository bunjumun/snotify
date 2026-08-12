-- S'music v17 — the mailing list the game's treasure chest feeds.
-- Paste into Supabase → SQL Editor → Run. Idempotent; additive over v3–v16.
--
-- Lakehorse Swimulator ends with a chest containing a download of the record,
-- offered in exchange for an email address. That means a list, and a list on a
-- public page means exactly one hard requirement: the anon key can WRITE to it
-- and must never be able to READ it back. A publishable key ships inside the
-- game source by design, so anything it can select, the whole internet can
-- select — and a mailing list leaked that way is a real harm to real people.
--
-- Hence: RLS on, no policies at all (so direct REST access to the table is
-- refused outright), and one SECURITY DEFINER function that can only insert.
-- The band reads the list from the SQL editor or the dashboard, signed in.
--
-- Nothing in the game breaks if this is never applied. The signup falls back to
-- keeping the address in localStorage and the download is handed over anyway —
-- see game/src/ui/RewardScreen.js.

create table if not exists subscribers (
  id          bigint generated always as identity primary key,
  email       text        not null,
  band        text        not null default 'lakehorse',
  source      text        not null default 'swimulator',
  created_at  timestamptz not null default now()
);

-- One row per person per band. A second signup is not an error worth showing
-- someone who just finished the game — game_subscribe swallows it below.
create unique index if not exists subscribers_email_band_idx
  on subscribers (lower(email), band);

alter table subscribers enable row level security;

-- Deliberately no policies. With RLS on and nothing granted, PostgREST refuses
-- select, insert, update and delete for anon and authenticated alike. The only
-- way in is the function.
revoke all on subscribers from anon, authenticated;

-- The one door in. SECURITY DEFINER so it bypasses RLS, and it can only ever
-- add a row — there is no code path here that returns an address.
create or replace function game_subscribe(e text, b text default 'lakehorse', s text default 'swimulator')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Cheap sanity only. A regex strict enough to be meaningful rejects valid
  -- addresses, and the mail provider bounces the rest.
  if e is null or e !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid address';
  end if;
  if length(e) > 320 then
    raise exception 'invalid address';
  end if;

  insert into subscribers (email, band, source)
  values (trim(e), coalesce(nullif(trim(b), ''), 'lakehorse'),
                   coalesce(nullif(trim(s), ''), 'swimulator'))
  on conflict do nothing;
end $$;

revoke all on function game_subscribe(text, text, text) from public;
grant execute on function game_subscribe(text, text, text) to anon, authenticated;

-- Reading the list, for when you want it:
--
--   select created_at, email from subscribers where band = 'lakehorse'
--   order by created_at desc;
--
-- and to export:
--
--   copy (select email from subscribers where band = 'lakehorse')
--   to stdout with csv;
