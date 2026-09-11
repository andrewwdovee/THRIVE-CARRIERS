/* The refund form is the only thing here a stranger can reach, so what it
   accepts is the whole of its security surface. */
import worker from "../relay/src/index.js";
import { readRequest, tooBig } from "../relay/src/refund-requests.js";

let pass = 0, fail = 0;
const ok = (n, c, e) => { c ? (pass++, console.log("  ok  " + n)) : (fail++, console.log("  FAIL " + n, e ?? "")); };

function kv() {
  const m = new Map();
  return {
    get: async (k) => m.get(k) ?? null,
    put: async (k, v) => m.set(k, v),
    delete: async (k) => m.delete(k),
    list: async ({ prefix }) => ({ keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
    _m: m,
    _requests: () => [...m.keys()].filter((k) => k.startsWith("rr:")),
  };
}
const CALLS = [{ phone: "555 123 4567", reason: "dead_air" }, { phone: "(555) 987-6543", reason: "agent" }];
const FULL = { first: "Ada", last: "Reyes", email: "ada@x.co", day: "2026-09-11", calls: CALLS };

console.log("what the form accepts:");
ok("a complete request", !!readRequest(FULL).value);
ok("a name is required", !!readRequest({ ...FULL, first: "" }).error);
ok("an email must look like one", !!readRequest({ ...FULL, email: "nope" }).error);
ok("a date is required", !!readRequest({ ...FULL, day: "" }).error);
ok("a malformed date is refused", !!readRequest({ ...FULL, day: "11/09/2026" }).error);
/* The rule the business runs on: two bad calls earn one refund. */
ok("one call is not a request", !!readRequest({ ...FULL, calls: [CALLS[0]] }).error);
ok("no calls is not a request", !!readRequest({ ...FULL, calls: [] }).error);
ok("a short phone number is refused", !!readRequest({ ...FULL, calls: [{ phone: "555", reason: "agent" }, CALLS[1]] }).error);
ok("an unknown reason is refused", !!readRequest({ ...FULL, calls: [{ phone: "5551234567", reason: "because" }, CALLS[1]] }).error);
ok("a missing reason is refused", !!readRequest({ ...FULL, calls: [{ phone: "5551234567" }, CALLS[1]] }).error);
ok("formatting in a phone number is fine", !!readRequest(FULL).value);

/* Nothing a stranger sends may land in storage unbounded. */
const long = "x".repeat(5000);
const trimmed = readRequest({ ...FULL, first: long, note: long }).value;
ok("a huge name is cut, not stored whole", trimmed.first.length <= 80, trimmed.first.length);
ok("a huge note is cut too", trimmed.note.length <= 500, trimmed.note.length);
ok("more calls than anybody sends are dropped",
   readRequest({ ...FULL, calls: Array(50).fill(CALLS[0]) }).value.calls.length <= 12);
ok("an oversized body is refused outright", tooBig("x".repeat(9000)));
ok("a normal body is not", !tooBig(JSON.stringify(FULL)));

console.log("\nwhat the endpoint does:");
const BOARD = kv();
const env = { BOARD, SYNC_TOKEN: "owner-token", ALLOWED_ORIGINS: "*" };
const post = (body, headers = {}) => worker.fetch(new Request("https://r/refund-request", {
  method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
}), env);

let res = await post(FULL);
ok("a good request is accepted without any token", res.status === 200, res.status);
ok("and is stored", BOARD._requests().length === 1, BOARD._requests());
const body = await res.json();
/* An anonymous caller must learn nothing about the board from the reply. */
ok("the reply says nothing but ok", JSON.stringify(body) === '{"ok":true}', body);

res = await post({ ...FULL, calls: [CALLS[0]] });
ok("a bad request is refused", res.status === 400, res.status);
ok("and nothing extra is stored", BOARD._requests().length === 1, BOARD._requests());

/* Reading them back is staff-only — the form can write, strangers can't read. */
const read = (headers) => worker.fetch(new Request("https://r/refund-requests", { headers }), env);
ok("reading without a token is refused", (await read({})).status === 401);
const mine = await read({ Authorization: "Bearer owner-token" });
ok("reading with the owner token works", mine.status === 200, mine.status);
ok("and returns what was sent", (await mine.json()).length === 1);

/* A flood from one address is capped. */
const many = kv();
const env2 = { ...env, BOARD: many };
let refused = 0;
for (let i = 0; i < 25; i++) {
  const r = await worker.fetch(new Request("https://r/refund-request", {
    method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": "1.2.3.4" },
    body: JSON.stringify(FULL),
  }), env2);
  if (r.status === 429) refused++;
}
ok("a flood from one address is capped", refused > 0, `${refused} refused of 25`);
ok("but the first ones got through", many._requests().length >= 15, many._requests().length);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
