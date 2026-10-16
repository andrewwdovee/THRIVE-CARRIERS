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

## If this desk ever needs a Cloudflare home

`thrive-loa.pages.dev` works because `loa-desk/relay-storage.js` writes
`loa.state` and `snapshots.loa`, and the relay's `DESK_KEYS` allow-list
lets a desk token reach exactly those two.

That allow-list is **flat, and `readDeskToken` does not distinguish one
token from another**. So adding Premium Palace's keys to `DESK_KEYS` as it
stands would let the Thrive desk token read and write Premium Palace's
record, and the other way round — precisely the mixing this copy exists to
avoid. A relay home for this desk needs per-token key scoping first; it is
not a matter of adding two strings.

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
