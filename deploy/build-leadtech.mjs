/**
 * Builds a Cloudflare Pages copy of the Lead Tech Fulfillment board with
 * the relay switched on.
 *
 *   node build-leadtech.mjs https://thrive-relay.you.workers.dev \
 *     [--onboarding https://thrive-onboarding.pages.dev]
 *
 * The board was compiled with a relay client already in it, reading
 * VITE_RELAY_URL at build time. That variable was empty, so the client
 * sits dormant and the board keeps its record in browser storage, where
 * nothing else can reach it. This rewrites that one expression to a
 * literal URL, which turns the client on: from then on the board reads
 * and writes through GET|PUT /kv/:key and the console sees every change.
 *
 * Nothing else in the bundle is touched — the patch is asserted to match
 * exactly once, and the build fails loudly if the bundle ever changes
 * shape, rather than silently producing a board that saves nowhere.
 *
 * With --onboarding it also splices in the Onboarding tab, which is a
 * separate patch with its own assertions — see patch-onboarding.mjs.
 *
 * Input:  deploy/_leadtech-content.html   (the published board's content)
 * Output: deploy/dist-leadtech/index.html
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { patchOnboarding } from "./patch-onboarding.mjs";
import { patchSync } from "./patch-sync.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const relay = (argv.find((a) => /^https:\/\//.test(a)) || "").replace(/\/+$/, "");
const onboardingArg = argv.indexOf("--onboarding");
const onboardingUrl = onboardingArg < 0 ? "" : (argv[onboardingArg + 1] || "").replace(/\/+$/, "");

if (!relay) {
  console.error("Usage: node build-leadtech.mjs https://thrive-relay.<subdomain>.workers.dev [--onboarding https://thrive-onboarding.pages.dev]");
  process.exit(1);
}
if (!/^https:\/\//.test(relay)) {
  console.error("The relay URL must start with https://");
  process.exit(1);
}

const sourcePath = join(here, "_leadtech-content.html");
if (!existsSync(sourcePath)) {
  console.error(`Missing ${sourcePath}.

That file is the published board's own content and is deliberately not in
git. Get it by reading the Lead Tech artifact, then taking everything
between "<body>\\n" and "\\n</body></html>" from the saved HTML.`);
  process.exit(1);
}

const source = readFileSync(sourcePath, "utf8");

/* The relay URL the Vite build emitted. Minified names move between
   builds, so the binding is derived rather than hardcoded: find the one
   String(...) over VITE_RELAY_URL / VITE_STORAGE_URL and keep whatever
   name it was assigned to. Anything after the closing paren -- a
   .replace() trimming a trailing slash, say -- is outside the match and
   survives untouched. */
const RELAY_EXPR =
  /([A-Za-z_$][\w$]*)=String\(\(([A-Za-z_$][\w$]*)==null\?void 0:\2\.VITE_RELAY_URL\)\|\|\(\2==null\?void 0:\2\.VITE_STORAGE_URL\)\|\|""\)/g;

const found = [...source.matchAll(RELAY_EXPR)];
if (found.length !== 1) {
  const already = /=String\("https:\/\//.test(source);
  console.error(`Expected exactly one relay-URL expression in the bundle, found ${found.length}.${
    already ? "\nThe bundle already holds a literal https URL there, so it looks patched already." : ""
  }
The board has been rebuilt since this script was written. Do not guess --
re-derive the patch from the current bundle before deploying.`);
  process.exit(1);
}

const [relayExpr, relayBinding] = found[0];
let patched = source.replace(relayExpr, `${relayBinding}=String(${JSON.stringify(relay)})`);

console.error("Fixing the order sync:");
patched = patchSync(patched, { log: (m) => console.error(m) });

if (onboardingUrl) {
  if (!/^https:\/\//.test(onboardingUrl)) {
    console.error("The onboarding URL must start with https://");
    process.exit(1);
  }
  console.error("Splicing in the Onboarding tab:");
  try {
    patched = patchOnboarding(patched, onboardingUrl, { log: (m) => console.error(m) });
  } catch (e) {
    console.error("\n" + e.message + "\n");
    process.exit(1);
  }
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html, body { margin: 0; padding: 0; }
  img { max-width: 100%; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
${patched}
</body>
</html>
`;

mkdirSync(join(here, "dist-leadtech"), { recursive: true });
writeFileSync(join(here, "dist-leadtech", "index.html"), html);

console.log(`Wrote deploy/dist-leadtech/index.html  (${(html.length / 1024).toFixed(0)} KB)
Relay: ${relay}${onboardingUrl ? "\nOnboarding: " + onboardingUrl : "\nOnboarding tab: not included (pass --onboarding <url>)"}

Next:
  npx wrangler pages deploy ./dist-leadtech --project-name thrive-leadtech

Then add the URL Pages prints to ALLOWED_ORIGINS in wrangler.toml and run
"npx wrangler deploy", or the board's calls to the relay will be refused.`);
