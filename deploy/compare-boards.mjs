/**
 * Compares two board files before anything is merged.
 *
 *   node compare-boards.mjs board-a.json board-b.json
 *
 * merge-board matches orders by id and by Stripe payment. When two
 * copies of a board hold the same payments under different ids that
 * matching finds nothing, and a merge that looks like it is filling a
 * gap is really making a second copy of every order.
 *
 * The same ids tie the other lists together: a wipe is what records an
 * order as completed, and it points at an order. Carrying wipes across
 * to a board whose orders have different ids leaves them pointing at
 * nothing, and the orders come back as new.
 *
 * So this says, before any of that: which ids the two files share, on
 * which field, and where the wipes and refunds in each actually point.
 * Reads files only -- it writes nothing and signs in to nothing.
 */

import { readFileSync } from "node:fs";

const [fileA, fileB] = process.argv.slice(2);
if (!fileA || !fileB) {
  console.error("Usage: node compare-boards.mjs <a.json> <b.json>");
  process.exit(1);
}

function load(f) {
  let v = JSON.parse(readFileSync(f, "utf8").trim());
  if (typeof v === "string") v = JSON.parse(v);   /* exported with quotes around it */
  return v;
}

const A = load(fileA), B = load(fileB);
const LISTS = ["orders", "products", "calls", "refunds", "wipes", "customers", "blocks", "refundTypes"];
const arr = (r, k) => (Array.isArray(r[k]) ? r[k] : []);
const name = (f) => f.replace(/^.*\//, "");

console.log(`A = ${name(fileA)}\nB = ${name(fileB)}\n`);

console.log("=== how many of each ===");
console.log(`  ${"list".padEnd(14)}${"A".padStart(7)}${"B".padStart(8)}`);
for (const k of LISTS) {
  const a = arr(A, k).length, b = arr(B, k).length;
  if (a || b) console.log(`  ${k.padEnd(14)}${String(a).padStart(7)}${String(b).padStart(8)}`);
}

/* ---- which field, if any, the two files agree on ----
   Every id-ish field is tried separately rather than merged into one
   set, because "they overlap on paymentId but not on id" is the whole
   answer and a combined count hides it. */
const ID_FIELDS = ["id", "externalId", "paymentId", "chargeId", "stripeId", "sessionId", "invoiceId"];
const vals = (rows, f) => new Set(rows.map((o) => o && o[f]).filter(Boolean).map(String));

console.log("\n=== do the orders line up ===");
const oa = arr(A, "orders"), ob = arr(B, "orders");
let bestField = null, bestShared = 0;
for (const f of ID_FIELDS) {
  const sa = vals(oa, f), sb = vals(ob, f);
  if (!sa.size && !sb.size) continue;
  let shared = 0;
  for (const v of sa) if (sb.has(v)) shared++;
  if (shared > bestShared) { bestShared = shared; bestField = f; }
  console.log(`  ${f.padEnd(12)} A has ${String(sa.size).padStart(4)}   B has ${String(sb.size).padStart(4)}   shared ${shared}`);
}
if (bestShared) {
  console.log(`\n  The two files agree on "${bestField}": ${bestShared} orders are the same order.`);
} else {
  console.log(`
  No field matches. These two files describe the same payments under
  different ids, so merging their orders would duplicate every one.`);
}

/* what an order actually carries, so a missing match can be read */
if (oa[0] && ob[0]) {
  const keysOf = (o) => Object.keys(o).filter((k) => ID_FIELDS.includes(k) || /id$/i.test(k));
  console.log(`\n  id-ish fields on an A order: ${keysOf(oa[0]).join(", ") || "none"}`);
  console.log(`  id-ish fields on a  B order: ${keysOf(ob[0]).join(", ") || "none"}`);
}

/* ---- where the pointers point ----
   A wipe or a refund names an order. Whether it still finds one after
   a merge is the difference between a completed order staying
   completed and coming back as new. */
function pointers(label, rows, idsA, idsB) {
  if (!rows.length) return;
  let hitA = 0, hitB = 0, neither = 0;
  for (const r of rows) {
    const strings = Object.values(r).filter((v) => typeof v === "string");
    const inA = strings.some((v) => idsA.has(v));
    const inB = strings.some((v) => idsB.has(v));
    if (inA) hitA++;
    if (inB) hitB++;
    if (!inA && !inB) neither++;
  }
  console.log(`  ${label.padEnd(22)} ${rows.length} rows -> ${hitA} find an A order, ${hitB} find a B order, ${neither} find neither`);
}

const allA = new Set(), allB = new Set();
for (const f of ID_FIELDS) { for (const v of vals(oa, f)) allA.add(v); for (const v of vals(ob, f)) allB.add(v); }

console.log("\n=== what the completions point at ===");
pointers("A wipes", arr(A, "wipes"), allA, allB);
pointers("B wipes", arr(B, "wipes"), allA, allB);
pointers("A refunds", arr(A, "refunds"), allA, allB);
pointers("B refunds", arr(B, "refunds"), allA, allB);
pointers("A calls", arr(A, "calls"), allA, allB);
pointers("B calls", arr(B, "calls"), allA, allB);

console.log(`
A list whose rows find neither file's orders does not point at an order
through a plain field. That is not proof the rows are orphaned -- see
the reference scan below.`);

/* ---- when, not just which ----
   Two copies sharing no ids has two opposite meanings. Either they hold
   the same payments under different ids, and merging duplicates every
   one; or they hold different payments, and merging restores what the
   live board lost. Ids cannot tell those apart. Dates can: copies that
   overlap in time are the same orders twice, and copies that sit either
   side of a date are two halves of one history. */
const DATE_FIELDS = ["receivedAt", "createdAt", "created", "date", "at", "paidAt", "timestamp"];
function dateOf(o) {
  for (const f of DATE_FIELDS) {
    const v = o && o[f];
    if (v == null || v === "") continue;
    const d = new Date(typeof v === "number" || /^\d{10,}$/.test(String(v)) ? Number(v) : String(v));
    if (!isNaN(d) && d.getUTCFullYear() > 2000) return d;
  }
  return null;
}
function span(rows) {
  const ds = rows.map(dateOf).filter(Boolean).sort((a, b) => a - b);
  return ds.length ? { n: ds.length, from: ds[0], to: ds[ds.length - 1] } : null;
}

console.log("\n=== when the orders are from ===");
const sa = span(oa), sb = span(ob);
const fmt = (d) => d.toISOString().slice(0, 10);
for (const [label, sp, rows] of [["A", sa, oa], ["B", sb, ob]]) {
  if (!sp) { console.log(`  ${label}: no readable date on any order`); continue; }
  console.log(`  ${label}: ${sp.n} of ${rows.length} dated, ${fmt(sp.from)} to ${fmt(sp.to)}`);
}
if (sa && sb) {
  const overlap = sa.from <= sb.to && sb.from <= sa.to;
  const days = overlap ? Math.round((Math.min(sa.to, sb.to) - Math.max(sa.from, sb.from)) / 86400000) : 0;
  console.log(overlap
    ? `  The ranges overlap by about ${days} day(s). On its own that proves
  nothing -- a busy fortnight has many orders on the same days. The
  verdict is below, from the ids and the amounts.`
    : `  The ranges do not overlap at all, so these are two halves of one
  history rather than two copies of the same orders.`);
}

/* Same money, same day, same customer is the same order whatever its id. */
function moneyKey(o) {
  const d = dateOf(o);
  const who = String(o.email || o.customerEmail || o.customerId || "").toLowerCase();
  const amt = o.amount ?? o.total ?? o.amountPaid;
  if (!d || amt == null) return null;
  return `${fmt(d)}|${amt}|${who}`;
}
const ka = new Set(oa.map(moneyKey).filter(Boolean));
const kb = new Set(ob.map(moneyKey).filter(Boolean));
let same = 0;
for (const k of ka) if (kb.has(k)) same++;
console.log(`
=== same day, same amount, same customer ===
  A has ${ka.size} such orders, B has ${kb.size}, ${same} look like the same order.`);
/* No comparable orders is not a clean bill of health. Saying "safe"
   when nothing could be compared is the same mistake as ranking two
   copies by a single total: a verdict the evidence does not carry. */
/* ---- the verdict, from every signal at once ----
   An earlier version reached one conclusion from the calendar and the
   opposite from the ids, printed both, and left the reader to pick.
   Overlapping dates are the weakest signal here: a busy fortnight puts
   many different orders on the same days. A Stripe payment id is the
   strongest, because Stripe issues it and both copies carry one for
   every order. So the ids decide, the amounts confirm, and the
   calendar only colours in. */
const strongest = Math.max(bestShared, same);
const comparable = ka.size && kb.size;
if (!comparable && !bestShared) {
  console.log(`
=== verdict: cannot tell ===
  No id field matches and no copy carries a date with an amount, so
  nothing here can separate "the same orders twice" from "two halves of
  one history". Merge nothing until something can.`);
} else if (strongest > Math.min(oa.length, ob.length) * 0.2) {
  console.log(`
=== verdict: the same orders twice ===
  ${strongest} of ${Math.min(oa.length, ob.length)} line up. Merging the orders would duplicate
  them. Merge the other lists if you need them, and leave orders alone.`);
} else {
  console.log(`
=== verdict: two halves of one history ===
  Only ${strongest} of ${Math.min(oa.length, ob.length)} line up, on ids Stripe issues and on amounts,
  so these are different orders however their dates read. Merging
  restores what the live board is missing; expect about ${oa.length + ob.length - strongest} orders
  afterwards.`);
}

/* ---- how the other lists name an order ----
   Nested as well as top level, because a plain-field scan found nothing
   and that on its own says more about the scan than about the rows. */
function deepStrings(v, out = [], depth = 0) {
  if (depth > 4 || v == null) return out;
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) deepStrings(x, out, depth + 1);
  else if (typeof v === "object") for (const x of Object.values(v)) deepStrings(x, out, depth + 1);
  return out;
}
function scan(label, rows, idsA, idsB) {
  if (!rows.length) return;
  let hitA = 0, hitB = 0;
  const fields = new Map();
  for (const r of rows) {
    const ss = deepStrings(r);
    if (ss.some((v) => idsA.has(v))) hitA++;
    if (ss.some((v) => idsB.has(v))) hitB++;
    for (const [k, v] of Object.entries(r)) {
      if (typeof v === "string" && (idsA.has(v) || idsB.has(v))) fields.set(k, (fields.get(k) || 0) + 1);
    }
  }
  const via = [...fields.entries()].map(([k, n]) => `${k} (${n})`).join(", ");
  console.log(`  ${label.padEnd(12)} ${String(rows.length).padStart(4)} rows -> ${hitA} reach an A order, ${hitB} reach a B order${via ? `   via ${via}` : "   no field names an order"}`);
  if (!hitA && !hitB && rows[0]) console.log(`  ${"".padEnd(12)} its fields: ${Object.keys(rows[0]).join(", ")}`);
}

console.log("\n=== how the other lists reach an order (nested too) ===");
scan("B wipes", arr(B, "wipes"), allA, allB);
scan("B refunds", arr(B, "refunds"), allA, allB);
scan("B calls", arr(B, "calls"), allA, allB);
