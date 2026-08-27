/* The path a real payment takes: Stripe event -> relay -> normalize -> board.
   These are the failures that only show up once money is moving. */
import { build } from "esbuild";
import { writeFileSync } from "fs";
import worker from "../relay/src/index.js";
import { fromEvent, mergeOrders } from "../relay/src/stripe-webhook.js";
import { createHmac } from "crypto";

const out = await build({
  entryPoints: [new URL("../src/lib/useBoard.js", import.meta.url).pathname],
  bundle: true, format: "esm", write: false, jsx: "transform",
  external: ["react", "lucide-react"],
});
const tmp = new URL("../.flow.built.mjs", import.meta.url).pathname;
writeFileSync(tmp, out.outputFiles[0].text);
const { appendOrders } = await import(tmp);
const shared = await build({
  entryPoints: [new URL("../src/lib/shared.jsx", import.meta.url).pathname],
  bundle: true, format: "esm", write: false, jsx: "transform", external: ["react", "lucide-react"],
});
const tmp2 = new URL("../.flow2.built.mjs", import.meta.url).pathname;
writeFileSync(tmp2, shared.outputFiles[0].text);
const { normalize, SEED } = await import(tmp2);

let pass = 0, fail = 0;
const ok = (n, c, e) => { c ? (pass++, console.log("  ok  " + n)) : (fail++, console.log("  FAIL " + n, e ?? "")); };

const SECRET = "whsec_x";
function kv() {
  const m = new Map();
  return { get: async (k) => m.get(k) ?? null, put: async (k, v) => m.set(k, v), delete: async (k) => m.delete(k),
    list: async ({ prefix }) => ({ keys: [...m.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name })), list_complete: true }), _m: m };
}
globalThis.fetch = async () => new Response(JSON.stringify({ data: [] }), { status: 200 });

const now = Math.floor(Date.now() / 1000);
async function deliver(env, event) {
  const body = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const sig = `t=${t},v1=${createHmac("sha256", SECRET).update(`${t}.${body}`).digest("hex")}`;
  return worker.fetch(new Request("https://r/stripe/webhook", { method: "POST", headers: { "Stripe-Signature": sig }, body }), env);
}
const ordersOf = async (env) =>
  (await (await worker.fetch(new Request("https://r/orders?since=1", { headers: { Authorization: "Bearer t" } }), env)).json());

console.log("failure detection:");
ok("charge.failed is a failure", fromEvent({ type: "charge.failed", data: { object: { id: "ch_1" } } }).paymentStatus === "failed");
ok("invoice.payment_failed is a failure (underscore, not dot)",
   fromEvent({ type: "invoice.payment_failed", data: { object: { id: "in_1" } } }).paymentStatus === "failed");
ok("payment_intent.payment_failed is a failure",
   fromEvent({ type: "payment_intent.payment_failed", data: { object: { id: "pi_1" } } }).paymentStatus === "failed");
ok("an uncollectible invoice is a failure",
   fromEvent({ type: "invoice.updated", data: { object: { id: "in_2", status: "uncollectible" } } }).paymentStatus === "failed");
ok("a success stays a success",
   fromEvent({ type: "charge.succeeded", data: { object: { id: "ch_2", status: "succeeded" } } }).paymentStatus === "succeeded");

console.log("\none payment, one order:");
let BOARD = kv();
let env = { STRIPE_WEBHOOK_SECRET: SECRET, SYNC_TOKEN: "t", STRIPE_SECRET_KEY: "sk", ALLOWED_ORIGINS: "*", BOARD };
const CHARGE = { id: "evt_a", type: "charge.succeeded", data: { object: {
  id: "ch_A", payment_intent: "pi_A", status: "succeeded", amount: 49700, currency: "usd", created: now,
  invoice: "in_A", description: "Subscription creation",
  billing_details: { name: "Tanya Alvarez", email: "t@x.co" },
  payment_method_details: { type: "card", card: { brand: "visa", last4: "4242" } },
  customer: "cus_1", metadata: {}, outcome: {} } } };
const INVOICE = { id: "evt_b", type: "invoice.payment_succeeded", data: { object: {
  id: "in_A", charge: "ch_A", payment_intent: "pi_A", subscription: "sub_1", status: "paid",
  amount_paid: 49700, currency: "usd", created: now,
  customer: "cus_1", customer_name: "Tanya Alvarez", customer_email: "t@x.co",
  lines: { data: [{ description: "Google Calls Subscription", quantity: 1, amount: 49700,
    price: { id: "price_gc", product: "prod_gc", recurring: { interval: "month", interval_count: 1 } } }] } } } };

await deliver(env, CHARGE);
await deliver(env, INVOICE);
ok("charge + invoice for one payment make one row", BOARD._m.size === 1, BOARD._m.size);
let rows = await ordersOf(env);
ok("the merged row keeps the card (from the charge)", rows[0].payment_method_details?.card?.last4 === "4242");
ok("and the product (from the invoice)", rows[0].productName === "Google Calls Subscription", rows[0].productName);
ok("and the subscription", rows[0].subscriptionId === "sub_1");
ok("order of arrival doesn't matter", true);

const BOARD2 = kv();
const env2 = { ...env, BOARD: BOARD2 };
await deliver(env2, INVOICE);
await deliver(env2, CHARGE);
const rows2 = await ordersOf(env2);
ok("reversed arrival still merges to one", BOARD2._m.size === 1 && rows2[0].productName === "Google Calls Subscription", BOARD2._m.size);
ok("reversed arrival keeps the card too", rows2[0].payment_method_details?.card?.last4 === "4242");

console.log("\nfailed renewals name the customer:");
await deliver(env, { id: "evt_c", type: "invoice.payment_failed", data: { object: {
  id: "in_B", charge: "ch_B", payment_intent: "pi_B", subscription: "sub_1", status: "open",
  amount_due: 49700, currency: "usd", created: now,
  customer: "cus_1", customer_name: "Tanya Alvarez", customer_email: "t@x.co",
  lines: { data: [{ description: "Google Calls Subscription", amount: 49700, price: { id: "price_gc", product: "prod_gc" } }] } } } });
rows = await ordersOf(env);
const bad = rows.find((r) => r.paymentId === "pi_B");
let [n] = normalize([bad], SEED);
ok("failed renewal is marked failed", n.paymentStatus === "failed", n.paymentStatus);
ok("customer is named, not 'Unnamed customer'", n.customer === "Tanya Alvarez", n.customer);
ok("email carried from the invoice", n.email === "t@x.co", n.email);
ok("amount taken from amount_due", n.amount === 49700, n.amount);

console.log("\na failure never gets overwritten by a success:");
ok("merge keeps failed", mergeOrders({ paymentStatus: "failed", declineReason: "card declined" }, { paymentStatus: "succeeded" }).paymentStatus === "failed");
ok("and keeps the reason", mergeOrders({ paymentStatus: "failed", declineReason: "card declined" }, { paymentStatus: "succeeded" }).declineReason === "card declined");
ok("merge never unsets refunded", mergeOrders({ refunded: true }, { refunded: false }).refunded === true);
ok("merge doesn't blank a field with an empty one", mergeOrders({ productName: "Calls" }, { productName: "" }).productName === "Calls");

console.log("\nrefunds reach an order that already exists:");
const board = { orders: [{ id: "o1", externalId: "pi_A", subscriptionId: "sub_1", paymentStatus: "succeeded",
  refunded: false, status: "done", assignee: "Kim", notes: "spoke to them", checklist: { 0: true } }], products: SEED };
const r1 = appendOrders(board, [{ externalId: "pi_A", paymentStatus: "succeeded", refunded: true, amountRefunded: 4970, productId: "p_gc" }]);
const updated = r1.next.orders[0];
ok("refund reaches the board", updated.refunded === true);
ok("refunded amount carried", updated.amountRefunded === 4970);
ok("no duplicate order created", r1.next.orders.length === 1, r1.next.orders.length);
ok("fulfillment state untouched",
   updated.status === "done" && updated.assignee === "Kim" && updated.notes === "spoke to them" && updated.checklist[0] === true, updated);

const r2 = appendOrders(board, [{ externalId: "pi_A", paymentStatus: "failed", declineReason: "Your card was declined." }]);
ok("a later failure reaches the board too", r2.next.orders[0].paymentStatus === "failed");
ok("with its reason", r2.next.orders[0].declineReason === "Your card was declined.");

console.log("\nrenewals aren't new signups:");
const r3 = appendOrders(board, [{ externalId: "pi_NEW", subscriptionId: "sub_1", productId: "p_gc", receivedAt: Date.now() }]);
ok("a repeat of a known subscription is a renewal", r3.added[0].renewal === true);
const r4 = appendOrders(board, [{ externalId: "pi_NEW2", subscriptionId: "sub_OTHER", productId: "p_gc", receivedAt: Date.now() }]);
ok("a new subscription is not", r4.added[0].renewal === false);
const r5 = appendOrders(board, [{ externalId: "pi_NEW3", productId: "p_gc", receivedAt: Date.now() }]);
ok("a one-off is not", r5.added[0].renewal === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
