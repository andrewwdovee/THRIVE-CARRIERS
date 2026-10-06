/**
 * Three fixes to the board's own Stripe sync, applied to the compiled
 * bundle the same way the tabs are: match an exact shape, assert it
 * appears once, refuse rather than guess.
 *
 * The board pulls orders two ways. A Sync button does a full backfill,
 * and a timer does an incremental pull asking for everything newer than
 * the newest order already held. The backfill works. The incremental
 * pull has three faults that together look exactly like "it imported
 * everything once and then went dead":
 *
 *   1. `since` is the newest receivedAt the board holds, with no ceiling.
 *      One order dated ahead of now -- a subscription billing date, a
 *      clock skew, a record with no created stamp -- pins `since` in the
 *      future and nothing ever matches again. Permanent, and silent.
 *
 *   2. Nothing syncs when the board opens. The effect only sets an
 *      interval, so the first pull is 15s or 5min after you get there,
 *      and only while the tab stays visible.
 *
 *   3. A failing timer pull says nothing at all. The catch returns early
 *      in quiet mode, so a 401, a 500 or a bad URL is invisible forever.
 *
 * Each fix stands on its own: a ceiling on `since` costs nothing when
 * the clock is sane, a pull on open is what anyone opening the board
 * expects, and an error that shows is strictly better than one that
 * does not. Re-running on an already-fixed bundle is a no-op.
 */

/* A pull never asks for anything newer than ten minutes ago. The window
   overlaps, which is the point: the merge dedupes on externalId, so the
   cost of asking twice is nothing and the cost of asking too late is
   every order after it. */
const LAG_MS = "6e5";

/* The shapes, not the names. Every one of these was hardcoded once and
   every one of them broke the first time the board was rebuilt and the
   minifier handed out different letters -- G became K, Dt became _t.
   The logic does not move, so match that and keep whatever names come
   back. */
const FIXES = [
  {
    name: "since has a ceiling",
    find: /"since="\+Math\.floor\((\w{1,3})\/1e3\)\+\((\w{1,3})\?"&backfill=1":""\)/g,
    make: (m) => `"since="+Math.floor(Math.min(${m[1]},Date.now()-${LAG_MS})/1e3)+(${m[2]}?"&backfill=1":"")`,
    /* Two ways this can already be true: patched here, or fixed upstream
       in src/lib/sync.js, which compiles to the clamp sitting in its own
       binding just before the URL is built. Neither needs doing twice. */
    done: /(?:"since="\+Math\.floor\(Math\.min\()|(?:Math\.min\([\w$]{1,3},Date\.now\(\)-[\w$.e\d]{1,8}\)[\s\S]{0,160}?"since="\+Math\.floor\()/g,
  },
  {
    name: "pulls once on open",
    /* Three names here, not two: the interval handle, the sync call and
       the delay. Backreferencing the wrong one is how this missed. */
    find: /(\w{1,3})=setInterval\(\(\)=>\{document\.hidden\|\|(\w{1,3})\(\{quiet:!0\}\)\},(\w{1,3})\);return\(\)=>clearInterval\(\1\)/g,
    make: (m) => `${m[1]}=setInterval(()=>{document.hidden||${m[2]}({quiet:!0})},${m[3]});` +
      `${m[2]}({quiet:!0});return()=>clearInterval(${m[1]})`,
    /* Patched here it reads `X({quiet:!0});return()=>clearInterval(`;
       fixed upstream the minifier folds it into the return as
       `return X({quiet:!0}),()=>clearInterval(`. Same thing. */
    done: /\w{1,3}\(\{quiet:!0\}\)[,;]\s*(?:return)?\s*\(\)=>clearInterval\(/g,
  },
  {
    name: "timer errors show",
    find: /\}catch\((\w{1,3})\)\{if\((\w{1,3})!=null&&\2\.quiet\)return;(\w{1,3})\(\{busy:!1,at:Date\.now\(\),added:0,/g,
    make: (m) => `}catch(${m[1]}){${m[3]}({busy:!1,at:Date.now(),added:0,`,
    done: /\}catch\(\w{1,3}\)\{\w{1,3}\(\{busy:!1,at:Date\.now\(\),added:0,/g,
  },
];

export function patchSync(source, opts = {}) {
  const log = opts.log || (() => {});
  let out = source;

  for (const fix of FIXES) {
    const already = [...out.matchAll(fix.done)].length;
    const hits = [...out.matchAll(fix.find)];

    /* Already-fixed wins over still-matches. The upstream fix puts the
       clamp in its own binding, so the shape this patch looks for is
       still sitting right there afterwards -- patching on top of it
       would clamp a clamped value and report work it did not do. */
    if (already >= 1) { log(`  ${fix.name.padEnd(22)} already in`); continue; }
    if (hits.length !== 1) {
      throw new Error(
        `Sync fix "${fix.name}": expected one place to change, found ${hits.length}` +
        (already ? ` (and ${already} already changed)` : "") + `.\n` +
        `The board has been rebuilt into a shape this does not know. Re-derive it rather than guessing.`
      );
    }
    out = out.slice(0, hits[0].index) + fix.make(hits[0]) +
      out.slice(hits[0].index + hits[0][0].length);
    log(`  ${fix.name.padEnd(22)} patched`);
  }

  return out;
}
