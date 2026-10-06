# Thrive Finance

A private bank and accounting dashboard for **Thrive Companies** (life insurance brokerage) and **Lead Tech** (lead generation). It connects to your banks, cards and brokerages through [Plaid](https://plaid.com).

| Page | What it shows |
|---|---|
| **Overview** (home) | Both companies together: cash, investments, net worth, monthly money in / out, net cash flow by company, spending and income by category, top payers and payees, and a month-by-category spending table |
| **Thrive Companies** / **Lead Tech** | The same dashboard for one company, plus that company's KPI snapshot. Switch between the three with the selector at the top. |
| **Transactions** | Search and filter by company, month, category and direction. Re-categorize one transaction or many at once, or turn one into a rule. Export to CSV. |
| **Investments** | Holdings, allocation, gain or loss against cost basis, and portfolio value over time for each company |
| **Business KPIs** | A monthly grid of business numbers, with calculated KPIs and their trends (see below) |
| **Banks & Settings** | Connect banks, assign accounts to a company, manage categories and rules, sync history, demo data |

## Quick start

```bash
cd finance-dashboard
npm install
cp .env.example .env        # then fill it in (see below)
npm run build && npm start  # http://localhost:3000
```

For local development, use `npm run dev`.

Set at least `APP_PASSWORD` and `APP_SECRET` (generate the secret with `openssl rand -hex 32`). Then sign in and click **Explore with demo data** to try every screen before you connect a real bank. Clear the demo data under *Banks & Settings* before you go live.

## Connecting Plaid

1. Create a Plaid account. Copy your `client_id` and secret from **Dashboard → Developers → Keys** into `PLAID_CLIENT_ID` and `PLAID_SECRET`.
2. Start with `PLAID_ENV=sandbox`. In Plaid Link, pick any bank and sign in with `user_good` / `pass_good` to get fake data.
3. When you're ready for real accounts, request **Production** access for the **Transactions** and **Investments** products, swap in the production secret, and set `PLAID_ENV=production`.
4. Go to **Banks & Settings**, pick the company, and click **Connect with Plaid**. If one bank login holds accounts for both companies, connect it once and use the dropdown on each account to move it. Its transactions move with it.

### How data stays up to date

- **Real time:** set `PLAID_WEBHOOK_URL` to `https://<your-domain>/api/plaid/webhook`. Plaid then notifies the app as soon as new transactions post (`SYNC_UPDATES_AVAILABLE`), and the app pulls them in within minutes. Webhooks are checked against Plaid's signature before they are trusted.
- **Scheduled:** a full refresh of balances, transactions and investment holdings runs on `SYNC_CRON`. The default is 7am and 7pm (`0 7,19 * * *`) in the `TZ` time zone. Each run also saves a daily investment-value snapshot, which feeds the trend chart.
- **On demand:** the **Sync now** button.

If a bank needs you to sign in again, a red banner appears. Click **Reconnect** on that bank in Settings to fix it.

## Categories and rules

Every transaction gets a category:

1. **Set by hand.** This always wins and is never overwritten.
2. **Set by a rule.** A rule matches text in the merchant or description. Separate alternatives with `|`, for example `facebk|meta ads`. A rule can be limited to one company and to money in or money out. Newest rules are checked first. Saving a rule re-files past transactions too.
3. **Plaid's own category**, mapped onto the business categories (Advertising & Lead Gen, Agent Payouts, Commission Income, Lead Sales, Software & SaaS, and so on).

Starter rules are included for common carriers, ad platforms, payroll and SaaS vendors. Categories marked **Transfer** (moving money between your own accounts, credit card payments) are left out of income and spending totals so nothing is counted twice.

## Business KPIs

Enter each month's activity numbers on the KPIs page. The dollar rows fill in automatically from your categorized bank transactions, and you can type over any of them.

**Thrive Companies:** applications submitted, policies issued, submitted and issued annual premium (AP), active agents, new agents and 13-month persistency. Commissions received, agent payouts, chargebacks and lead purchases come from the bank. From these it calculates:

- placement rate
- average premium per policy
- AP per agent
- net (house) commission
- chargeback ratio
- lead cost per issued policy

**Lead Tech:** leads generated, sold and returned, active buyers and live transfers. Lead revenue, ad spend, payroll and software come from the bank. From these it calculates:

- cost per lead
- revenue per lead sold
- sell-through
- return rate
- return on ad spend (ROAS)
- gross profit

To add or change a KPI, edit `src/lib/metrics.ts`.

## Security notes

- The whole app is behind a password. Failed sign-ins are rate limited, and the session cookie is HMAC-signed and HTTP-only.
- Plaid access tokens are encrypted at rest with AES-256-GCM, using a key derived from `APP_SECRET`. If you lose `APP_SECRET`, you'll have to reconnect every bank.
- All data lives in one SQLite file (`DATABASE_PATH`, default `./data/finance.db`). Back it up, and never commit it (it is already in `.gitignore`).
- Serve the app over HTTPS in production.

## Deploying

The app needs a **long-running Node server with a persistent disk**, because of the SQLite file and the built-in scheduler. Good fits are a small VPS, Railway, Render (with a disk) or Fly.io (with a volume). Serverless hosts like Vercel are not a good fit unless you swap in a hosted database and an external cron job that calls `POST /api/sync`.

## Project layout

```
src/
  app/(app)/          pages: overview, [entity], transactions, investments, kpis, settings
  app/api/            JSON endpoints (Plaid link/exchange/webhook, sync, rules, categories, metrics…)
  components/         dashboard view, charts (Recharts), tables, settings widgets
  lib/db.ts           SQLite schema + migrations
  lib/sync.ts         Plaid transactions/sync, balances, holdings
  lib/categorize.ts   rule engine
  lib/analytics.ts    all dashboard queries
  lib/metrics.ts      KPI definitions
  lib/scheduler.ts    twice-daily cron
  proxy.ts            sign-in gate
```
