#!/usr/bin/env node
/* One command to stand up the relay.

   The relay is the small program that holds your Stripe key and catches
   payments as they happen. Doing it by hand means several Cloudflare commands
   and editing a config file. This runs all of that, asks for the two things
   only you know, and prints exactly what to paste into Stripe. */

import { execSync, spawnSync } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { createInterface } from "readline";
import { randomBytes } from "crypto";
import { stdin, stdout, exit } from "process";

const ESC = String.fromCharCode(27);
const b = (t) => `${ESC}[1m${t}${ESC}[0m`;
const dim = (t) => `${ESC}[2m${t}${ESC}[0m`;
const green = (t) => `${ESC}[32m${t}${ESC}[0m`;
const red = (t) => `${ESC}[31m${t}${ESC}[0m`;
const step = (n, t) => console.log(`\n${b("Step " + n)}  ${t}`);

const rl = createInterface({ input: stdin, output: stdout });
const ask = (q) => new Promise((res) => rl.question(q, res));

/* Secrets are typed, never echoed, and never passed as command arguments —
   which would leave them in your shell history. */
const askHidden = (q) => new Promise((res) => {
  stdout.write(q);
  const tty = stdin.isTTY;
  if (tty) stdin.setRawMode(true);
  let buf = "";
  const on = (chunk) => {
    const s = chunk.toString("utf8");
    if (s === "\r" || s === "\n") {
      stdin.removeListener("data", on);
      if (tty) stdin.setRawMode(false);
      stdout.write("\n");
      res(buf.trim());
    } else if (s === "\u0003") {          // ctrl-C
      stdout.write("\n");
      exit(130);
    } else if (s === "\u007f" || s === "\b") {
      buf = buf.slice(0, -1);
    } else {
      buf += s;
      stdout.write("*");
    }
  };
  stdin.on("data", on);
});

const WRANGLER = "npx --yes wrangler@3";
const run = (cmd, opts = {}) =>
  execSync(cmd, { cwd: "relay", encoding: "utf8", stdio: opts.quiet ? "pipe" : "inherit", ...opts });

function setSecret(name, value) {
  const r = spawnSync("npx", ["--yes", "wrangler@3", "secret", "put", name], {
    cwd: "relay", input: value + "\n", encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`Couldn't save ${name}. ${r.stderr || ""}`);
}

console.log(b("\nLead Tech Fulfillment - Stripe setup\n"));
console.log("This sets up the small program that catches your Stripe payments.");
console.log(dim("Your keys go straight to Cloudflare. They are never shown back to you,"));
console.log(dim("and never written into this project.\n"));

if (!existsSync("relay/wrangler.toml")) {
  console.log(red("Run this from the project folder (the one containing relay/)."));
  exit(1);
}

/* 1. Cloudflare account */
step(1, "Signing in to Cloudflare");
console.log(dim("A browser window may open. Cloudflare is free for this.\n"));
try {
  const who = run(`${WRANGLER} whoami`, { quiet: true });
  console.log(green("Already signed in."), dim((who.split("\n").find((l) => l.includes("@")) || "").trim()));
} catch {
  try { run(`${WRANGLER} login`); }
  catch {
    console.log(red("\nCouldn't sign in. Run `npx wrangler login` yourself, then try again."));
    exit(1);
  }
}

/* 2. Somewhere to keep the orders */
step(2, "Making a place to keep your orders");
let toml = readFileSync("relay/wrangler.toml", "utf8");
if (/^\s*\[\[kv_namespaces\]\]/m.test(toml) && /^\s*id\s*=\s*"[0-9a-f]{16,}"/m.test(toml)) {
  console.log(green("Already set up."));
} else {
  let out = "";
  try { out = run(`${WRANGLER} kv namespace create BOARD`, { quiet: true }); }
  catch (e) { out = String(e.stdout || "") + String(e.stderr || ""); }
  const id = (out.match(/id\s*=\s*"([0-9a-f]{16,})"/) || out.match(/"id"\s*:\s*"([0-9a-f]{16,})"/) || [])[1];
  if (!id) {
    console.log(red("Couldn't work out the storage id. Cloudflare said:\n") + out);
    console.log("Paste the id it printed into relay/wrangler.toml under [[kv_namespaces]], then run this again.");
    exit(1);
  }
  const commented = /# \[\[kv_namespaces\]\][\s\S]*?# id = "paste-the-id-here"/;
  toml = commented.test(toml)
    ? toml.replace(commented, `[[kv_namespaces]]\nbinding = "BOARD"\nid = "${id}"`)
    : toml + `\n[[kv_namespaces]]\nbinding = "BOARD"\nid = "${id}"\n`;
  writeFileSync("relay/wrangler.toml", toml);
  console.log(green("Done."), dim(id));
}

/* 3. The Stripe key */
step(3, "Your Stripe key");
console.log("In Stripe, click " + b("Developers -> API keys") + " and copy the " + b("Secret key") + ".");
console.log(dim("It starts with sk_test_ for practice, or sk_live_ for real money.\n"));
const sk = await askHidden("Paste it here: ");
if (!/^sk_(test|live)_/.test(sk)) {
  console.log(red("\nThat doesn't look like a Stripe secret key - it should start with sk_test_ or sk_live_."));
  exit(1);
}
setSecret("STRIPE_SECRET_KEY", sk);
console.log(green("Saved to Cloudflare."), dim("It lives there, not in this project."));

/* 4. A password for the relay itself */
step(4, "Making a password for your relay");
const owner = randomBytes(24).toString("base64url");
setSecret("SYNC_TOKEN", owner);
console.log(green("Made one for you."));

/* 5. Put it online */
step(5, "Putting it online");
let deploy = "";
try { deploy = run(`${WRANGLER} deploy`, { quiet: true }); }
catch (e) {
  console.log(red("Deploy failed:\n") + String(e.stdout || "") + String(e.stderr || ""));
  exit(1);
}
const url = (deploy.match(/https:\/\/[^\s]+\.workers\.dev/) || [])[0];
if (!url) {
  console.log(deploy);
  console.log(red("Deployed, but couldn't read the address. Look for a workers.dev link above."));
  exit(1);
}
console.log(green("Live at ") + b(url));

/* 6. Tell Stripe where to send payments */
step(6, "Telling Stripe where to send payments");
console.log(`
In Stripe, go to ${b("Developers -> Webhooks -> Add endpoint")} and fill in:

  Endpoint URL   ${b(url + "/stripe/webhook")}

  Events         charge.succeeded
                 charge.failed
                 charge.refunded
                 checkout.session.completed
                 invoice.payment_succeeded
                 invoice.payment_failed

Save it. Stripe then shows a ${b("Signing secret")} starting with ${b("whsec_")}.
`);
const wh = await askHidden("Paste the whsec_ value here: ");
if (!/^whsec_/.test(wh)) {
  console.log(red("\nThat should start with whsec_. Run this again once you have it."));
  exit(1);
}
setSecret("STRIPE_WEBHOOK_SECRET", wh);
try { run(`${WRANGLER} deploy`, { quiet: true }); } catch { /* the health check below reports it */ }

/* 7. Check it */
step(7, "Checking it works");
let health = {};
try { health = await (await fetch(`${url}/health`)).json(); } catch { /* reported below */ }
console.log(health.auth ? green("  Storage ready") : red("  Storage not ready"));
console.log(health.webhook ? green("  Stripe is pushing payments here") : red("  Webhook secret not registered"));

/* 8. Hook the dashboard up */
step(8, "Connecting the dashboard");
writeFileSync(".env", `VITE_RELAY_URL=${url}\n`);
console.log(green("Wrote .env"), dim(`VITE_RELAY_URL=${url}`));

const email = (await ask("\nWhat email do you want to sign in with? ")).trim();

console.log(`\n${b("Two things left:")}

  1. Make your login (it will ask you to pick a password):

     ${b(`SYNC_TOKEN='${owner}' node relay/adduser.mjs ${url} ${email || "you@yourcompany.com"} "Your Name"`)}

  2. Rebuild the dashboard so it knows the address:

     ${b("npm run build")}

${b("Keep this safe")} - it is your relay's owner password, needed to add more logins later:

  ${owner}
`);
rl.close();
