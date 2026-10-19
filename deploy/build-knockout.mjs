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

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const DESC = "Single-elimination bracket for the Thrive Companies agent tournament. Live results, week by week.";

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

const site = (process.argv[3] || "https://thrive-knockout.pages.dev").replace(/\/+$/, "");

/* The page's own <title> and the artifact viewport hint belong to its other
   home. Here they would land inside <body>, where a second <title> is a
   quiet mess, so they come out and the real head carries them. */
const source = readFileSync(join(here, "..", "tournament", "thrive-knockout.html"), "utf8")
  .replace(/^<title>[^<]*<\/title>\n/, "")
  .replace(/^<meta name="claude:[^>]*>\n/m, "");

const favicon = existsSync(join(here, "favicon.png"))
  ? "data:image/png;base64," + readFileSync(join(here, "favicon.png")).toString("base64")
  : "";

/* Two sites off one source. The draw sheet is the copy that gets handed
   around; the control room is the one that posts results, and it is a
   separate address so the editing screen is not one tab away from every
   agent who opens the bracket. They read and write the same tournament
   record on the relay, so there is still one tournament. */
const BUILDS = [
  {
    role: "bracket",
    dir: "dist-knockout",
    project: "thrive-knockout",
    title: "Thrive Knockout",
    site: "https://thrive-knockout.pages.dev",
    preview: true,
  },
  {
    role: "control",
    dir: "dist-knockout-control",
    project: "thrive-knockout-control",
    title: "Thrive Knockout Control Room",
    site: "https://thrive-knockout-control.pages.dev",
    preview: false,
  },
];

for (const b of BUILDS) {
  const head = b.preview
    ? `<title>${b.title}</title>
<meta name="description" content="${DESC}">
<meta name="theme-color" content="#0c1118">
<link rel="icon" type="image/png" href="/icon.png">
<link rel="apple-touch-icon" href="/icon.png">
<!-- What a messaging app shows when someone pastes the link. It needs
     absolute URLs: a relative one resolves against the sender's app. -->
<meta property="og:type" content="website">
<meta property="og:site_name" content="Thrive Companies">
<meta property="og:title" content="${b.title}">
<meta property="og:description" content="${DESC}">
<meta property="og:url" content="${b.site}/">
<meta property="og:image" content="${b.site}/og.png">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Thrive Knockout — agent tournament bracket">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${b.title}">
<meta name="twitter:description" content="${DESC}">
<meta name="twitter:image" content="${b.site}/og.png">`
    /* No link preview on the control room, and keep it out of search:
       it is not a page to hand around. */
    : `<title>${b.title}</title>
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#0c1118">
<link rel="icon" type="image/png" href="/icon.png">
<link rel="apple-touch-icon" href="/icon.png">`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${head}
<style>
  :root { color-scheme: light dark; }
  html, body { margin: 0; padding: 0; }
  body { font: 14px system-ui, -apple-system, "Segoe UI", sans-serif; }
  img { max-width: 100%; }
  [hidden] { display: none !important; }
</style>
<script>
window.THRIVE_RELAY = ${JSON.stringify(relay)};
window.THRIVE_ROLE = ${JSON.stringify(b.role)};
</script>
</head>
<body>
${source}
</body>
</html>
`;

  const out = join(here, b.dir);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "index.html"), html);
  copyFileSync(join(here, "favicon.png"), join(out, "icon.png"));
  if (b.preview) copyFileSync(join(here, "..", "tournament", "og-card.png"), join(out, "og.png"));

  console.log(`${b.role.padEnd(8)} -> deploy/${b.dir}/index.html  (${(html.length / 1024).toFixed(0)} KB)`);
}

console.log(`
Relay: ${relay}

Deploy both:
  npx wrangler pages deploy ./dist-knockout         --project-name thrive-knockout         --branch main
  npx wrangler pages deploy ./dist-knockout-control --project-name thrive-knockout-control --branch main

The draw sheet is thrive-knockout.pages.dev; the control room is its own
address and carries no link preview. Both read and write the same record,
so there is one tournament behind the two pages.`);
