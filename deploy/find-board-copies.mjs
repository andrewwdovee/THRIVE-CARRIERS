/**
 * Hunts for every copy of the Lead Tech board on this Mac.
 *
 *   node find-board-copies.mjs
 *
 * The board is a local-first app: it keeps its whole record in the
 * browser and syncs that to the relay. So when the relay's copy loses
 * a fortnight of call and wallet tracking, the browser that did the
 * tracking is the likeliest place it still exists -- and a browser
 * keeps localStorage in ordinary files on disk, which is why this
 * needs no devtools.
 *
 * Looks in every Chromium profile (Chrome, Brave, Edge, Arc, Vivaldi,
 * Opera), Firefox, Safari, and any .json lying in the usual folders.
 * For each board-shaped record it finds, it prints what the record
 * holds and when its newest call and order are, then saves it next to
 * this script as board-found-<n>.json.
 *
 * Read-only. It opens browser files, never writes to them, and does
 * not touch the network.
 */

import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const HOME = homedir();
const MAX_FILE = 300 * 1024 * 1024;
const LISTS = ["orders", "products", "calls", "refunds", "wipes", "customers"];

/* Where a browser keeps localStorage. The * is a profile name --
   "Default", "Profile 1" -- and people's day-to-day work is often not
   in Default, so every profile is searched. */
const ROOTS = [
  "Library/Application Support/Google/Chrome",
  "Library/Application Support/Google/Chrome Canary",
  "Library/Application Support/BraveSoftware/Brave-Browser",
  "Library/Application Support/Microsoft Edge",
  "Library/Application Support/Arc/User Data",
  "Library/Application Support/Vivaldi",
  "Library/Application Support/com.operasoftware.Opera",
  "Library/Application Support/Chromium",
];
const EXTRA_DIRS = [
  "Library/Safari/LocalStorage",
  "Library/Containers/com.apple.Safari/Data/Library/Safari/LocalStorage",
  "Library/Application Support/Firefox/Profiles",
  "Downloads", "Desktop", "Documents",
];

function walk(dir, out = [], depth = 0) {
  if (depth > 6 || !existsSync(dir)) return out;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      /* Caches hold copies of pages, not of localStorage, and they are
         enormous. Skipping them is the difference between seconds and
         an afternoon. */
      if (/^(Cache|Code Cache|GPUCache|Service Worker|CacheStorage|Crashpad|GrShaderCache)$/i.test(e.name)) continue;
      walk(full, out, depth + 1);
    } else if (/\.(log|ldb|sqlite|localstorage|json|db)$/i.test(e.name)) {
      try { if (statSync(full).size <= MAX_FILE) out.push(full); } catch {}
    }
  }
  return out;
}

/* ---- pulling a JSON object out of a file that is not JSON ----
   A leveldb file is a log with values packed between keys, so the
   record sits in the middle of binary noise. Braces inside strings
   must not be counted, or the object ends in the wrong place. */
function objectAt(text, start) {
  let depth = 0, inStr = false, esc = false;
  const cap = Math.min(text.length, start + 80 * 1024 * 1024);
  for (let i = start; i < cap; i++) {
    const c = text[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (!depth) return text.slice(start, i + 1); }
  }
  return null;
}

const looksLikeBoard = (o) =>
  o && typeof o === "object" && LISTS.some((k) => Array.isArray(o[k])) &&
  (Array.isArray(o.orders) || Array.isArray(o.calls) || Array.isArray(o.wipes));

function findIn(text, found) {
  /* Anchors that only a board carries. Searching for "{" everywhere
     would try to parse every brace in a 200 MB file. */
  for (const anchor of ['"googleCalls"', '"recordedAt"', '"fulfillment_board_v3"', '"refundTypes"', '"wipes"']) {
    let at = -1;
    while ((at = text.indexOf(anchor, at + 1)) !== -1) {
      /* The record starts at some { before the anchor. Walk back to
         each one and take the first that parses as a whole object. */
      for (let b = at; b >= 0 && at - b < 8 * 1024 * 1024; b--) {
        if (text[b] !== "{") continue;
        const chunk = objectAt(text, b);
        if (!chunk || chunk.length < 200) continue;
        let parsed;
        try { parsed = JSON.parse(chunk); } catch { continue; }
        if (typeof parsed === "string") { try { parsed = JSON.parse(parsed); } catch {} }
        if (looksLikeBoard(parsed)) { found.push(parsed); at += chunk.length; }
        break;
      }
    }
  }
}

const DATE_FIELDS = ["at", "recordedAt", "receivedAt", "createdAt", "created", "date", "day"];
function newest(rows) {
  let best = null;
  for (const r of rows || []) {
    for (const f of DATE_FIELDS) {
      const v = r && r[f];
      if (v == null || v === "") continue;
      const d = new Date(typeof v === "number" || /^\d{10,}$/.test(String(v)) ? Number(v) : String(v));
      if (!isNaN(d) && d.getUTCFullYear() > 2000 && (!best || d > best)) best = d;
    }
  }
  return best;
}
const day = (d) => (d ? d.toISOString().slice(0, 10) : "--");

console.log("Searching this Mac for copies of the board. A few minutes is normal.\n");

const files = [];
for (const root of ROOTS) {
  const base = join(HOME, root);
  if (!existsSync(base)) continue;
  for (const p of readdirSync(base, { withFileTypes: true })) {
    if (!p.isDirectory()) continue;
    walk(join(base, p.name, "Local Storage"), files);
    walk(join(base, p.name, "IndexedDB"), files);
  }
}
for (const d of EXTRA_DIRS) walk(join(HOME, d), files);
walk(here, files);
/* Any folder named on the command line, for a drive or a backup that
   is not in the usual places. */
for (const d of process.argv.slice(2)) walk(d, files);

console.log(`  ${files.length} files to look through`);

const found = [];
let scanned = 0;
for (const f of files) {
  scanned++;
  if (scanned % 400 === 0) process.stdout.write(`\r  ${scanned}/${files.length}...`);
  let buf;
  try { buf = readFileSync(f); } catch { continue; }
  const latin = buf.toString("latin1");
  /* Chromium stores some values as UTF-16: every other byte is a zero,
     so an anchor reads as g\0o\0o\0g... and a plain search misses it.
     The first version tested for the anchors before taking the zeroes
     out, so every UTF-16 profile was skipped before it was looked at.
     Both spellings are tested, and the zeroes are only stripped when
     the UTF-16 spelling is actually present -- stripping every binary
     file on the machine would cost minutes for nothing. */
  const ANCHOR = /googleCalls|recordedAt|fulfillment_board|refundTypes/;
  const wide = (w) => w.split("").join("\u0000");
  const WIDE = new RegExp(["googleCalls", "recordedAt", "fulfillment_board", "refundTypes"].map(wide).join("|"));

  const plain = ANCHOR.test(latin);
  const utf16 = !plain && WIDE.test(latin);
  if (!plain && !utf16) continue;

  const before = found.length;
  if (plain) findIn(latin, found);
  if (found.length === before && utf16) findIn(latin.replace(/\u0000/g, ""), found);
  for (let i = before; i < found.length; i++) found[i].__from = f;
}
process.stdout.write("\r".padEnd(40) + "\r");

if (!found.length) {
  console.log(`
No copy of the board was found on this Mac.

That does not mean the tracking is gone -- it means it is not in a
browser profile or a folder on this machine. Any other device that
used the portal is the next place to look, and the Supabase queries
are the other half of the search.`);
  process.exit(0);
}

/* Two reads of one file, and the same record in two profiles, are the
   same record. Counts plus the timestamp identify it well enough. */
const seen = new Map();
for (const r of found) {
  const key = LISTS.map((k) => (Array.isArray(r[k]) ? r[k].length : 0)).join("-") + "|" + (r.updatedAt || "");
  if (!seen.has(key)) seen.set(key, r);
}

console.log(`=== ${seen.size} distinct copy(ies) found ===\n`);
let n = 0;
for (const r of seen.values()) {
  n++;
  const counts = LISTS.map((k) => `${k} ${Array.isArray(r[k]) ? r[k].length : 0}`).join(" · ");
  const out = join(here, `board-found-${n}.json`);
  writeFileSync(out, JSON.stringify(r, null, 2));
  console.log(`  [${n}] ${counts}`);
  console.log(`      newest call ${day(newest(r.calls))} · newest wallet ${day(newest(r.wipes))} · newest order ${day(newest(r.orders))}`);
  console.log(`      saved to ${out}`);
  console.log(`      from ${String(r.__from).replace(HOME, "~")}\n`);
}

console.log(`Send me the block above. A copy whose newest call is later than
2026-10-08 is the one worth merging, and merge-board will add only
what the relay is missing.`);
