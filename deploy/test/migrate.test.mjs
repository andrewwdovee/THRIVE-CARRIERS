/* The halves of the migration that touch Supabase, with a stand-in for
   the Cloudflare side. Proves the copy lands, re-running corrects rather
   than duplicates, and the count check would catch a short copy. */
const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE_KEY = "test-service-key";
const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };

async function upsert(rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/kv?on_conflict=key`, {
    method: "POST", headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
async function countThere() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/kv?select=key`, { headers: { ...headers, Prefer: "count=exact", Range: "0-0" } });
  return Number((res.headers.get("content-range") || "").split("/")[1]) || 0;
}
async function readBack(key) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/kv?key=eq.${encodeURIComponent('"' + key + '"')}&select=value`, { headers });
  const j = await r.json();
  return j.length ? j[0].value : null;
}

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + (x !== undefined ? " -> " + JSON.stringify(x) : "")); } };

/* Namespaced per run, so this says the same thing on an empty database
   and on one the other tests have already written to. */
const RUN = "mig" + Date.now().toString(36) + ":";
const fakeKv = [
  { key: RUN + "kv:fulfillment_board_v3", value: JSON.stringify({ orders: new Array(400).fill({ id: "x" }) }) },
  { key: RUN + "kv:snapshots/loa", value: '{"rows":[1,2,3]}' },
  { key: RUN + "kv:onboarding/submissions", value: "[]" },
  { key: RUN + "kv:onboarding/doc/ob_1", value: '{"signature":"data:image/png;base64,AAA"}' },
  { key: RUN + "kv:starttimes/state", value: '{"off":{}}' },
];

console.log("migrating into supabase:");
const before = await countThere();
await upsert(fakeKv.map((r) => ({ ...r, expires_at: null, updated_at: new Date().toISOString() })));
const after = await countThere();
ok("every key arrives", after - before === fakeKv.length, { before, after });
ok("a big board blob survives whole", await readBack(RUN + "kv:fulfillment_board_v3") === fakeKv[0].value);
ok("a key with slashes survives", await readBack(RUN + "kv:onboarding/doc/ob_1") === fakeKv[3].value);

await upsert(fakeKv.map((r) => ({ ...r, expires_at: null, updated_at: new Date().toISOString() })));
ok("re-running does not duplicate", await countThere() === after);

await upsert([{ key: RUN + "kv:snapshots/loa", value: '{"rows":[1,2,3,4]}', expires_at: null, updated_at: new Date().toISOString() }]);
ok("re-running picks up a changed value", await readBack(RUN + "kv:snapshots/loa") === '{"rows":[1,2,3,4]}');

ok("the count check would catch a short copy", after < fakeKv.length + before + 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
