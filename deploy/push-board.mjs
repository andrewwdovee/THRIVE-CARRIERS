/**
 * Pushes a Lead Tech board record into the relay.
 *
 *   node push-board.mjs board.json
 *
 * The board keeps its whole record in browser storage under one key, and
 * it can only export orders — so moving an existing board to the relay
 * means lifting that record out by hand and putting it back where the
 * new copy will look. This does the second half.
 *
 * Reads the relay URL and owner email from wrangler.toml so there is
 * nothing to retype. Asks for the password, signs in, and writes the file
 * to the key the board reads on startup.
 *
 * Afterwards the new board loads that record on sign-in, and the console
 * picks it up on its next poll.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const here = dirname(fileURLToPath(import.meta.url));
const BOARD_KEY = "fulfillment_board_v3";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node push-board.mjs <board.json>");
  process.exit(1);
}

/* Relay URL and email live in wrangler.toml — read them rather than
   making someone retype values they have already set once. */
const toml = readFileSync(join(here, "wrangler.toml"), "utf8");
const email = (toml.match(/^OWNER_EMAIL\s*=\s*"([^"]+)"/m) || [])[1];
const workerName = (toml.match(/^name\s*=\s*"([^"]+)"/m) || [])[1];
if (!email || email === "you@example.com") {
  console.error("OWNER_EMAIL is not set in wrangler.toml.");
  process.exit(1);
}

const relay = process.env.THRIVE_RELAY
  || `https://${workerName}.${process.env.CF_SUBDOMAIN || "aandrewdavidson"}.workers.dev`;

/* The board stores its record as a JSON string. Parse it here only to
   fail early on a truncated copy-paste — the string itself is what gets
   sent, byte for byte. */
const raw = readFileSync(file, "utf8").trim();
let parsed;
try {
  parsed = JSON.parse(raw);
} catch (e) {
  console.error(`${file} is not valid JSON — the copy was probably truncated.\n${e.message}`);
  process.exit(1);
}
if (!parsed || typeof parsed !== "object" || (!parsed.orders && !parsed.products && !parsed.calls)) {
  console.error(`${file} does not look like a board record.
Expected an object with orders / products / calls. Got keys: ${Object.keys(parsed || {}).join(", ") || "none"}`);
  process.exit(1);
}

const counts = ["orders", "products", "refunds", "wipes", "calls", "customers", "blocks"]
  .map((k) => `${Array.isArray(parsed[k]) ? parsed[k].length : 0} ${k}`)
  .join(" · ");

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const onData = (char) => {
      if (["\n", "\r", ""].includes(String(char))) process.stdin.removeListener("data", onData);
      else process.stdout.write("[2K[200D" + question + "*".repeat(rl.line.length));
    };
    process.stdin.on("data", onData);
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

console.log(`Relay:  ${relay}
Signing in as: ${email}
Board:  ${file}
        ${counts}
`);

const password = await askHidden("Password: ");

const login = await fetch(`${relay}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});
const auth = await login.json().catch(() => ({}));
if (!login.ok || !auth.token) {
  console.error(`Sign-in failed: ${auth.error || login.status}`);
  process.exit(1);
}

const put = await fetch(`${relay}/kv/${encodeURIComponent(BOARD_KEY)}`, {
  method: "PUT",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.token}` },
  body: JSON.stringify({ value: raw }),
});
const result = await put.json().catch(() => ({}));
if (!put.ok) {
  console.error(`Write failed (${put.status}): ${result.error || "unknown"}`);
  process.exit(1);
}

console.log(`Pushed ${(raw.length / 1024).toFixed(0)} KB to ${BOARD_KEY}.

Open the new board and sign in — the record loads from the relay.
The console picks it up on its next poll, within a minute.`);
