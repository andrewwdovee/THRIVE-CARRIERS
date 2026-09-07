/**
 * Seeds the relay with your existing LOA desk record.
 *
 *   node seed-desk.mjs <relay-url> <desk-token> <snapshot.json>
 *
 * The desk build ships with an empty state — the live record lives in the
 * relay. This puts your current one there, so producers open the new desk
 * and find their own numbers rather than a blank slate.
 *
 * Agents keep their original ids, which is what matters: every deal and
 * call row references an agent by id, so re-creating accounts by hand
 * would orphan the entire book. Their password hashes were deliberately
 * stripped from the snapshot, so this sets one password across the
 * seeded accounts; each person changes it in the desk afterwards.
 *
 * Writes both keys the desk uses:
 *   loa.state       what the desk itself reads
 *   snapshots.loa   the scrubbed copy the console reads
 */

import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { webcrypto as crypto } from "node:crypto";

const [relayArg, token, file] = process.argv.slice(2);
if (!relayArg || !token || !file) {
  console.error("Usage: node seed-desk.mjs <relay-url> <desk-token> <snapshot.json>");
  process.exit(1);
}
const relay = relayArg.replace(/\/+$/, "");

/* Matches the desk's own hashing, so the accounts it writes are ones the
   desk will accept. */
const PW_ITER = 210000;
const enc = new TextEncoder();
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

async function hashPw(password, saltHex) {
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: PW_ITER, hash: "SHA-256" }, key, 256));
}

const snap = JSON.parse(readFileSync(file, "utf8"));
const agents = snap.agents || [];
const deals = snap.deals || [];
const calls = snap.calls || [];

if (!agents.length && !deals.length) {
  console.error(`${file} has no agents or deals — is that the right snapshot?`);
  process.exit(1);
}

console.log(`Relay:    ${relay}
Snapshot: ${file}
          ${agents.length} agents · ${deals.length} deals · ${calls.length} call days
`);
agents.forEach((a) => console.log(`          ${a.email || "(no email)"}  ${a.name || ""}`));

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const onData = () => process.stdout.write("\x1B[2K\x1B[200D" + question + "*".repeat(rl.line.length));
    process.stdin.on("data", onData);
    rl.question(question, (a) => { process.stdin.removeListener("data", onData); rl.close(); process.stdout.write("\n"); resolve(a); });
  });
}

const password = await askHidden("\nPassword to set for those accounts (min 8): ");
if (!password || password.length < 8) {
  console.error("Too short. Nothing was written.");
  process.exit(1);
}

const seededAgents = [];
for (const a of agents) {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  seededAgents.push({ ...a, pwSalt: salt, pwHash: await hashPw(password, salt) });
}

const state = {
  version: snap.sourceVersion || 6,
  org: snap.org || {},
  agents: seededAgents,
  calls,
  deals,
  goals: snap.goals || { org: {}, byAgent: {} },
  updatedAt: new Date().toISOString(),
};

async function put(key, obj) {
  const res = await fetch(`${relay}/kv/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ value: JSON.stringify(obj) }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`${key}: ${res.status} ${body.error || ""}`);
  }
}

try {
  await put("loa.state", state);
  /* The console's copy, with the hashes left out again. */
  const scrubbed = { ...snap, syncedAt: new Date().toISOString(), syncedBy: "seeded" };
  scrubbed.agents = agents.map(({ pwSalt, pwHash, ...rest }) => rest);
  await put("snapshots.loa", scrubbed);
} catch (e) {
  console.error(`\nWrite failed — ${e.message}`);
  console.error("A 403 means the desk token is wrong or the relay has not been redeployed with it.");
  process.exit(1);
}

console.log(`
Seeded. Open the desk and sign in with any of those emails and the password
you just set. Each person can change theirs under their own account.

The console picks the numbers up on its next poll, within a minute.`);
