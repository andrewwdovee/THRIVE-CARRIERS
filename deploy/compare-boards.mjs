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
Read it this way: a list whose rows "find a B order" but not an A one
only works on top of B's orders. Carrying it onto A's orders leaves it
pointing at nothing, and completed orders come back as new.`);
