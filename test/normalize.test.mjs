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
const { normalize, match, SEED, COLS, effHours, dueOf, DEF, HOUR, custName, findCustomers, productIdOf, priceIdOf, blockHits, blockedBy, opsFor, describeBlock, satOf, walletTotals, walletWeeks } = await import(tmp);


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
ok("csv has 34 columns", COLS.length === 34, COLS.length);
const row = COLS.map(([, g]) => g({ ...n, status: "done", assignee: "Alex", notes: "", completedAt: n.receivedAt + 3600000, dueAt: n.receivedAt }));
ok("csv row renders without throwing", row.length === 34);
ok("csv minutes-to-fulfill", row[COLS.findIndex(c => c[0] === "Minutes to fulfill")] === 60, row);


// 9. The past-due rule: whichever is tighter, the product or the house
console.log("\npast due:");
const S = { pastDueHours: 12 };
ok("48h product capped to the 12h house rule", effHours({ slaHours: 48 }, S) === 12, effHours({ slaHours: 48 }, S));
ok("12h product unchanged", effHours({ slaHours: 12 }, S) === 12);
ok("6h product keeps its tighter promise", effHours({ slaHours: 6 }, S) === 6, effHours({ slaHours: 6 }, S));
ok("no product falls back to 24h, then capped", effHours(undefined, S) === 12);
ok("no house rule leaves the product target alone", effHours({ slaHours: 48 }, {}) === 48);
ok("zero/blank house rule is ignored, not treated as instant", effHours({ slaHours: 48 }, { pastDueHours: 0 }) === 48);
ok("default is 12 hours", DEF.pastDueHours === 12, DEF.pastDueHours);

const at = 1756200000000;
const dueProducts = [{ id: "p_a", slaHours: 48 }, { id: "p_b", slaHours: 6 }];
ok("due date uses the cap", dueOf({ receivedAt: at, productId: "p_a" }, dueProducts, S) === at + 12 * HOUR);
ok("due date respects a tighter product", dueOf({ receivedAt: at, productId: "p_b" }, dueProducts, S) === at + 6 * HOUR);
ok("an unmatched order still gets a deadline", dueOf({ receivedAt: at, productId: null }, dueProducts, S) === at + 12 * HOUR);
ok("changing the house rule re-dates an existing order",
   dueOf({ receivedAt: at, productId: "p_a" }, dueProducts, { pastDueHours: 4 }) === at + 4 * HOUR);

// 10. Finding a customer by name — what the refund form leans on
console.log("\ncustomer lookup:");
const BOOK = [
  { id: "c1", first: "Tanya", last: "Alvarez", email: "t@x.co", stripeId: "cus_1" },
  { id: "c2", first: "Marcus", last: "Reed", stripeId: "cus_2" },
  { id: "c3", first: "Ana", last: "Tanaka" },
  { id: "c4", name: "Legacy Only" },
];
ok("first and last join up", custName(BOOK[0]) === "Tanya Alvarez");
ok("a bare name still works", custName(BOOK[3]) === "Legacy Only");
ok("nothing in, nothing out", custName({}) === "" && custName(null) === "");
ok("no query lists everyone, alphabetically",
   findCustomers(BOOK, "").map((c) => custName(c))[0] === "Ana Tanaka", findCustomers(BOOK, "").map(custName));
ok("matches on first name", findCustomers(BOOK, "tan").some((c) => c.id === "c1"));
/* "tan" is inside "Tanaka" too. The one that STARTS with what was typed is
   almost always the one wanted, so it has to come first. */
ok("a starts-with beats a mid-word match", findCustomers(BOOK, "tan")[0].id === "c1",
   findCustomers(BOOK, "tan").map(custName));
ok("matches on last name", findCustomers(BOOK, "reed")[0].id === "c2");
ok("matches on email", findCustomers(BOOK, "t@x")[0].id === "c1");
ok("matches on Stripe id", findCustomers(BOOK, "cus_2")[0].id === "c2");
ok("case doesn't matter", findCustomers(BOOK, "MARCUS")[0].id === "c2");
ok("no match is empty, not everything", findCustomers(BOOK, "zzz").length === 0);
ok("an empty book doesn't throw", findCustomers(undefined, "x").length === 0);

// 11. Blocking nuisance payments
console.log("\nblock rules:");
const ORD = { subscriptionId: "sub_nuisance", paymentId: "pi_9", chargeId: "ch_9",
  customerId: "cus_9", stripePriceId: "price_x", customer: "Test Account",
  email: "qa@internal.co", productName: "Individual Call", amount: 350 };

ok("exact id blocks", blockHits(ORD, { field: "subscriptionId", op: "is", value: "sub_nuisance" }));
ok("a different id doesn't", !blockHits(ORD, { field: "subscriptionId", op: "is", value: "sub_other" }));
ok("case and padding don't matter", blockHits(ORD, { field: "subscriptionId", op: "is", value: "  SUB_NUISANCE " }));
ok("contains matches part of it", blockHits(ORD, { field: "email", op: "contains", value: "internal" }));
ok("contains isn't the same as is", !blockHits(ORD, { field: "email", op: "is", value: "internal" }));

/* The rule is typed in dollars; the order is held in cents. Comparing them
   raw would make "under $5" hide everything under five dollars a hundred
   times over. */
ok("$5 means 500 cents", blockHits(ORD, { field: "amount", op: "lt", value: "5" }));
ok("and $3 does not", !blockHits(ORD, { field: "amount", op: "lt", value: "3" }));
ok("more-than works too", blockHits(ORD, { field: "amount", op: "gt", value: "1" }));
ok("an exact amount matches", blockHits(ORD, { field: "amount", op: "is", value: "3.50" }));

ok("a disabled rule catches nothing", !blockHits(ORD, { field: "subscriptionId", op: "is", value: "sub_nuisance", enabled: false }));
ok("an empty value catches nothing", !blockHits(ORD, { field: "subscriptionId", op: "is", value: "  " }));
ok("a missing field on the order is not a match",
   !blockHits({ amount: 350 }, { field: "subscriptionId", op: "is", value: "sub_nuisance" }));
/* An order with no subscription must not be caught by a "contains" rule
   matching the empty string. */
ok("blank never matches by accident",
   !blockHits({ subscriptionId: "" }, { field: "subscriptionId", op: "contains", value: "sub" }));

ok("blockedBy names the rule that caught it",
   blockedBy(ORD, [{ id: "r1", field: "email", op: "contains", value: "nope" },
                   { id: "r2", field: "amount", op: "lt", value: "5" }])?.id === "r2");
ok("blockedBy is null when nothing matches", blockedBy(ORD, [{ id: "r1", field: "email", op: "is", value: "x" }]) === null);
ok("no rules, nothing blocked", blockedBy(ORD, []) === null && blockedBy(ORD, undefined) === null);

ok("money fields don't offer 'contains'", !opsFor("amount").some(([id]) => id === "contains"));
ok("text fields don't offer 'less than'", !opsFor("email").some(([id]) => id === "lt"));
ok("a rule describes itself in dollars", /\$3\.50/.test(describeBlock({ field: "amount", op: "is", value: "3.50" })),
   describeBlock({ field: "amount", op: "is", value: "3.50" }));

// 12. Wallets — the week a wipe belongs to
console.log("\nwallet weeks:");
const day = (iso) => Date.parse(iso + "T12:00:00");
const sat = day("2026-08-29");        // a Saturday
ok("a Saturday is its own week", satOf(sat) === satOf(day("2026-08-29")));
/* Somebody entering Sunday's figures still means last night's wipe. */
ok("Sunday belongs to the Saturday before", satOf(day("2026-08-30")) === satOf(sat));
ok("Friday belongs to the Saturday before it", satOf(day("2026-09-04")) === satOf(sat));
ok("the next Saturday starts a new week", satOf(day("2026-09-05")) !== satOf(sat));
ok("every day of one week lands on the same Saturday",
   new Set(["2026-08-29","2026-08-30","2026-08-31","2026-09-01","2026-09-02","2026-09-03","2026-09-04"]
     .map((d) => satOf(day(d)))).size === 1);
ok("a week starts at midnight", new Date(satOf(day("2026-09-02"))).getHours() === 0);

const U = [{ id: "u1", first: "Tanya", last: "A" }, { id: "u2", first: "Marcus", last: "R" }, { id: "u3", first: "Never", last: "Wiped" }];
const WP = [
  { id: "w1", userId: "u1", amount: 12000, at: satOf(sat) },
  { id: "w2", userId: "u2", amount: 3000, at: satOf(sat) },
  { id: "w3", userId: "u1", amount: 8000, at: satOf(day("2026-09-05")) },
];
const T = walletTotals(U, WP);
ok("totals add up per person", T.find((u) => u.id === "u1").total === 20000);
ok("counts the weeks they were wiped", T.find((u) => u.id === "u1").count === 2);
/* `last` is a surname. Spreading a "last wiped" timestamp over it renamed
   people to a number on screen before this was caught. */
ok("totals don't overwrite the surname", T.find((u) => u.id === "u1").last === "A",
   T.find((u) => u.id === "u1").last);
ok("the last wipe is kept under its own name", T.find((u) => u.id === "u1").lastAt > 0);
ok("averages across those weeks", T.find((u) => u.id === "u1").average === 10000);
ok("somebody never wiped still appears, at zero",
   T.find((u) => u.id === "u3").total === 0 && T.find((u) => u.id === "u3").count === 0);
ok("average of nothing is zero, not NaN", T.find((u) => u.id === "u3").average === 0);
ok("a range narrows the totals",
   walletTotals(U, WP, satOf(day("2026-09-05"))).find((u) => u.id === "u1").total === 8000);

const WK = walletWeeks(WP);
ok("two weeks, oldest first", WK.length === 2 && WK[0].week < WK[1].week);
ok("the first week sums both people", WK[0].total === 15000 && WK[0].count === 2);
/* A wipe entered on the Sunday after must land in the same week as one
   entered on the Saturday, or the weekly total splits in two. */
ok("a Sunday entry joins its Saturday",
   walletWeeks([{ id: "a", userId: "u1", amount: 100, at: satOf(sat) },
                { id: "b", userId: "u2", amount: 100, at: day("2026-08-30") }]).length === 1);
ok("no wipes, no weeks", walletWeeks([]).length === 0 && walletWeeks(undefined).length === 0);

// 13. The price id and the product id are different things
console.log("\nprice id and product id are kept apart:");
const both = normalize([{ id: "ch_p", created: 1756300000, amount: 49700,
  lines: { data: [{ description: "Google Calls Subscription", price: { id: "price_gc", product: "prod_gc" } }] } }], SEED)[0];
ok("the price id is the price id", both.stripePriceId === "price_gc", both.stripePriceId);
ok("the product id is kept too", both.stripeProductId === "prod_gc", both.stripeProductId);
/* Folding them lost this one whenever a price existed. */
ok("a price no longer swallows the product", both.stripePriceId !== both.stripeProductId);

const priceOnly = normalize([{ id: "ch_q", created: 1756300000,
  lines: { data: [{ description: "x", price: { id: "price_only" } }] } }], SEED)[0];
ok("no product id means empty, not the price", priceOnly.stripeProductId === "", priceOnly.stripeProductId);

/* A charge that carries only a product id must not have it filed as a price. */
const prodOnly = normalize([{ id: "ch_r", created: 1756300000,
  lines: { data: [{ description: "x", price: { product: "prod_only" } }] } }], SEED)[0];
ok("a lone product id is not called a price", prodOnly.stripePriceId === "", prodOnly.stripePriceId);
ok("and is kept as the product id", prodOnly.stripeProductId === "prod_only", prodOnly.stripeProductId);

/* Matching still works from either id, which is the whole point of keeping them. */
const CAT = [{ id: "p_x", name: "Thing", slaHours: 24, color: "blue", stripeIds: ["prod_gc"] }];
ok("an order matches on its product id",
   normalize([{ id: "ch_s", created: 1756300000,
     lines: { data: [{ price: { id: "price_zz", product: "prod_gc" } }] } }], CAT)[0].productId === "p_x");
const CAT2 = [{ id: "p_y", name: "Thing", slaHours: 24, color: "blue", stripeIds: ["price_gc"] }];
ok("and on its price id",
   normalize([{ id: "ch_t", created: 1756300000,
     lines: { data: [{ price: { id: "price_gc", product: "prod_zz" } }] } }], CAT2)[0].productId === "p_y");

ok("csv carries the product id",
   COLS.some(([label]) => label === "Stripe product ID"), COLS.map((c) => c[0]).slice(-4));

/* An order saved before the split still has to show its product id. */
console.log("\nrecovering a product id from an older order:");
ok("a stored product id is used as-is", productIdOf({ stripeProductId: "prod_a" }) === "prod_a");
ok("a prod_ filed under the price field is recognised",
   productIdOf({ stripePriceId: "prod_b" }) === "prod_b");
/* The one that matters: the ids were folded, the price won, and the product
   id survived only inside the line items. */
ok("otherwise it comes from the line items",
   productIdOf({ stripePriceId: "price_c", items: [{ productId: "prod_c" }] }) === "prod_c");
ok("nothing anywhere is empty, not undefined", productIdOf({}) === "" && productIdOf(null) === "");
ok("the price field never reports a product id as a price",
   priceIdOf({ stripePriceId: "prod_b" }) === "" && priceIdOf({ stripePriceId: "price_c" }) === "price_c");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

