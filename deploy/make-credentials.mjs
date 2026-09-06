/**
 * Generates the three secrets the relay needs.
 *
 *   node make-credentials.mjs "your-owner-password"
 *
 * Prints a salt, a PBKDF2-SHA256 hash of the password over that salt, and
 * a random token-signing secret. The password itself is never stored
 * anywhere — only the hash goes to Cloudflare, so someone who reads your
 * worker config still cannot sign in as you.
 */

import { webcrypto as crypto } from "node:crypto";

const password = process.argv[2];
if (!password) {
  console.error('Usage: node make-credentials.mjs "your-owner-password"');
  process.exit(1);
}
if (password.length < 12) {
  console.error("Use at least 12 characters — this is the only lock on the relay.");
  process.exit(1);
}

/* Cloudflare Workers refuse PBKDF2 above 100,000 iterations, and the
   relay is where this hash gets checked. A hash generated at a higher
   count simply cannot be verified there. */
const ITER = 100000;
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

const saltBytes = crypto.getRandomValues(new Uint8Array(16));
const salt = hex(saltBytes);

const key = await crypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveBits"]);
const hash = hex(await crypto.subtle.deriveBits(
  { name: "PBKDF2", salt: saltBytes, iterations: ITER, hash: "SHA-256" }, key, 256
));

const tokenSecret = hex(crypto.getRandomValues(new Uint8Array(32)));

console.log(`
Run each of these and paste the value when wrangler prompts you.

  wrangler secret put OWNER_PASSWORD_SALT
    ${salt}

  wrangler secret put OWNER_PASSWORD_HASH
    ${hash}

  wrangler secret put TOKEN_SECRET
    ${tokenSecret}

Also set OWNER_EMAIL in wrangler.toml, and keep OWNER_PASSWORD_ITER at ${ITER}.
Your password is not printed here and is not stored anywhere — if you lose
it, rerun this script with a new one and replace the two secrets.
`);
