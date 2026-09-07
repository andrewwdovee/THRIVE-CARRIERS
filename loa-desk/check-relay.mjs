/**
 * Reports what the relay is actually holding for the LOA desk.
 *
 *   node check-relay.mjs
 *
 * The desk showing a blank book has several possible causes — the record
 * was never written, it was written somewhere else, or the desk is being
 * refused when it reads. Those look identical in the browser and quite
 * different from here, so this asks the relay directly and prints what
 * came back.
 *
 * Takes the relay URL and desk token out of dist/index.html, so it asks
 * with exactly the credentials the deployed page uses.
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, "dist", "index.html");

if (!existsSync(built)) {
  console.error("No dist/index.html — run `node build-desk.mjs` first.");
  process.exit(1);
}
const page = readFileSync(built, "utf8");
const pick = (name) => {
  const m = page.match(new RegExp(`window\\.${name} = ("(?:[^"\\\\]|\\\\.)*")`));
  try { return m ? JSON.parse(m[1]) : ""; } catch { return ""; }
};
const relay = pick("THRIVE_RELAY");
const token = pick("THRIVE_DESK_TOKEN");

if (!relay || !token) {
  console.error("dist/index.html has no relay URL or desk token in it.");
  process.exit(1);
}

console.log(`Relay: ${relay}`);
console.log(`Token: ${token.slice(0, 4)}… (${token.length} characters)\n`);

async function look(key) {
  let res;
  try {
    res = await fetch(`${relay}/kv/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (e) {
    console.log(`${key.padEnd(15)} could not reach the relay — ${e.message}`);
    return;
  }

  const text = await res.text();

  if (res.status === 404) {
    console.log(`${key.padEnd(15)} 404 — nothing stored under this key`);
    return;
  }
  if (!res.ok) {
    console.log(`${key.padEnd(15)} ${res.status} — ${text.slice(0, 160)}`);
    /* A 403 can come from something between here and the relay rather
       than from the relay itself, and the two mean opposite things. */
    if (/allowlist|egress|proxy/i.test(text)) {
      console.log(`${"".padEnd(15)} that is the network refusing the connection, not the relay`);
    } else if (res.status === 401 || res.status === 403) {
      console.log(`${"".padEnd(15)} the relay is refusing this token`);
    }
    return;
  }

  /* The relay wraps the value; the value is itself JSON. */
  let value;
  try {
    const body = JSON.parse(text);
    value = typeof body.value === "string" ? JSON.parse(body.value) : body.value;
  } catch {
    console.log(`${key.padEnd(15)} 200, ${text.length} bytes, but not the shape the desk expects`);
    console.log(`${"".padEnd(15)} ${text.slice(0, 160)}`);
    return;
  }

  const n = (k) => (Array.isArray(value?.[k]) ? value[k].length : 0);
  console.log(
    `${key.padEnd(15)} 200 · ${(text.length / 1024).toFixed(0)} KB · ` +
    `${n("agents")} agents · ${n("deals")} deals · ${n("calls")} call days`
  );
  if (value?.updatedAt) console.log(`${"".padEnd(15)} last written ${value.updatedAt}`);
  if (value?.syncedAt)  console.log(`${"".padEnd(15)} last synced  ${value.syncedAt}`);
  (value?.agents || []).forEach((a) =>
    console.log(`${"".padEnd(15)} · ${a.email || "(no email)"}${a.pwHash ? "  [has a password]" : "  [NO PASSWORD SET]"}`)
  );
}

await look("loa.state");
console.log("");
await look("snapshots.loa");
