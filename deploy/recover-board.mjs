/**
 * Finds every copy of the Lead Tech board and says which one is richest.
 *
 *   node recover-board.mjs              # look, change nothing
 *   node recover-board.mjs --restore    # write the best copy back
 *
 * Four pages of the portal -- calls, wallets, refunds, completed -- are
 * four lists inside one record. Lose the record and all four reset
 * together, and orders that were marked complete come back, because the
 * list that remembers completing them went with it.
 *
 * There is more than one copy of that record: the live store the relay
 * reads, a snapshot key the console prefers over it, and whatever
 * Cloudflare KV still holds from before the move to Supabase. This
 * prints all of them side by side so the newest is a fact rather than a
 * guess, and --restore writes the richest one back over the live key.
 *
 * Nothing is deleted. --restore saves the current live record first, to
 * a file, so the restore itself can be undone.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const here = dirname(fileURLToPath(import.meta.url));
const RESTORE = process.argv.includes("--restore");

const LIVE_KEY = "fulfillment_board_v3";       /* the board's own record */
const SNAP_KEY = "snapshots.leadtech";         /* read first by the console */
const LISTS = ["orders", "products", "calls", "refunds", "wipes"];

const toml = readFileSync(join(here, "wrangler.toml"), "utf8");
const email = (toml.match(/^OWNER_EMAIL\s*=\s*"([^"]+)"/m) || [])[1];
const nsId = (toml.match(/^\s*id\s*=\s*"([0-9a-f]{32})"/m) || [])[1];

let relay = process.env.THRIVE_RELAY || "";
try {
  const built = readFileSync(join(here, "dist", "index.html"), "utf8");
  relay = relay || JSON.parse((built.match(/window\.THRIVE_RELAY = ("(?:[^"\\]|\\.)*")/) || [])[1]);
} catch {}
if (!relay || !email) {
  console.error("Could not work out the relay URL or owner email. Run `node build-pages.mjs` first.");
  process.exit(1);
}

function askHidden(q) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const onData = () => process.stdout.write("\x1B[2K\x1B[200D" + q + "*".repeat(rl.line.length));
    process.stdin.on("data", onData);
    rl.question(q, (a) => { process.stdin.removeListener("data", onData); rl.close(); process.stdout.write("\n"); resolve(a); });
  });
}

/* ---- what a copy holds ----
   Per list, never as one total. Two copies of this board turned out to
   be two different halves -- one had the current orders and no calls,
   refunds or completions, the other had all of those and orders a
   fortnight stale. Summing the lists made the stale one look "richer",
   and restoring it traded fresh orders for old ones. A total cannot see
   that. Each list is compared on its own, and a copy is only safe to
   write over the live board when it is at least as full in every one. */
function weigh(rec) {
  if (!rec || typeof rec !== "object") return null;
  const counts = {};
  let total = 0;
  for (const k of LISTS) {
    const n = Array.isArray(rec[k]) ? rec[k].length : 0;
    counts[k] = n; total += n;
  }
  return { counts, total, updatedAt: when(rec.updatedAt) };
}

/* updatedAt is epoch milliseconds on some copies and an ISO string on
   others. Printed raw it came out as "1793030009348", which tells
   nobody which copy is older -- the one thing the reader needs. */
function when(v) {
  if (v == null || v === "") return null;
  const d = new Date(typeof v === "number" || /^\d+$/.test(String(v)) ? Number(v) : String(v));
  return isNaN(d) ? String(v) : d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

/* a is safe to put over b only if it loses nothing in any list */
function dominates(a, b) {
  if (!b) return true;
  return LISTS.every((k) => a.counts[k] >= b.counts[k]);
}

function show(label, c) {
  if (!c) return console.log(`  ${label.padEnd(26)} absent`);
  const detail = LISTS.map((k) => `${k} ${c.counts[k]}`).join(" · ");
  console.log(`  ${label.padEnd(26)} ${String(c.total).padStart(5)} rows   ${c.updatedAt || "no timestamp"}`);
  console.log(`  ${"".padEnd(26)} ${detail}`);
}

console.log(`Relay: ${relay}\nSigning in as: ${email}\n`);

let password = process.env.THRIVE_PASSWORD || "";
while (!password) {
  password = (await askHidden("Password: ")).trim();
  if (!password) console.log("Nothing was entered -- type the password, then press Return.");
}

const login = await fetch(`${relay}/auth/login`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});
const auth = await login.json().catch(() => ({}));
if (!login.ok || !auth.token) {
  console.error(`\nSign-in failed: ${auth.error || login.status}`);
  process.exit(1);
}
const bearer = { Authorization: `Bearer ${auth.token}` };

async function fromRelay(key) {
  const res = await fetch(`${relay}/kv/${encodeURIComponent(key)}`, { headers: bearer });
  if (!res.ok) return null;
  const body = await res.json().catch(() => ({}));
  try { return typeof body.value === "string" ? JSON.parse(body.value) : body.value; }
  catch { return null; }
}

function fromKV(key) {
  if (!nsId) return null;
  try {
    const out = execFileSync("npx", [
      "wrangler", "kv", "key", "get", `--namespace-id=${nsId}`, `kv:${key}`, "--remote",
    ], { cwd: here, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
    return JSON.parse(out);
  } catch { return null; }
}

const copies = [
  { label: "relay · live board", key: LIVE_KEY, rec: await fromRelay(LIVE_KEY) },
  { label: "relay · snapshot", key: SNAP_KEY, rec: await fromRelay(SNAP_KEY) },
  { label: "Cloudflare KV · board", key: LIVE_KEY, rec: fromKV(LIVE_KEY), kv: true },
  { label: "Cloudflare KV · snapshot", key: SNAP_KEY, rec: fromKV(SNAP_KEY), kv: true },
];

console.log("\n=== every copy of the board ===");
for (const c of copies) { c.weight = weigh(c.rec); show(c.label, c.weight); }

const live = copies[0].weight;
const snap = copies[1].weight;
if (snap) {
  console.log(`
  NOTE: the console reads ${SNAP_KEY} first and only falls back to
  ${LIVE_KEY} when it is absent. While that snapshot exists it is what
  the portal shows, however much the live board holds.`);
}

const others = copies.slice(1).filter((c) => c.weight && c.weight.total > 0);
if (!others.length) {
  console.log("\nNo other copy holds any rows. Nothing here to restore from.");
  process.exit(0);
}

/* Only a copy that loses nothing may be written over the live board.
   Anything else is a trade, and a trade is a merge, not a restore. */
const best = others
  .filter((c) => dominates(c.weight, live))
  .sort((a, b) => b.weight.total - a.weight.total)[0];

if (!best) {
  console.log(`
=== these copies are different halves, not better and worse ===

No other copy is at least as full as the live board in every list, so
none of them can be written over it without losing something. A restore
here would trade one gap for another.`);
  for (const c of others) {
    const loses = LISTS.filter((k) => c.weight.counts[k] < live.counts[k]);
    const gains = LISTS.filter((k) => c.weight.counts[k] > live.counts[k]);
    const fmt = (ks) => ks.map((k) => `${k} ${live.counts[k]} -> ${c.weight.counts[k]}`).join(", ");
    console.log(`
  ${c.label}
    would restore: ${gains.length ? fmt(gains) : "nothing"}
    would lose:    ${loses.length ? fmt(loses) : "nothing"}`);
  }
  console.log(`
Merge instead -- it keeps every row the live board already has and adds
only what is missing, matching orders by id and by Stripe payment.
Write the copy you want to draw from to a file whose name starts with
"board" (anything else is not gitignored, and this repository is
public), then look before writing:

  node merge-board.mjs deploy/board-<name>.json
  node merge-board.mjs deploy/board-<name>.json --write`);
  process.exit(2);
}

console.log(`\nSafe to restore: ${best.label} -- ${best.weight.total} rows, ${best.weight.updatedAt || "no timestamp"}`);
console.log(`It is at least as full as the live board (${live ? live.total : 0} rows) in every list, so nothing is traded away.`);

if (!RESTORE) {
  console.log(`
Run it again with --restore to write that copy over ${LIVE_KEY}.
The record being replaced is saved to a file first, so it can be undone.`);
  process.exit(0);
}

/* Keep what is about to be overwritten. A restore that turns out to be
   the wrong choice must not be the end of the other copy. */
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backup = join(here, `board-before-restore-${stamp}.json`);
writeFileSync(backup, JSON.stringify(copies[0].rec ?? null, null, 2));
console.log(`\nSaved the record being replaced to:\n  ${backup}`);

const put = await fetch(`${relay}/kv/${encodeURIComponent(LIVE_KEY)}`, {
  method: "PUT",
  headers: { ...bearer, "Content-Type": "application/json" },
  body: JSON.stringify({ value: JSON.stringify(best.rec) }),
});
if (!put.ok) {
  console.error(`\nRestore failed: ${put.status} ${await put.text()}`);
  process.exit(1);
}
console.log(`Restored ${best.weight.total} rows from ${best.label}.`);

if (snap) {
  console.log(`
One thing left: ${SNAP_KEY} still exists and the console reads it
first, so the portal will keep showing that snapshot rather than what
was just restored. Clear it with:

  node check-board.mjs --clear-snapshot`);
}
