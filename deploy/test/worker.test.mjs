/* The real relay, against the real schema, over the shim. */
import worker from "../worker.js";

const SALT = "00112233445566778899aabbccddeeff";
const ITER = 100000;
const PASSWORD = "test-password";

async function hash(pw) {
  const salt = new Uint8Array(SALT.match(/../g).map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), { name: "PBKDF2" }, false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: ITER, hash: "SHA-256" }, key, 256);
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const env = {
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SERVICE_KEY: "test-service-key",
  OWNER_EMAIL: "owner@example.com",
  OWNER_PASSWORD_SALT: SALT,
  OWNER_PASSWORD_HASH: await hash(PASSWORD),
  OWNER_PASSWORD_ITER: String(ITER),
  TOKEN_SECRET: "a-token-secret-for-the-test",
  ALLOWED_ORIGINS: "https://thrive-leadtech.pages.dev",
};

const call = (path, init = {}) =>
  worker.fetch(new Request("https://relay.test" + path, init), env, { waitUntil() {} });

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + (x !== undefined ? " -> " + JSON.stringify(x) : "")); } };

console.log("the relay, end to end:");

const health = await (await call("/health")).json();
ok("health reports supabase as the backend", health.config.backend === "supabase", health.config.backend);
ok("health still says kv is present", health.config.kv === true);
ok("nothing is reported missing", health.missing.length === 0, health.missing);

const login = await call("/auth/login", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "owner@example.com", password: PASSWORD }),
});
const { token } = await login.json();
ok("sign in issues a token", login.status === 200 && !!token);

const auth = { Authorization: "Bearer " + token, "Content-Type": "application/json" };

/* the board saving its whole state, which is the main write in the system */
const board = JSON.stringify({ orders: [{ id: "a" }], products: [], calls: [] });
const put = await call("/kv/fulfillment_board_v3", { method: "PUT", headers: auth, body: JSON.stringify({ value: board }) });
ok("the board can save", put.status === 200, put.status);

const got = await call("/kv/fulfillment_board_v3", { headers: auth });
ok("and read back exactly what it saved", (await got.json()).value === board);

const miss = await call("/kv/nothing-here", { headers: auth });
ok("a key that was never written is a 404", miss.status === 404);

const noauth = await call("/kv/fulfillment_board_v3");
ok("and no token gets nothing", noauth.status === 401);

/* a key with slashes, as the onboarding documents use */
await call("/kv/onboarding%2Fdoc%2Fob_x", { method: "PUT", headers: auth, body: JSON.stringify({ value: "{}" }) });
const slashed = await call("/kv/onboarding%2Fdoc%2Fob_x", { headers: auth });
ok("a key with slashes round trips", slashed.status === 200);

/* a real signing, which writes the index, the document and the projection */
const sig = "data:image/png;base64," + "A".repeat(80);
const submit = await call("/onboarding/submit", {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: "https://thrive-leadtech.pages.dev" },
  body: JSON.stringify({
    legalName: "Dana Fields", business: "Fields Insurance", email: "dana@example.com",
    phone: "(941) 555-0199", npn: "19283746", startTime: "10:00 AM EST",
    signedName: "Dana Fields", signedDate: "2026-10-11",
    thriveSignedName: "Dana Fields", thriveSignedDate: "2026-10-11",
    version: "2026-10-05", signature: sig, thriveSignature: sig,
  }),
});
const sub = await submit.json();
ok("a signed agreement is accepted", submit.status === 200 && !!sub.id, sub);

const roster = await (await call("/onboarding/roster")).json();
ok("the signer shows on the public roster", JSON.stringify(roster).includes("Dana"), roster);
ok("the roster does NOT leak the email", !JSON.stringify(roster).includes("dana@example.com"));


/* ---- the refund sheet ----
   Slips are written without a token and read back with one, and the read
   is one of only two places in the relay that lists a key prefix. That
   listing had no test, which is how a refund sheet can come back empty
   while every other screen in the portal is fine. */
const slip = (first, day) => ({
  first, last: "Tester", email: `${first.toLowerCase()}@example.com`, day,
  kind: "pair",
  calls: [
    { phone: "555-010-1234", reason: "dead_air" },
    { phone: "555-010-5678", reason: "non_consumer" },
  ],
});

/* The table outlives a run, so the counts here are against a baseline
   rather than against zero. */
const before = await (await call("/refund-requests", { headers: auth })).json();
const baseline = Array.isArray(before) ? before.length : 0;

for (const [name, day] of [["Ada", "2026-10-19"], ["Grace", "2026-10-21"], ["Alan", "2026-10-23"]]) {
  const r = await call("/refund-request", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(slip(name, day)),
  });
  ok(`a slip for ${name} is accepted`, r.status === 200, await r.text());
}

const badSlip = await call("/refund-request", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ first: "No", last: "Calls", email: "n@e.com", day: "2026-10-19", kind: "pair", calls: [] }),
});
ok("a slip with one call is refused", badSlip.status === 400);

const sheetNoAuth = await call("/refund-requests");
ok("the sheet needs a token", sheetNoAuth.status === 401, sheetNoAuth.status);

const sheetRes = await call("/refund-requests", { headers: auth });
const sheet = await sheetRes.json();
ok("the sheet answers 200", sheetRes.status === 200, sheetRes.status);
ok("the sheet lists every slip that was written",
   Array.isArray(sheet) && sheet.length === baseline + 3,
   Array.isArray(sheet) ? `${sheet.length}, expected ${baseline + 3}` : sheet);
ok("newest first", Array.isArray(sheet) && sheet[0] && sheet[0].first === "Alan",
   Array.isArray(sheet) ? sheet.map((s) => s.first) : sheet);
ok("a slip keeps its calls", Array.isArray(sheet) && sheet[0] && sheet[0].calls.length === 2);
ok("and the rate counters stay out of the sheet",
   Array.isArray(sheet) && sheet.every((s) => s && s.first));

/* ---- the sheet must not cost one request per slip ----
   Reading each slip on its own is free through a KV binding and is a
   network call through Supabase. A Worker gets a limited number of
   those per invocation, so past about fifty slips the sheet stopped
   answering at all -- a 500 that reached the portal as an empty table.
   The count here is what keeps that from coming back: it must not grow
   with the number of slips. */
const EXTRA = 60;
for (let i = 0; i < EXTRA; i++) {
  /* The POST is rate limited per address, so these arrive from their own. */
  await call("/refund-request", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": `203.0.113.${i}` },
    body: JSON.stringify(slip(`Bulk${i}`, "2026-10-24")),
  });
}

const realFetch = globalThis.fetch;
let calls = 0;
globalThis.fetch = (...a) => { calls++; return realFetch(...a); };
const bigRes = await call("/refund-requests", { headers: auth });
const big = await bigRes.json();
globalThis.fetch = realFetch;

ok(`${baseline + 3 + EXTRA} slips still answer 200`, bigRes.status === 200, bigRes.status);
ok("and every one of them comes back",
   Array.isArray(big) && big.length === baseline + 3 + EXTRA,
   Array.isArray(big) ? big.length : big);
ok(`reading ${big.length} slips took ${calls} request(s), not one each`,
   calls <= 5, calls);

/* ---- the trail ----
   One record sits behind four screens of the portal, so an overwrite
   of it resets all four and brings completed orders back. The store
   keeps one value per key, so there was no way back. Now the value
   being replaced is filed under a timestamp first. */
const v1 = JSON.stringify({ orders: [{ id: "a" }], wipes: [{ id: "a" }], calls: [], products: [], refunds: [] });
const v2 = JSON.stringify({ orders: [{ id: "a" }, { id: "b" }], wipes: [{ id: "a" }], calls: [], products: [], refunds: [] });
const wiped = JSON.stringify({ orders: [], wipes: [], calls: [], products: [], refunds: [] });

await call("/kv/fulfillment_board_v3", { method: "PUT", headers: auth, body: JSON.stringify({ value: v1 }) });
const second = await call("/kv/fulfillment_board_v3", { method: "PUT", headers: auth, body: JSON.stringify({ value: v2 }) });
ok("a second save files the one it replaced", (await second.json()).filed === true);

/* the accident: a save that drops everything */
await call("/kv/fulfillment_board_v3", { method: "PUT", headers: auth, body: JSON.stringify({ value: wiped }) });
const nowEmpty = await (await call("/kv/fulfillment_board_v3", { headers: auth })).json();
ok("and the board really is empty afterwards", JSON.parse(nowEmpty.value).orders.length === 0);

const histRes = await call("/history/fulfillment_board_v3", { headers: auth });
const hist = await histRes.json();
ok("the trail lists what was replaced", histRes.status === 200 && hist.kept >= 3, hist.kept);
ok("newest first", hist.versions[0].at >= hist.versions[1].at);

const back = await (await call(`/history/fulfillment_board_v3/${String(hist.versions[0].at).padStart(14, "0")}`, { headers: auth })).json();
ok("and hands back the record as it stood", JSON.parse(back.value).orders.length === 2,
   JSON.parse(back.value).orders.length);

const restore = await call("/kv/fulfillment_board_v3", { method: "PUT", headers: auth, body: JSON.stringify({ value: back.value }) });
ok("putting it back is an ordinary save", restore.status === 200);
const after = await (await call("/kv/fulfillment_board_v3", { headers: auth })).json();
ok("the board is whole again", JSON.parse(after.value).orders.length === 2);

ok("the trail is owner-only", (await call("/history/fulfillment_board_v3")).status === 401);
ok("and is not kept for just any key",
   (await call("/history/some-other-key", { headers: auth })).status === 404);

/* a key nobody keeps history for must not grow one */
await call("/kv/scratch-key", { method: "PUT", headers: auth, body: JSON.stringify({ value: "1" }) });
const plain = await call("/kv/scratch-key", { method: "PUT", headers: auth, body: JSON.stringify({ value: "2" }) });
ok("an ordinary key files nothing", (await plain.json()).filed === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
