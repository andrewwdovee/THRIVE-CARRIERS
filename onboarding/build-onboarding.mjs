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
const FLAGS = ["--entity", "--state", "--rules", "--welcome", "--settings",
  "--portal", "--licences", "--course", "--training", "--discord"];
const flag = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : args[i + 1]; };
/* The relay is the one URL given on its own. Everything a flag takes is
   skipped first — otherwise `--welcome https://...` is read as the relay,
   which silently builds the live page instead of the preview and points
   it at the wrong host. */
const flagValues = new Set(FLAGS.map((f) => flag(f, null)).filter(Boolean));
const positional = args.filter((a, i) => !FLAGS.includes(a) && !FLAGS.includes(args[i - 1]));
const relay = (positional.find((a) => /^https:\/\//.test(a) && !flagValues.has(a)) || "")
  .replace(/\/+$/, "");
/* A copy to show someone before the relay exists. It is the real page,
   logos and all, but with nowhere to post — and it says so plainly on
   submit rather than losing a signature quietly. */
const preview = args.includes("--preview");

if (!relay && !preview) {
  console.error(`Usage: node build-onboarding.mjs https://thrive-relay.<subdomain>.workers.dev
                 [--entity "Thrive Companies LLC"] [--state Florida]
                 [--rules https://thrive-inbound.pages.dev/]
                 [--welcome <url>] [--settings <url>]
                 [--portal <url>] [--licences <url>] [--course <url>]
                 [--training <url>] [--discord <url>]

The relay must be the same Worker the Lead Tech board posts to, or the
board will never see the signed agreements.`);
  process.exit(1);
}

const entity = flag("--entity", "Thrive Companies LLC");
const state = flag("--state", "Florida");
const rules = (flag("--rules", "https://thrive-inbound.pages.dev/") || "").trim();
/* Step two lives at /welcome in this same deploy, so the signed form
   can reach it with a relative path and nothing has to be configured.
   A preview build has nowhere to send anyone unless it is told. */
const welcome = (flag("--welcome", "") || "").trim();
const settings = (flag("--settings", "") || "").trim();
/* The four the setup list still needs. Unset is fine: the step keeps its
   words and loses its button. */
const EXTRA_LINKS = [
  ["--portal", "PORTAL_URL"],
  ["--licences", "LICENCE_URL"],
  ["--course", "COURSE_URL"],
  ["--training", "TRAINING_URL"],
  ["--discord", "DISCORD_URL"],
];
const src = readFileSync(join(here, "index.html"), "utf8");

/* Each of these is asserted to appear exactly once. A page that silently
   failed to take the relay URL would look fine and lose every signature. */
function one(text, needle, replacement, where = "index.html") {
  const hits = text.split(needle).length - 1;
  if (hits !== 1) {
    console.error(`Expected one \`${needle}\` in ${where}, found ${hits}. Do not guess — fix the page.`);
    process.exit(1);
  }
  return text.replace(needle, replacement);
}

/* The two marks live in logos.json rather than inline, so index.html
   stays readable; the build is what makes the page self-contained. */
const logos = JSON.parse(readFileSync(join(here, "logos.json"), "utf8"));
for (const k of ["thriveV", "leadWhite", "leadInk"]) {
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
out = one(out, 'var WELCOME_URL = "";',
  `var WELCOME_URL = ${JSON.stringify(welcome || (relay ? "welcome/" : ""))};`);
out = one(out, 'var LOGOS = {};', `var LOGOS = ${JSON.stringify(logos)};`);

/* ---- the agreement in the page against the one in the repo ---- */
const md = readFileSync(join(here, "contract.md"), "utf8");
const headings = [...md.matchAll(/^## (\d) · (.+)$/gm)].map((m) => m[2].toLowerCase());
/* Both agreements, not just the first: the page carries two. */
const pageText = [...src.matchAll(/<article class="paper"[\s\S]*?<\/article>/g)]
  .map((m) => m[0]).join(" ")
  .replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").toLowerCase();
const drifted = headings.filter((h) => !pageText.includes(h.replace(/\s+/g, " ")));
if (drifted.length) {
  console.error(`The page and contract.md have drifted. Missing from the page: ${drifted.join("; ")}`);
  process.exit(1);
}

/* The settings page ships in the same deploy, at /start-time, so it
   needs no second Pages project and no second allowed origin. */
let st = readFileSync(join(here, "start-time.html"), "utf8");
if (relay) st = one(st, 'var RELAY  = "";', `var RELAY  = ${JSON.stringify(relay)};`, "start-time.html");
st = one(st, 'var ENTITY = "Thrive Companies LLC";', `var ENTITY = ${JSON.stringify(entity)};`, "start-time.html");
st = one(st, 'var LOGOS  = {};', `var LOGOS  = ${JSON.stringify(logos)};`, "start-time.html");

let wc = readFileSync(join(here, "welcome.html"), "utf8");
wc = one(wc, 'var ENTITY = "Thrive Companies LLC";', `var ENTITY = ${JSON.stringify(entity)};`, "welcome.html");
wc = one(wc, 'var RULES_URL = "https://thrive-inbound.pages.dev/";', `var RULES_URL = ${JSON.stringify(rules)};`, "welcome.html");
wc = one(wc, 'var LOGOS = {};', `var LOGOS = ${JSON.stringify(logos)};`, "welcome.html");
wc = one(wc, 'var SETTINGS_URL = "../start-time/";',
  `var SETTINGS_URL = ${JSON.stringify(settings || (relay ? "../start-time/" : ""))};`, "welcome.html");
/* A flag overrides whatever the page already has; a link already baked
   into welcome.html needs no flag and is not reported missing. */
const missingLinks = [];
for (const [f, varName] of EXTRA_LINKS) {
  const v = (flag(f, "") || "").trim();
  const here = (wc.match(new RegExp("var " + varName + ' = "([^"]*)";')) || [, ""])[1];
  if (!v && !here) missingLinks.push(f);
  if (v) wc = one(wc, `var ${varName} = "${here}";`, `var ${varName} = ${JSON.stringify(v)};`, "welcome.html");
}

const dist = join(here, "dist");
mkdirSync(dist, { recursive: true });
const name = preview && !relay ? "preview.html" : "index.html";
writeFileSync(join(dist, name), out);
mkdirSync(join(dist, "start-time"), { recursive: true });
writeFileSync(join(dist, "start-time", name), st);
mkdirSync(join(dist, "welcome"), { recursive: true });
writeFileSync(join(dist, "welcome", name), wc);

console.log(`Wrote onboarding/dist/${name}  (${(out.length / 1024).toFixed(0)} KB)
  and  onboarding/dist/start-time/${name}  (${(st.length / 1024).toFixed(0)} KB)  ->  <url>/start-time
  and  onboarding/dist/welcome/${name}     (${(wc.length / 1024).toFixed(0)} KB)  ->  <url>/welcome
  relay   ${relay || "(none — preview, submissions go nowhere)"}
  entity  ${entity}
  state   ${state}
  rules   ${rules}${missingLinks.length
  ? "\n\nThe setup list has no link yet for: " + missingLinks.join(" ") +
    "\nThose steps still read; they just have no button. Pass the flags once the URLs exist."
  : ""}

Deploy it:
  npx wrangler pages deploy ./dist --project-name thrive-onboarding --commit-dirty=true

Then, on the relay, add the URL Pages gives you to ALLOWED_ORIGINS, or the
browser will refuse the POST:
  npx wrangler secret put ALLOWED_ORIGINS   # comma-separated, no spaces`);
