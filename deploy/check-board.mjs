/**
 * Reports what the relay is actually holding for Lead Tech.
 *
 *   node check-board.mjs
 *
 * The console shows calls bought but not calls sold. The board writes
 * both, and the console reads both, so the answer is in the stored
 * record rather than in either app. This prints it.
 *
 * It checks two keys, because the console prefers one over the other:
 *
 *   snapshots.leadtech      read first if it exists at all
 *   fulfillment_board_v3    the board's own record, used only when it does not
 *
 * A stale snapshots.leadtech silently shadows the live board, which is
 * one of the ways this symptom happens.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const here = dirname(fileURLToPath(import.meta.url));
const toml = readFileSync(join(here, "wrangler.toml"), "utf8");
const email = (toml.match(/^OWNER_EMAIL\s*=\s*"([^"]+)"/m) || [])[1];

/* Read the relay URL out of the console build, so there is nothing to retype. */
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
const password = await askHidden("Password: ");

const login = await fetch(`${relay}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});
const auth = await login.json().catch(() => ({}));
if (!login.ok || !auth.token) {
  console.error(`\nSign-in failed: ${auth.error || login.status}`);
  process.exit(1);
}

async function read(key) {
  const res = await fetch(`${relay}/kv/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  if (res.status === 404) return { missing: true };
  if (!res.ok) return { error: `${res.status}` };
  const body = await res.json().catch(() => ({}));
  try { return { value: typeof body.value === "string" ? JSON.parse(body.value) : body.value }; }
  catch { return { error: "stored value is not JSON" }; }
}

function describe(name, r) {
  console.log(`\n=== ${name} ===`);
  if (r.missing) return console.log("  not present");
  if (r.error) return console.log(`  could not read: ${r.error}`);
  const v = r.value || {};
  const rows = Array.isArray(v.calls) ? v.calls : [];
  console.log(`  ${rows.length} call day${rows.length === 1 ? "" : "s"}` +
    (v.updatedAt ? ` · last written ${v.updatedAt}` : ""));
  if (!rows.length) return;
  console.log("  the five most recent rows, exactly as stored:");
  rows.slice().sort((a, b) => String(b.day || b.date || "").localeCompare(String(a.day || a.date || "")))
    .slice(0, 5)
    .forEach((row) => console.log("    " + JSON.stringify(row)));
  const sum = (k) => rows.reduce((t, x) => t + (Number(x[k]) || 0), 0);
  console.log(`  totals across every row: billable ${sum("billable")} · sold ${sum("sold")} · calls ${sum("calls")}`);
  const keys = [...new Set(rows.flatMap((x) => Object.keys(x)))];
  console.log(`  field names present: ${keys.join(", ")}`);
}

const snap = await read("snapshots.leadtech");
const board = await read("fulfillment_board_v3");
describe("snapshots.leadtech", snap);
describe("fulfillment_board_v3", board);

console.log("\n=== which one the console is reading ===");
if (!snap.missing && !snap.error) {
  console.log("  snapshots.leadtech — it exists, so the console reads it and never");
  console.log("  looks at the live board. If its numbers are stale, that is the cause.");
} else {
  console.log("  fulfillment_board_v3 — the live board, because no snapshot shadows it.");
}
