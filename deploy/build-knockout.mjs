/**
 * Builds the Cloudflare Pages copy of the knockout board.
 *
 *   node build-knockout.mjs https://thrive-relay.you.workers.dev
 *
 * The board is one file that works in both homes. On claude.ai the platform
 * wraps it in a document skeleton and hands it an artifact database; here we
 * do the wrapping ourselves and point it at your relay instead. Same source,
 * no fork.
 *
 * The page source lives beside the other portals, in tournament/.
 * Writes deploy/dist-knockout/index.html.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/* Rebuilding to pick up a change is the common case, and the relay is the
   same one as last time. Read it back rather than make someone find it. */
function relayFromLastBuild() {
  const built = join(here, "dist-knockout", "index.html");
  if (!existsSync(built)) return "";
  const m = readFileSync(built, "utf8").match(/window\.THRIVE_RELAY = ("(?:[^"\\]|\\.)*")/);
  try { return m ? JSON.parse(m[1]) : ""; } catch { return ""; }
}

const relay = (process.argv[2] || relayFromLastBuild()).replace(/\/+$/, "");
if (!relay) {
  console.error(`Usage: node build-knockout.mjs [relay-url]

The URL is optional once you have built here before -- it is read back from
dist-knockout/index.html. There is no previous build to read it from.`);
  process.exit(1);
}
if (!/^https:\/\//.test(relay)) {
  console.error("The relay URL must start with https:// -- the browser will not send credentials over http.");
  process.exit(1);
}

const source = readFileSync(join(here, "..", "tournament", "thrive-knockout.html"), "utf8");
const favicon = existsSync(join(here, "favicon.png"))
  ? "data:image/png;base64," + readFileSync(join(here, "favicon.png")).toString("base64")
  : "";

/* Mirrors the head the artifact runtime supplies, so the page renders the
   same in both places. */
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${favicon ? `<link rel="icon" type="image/png" href="${favicon}">` : ""}
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

mkdirSync(join(here, "dist-knockout"), { recursive: true });
writeFileSync(join(here, "dist-knockout", "index.html"), html);

console.log(`Wrote deploy/dist-knockout/index.html  (${(html.length / 1024).toFixed(0)} KB)
Relay: ${relay}

Next:
  wrangler pages deploy ./dist-knockout --project-name thrive-knockout --branch main

The relay needs the Pages origin in ALLOWED_ORIGINS and the /tournament
route, so run "wrangler deploy" too if you have not since.`);
