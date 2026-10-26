/**
 * Proves a new record reaches Supabase, and survives being deleted.
 *
 *   node verify-archive.mjs
 *
 * Adding a row through the portal and hunting for it in SQL takes two
 * apps and a stopwatch. This does the same thing from one command: it
 * adds one call to the board, saves it, deletes it again, and prints
 * what the relay reported at each step -- including how many records
 * it wrote out to board_rows, which is the number that says the
 * archive ran.
 *
 * The board is left exactly as it was found. The test row is removed
 * from the board at the end; it stays in board_rows on purpose, which
 * is the whole point of the archive and the thing worth seeing.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const here = dirname(fileURLToPath(import.meta.url));
const KEY = "fulfillment_board_v3";

const toml = readFileSync(join(here, "wrangler.toml"), "utf8");
const email = (toml.match(/^OWNER_EMAIL\s*=\s*"([^"]+)"/m) || [])[1];
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
const H = { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" };

async function readBoard() {
  const res = await fetch(`${relay}/kv/${encodeURIComponent(KEY)}`, { headers: H });
  if (!res.ok) throw new Error(`Could not read the board: ${res.status}`);
  return JSON.parse((await res.json()).value);
}
async function writeBoard(rec) {
  const res = await fetch(`${relay}/kv/${encodeURIComponent(KEY)}`, {
    method: "PUT", headers: H, body: JSON.stringify({ value: JSON.stringify(rec) }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const before = await readBoard();
const had = Array.isArray(before.calls) ? before.calls.length : 0;
console.log(`The board has ${had} call(s) right now.\n`);

const id = `cl_verify_${Date.now().toString(36)}`;
const today = new Date().toISOString().slice(0, 10);

/* Step one: a record that did not exist a moment ago. */
const withTest = { ...before, calls: [...(before.calls || []), { id, day: today, billable: 999, at: Date.now() }] };
const add = await writeBoard(withTest);
console.log("=== adding one call ===");
console.log(`  HTTP ${add.status}   archived ${add.body.archived} record(s)   version filed: ${add.body.filed}`);
if (add.status !== 200) {
  console.error(`  The save was refused: ${add.body.error || ""} ${add.body.detail || ""}`);
  process.exit(1);
}
if (!add.body.archived) {
  console.error(`
  The save worked but nothing was archived. Either the board_rows
  table is missing, or this relay is older than the archive. Nothing
  has been left behind -- run the schema and deploy, then try again.`);
}

/* Step two: take it away again, which is what the portal would do. */
const after = await readBoard();
const cleaned = { ...after, calls: (after.calls || []).filter((c) => c && c.id !== id) };
const remove = await writeBoard(cleaned);
console.log("\n=== deleting it again ===");
console.log(`  HTTP ${remove.status}   the board is back to ${cleaned.calls.length} call(s)`);
if (remove.status !== 200) {
  console.error(`  The delete was refused: ${remove.body.error || ""} ${remove.body.detail || ""}`);
  console.error(`  The test row ${id} is still on the board -- remove it in the portal.`);
  process.exit(1);
}

const final = await readBoard();
const still = (final.calls || []).some((c) => c && c.id === id);
console.log(`  Gone from the board: ${!still ? "yes" : "NO -- remove " + id + " by hand"}`);
console.log(`  Call count back to what it was: ${(final.calls || []).length === had ? "yes" : "no"}`);

console.log(`
=== now the part that matters ===

The record is off the board. If the archive is doing its job it is
still in Supabase. Paste this into the SQL editor:

  select id, data->>'billable' as billable, first_seen
  from public.board_rows
  where id = '${id}';

One row back means a record deleted from the portal survives in
Supabase, which is the protection you asked for. No rows means the
archive is not keeping anything and I need to know.`);
