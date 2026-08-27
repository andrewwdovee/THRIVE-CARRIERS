import worker from "../relay/src/index.js";
import { verify, fromEvent, HANDLED } from "../relay/src/stripe-webhook.js";

let pass = 0, fail = 0;
const ok = (n, c, e) => { c ? (pass++, console.log("  ok  " + n)) : (fail++, console.log("  FAIL " + n, e ?? "")); };

const SECRET = "whsec_test_abc123";
const enc = new TextEncoder();
async function sign(body, secret = SECRET, t = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${body}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `t=${t},v1=${hex}`;
}

function kv() {
  const m = new Map();
  return {
    get: async (k) => m.get(k)?.val ?? null,
    put: async (k, val, o) => m.set(k, { val, ttl: o?.expirationTtl }),
    delete: async (k) => m.delete(k),
    list: async ({ prefix }) => ({ keys: [...m.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name })), list_complete: true }),
    _map: m,
  };
}

const CHARGE = (over = {}) => JSON.stringify({
  id: "evt_1", type: "charge.succeeded",
  data: { object: {
    id: "ch_live_1", payment_intent: "pi_live_1", status: "succeeded",
    amount: 49700, currency: "usd", created: Math.floor(Date.now() / 1000),
    description: "Google Calls Subscription", receipt_url: "https://pay.stripe.com/r/x",
    billing_details: { name: "Real Customer", email: "real@example.com" },
    payment_method_details: { type: "card", card: { brand: "visa", last4: "4242", exp_month: 4, exp_year: 2030 } },
    customer: "cus_live", metadata: {}, outcome: {},
    ...over,
  } },
});

console.log("webhook signature:");
let body = CHARGE();
let r = await verify(body, await sign(body), SECRET);
ok("a genuine signature verifies", r.ok, r.reason);

r = await verify(body, await sign(body, "whsec_wrong_secret"), SECRET);
ok("signed with the wrong secret is rejected", !r.ok, r);

r = await verify(body + " ", await sign(body), SECRET);
ok("a tampered body is rejected", !r.ok, r);

r = await verify(body, await sign(body, SECRET, Math.floor(Date.now() / 1000) - 3600), SECRET);
ok("an hour-old delivery is rejected (replay)", !r.ok && /tolerance/i.test(r.reason), r);

r = await verify(body, null, SECRET);
ok("no signature header is rejected", !r.ok);
r = await verify(body, "v1=deadbeef", SECRET);
ok("header with no timestamp is rejected", !r.ok);
r = await verify(body, await sign(body), "");
ok("unset secret rejects everything", !r.ok);

const t = Math.floor(Date.now() / 1000);
const good = (await sign(body, SECRET, t)).split("v1=")[1];
r = await verify(body, `t=${t},v1=0000000000000000000000000000000000000000000000000000000000000000,v1=${good}`, SECRET);
ok("accepts one of several v1s (secret rotation)", r.ok, r.reason);

console.log("\nwebhook endpoint:");
let BOARD = kv();
const env = { STRIPE_WEBHOOK_SECRET: SECRET, SYNC_TOKEN: "owner-token", STRIPE_SECRET_KEY: "sk_test", ALLOWED_ORIGINS: "*", BOARD };
const post = (b, sig, e) => worker.fetch(new Request("https://relay.test/stripe/webhook", {
  method: "POST", headers: sig ? { "Stripe-Signature": sig, "Content-Type": "application/json" } : {}, body: b,
}), e || env);

let res = await post(body, "t=1,v1=bad");
ok("forged delivery -> 400", res.status === 400, res.status);
ok("nothing stored from a forgery", BOARD._map.size === 0, BOARD._map.size);

res = await post(body, await sign(body));
ok("genuine delivery -> 200", res.status === 200, res.status);
ok("payment stored", BOARD._map.size === 1, [...BOARD._map.keys()]);

res = await post(body, await sign(body));
ok("Stripe's retry overwrites, doesn't duplicate", BOARD._map.size === 1, BOARD._map.size);

const other = JSON.stringify({ id: "evt_2", type: "customer.updated", data: { object: { id: "cus_x" } } });
res = await post(other, await sign(other));
ok("an event we don't act on is acknowledged, not errored", res.status === 200, res.status);
ok("and not stored", BOARD._map.size === 1, BOARD._map.size);

const failed = CHARGE({ id: "ch_live_2", status: "failed", failure_code: "card_declined", failure_message: "Your card was declined." });
const failedEvt = failed.replace('"charge.succeeded"', '"charge.failed"');
res = await post(failedEvt, await sign(failedEvt));
ok("a declined charge is stored too", BOARD._map.size === 2, BOARD._map.size);

console.log("\nfeeding the board:");
const asOwner = { Authorization: "Bearer owner-token" };
res = await worker.fetch(new Request("https://relay.test/orders?since=1", { headers: asOwner }), env);
const rows = await res.json();
ok("orders returns what Stripe pushed", rows.length === 2, rows.length);
const one = rows.find((o) => o.id === "ch_live_1");
ok("amount carried", one.amount === 49700);
ok("customer carried", one.billing_details.name === "Real Customer");
ok("card carried", one.payment_method_details.card.last4 === "4242");
ok("product name carried", one.productName === "Google Calls Subscription");
const bad = rows.find((o) => o.id === "ch_live_2");
ok("decline reason carried", bad.paymentStatus === "failed" && /declined/i.test(bad.declineReason), bad);

let calls = 0;
global.fetch = async () => { calls++; return new Response(JSON.stringify({ data: [] }), { status: 200 }); };
await worker.fetch(new Request("https://relay.test/orders?since=1", { headers: asOwner }), env);
ok("a routine poll does NOT call Stripe when webhooks are live", calls === 0, calls);
await worker.fetch(new Request("https://relay.test/orders?since=1&backfill=1", { headers: asOwner }), env);
ok("an explicit backfill does call Stripe", calls === 1, calls);

const noHook = { ...env, STRIPE_WEBHOOK_SECRET: "" };
calls = 0;
await worker.fetch(new Request("https://relay.test/orders?since=1", { headers: asOwner }), noHook);
ok("without a webhook it still polls Stripe as before", calls === 1, calls);

ok("health advertises the webhook", (await (await worker.fetch(new Request("https://relay.test/health"), env)).json()).webhook === true);
ok("health says no webhook when the secret is unset", (await (await worker.fetch(new Request("https://relay.test/health"), noHook)).json()).webhook === false);

res = await post(body, await sign(body), { ...env, BOARD: undefined });
ok("no KV -> 501, not a silent drop", res.status === 501, res.status);

ok("the events we act on", HANDLED.has("charge.succeeded") && HANDLED.has("checkout.session.completed") && !HANDLED.has("customer.created"));
ok("fromEvent ignores an empty event", fromEvent({ type: "charge.succeeded", data: {} }) === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
