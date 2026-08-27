# Fulfillment Desk

One dashboard over one order database, in six sections.

The work:

- **New orders** — everything still to fulfill, worst overdue at the top, so the
  order that needs picking up is the one you land on. Flip to *Latest in* to see
  what just arrived. Declined payments stay in the list but sit below the work
  that can actually be done.
- **Completed** — every delivered order, newest first, each with the time it
  took.
- **By product** — the same orders cut by what was sold. Each product keeps its
  own four lanes (drag a card between them), its turnaround target, what's past
  due, and what it has taken in.

The setup:

- **Products** — add and remove what you sell, set each one's fulfillment steps
  and turnaround target, and paste the Stripe price or product ID that routes an
  order to it.
- **Reports** — what sold, how fast it shipped, who shipped it.
- **Settings** — the Stripe connection, notifications, and how long delivered
  orders stay visible under By product.

Each tab is its own URL (`#/?tab=inbox`), so you can keep two windows open on
different sections. They share one record and pick up each other's changes
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
  App.jsx              the sign-in gate
  Dashboard.jsx        the shell: tabs, board, order drawer, alerts
  views/
    ByProduct.jsx      the board grouped by what was sold
    admin.jsx          reports, products, settings
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
every row, on the product cards, and large at the top of the order drawer, next
to the one button that stops it.

Two rules decide when an order is past due, and the tighter one wins:

- the **house rule** — *Settings → Past due → Mark an order past due after
  (hours)*, 12 by default, which applies to everything;
- each product's own **Turnaround target (hours)**, in Products.

So a product promised in 48 hours still goes past due at 12, while one promised
in 6 is late at 6 rather than waiting for the house limit. Change the house rule
and every order already on the board is re-dated, not just the ones that arrive
next — deadlines are worked out from the rule in force, never frozen at the
moment a payment landed.

The clock is grey while an order is inside its deadline and red once it runs
past, so a list of red rows is the thing you can see from across a room. A
declined payment never turns red for age: it needs chasing, not fulfilling.
Stopping the clock moves the order out of New orders and into Completed, where
it freezes at its final time — green if it made the target, amber if it didn't.
Those frozen numbers are what Reports averages.

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

### Telling the board which product is which

Open **Products**, click the gear on a product, and paste its Stripe price or
product ID (`price_1Ab…`, `prod_Xyz…`) — a product can carry several. The card
then shows what it matches on, and a product with no ID yet says so.

Matching runs in that order: an exact price or product ID always wins. If the
charge carries no ID you've mapped, the product's keyword is checked against the
charge description. Anything still unmatched lands under **Needs triage** in the
By product view, where you can see what to map.

Adding a product gives it its own group in By product and its own row in
Reports. Removing one leaves its past orders
intact — they fall to Needs triage rather than disappearing.

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
