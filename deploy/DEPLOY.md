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

**Not tested.** I have no Cloudflare account here, so `worker.js` has never run
against real KV, and its routing and CORS handling are unverified. Deploy it under a
throwaway name first and run the step 4 smoke tests before pointing the live board at
it.
