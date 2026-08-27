import worker from "../relay/src/index.js";

let pass = 0, fail = 0;
const ok = (n, c, e) => { c ? (pass++, console.log("  ok  " + n)) : (fail++, console.log("  FAIL " + n, e ?? "")); };

/* KV double, with the TTL and prefix listing the relay actually uses. */
function kv() {
  const m = new Map();
  return {
    get: async (k) => { const v = m.get(k); if (!v) return null; if (v.exp && v.exp < Date.now()) { m.delete(k); return null; } return v.val; },
    put: async (k, val, o) => m.set(k, { val, exp: o?.expirationTtl ? Date.now() + o.expirationTtl * 1000 : null }),
    delete: async (k) => m.delete(k),
    list: async ({ prefix }) => ({ keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
    _map: m,
  };
}

global.fetch = async () => new Response(JSON.stringify({ data: [] }), { status: 200 });

const OWNER = "owner-secret-token";
let BOARD = kv();
let env = { STRIPE_SECRET_KEY: "sk_test_x", SYNC_TOKEN: OWNER, ALLOWED_ORIGINS: "*", BOARD };
const call = (path, opts = {}) =>
  worker.fetch(new Request("https://relay.test" + path, opts), opts.env || env);
const asOwner = (extra) => ({ Authorization: `Bearer ${OWNER}`, ...(extra || {}) });

console.log("auth:");

// ── account creation is owner-only ──
let r = await call("/auth/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "a@b.co", password: "correct-horse-battery" }) });
ok("create without owner token -> 403", r.status === 403, r.status);

r = await call("/auth/users", { method: "POST", headers: asOwner({ "Content-Type": "application/json" }), body: JSON.stringify({ email: "desk@thrive.co", password: "short", name: "Desk" }) });
ok("short password refused -> 400", r.status === 400, r.status);
ok("refusal explains the rule", /at least 10/.test((await r.json()).error));

r = await call("/auth/users", { method: "POST", headers: asOwner({ "Content-Type": "application/json" }), body: JSON.stringify({ email: "Desk@Thrive.co", password: "correct-horse-battery", name: "Desk Assistant" }) });
ok("create -> 200", r.status === 200, r.status);
ok("email normalized to lowercase", (await r.json()).user.email === "desk@thrive.co");
ok("password is not stored in the clear", !JSON.stringify([...BOARD._map.values()]).includes("correct-horse-battery"));

// ── signing in ──
r = await call("/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "desk@thrive.co", password: "wrong-password-here" }) });
ok("wrong password -> 401", r.status === 401, r.status);
const wrongMsg = (await r.json()).error;
r = await call("/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "nobody@thrive.co", password: "wrong-password-here" }) });
ok("unknown account -> 401", r.status === 401, r.status);
ok("same message either way (no account enumeration)", (await r.json()).error === wrongMsg);

r = await call("/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "DESK@thrive.co", password: "correct-horse-battery" }) });
ok("correct password -> 200", r.status === 200, r.status);
const sess = await r.json();
ok("returns a token", typeof sess.token === "string" && sess.token.length >= 32);
ok("returns the user", sess.user.email === "desk@thrive.co" && sess.user.name === "Desk Assistant");
ok("token is not the password or the owner token", sess.token !== OWNER && !sess.token.includes("correct-horse"));

const asUser = (extra) => ({ Authorization: `Bearer ${sess.token}`, ...(extra || {}) });

// ── the gate ──
r = await call("/kv/board", { headers: { Authorization: "Bearer not-a-real-token" } });
ok("bogus token can't read the board -> 401", r.status === 401, r.status);
r = await call("/kv/board");
ok("no token can't read the board -> 401", r.status === 401, r.status);
r = await call("/orders", { headers: { Authorization: "Bearer not-a-real-token" } });
ok("bogus token can't read orders -> 401", r.status === 401, r.status);

r = await call("/kv/board", { method: "PUT", headers: asUser({ "Content-Type": "application/json" }), body: JSON.stringify({ value: '{"orders":[]}' }) });
ok("signed in can write the board", r.status === 200, r.status);
r = await call("/kv/board", { headers: asUser() });
ok("signed in can read it back", (await r.json()).value === '{"orders":[]}');
r = await call("/orders", { headers: asUser() });
ok("signed in can pull orders", r.status === 200, r.status);

r = await call("/auth/me", { headers: asUser() });
ok("/auth/me names the account", (await r.json()).user.email === "desk@thrive.co");

// staff can't manage accounts
r = await call("/auth/users", { headers: asUser() });
ok("staff can't list accounts -> 403", r.status === 403, r.status);

// ── signing out actually revokes ──
r = await call("/auth/logout", { method: "POST", headers: asUser() });
ok("logout -> 200", r.status === 200);
r = await call("/kv/board", { headers: asUser() });
ok("token is dead after logout -> 401", r.status === 401, r.status);

// ── expiry ──
const fresh = await (await call("/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "desk@thrive.co", password: "correct-horse-battery" }) })).json();
const rec = BOARD._map.get(`session:${fresh.token}`);
rec.exp = Date.now() - 1000;                    // simulate the KV TTL lapsing
r = await call("/kv/board", { headers: { Authorization: `Bearer ${fresh.token}` } });
ok("expired session -> 401", r.status === 401, r.status);

// ── deleting an account kills future logins ──
await call("/auth/users", { method: "POST", headers: asOwner({ "Content-Type": "application/json" }), body: JSON.stringify({ email: "gone@thrive.co", password: "correct-horse-battery" }) });
r = await call("/auth/users", { method: "DELETE", headers: asOwner({ "Content-Type": "application/json" }), body: JSON.stringify({ email: "gone@thrive.co" }) });
ok("delete account -> 200", r.status === 200);
r = await call("/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "gone@thrive.co", password: "correct-horse-battery" }) });
ok("deleted account can't sign in -> 401", r.status === 401, r.status);

// ── owner token still works machine-to-machine ──
r = await call("/orders", { headers: asOwner() });
ok("owner token still pulls orders", r.status === 200, r.status);

// ── a relay with no KV can't pretend to have accounts ──
r = await call("/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "a@b.co", password: "correct-horse-battery" }), env: { ...env, BOARD: undefined } });
ok("no KV -> 501 with a real explanation", r.status === 501 && /KV/.test((await r.json()).error), r.status);

// ── health says whether sign-in is possible ──
ok("health reports auth on", (await (await call("/health")).json()).auth === true);
ok("health reports auth off without KV", (await (await call("/health", { env: { ...env, BOARD: undefined } })).json()).auth === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
