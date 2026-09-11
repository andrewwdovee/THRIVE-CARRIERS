/* The LOA desk's page is open to anyone with the link, so the token it carries
   is only as safe as the wall around it. This file is that wall. */
import worker from "../relay/src/index.js";

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
  };
}

const BOARD = kv();
await BOARD.put("loa.state", JSON.stringify({ rows: [] }));
await BOARD.put("snapshots.loa", "[]");
await BOARD.put("board", JSON.stringify({ orders: [{ id: "secret" }] }));
const env = { BOARD, SYNC_TOKEN: "owner-token", DESK_TOKEN: "desk-token", ALLOWED_ORIGINS: "*" };

const desk = { Authorization: "Bearer desk-token" };
const call = (path, init = {}) => worker.fetch(new Request("https://r" + path, init), env);

console.log("what the desk token can reach:");
ok("its own state", (await call("/kv/loa.state", { headers: desk })).status === 200);
ok("its own snapshots", (await call("/kv/snapshots.loa", { headers: desk })).status === 200);
const w = await call("/kv/loa.state", { method: "PUT", headers: { ...desk, "Content-Type": "application/json" }, body: JSON.stringify({ value: "{}" }) });
ok("and it can write its own state", w.status === 200, w.status);

console.log("\nwhat it cannot:");
const board = await call("/kv/board", { headers: desk });
ok("the fulfillment board is refused", board.status === 403, board.status);
ok("and its contents never leave", !JSON.stringify(await board.json()).includes("secret"));
ok("orders are refused", (await call("/orders", { headers: desk })).status === 403);
ok("refund requests are refused", (await call("/refund-requests", { headers: desk })).status === 403);
ok("accounts are refused", (await call("/auth/users", { headers: desk })).status === 403);
const del = await call("/kv/loa.state", { method: "DELETE", headers: desk });
ok("it may not delete even its own key", del.status === 403, del.status);
ok("and the key survived", (await BOARD.get("loa.state")) !== null);

console.log("\nand the token itself:");
ok("a wrong token is nobody", (await call("/kv/loa.state", { headers: { Authorization: "Bearer wrong" } })).status === 401);
const unset = await worker.fetch(new Request("https://r/kv/loa.state", { headers: desk }), { ...env, DESK_TOKEN: undefined });
ok("unset DESK_TOKEN opens nothing", unset.status === 401, unset.status);
ok("the owner still reaches everything", (await call("/kv/board", { headers: { Authorization: "Bearer owner-token" } })).status === 200);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
