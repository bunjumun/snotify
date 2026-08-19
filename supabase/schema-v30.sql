-- S'notify v30 - edit_comment can also move a comment's stored time.
-- Idempotent and additive over v3-v29. One function body, no table changes.
-- ASCII only: see the 15 Aug note about clipboard transport.
--
-- WHY. A comment's time is set once, when it is posted, from wherever the
-- playhead happened to be. He asked to be able to correct that afterwards -
-- a comment posted a beat early or late still means the moment it was about,
-- not the moment the mouse landed. The column was always editable server
-- side; nothing before this let a client ask for it.
--
-- BACKWARD COMPATIBLE BY CONSTRUCTION. new_time_s defaults to null, and null
-- means "leave it alone" via coalesce, so every existing caller - the text-only
-- edit CR-56 depends on and every prior edit_comment call - keeps updating
-- text and nothing else. Only a caller that supplies a number touches time.
-- ---------------------------------------------------------------------------
create or replace function edit_comment(b text, p text, cid uuid, txt text, who text,
                                          new_time_s numeric default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare row_out comments;
begin
  perform _require_pass(b, p);
  if coalesce(trim(txt), '') = '' then
    raise exception 'comment text required';
  end if;
  if new_time_s is not null and new_time_s < 0 then
    raise exception 'time cannot be negative';
  end if;
  update comments set text = txt, name = coalesce(who, name), edited_at = now(),
      time_s = coalesce(new_time_s, time_s)
    where id = cid and comments.song_id like lower(b) || '/%'
    returning * into row_out;
  if not found then
    raise exception 'comment not found';
  end if;
  return to_jsonb(row_out);
end $$;
