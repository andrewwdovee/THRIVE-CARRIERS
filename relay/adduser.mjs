#!/usr/bin/env node
/* Create a login for someone.

   Accounts live in the relay's KV, so this just calls the relay with your
   owner token. Run it once per person:

     node relay/adduser.mjs https://your-relay.workers.dev someone@company.com "Their Name"

   It asks for the password rather than taking it as an argument, so the
   password never lands in your shell history. Your SYNC_TOKEN comes from
   the SYNC_TOKEN environment variable, or it prompts. */

import { createInterface } from "readline";
import { stdin, stdout, argv, env, exit } from "process";

const [, , relay, email, name] = argv;
if (!relay || !email) {
  console.error("usage: node relay/adduser.mjs <relay-url> <email> [name]");
  console.error("       list:  node relay/adduser.mjs <relay-url> --list");
  exit(1);
}

/* Created only when a plain question is actually asked — which this script
   never does. A readline interface attaches to stdin the moment it exists and
   echoes every keystroke, which silently defeated the masking below and
   printed passwords to the screen. Pausing it isn't enough; it must not
   exist yet. */
let rl = null;
const ask = (q, hidden) => new Promise((res) => {
  if (!hidden) {
    rl = rl || createInterface({ input: stdin, output: stdout });
    return rl.question(q, res);
  }
  if (rl) { rl.close(); rl = null; }   // nothing else may be reading stdin
  stdout.write(q);
  const tty = stdin.isTTY;
  if (tty) stdin.setRawMode(true);
  let buf = "";
  /* A terminal delivers one keystroke at a time; a pipe delivers the whole
     line at once. Scan the chunk rather than comparing it, so both work. */
  const on = (chunk) => {
    for (const ch of chunk.toString("utf8")) {
      if (ch === "\r" || ch === "\n") {
        stdin.removeListener("data", on);
        if (tty) stdin.setRawMode(false);
        stdout.write("\n");
        return res(buf);
      }
      if (ch === "\u0003") { stdout.write("\n"); exit(130); }        // ctrl-C
      if (ch === "\u007f" || ch === "\b") {
        if (buf) { buf = buf.slice(0, -1); stdout.write("\b \b"); }
      } else {
        buf += ch;
        stdout.write("*");
      }
    }
  };
  stdin.on("data", on);
});

const base = relay.replace(/\/+$/, "");
const owner = env.SYNC_TOKEN || (await ask("Owner token (SYNC_TOKEN): ", true));

if (email === "--list") {
  const r = await fetch(`${base}/auth/users`, { headers: { Authorization: `Bearer ${owner}` } });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) { console.error(b.error || r.status); exit(1); }
  for (const u of b.users) console.log(`${u.email}\t${u.name}\t${u.role}`);
  if (rl) rl.close();
  exit(0);
}

const password = await ask(`Password for ${email} (at least 10 characters): `, true);
const res = await fetch(`${base}/auth/users`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${owner}` },
  body: JSON.stringify({ email, password, name }),
});
const out = await res.json().catch(() => ({}));
if (rl) rl.close();
if (!res.ok) { console.error("Failed:", out.error || res.status); exit(1); }
console.log(`Created ${out.user.email} (${out.user.name}). They can sign in now.`);
console.log("Run this again with the same email to change that password.");
