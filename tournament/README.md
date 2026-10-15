# Thrive Knockout

A single-elimination bracket for Thrive Companies agents, with a control
room for posting each week's scores.

`thrive-knockout.html` is the whole board, and it runs in two homes from
this one file:

| Home | Storage | Who may edit |
|---|---|---|
| claude.ai artifact | the artifact database | editors, behind a passcode stored beside the data |
| `thrive-knockout.pages.dev` | the Cloudflare relay | the relay owner account, checked on the server |

Which one it is depends on `window.THRIVE_RELAY`, baked in at build time by
`deploy/build-knockout.mjs`. The two keep **separate data** -- a score posted
on one does not appear on the other. Pick one as the real board.

## The draw

Round one reads straight down the list: 1 plays 2, 3 plays 4. A field that
is not a power of two rounds up to the next one, and the shortfall is taken
off the top, so the leading seeds sit out round one. Thirteen agents means a
sixteen-slot draw with byes for seeds 1, 2 and 3.

Results are held **by position** (`round-match`), not by agent. Renaming an
agent is always safe; removing or reordering one mid-tournament re-points
existing scores at whoever lands in that slot, and the control room warns
about this once any score exists.

## Build and deploy

```sh
node deploy/build-knockout.mjs https://thrive-relay.<you>.workers.dev
npx wrangler pages deploy ./deploy/dist-knockout --project-name thrive-knockout --branch main
```

The relay serves the board at `GET /tournament` with no token, because a
scoreboard should not need an account to read. Writes go through
`PUT /kv/tournament_board` with a bearer token, so only the owner can post.
