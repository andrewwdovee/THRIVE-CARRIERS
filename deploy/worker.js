/**
 * Thrive relay — a Cloudflare Worker.
 *
 * Speaks exactly the protocol the Lead Tech Fulfillment board was already
 * built against, so pointing that board at this URL makes it sync without
 * changing a line of its app code:
 *
 *   POST /auth/login    {email, password}      -> {token, user}
 *   GET  /auth/me       Bearer token           -> {user} | 401
 *   POST /auth/logout   Bearer token           -> {ok: true}
 *   GET  /kv/:key       Bearer token           -> {value} | 404
 *   PUT  /kv/:key       Bearer token, {value}  -> {ok: true}
 *
 * Plus one route the board did not ask for, added for onboarding:
 *
 *   POST /onboarding/submit        no token, {record} -> {ok: true, id}
 *   POST /onboarding/preferences   no token, {email, ...} -> {ok: true, ...}
 *   GET  /onboarding/roster        no token            -> {slots: [...]}
 *   POST /refund-request           no token, an agent's refund slip -> {ok: true}
 *   GET  /refund-requests          Bearer token        -> [request, ...]
 *   POST /stripe/webhook           Stripe-Signature    -> {ok: true}
 *   GET  /orders?since=<unix s>    Bearer token        -> [order, ...]
 *
 * It is the only unauthenticated write, because the person signing the
 * agreement has no account yet. It is not open: the CORS allow-list
 * above still applies, so only the onboarding page's own origin can
 * reach it from a browser. It only ever appends, never reads back.
 *
 * Storage is a KV namespace. Tokens are stateless: an HMAC over the email
 * and an expiry, so there is no session table to keep and logging out is
 * client-side. That is a deliberate trade — see LOGOUT below.
 *
 * NOT TESTED against a live Cloudflare account. Deploy it to a throwaway
 * worker first and run the smoke tests in DEPLOY.md before pointing
 * anything real at it.
 */

import { verify, HANDLED, fromEvent, mergeOrders } from "./stripe-webhook.js";

const TOKEN_TTL_DAYS = 30;
const enc = new TextEncoder();

/* Onboarding. The index key is written with the `kv:` prefix the board
   uses, so an ordinary GET /kv/onboarding/submissions reads it. */
const ONBOARD_INDEX = "kv:onboarding/submissions";
const ONBOARD_DOC = "onboarding/doc/";
const ONBOARD_MAX_BYTES = 3.2 * 1024 * 1024;
const ONBOARD_MAX_SIG = 400 * 1024;
const ONBOARD_MAX_PHOTO = 2.6 * 1024 * 1024;
const ONBOARD_MAX_ROWS = 2000;
const ONBOARD_PER_HOUR = 6;
const PREFS_PER_HOUR = 20;
/* The only weekly volumes on offer. 0 is "taking the week off". */
const CALL_TIERS = [15, 25, 35, 50, 0];
/* Where the Lead Tech board keeps who is switched off (its {off, log}
   record, written through the /kv route). */
const STARTTIMES_KEY = "kv:starttimes/state";
const BUSY_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const BUSY_PARTS = ["AM", "PM", "All day"];
/* The only start times the desk runs. The signing page and the settings
   page both offer these two, and the relay accepts nothing else. */
const ONBOARD_SLOTS = ["10:00 AM EST", "11:00 AM EST"];

/* Refund slips from the public form on the Lead Tech board (#request).
   Two kinds: two bad calls earn one refund, and a duplicate call is one
   call that is a refund on its own. */
const RR_PREFIX = "rr:";
const RR_TTL = 120 * 24 * 3600;          /* long enough to settle a dispute */
const RR_MAX_BODY = 8 * 1024;
const RR_MAX_CALLS = 12;
const RR_PER_HOUR = 20;
const RR_REASONS = ["non_consumer", "agent", "dead_air", "other", "duplicate"];

function readRefundRequest(body) {
  const str = (v, max) => String(v ?? "").trim().slice(0, max);
  const first = str(body?.first, 80);
  const last = str(body?.last, 80);
  const email = str(body?.email, 160).toLowerCase();
  const day = str(body?.day, 10);
  if (!first || !last) return { error: "A first and last name are needed." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "That email address doesn't look right." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { error: "A date is needed." };

  const kind = body?.kind === "duplicate" ? "duplicate" : "pair";
  const raw = Array.isArray(body?.calls) ? body.calls.slice(0, kind === "duplicate" ? 1 : RR_MAX_CALLS) : [];
  const calls = [];
  for (const c of raw) {
    const phone = str(c?.phone, 24);
    const reason = kind === "duplicate" ? "duplicate" : str(c?.reason, 32);
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) return { error: "Each call needs a phone number of at least 10 digits." };
    if (RR_REASONS.indexOf(reason) < 0 || (kind === "pair" && reason === "duplicate")) {
      return { error: "Pick a reason for each call." };
    }
    calls.push({ phone, digits, reason, note: str(c?.note, 200) });
  }
  if (kind === "duplicate") {
    if (calls.length !== 1) return { error: "A duplicate call needs its phone number." };
  } else if (calls.length < 2) {
    return { error: "Two calls are needed for one refund." };
  }
  return { value: { kind, first, last, email, day, calls, note: str(body?.note, 500) } };
}

/* Stripe. Every payment Stripe pushes lands in the inbox for a week; the
   portal polls GET /orders and keeps its own copy for good, so nothing is
   lost when an entry expires. Two secrets:
     STRIPE_WEBHOOK_SECRET  whsec_...  required; it is what proves a delivery
                            came from Stripe and not from a stranger
     STRIPE_SECRET_KEY      rk_... or sk_...  optional; a read-only restricted
                            key lets the relay look up what was bought on a
                            Payment Link, and lets the portal backfill */
const STRIPE_API = "https://api.stripe.com/v1";
const INBOX_TTL = 7 * 24 * 3600;
const INBOX_OVERLAP = 600;

async function stripeGet(env, path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`${STRIPE_API}/${path}${qs ? `?${qs}` : ""}`, {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Stripe-Version": "2024-06-20" },
  });
  if (!r.ok) throw new Error(`Stripe ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

/* A Payment Link checkout says who paid and how much, but not what for:
   the line items are left out of the event. Ask for them, so the order
   arrives already named and sorted into its product's lane. */
async function withLineItems(env, event) {
  const o = event.data && event.data.object;
  if (event.type !== "checkout.session.completed" || !o || !o.id || !env.STRIPE_SECRET_KEY) return event;
  if (o.line_items && o.line_items.data && o.line_items.data.length) return event;
  try {
    const li = await stripeGet(env, `checkout/sessions/${o.id}/line_items`, { limit: "20", "expand[]": "data.price.product" });
    const data = (li.data || []).map((l) => {
      const prod = l.price && typeof l.price.product === "object" ? l.price.product : null;
      return {
        ...l,
        description: l.description || (prod && prod.name) || "",
        price: l.price ? { ...l.price, product: prod ? prod.id : l.price.product } : l.price,
      };
    });
    return { ...event, data: { ...event.data, object: { ...o, line_items: { data } } } };
  } catch {
    return event;   /* an unnamed order beats a lost one */
  }
}

async function inboxSince(env, since) {
  const out = [];
  let cursor;
  do {
    const page = await env.THRIVE_KV.list({ prefix: "inbox:", cursor });
    for (const k of page.keys) {
      const at = Number(k.name.split(":")[1]);
      if (Number.isFinite(at) && at < since - INBOX_OVERLAP) continue;
      const raw = await env.THRIVE_KV.get(k.name);
      if (raw) { try { out.push(JSON.parse(raw)); } catch { /* skip a bad row */ } }
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return out;
}

/* The backfill: ask Stripe directly for recent charges, to catch anything
   a delivery outage lost. Only with a secret key, and only on request. */
async function recentCharges(env, since) {
  const page = await stripeGet(env, "charges", { limit: "100", "created[gte]": String(since), "expand[]": "data.customer" });
  return (page.data || []).map((ch) => fromEvent({ type: "charge." + ch.status, data: { object: ch } }));
}

/* ---------------------------------------------------------------- utils */

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extra },
  });
}

/* The board sends credentials, so the allow-list is explicit: a bare
   wildcard would let any page on the internet drive this API as your
   browser. One narrow exception — an entry like
   "https://*.thrive-command.pages.dev" matches subdomains of that one
   domain, because Pages gives every deployment its own hostname and they
   are all yours. It never matches a different domain, and never http. */
function originAllowed(origin, allowed) {
  if (!origin) return false;
  let host;
  try {
    const u = new URL(origin);
    if (u.protocol !== "https:") return false;
    host = u.hostname;
  } catch {
    return false;
  }
  return allowed.some((entry) => {
    if (entry === origin) return true;
    if (!entry.startsWith("https://*.")) return false;
    const base = entry.slice("https://*.".length);
    return base.length > 0 && (host === base || host.endsWith("." + base));
  });
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!originAllowed(origin, allowed)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,PUT,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function b64url(bytes) {
  let s = "";
  const b = new Uint8Array(bytes);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlToBytes(s) {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(pad + "=".repeat((4 - (pad.length % 4)) % 4));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/* Constant-time compare: a plain === on a signature leaks its prefix to a
   patient attacker through timing. */
function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

async function pbkdf2(password, saltHex, iterations) {
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, 256
  );
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ----------------------------------------------------------- token auth */

async function issueToken(env, email) {
  const payload = b64url(enc.encode(JSON.stringify({
    e: email,
    x: Date.now() + TOKEN_TTL_DAYS * 86400000,
  })));
  const sig = b64url(await hmac(env.TOKEN_SECRET, payload));
  return `${payload}.${sig}`;
}

async function readToken(env, request) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || token.indexOf(".") < 0) return null;
  const [payload, sig] = token.split(".");
  const expect = await hmac(env.TOKEN_SECRET, payload);
  let given;
  try { given = b64urlToBytes(sig); } catch { return null; }
  if (!sameBytes(expect, given)) return null;
  let body;
  try { body = JSON.parse(new TextDecoder().decode(b64urlToBytes(payload))); } catch { return null; }
  if (!body || !body.x || Date.now() > body.x) return null;
  return { email: body.e };
}

/* The LOA Producer Desk signs its producers in itself, so it carries one
   shared DESK_TOKEN instead of an owner session. That token reaches only
   the desk's two keys, and only to read or write them. */
const DESK_KEYS = new Set(["loa.state", "snapshots.loa"]);

function readDeskToken(env, request) {
  if (!env.DESK_TOKEN) return null;
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || !sameBytes(enc.encode(token), enc.encode(env.DESK_TOKEN))) return null;
  return { role: "desk" };
}

/* --------------------------------------------------------------- routes */

/* Which pieces of configuration are present. Booleans only — never a
   value — so this is safe to read from a browser or paste into a chat. */
function configReport(env) {
  return {
    ownerEmail: !!env.OWNER_EMAIL && env.OWNER_EMAIL !== "you@example.com",
    passwordSalt: typeof env.OWNER_PASSWORD_SALT === "string" && env.OWNER_PASSWORD_SALT.length > 0,
    saltLooksValid: typeof env.OWNER_PASSWORD_SALT === "string" && /^[0-9a-fA-F]{32}$/.test(env.OWNER_PASSWORD_SALT.trim()),
    passwordHash: typeof env.OWNER_PASSWORD_HASH === "string" && env.OWNER_PASSWORD_HASH.length > 0,
    hashLooksValid: typeof env.OWNER_PASSWORD_HASH === "string" && /^[0-9a-fA-F]{64}$/.test(env.OWNER_PASSWORD_HASH.trim()),
    tokenSecret: typeof env.TOKEN_SECRET === "string" && env.TOKEN_SECRET.length > 0,
    kv: !!env.THRIVE_KV,
    stripeWebhook: typeof env.STRIPE_WEBHOOK_SECRET === "string" && env.STRIPE_WEBHOOK_SECRET.startsWith("whsec_"),
    stripeKey: typeof env.STRIPE_SECRET_KEY === "string" && env.STRIPE_SECRET_KEY.length > 0,
    iterations: Number(env.OWNER_PASSWORD_ITER || 0),
    allowedOrigins: (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean),
  };
}

/* A missing secret used to surface as Cloudflare's blank 500 page, which
   says nothing about what is wrong. Name the gap instead. */
function missingConfig(env) {
  const c = configReport(env);
  const gaps = [];
  if (!c.passwordSalt) gaps.push("OWNER_PASSWORD_SALT is not set");
  else if (!c.saltLooksValid) gaps.push("OWNER_PASSWORD_SALT is not 32 hex characters — the wrong value was pasted");
  if (!c.passwordHash) gaps.push("OWNER_PASSWORD_HASH is not set");
  else if (!c.hashLooksValid) gaps.push("OWNER_PASSWORD_HASH is not 64 hex characters — the wrong value was pasted");
  if (!c.tokenSecret) gaps.push("TOKEN_SECRET is not set");
  if (!c.ownerEmail) gaps.push("OWNER_EMAIL is not set in wrangler.toml");
  /* Workers cap PBKDF2 here. Above it, every login throws — so say so on
     /health rather than letting it surface as a failed sign-in. */
  if (c.iterations > 100000) {
    gaps.push("OWNER_PASSWORD_ITER is " + c.iterations + " — Cloudflare Workers do not support PBKDF2 above 100000");
  }
  return gaps;
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (err) {
      /* Never let an exception become a blank Cloudflare error page. */
      return json({
        error: "The relay hit an unexpected error.",
        detail: (err && err.message) || String(err),
        config: configReport(env),
      }, 500);
    }
  },
};

async function handle(request, env) {
  {
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return cors
        ? new Response(null, { status: 204, headers: cors })
        : new Response("origin not allowed", { status: 403 });
    }
    /* A browser request from an unlisted origin is refused outright rather
       than answered without CORS headers, which would fail confusingly. */
    if (request.headers.get("Origin") && !cors) {
      return json({ error: "Origin not allowed" }, 403);
    }
    const head = cors || {};

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/" || path === "/health") {
      return json({
        ok: true,
        service: "thrive-relay",
        /* The portal reads this to know Stripe pushes to us, so it can
           check every few seconds instead of on a long timer. */
        webhook: !!(env.STRIPE_WEBHOOK_SECRET && env.THRIVE_KV),
        config: configReport(env),
        missing: missingConfig(env),
      }, 200, head);
    }

    /* ---- Stripe pushing a payment ----
       No token: Stripe cannot send one. The signature is the check, and
       nothing is stored until it passes. */
    if (path === "/stripe/webhook" && request.method === "POST") {
      const raw = await request.text();
      const check = await verify(raw, request.headers.get("Stripe-Signature"), env.STRIPE_WEBHOOK_SECRET);
      if (!check.ok) return json({ error: check.reason }, 400);
      let event;
      try { event = JSON.parse(raw); } catch { return json({ error: "Body is not JSON." }, 400); }
      /* Acknowledge what we do not act on, or Stripe retries it for days. */
      if (!HANDLED.has(event.type)) return json({ ok: true, ignored: event.type });
      /* A subscription checkout is told again, with its line items, by the
         invoice and the charge that follow it. Taking the session too would
         put the first month on the board twice. */
      if (event.type === "checkout.session.completed" && event.data?.object?.mode === "subscription") {
        return json({ ok: true, ignored: "subscription checkout: the invoice carries it" });
      }
      /* A session that is still waiting on a bank transfer has not paid. */
      if (event.type === "checkout.session.completed" && event.data?.object?.payment_status === "unpaid") {
        return json({ ok: true, ignored: "not paid yet" });
      }

      const order = fromEvent(await withLineItems(env, event));
      if (!order || !order.id) return json({ ok: true, ignored: "no payment object" });

      /* One payment fires several events (the checkout, the charge, the
         invoice) at slightly different times. The first to arrive claims a
         key; the rest find it through the pointer and merge into it. */
      const at = Number(order.created) || Math.floor(Date.now() / 1000);
      const ptr = `idx:${order.id}`;
      const key = (await env.THRIVE_KV.get(ptr)) || `inbox:${String(at).padStart(12, "0")}:${order.id}`;
      const prior = await env.THRIVE_KV.get(key);
      const merged = prior ? mergeOrders(JSON.parse(prior), order) : order;
      await env.THRIVE_KV.put(key, JSON.stringify(merged), { expirationTtl: INBOX_TTL });
      if (!prior) await env.THRIVE_KV.put(ptr, key, { expirationTtl: INBOX_TTL * 4 });
      return json({ ok: true, received: order.id });
    }

    /* ---- orders, for the signed-in portal ---- */
    if (path === "/orders" && request.method === "GET") {
      const who = await readToken(env, request);
      if (!who) return json({ error: "Signed out" }, 401, head);
      const asked = Number(url.searchParams.get("since"));
      const floor = Math.floor(Date.now() / 1000) - 30 * 24 * 3600;
      const since = Number.isFinite(asked) && asked > 0 ? Math.max(Math.floor(asked), floor) : floor;
      const nocache = { ...head, "Cache-Control": "no-store" };

      const pushed = await inboxSince(env, since);
      if (url.searchParams.get("backfill") !== "1" || !env.STRIPE_SECRET_KEY) return json(pushed, 200, nocache);
      try {
        const polled = await recentCharges(env, since);
        const seen = new Set(pushed.map((o) => o.id));
        return json([...pushed, ...polled.filter((o) => o && !seen.has(o.id))], 200, nocache);
      } catch {
        return json(pushed, 200, nocache);   /* partial beats nothing */
      }
    }

    /* ---- auth ---- */
    if (path === "/auth/login" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "Bad request" }, 400, head); }
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      if (!email || !password) return json({ error: "Email and password are required." }, 400, head);

      const gaps = missingConfig(env);
      if (gaps.length) {
        return json({ error: "The relay is not fully configured.", missing: gaps }, 500, head);
      }

      if (email !== String(env.OWNER_EMAIL || "").trim().toLowerCase()) {
        return json({ error: "That email and password don't match." }, 401, head);
      }
      const hash = await pbkdf2(password, env.OWNER_PASSWORD_SALT.trim(), Number(env.OWNER_PASSWORD_ITER || 210000));
      if (!sameBytes(enc.encode(hash), enc.encode(env.OWNER_PASSWORD_HASH.trim()))) {
        return json({ error: "That email and password don't match." }, 401, head);
      }
      return json({ token: await issueToken(env, email), user: { email } }, 200, head);
    }

    if (path === "/auth/me" && request.method === "GET") {
      const who = await readToken(env, request);
      if (!who) return json({ error: "Signed out" }, 401, head);
      return json({ user: { email: who.email } }, 200, head);
    }

    /* LOGOUT is a no-op by design. Tokens are stateless, so the client
       drops it and stops sending it. If you ever need real revocation,
       keep an issued-at floor in KV and reject tokens older than it. */
    if (path === "/auth/logout" && request.method === "POST") {
      return json({ ok: true }, 200, head);
    }

    /* ---- onboarding ----
       The signer has no login, so this one write carries no token. Four
       things keep it from being a hole: the CORS allow-list above, a
       size cap, a per-address hourly throttle, and the fact that it can
       only append. Reading the submissions back is an ordinary
       authenticated GET /kv/onboarding/submissions.

       The index holds everything except the two images, so the board's
       grid is one small read however many people have signed. The
       signature and the photo go in their own document, fetched only
       when a row is opened. */
    if (path === "/onboarding/submit" && request.method === "POST") {
      const raw = await request.text();
      if (raw.length > ONBOARD_MAX_BYTES) {
        return json({ error: "That submission is too large. Try a smaller photo." }, 413, head);
      }
      let body;
      try { body = JSON.parse(raw); } catch { return json({ error: "Bad request" }, 400, head); }

      /* Best effort only: KV is eventually consistent, so two requests
         landing together can both read the same count. It is a brake on
         a script, not a lock. */
      const who = await hmac(
        env.TOKEN_SECRET || "onboarding",
        request.headers.get("CF-Connecting-IP") || "unknown"
      );
      const bucket = `rate:onboard:${who.slice(0, 24)}:${Math.floor(Date.now() / 36e5)}`;
      const seen = Number(await env.THRIVE_KV.get(bucket)) || 0;
      if (seen >= ONBOARD_PER_HOUR) {
        return json({ error: "Too many submissions from here in the last hour." }, 429, head);
      }

      const text = (v, max) => String(v == null ? "" : v).trim().slice(0, max);
      const rec = {
        legalName: text(body.legalName, 160),
        business:  text(body.business, 160),
        email:     text(body.email, 160).toLowerCase(),
        phone:     text(body.phone, 60),
        npn:       text(body.npn, 60),
        referrer:  text(body.referrer, 120),
        startTime: text(body.startTime, 60),
        signedName: text(body.signedName, 160),
        signedDate: text(body.signedDate, 20),
        thriveSignedName: text(body.thriveSignedName, 160),
        thriveSignedDate: text(body.thriveSignedDate, 20),
        version:   text(body.version, 40),
        tz:        text(body.tz, 60),
        agent:     text(body.agent, 200),
      };
      /* Initials from the Thrive Companies agreement: short keys to a few
         letters each, and no more of them than the agreement asks for. */
      rec.thriveInitials = {};
      if (body.thriveInitials && typeof body.thriveInitials === "object") {
        Object.keys(body.thriveInitials).slice(0, 24).forEach((k) => {
          const key = String(k).replace(/[^a-z0-9_]/gi, "").slice(0, 24);
          const val = text(body.thriveInitials[k], 6).toUpperCase().replace(/[^A-Z]/g, "");
          if (key && val) rec.thriveInitials[key] = val;
        });
      }
      const signature = typeof body.signature === "string" ? body.signature : "";
      const thriveSignature = typeof body.thriveSignature === "string" ? body.thriveSignature : "";
      const photo = typeof body.photo === "string" ? body.photo : "";

      const missing = ["legalName", "business", "email", "phone", "startTime",
        "signedName", "thriveSignedName"].filter((k) => !rec[k]);
      if (missing.length) return json({ error: "Missing fields", missing }, 400, head);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(rec.email)) {
        return json({ error: "That email does not look right." }, 400, head);
      }
      /* Two agreements, two signatures. Both or neither — a record with
         one of them signed is not a record of anything. */
      for (const [what, png] of [["Lead Tech", signature], ["Thrive Companies", thriveSignature]]) {
        if (!png.startsWith("data:image/png")) {
          return json({ error: `The ${what} signature is missing.` }, 400, head);
        }
        if (png.length > ONBOARD_MAX_SIG) {
          return json({ error: `That ${what} signature is too large.` }, 413, head);
        }
      }
      if (photo && !photo.startsWith("data:image/")) {
        return json({ error: "That photo is not an image." }, 400, head);
      }
      if (photo.length > ONBOARD_MAX_PHOTO) {
        return json({ error: "That photo is too large." }, 413, head);
      }

      const id = "ob_" + Date.now().toString(36) + "_" + b64url(crypto.getRandomValues(new Uint8Array(6)));
      const signedAt = new Date().toISOString();

      let index = [];
      try { index = JSON.parse((await env.THRIVE_KV.get(ONBOARD_INDEX)) || "[]"); } catch { index = []; }
      if (!Array.isArray(index)) index = [];
      if (index.length >= ONBOARD_MAX_ROWS) {
        return json({ error: "The onboarding list is full. Clear it from the board." }, 507, head);
      }

      /* What the grid needs, and nothing that costs bytes. */
      index.unshift({
        id,
        signedAt,
        signedDate: rec.signedDate,
        legalName: rec.legalName,
        business: rec.business,
        email: rec.email,
        phone: rec.phone,
        startTime: rec.startTime,
        version: rec.version,
        /* The headshot is optional and only means anything for an internal
           agent, so "not given" is null — nothing missing — not false. */
        steps: {
          details: true,
          read: true,
          agreed: true,
          signed: true,
          thriveRead: true,
          thriveSigned: true,
          photo: photo ? true : null,
        },
        reviewed: false,
      });

      await env.THRIVE_KV.put(`kv:${ONBOARD_DOC}${id}`,
        JSON.stringify({ ...rec, id, signedAt, signature, thriveSignature, photo }));
      await env.THRIVE_KV.put(ONBOARD_INDEX, JSON.stringify(index));
      await env.THRIVE_KV.put(bucket, String(seen + 1), { expirationTtl: 7200 });

      return json({ ok: true, id, signedAt }, 200, head);
    }

    /* Changing a start time, a weekly volume or a note, from the page
       the desk hands out. Also unauthenticated, for the same reason, and
       with the same guards. It can only touch a row that already exists:
       no creating, no deleting, and nothing outside these three fields.
       Every change is stamped and the last ten kept on the row, so the
       desk can see what moved and when.

       It is keyed on the email alone, which means somebody who knows a
       client's address could change their start time. That is the price
       of a link that works without a login; it is reversible from the
       board, it is logged, and none of it is sensitive. Put it behind a
       code if that trade stops being worth it. */
    if (path === "/onboarding/preferences" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "Bad request" }, 400, head); }

      const who = await hmac(
        env.TOKEN_SECRET || "onboarding",
        request.headers.get("CF-Connecting-IP") || "unknown"
      );
      const bucket = `rate:prefs:${who.slice(0, 24)}:${Math.floor(Date.now() / 36e5)}`;
      const seen = Number(await env.THRIVE_KV.get(bucket)) || 0;
      if (seen >= PREFS_PER_HOUR) {
        return json({ error: "Too many changes from here in the last hour." }, 429, head);
      }

      const email = String(body.email || "").trim().toLowerCase().slice(0, 160);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return json({ error: "That email does not look right." }, 400, head);
      }

      const startTime = String(body.startTime || "").trim();
      if (startTime && ONBOARD_SLOTS.indexOf(startTime) < 0) {
        return json({ error: "That is not one of the start times." }, 400, head);
      }
      let callsPerWeek = null;
      if (String(body.callsPerWeek || "").trim() !== "") {
        const n = Math.round(Number(body.callsPerWeek));
        if (CALL_TIERS.indexOf(n) < 0) {
          return json({ error: `Calls a week has to be one of ${CALL_TIERS.join(", ")}.` }, 400, head);
        }
        callsPerWeek = n;
      }
      /* Days off the fixed list, in week order however they arrive. */
      let busyDays = null;
      if (Array.isArray(body.busyDays)) {
        const picked = body.busyDays.map((d) => String(d).trim());
        if (picked.some((d) => BUSY_DAYS.indexOf(d) < 0)) {
          return json({ error: "That is not a day of the week." }, 400, head);
        }
        busyDays = BUSY_DAYS.filter((d) => picked.indexOf(d) >= 0);
      }
      let busyPart = null;
      if (body.busyPart != null && String(body.busyPart).trim() !== "") {
        busyPart = String(body.busyPart).trim();
        if (BUSY_PARTS.indexOf(busyPart) < 0) {
          return json({ error: "Busy time has to be AM, PM or All day." }, 400, head);
        }
      }
      const note = String(body.note == null ? "" : body.note).trim().slice(0, 600);
      if (!startTime && callsPerWeek === null && busyDays === null && !busyPart && !note) {
        return json({ error: "Nothing to change." }, 400, head);
      }

      let index = [];
      try { index = JSON.parse((await env.THRIVE_KV.get(ONBOARD_INDEX)) || "[]"); } catch { index = []; }
      if (!Array.isArray(index)) index = [];
      const row = index.find((r) => String(r.email || "").toLowerCase() === email);
      if (!row) {
        return json({ error: "We cannot find that email on an onboarded account. Check it, or ask the desk." }, 404, head);
      }

      const at = new Date().toISOString();
      if (startTime) row.startTime = startTime;
      if (callsPerWeek !== null) row.callsPerWeek = callsPerWeek;
      if (busyDays !== null) row.busyDays = busyDays;
      if (busyPart) row.busyPart = busyPart;
      if (note) row.note = note;
      row.prefsUpdatedAt = at;
      row.prefsLog = [{ at, startTime: startTime || null, callsPerWeek, note: note || null }]
        .concat(Array.isArray(row.prefsLog) ? row.prefsLog : [])
        .slice(0, 10);

      await env.THRIVE_KV.put(ONBOARD_INDEX, JSON.stringify(index));
      await env.THRIVE_KV.put(bucket, String(seen + 1), { expirationTtl: 7200 });

      return json({
        ok: true, at,
        startTime: row.startTime || "",
        callsPerWeek: row.callsPerWeek == null ? "" : row.callsPerWeek,
        busyDays: row.busyDays || [],
        busyPart: row.busyPart || "",
        note: row.note || "",
      }, 200, head);
    }

    /* The board that everyone can see: who is on which start time, what
       they are taking, and when they are typically busy.

       Deliberately narrow. The email is the key to changing somebody's
       settings on the route above, so it never leaves here — and nor do
       the phone number, the NPN, the agreements or anything else on the
       record. Names and a schedule, nothing more. */
    if (path === "/onboarding/roster" && request.method === "GET") {
      let index = [];
      try { index = JSON.parse((await env.THRIVE_KV.get(ONBOARD_INDEX)) || "[]"); } catch { index = []; }
      if (!Array.isArray(index)) index = [];
      /* Who the board has switched off. Only a yes/no per person comes down
         here; the email it is keyed on stays on this side. */
      let offMap = {};
      try { offMap = (JSON.parse((await env.THRIVE_KV.get(STARTTIMES_KEY)) || "{}") || {}).off || {}; } catch { offMap = {}; }
      /* One row per person: signing twice keeps the latest answer. */
      const latest = new Map();
      index.filter((r) => r && r.legalName).forEach((r) => {
        const k = String(r.email || r.id || "").toLowerCase();
        const prev = latest.get(k);
        if (prev && new Date(prev.signedAt) >= new Date(r.signedAt)) return;
        latest.set(k, r);
      });
      /* The public board shows each person's full name, start time, how many
         calls they want this week and the weekdays they are not available.
         Email and phone stay on this side. */
      const people = [...latest.values()].map((r) => ({
        id: String(r.id || ""),
        name: String(r.legalName || ""),
        startTime: ONBOARD_SLOTS.indexOf(r.startTime) >= 0 ? r.startTime : "",
        busyDays: Array.isArray(r.busyDays) ? r.busyDays.filter((d) => BUSY_DAYS.indexOf(d) >= 0) : [],
        busyPart: BUSY_PARTS.indexOf(r.busyPart) >= 0 ? r.busyPart : "",
        callsPerWeek: r.callsPerWeek === "" || r.callsPerWeek == null || isNaN(Number(r.callsPerWeek))
          ? null : Math.max(0, Math.round(Number(r.callsPerWeek))),
        off: !!offMap[String(r.email || "").toLowerCase()],
      }));
      return json({
        slots: ONBOARD_SLOTS,
        days: BUSY_DAYS,
        parts: BUSY_PARTS,
        people,
      }, 200, { ...head, "Cache-Control": "no-store" });
    }

    /* ---- refund slips ----
       The form goes to agents with no account, so the POST takes no token:
       a fixed shape, a size cap, a rate limit, and nothing comes back. */
    if (path === "/refund-request" && request.method === "POST") {
      const raw = await request.text();
      if (raw.length > RR_MAX_BODY) return json({ error: "That's too long." }, 413, head);
      let body;
      try { body = JSON.parse(raw); } catch { return json({ error: "Couldn't read that." }, 400, head); }
      const { value, error } = readRefundRequest(body);
      if (error) return json({ error }, 400, head);

      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const who = await hmac(env.TOKEN_SECRET || "refunds", ip);
      const bucket = `rate:refund:${who.slice(0, 24)}:${Math.floor(Date.now() / 36e5)}`;
      const seen = Number(await env.THRIVE_KV.get(bucket)) || 0;
      if (seen >= RR_PER_HOUR) return json({ error: "Too many requests from here. Try again later." }, 429, head);

      const at = Date.now();
      const id = crypto.randomUUID();
      await env.THRIVE_KV.put(
        `${RR_PREFIX}${String(Math.floor(at / 1000)).padStart(12, "0")}:${id}`,
        JSON.stringify({ ...value, id, at }),
        { expirationTtl: RR_TTL },
      );
      await env.THRIVE_KV.put(bucket, String(seen + 1), { expirationTtl: 7200 });
      return json({ ok: true }, 200, head);
    }

    if (path === "/refund-requests" && request.method === "GET") {
      const who = await readToken(env, request);
      if (!who) return json({ error: "Signed out" }, 401, head);
      const out = [];
      let cursor;
      do {
        const page = await env.THRIVE_KV.list({ prefix: RR_PREFIX, cursor });
        for (const k of page.keys) {
          const v = await env.THRIVE_KV.get(k.name);
          if (v) { try { out.push(JSON.parse(v)); } catch { /* skip a bad row */ } }
        }
        cursor = page.list_complete ? null : page.cursor;
      } while (cursor);
      return json(out.sort((a, b) => b.at - a.at), 200, { ...head, "Cache-Control": "no-store" });
    }

    /* ---- key/value ---- */
    if (path.startsWith("/kv/")) {
      const who = (await readToken(env, request)) || readDeskToken(env, request);
      if (!who) return json({ error: "Signed out" }, 401, head);

      const key = decodeURIComponent(path.slice(4));
      if (!key || key.length > 256) return json({ error: "Bad key" }, 400, head);
      if (who.role === "desk" && !DESK_KEYS.has(key)) {
        return json({ error: "This token may only reach the desk's own keys." }, 403, head);
      }

      if (request.method === "GET") {
        const value = await env.THRIVE_KV.get(`kv:${key}`);
        if (value === null) return json({ error: "Not found" }, 404, head);
        return json({ value, key }, 200, head);
      }

      if (request.method === "PUT") {
        let body;
        try { body = await request.json(); } catch { return json({ error: "Bad request" }, 400, head); }
        /* The board sends the record already serialized, as {value:"..."}.
           Anything else is stringified so the store stays uniform. */
        const value = typeof body.value === "string" ? body.value : JSON.stringify(body.value);
        if (value.length > 20 * 1024 * 1024) return json({ error: "Too large" }, 413, head);
        await env.THRIVE_KV.put(`kv:${key}`, value);
        return json({ ok: true, key, bytes: value.length }, 200, head);
      }
    }

    return json({ error: "Not found" }, 404, head);
  }
}
