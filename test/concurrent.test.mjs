/* Two people editing at once. The record is written whole, so without care
   the second write erases the first person's change entirely. */
import { build } from "esbuild";
import { writeFileSync } from "fs";

const out = await build({
  entryPoints: [new URL("../src/lib/useBoard.js", import.meta.url).pathname],
  bundle: true, format: "esm", write: false, jsx: "transform", external: ["react", "lucide-react"],
});
const tmp = new URL("../.conc.built.mjs", import.meta.url).pathname;
writeFileSync(tmp, out.outputFiles[0].text);
const { appendOrders } = await import(tmp);

let pass = 0, fail = 0;
const ok = (n, c, e) => { c ? (pass++, console.log("  ok  " + n)) : (fail++, console.log("  FAIL " + n, e ?? "")); };

/* The merge rule commit() relies on: a change expressed as a function of the
   record can be re-applied to someone else's newer copy without loss. */
console.log("concurrent edits:");
const start = { orders: [
  { id: "o1", externalId: "pi_1", status: "new", assignee: "Unassigned", notes: "" },
  { id: "o2", externalId: "pi_2", status: "new", assignee: "Unassigned", notes: "" },
], products: [{ id: "p1", name: "Calls", slaHours: 24 }], updatedAt: 100 };

// the assistant marks o1 delivered
const assistant = (x) => ({ ...x, orders: x.orders.map((o) => (o.id === "o1" ? { ...o, status: "done" } : o)) });
// meanwhile the owner renames the product
const owner = (x) => ({ ...x, products: x.products.map((p) => ({ ...p, name: "Individual Calls" })) });

const ownerSaved = { ...owner(start), updatedAt: 200 };
const reapplied = assistant(ownerSaved);   // what commit() does on finding a newer copy
ok("assistant's change lands", reapplied.orders.find((o) => o.id === "o1").status === "done");
ok("owner's change survives", reapplied.products[0].name === "Individual Calls");

// naive last-write-wins, for contrast
const naive = { ...assistant(start), updatedAt: 201 };
ok("without re-applying, the owner's edit is lost", naive.products[0].name === "Calls");

// appending orders is order-independent too
const withNew = appendOrders(ownerSaved, [{ externalId: "pi_3", productId: "p1", receivedAt: Date.now() }]).next;
const both = assistant(withNew);
ok("a Stripe order arriving mid-edit isn't lost", both.orders.length === 3);
ok("and neither is the edit", both.orders.find((o) => o.id === "o1").status === "done");
ok("nor the rename", both.products[0].name === "Individual Calls");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
