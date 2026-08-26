import { build } from "esbuild";
import { writeFileSync } from "fs";

// shared.jsx has JSX in it; bundle it to plain JS so node can import it.
const out = await build({
  entryPoints: [new URL("../src/lib/shared.jsx", import.meta.url).pathname],
  bundle: true, format: "esm", write: false, jsx: "transform",
  external: ["react", "lucide-react"],
});
const tmp = new URL("../.shared.built.mjs", import.meta.url).pathname;
writeFileSync(tmp, out.outputFiles[0].text);
const { normalize, match, SEED, COLS } = await import(tmp);


let pass = 0, fail = 0;
const ok = (n, c, e) => { c ? (pass++, console.log("  ok  " + n)) : (fail++, console.log("  FAIL " + n, e ?? "")); };

console.log("normalize:");

// 1. Shape the relay emits
const relayRow = {
  id: "ch_3abc", chargeId: "ch_3abc", paymentId: "pi_3abc", status: "succeeded", paymentStatus: "succeeded",
  amount: 49700, currency: "usd", created: 1756200000, receiptUrl: "https://pay.stripe.com/r/abc",
  payment_method_details: { type: "card", card: { brand: "visa", last4: "4242", exp_month: 7, exp_year: 2029 } },
  billing_details: { name: "Tanya Alvarez", email: "t@example.com" },
  customer: { id: "cus_9", name: "Tanya Alvarez", email: "t@example.com", phone: "+17275551234" },
  subscriptionId: "sub_77", subscriptionStatus: "active", invoice: "in_123",
  priceId: "price_abc", stripeProductId: "prod_xyz", productName: "Google Calls Subscription",
  interval: "month", intervalCount: 1, quantity: 1,
  items: [{ description: "Google Calls Subscription", quantity: 1, amount: 49700, priceId: "price_abc", productId: "prod_xyz", interval: "month", intervalCount: 1 }],
};
let [n] = normalize([relayRow], SEED);
ok("customer name", n.customer === "Tanya Alvarez", n.customer);
ok("email", n.email === "t@example.com");
ok("phone", n.phone === "+17275551234");
ok("card", n.cardBrand === "visa" && n.cardLast4 === "4242" && n.cardExp === "07/29", [n.cardBrand,n.cardLast4,n.cardExp]);
ok("amount + currency", n.amount === 49700 && n.currency === "USD");
ok("created seconds -> ms", n.receivedAt === 1756200000 * 1000, n.receivedAt);
ok("keyword match -> Google Calls product", n.productId === "p_gc", n.productId);
ok("succeeded", n.paymentStatus === "succeeded");

// 2. Raw Stripe webhook envelope (event -> data.object)
const evt = { type: "charge.succeeded", data: { object: {
  id: "ch_9", payment_intent: "pi_9", status: "succeeded", amount: 19700, currency: "usd", created: 1756300000,
  description: "Instagram Software", billing_details: { name: "Halle Byrne", email: "h@example.com" },
  payment_method_details: { type: "card", card: { brand: "amex", last4: "9001", exp_month: 12, exp_year: 2027 } },
  customer: "cus_h",
}}};
[n] = normalize(evt, SEED);
ok("unwraps event envelope", n.chargeId === "ch_9" && n.paymentId === "pi_9", n);
ok("customer id as string", n.customerId === "cus_h");
ok("matches instagram by description", n.productId === "p_ig", n.productId);

// 3. Failed charge
[n] = normalize([{ id: "ch_bad", status: "failed", amount: 29700, currency: "usd", created: 1756300000,
  failure_code: "card_declined", failure_message: "Your card was declined.", description: "Recruiting Ad Campaign" }], SEED);
ok("failed payment flagged", n.paymentStatus === "failed", n.paymentStatus);
ok("decline code kept", n.declineCode === "card_declined" && n.declineReason === "Your card was declined.");

// 4. Checkout session with line_items
[n] = normalize([{ id: "cs_1", amount_total: 99700, currency: "usd", created: 1756300000,
  customer_details: { name: "Ray Whitfield", email: "r@example.com", phone: "+1727" },
  line_items: { data: [{ description: "Inbound Final Expense Transfers", quantity: 2, amount_total: 99700,
    price: { id: "price_fe", product: "prod_fe", recurring: { interval: "month", interval_count: 3 } } }] } }], SEED);
ok("checkout amount_total", n.amount === 99700, n.amount);
ok("checkout customer_details", n.customer === "Ray Whitfield" && n.phone === "+1727");
ok("line_items -> items", n.items.length === 1 && n.items[0].quantity === 2, n.items);
ok("matches final expense", n.productId === "p_fe", n.productId);
ok("interval count 3", n.intervalCount === 3, n.intervalCount);

// 5. Unmatched product falls to triage
[n] = normalize([{ id: "ch_u", amount: 500, currency: "usd", created: 1756300000, description: "Consulting hour" }], SEED);
ok("no match -> null productId", n.productId === null, n.productId);
ok("keeps its own name", n.productName === "Consulting hour");

// 6. Explicit ID mapping beats keyword
const ps = [{ id: "p_a", name: "Alpha", stripeIds: ["price_abc"], stripeMatch: "" },
            { id: "p_b", name: "Beta", stripeIds: [], stripeMatch: "google" }];
ok("exact id wins over keyword", match(ps, ["price_abc"], "google calls") === "p_a");
ok("keyword when no id", match(ps, ["price_zzz"], "google calls") === "p_b");
ok("whitespace-tolerant ids", match([{ id: "p_c", stripeIds: [" price_pad "] }], ["price_pad"], "") === "p_c");

// 7. Junk in the payload doesn't blow up the sync
ok("nulls dropped", normalize([null, undefined, 5, { id: "ch_z", created: 1756300000 }], SEED).length === 1);
ok("empty payload", normalize([], SEED).length === 0);

// 8. CSV covers what the board holds
ok("csv has 32 columns", COLS.length === 32, COLS.length);
const row = COLS.map(([, g]) => g({ ...n, status: "done", assignee: "Alex", notes: "", completedAt: n.receivedAt + 3600000, dueAt: n.receivedAt }));
ok("csv row renders without throwing", row.length === 32);
ok("csv minutes-to-fulfill", row[COLS.findIndex(c => c[0] === "Minutes to fulfill")] === 60, row);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

