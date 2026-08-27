# Fulfillment Desk

Two screens over one order database.

- **Fulfillment Desk** (`#/desk`) — the working board. Orders arrive from Stripe,
  move across four lanes, carry a per-product checklist, and alert whoever has
  the window open. Every order runs a stopwatch from the moment it was paid
  for until someone marks it delivered.
- **Admin Console** (`#/admin`) — the owner view. Products and their fulfillment
  steps, reports, and the Stripe connection.

Both read and write the same record, so a change on one shows up on the other
within about twenty seconds.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
```

Open Settings → **Load sample orders** to fill the board with a week of fake
history before wiring up Stripe.

```bash
npm run build        # static bundle in dist/
npm test             # relay + Stripe normalization suites
```

## Where things live

```
src/
  App.jsx              hash router + the switcher between the two screens
  FulfillmentDesk.jsx  board, order drawer, alerts
  AdminConsole.jsx     reports, products, settings
  lib/
    shared.jsx         palette, statuses, Stripe normalization, CSV columns
    useBoard.js        the shared record: load, commit, poll
    storage.js         window.storage — localStorage or the shared KV
    sync.js            pulling charges from the relay
    notify.js          chime, desktop alert, webhook
    auth.js            signing in; carries the session token
  Login.jsx            the sign-in screen
  components/
    Elapsed.jsx        the per-order stopwatch
relay/                 Cloudflare Worker: accounts, sessions, Stripe, shared KV
test/                  node test suites
```

## The clock on every order

An order's stopwatch starts at the moment Stripe took the money — not when
someone noticed it — and runs until the order is marked delivered. It shows on
the card, in the New orders list, and large at the top of the order drawer, next
to the one button that stops it.

Each product carries a turnaround target (its **Turnaround target (hours)** in
Products). The clock is grey while an order is inside its target and red once it
runs past, so a board of red cards is the thing you can see from across a room.
Delivered orders freeze at their final time — green if they made the target,
amber if they didn't — and those frozen numbers are what Reports averages.

Reopening a delivered order starts the clock again from the original payment
time, so the total stays honest.

## Who can sign in

Whether the app asks for a login depends on whether there is a server to enforce
one. A login screen on a static page is decoration — anyone can read the source
and skip it — so the check lives in the relay, which refuses to hand over an
order to a browser without a valid session.

- **No relay configured** — no sign-in. The board is this browser's own copy.
  Fine for one person on one machine; it is not private from anyone using that
  machine.
- **`VITE_RELAY_URL` set** — the app shows a sign-in screen and loads nothing
  until the relay says who you are.

Give the relay a KV namespace (see below), then create an account per person:

```bash
node relay/adduser.mjs https://your-relay.workers.dev someone@yourcompany.com "Their Name"
node relay/adduser.mjs https://your-relay.workers.dev --list
```

It prompts for the password rather than taking it on the command line, so it
stays out of your shell history. Passwords are stored as PBKDF2-SHA256 hashes
and never travel to the browser. Signing in returns a session token that expires
in 14 days; signing out revokes it server-side, so a stolen token stops working
the moment someone signs out.

Whoever is signed in is who claims an order — the Desk stamps their name rather
than asking them to type it.

Two things worth knowing. The `SYNC_TOKEN` you set on the relay is the **owner**
credential: it manages accounts and works machine-to-machine, so keep it out of
browsers. And PBKDF2 costs CPU — on Cloudflare's free Workers plan a sign-in can
exceed the CPU limit; the paid plan has room for it.

## Connecting Stripe

Your Stripe secret key does not go in the app. Anything the browser holds is
readable by anyone who opens the page, and Stripe won't accept a secret key from
a browser anyway. The key lives in the relay — a small Worker you deploy once.

```bash
cd relay
npx wrangler secret put STRIPE_SECRET_KEY   # sk_live_… or sk_test_…
npx wrangler secret put SYNC_TOKEN          # any long random string you invent
npx wrangler deploy
```

Then in the Admin Console under **Settings → Stripe connection**:

- **Sync endpoint URL** — `https://<your-worker>.workers.dev/orders`
- **Access token** — the same `SYNC_TOKEN`
- **Check every (minutes)** — how often both windows pull

Hit **Test connection**. Once it's green, orders flow in on their own.

### Getting orders into the right lane

Under **Settings → Stripe product mapping**, paste each product's Stripe price or
product ID (`price_1Ab…`, `prod_Xyz…`). An exact ID match always wins. If a
charge carries no matching ID, the product's keyword is checked against the
charge description; anything still unmatched lands as **Needs triage**.

## One database for the whole team

By default each browser keeps its own copy in `localStorage`. To put everyone on
one record — and to turn on sign-in — give the relay a KV namespace and point
the app at it:

```bash
cd relay
npx wrangler kv namespace create BOARD    # uncomment [[kv_namespaces]] in wrangler.toml, paste the id
npx wrangler deploy
```

```bash
cp .env.example .env    # then set VITE_RELAY_URL
```

The app holds no shared secret: each browser carries only the session token it
got by signing in.

Set `ALLOWED_ORIGINS` in `relay/wrangler.toml` to your deployed app's URL so the
Worker only answers your own page.

## Notifications

The desktop alert and chime fire in whichever browser has the Desk open — click
**Alerts off** in the header once to grant permission.

Email and text go through a webhook, so no mail credentials live in the app.
Point **Settings → Notifications → Webhook URL** at a Zapier "Catch Hook" or a
Make custom webhook; the Desk posts JSON and your Zap sends the message:

```json
{
  "event": "order.new",
  "title": "New order — Instagram Software",
  "body": "Halle Byrne · $197.00",
  "email": "assistant@yourcompany.com",
  "phone": "+1…",
  "orders": [{ "id": "…", "customer": "…", "product": "…", "amount": 19700 }]
}
```

`event` is `order.new` or `order.overdue`. An order raises the overdue alert once
and then stops.

## Deploying the app

`npm run build` emits a static `dist/` — any static host works (Cloudflare Pages,
Netlify, Vercel, S3).

Both screens are the same bundle at different hashes. Signing in controls
whether someone sees **any** orders, but it does not currently separate the two
screens — anyone who can reach the Desk can reach `#/admin` and your Stripe
settings too. If the Console needs to be off limits to staff, that needs a role
check on the relay's endpoints; the accounts already carry `owner` and `staff`
roles for it, but the board itself does not yet distinguish them.
