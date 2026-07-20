-- S'notify v5 — encrypt band passwords at rest.
-- Paste into Supabase → SQL Editor → Run. Idempotent; independent of v3/v4.
--
-- bands.pass has held plaintext since v2 (band_pass_ok compared it with a
-- bare `=`). This bcrypt-hashes every existing password in place and
-- redefines band_pass_ok to verify against the hash instead. Every existing
-- caller — the login gate, every library RPC via _require_pass, the two
-- inbox storage policies, both Edge Functions, and admin_create_band's new
-- bands — goes through this one function, so nothing else needs to change.

create extension if not exists pgcrypto;

-- One-time, idempotent: skip rows that already look like a bcrypt hash, so
-- running this again (or after a new band is added) never re-hashes a hash.
update bands set pass = crypt(pass, gen_salt('bf'))
where pass !~ '^\$2[aby]\$\d{2}\$';

create or replace function band_pass_ok(b text, p text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from bands
    where slug = lower(b) and pass = crypt(coalesce(p, ''), pass))
$$;
