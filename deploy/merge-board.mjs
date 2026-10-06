/**
 * Merges an exported Lead Tech board into the one on the relay.
 *
 *   node merge-board.mjs old-board.json            show what would change
 *   node merge-board.mjs old-board.json --write    merge it in
 *
 * push-board.mjs replaces the relay's board outright. This one adds to it:
 * everything already on the relay stays as it is, and only what is missing
 * comes across from the file — orders, refunds, customers, calls, wipes,
 * block rules, products and refund types. Settings stay the relay's.
 *
 * Before writing, the relay's current board is saved beside this script as
 * board-backup-<time>.json. To undo: node push-board.mjs <that file>.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const here = dirname(fileURLToPath(import.meta.url));
const BOARD_KEY = "fulfillment_board_v3";
const LISTS = ["orders", "refunds", "customers", "calls", "wipes", "blocks"];

const file = process.argv[2];
const write = process.argv.includes("--write");
if (!file || file.startsWith("--")) {
  console.error("Usage: node merge-board.mjs <old-board.json> [--write]");
  process.exit(1);
}

let old;
try {
  old = JSON.parse(readFileSync(file, "utf8").trim());
  if (typeof old === "string") old = JSON.parse(old);   /* copied with quotes around it */
} catch (e) {
  console.error(`${file} is not valid JSON — the copy was probably cut short.\n${e.message}`);
  process.exit(1);
}
if (!old || typeof old !== "object" || (!old.orders && !old.products && !old.calls)) {
  console.error(`${file} does not look like a board. Keys: ${Object.keys(old || {}).join(", ") || "none"}`);
  process.exit(1);
}

const toml = readFileSync(join(here, "wrangler.toml"), "utf8");
const email = (toml.match(/^OWNER_EMAIL\s*=\s*"([^"]+)"/m) || [])[1];
const workerName = (toml.match(/^name\s*=\s*"([^"]+)"/m) || [])[1];
const relay = process.env.THRIVE_RELAY
  || `https://${workerName}.${process.env.CF_SUBDOMAIN || "aandrewdavidson"}.workers.dev`;

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (!s.includes(question)) rl.output.write("*"); else rl.output.write(s); };
    rl.question(question, (a) => { rl.close(); process.stdout.write("\n"); resolve(a); });
  });
}

/* ------------------------------------------------------------ the merge */

const norm = (s) => String(s || "").trim().toLowerCase();

/* Products and refund types are matched by name as well as id: the same
   "Transfers Starter" made on two boards has two different ids, and
   should stay one product. Old ids are remembered so the orders and
   refunds that point at them follow. */
function mergeNamed(cur = [], add = []) {
  const out = [...cur], remap = {}, added = [];
  for (const x of add) {
    const same = out.find((y) => y.id === x.id) || out.find((y) => norm(y.name) && norm(y.name) === norm(x.name));
    if (same) { if (same.id !== x.id) remap[x.id] = same.id; continue; }
    out.push(x); added.push(x);
  }
  return { list: out, remap, added: added.length };
}

/* An order is the same order if it has the same id, or the same Stripe
   payment — the two boards may each have pulled it from Stripe. */
function orderKeys(o) {
  return [o.id, o.externalId, o.paymentId, o.chargeId].filter(Boolean).map(String);
}

function mergeList(name, cur = [], add = []) {
  const seen = new Set();
  for (const x of cur) (name === "orders" ? orderKeys(x) : [x.id]).filter(Boolean).forEach((k) => seen.add(String(k)));
  const fresh = add.filter((x) => {
    const keys = (name === "orders" ? orderKeys(x) : [x.id]).filter(Boolean).map(String);
    if (!keys.length) return true;
    if (keys.some((k) => seen.has(k))) return false;
    keys.forEach((k) => seen.add(k));
    return true;
  });
  return { list: [...cur, ...fresh], added: fresh.length };
}

function merge(cur, add) {
  const out = { ...cur };
  const report = {};

  const p = mergeNamed(cur.products, add.products);
  out.products = p.list; report.products = p.added;
  const t = mergeNamed(cur.refundTypes, add.refundTypes);
  out.refundTypes = t.list; report.refundTypes = t.added;

  const moved = {
    ...add,
    orders: (add.orders || []).map((o) => (p.remap[o.productId] ? { ...o, productId: p.remap[o.productId] } : o)),
    refunds: (add.refunds || []).map((r) => ({
      ...r,
      ...(t.remap[r.typeId] ? { typeId: t.remap[r.typeId] } : {}),
      ...(p.remap[r.productId] ? { productId: p.remap[r.productId] } : {}),
    })),
  };
  for (const k of LISTS) {
    const m = mergeList(k, cur[k], moved[k]);
    out[k] = m.list; report[k] = m.added;
  }
  out.handledRequests = { ...(add.handledRequests || {}), ...(cur.handledRequests || {}) };
  out.settings = { ...(add.settings || {}), ...(cur.settings || {}) };
  out.updatedAt = Date.now();
  return { out, report };
}

/* -------------------------------------------------------------- run it */

console.log(`Relay:  ${relay}\nSigning in as: ${email}\n`);
const password = await askHidden("Password: ");
const login = await fetch(`${relay}/auth/login`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});
const auth = await login.json().catch(() => ({}));
if (!login.ok || !auth.token) { console.error(`Sign-in failed: ${auth.error || login.status}`); process.exit(1); }
const H = { "Content-Type": "application/json", Authorization: `Bearer ${auth.token}` };

const got = await fetch(`${relay}/kv/${encodeURIComponent(BOARD_KEY)}`, { headers: H });
if (!got.ok && got.status !== 404) { console.error(`Couldn't read the relay's board (${got.status}).`); process.exit(1); }
const curRaw = got.status === 404 ? "{}" : (await got.json()).value || "{}";
const cur = JSON.parse(curRaw);

const { out, report } = merge(cur, old);
const count = (b, k) => (Array.isArray(b[k]) ? b[k].length : 0);
console.log("                 on relay   in file   coming across");
for (const k of ["orders", "refunds", "customers", "calls", "wipes", "blocks", "products", "refundTypes"]) {
  console.log(`  ${k.padEnd(13)} ${String(count(cur, k)).padStart(8)} ${String(count(old, k)).padStart(9)} ${String(report[k]).padStart(15)}`);
}

if (!write) {
  console.log("\nNothing written. Run again with --write to merge.");
  process.exit(0);
}

const backup = join(here, `board-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(backup, curRaw);
console.log(`\nSaved the relay's board as it was to ${backup}`);

const put = await fetch(`${relay}/kv/${encodeURIComponent(BOARD_KEY)}`, {
  method: "PUT", headers: H, body: JSON.stringify({ value: JSON.stringify(out) }),
});
if (!put.ok) { console.error(`Write failed (${put.status}). Nothing changed.`); process.exit(1); }
console.log(`Merged. Reload https://thrive-leadtech.pages.dev to see it.
To undo: node push-board.mjs ${backup}`);
