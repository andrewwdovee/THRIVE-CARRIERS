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
/* A copy to show someone before the relay exists. It is the real page,
   logos and all, but with nowhere to post — and it says so plainly on
   submit rather than losing a signature quietly. */
const preview = args.includes("--preview");

if (!relay && !preview) {
  console.error(`Usage: node build-onboarding.mjs https://thrive-relay.<subdomain>.workers.dev
                 [--entity "Thrive Companies LLC"] [--state Florida]
                 [--rules https://thrive-inbound.pages.dev/]

The relay must be the same Worker the Lead Tech board posts to, or the
board will never see the signed agreements.`);
  process.exit(1);
}

const entity = flag("--entity", "Thrive Companies LLC");
const state = flag("--state", "Florida");
const rules = (flag("--rules", "https://thrive-inbound.pages.dev/") || "").trim();
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

/* The two marks live in logos.json rather than inline, so index.html
   stays readable; the build is what makes the page self-contained. */
const logos = JSON.parse(readFileSync(join(here, "logos.json"), "utf8"));
for (const k of ["thriveWhite", "leadWhite", "leadInk"]) {
  if (!/^data:image\/png;base64,/.test(logos[k] || "")) {
    console.error(`logos.json is missing ${k}, or it is not a png data uri.`);
    process.exit(1);
  }
}

let out = src;
if (relay) out = one(out, 'var RELAY  = "";', `var RELAY  = ${JSON.stringify(relay)};`);
out = one(out, 'var ENTITY = "Thrive Companies LLC";', `var ENTITY = ${JSON.stringify(entity)};`);
out = one(out, 'var STATE  = "Florida";', `var STATE  = ${JSON.stringify(state)};`);
out = one(out, 'var RULES_URL = "https://thrive-inbound.pages.dev/";', `var RULES_URL = ${JSON.stringify(rules)};`);
out = one(out, 'var LOGOS = {};', `var LOGOS = ${JSON.stringify(logos)};`);

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
const name = preview && !relay ? "preview.html" : "index.html";
writeFileSync(join(dist, name), out);

console.log(`Wrote onboarding/dist/${name}  (${(out.length / 1024).toFixed(0)} KB)
  relay   ${relay || "(none — preview, submissions go nowhere)"}
  entity  ${entity}
  state   ${state}
  rules   ${rules}

Deploy it:
  npx wrangler pages deploy ./dist --project-name thrive-onboarding --commit-dirty=true

Then, on the relay, add the URL Pages gives you to ALLOWED_ORIGINS, or the
browser will refuse the POST:
  npx wrangler secret put ALLOWED_ORIGINS   # comma-separated, no spaces`);
