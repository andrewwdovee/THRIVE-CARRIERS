/**
 * Points the public onboarding page at a relay and names the company on it.
 *
 *   node build-onboarding.mjs https://thrive-relay.<subdomain>.workers.dev \
 *     --entity "Thrive Companies LLC" --state Florida
 *
 * Writes onboarding/dist/index.html, which is what goes to Cloudflare Pages.
 * Left unbuilt the page still runs, but it has nowhere to post and says so
 * rather than pretending a submission landed.
 *
 * It also checks the agreement in the page has not drifted from
 * onboarding/contract.md: the two are meant to say the same thing, and a
 * client signs the one in the page.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : args[i + 1]; };
const relay = (args.find((a) => /^https:\/\//.test(a)) || "").replace(/\/+$/, "");

if (!relay) {
  console.error(`Usage: node build-onboarding.mjs https://thrive-relay.<subdomain>.workers.dev
                 [--entity "Thrive Companies LLC"] [--state Florida]

The relay must be the same Worker the Lead Tech board posts to, or the
board will never see the signed agreements.`);
  process.exit(1);
}

const entity = flag("--entity", "Thrive Companies LLC");
const state = flag("--state", "Florida");
const src = readFileSync(join(here, "index.html"), "utf8");

/* Each of these is asserted to appear exactly once. A page that silently
   failed to take the relay URL would look fine and lose every signature. */
function one(text, needle, replacement) {
  const hits = text.split(needle).length - 1;
  if (hits !== 1) {
    console.error(`Expected one \`${needle}\` in index.html, found ${hits}. Do not guess — fix the page.`);
    process.exit(1);
  }
  return text.replace(needle, replacement);
}

let out = src;
out = one(out, 'var RELAY  = "";', `var RELAY  = ${JSON.stringify(relay)};`);
out = one(out, 'var ENTITY = "Thrive Companies LLC";', `var ENTITY = ${JSON.stringify(entity)};`);
out = one(out, 'var STATE  = "Florida";', `var STATE  = ${JSON.stringify(state)};`);

/* ---- the agreement in the page against the one in the repo ---- */
const md = readFileSync(join(here, "contract.md"), "utf8");
const headings = [...md.matchAll(/^## (\d) · (.+)$/gm)].map((m) => m[2].toLowerCase());
const pageText = (src.match(/<article class="paper"[\s\S]*?<\/article>/) || [""])[0]
  .replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").toLowerCase();
const drifted = headings.filter((h) => !pageText.includes(h.replace(/\s+/g, " ")));
if (drifted.length) {
  console.error(`The page and contract.md have drifted. Missing from the page: ${drifted.join("; ")}`);
  process.exit(1);
}

const dist = join(here, "dist");
mkdirSync(dist, { recursive: true });
writeFileSync(join(dist, "index.html"), out);

console.log(`Wrote onboarding/dist/index.html
  relay   ${relay}
  entity  ${entity}
  state   ${state}

Deploy it:
  npx wrangler pages deploy ./dist --project-name thrive-onboarding --commit-dirty=true

Then, on the relay, add the URL Pages gives you to ALLOWED_ORIGINS, or the
browser will refuse the POST:
  npx wrangler secret put ALLOWED_ORIGINS   # comma-separated, no spaces`);
