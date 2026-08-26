# Fulfillment Desk

Two screens over one order database.

- **Fulfillment Desk** (`#/desk`) — the working board. Orders arrive from Stripe,
  move across four lanes, carry a per-product checklist, and alert whoever has
  the window open.
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
relay/                 Cloudflare Worker: holds the Stripe key, serves /orders
test/                  node test suites
```

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
one record, give the relay a KV namespace and point the app at it:

```bash
cd relay
npx wrangler kv namespace create BOARD    # uncomment [[kv_namespaces]] in wrangler.toml, paste the id
npx wrangler deploy
```

```bash
cp .env.example .env    # then fill in VITE_STORAGE_URL and VITE_STORAGE_TOKEN
```

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

Both screens are the same bundle at different hashes, and there is no login: the
`#/desk` URL is a starting point, not a permission boundary — anyone who has it
can reach `#/admin` too. If the Console needs to be off limits, put the whole app
behind your host's access control (Cloudflare Access, Netlify password
protection, a VPN) rather than relying on the URL.
