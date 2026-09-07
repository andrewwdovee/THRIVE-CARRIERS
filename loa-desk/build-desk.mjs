/**
 * Builds the Cloudflare Pages copy of the LOA Producer Desk.
 *
 *   node build-desk.mjs <relay-url> <desk-token>
 *
 * The desk normally saves by republishing its own page, which locks its
 * record inside a claude.ai artifact where nothing else can read it. This
 * build injects a storage layer that reads and writes the relay instead,
 * and publishes a scrubbed copy for the owner console on every save.
 *
 * The desk token is scoped by the relay to two keys — it cannot read
 * orders, accounts, or the fulfillment board — which matters because this
 * page is opened by every producer.
 *
 * Output: loa-desk/dist/index.html
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const relay = (process.argv[2] || "").replace(/\/+$/, "");
const token = process.argv[3] || "";

if (!relay || !token) {
  console.error(`Usage: node build-desk.mjs <relay-url> <desk-token>

  relay-url    https://stripe-sync.<subdomain>.workers.dev
  desk-token   the value you set with: wrangler secret put DESK_TOKEN`);
  process.exit(1);
}
if (!/^https:\/\//.test(relay)) {
  console.error("The relay URL must start with https://");
  process.exit(1);
}

const contentPath = join(here, "_desk-content.html");
if (!existsSync(contentPath)) {
  console.error(`Missing ${contentPath} — that is the desk's own content, kept out of git.`);
  process.exit(1);
}

const content = readFileSync(contentPath, "utf8");
const storage = readFileSync(join(here, "relay-storage.js"), "utf8");

/* The storage layer must be defined before the desk's own code runs, and
   the desk reads its state from a script block that has to survive. */
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Thrive LOA Producer Desk</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<style>html,body{margin:0;padding:0}img{max-width:100%}[hidden]{display:none!important}</style>
<script>
window.THRIVE_RELAY = ${JSON.stringify(relay)};
window.THRIVE_DESK_TOKEN = ${JSON.stringify(token)};
</script>
<script>
${storage}
</script>
</head>
<body>
${content}
</body>
</html>
`;

mkdirSync(join(here, "dist"), { recursive: true });
writeFileSync(join(here, "dist", "index.html"), html);

console.log(`Wrote loa-desk/dist/index.html  (${(html.length / 1024).toFixed(0)} KB)
Relay: ${relay}

Next:
  npx wrangler pages deploy ./dist --project-name thrive-loa --branch main

The desk then reads and writes loa.state on the relay, and publishes
snapshots.loa for the console on every save.`);
