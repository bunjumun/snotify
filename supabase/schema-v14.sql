-- S'notify v14 — a band can dress its own pages.
-- Paste into Supabase → SQL Editor → Run. Idempotent; additive over v3–v13.
--
-- Until now the look of a band's library was whatever was written into the
-- stylesheets, so changing an opacity meant editing the site. This keeps a
-- small bag of display settings against the band instead, and the pages read
-- them at load.
--
-- The read is deliberately PASSWORDLESS. This is paint, not content: the slug
-- is already in the URL, and the gate itself has to be wearing the right coat
-- before anyone has typed a password. Nothing in here names a song, a comment
-- or a file. Writing still costs the band password.

alter table bands add column if not exists design jsonb;

-- What the pages ask for on the way in. Returns {} rather than null for an
-- undressed band so the client never has to special-case it.
create or replace function get_band_design(b text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(design, '{}'::jsonb) from bands where slug = lower(b)
$$;

-- Bounded hard. The client only ever sends a flat object of numbers, short
-- colour strings and one image URL, and there is no reason a password-only
-- endpoint should let anyone park arbitrary JSON in the row.
create or replace function set_band_design(b text, p text, d jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_pass(b, p);
  if d is not null then
    if jsonb_typeof(d) <> 'object' then
      raise exception 'design must be an object';
    end if;
    if length(d::text) > 4000 then
      raise exception 'that is more design than a page needs';
    end if;
  end if;
  update bands set design = d where slug = lower(b);
end $$;

notify pgrst, 'reload schema';
