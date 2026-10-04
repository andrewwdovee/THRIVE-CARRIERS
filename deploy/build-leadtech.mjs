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

/* The exact expression the Vite build emitted for the relay URL. */
const NEEDLE = 'fn=String((Fn==null?void 0:Fn.VITE_RELAY_URL)||(Fn==null?void 0:Fn.VITE_STORAGE_URL)||"")';
const hits = source.split(NEEDLE).length - 1;
if (hits !== 1) {
  console.error(`Expected exactly one relay-URL expression in the bundle, found ${hits}.
The board has been rebuilt since this script was written. Do not guess —
re-derive the patch from the current bundle before deploying.`);
  process.exit(1);
}

let patched = source.replace(NEEDLE, `fn=String(${JSON.stringify(relay)})`);

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
