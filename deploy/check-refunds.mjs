/**
 * Reports what the relay returns for the refund sheet.
 *
 *   node check-refunds.mjs
 *
 * The slips are written by POST /refund-request and read back by
 * GET /refund-requests, which is one of only two places in the relay
 * that lists a key prefix rather than fetching one key. So the refund
 * sheet can come back empty while every other screen in the portal is
 * fine, and neither app says why. This asks the relay directly and
 * prints the answer, including which store it is reading from.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const here = dirname(fileURLToPath(import.meta.url));
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

/* Which store is live, before anything else -- a refund sheet read out of
   the wrong store is empty for a reason no amount of staring finds. */
try {
  const h = await (await fetch(`${relay}/health`)).json();
  const c = h.config || {};
  console.log(`Backend: ${c.backend}   KV namespace bound: ${c.kv}`);
  if (Array.isArray(h.missing) && h.missing.length) {
    console.log(`Missing configuration: ${h.missing.join(", ")}`);
  }
} catch (e) {
  console.log(`Could not read /health: ${e.message}`);
}
console.log("");

/* THRIVE_PASSWORD skips the prompt, for a shell where the hidden prompt
   misbehaves. It lands in shell history, so the prompt stays the default. */
let password = process.env.THRIVE_PASSWORD || "";
while (!password) {
  password = (await askHidden("Password: ")).trim();
  if (!password) console.log("Nothing was entered -- type the password, then press Return.");
}
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

const res = await fetch(`${relay}/refund-requests`, {
  headers: { Authorization: `Bearer ${auth.token}` },
});
const text = await res.text();
console.log(`\n=== GET /refund-requests ===`);
console.log(`  HTTP ${res.status}  ${text.length} bytes`);

let rows;
try { rows = JSON.parse(text); } catch {
  console.log(`  body is not JSON: ${text.slice(0, 400)}`);
  process.exit(0);
}
if (!Array.isArray(rows)) {
  console.log(`  body is not a list: ${JSON.stringify(rows).slice(0, 400)}`);
  process.exit(0);
}

console.log(`  ${rows.length} slip${rows.length === 1 ? "" : "s"}`);
if (!rows.length) {
  console.log(`
  The table has slips but the relay returned none, so the listing is
  the problem and not the data. Nothing has been lost.`);
  process.exit(0);
}
for (const r of rows.slice(0, 10)) {
  const when = new Date(r.at).toISOString().slice(0, 16).replace("T", " ");
  console.log(`  ${when}  ${r.first} ${r.last}  ${r.kind}  ${(r.calls || []).length} call(s)  ${r.email}`);
}
if (rows.length > 10) console.log(`  ... and ${rows.length - 10} more`);
