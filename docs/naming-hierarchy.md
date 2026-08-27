# Naming hierarchy for the site

A shared vocabulary for the Lakehorse band site, so a notebook line like
"the door on the Art page" or "the Links card on Band assets" lands on
exactly one thing. Built from CR-102. If a name here reads wrong, rename it
in this file and it becomes the name.

This covers site-level structure only. The Music page's own internals (the
progress meter, the to-do list, the mix-revision area, the version chooser)
are 388 KB of their own and deserve a separate labelled pass before this
doc calls itself complete.

## The terms

- **Site** — the whole thing at `bunjumun.github.io/snotify/`.

- **Page** — one top-level HTML file with its own URL, reachable from the
  Pages menu. The named pages:
  - **Album page** — `index.html`, titled "Sn'Album", the site's front door.
  - **Music page** — `music.html`.
  - **Art page** — `art.html`.
  - **Band assets page** — `assets.html`.
  - **Release Builder page** — `release-builder.html`.
  - **the Game** — Lakehorse Swimulator, `game/`.

- **Sub-page** — a page reached only from another page, never from the Pages
  menu. Today there is one: the **Image tools page** (`art-tools.html`)
  under the Art page.

- **Header** (or top bar) — the strip at the top of every page: the logo
  glyph, the title, the tagline, the count badge, the Pages menu, the
  ⚙ admin button, and Log out.

- **Pages menu** — the `☰ Pages ▾` dropdown in the header. Its entries are
  **menu links**, not doors. As of CR-101 every page shows the same full
  set of six, minus its own entry, in one order.

- **Door** — a large clickable tile that navigates somewhere, shown in the
  page body, never in the header. A door has an **icon**, a **title**, and
  a **sub-label**.
  - The Album page has a **door grid** of five: Music, Art, Game, Assets,
    Release.
  - The Art page has its own two doors: Band artwork, Image tools.

- **Card** — a bordered panel inside a page holding one feature. On the
  Band assets page: the **Links card**, the **Goals card**.

- **Section** — a titled region within a page, larger than a card.

- **Admin mode** (the ⚙ button, labelled "Site Admin") — the editing layer
  behind the admin password: the Tools manager, door and text edits, and so
  on. Distinct from **band login**, which is the per-band content password
  that gates a band's own songs, art, lore, goals and links.

- **Tool** — an entry in the Tools manager on the Art page. Each one opens
  an uploaded or linked single-file HTML utility through the launcher.

- **Game-internal terms** — bong, weed jar, fish dialogue, diver, slate,
  Ship's Log. These stay as they are. They name game content, not site
  structure, and the notebook already uses them consistently.
