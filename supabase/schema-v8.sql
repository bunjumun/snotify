-- S'notify v8 — editable page text.
-- Paste into Supabase → SQL Editor → Run. Idempotent; additive over v3–v7.
--
-- The copy on the three pages (titles, taglines, the descriptions on the two
-- Sn'Album doors, the hints) stops being hardcoded and becomes rows the site
-- admin can rewrite from the browser, without a commit and a deploy.
--
-- Reads are public and unauthenticated: the text has to render for a visitor
-- standing at the gate, before any password exists. It is site chrome, not
-- library content — nothing about a band is exposed by it. Writes go through
-- the same admin password that creates bands.

create table if not exists site_text (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
alter table site_text enable row level security;
-- RLS on, zero anon policies — same posture as every other table since v3.
-- All access is through the two SECURITY DEFINER functions below.

-- Everything in one call: the page has to apply it before first paint, and the
-- whole table is a few dozen short strings.
create or replace function get_site_text() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from site_text
$$;

-- Save a batch of edits. `entries` is {key: value}; a null or empty value
-- deletes the row, so "clear it back to the built-in wording" needs no second
-- verb. Named `entries` rather than anything matching a column of site_text,
-- for the usual ambiguity reason.
create or replace function set_site_text(admin_password text, entries jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not admin_login(admin_password) then
    raise exception using errcode = '42501', message = 'wrong admin password';
  end if;
  if entries is null or jsonb_typeof(entries) <> 'object' then
    raise exception 'entries must be an object of key: value';
  end if;

  delete from site_text s
   using jsonb_each(entries) e(k, v)
   where s.key = e.k and (jsonb_typeof(e.v) = 'null' or trim(e.v #>> '{}') = '');

  insert into site_text (key, value)
  select e.k, e.v #>> '{}'
    from jsonb_each(entries) e(k, v)
   where jsonb_typeof(e.v) <> 'null' and trim(e.v #>> '{}') <> ''
     and length(e.k) <= 80 and length(e.v #>> '{}') <= 2000
  on conflict (key) do update
    set value = excluded.value, updated_at = now();

  return get_site_text();
end $$;

notify pgrst, 'reload schema';
