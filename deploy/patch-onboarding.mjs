/**
 * Splices the Onboarding and Start times tabs into the Lead Tech
 * Fulfillment bundle.
 *
 *   node patch-onboarding.mjs https://thrive-onboarding.pages.dev
 *
 * There is no source for that board, only the built bundle, so the tab is
 * added the way build-leadtech.mjs adds the relay URL: by matching exact
 * shapes in the bundle and refusing to guess when they are not there.
 *
 * Four things are asserted before anything is written:
 *
 *   1. the jsx runtime, React and the storage object are each bound to
 *      one unambiguous minified name;
 *   2. the tab array has the ten entries this patch expects;
 *   3. the panel's place in the render chain appears exactly once;
 *   4. every Tailwind class the tab uses is in the compiled stylesheet —
 *      Tailwind only emits what existed at build time, so a class invented
 *      here would silently do nothing.
 *
 * Re-running on an already-patched bundle is a no-op, not a second tab.
 *
 * Input:  deploy/_leadtech-content.html  (or whatever is passed as --in)
 * Output: stdout, or --out <path>
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/* Strings in the tab that are shaped like a utility but are not one. */
const NOT_CLASSES = new Set(["aria-label", "aria-hidden", "data-act", "no-referrer"]);

/* The board draws a divider before "products-view": everything above it
   is the day's work, everything below is reference. Only the top half is
   reordered, and Onboarding goes at the end of it. What sits below the
   divider is left exactly as the bundle has it, because builds differ --
   some carry a separate Products tab and some do not. */
const DIVIDER = "products-view";
const HEAD_ORDER = ["inbox", "missed", "completed", "refunds", "wallets", "calls"];

/* The tabs this patch adds, in the order they are shown, each with the
   file holding it, the component it exports and the icon beside it. */
const ADDED = [
  { id: "onboarding", label: "Onboarding", file: "onboarding-tab.js", component: "ObPanel", icon: "ObIcon" },
  { id: "starttimes", label: "Start times", file: "starttimes-tab.js", component: "StPanel", icon: "StIcon" },
];

/* Helpers the tabs share, spliced in ahead of them. Not tabs: nothing in
   here renders on its own. */
const SHARED = ["ob-pdf.js"];

/* The agreement text, so the board can hand somebody a PDF of what they
   signed without fetching anything. It is read from the same Markdown
   the onboarding page is built from, and the version is read from the
   page itself, so the two cannot drift: if the page ships wording the
   board does not carry, the PDF says so on its face. */
export function contractText(opts = {}) {
  const md = readFileSync(join(here, "..", "onboarding", "contract.md"), "utf8")
    .replace(/^\s*<!--[\s\S]*?-->\s*/, "");
  const parts = md.split(/\n-{3,}\n/);
  if (parts.length !== 2) {
    throw new Error(`onboarding/contract.md should hold two agreements split by a rule, found ${parts.length}.`);
  }
  const page = readFileSync(join(here, "..", "onboarding", "index.html"), "utf8");
  const version = (page.match(/AGREEMENT_VERSION\s*=\s*"([^"]+)"/) || [])[1];
  if (!version) throw new Error("Could not read AGREEMENT_VERSION from onboarding/index.html.");
  for (const [i, name] of [[0, "Lead Tech"], [1, "Thrive Companies"]]) {
    if (!/^#\s+\S/m.test(parts[i])) throw new Error(`The ${name} half of contract.md has no title.`);
  }
  return {
    version,
    entity: opts.entity || "Thrive Companies LLC",
    state: opts.state || "Florida",
    lt: parts[0].trim(),
    tc: parts[1].trim(),
  };
}

/* A real scanner, because a regex for "..." also matches the gap between
   two strings on the same line and turns `", children: "` into a token. */
function stringLiterals(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && src[i + 1] === "*") { i = src.indexOf("*/", i + 2); if (i < 0) break; i += 2; continue; }
    if (c === '"' || c === "'" || c === "`") {
      const q = c; let buf = ""; i++;
      while (i < src.length) {
        if (src[i] === "\\") { buf += src[i + 1] || ""; i += 2; continue; }
        if (src[i] === q) { i++; break; }
        buf += src[i++];
      }
      out.push(buf);
      continue;
    }
    i++;
  }
  return out;
}

/* What a previous patch left behind, so a later one can find its own
   work and replace it rather than layering a second copy on top. */
const MARK = "/* --- added tabs --- */";

export function patchOnboarding(source, onboardingUrl, opts = {}) {
  const log = opts.log || (() => {});
  const already = ADDED.filter((t) => source.includes("function " + t.component + "("));

  /* A bundle that already carries the tabs is the normal case once the
     board has been patched once: the artifact is the only copy there is,
     so every later change has to go onto a patched bundle. The tab array
     and the render branches are already right, so only the code between
     the marker and the array is swapped. Half-patched is still refused:
     that is damage, not a previous run. */
  const upgrading = already.length === ADDED.length;
  if (already.length && !upgrading) {
    throw new Error(
      `This bundle already carries ${already.map((t) => t.label).join(", ")} but not the rest. ` +
      `Patch a clean bundle rather than layering onto a patched one.`
    );
  }
  let markAt = -1;
  if (upgrading) {
    const marks = source.split(MARK).length - 1;
    if (marks !== 1) {
      throw new Error(
        `Expected one "${MARK}" in a patched bundle, found ${marks}. ` +
        `Patch a clean bundle rather than guessing where the old tabs end.`
      );
    }
    markAt = source.indexOf(MARK);
    log("  already patched — replacing the tabs that are in there");
  }

  /* ---- 1. find the minified bindings ---- */
  function sole(name, re) {
    const seen = new Map();
    for (const m of source.matchAll(re)) seen.set(m[1], (seen.get(m[1]) || 0) + 1);
    const ranked = [...seen.entries()].sort((a, b) => b[1] - a[1]);
    if (!ranked.length) throw new Error(`Could not find ${name} in the bundle.`);
    if (ranked.length > 1 && ranked[1][1] > ranked[0][1] * 0.2) {
      throw new Error(
        `${name} is ambiguous in this bundle: ${ranked.slice(0, 3).map(([k, n]) => k + "×" + n).join(", ")}. ` +
        `Re-derive it before patching.`
      );
    }
    log(`  ${name.padEnd(14)} ${ranked[0][0]}  (${ranked[0][1]} uses)`);
    return ranked[0][0];
  }
  const JSX = sole("jsx runtime", /\b(\w{1,3})\.jsxs?\(/g);
  const REACT = sole("React", /\b(\w{1,3})\.useState\(/g);
  const storeHits = [...source.matchAll(/const (\w{1,3})=\{mode:\w+\?"remote"/g)].map((m) => m[1]);
  if (storeHits.length !== 1) {
    throw new Error(`Expected one storage object, found ${storeHits.length}. Re-derive it before patching.`);
  }
  const STORE = storeHits[0];
  log(`  storage        ${STORE}`);
  /* The board already knows how to hand somebody a file: it asks the
     artifact host first, which is the only thing that works inside the
     artifact frame, and falls back to an anchor everywhere else. Borrow
     it rather than writing a second one that only works on Pages. */
  const saveHits = [...source.matchAll(
    /use\("downloads"\)[\s\S]{0,260}?async function ([\w$]{1,4})\([\w$],[\w$]\)\{const [\w$]=await/g
  )].map((m) => m[1]);
  if (saveHits.length !== 1) {
    throw new Error(`Expected one save-a-file helper, found ${saveHits.length}. Re-derive it before patching.`);
  }
  const SAVE = saveHits[0];
  log(`  save helper    ${SAVE}`);
  for (const h of ["useEffect", "useCallback"]) {
    if (!source.includes(`${REACT}.${h}(`)) throw new Error(`${REACT}.${h} is not in this bundle.`);
  }
  if (!source.includes(`${JSX}.Fragment`)) throw new Error(`${JSX}.Fragment is not in this bundle.`);

  /* ---- 2. the tab array ---- */
  const tabsRe = /const ([\w$]{1,3})=\[\["inbox","New orders",[\w$]+\](?:,\[[^\]]*\])*\]/;
  const tabsHit = source.match(tabsRe);
  if (!tabsHit) throw new Error("Could not find the tab array. Re-derive the patch.");
  const tabsSrc = tabsHit[0];
  const entries = new Map();
  for (const m of tabsSrc.matchAll(/\["([\w-]+)","([^"]+)",([\w$]+)\]/g)) {
    entries.set(m[1], { label: m[2], icon: m[3] });
  }
  const found = [...entries.keys()];
  const cut = found.indexOf(DIVIDER);
  if (cut < 0) {
    throw new Error(`No "${DIVIDER}" tab to divide on. Found: ${found.join(", ")}`);
  }
  const head = found.slice(0, cut);
  const tail = found.slice(cut);
  /* On a re-patch the tabs this script added are already sitting in the
     head, at the end of it. They are put back in the same place below,
     so they are not a stray tab. */
  const expected = upgrading ? HEAD_ORDER.concat(ADDED.map((t) => t.id)) : HEAD_ORDER;
  const strayed = head.filter((t) => !expected.includes(t))
    .concat(expected.filter((t) => !head.includes(t)));
  if (strayed.length) {
    throw new Error(
      `The tabs before the divider are not the ones this patch reorders.\n` +
      `  found:    ${head.join(", ")}\n  expected: ${expected.join(", ")}\n` +
      `  differ:   ${strayed.join(", ")}`
    );
  }
  ADDED.forEach((t) => entries.set(t.id, { label: t.label, icon: t.icon }));
  const order = HEAD_ORDER.concat(ADDED.map((t) => t.id), tail);
  log(`  tabs           ${order.join(", ")}`);
  const rebuilt =
    `const ${tabsHit[1]}=[` +
    order.map((id) => `["${id}","${entries.get(id).label}",${entries.get(id).icon}]`).join(",") +
    `]`;

  /* ---- 3. the place in the render chain ---- */
  const branchNeedle = `:u==="calls"?${JSX}.jsx(`;
  const branchHits = source.split(branchNeedle).length - 1;
  if (branchHits !== 1) {
    throw new Error(`Expected one render branch to hang the panel off, found ${branchHits}.`);
  }
  if (upgrading) {
    /* The branches went in ahead of the needle last time and the panels
       keep their names, so they already point at the new code. */
    for (const t of ADDED) {
      if (!source.includes(`:u==="${t.id}"?${JSX}.jsx(${t.component},{})`)) {
        throw new Error(`The ${t.label} render branch is missing from a bundle that has its panel. Patch a clean bundle.`);
      }
    }
  }

  /* ---- 4. the classes ---- */
  const tab = SHARED.concat(ADDED.map((t) => t.file))
    .map((f) => readFileSync(join(here, f), "utf8"))
    .join("\n")
    .replace(/__JSX__/g, JSX)
    .replace(/__REACT__/g, REACT)
    .replace(/__STORE__/g, STORE)
    .replace(/__URL__/g, JSON.stringify(onboardingUrl))
    .replace(/__SAVE__/g, SAVE);

  /* The largest style block, not the first: a published artifact is
     wrapped in a skeleton whose own little reset comes before the
     board's compiled stylesheet. */
  const css = [...source.matchAll(/<style>([\s\S]*?)<\/style>/g)]
    .map((m) => m[1]).sort((a, b) => b.length - a.length)[0] || "";
  if (css.length < 5000) throw new Error("Could not find the board's compiled stylesheet.");
  const have = new Set();
  for (const m of css.matchAll(/\.((?:\\.|[-\w])+)/g)) have.add(m[1].replace(/\\(.)/g, "$1"));
  const missing = new Set();
  for (const lit of stringLiterals(tab)) {
    /* The storage keys and the link are strings too, and neither is a
       class. A key is a bare word then a slash then a letter, which no
       Tailwind utility is ("bg-slate-900/40" breaks on the hyphen). */
    if (lit.includes("://") || /^[a-z][a-z0-9]*\/[a-z]/.test(lit)) continue;
    for (const t of lit.split(/\s+/)) {
      /* Only judge tokens shaped like a utility: a word, then at least one
         hyphen, colon or bracket. Prose never matches, and svg path data
         never matches because its pieces start with a digit. The bare
         one-word utilities go unjudged, and they are the stable ones. */
      if (!/^[a-z][a-z0-9]*(?:[-:/[\]][\w.%#[\]/-]*)+$/.test(t)) continue;
      if (t.endsWith(":")) continue;                 /* prose, as in "did not save:" */
      if (NOT_CLASSES.has(t)) continue;
      if (!have.has(t)) missing.add(t);
    }
  }
  if (missing.size) {
    throw new Error(
      "These classes are not in the board's compiled stylesheet, so they would do nothing:\n  " +
      [...missing].join("\n  ") +
      "\nUse a class the board already uses, or an inline style."
    );
  }
  log(`  classes        all present`);

  /* The agreement goes in after the class check, not before: it is a
     contract, and contract prose is full of hyphenated words that look
     exactly like a Tailwind utility to the scanner above. */
  const contract = contractText(opts);
  const tabOut = tab.replace(/__CONTRACT__/g, JSON.stringify(contract));
  if (tabOut === tab) throw new Error("The agreement text was never spliced into the tab.");
  log(`  agreement      version ${contract.version}, ${contract.lt.length + contract.tc.length} characters`);

  /* ---- splice ---- */
  let out;
  if (upgrading) {
    const tabsAt = source.indexOf(tabsSrc, markAt);
    if (tabsAt < 0) throw new Error("The tab array is not after the marker. Patch a clean bundle.");
    out = source.slice(0, markAt) + MARK + "\n" + tabOut + "\n" + rebuilt +
      source.slice(tabsAt + tabsSrc.length);
  } else {
    out = source.replace(tabsSrc, `\n${MARK}\n${tabOut}\n${rebuilt}`);
    const branches = ADDED
      .map((t) => `:u==="${t.id}"?${JSX}.jsx(${t.component},{})`)
      .join("");
    out = out.replace(branchNeedle, `${branches}${branchNeedle}`);
  }
  if (out === source) throw new Error("Nothing was spliced. Refusing to write an unchanged bundle.");
  return out;
}

/* ------------------------------------------------------------- cli */
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const flag = (n) => { const i = args.indexOf(n); return i < 0 ? null : args[i + 1]; };
  const url = args.find((a) => /^https?:\/\//.test(a));
  if (!url) {
    console.error("Usage: node patch-onboarding.mjs https://thrive-onboarding.pages.dev [--in file] [--out file]");
    process.exit(1);
  }
  const inPath = flag("--in") || join(here, "_leadtech-content.html");
  const outPath = flag("--out");
  let src;
  try { src = readFileSync(inPath, "utf8"); }
  catch { console.error(`Missing ${inPath}.`); process.exit(1); }
  let out;
  try { out = patchOnboarding(src, url, { log: (m) => console.error(m) }); }
  catch (e) { console.error("\n" + e.message + "\n"); process.exit(1); }
  if (outPath) { writeFileSync(outPath, out); console.error(`Wrote ${outPath} (${out.length} bytes)`); }
  else process.stdout.write(out);
}
