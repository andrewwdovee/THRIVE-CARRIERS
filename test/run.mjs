/* Runs every *.test.mjs in this folder and fails the process if any does. */
import { readdirSync } from "fs";
import { spawnSync } from "child_process";

const here = new URL(".", import.meta.url).pathname;
let bad = 0;
for (const f of readdirSync(here).filter((f) => f.endsWith(".test.mjs")).sort()) {
  console.log(`\n── ${f} ──`);
  const r = spawnSync(process.execPath, [here + f], { stdio: "inherit" });
  if (r.status !== 0) bad++;
}
process.exit(bad ? 1 : 0);
