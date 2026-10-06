import { db } from "./db";

/** Demo items are marked with this access token so the sync job skips them. */
export const DEMO_TOKEN = "demo";

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

export function hasDemoData(): boolean {
  return Boolean(db().prepare("SELECT 1 FROM plaid_items WHERE access_token_enc = ?").get(DEMO_TOKEN));
}

export function clearDemoData() {
  const d = db();
  d.transaction(() => {
    const items = d.prepare("SELECT item_id FROM plaid_items WHERE access_token_enc = ?").all(DEMO_TOKEN) as { item_id: string }[];
    for (const { item_id } of items) {
      const accts = d.prepare("SELECT account_id FROM accounts WHERE item_id = ?").all(item_id) as { account_id: string }[];
      for (const { account_id } of accts) {
        d.prepare("DELETE FROM transactions WHERE account_id = ?").run(account_id);
        d.prepare("DELETE FROM holdings WHERE account_id = ?").run(account_id);
        d.prepare("DELETE FROM balance_snapshots WHERE account_id = ?").run(account_id);
      }
      d.prepare("DELETE FROM accounts WHERE item_id = ?").run(item_id);
      d.prepare("DELETE FROM plaid_items WHERE item_id = ?").run(item_id);
    }
    // Snapshots and hand-entered metrics aren't tied to an item; only wipe them when no real banks are linked.
    const real = d.prepare("SELECT COUNT(*) AS n FROM plaid_items").get() as { n: number };
    if (real.n === 0) {
      d.prepare("DELETE FROM investment_snapshots").run();
      d.prepare("DELETE FROM business_metrics").run();
    }
  })();
}

export function loadDemoData() {
  clearDemoData();
  const d = db();
  const r = rng(42);
  const cat = new Map(
    (d.prepare("SELECT id, name FROM categories").all() as { id: number; name: string }[]).map((c) => [c.name, c.id]),
  );
  const now = new Date();
  const iso = (dt: Date) => dt.toISOString().slice(0, 10);

  d.transaction(() => {
    const insItem = d.prepare(
      "INSERT INTO plaid_items (item_id, entity_id, access_token_enc, institution_id, institution_name, has_investments, last_synced_at) VALUES (?, ?, ?, 'demo', ?, ?, datetime('now'))",
    );
    insItem.run("demo-thrive-bank", "thrive", DEMO_TOKEN, "Chase (demo)", 0);
    insItem.run("demo-thrive-brokerage", "thrive", DEMO_TOKEN, "Charles Schwab (demo)", 1);
    insItem.run("demo-leadtech-bank", "leadtech", DEMO_TOKEN, "Mercury (demo)", 1);
    insItem.run("demo-leadtech-card", "leadtech", DEMO_TOKEN, "American Express (demo)", 0);

    const insAcct = d.prepare(
      `INSERT INTO accounts (account_id, item_id, entity_id, name, mask, type, subtype, current_balance, available_balance, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    );
    insAcct.run("demo-th-chk", "demo-thrive-bank", "thrive", "Business Complete Checking", "4821", "depository", "checking", 184_220.41, 182_900.12);
    insAcct.run("demo-th-sav", "demo-thrive-bank", "thrive", "Business Savings", "9930", "depository", "savings", 250_000, 250_000);
    insAcct.run("demo-th-cc", "demo-thrive-bank", "thrive", "Ink Business Preferred", "1188", "credit", "credit card", 12_480.77, null);
    insAcct.run("demo-th-brk", "demo-thrive-brokerage", "thrive", "Business Brokerage", "7712", "investment", "brokerage", 412_380.5, null);
    insAcct.run("demo-lt-chk", "demo-leadtech-bank", "leadtech", "Mercury Checking", "0042", "depository", "checking", 96_315.08, 96_315.08);
    insAcct.run("demo-lt-tre", "demo-leadtech-bank", "leadtech", "Mercury Treasury", "0043", "investment", "brokerage", 150_870.22, null);
    insAcct.run("demo-lt-cc", "demo-leadtech-card", "leadtech", "Amex Business Platinum", "3007", "credit", "credit card", 38_910.4, null);

    const insTx = d.prepare(
      `INSERT INTO transactions (transaction_id, account_id, entity_id, date, name, merchant_name, amount, category_id, category_source, pending)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'auto', ?)`,
    );
    let n = 0;
    const tx = (acct: string, entity: string, date: Date, name: string, merchant: string | null, amount: number, category: string) => {
      if (date > now || amount === 0) return;
      const pending = (now.getTime() - date.getTime()) / 86400000 < 2 ? 1 : 0;
      insTx.run(`demo-tx-${++n}`, acct, entity, iso(date), name, merchant, Math.round(amount * 100) / 100, cat.get(category) ?? null, pending);
    };

    const carriers = ["Mutual of Omaha", "Americo", "Corebridge Financial", "Transamerica", "Aetna CVS Health", "Foresters Financial"];
    const buyers = ["Thrive Companies", "Senior Benefit Partners", "Family First Life", "Integrity Agency Group", "Legacy Brokerage"];

    for (let m = 12; m >= 0; m--) {
      const first = new Date(now.getFullYear(), now.getMonth() - m, 1);
      const y = first.getFullYear();
      const mo = first.getMonth();
      const growth = 1 + (12 - m) * 0.035; // business grows over the year
      const day = (dd: number) => new Date(y, mo, dd);

      // ---------- Thrive Companies (brokerage)
      for (const wk of [3, 10, 17, 24]) {
        for (const c of carriers) {
          if (r() < 0.35) continue;
          tx("demo-th-chk", "thrive", day(wk + Math.floor(r() * 3)), `${c.toUpperCase()} COMM PMT`, c, (3000 + r() * 9000) * growth, "Commission Income");
        }
        tx("demo-th-chk", "thrive", day(wk + 1), "ACH AGENT PAYOUTS BATCH", "Agent Payouts", -(9000 + r() * 6000) * growth, "Agent Payouts & Overrides");
      }
      if (r() < 0.7)
        tx("demo-th-chk", "thrive", day(12), "AMERICO COMM ADJ CHARGEBACK", "Americo", -(800 + r() * 2600), "Commission Chargebacks");
      if (r() < 0.5)
        tx("demo-th-chk", "thrive", day(21), "MUTUAL OF OMAHA CHARGEBACK", "Mutual of Omaha", -(500 + r() * 1800), "Commission Chargebacks");
      tx("demo-th-chk", "thrive", day(5), "LEADTECH LLC LEAD INVOICE", "Lead Tech", -(14000 + r() * 4000) * growth, "Lead Purchases");
      tx("demo-th-chk", "thrive", day(1), "OFFICE LEASE - SUITE 400", "Regus", -6200, "Rent & Utilities");
      tx("demo-th-chk", "thrive", day(15), "GUSTO PAYROLL", "Gusto", -(18500 + r() * 1500), "Payroll & Contractors");
      tx("demo-th-chk", "thrive", day(28), "GUSTO PAYROLL", "Gusto", -(18500 + r() * 1500), "Payroll & Contractors");
      tx("demo-th-cc", "thrive", day(3), "RINGCENTRAL INC", "RingCentral", -840, "Software & SaaS");
      tx("demo-th-cc", "thrive", day(4), "GOHIGHLEVEL", "HighLevel", -497, "Software & SaaS");
      tx("demo-th-cc", "thrive", day(9), "GOOGLE WORKSPACE", "Google Workspace", -312, "Software & SaaS");
      tx("demo-th-cc", "thrive", day(11), "NIPR LICENSE RENEWALS", "NIPR", -(150 + r() * 600), "Licensing & E&O Insurance");
      tx("demo-th-cc", "thrive", day(18), "UBER EATS", "Uber Eats", -(120 + r() * 300), "Meals & Entertainment");
      tx("demo-th-cc", "thrive", day(22), "DELTA AIR LINES", "Delta", -(r() < 0.4 ? 1400 + r() * 1200 : 0), "Travel");
      tx("demo-th-chk", "thrive", day(25), "CHASE CARD AUTOPAY", null, -(4000 + r() * 2000), "Credit Card Payment");
      tx("demo-th-cc", "thrive", day(25), "AUTOPAY PAYMENT THANK YOU", null, 4000 + r() * 2000, "Credit Card Payment");
      tx("demo-th-sav", "thrive", day(28), "INTEREST PAYMENT", null, 780 + r() * 120, "Interest & Dividends");
      if (mo % 3 === 0) tx("demo-th-chk", "thrive", day(15), "IRS USATAXPYMT", "IRS", -(22000 + r() * 6000), "Taxes");
      if (r() < 0.5) tx("demo-th-chk", "thrive", day(27), "OWNER DRAW TRANSFER", null, -15000, "Owner Draws");

      // ---------- Lead Tech (lead gen)
      for (const wk of [2, 9, 16, 23, 30]) {
        for (const b of buyers) {
          if (r() < 0.3) continue;
          tx("demo-lt-chk", "leadtech", day(Math.min(wk + Math.floor(r() * 2), 28)), `STRIPE TRANSFER ${b.toUpperCase()}`, b, (2500 + r() * 6500) * growth, "Lead Sales");
        }
      }
      for (const dd of [1, 8, 15, 22]) {
        tx("demo-lt-cc", "leadtech", day(dd), "FACEBK ADS", "Meta Ads", -(6500 + r() * 3500) * growth, "Advertising & Lead Gen");
        tx("demo-lt-cc", "leadtech", day(dd + 2), "GOOGLE ADS", "Google Ads", -(3000 + r() * 2000) * growth, "Advertising & Lead Gen");
      }
      tx("demo-lt-cc", "leadtech", day(12), "TIKTOK ADS", "TikTok Ads", -(1200 + r() * 1800), "Advertising & Lead Gen");
      tx("demo-lt-chk", "leadtech", day(14), "DEEL INC CONTRACTORS", "Deel", -(12000 + r() * 3000), "Payroll & Contractors");
      tx("demo-lt-chk", "leadtech", day(28), "DEEL INC CONTRACTORS", "Deel", -(12000 + r() * 3000), "Payroll & Contractors");
      tx("demo-lt-cc", "leadtech", day(3), "TWILIO", "Twilio", -(900 + r() * 700) * growth, "Software & SaaS");
      tx("demo-lt-cc", "leadtech", day(5), "AMAZON WEB SERVICES", "AWS", -(600 + r() * 300), "Software & SaaS");
      tx("demo-lt-cc", "leadtech", day(6), "TRUSTEDFORM / ACTIVEPROSPECT", "ActiveProspect", -750, "Software & SaaS");
      tx("demo-lt-chk", "leadtech", day(20), "STRIPE FEES", "Stripe", -(300 + r() * 200) * growth, "Bank & Merchant Fees");
      tx("demo-lt-chk", "leadtech", day(24), "AMEX EPAYMENT", null, -(35000 + r() * 8000), "Credit Card Payment");
      tx("demo-lt-cc", "leadtech", day(24), "PAYMENT RECEIVED - THANK YOU", null, 35000 + r() * 8000, "Credit Card Payment");
      tx("demo-lt-tre", "leadtech", day(28), "TREASURY YIELD", null, 520 + r() * 60, "Interest & Dividends");
      if (r() < 0.6) tx("demo-lt-chk", "leadtech", day(19), "LEAD RETURN CREDIT", "Family First Life", -(400 + r() * 900), "Other Expense");

      // ---------- Business metrics (manual inputs)
      const ym = `${y}-${String(mo + 1).padStart(2, "0")}`;
      const put = d.prepare(
        "INSERT INTO business_metrics (entity_id, month, metric, value) VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET value = excluded.value",
      );
      const apps = Math.round((70 + r() * 25) * growth);
      const issued = Math.round(apps * (0.62 + r() * 0.12));
      put.run("thrive", ym, "apps_submitted", apps);
      put.run("thrive", ym, "policies_issued", issued);
      put.run("thrive", ym, "submitted_ap", Math.round(apps * (1100 + r() * 300)));
      put.run("thrive", ym, "issued_ap", Math.round(issued * (1150 + r() * 300)));
      put.run("thrive", ym, "active_agents", Math.round(22 + (12 - m) * 1.2 + r() * 3));
      put.run("thrive", ym, "new_agents", Math.round(2 + r() * 5));
      put.run("thrive", ym, "persistency_13m", Math.round((78 + r() * 8) * 10) / 10);
      const gen = Math.round((5200 + r() * 1400) * growth);
      const sold = Math.round(gen * (0.7 + r() * 0.12));
      put.run("leadtech", ym, "leads_generated", gen);
      put.run("leadtech", ym, "leads_sold", sold);
      put.run("leadtech", ym, "leads_returned", Math.round(sold * (0.03 + r() * 0.04)));
      put.run("leadtech", ym, "active_buyers", Math.round(9 + (12 - m) * 0.4 + r() * 2));
      put.run("leadtech", ym, "transfers", Math.round(sold * 0.12));
    }

    // ---------- Investments
    const insSec = d.prepare(
      "INSERT OR REPLACE INTO securities (security_id, name, ticker, type, close_price, close_price_as_of) VALUES (?, ?, ?, ?, ?, ?)",
    );
    const insH = d.prepare(
      "INSERT OR REPLACE INTO holdings (account_id, security_id, quantity, institution_price, institution_value, cost_basis, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))",
    );
    const sec: [string, string, string, string, number][] = [
      ["demo-vti", "Vanguard Total Stock Market ETF", "VTI", "etf", 312.44],
      ["demo-voo", "Vanguard S&P 500 ETF", "VOO", "etf", 568.1],
      ["demo-bnd", "Vanguard Total Bond Market ETF", "BND", "etf", 73.85],
      ["demo-aapl", "Apple Inc.", "AAPL", "equity", 241.3],
      ["demo-msft", "Microsoft Corp.", "MSFT", "equity", 498.2],
      ["demo-cash", "Schwab Value Advantage Money Fund", "SWVXX", "cash", 1],
      ["demo-tbill", "US Treasury Bill 3M", null as unknown as string, "fixed income", 99.12],
    ];
    for (const s of sec) insSec.run(s[0], s[1], s[2], s[3], s[4], iso(now));
    const hold = (acct: string, id: string, qty: number, cost: number) => {
      const price = sec.find((s) => s[0] === id)![4];
      insH.run(acct, id, qty, price, Math.round(qty * price * 100) / 100, cost);
    };
    hold("demo-th-brk", "demo-vti", 420, 108_000);
    hold("demo-th-brk", "demo-voo", 260, 121_500);
    hold("demo-th-brk", "demo-bnd", 900, 67_200);
    hold("demo-th-brk", "demo-aapl", 80, 15_600);
    hold("demo-th-brk", "demo-msft", 40, 14_900);
    hold("demo-th-brk", "demo-cash", 31_390, 31_390);
    hold("demo-lt-tre", "demo-tbill", 1100, 107_800);
    hold("demo-lt-tre", "demo-cash", 41_838, 41_838);

    // value history: random walk back from today's value
    const insSnap = d.prepare(
      "INSERT OR REPLACE INTO investment_snapshots (entity_id, date, value, cost_basis) VALUES (?, ?, ?, NULL)",
    );
    const totals = d
      .prepare(
        "SELECT a.entity_id, SUM(h.institution_value) AS v FROM holdings h JOIN accounts a ON a.account_id = h.account_id GROUP BY a.entity_id",
      )
      .all() as { entity_id: string; v: number }[];
    const end = (e: string) => totals.find((t) => t.entity_id === e)?.v ?? 0;
    d.prepare("UPDATE accounts SET current_balance = (SELECT SUM(institution_value) FROM holdings h WHERE h.account_id = accounts.account_id) WHERE account_id IN ('demo-th-brk','demo-lt-tre')").run();
    for (const [entity, vol, drift] of [
      ["thrive", 0.009, 0.0006],
      ["leadtech", 0.0006, 0.0006],
    ] as [string, number, number][]) {
      let v = end(entity);
      for (let i = 0; i < 180; i++) {
        const dt = new Date(now.getTime() - i * 86400000);
        insSnap.run(entity, iso(dt), Math.round(v * 100) / 100);
        v = v / (1 + drift + (r() - 0.5) * 2 * vol);
        if (entity === "leadtech" && i === 60) v -= 40_000; // a deposit 60 days ago
      }
    }
  })();
}
