# Premium Palace LOA

A producer desk for Premium Palace. It is a copy of the Thrive LOA Producer
Desk in `loa-desk/`, kept as its own source rather than a flag on that one.

**Live:** https://claude.ai/artifact/RQy9koe2YKu4aXX367iswG

## The two desks share no data

This is the whole point of the copy, so it is worth being exact about why
the records cannot touch:

- This desk saves through the **artifact capability**: a commit republishes
  this page with the record embedded in its own `<script id="tc-state">`.
  The book therefore lives in *this artifact's version history* and nowhere
  else. There is no shared key, no shared token and no shared database.
- Thrive's desk saves the same way into its own artifact, and on
  `thrive-loa.pages.dev` into the relay keys `loa.state` and
  `snapshots.loa` behind `DESK_TOKEN`.

Nothing here reads or writes either of those keys, and nothing here is
wired to the relay at all.

## The Cloudflare home

Live at `premium-palace-loa.pages.dev`, reading and writing its own two
relay keys:

| | Thrive | Premium Palace |
|---|---|---|
| record | `loa.state` | `pp.loa.state` |
| console copy | `snapshots.loa` | `snapshots.pp-loa` |
| secret | `DESK_TOKEN` | `PP_DESK_TOKEN` |

The relay used to hold a single flat `DESK_KEYS` allow-list, and
`readDeskToken` did not distinguish one token from another — every desk
token reached every desk key. That was fine with one desk and wrong with
two, so `deploy/worker.js` now carries a `DESKS` table that scopes each
token to its own keys. Thrive's token reaches exactly the two keys it
always did; it is refused on Premium Palace's, and vice versa.

**The two secrets must never be set to the same value.** The scoping is by
token, so one shared value hands each agency the other's book.

Note that a desk token is baked into the deployed page and is therefore
readable by anyone who opens the site. That is how this desk has always
worked. What the scoping buys is that the blast radius of a leaked token
stops at that one agency's keys.

## Build

```sh
node build-artifact.mjs      # -> dist/artifact.html, published as the artifact above
```

## What differs from `loa-desk/`

Kept deliberately small, so the next copy from Thrive is easy to re-apply:

- `org.name` in the shipped state is `Premium Palace LOA`; the book ships
  empty (no agents, deals or calls), and the build asserts that.
- The brand in visible copy, the document title, the CSV/JSON export
  filenames and the sign-up email placeholder.
- The two embedded marks in `desk-style.css` (`--thrive-logo`,
  `--thrive-tile`) are the Premium Palace crest and a lattice tile built
  from it. The variable names are left alone so a re-copy stays a clean
  diff.
- The masthead accent bar is replaced by the crest (`CREST` in the page
  script, carried through every self-save by `buildDocument`).
- A Thrive-only migration line that renamed the agency was dropped.
