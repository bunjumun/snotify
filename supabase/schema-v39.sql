-- S'notify v39 — CR-99 follow-up: admin tool uploads were rejected before
-- they ever reached import-inbox.
--
-- The three 'inbox' bucket policies (v3) all gate on band_pass_ok(folder[1],
-- folder[2]) — folder[1] a real band slug, folder[2] that band's own
-- password. CR-99's tool upload path is <band>/<adminPass>/_tools/<file>:
-- when scope is "all bands" band is the literal string '_site', which is
-- never a row in `bands`, so band_pass_ok fails outright; when scope is one
-- real band, folder[2] is the SITE ADMIN password, not that band's password,
-- so band_pass_ok fails there too. Either way storage.objects RLS blocks the
-- browser's direct POST to the inbox bucket with a 400 before import-inbox's
-- own admin_login check (core.js:1462) ever runs — that check was guarding a
-- door RLS had already locked from the outside.
--
-- Additive: the existing band-password policies are untouched: ref/img
-- uploads still authenticate exactly as before. These three new policies
-- open one extra path — the third folder segment is the reserved '_tools'
-- literal and the second is checked against admin_login instead of
-- band_pass_ok — matching how the edge function already distinguishes
-- 'tool' from 'ref'/'img' (import-inbox/index.ts:96-108).

drop policy if exists "admin tools inbox drop" on storage.objects;
create policy "admin tools inbox drop" on storage.objects
  for insert to anon
  with check (
    bucket_id = 'inbox'
    and (storage.foldername(name))[3] = '_tools'
    and admin_login((storage.foldername(name))[2])
  );

drop policy if exists "admin tools inbox replace" on storage.objects;
create policy "admin tools inbox replace" on storage.objects
  for update to anon
  using (
    bucket_id = 'inbox'
    and (storage.foldername(name))[3] = '_tools'
    and admin_login((storage.foldername(name))[2])
  )
  with check (
    bucket_id = 'inbox'
    and (storage.foldername(name))[3] = '_tools'
    and admin_login((storage.foldername(name))[2])
  );

drop policy if exists "admin tools inbox see own" on storage.objects;
create policy "admin tools inbox see own" on storage.objects
  for select to anon
  using (
    bucket_id = 'inbox'
    and (storage.foldername(name))[3] = '_tools'
    and admin_login((storage.foldername(name))[2])
  );
