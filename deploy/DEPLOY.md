# Publishing Thrive Command on Cloudflare

## Read this first

The console currently stores its data in a **claude.ai artifact database**, reached
through `window.claude.use("db")`. That object only exists inside a claude.ai
artifact. Copy the HTML to Cloudflare as-is and the page will load, look right for a
moment, and then tell you it cannot reach the company database — because on
`*.pages.dev` there is no `window.claude` at all.

So "publish it on Cloudflare" is really two jobs: host a static page (ten minutes),
and give it a backend (the rest of this document).

There are two honest routes.

---

## Route A — static snapshot, no backend

Ten minutes, no Cloudflare Worker, no KV, no login. I bake the current numbers into
the HTML as a frozen copy and you publish that.

**What you get:** a real URL, on your own domain, that looks and reads exactly like
the console.

**What you give up:** it is a photograph. The numbers are correct as of the moment I
built it and never change again. No passcode gate (the page has no database to keep
the hash in), no sync, no settings — the brokerage-spread box would do nothing.
Refreshing the data means asking me to rebuild and you redeploying.

Worth it only if what you want is a shareable snapshot for a specific conversation —
a board meeting, an investor call. It is not a dashboard.

Say the word and I will produce the file.

---

## Route B — Cloudflare Pages + a relay Worker

This is the real thing, and it solves a problem you have been stuck on.

Your **Lead Tech Fulfillment board already contains a relay client**. Its bundle
reads `VITE_RELAY_URL` at build time and, when that is set, stores its whole record
through `GET|PUT /kv/:key` with a bearer token instead of browser storage. It is
inert today only because that variable was empty when the app was built.

`deploy/worker.js` implements exactly that protocol. Which means:

- The console gets a real database it can read and write.
- **The Lead Tech board syncs natively** — no bridge script, and the artifact
  republish that keeps getting blocked stops mattering.
- Both portals and the console end up on one store you own.

The catch: pointing the board at the relay needs its `VITE_RELAY_URL` set, which
means either rebuilding it from source (if you have the Vite project) or patching one
string in the built bundle. Step 6 covers both.

### What you need

- A Cloudflare account (free tier is enough).
- Node 18 or newer. `node -v` will tell you.

Everything below uses `npx wrangler` rather than a global install, so there is
nothing to install first and no permission errors to fight.

### 0. Get the files on your machine

Skip this only if you already have the repo cloned and are standing in it.

```sh
cd ~
git clone https://github.com/andrewwdovee/THRIVE-CARRIERS.git
cd THRIVE-CARRIERS
git checkout claude/admin-portal-data-sync-zt258v
cd deploy
```

Check you are in the right place before going on:

```sh
pwd     # .../THRIVE-CARRIERS/deploy
ls      # DEPLOY.md  build-pages.mjs  make-credentials.mjs  worker.js  wrangler.toml
```

Every command from here runs from that `deploy` folder.

Then connect the CLI to your Cloudflare account — this opens a browser:

```sh
npx wrangler login
```

### 1. Create the KV namespace

```sh
npx wrangler kv namespace create THRIVE_KV
```

It prints an `id`. Paste it into `wrangler.toml`, replacing
`PASTE_YOUR_KV_NAMESPACE_ID_HERE`.

### 2. Generate your credentials

```sh
node make-credentials.mjs "a long owner password you will remember"
```

It prints three values. Set each as a secret. They never get written to
`wrangler.toml` — which matters, because **this repository is public**, so anything
committed to it is readable by anyone. Secrets live only on the worker:

```sh
npx wrangler secret put OWNER_PASSWORD_SALT
npx wrangler secret put OWNER_PASSWORD_HASH
npx wrangler secret put TOKEN_SECRET
```

Then edit `wrangler.toml` and set `OWNER_EMAIL` to the address you will sign in with.

### 3. Deploy the relay

```sh
npx wrangler deploy
```

It prints a URL like `https://thrive-relay.<your-subdomain>.workers.dev`. Keep it.

### 4. Smoke-test it before trusting it

```sh
RELAY=https://thrive-relay.<your-subdomain>.workers.dev

# should print {"ok":true,...}
curl -s $RELAY/health

# should print a token
TOKEN=$(curl -s -X POST $RELAY/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"your password"}' \
  | sed 's/.*"token":"\([^"]*\)".*/\1/')
echo "$TOKEN"

# write and read a value back
curl -s -X PUT $RELAY/kv/smoke -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"value":"hello"}'
curl -s $RELAY/kv/smoke -H "Authorization: Bearer $TOKEN"
```

The last call should return `{"value":"hello","key":"smoke"}`. A wrong password must
return 401 — check that too, then delete the smoke key.

### 5. Publish the console on Pages

The console is one file that works in both homes: on claude.ai it uses the artifact
database and its passcode gate; on your domain it signs into the relay and uses that
instead. Nothing forks, and both paths are tested.

```sh
node build-pages.mjs https://thrive-relay.<your-subdomain>.workers.dev
npx wrangler pages project create thrive-command
npx wrangler pages deploy ./dist --project-name thrive-command
```

Pages prints your URL, something like `https://thrive-command.pages.dev`.

**Now go back and allow that origin**, or the browser's calls will all be refused:
put it in `ALLOWED_ORIGINS` in `wrangler.toml` and run `npx wrangler deploy` again. If
you attach a custom domain later, add that too — the list takes several, comma
separated.

Open the URL. You should get a sign-in card; use the `OWNER_EMAIL` and the password
you generated in step 2. The masthead says **Sign out** rather than **Lock** — that
is how you know you are on the relay copy rather than the artifact.

If sign-in says it cannot reach the relay, the origin is not on the allow-list.

### 6. Point the Lead Tech board at the relay

**If you have the Vite source:** set `VITE_RELAY_URL=<your relay URL>` in `.env`,
rebuild, redeploy. Done — the board's own sign-in now authenticates against the relay
and its record lives in KV.

**If you only have the built bundle:** find this in the JavaScript

```js
fn=String((Fn==null?void 0:Fn.VITE_RELAY_URL)||(Fn==null?void 0:Fn.VITE_STORAGE_URL)||"")
```

and replace it with

```js
fn=String("https://thrive-relay.<your-subdomain>.workers.dev")
```

Keep the `.replace(/\/+$/...)` that follows it intact. Test in a private window
before replacing the live copy: sign in, add a call row, reload, confirm it persisted.

### 7. Move the existing data across

The relay starts empty, so the console will say nothing has synced. The keys it reads
are flat versions of the artifact document paths:

| Artifact document | Relay key |
|---|---|
| `snapshots/loa` | `snapshots.loa` |
| `snapshots/leadtech` | `snapshots.leadtech` |
| `config/settings` | `config.settings` |

Two ways to fill them:

- **Fastest:** open the console on Pages, go to **Sync & sources**, and paste an
  export into the importer. It writes straight to the relay.
- **Or ask me** — I will pull the current snapshots out of the artifact database and
  `PUT` them to your relay, so your LOA history carries over intact.

From then on the hourly sync keeps writing to the artifact copy. If you want the sync
to target the relay instead, say so and I will repoint it.

---

## Which one

If you want a live dashboard your team uses, **Route B**. It is a couple of hours of
setup, it costs nothing at your volume, and it takes both portals off the artifact
platform onto infrastructure you control — which also removes my ability to be the
bottleneck on syncing.

If you want a URL to show someone this week and nothing more, **Route A**.

## Onboarding — the signing link and the tab

New since the rest of this file. Three pieces:

| | |
|---|---|
| `onboarding/index.html` | the public page a client signs — both agreements, the signature pads, the headshot |
| `onboarding/welcome.html` | step two, at `/welcome` — the setup list they land on the moment the form is signed |
| `onboarding/training.html` | the training calendar at `/training`, generated from the weekly pattern |
| `onboarding/states.html` | the states we target at `/states`, with the cost of a call in each |
| `onboarding/start-time.html` | the start-times board at `/start-time` — who is on at 10 and who at 11, and where an agent changes their own |
| `POST /onboarding/submit` on the worker | no token, because the signer has no account yet |
| `POST /onboarding/preferences` | no token either; it can only change a handful of fields on a row that already exists |
| `GET /onboarding/roster` | no token; names, start times, volumes and busy days, and nothing else |
| the **Onboarding** tab on the board | the link to send, and the grid of who has signed what |
| the **Start times** tab | the settings link, the morning switch-off list, and who ends up off most often |

### 1. Put the signing page up

```sh
cd ~/THRIVE-CARRIERS/onboarding
node build-onboarding.mjs https://thrive-relay.aandrewdavidson.workers.dev \
  --entity "Thrive Companies LLC" --state Florida \
  --rules https://thrive-inbound.pages.dev/
npx wrangler pages deploy ./dist --project-name thrive-onboarding --commit-dirty=true
```

Pages prints a URL — `https://thrive-onboarding.pages.dev` if the project is named
as above. That is the link the board hands out, so keep the name. The setup list at
`/welcome` and the settings page at `/start-time` ride along in the same deploy,
which is why neither needs a second project or a second allowed origin, and why the
signed form can reach the setup list with a relative path.

**The setup list is the part to edit.** `onboarding/welcome.html` opens with a
`STEPS` array, and the numbering, the progress bar and the saved ticks all come off
it. Keep each `id` stable: somebody part-way through loses their ticks if it changes.

All eight steps have their link baked in. A flag still overrides any of them, and
an unset link loses its button while the step keeps its words.

**The states page draws a real map.** `onboarding/us-states.json` is 50 SVG paths
projected Albers USA, generated once by `onboarding/mapgen` and embedded at build
time — no runtime d3, no CDN, nothing to break. The states we target and what a
call costs in each live in `states.html`; the count and the total are worked out
from that list, so editing one line keeps both honest. See `mapgen/README.md` only
if the geometry itself has to change.

**The training calendar is a weekly pattern, not a month.** `onboarding/training.html`
stores the five session types and what runs on each weekday, and generates whatever
month you are looking at from that — so it cannot go out of date, and changing a
trainer is one line. Below 980px the month grid is dropped and the week stands on
its own, because seven columns at phone width is not a calendar.

`--rules` is where the button on the thank-you page goes. `--preview` builds the
same page with no relay instead, to show someone before any of this exists: it
posts nowhere and says so on submit rather than losing a signature quietly.

### 2. Let the relay accept it

The submit route is public but not open: the CORS allow-list still applies, so the
page's own origin has to be on it or the browser refuses the POST. In
`deploy/wrangler.toml`, add the Pages URL to `ALLOWED_ORIGINS` alongside the ones
already there, then:

```sh
cd ../deploy
npx wrangler deploy
```

Check it answers:

```sh
curl -s -X POST https://thrive-relay.aandrewdavidson.workers.dev/onboarding/submit \
  -H 'Content-Type: application/json' -H 'Origin: https://thrive-onboarding.pages.dev' \
  -d '{}'
```

`{"error":"Missing fields","missing":[...]}` is the right answer — it means the route
is live and validating. `403` means the origin is not on the list yet.

### 3. Put the tabs on the board

```sh
node build-leadtech.mjs https://thrive-relay.aandrewdavidson.workers.dev \
  --onboarding https://thrive-onboarding.pages.dev
npx wrangler pages deploy ./dist-leadtech --project-name thrive-leadtech --commit-dirty=true
```

That adds two tabs: **Onboarding** and **Start times**.

**Start times** is the morning and evening job. Everyone who signed picked 10:00 or
11:00, and the tab lists them under the time they picked with their first name, last
name and email. If someone is not on fifteen minutes past, switch them off; at night,
"Turn everyone back on" clears the lot. Each switch-off is logged, so the figure at
the bottom ranks who ends up off most often, over the last thirty days or all time.
An account left off from a previous day is called out in the banner rather than
quietly reset — it stays off until someone turns it back on.

The board has no source, only the built bundle, so the tabs are spliced in. The patch
refuses rather than guesses: it finds the minified names for the jsx runtime, React
and the storage object and fails if any is ambiguous, checks the tab array is the
shape it expects, and checks every CSS class it uses is in the board's compiled
stylesheet. If the board is ever rebuilt and the patch stops matching, it will say
exactly what no longer fits instead of writing a broken board. It also refuses to
layer onto a bundle that already carries one of the two tabs but not the other.

### What lands where

| key | holds |
|---|---|
| `onboarding/submissions` | the list the grid reads — names, start times, steps, no images |
| `onboarding/doc/<id>` | one signed agreement, with the signature and the photo |
| `starttimes/state` | who is switched off right now, and every switch-off ever |

A start time, a weekly volume (15, 25, 35 or 50), busy days with an AM/PM/all-day
marker, and a note all live on the submission row, so the Start times tab reads them
without a second fetch. `POST /onboarding/preferences` is the only thing that writes
them, it can only touch those fields on a row that already exists, and it stamps
every change and keeps the last ten.

`GET /onboarding/roster` is what the public board reads. It is deliberately narrow:
name, start time, volume, busy days. **The email never comes down it** — the email
is what lets somebody change a row through the route above, so publishing it beside
everyone's name would be handing out the edit key for the whole floor. Nor do the
phone number, the NPN, the note or the agreements. There is a test that fails if any
of them ever appear in that response.

The images live apart from the list so the grid is one small read however many people
have signed. The board fetches a document only when you open that row.

### Things worth knowing

- **The agreement is not legal advice.** Section 2 — ad spend is non-refundable, and
  the client waives chargebacks on it — is the operative clause and the one a lawyer
  should read before this goes to a single client. `onboarding/contract.md` is the
  same text in plain Markdown, for handing to one.
- **Both public routes are public on purpose.** Guards: the origin allow-list, a
  3.2 MB body cap, an hourly throttle per address, required fields, and no deletes.
  Reading anything back still needs the bearer token.
- **`thrive-relay` is this worker; `stripe-sync` is not.** `deploy/wrangler.toml`
  names the worker `thrive-relay`, so `npx wrangler deploy` publishes it to
  `thrive-relay.aandrewdavidson.workers.dev`. The console's Pages build points at
  `stripe-sync.aandrewdavidson.workers.dev`, which is a different worker — it
  answers `{"error":"Unauthorized"}`, a string this code never produces. If the
  console is meant to share a store with the board, that mismatch needs settling
  before it will.
- **The board is public and the note is not on it.** Anything typed into "anything
  else the desk should know" goes to the desk, not the board — the page says so where
  it is typed.
- **The settings page is keyed on the email alone.** Somebody who knows a client's
  address could change their start time. That is the price of a link that works
  without a login: it is reversible from the board, every change is stamped and
  kept, and none of it is sensitive. Say the word and it goes behind a code.
- **The artifact copy of the board cannot see submissions.** It stores in the browser,
  not the relay. The tab is only useful on the Pages copy.
- **Headshots are not wired into the Social Studio roster yet.** They are stored and
  shown on the row; copying them across is a separate job.
- **The signed page is the record.** The agreement, the signature, the name, the title
  and the date all print together — there is a print stylesheet for exactly that, and a
  button on the page.

## If something goes wrong

**`cd: no such file or directory: deploy`** — you are not in the repo. Run step 0.

**`zsh: command not found: wrangler`** — use `npx wrangler ...` as written above. A
global install is not needed.

**`Cannot find module '.../make-credentials.mjs'`** — you are not in the `deploy`
folder. `cd` there and check with `ls`.

**Sign-in says it cannot reach the relay** — the Pages origin is not in
`ALLOWED_ORIGINS`. Add it and redeploy the worker.

**`wrangler login` opens a browser that does nothing** — you are signed into the
wrong Cloudflare account, or none. Sign in at dash.cloudflare.com first, then retry.

## What is tested and what is not

**Tested.** The console's relay data layer was run end to end against a stand-in relay
speaking this exact protocol: sign in, load both snapshots, render every page. It
produced numbers identical to the artifact copy ($3,917 company net, $1,541 Lead Tech
net on the current data), and the artifact mode still works unchanged. The worker's
password hashing and token signing round-trip correctly against the generator.

The onboarding route was driven end to end against a stand-in KV — eighteen cases,
covering the happy path, every rejection, the origin gate and the throttle — and the
signing page and the patched board were both driven in a real browser.

**Not tested.** I have no Cloudflare account here, so `worker.js` has never run
against real KV, and its routing and CORS handling are unverified. Deploy it under a
throwaway name first and run the step 4 smoke tests before pointing the live board at
it.
