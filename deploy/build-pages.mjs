/**
 * Builds the Cloudflare Pages copy of the console.
 *
 *   node build-pages.mjs https://thrive-relay.you.workers.dev
 *
 * The console source is one file that works in both homes. On claude.ai
 * the platform wraps it in a document skeleton and hands it an artifact
 * database; here we do the wrapping ourselves and point it at your relay
 * instead. Same source, no fork.
 *
 * Writes deploy/dist/index.html.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const relay = (process.argv[2] || "").replace(/\/+$/, "");

if (!relay) {
  console.error("Usage: node build-pages.mjs https://thrive-relay.<subdomain>.workers.dev");
  process.exit(1);
}
if (!/^https:\/\//.test(relay)) {
  console.error("The relay URL must start with https:// — the browser will not send credentials over http.");
  process.exit(1);
}

const source = readFileSync(join(here, "..", "admin-portal", "thrive-command.html"), "utf8");

/* Mirrors the head the artifact runtime supplies, so the page renders the
   same in both places: charset, viewport, a light colour-scheme default,
   zero body margin, and the two rules the console's CSS assumes. */
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: light dark; }
  html, body { margin: 0; padding: 0; }
  body { font: 14px system-ui, -apple-system, "Segoe UI", sans-serif; }
  img { max-width: 100%; }
  [hidden] { display: none !important; }
</style>
<script>window.THRIVE_RELAY = ${JSON.stringify(relay)};</script>
</head>
<body>
${source}
</body>
</html>
`;

mkdirSync(join(here, "dist"), { recursive: true });
writeFileSync(join(here, "dist", "index.html"), html);

console.log(`Wrote deploy/dist/index.html  (${(html.length / 1024).toFixed(0)} KB)
Relay: ${relay}

Next:
  wrangler pages deploy ./dist --project-name thrive-command

Then add the Pages URL to ALLOWED_ORIGINS in wrangler.toml and run
"wrangler deploy" again, or the browser's calls will be refused.`);
