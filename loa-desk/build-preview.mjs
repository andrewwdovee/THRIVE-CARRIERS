/**
 * Builds a preview copy of the desk to publish as an artifact.
 *
 *   node build-preview.mjs <state.json>
 *
 * The point of it is to see a change before it goes to the live desk.
 * So this build is deliberately not wired to the relay: it carries its
 * own copy of the book baked into the page, saves nothing anywhere, and
 * cannot touch what producers are using. Click anything, delete anyone —
 * reloading puts it all back.
 *
 * Passwords are re-hashed to one preview password, because the real
 * hashes have no business in a copy that exists to be looked at.
 *
 * Output: loa-desk/preview.html
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { webcrypto as crypto } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const file = process.argv[2];
const PREVIEW_PW = "preview123";
const PW_ITER = 210000;          /* what the desk itself uses */

if (!file || !existsSync(file)) {
  console.error(`Usage: node build-preview.mjs <state.json>

A state file is the desk record: { org, agents, deals, calls, goals }.`);
  process.exit(1);
}

const enc = new TextEncoder();
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
async function hashPw(pw, saltHex) {
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey("raw", enc.encode(pw), { name: "PBKDF2" }, false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: PW_ITER, hash: "SHA-256" }, key, 256));
}

const state = JSON.parse(readFileSync(file, "utf8"));
for (const a of state.agents || []) {
  a.pwSalt = hex(crypto.getRandomValues(new Uint8Array(16)));
  a.pwHash = await hashPw(PREVIEW_PW, a.pwSalt);
  delete a.password;
}

const content = readFileSync(join(here, "desk-app.html"), "utf8");
const style = readFileSync(join(here, "desk-style.css"), "utf8");
const version = existsSync(join(here, "VERSION"))
  ? "v" + readFileSync(join(here, "VERSION"), "utf8").trim()
  : "";

/* Swap the shipped empty state for the one being previewed. */
const open = content.indexOf('<script id="tc-state"');
const start = content.indexOf(">", open) + 1;
const end = content.indexOf("</script>", start);
if (open < 0) { console.error("desk-app.html has no tc-state block."); process.exit(1); }
const body = content.slice(0, start) + JSON.stringify(state) + content.slice(end);

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LOA Producer Desk</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<style id="tc-style">${style}</style>
<script>
window.THRIVE_PREVIEW = true;
window.THRIVE_VERSION = ${JSON.stringify(version + " preview")};
</script>
</head>
<body>
${body}
</body>
</html>
`;

writeFileSync(join(here, "preview.html"), html);
console.log(`Wrote loa-desk/preview.html  (${(html.length / 1024).toFixed(0)} KB)
Version: ${version} preview
Sign in: ${(state.agents || []).map((a) => a.email).join(", ")}
Password: ${PREVIEW_PW}`);
