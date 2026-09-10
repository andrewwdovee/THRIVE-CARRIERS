/**
 * Builds a preview copy of the console to publish as an artifact.
 *
 *   node build-preview.mjs <loa-snapshot.json> <leadtech-board.json>
 *
 * Same idea as the desk's preview: a copy that carries its data in the
 * page, writes nowhere, and cannot reach the relay — so a change can be
 * looked at before it goes to the live console.
 *
 * Output: deploy/preview.html
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const [loaFile, ltFile] = process.argv.slice(2);

if (!loaFile || !existsSync(loaFile)) {
  console.error("Usage: node build-preview.mjs <loa-snapshot.json> [leadtech-board.json]");
  process.exit(1);
}

/* The console reads these two documents and nothing else. */
const data = { "snapshots/loa": JSON.parse(readFileSync(loaFile, "utf8")) };
if (ltFile && existsSync(ltFile)) data["snapshots/leadtech"] = JSON.parse(readFileSync(ltFile, "utf8"));

const favicon = existsSync(join(here, "favicon.png"))
  ? "data:image/png;base64," + readFileSync(join(here, "favicon.png")).toString("base64")
  : "";

const source = readFileSync(join(here, "..", "admin-portal", "thrive-command.html"), "utf8");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Thrive Command</title>
${favicon ? `<link rel="icon" type="image/png" href="${favicon}">` : ""}
<style>
  :root { color-scheme: light dark; }
  html, body { margin: 0; padding: 0; }
  body { font: 14px system-ui, -apple-system, "Segoe UI", sans-serif; }
  img { max-width: 100%; }
  [hidden] { display: none !important; }
</style>
<script>window.THRIVE_PREVIEW_DATA = ${JSON.stringify(data)};</script>
</head>
<body>
${source}
</body>
</html>
`;

writeFileSync(join(here, "preview.html"), html);
const n = (k) => (Array.isArray(data["snapshots/loa"]?.[k]) ? data["snapshots/loa"][k].length : 0);
console.log(`Wrote deploy/preview.html  (${(html.length / 1024).toFixed(0)} KB)
LOA:      ${n("agents")} agents · ${n("deals")} deals · ${n("calls")} call days
Lead Tech: ${data["snapshots/leadtech"] ? "included" : "not included"}`);
