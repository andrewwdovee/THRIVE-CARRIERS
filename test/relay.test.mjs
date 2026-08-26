import worker from "../relay/src/index.js";

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { cond ? (pass++, console.log("  ok  " + name)) : (fail++, console.log("  FAIL " + name, extra ?? "")); };

/* ── mock Stripe ── */
const CHARGE = {
  id: "ch_3abc", payment_intent: "pi_3abc", status: "succeeded", refunded: false,
  amount: 49700, currency: "usd", created: 1756200000, receipt_url: "https://pay.stripe.com/r/abc",
  invoice: "in_123", description: "Google Calls Subscription",
  payment_method: "pm_1", payment_method_details: { type: "card", card: { brand: "visa", last4: "4242", exp_month: 7, exp_year: 2029 } },
  billing_details: { name: "Tanya Alvarez", email: "t@example.com" },
  customer: { id: "cus_9", name: "Tanya Alvarez", email: "t@example.com", phone: "+17275551234" },
  metadata: {}, outcome: {},
};
const INVOICE = { id: "in_123", subscription: "sub_77", lines: { data: [
  { description: "Google Calls Subscription", quantity: 1, amount: 49700,
    price: { id: "price_abc", product: "prod_xyz", nickname: "Google Calls", recurring: { interval: "month", interval_count: 1 } } },
]}};

global.fetch = async (url) => {
  const u = String(url);
  const body = u.includes("/charges") ? { data: [CHARGE] }
    : u.includes("/invoices/in_123") ? INVOICE
    : u.includes("/subscriptions/sub_77") ? { id: "sub_77", status: "active" }
    : null;
  if (!body) return new Response("no", { status: 404 });
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
};

const env = { STRIPE_SECRET_KEY: "sk_test_x", SYNC_TOKEN: "s3cret", ALLOWED_ORIGINS: "*" };
const call = (path, opts = {}) => worker.fetch(new Request("https://relay.test" + path, opts), opts.env || env);

console.log("relay:");
let r = await call("/health");
ok("health is open", r.status === 200);

r = await call("/orders");
ok("no token -> 401", r.status === 401, r.status);

r = await call("/orders", { headers: { Authorization: "Bearer wrong" } });
ok("wrong token -> 401", r.status === 401, r.status);

r = await call("/orders", { headers: { Authorization: "Bearer s3cret" }, env: { ...env, SYNC_TOKEN: "" } });
ok("unset token stays locked", r.status === 401, r.status);

r = await call("/orders?since=1756100000", { headers: { Authorization: "Bearer s3cret" } });
ok("authed -> 200", r.status === 200, r.status);
const rows = await r.json();
ok("one order back", Array.isArray(rows) && rows.length === 1, rows);
const o = rows[0];
ok("charge id", o.chargeId === "ch_3abc");
ok("payment intent", o.paymentId === "pi_3abc");
ok("price id off invoice", o.priceId === "price_abc", o.priceId);
ok("product id off invoice", o.stripeProductId === "prod_xyz", o.stripeProductId);
ok("subscription resolved", o.subscriptionId === "sub_77" && o.subscriptionStatus === "active", o);
ok("interval", o.interval === "month");
ok("line items", o.items.length === 1 && o.items[0].amount === 49700);

r = await call("/kv/board", { method: "GET", headers: { Authorization: "Bearer s3cret" } });
ok("kv without binding -> 501", r.status === 501, r.status);

const store = new Map();
const kvEnv = { ...env, BOARD: { get: async (k) => store.get(k) ?? null, put: async (k, v) => store.set(k, v), delete: async (k) => store.delete(k) } };
r = await call("/kv/board", { headers: { Authorization: "Bearer s3cret" }, env: kvEnv });
ok("kv miss -> 404", r.status === 404, r.status);
r = await call("/kv/board", { method: "PUT", headers: { Authorization: "Bearer s3cret", "Content-Type": "application/json" }, body: JSON.stringify({ value: '{"orders":[]}' }), env: kvEnv });
ok("kv put -> 200", r.status === 200, r.status);
r = await call("/kv/board", { headers: { Authorization: "Bearer s3cret" }, env: kvEnv });
ok("kv round-trips", (await r.json()).value === '{"orders":[]}');
r = await call("/kv/board", { method: "PUT", headers: { Authorization: "Bearer s3cret", "Content-Type": "application/json" }, body: JSON.stringify({ value: 42 }), env: kvEnv });
ok("kv rejects non-string -> 400", r.status === 400, r.status);

r = await call("/orders", { method: "OPTIONS" });
ok("preflight open", r.status === 204 && r.headers.get("Access-Control-Allow-Origin") === "*");

r = await call("/nope", { headers: { Authorization: "Bearer s3cret" } });
ok("unknown route -> 404", r.status === 404);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
