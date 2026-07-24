-- S'notify v4 — in-app "site admin" mode for adding new bands/libraries.
-- Paste into Supabase → SQL Editor → Run. Idempotent; additive over v3.
--
-- One admin identity for the whole site (not per-band): a single password
-- gates the "add a new band" feature. There's no email/user system to reset
-- through, so recovery is a security question set at the same time as the
-- password — answering it resets the password without ever exposing the old
-- one. Same posture as everywhere else: nothing readable with the
-- publishable key directly, every access goes through a SECURITY DEFINER
-- function.

create extension if not exists pgcrypto;

create table if not exists admin_config (
  id            int primary key default 1 check (id = 1),  -- single row, ever
  password_hash text not null,
  question      text not null,
  answer_hash   text not null,
  updated_at    timestamptz not null default now()
);
alter table admin_config enable row level security;
-- RLS on, zero anon policies — same as songs/versions/projects; all access
-- flows through the RPCs below.

create or replace function _norm_answer(a text) returns text
language sql immutable as
$$ select lower(trim(coalesce(a, ''))) $$;

-- Passwordless: lets the client tell "not set up yet" from "set up, forgot
-- it" apart, and hands back the recovery question — never the password or
-- the answer.
create or replace function admin_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from admin_config)
    then jsonb_build_object('configured', true, 'question', (select question from admin_config))
    else jsonb_build_object('configured', false) end
$$;

-- One-time setup. Refuses once a row exists — admin_recover is how the
-- password changes after that, not this.
create or replace function admin_setup(password text, question text, answer text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if exists (select 1 from admin_config) then
    raise exception using errcode = '42501', message = 'admin already configured';
  end if;
  if coalesce(password, '') = '' or coalesce(question, '') = '' or coalesce(answer, '') = '' then
    raise exception 'password, question and answer are all required';
  end if;
  insert into admin_config (id, password_hash, question, answer_hash)
  values (1, crypt(password, gen_salt('bf')), question, crypt(_norm_answer(answer), gen_salt('bf')));
end $$;

create or replace function admin_login(password text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from admin_config
    where password_hash = crypt(coalesce(password, ''), password_hash))
$$;

-- Recovery: the right answer resets the password; doesn't need the old one
-- at all. Wrong answer just returns false — no hint about why.
create or replace function admin_recover(answer text, new_password text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare ok boolean;
begin
  select (answer_hash = crypt(_norm_answer(answer), answer_hash)) into ok from admin_config;
  if not coalesce(ok, false) then
    return false;
  end if;
  if coalesce(new_password, '') = '' then
    raise exception 'new password required';
  end if;
  update admin_config set password_hash = crypt(new_password, gen_salt('bf')), updated_at = now();
  return true;
end $$;

-- Add another project as a new band/library. Re-checks the admin password
-- server-side — the client's "logged in" state is never trusted on its own,
-- same discipline as every _require_pass call for bands. Requires pgcrypto
-- (created above) since the band password is hashed on the way in, same as
-- schema-v5 does for every existing band.
create or replace function admin_create_band(admin_password text, slug text, title text, band_password text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s text := lower(trim(coalesce(slug, '')));
begin
  if not admin_login(admin_password) then
    raise exception using errcode = '42501', message = 'wrong admin password';
  end if;
  if s = '' or s !~ '^[a-z0-9-]+$' then
    raise exception 'slug must be lowercase letters, numbers and hyphens only';
  end if;
  if coalesce(band_password, '') = '' then
    raise exception 'band password required';
  end if;
  if exists (select 1 from bands where slug = s) then
    raise exception 'a band with that slug already exists';
  end if;
  -- hashed, same as every band password since schema-v5
  insert into bands (slug, pass, title)
  values (s, crypt(band_password, gen_salt('bf')), coalesce(nullif(trim(title), ''), s));
end $$;
