# Comments on a public link — the plan, not yet built

> **SHELVED 2026-08-16, at his word: "lets do no comments on public links for
> now and resolve that."** Nothing was built and nothing was un-built — the live
> database was checked rather than this document, and it already behaves the way
> he asked: `get_shared` carries no comments, `get_comments(b, p)` still takes
> the band password, and none of the columns or functions below exist
> (`share_comments`, `via_share`, `hidden`, `add_public_comment` — all absent).
> So "no comments on public links" is the state of the site today and required no
> change. The open question at the foot of this file is parked with it, unanswered
> and no longer in his outbox. **Do not build this, do not re-plan it, and do not
> raise it again unless he does.** The file stays because the reasoning is worth
> having if he ever changes his mind, not because it is queued.

**His line, in BUGS on 16 Aug:** *"Public links should not show any comments, add
'allow comments' option to public share link and when this is activated do not
show comments made by other users but allow new comments to be made by public
user. Require user to enter a name to make a comment. Indicate where the comment
came from on to do list and allow 'public comment hide' on to do list and comment
list"*.

Written rather than built because it needs a schema migration and, more to the
point, because it opens the first path in this site that **writes to the database
without a password**. That is his call to make with his eyes open, not one to
make for him at three in the morning.

## What is already true

The first half of his line is the behaviour today. v23 shares by token and its
own header says it: comments stay private in every case, `get_comments` still
takes the band password, and no public payload carries them. Nothing needs doing
to stop a public link showing comments. Worth saying plainly, because the line
reads as a bug report and is not one.

## The four pieces, and the decisions inside them

**1. The switch, per link.** `projects`, `songs` and `bands` each carry a
`share_token`, so each gets `share_comments boolean not null default false`
beside it. Off unless asked for, and clearing a share clears it. A column rather
than a table because it is one fact about a row that already exists.

**2. Who is posting.** `comments.name` already exists and already holds an
author, so a public visitor fills in the same column and nothing downstream needs
to learn a new shape. Required and non-empty, per his line. The name is not
proof of anything and must never look like it is: a public comment always renders
with its provenance beside it, so "Dave" from a link and Dave the bandmate can
never be mistaken for each other.

**3. Where it came from.** One new column, `via_share text`, holding the token
the comment arrived through. That answers both readings of "indicate where the
comment came from" at once: that it came from outside, and which link it came
through, which matters if he has sent several. **It is never returned to a
client** — the payload carries a boolean and the name of the shared thing, never
the token, or a comment would leak a live link to whoever can read comments.

**4. Hiding.** `hidden boolean not null default false`, with a control in both
places he named. Hidden drops the comment out of the to-do list entirely and
collapses it in the comment list behind a count, so it is reversible and nothing
is destroyed. Band-only, password-gated like every other mutation since v3.

## What the public page does

It shows no comments. Not "no comments by others" — none at all, including the
visitor's own on a later visit, because there is no session to recognise them by
and inventing one is a login by another name. After posting, the page keeps that
comment on screen locally so the visitor can see it landed, and that is all. This
is the honest reading of "do not show comments made by other users": the only
comment a public visitor ever sees is one they typed a moment ago.

## The part that needs him to say yes

`add_public_comment(token, name, text, ...)` is **security definer and takes no
password**. Anyone holding a link he has sent can write rows into his database.
Mitigations that should ship with it rather than after it:

- the token must exist, be live, and have `share_comments` on. Three checks, any
  of which fails silently the same way, so the endpoint cannot be used to test
  whether a token is real.
- hard caps: name 60 characters, body 2000, and a rate limit per token per hour
  held in a small counter table. Without one, a link posted anywhere public is a
  free write endpoint.
- no replies, no regions, no sketches, no attachments from the public path. Only
  a name, a body and a timestamp. Every one of those fields is a surface, and
  none of them is in what he asked for.
- `resolved`, `tags` and the rest stay untouchable from outside.

He may also want a fourth thing that is not in his line and is cheap here: a
switch to accept public comments into a holding area rather than straight onto
the to-do list. Worth one word from him before this is built either way.

## Size

Migration v29 (three columns on the share tables, two on `comments`, one counter
table, four functions), the share builder gaining a tick, a comment form on the
public page, provenance and a hide control on the to-do list, and the same hide
on the comment list. That is a session of its own, and the unauthenticated write
path means it wants him awake for it.
