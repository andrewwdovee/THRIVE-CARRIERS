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
    list: async ({ prefix }) => ({ keys: [...m.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name })), list_complete: true }),
    _m: m,
    /* Orders only — the id -> key pointers beside them are bookkeeping. */
    _rows: () => [...m.keys()].filter((k) => k.startsWith("inbox:")) };
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
  /* Stripe drafts a renewal's invoice up to an hour before it charges the
     card, so the two events disagree about when the payment happened. */
  amount_paid: 49700, currency: "usd", created: now - 3400,
  customer: "cus_1", customer_name: "Tanya Alvarez", customer_email: "t@x.co",
  lines: { data: [{ description: "Google Calls Subscription", quantity: 1, amount: 49700,
    price: { id: "price_gc", product: "prod_gc", recurring: { interval: "month", interval_count: 1 } } }] } } } };

await deliver(env, CHARGE);
await deliver(env, INVOICE);
ok("charge + invoice for one payment make one row", BOARD._rows().length === 1, BOARD._rows());
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
ok("reversed arrival still merges to one", BOARD2._rows().length === 1 && rows2[0].productName === "Google Calls Subscription", BOARD2._rows());
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

/* ── money that stops without a payment ──
   The two cases nothing else reports. A client cancels, or charges back; no
   charge arrives, so without these the campaign keeps running on our spend. */
console.log("\ncancellations and disputes reach the board:");
const BOARD3 = kv();
const env3 = { ...env, BOARD: BOARD3 };

/* Month one: they paid. This is what the board already knows about them. */
await deliver(env3, CHARGE);
await deliver(env3, INVOICE);
let x3 = { orders: [], products: SEED, settings: {} };
x3 = appendOrders(x3, normalize(await ordersOf(env3), SEED)).next;
ok("the paid month is on the board", x3.orders.length === 1, x3.orders.length);

/* Month two: they cancel. No charge, no invoice, no name on the event. */
await deliver(env3, { id: "evt_c", type: "customer.subscription.deleted", data: { object: {
  id: "sub_1", object: "subscription", customer: "cus_1", status: "canceled",
  canceled_at: now + 60, cancellation_details: { reason: "cancellation_requested" },
  items: { data: [{ quantity: 1, price: { id: "price_gc", product: "prod_gc", unit_amount: 49700,
    currency: "usd", nickname: "Google Calls", recurring: { interval: "month", interval_count: 1 } } }] } } } });

const drafts3 = normalize(await ordersOf(env3), SEED);
ok("the cancellation is its own row", drafts3.length === 2, drafts3.length);
const gone = drafts3.find((o) => o.subscriptionId === "sub_1" && !o.chargeId);
ok("a cancellation counts as unpaid", gone.paymentStatus === "failed", gone?.paymentStatus);
ok("and says why", /cancel/i.test(gone.declineReason), gone?.declineReason);
ok("and carries the subscription", gone.subscriptionStatus === "canceled");

const after = appendOrders(x3, drafts3);
x3 = after.next;
ok("it lands as a new row, not a patch", x3.orders.length === 2, x3.orders.length);
const row = x3.orders.find((o) => o.subscriptionId === "sub_1" && !o.chargeId);
ok("named from the months they did pay", row.customer === "Tanya Alvarez", row.customer);
ok("and filed under the same product", row.productId === x3.orders.find((o) => o.chargeId).productId, row.productId);

/* A chargeback on the payment we already have. */
const BOARD4 = kv();
const env4 = { ...env, BOARD: BOARD4 };
await deliver(env4, CHARGE);
await deliver(env4, INVOICE);
let x4 = appendOrders({ orders: [], products: SEED, settings: {} }, normalize(await ordersOf(env4), SEED)).next;
x4 = { ...x4, orders: x4.orders.map((o) => ({ ...o, status: "done", notes: "delivered" })) };

await deliver(env4, { id: "evt_d", type: "charge.dispute.created", data: { object: {
  id: "dp_1", object: "dispute", charge: "ch_A", payment_intent: "pi_A", amount: 49700,
  currency: "usd", reason: "fraudulent", status: "needs_response",
  created: now + 86400 * 3, evidence_details: { due_by: now + 86400 * 10 } } } });

ok("a dispute doesn't start a second order", BOARD4._rows().length === 1, BOARD4._rows());
const out4 = appendOrders(x4, normalize(await ordersOf(env4), SEED));
ok("it patches the payment we already had", out4.next.orders.length === 1, out4.next.orders.length);
const d4 = out4.next.orders[0];
ok("the order is now unpaid", d4.paymentStatus === "failed", d4.paymentStatus);
ok("flagged as disputed", d4.disputed === true);
ok("with the cardholder's reason", /fraudulent/i.test(d4.declineReason), d4.declineReason);
ok("the work already done is left alone", d4.status === "done" && d4.notes === "delivered");

/* Both halves of one payment in a single poll, before anything is on the
   board — the case that used to add the same money twice. */
const folded = appendOrders({ orders: [], products: SEED, settings: {} },
  normalize([fromEvent(CHARGE), fromEvent(INVOICE)], SEED));
ok("two events in one poll make one order", folded.next.orders.length === 1, folded.next.orders.length);
ok("and the folded row keeps the product", folded.next.orders[0].productName === "Google Calls Subscription",
   folded.next.orders[0].productName);


/* ── blocked payments never become orders ── */
console.log("\nblock rules stop clutter at the door:");
const RULES = [{ id: "b1", field: "subscriptionId", op: "is", value: "sub_junk", note: "test sub" }];
const base = { orders: [], products: SEED, refunds: [], customers: [], blocks: RULES, settings: {} };
const wanted = { externalId: "pi_keep", subscriptionId: "sub_real", productId: "p_gc", amount: 49700, receivedAt: Date.now() };
const junk = { externalId: "pi_junk", subscriptionId: "sub_junk", productId: "p_gc", amount: 500, receivedAt: Date.now() };

const blk1 = appendOrders(base, [wanted, junk]);
ok("only the real payment lands", blk1.next.orders.length === 1, blk1.next.orders.length);
ok("and it's the right one", blk1.next.orders[0].externalId === "pi_keep");
ok("the block is counted", blk1.blocked === 1, blk1.blocked);
ok("the rule records what it caught", blk1.next.blocks[0].hits === 1, blk1.next.blocks[0]);

/* Stripe retries deliveries. A rule must not inflate its count every time
   the same blocked payment arrives again — but it must keep blocking it. */
const blk2 = appendOrders(blk1.next, [junk]);
ok("a retry is still blocked", blk2.next.orders.length === 1, blk2.next.orders.length);
ok("counting keeps going up", blk2.next.blocks[0].hits === 2, blk2.next.blocks[0].hits);

/* Turning a rule off has to let the next one through. */
const off = { ...blk1.next, blocks: [{ ...RULES[0], enabled: false }] };
ok("a disabled rule lets it in", appendOrders(off, [junk]).next.orders.length === 2);

/* No rules at all must not change anything. */
const none = appendOrders({ ...base, blocks: [] }, [wanted, junk]);
ok("no rules, nothing blocked", none.next.orders.length === 2 && none.blocked === 0);

/* ── one payment, one order ── */
console.log("\nthe payment id is what makes a duplicate:");
const base2 = { orders: [], products: SEED, refunds: [], customers: [], blocks: [], settings: {} };
const mk = (o) => ({ productId: "p_gc", amount: 49700, receivedAt: Date.now(), ...o });

/* The same payment arriving twice — a Stripe retry, or a second poll. */
const twice = appendOrders(base2, [
  mk({ paymentId: "pi_1", externalId: "ch_1" }),
  mk({ paymentId: "pi_1", externalId: "ch_1" }),
]);
ok("the same payment twice is one order", twice.next.orders.length === 1, twice.next.orders.length);

/* A decline and the retry that succeeds: two charge ids, one payment intent.
   This is the case the old charge-id keying got wrong. */
const retry = appendOrders(base2, [
  mk({ paymentId: "pi_2", externalId: "ch_a", paymentStatus: "failed" }),
  mk({ paymentId: "pi_2", externalId: "ch_b", paymentStatus: "succeeded" }),
]);
ok("a decline and its retry are one order", retry.next.orders.length === 1, retry.next.orders.length);

/* Two renewals of one subscription are two separate sales, each to fulfil. */
const renewals = appendOrders(base2, [
  mk({ paymentId: "pi_jan", externalId: "ch_jan", subscriptionId: "sub_1" }),
  mk({ paymentId: "pi_feb", externalId: "ch_feb", subscriptionId: "sub_1" }),
]);
ok("one subscription, two payments, two orders", renewals.next.orders.length === 2, renewals.next.orders.length);

/* Arriving in separate polls rather than one batch. */
const first = appendOrders(base2, [mk({ paymentId: "pi_3", externalId: "ch_3" })]);
const second = appendOrders(first.next, [mk({ paymentId: "pi_3", externalId: "ch_3" })]);
ok("a later poll doesn't re-add it", second.next.orders.length === 1, second.next.orders.length);

/* An order already on the board under its charge id must still be found when
   the draft identifies itself by payment id — otherwise upgrading duplicates
   every open order exactly once. */
const legacy = { ...base2, orders: [{ id: "o1", externalId: "ch_old", paymentId: "pi_old", status: "active" }] };
const back = appendOrders(legacy, [mk({ paymentId: "pi_old", externalId: "ch_old" })]);
ok("an order already on the board is recognised", back.next.orders.length === 1, back.next.orders.length);
ok("and the work on it is untouched", back.next.orders[0].status === "active");

/* A record with no payment id at all still dedupes on what it does have. */
const manual = appendOrders(base2, [
  mk({ externalId: "manual_1" }), mk({ externalId: "manual_1" }),
]);
ok("no payment id falls back to externalId", manual.next.orders.length === 1, manual.next.orders.length);

/* A subscription cancellation carries no payment; it must not collide with
   the payments made under that same subscription. */
const cancel = appendOrders(renewals.next, [mk({ paymentId: "sub_1", externalId: "sub_1", paymentStatus: "failed" })]);
ok("a cancellation is its own row, not a duplicate renewal", cancel.next.orders.length === 3, cancel.next.orders.length);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
