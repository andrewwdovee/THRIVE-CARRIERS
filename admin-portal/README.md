# Thrive Command — owner console

A read-only console that mirrors both Thrive portals into one company-wide view, for
the owners of Thrive Companies.

**Live:** https://claude.ai/code/artifact/67ea2506-2daa-427a-9434-ab9f77b4a33f

## What is in here

| File | What it is |
|---|---|
| `thrive-command.html` | The console itself. This is the artifact source — publish this file to the URL above. |
| `leadtech-bridge.html` | A standalone `<script>` block that gets appended to the Lead Tech Fulfillment board so its data can leave the browser. Not yet installed — see below. |

Both files are artifact *content*, not full HTML documents: the publisher wraps them in a
`<!doctype html><head>…</head><body>` skeleton, so they deliberately have no `<html>`,
`<head>` or `<body>` tags of their own.

## The two sources

| Portal | Where its data lives | How it reaches the console |
|---|---|---|
| [Thrive LOA Producer Desk](https://claude.ai/code/artifact/604efc81-daa6-4fa0-852a-e3dd33577682) | Inside its own published HTML, in a `<script id="tc-state">` block | A sync run reads the published artifact directly. Nothing has to be open. |
| [Lead Tech Fulfillment](https://claude.ai/code/artifact/c0337537-9660-4dbe-a3d9-78c6f7c8fd6f) | `localStorage["fulfillment_board_v3"]`, in whichever browser it was worked in | Needs `leadtech-bridge.html` installed (below). Until then: export from the board and paste into the console's **Sync & sources** tab. |

A portal's data cannot be fetched at runtime by another page — the artifact content
security policy blocks cross-origin requests — so syncing is always *push* (a bridge
writing to a database) or *handoff* (an export pasted in), never pull.

## Console storage

The console declares the `db` capability and reads three documents:

```
snapshots/loa         the Producer Desk state, plus syncedAt / syncedBy / carriers map
snapshots/leadtech    the fulfillment digest, plus syncedAt / syncedBy
config/owner          { salt, hash, iter } for the owner passcode — PBKDF2-SHA256
```

Access rule: `{path: "", read: "interact", write: "admin"}`. A `db` artifact is
organization-internal and **cannot be shared publicly at all**, so every reader is a
signed-in member of the workspace. The passcode is a second door, not the lock.

Agent password hashes from the Producer Desk are stripped before anything is written
here; they stay in the desk.

## Installing the Lead Tech bridge

The bridge mirrors an allow-listed digest of the board into the board's *own* database,
where a sync run can read it. It never touches the board's state, DOM or React tree, and
it deliberately does not copy `syncUrl`, `syncToken`, `notifyWebhook`, `notifyEmail` or
`notifyPhone` — a shared database is the wrong place for a credential.

To install, rebuild the board's published content with the bridge appended:

```sh
# 1. Read the live artifact so its full HTML is saved locally, then take the
#    authored content: everything between "<body>\n" and "\n</body></html>".
# 2. Append the bridge:
cat _leadtech-content.html leadtech-bridge.html > leadtech-fulfillment.published.html
```

Then publish that file to the Lead Tech artifact URL, restating **both** capabilities so
the existing download feature is not revoked:

```json
{"downloads": true, "db": {"rules": [{"path": "", "read": "interact", "write": "admin"}]}}
```

Omit `favicon` and `contract` so the board keeps its icon and its runtime version. If
anything goes wrong, roll back from the artifact's version picker.

`_leadtech-content.html` and `leadtech-fulfillment.published.html` are build outputs
derived from the live artifact and are not tracked here.

## Sync

`snapshots/loa` is written from a Claude session that reads the desk artifact. A daily
Routine keeps it current; the console's **Sync & sources** tab shows how stale each
source is, and a source untouched for more than 36 hours is flagged.

## House rules the console inherits

The commission arithmetic is copied from the Producer Desk so the two never disagree:

```
advanced AP = ap × advanceRate        (75%)
agent comm  = advanced AP × agentPct  (agent's contract level)
house comm  = advanced AP × housePct  (carrier's schedule at the house level)
spread      = house comm − agent comm
net         = spread − (calls × costPerCall)
```

Deal statuses bucket the same way too: `issued_paid` is paid; `underwriting` and
`approved` are pending; `nsf`, `declined` and `chargeback` fell off.

## Overview sections

The Overview is deliberately three flat sections of tiles under one company figure —
no charts. Every tile below is defined over the selected date range.

**LOA — what the agency wrote**

| Tile | Definition |
|---|---|
| LOA written premium | Σ `ap` over all deals written |
| LOA marketing cost | inbound calls × `costPerCall` |
| LOA agent commission | Σ agent commission on issued & paid deals |
| LOA profit | commission spread − marketing cost |

**Thrive Companies brokerage** — the house's own cut of that same business

| Tile | Definition |
|---|---|
| Annual premium written per day | written AP ÷ days in range |
| Commission paid out to agents | same figure as LOA agent commission |
| Thrive upfront commission | Σ `ap × 0.75 × housePct` — the house's cut of the advance |
| Thrive total commission | Σ `ap × housePct` — full first year, advance plus the as-earned tail |

**Lead Tech call ledger** — buys calls at `callCost`, sells at `callPrice`

| Tile | Definition |
|---|---|
| Inbound calls taken | Σ call counts |
| Total spent on calls | calls × `callCost` ($30) |
| Total cash collected | calls × `callPrice` ($35) |
| Total refunds | Σ refund amounts |
| Total wiped wallet | Σ wipe amounts |
| Lead Tech profit & loss | collected − spent − refunds − wipes |

Company net = LOA profit + Lead Tech P&L.

Note that product and subscription orders are **not** in the call ledger — that is the
fulfillment side of the board and it is reported on the Lead Tech tab as "Fulfillment
net". The two are kept apart on purpose so neither bottom line quietly absorbs the
other.
