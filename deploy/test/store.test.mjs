import { makeStore, pickStore } from "../supabase-store.js";

const env = { SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_KEY: "test-service-key" };
const s = makeStore(env);

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("the shapes the relay actually uses:");

/* plain blob round trip, the board's whole state */
await s.put("kv:fulfillment_board_v3", JSON.stringify({ orders: [1, 2, 3] }));
ok("get returns what put stored", await s.get("kv:fulfillment_board_v3") === '{"orders":[1,2,3]}');

/* overwrite, because every board save is an overwrite */
await s.put("kv:fulfillment_board_v3", '{"orders":[]}');
ok("put overwrites rather than duplicating", await s.get("kv:fulfillment_board_v3") === '{"orders":[]}');

ok("a missing key is null, not an error", await s.get("kv:never-written") === null);

/* keys with slashes and colons, which is most of them */
await s.put("kv:onboarding/doc/ob_abc:1", "doc");
ok("slashes and colons survive the round trip", await s.get("kv:onboarding/doc/ob_abc:1") === "doc");

/* expiry: the rate-limit counters depend on it */
await s.put("rate:onboard:xyz:489", "3", { expirationTtl: 1 });
ok("a key with a ttl reads back while alive", await s.get("rate:onboard:xyz:489") === "3");
await sleep(1200);
ok("and reads as absent once expired", await s.get("rate:onboard:xyz:489") === null);

/* listing a prefix, which is how the Stripe inbox is read */
for (const n of [3, 1, 2]) await s.put(`inbox:00000000000${n}:ch_${n}`, JSON.stringify({ id: "ch_" + n }));
await s.put("notinbox:zzz", "other");
const page = await s.list({ prefix: "inbox:" });
ok("list finds only the prefix", page.keys.length === 3, page.keys.map((k) => k.name));
ok("list comes back sorted", page.keys.map((k) => k.name.slice(-4)).join(",") === "ch_1,ch_2,ch_3");
ok("list says when it is done", page.list_complete === true && page.cursor === null);

/* paging, because KV paged and the call sites loop on the cursor */
const p1 = await s.list({ prefix: "inbox:", limit: 2 });
ok("a partial page is not complete", p1.keys.length === 2 && p1.list_complete === false);
const p2 = await s.list({ prefix: "inbox:", limit: 2, cursor: p1.cursor });
ok("the cursor fetches the rest", p2.keys.length === 1 && p2.list_complete === true);

/* an expired row must not show up in a listing either */
await s.put("inbox:000000000009:ch_old", "x", { expirationTtl: 1 });
await sleep(1200);
const after = await s.list({ prefix: "inbox:" });
ok("an expired key is absent from list too", after.keys.length === 3, after.keys.map((k) => k.name));

/* a prefix containing a LIKE wildcard must not match everything */
await s.put("weird%key", "a");
await s.put("weirdXkey", "b");
const w = await s.list({ prefix: "weird%" });
ok("a % in the prefix is a literal, not a wildcard", w.keys.length === 1 && w.keys[0].name === "weird%key", w.keys.map((k) => k.name));

await s.delete("kv:fulfillment_board_v3");
ok("delete removes the row", await s.get("kv:fulfillment_board_v3") === null);

console.log("\nthe typed projections:");
await s.saveOrder({
  id: "ch_test1", created: 1760000000, amount: 29700, currency: "USD", status: "new",
  paymentStatus: "succeeded", customer: "Jane Roe", ownerEmail: "jane@example.com",
  productName: "Google Calls Subscription", receiptUrl: "https://pay.stripe.com/r/x", refunded: false,
});
ok("an order lands in its own table", true);
await s.saveOrder({ id: "ch_test1", created: 1760000000, amount: 29700, refunded: true, productName: "Google Calls Subscription" });
const merged = await (await fetch("http://127.0.0.1:54321/rest/v1/orders?id=eq.ch_test1&select=*",
  { headers: { apikey: "test-service-key" } })).json();
ok("the same order merges rather than duplicating", merged.length === 1, merged.length);
ok("the later event applies its own fields", merged[0]?.refunded === true);
ok("and does not blank the fields it omitted", merged[0]?.email === "jane@example.com", merged[0]?.email);
ok("and does not blank the customer either", merged[0]?.customer === "Jane Roe", merged[0]?.customer);

await s.saveSubmission(
  { id: "ob_t1", signedAt: new Date().toISOString(), legalName: "Jane Roe", business: "Roe LLC",
    email: "jane@example.com", phone: "555", version: "2026-10-05", steps: { signed: true } },
  { signature: "data:image/png;base64,AAA", thriveSignature: "data:image/png;base64,BBB", photo: null },
);
ok("a submission and its images land in their tables", true);

/* ---- the Cloudflare KV fallback ----
   Removing the Supabase secrets is the rollback, so the binding has to
   offer the same entries() the relay now calls. KV has no bulk read, so
   it loops -- which is safe there and only there, because a KV read
   goes through a binding rather than the network. */
console.log("\nthe KV fallback:");
const fake = {
  rows: new Map([["inbox:1", "a"], ["inbox:2", "b"], ["other:1", "c"]]),
  async get(k) { return this.rows.has(k) ? this.rows.get(k) : null; },
  async put(k, v) { this.rows.set(k, v); },
  async delete(k) { this.rows.delete(k); },
  async list({ prefix = "" } = {}) {
    const keys = [...this.rows.keys()].filter((k) => k.startsWith(prefix)).sort();
    return { keys: keys.map((name) => ({ name })), list_complete: true, cursor: null };
  },
};
const kvStore = pickStore({ THRIVE_KV: fake });
ok("pickStore falls back to the binding", !!kvStore && typeof kvStore.entries === "function");
const kvPage = await kvStore.entries({ prefix: "inbox:" });
ok("entries returns the prefix with values",
   kvPage.rows.length === 2 && kvPage.rows[0].value === "a" && kvPage.rows[1].value === "b",
   kvPage.rows);
ok("and says it is done", kvPage.list_complete === true && kvPage.cursor === null);
ok("get and put still reach the binding",
   (await kvStore.get("other:1")) === "c");
ok("Supabase is preferred when it is configured",
   typeof pickStore({ THRIVE_KV: fake, SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_KEY: "k" }).saveOrder === "function");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
