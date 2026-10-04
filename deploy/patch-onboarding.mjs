/**
 * Splices the Onboarding tab into the Lead Tech Fulfillment bundle.
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

/* The order the tabs are shown in, left to right. The divider the board
   draws before "products-view" stays where it is, so everything above it
   is the day's work and everything below is reference. */
const TAB_ORDER = [
  "inbox", "missed", "completed", "refunds", "wallets", "calls", "onboarding",
  "products-view", "catalog", "reports", "settings",
];

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

export function patchOnboarding(source, onboardingUrl, opts = {}) {
  const log = opts.log || (() => {});
  if (source.includes("function ObPanel(")) {
    log("Already carries the Onboarding tab — left alone.");
    return source;
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
  const expected = TAB_ORDER.filter((t) => t !== "onboarding");
  const found = [...entries.keys()];
  if (found.length !== expected.length || expected.some((t) => !entries.has(t))) {
    throw new Error(
      `The tab array is not the shape this patch expects.\n  found:    ${found.join(", ")}\n  expected: ${expected.join(", ")}`
    );
  }
  entries.set("onboarding", { label: "Onboarding", icon: "ObIcon" });
  const rebuilt =
    `const ${tabsHit[1]}=[` +
    TAB_ORDER.map((id) => `["${id}","${entries.get(id).label}",${entries.get(id).icon}]`).join(",") +
    `]`;

  /* ---- 3. the place in the render chain ---- */
  const branchNeedle = `:u==="calls"?${JSX}.jsx(`;
  const branchHits = source.split(branchNeedle).length - 1;
  if (branchHits !== 1) {
    throw new Error(`Expected one render branch to hang the panel off, found ${branchHits}.`);
  }

  /* ---- 4. the classes ---- */
  let tab = readFileSync(join(here, "onboarding-tab.js"), "utf8")
    .replace(/__JSX__/g, JSX)
    .replace(/__REACT__/g, REACT)
    .replace(/__STORE__/g, STORE)
    .replace(/__URL__/g, JSON.stringify(onboardingUrl));

  const css = (source.match(/<style>([\s\S]*?)<\/style>/) || [, ""])[1];
  const have = new Set();
  for (const m of css.matchAll(/\.((?:\\.|[-\w])+)/g)) have.add(m[1].replace(/\\(.)/g, "$1"));
  const missing = new Set();
  for (const lit of stringLiterals(tab)) {
    /* The keys and the link are strings too, and neither is a class. */
    if (lit.includes("://") || lit.startsWith("onboarding/")) continue;
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

  /* ---- splice ---- */
  let out = source.replace(tabsSrc, `\n/* --- onboarding tab --- */\n${tab}\n${rebuilt}`);
  out = out.replace(branchNeedle, `:u==="onboarding"?${JSX}.jsx(ObPanel,{})${branchNeedle}`);
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
