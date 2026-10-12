/**
 * Copies everything in Cloudflare KV into Supabase, then checks it got
 * there.
 *
 *   export SUPABASE_URL="https://xxxx.supabase.co"
 *   export SUPABASE_SERVICE_KEY="eyJ..."
 *   node migrate-to-supabase.mjs            # say what would happen
 *   node migrate-to-supabase.mjs --write    # do it
 *
 * Nothing is deleted from KV. The relay keeps reading KV until its two
 * Supabase secrets are set, so this can run as many times as you like
 * before the switch, and again afterwards to pick up stragglers. Rows
 * are upserted on the key, so a second run corrects the first rather
 * than duplicating it.
 *
 * Keys that expire -- the rate-limit counters -- are skipped. They are
 * counters for the current hour, they age out on their own, and
 * carrying them over would import a throttle nobody asked for.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const WRITE = process.argv.includes("--write");

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(`Set both first:

  export SUPABASE_URL="https://<your-project>.supabase.co"
  export SUPABASE_SERVICE_KEY="<the service_role key from Settings -> API>"

The service_role key bypasses every rule in the database. It belongs in
this shell and in "wrangler secret put", nowhere else -- never in a page.`);
  process.exit(1);
}

/* Skipped: counters for the current hour. They expire on their own and
   importing them would carry a throttle across for no reason. */
const SKIP = [/^rate:/];

const toml = readFileSync(join(here, "wrangler.toml"), "utf8");
const nsId = (toml.match(/^\s*id\s*=\s*"([0-9a-f]{32})"/m) || [])[1];
if (!nsId) {
  console.error("Could not read the KV namespace id out of wrangler.toml.");
  process.exit(1);
}

function wrangler(args) {
  return execFileSync("npx", ["wrangler", ...args], {
    cwd: here, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/* A newer sb_secret_ key is not a JWT, and sending it as a Bearer token
   gets the request refused with "Invalid JWT". Only a legacy
   service_role key, which is a JWT, goes in that header. */
const headers = {
  apikey: SERVICE_KEY,
  "Content-Type": "application/json",
};
if (/^ey[A-Za-z0-9_-]/.test(SERVICE_KEY)) headers.Authorization = `Bearer ${SERVICE_KEY}`;

async function upsert(rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/kv?on_conflict=key`, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

async function countThere() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/kv?select=key`, {
    headers: { ...headers, Prefer: "count=exact", Range: "0-0" },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status} counting rows`);
  const range = res.headers.get("content-range") || "";
  return Number(range.split("/")[1]) || 0;
}

console.error(`Reading the key list from KV namespace ${nsId} …`);
let keys;
try {
  keys = JSON.parse(wrangler(["kv", "key", "list", `--namespace-id=${nsId}`, "--remote"]));
} catch (e) {
  console.error(`\nCould not list the namespace. Is wrangler signed in?\n${e.message}\n`);
  process.exit(1);
}

const wanted = keys.map((k) => k.name).filter((n) => !SKIP.some((re) => re.test(n)));
const skipped = keys.length - wanted.length;
console.error(`${keys.length} keys, ${wanted.length} to copy${skipped ? `, ${skipped} skipped (expiring counters)` : ""}.`);

if (!WRITE) {
  for (const k of wanted.slice(0, 40)) console.error("  " + k);
  if (wanted.length > 40) console.error(`  … and ${wanted.length - 40} more`);
  console.error(`\nNothing written. Re-run with --write to copy them.`);
  process.exit(0);
}

const before = await countThere();
let done = 0, bytes = 0, batch = [];

/* Batched, but by size as well as count: one board record runs to
   megabytes and a batch of a hundred of those is a request nothing will
   accept. */
async function flush() {
  if (!batch.length) return;
  await upsert(batch);
  done += batch.length;
  process.stderr.write(`\r  copied ${done}/${wanted.length}`);
  batch = [];
}

for (const key of wanted) {
  let value;
  try {
    value = wrangler(["kv", "key", "get", key, `--namespace-id=${nsId}`, "--remote"]);
  } catch {
    console.error(`\n  ! could not read ${key} — skipped`);
    continue;
  }
  bytes += value.length;
  batch.push({ key, value, expires_at: null, updated_at: new Date().toISOString() });
  if (batch.length >= 50 || batch.reduce((n, r) => n + r.value.length, 0) > 4e6) await flush();
}
await flush();

const after = await countThere();
console.error(`\n
Copied   ${done} keys, ${(bytes / 1024 / 1024).toFixed(1)} MB
In kv     ${before} rows before, ${after} after

Nothing was removed from Cloudflare KV. The relay keeps reading KV until
you set its two Supabase secrets, so you can run this again right before
you switch to pick up anything written in between.`);

if (after < wanted.length) {
  console.error(`\nFewer rows than keys copied. Check the ones reported above before switching over.`);
  process.exit(1);
}
