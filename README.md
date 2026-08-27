# Fulfillment Desk

One dashboard over one order database, in six sections.

The work, in the order you'd use them:

- **New orders** — everything still to fulfill, worst overdue at the top, so the
  order that needs picking up is the one you land on. Flip to *Latest in* to see
  what just arrived.
- **Missed payments** — every payment that failed, and what has to be switched
  off because of it. See below.
- **Completed** — every delivered order, newest first, each with the time it
  took.
- **By product** — the same orders cut by what was sold. Each product keeps its
  own three working lanes (drag a card between them), its turnaround target,
  what's past due, and what it has taken in. Delivered orders collapse to one
  line per product so a week of finished work can't push the live work off the
  screen — open it to see them, or drop a card on it to deliver.

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

## When a payment fails

A failed payment is not a lost sale you can shrug at — it's a service still
running on your spend with nothing coming in. So it gets its own queue rather
than sitting among the fulfillment work, and its own alert, separate from the
new-order chime so it can't be mistaken for good news.

Each product carries a second list, **When a payment fails**, set in Products
beside its fulfillment steps: the things to switch off, in order, most expensive
first.

```
Pause the ad campaign (stops the spend)
Email the client about the failed payment
Cancel the subscription in Stripe
```

Whoever is on the desk opens the failed payment, works down that list, and marks
it **Service stopped**. Until they do, a clock counts how long it has been
running unpaid, and the header carries an amber count of how many are still
live. The states are *Needs action → Client contacted → Service stopped*, plus
*Payment recovered* for when Stripe's retry succeeds and there's nothing to
switch off after all.

A product with no shutdown steps says so on its card in Products, because the
failure case is exactly when nobody wants to be guessing what's still running.

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

### The short version

```bash
npm run setup
```

It signs you in to Cloudflare, sets everything up, asks for your Stripe key,
and tells you exactly what to paste into Stripe. Follow the steps it prints.

### What it's actually doing, and why

Your Stripe secret key is like the key to your till. Anything the browser holds
can be read by anyone who opens the page, so the key can't live in the
dashboard — and Stripe won't accept it from a browser anyway.

So there's a small program in between, called the **relay**. Think of it as a
mailbox with your name on it that only you have the key to:

1. The relay holds your Stripe key. It lives on Cloudflare, not in the app.
2. Stripe posts each payment into the mailbox the moment it happens.
3. The dashboard checks the mailbox every fifteen seconds and shows what's new.

Nobody else can post into your mailbox, because Stripe seals every delivery with
a secret only it and your relay know. Anything without that seal is thrown away
unread.

If you'd rather do it by hand, the same steps are below.

### 1. Deploy the relay

```bash
cd relay
npx wrangler kv namespace create BOARD    # paste the id into wrangler.toml under [[kv_namespaces]]
npx wrangler secret put STRIPE_SECRET_KEY # sk_live_… or sk_test_…
npx wrangler secret put SYNC_TOKEN        # any long random string you invent
npx wrangler deploy
```

Note the URL it prints — `https://stripe-sync.<you>.workers.dev`. Open
`https://…/health`; it should answer `{"ok":true, …}`.

Set `ALLOWED_ORIGINS` in `wrangler.toml` to the address you'll serve the app
from, so only your own page can call the relay.

### 2. Point Stripe at it

In the Stripe Dashboard: **Developers → Webhooks → Add endpoint**.

- **Endpoint URL** — `https://<your-relay>.workers.dev/stripe/webhook`
- **Events to send** — `charge.succeeded`, `charge.failed`, `charge.refunded`,
  `checkout.session.completed`, `invoice.payment_succeeded`,
  `invoice.payment_failed`

Stripe then shows a **signing secret** starting `whsec_`. Give it to the relay
and redeploy:

```bash
npx wrangler secret put STRIPE_WEBHOOK_SECRET   # the whsec_… value
npx wrangler deploy
```

That secret is what makes the webhook safe. The URL is public — anyone can POST
to it — so every delivery is checked against the signature Stripe computes with
this secret, and anything that doesn't verify is dropped before it is read. A
delivery more than five minutes old is refused too, so a captured one can't be
replayed. Without the secret set, the relay refuses every delivery rather than
trusting it.

Check `https://…/health` again — it should now say `"webhook": true`.

### 3. Point the app at the relay

```bash
cp .env.example .env      # set VITE_RELAY_URL=https://<your-relay>.workers.dev
npm run build             # deploy dist/ wherever you host it
```

Create a login for yourself and anyone else who works orders:

```bash
node relay/adduser.mjs https://<your-relay>.workers.dev you@yourcompany.com "Your Name"
```

Sign in, open **Settings**, and you should see *Stripe is pushing payments here*
in green. Then map each product's Stripe ID under **Products** so orders land in
the right group.

### How fast "real time" actually is

With the webhook set up, a payment reaches the relay in about a second, and an
open browser picks it up within fifteen. Settings shows which mode you're in:

| | Where orders come from | Delay before you see one |
|---|---|---|
| Webhook configured | Stripe pushes as it happens | **~15 seconds** |
| No webhook | The app asks Stripe on a timer | up to your *Check every* interval |

The relay keeps pushed payments for seven days and hands out anything newer than
what the board already has, so closing the browser overnight loses nothing.

Pressing **Sync** does something extra: it also queries the Stripe API directly
and merges anything missing. That's the reconcile for a webhook outage — Stripe
retries failed deliveries for up to three days, but if something is genuinely
lost, this is what recovers it.

### Trying it before real money moves

Use Stripe's test mode (`sk_test_…`) and its CLI:

```bash
stripe listen --forward-to https://<your-relay>.workers.dev/stripe/webhook
stripe trigger charge.succeeded
```

The order should appear on the board within about fifteen seconds. If it
doesn't, check the webhook's delivery log in the Stripe Dashboard — a `400`
there means the signing secret on the Worker doesn't match the one Stripe is
signing with.

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
