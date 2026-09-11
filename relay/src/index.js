/* Stripe relay — the one piece that holds your secret key.

   The browser can't call Stripe directly: a secret key in front-end code is a
   secret key on every laptop that opens the page. So this Worker sits in
   between. It holds the key as a Worker secret, exposes exactly two things,
   and refuses everything else.

     POST /stripe/webhook                     Stripe pushes payments here
     POST /refund-request                     an agent's refund form — no token
     GET  /refund-requests                    what they sent, for signed-in staff
     POST /auth/login   {email, password}  ->  a session token
     GET  /auth/me                            who the token belongs to
     POST /auth/logout                        revoke this token
     GET  /orders?since=<unix seconds>        recent charges, newest first
     GET  /kv/:key   PUT /kv/:key             the shared board record

   Orders and the board need a signed-in session, or SYNC_TOKEN for
   machine-to-machine use. Managing accounts needs SYNC_TOKEN — a password
   you invent, not your Stripe key. The webhook is the exception: Stripe
   can't carry a token, so its signature is what authenticates it.

   Deploy:
     cd relay
     npx wrangler kv namespace create BOARD      # only if you want shared storage
     npx wrangler secret put STRIPE_SECRET_KEY   # sk_live_… or sk_test_…
     npx wrangler secret put SYNC_TOKEN          # any long random string
     npx wrangler deploy

   Then paste https://<your-worker>.workers.dev/orders into the dashboard
   under Settings → Stripe connection, with the same SYNC_TOKEN. */

import { createUser, deleteUser, listUsers, login, logout, session, bearer } from "./auth.js";
import { verify, HANDLED, fromEvent, mergeOrders } from "./stripe-webhook.js";
import { readRequest, overLimit, tooBig, requestKey, REQUEST_TTL } from "./refund-requests.js";

const STRIPE = "https://api.stripe.com/v1";

const cors = (origin) => ({
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Authorization,Content-Type",
  "Access-Control-Max-Age": "86400",
});

const json = (body, status, origin) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors(origin) },
  });

/* Constant-time compare so a wrong token can't be guessed a character at a
   time off response timing. */
function sameToken(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* The owner's shared secret. Machine-to-machine only — a browser should be
   signing in instead, so no page ever has to hold this. */
function ownerToken(req, env) {
  const want = env.SYNC_TOKEN;
  if (!want) return false; // unset means locked, never open
  return sameToken(bearer(req), want);
}

/* The LOA desk's token. That desk is a page anyone with the link can open,
   so it must never hold a credential that opens the whole relay: this one
   reaches exactly two keys and nothing else — no orders, no accounts, no
   other board. Set it with `wrangler secret put DESK_TOKEN`. */
const DESK_KEYS = new Set(["loa.state", "snapshots.loa"]);
function deskToken(req, env) {
  const want = env.DESK_TOKEN;
  if (!want) return false;
  return sameToken(bearer(req), want);
}

/* Who is asking. A signed-in person, the owner's token, the desk, or nobody. */
async function caller(req, env) {
  if (ownerToken(req, env)) return { role: "owner", via: "token" };
  if (deskToken(req, env)) return { role: "desk", via: "token" };
  const s = await session(env, bearer(req));
  return s ? { ...s, via: "session" } : null;
}

/* Allowed browser origins. Set ALLOWED_ORIGINS in wrangler.toml to your app's
   URL(s); "*" during local development. */
function originFor(req, env) {
  const origin = req.headers.get("Origin");
  const allowed = (env.ALLOWED_ORIGINS || "*").split(",").map((s) => s.trim()).filter(Boolean);
  if (allowed.includes("*")) return origin || "*";
  return origin && allowed.includes(origin) ? origin : allowed[0] || "";
}

async function stripe(env, path, params) {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`${STRIPE}/${path}${qs ? `?${qs}` : ""}`, {
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Stripe-Version": "2024-06-20",
    },
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`Stripe ${r.status}: ${body.slice(0, 300)}`);
  }
  return r.json();
}

/* Charges carry the money and the card; the price/product ids that tell the
   board which lane an order belongs to live on the invoice. Pull both, then
   hand the board one flat object per payment. */
const INBOX_TTL = 7 * 24 * 3600;
const OVERLAP = 600;

/* Payments Stripe pushed to us, newest last. Read-only and idempotent —
   entries expire on their own rather than being consumed, so two browsers
   polling at once both see everything. */
async function inboxSince(env, since) {
  if (!env.BOARD) return [];
  const out = [];
  let cursor;
  do {
    const page = await env.BOARD.list({ prefix: "inbox:", cursor });
    for (const k of page.keys) {
      const at = Number(k.name.split(":")[1]);
      if (Number.isFinite(at) && at < since - OVERLAP) continue;
      const raw = await env.BOARD.get(k.name);
      if (raw) out.push(JSON.parse(raw));
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return out;
}

async function recentOrders(env, since) {
  const page = await stripe(env, "charges", {
    limit: "100",
    "created[gte]": String(since),
    "expand[]": "data.customer",
  });

  const out = [];
  for (const ch of page.data || []) {
    let lines = [];
    let subscriptionId = "";
    let subscriptionStatus = "";

    if (ch.invoice) {
      try {
        const inv = await stripe(env, `invoices/${ch.invoice}`, {});
        lines = inv.lines?.data || [];
        subscriptionId = typeof inv.subscription === "string" ? inv.subscription : "";
      } catch {
        /* An invoice we can't read shouldn't drop the payment off the board. */
      }
    }

    if (subscriptionId) {
      try {
        const sub = await stripe(env, `subscriptions/${subscriptionId}`, {});
        subscriptionStatus = sub.status || "";
      } catch {
        /* status is cosmetic — carry on without it */
      }
    }

    const first = lines[0] || {};
    const price = first.price || {};

    out.push({
      id: ch.id,
      chargeId: ch.id,
      paymentId: typeof ch.payment_intent === "string" ? ch.payment_intent : ch.id,
      status: ch.status === "succeeded" && !ch.refunded ? "succeeded" : ch.status,
      paymentStatus: ch.status === "succeeded" ? "succeeded" : "failed",
      declineCode: ch.failure_code || ch.outcome?.reason || "",
      declineReason: ch.failure_message || ch.outcome?.seller_message || "",
      refunded: !!ch.refunded,
      amount: ch.amount,
      currency: ch.currency,
      created: ch.created,
      receiptUrl: ch.receipt_url || "",
      payment_method: ch.payment_method,
      payment_method_details: ch.payment_method_details,
      billing_details: ch.billing_details,
      customer: ch.customer,
      invoice: typeof ch.invoice === "string" ? ch.invoice : "",
      subscriptionId,
      subscriptionStatus,
      description: ch.description || "",
      metadata: ch.metadata || {},
      priceId: price.id || "",
      stripeProductId: typeof price.product === "string" ? price.product : "",
      productName: first.description || price.nickname || ch.description || "",
      interval: price.recurring?.interval || "",
      intervalCount: price.recurring?.interval_count || 1,
      quantity: first.quantity ?? 1,
      items: lines.map((l) => ({
        description: l.description || l.price?.nickname || "",
        quantity: l.quantity ?? 1,
        amount: l.amount ?? null,
        priceId: l.price?.id || "",
        productId: typeof l.price?.product === "string" ? l.price.product : "",
        interval: l.price?.recurring?.interval || null,
        intervalCount: l.price?.recurring?.interval_count || 1,
      })),
    });
  }
  return out;
}

export default {
  async fetch(req, env) {
    const origin = originFor(req, env);
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    if (path === "/" || path === "/health") {
      // Tells the app whether this relay can sign people in at all.
      return json({ ok: true, service: "stripe-relay", auth: !!env.BOARD, webhook: !!(env.STRIPE_WEBHOOK_SECRET && env.BOARD) }, 200, origin);
    }

    /* ── Stripe pushing a payment ──
       No token here: Stripe can't send one. The signature is the check, and
       nothing is stored until it passes. */
    if (path === "/stripe/webhook" && req.method === "POST") {
      const raw = await req.text();
      const check = await verify(raw, req.headers.get("Stripe-Signature"), env.STRIPE_WEBHOOK_SECRET);
      if (!check.ok) return json({ error: check.reason }, 400, origin);
      if (!env.BOARD) return json({ error: "No KV namespace bound, so there is nowhere to put this." }, 501, origin);

      let event;
      try { event = JSON.parse(raw); } catch { return json({ error: "Body is not JSON." }, 400, origin); }
      // Acknowledge anything we don't act on, or Stripe retries it forever.
      if (!HANDLED.has(event.type)) return json({ ok: true, ignored: event.type }, 200, origin);

      const order = fromEvent(event);
      if (!order?.id) return json({ ok: true, ignored: "no payment object" }, 200, origin);

      const at = Number(order.created) || Math.floor(Date.now() / 1000);

      /* Events about one payment don't agree on when it happened — a renewal's
         invoice is drafted up to an hour before its charge, and a dispute
         arrives days later. The timestamp is in the key so a poll can skip old
         entries cheaply, which means the same payment would otherwise land
         under two keys and show up twice. A pointer from the payment id to
         whichever key it first claimed keeps it to one record. */
      const ptr = `idx:${order.id}`;
      const key = (await env.BOARD.get(ptr)) || `inbox:${String(at).padStart(12, "0")}:${order.id}`;

      /* Each event knows part of the story: the charge has the card, the
         invoice has the line items and the subscription. Merge rather than
         overwrite, so whichever lands second doesn't erase the first and a
         retry of either is harmless. */
      const prior = await env.BOARD.get(key);
      const merged = prior ? mergeOrders(JSON.parse(prior), order) : order;
      await env.BOARD.put(key, JSON.stringify(merged), { expirationTtl: INBOX_TTL });
      /* Outlives the record it points at, so a dispute weeks later still finds
         its charge instead of starting a second one. */
      if (!prior) await env.BOARD.put(ptr, key, { expirationTtl: INBOX_TTL * 4 });
      return json({ ok: true, received: order.id }, 200, origin);
    }

    /* ── an agent asking for a refund ──
       No token: the form goes to people who have no account here and must
       never get one. So this is the one route a stranger can reach, and
       everything about it is shaped by that — a fixed shape, a size cap, a
       rate limit, and no way to read anything back. */
    if (path === "/refund-request" && req.method === "POST") {
      if (!env.BOARD) return json({ error: "Not accepting requests right now." }, 503, origin);

      const raw = await req.text();
      if (tooBig(raw)) return json({ error: "That's too long." }, 413, origin);

      const ip = req.headers.get("CF-Connecting-IP") || "";
      if (await overLimit(env, ip)) {
        return json({ error: "Too many requests from here. Try again later." }, 429, origin);
      }

      let body;
      try { body = JSON.parse(raw); } catch { return json({ error: "Couldn't read that." }, 400, origin); }
      const { value, error } = readRequest(body);
      if (error) return json({ error }, 400, origin);

      const at = Math.floor(Date.now() / 1000);
      const id = crypto.randomUUID();
      await env.BOARD.put(
        requestKey(at, id),
        JSON.stringify({ ...value, id, at: at * 1000, ip: ip ? ip.slice(0, 45) : "" }),
        { expirationTtl: REQUEST_TTL },
      );
      /* Nothing about the board comes back — an acknowledgement only. */
      return json({ ok: true }, 200, origin);
    }

    /* ── signing in ── */
    if (path === "/auth/login" && req.method === "POST") {
      if (!env.BOARD) return json({ error: "This relay has no KV namespace, so it can't hold accounts." }, 501, origin);
      const body = await req.json().catch(() => ({}));
      const out = await login(env, body.email, body.password);
      // One message for both failures: saying which was wrong tells an
      // attacker which addresses have accounts.
      if (!out) return json({ error: "That email and password don't match." }, 401, origin);
      return json(out, 200, origin);
    }

    const who = await caller(req, env);

    if (path === "/auth/me") {
      if (!who) return json({ error: "Unauthorized" }, 401, origin);
      return json({ user: { email: who.email || null, name: who.name || "Owner token", role: who.role || "owner" } }, 200, origin);
    }
    if (path === "/auth/logout" && req.method === "POST") {
      await logout(env, bearer(req));
      return json({ ok: true }, 200, origin);
    }

    /* ── accounts: owner only ── */
    if (path === "/auth/users") {
      if (!ownerToken(req, env)) return json({ error: "Managing accounts needs the owner token." }, 403, origin);
      if (!env.BOARD) return json({ error: "This relay has no KV namespace, so it can't hold accounts." }, 501, origin);
      if (req.method === "GET") return json({ users: await listUsers(env) }, 200, origin);
      if (req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        try { return json({ user: await createUser(env, body) }, 200, origin); }
        catch (e) { return json({ error: String(e.message || e) }, 400, origin); }
      }
      if (req.method === "DELETE") {
        const body = await req.json().catch(() => ({}));
        if (!body.email) return json({ error: "Which account? Pass {\"email\": \"…\"}." }, 400, origin);
        await deleteUser(env, body.email);
        return json({ ok: true }, 200, origin);
      }
    }

    if (!who) return json({ error: "Unauthorized" }, 401, origin);

    /* The desk's credential lives in a page anyone can open, so it reaches the
       desk's own storage and nothing else. Everything past here is off limits
       to it — orders, refund requests, the lot. */
    if (who.role === "desk" && !path.startsWith("/kv/")) {
      return json({ error: "This token may only reach the desk's own keys." }, 403, origin);
    }

    if (path === "/refund-requests" && req.method === "GET") {
      if (!who) return json({ error: "Unauthorized" }, 401, origin);
      if (!env.BOARD) return json([], 200, origin);
      const out = [];
      let cursor;
      do {
        const page = await env.BOARD.list({ prefix: "rr:", cursor });
        for (const k of page.keys) {
          const v = await env.BOARD.get(k.name);
          if (v) out.push(JSON.parse(v));
        }
        cursor = page.list_complete ? null : page.cursor;
      } while (cursor);
      return json(out.sort((a, b) => b.at - a.at), 200, origin);
    }

    if (path === "/orders" && req.method === "GET") {
      const raw = Number(url.searchParams.get("since"));
      // Default to 30 days back; ignore anything that isn't a sane timestamp.
      const floor = Math.floor(Date.now() / 1000) - 30 * 24 * 3600;
      const since = Number.isFinite(raw) && raw > 0 ? Math.max(Math.floor(raw), floor) : floor;

      const pushed = await inboxSince(env, since);

      /* With a webhook configured, the inbox is the live feed and calling
         Stripe on every poll would be slow and pointless. Ask for a backfill
         to reconcile anything a delivery outage lost. */
      const live = !!(env.STRIPE_WEBHOOK_SECRET && env.BOARD);
      const backfill = url.searchParams.get("backfill") === "1";
      if (live && !backfill) return json(pushed, 200, origin);

      if (!env.STRIPE_SECRET_KEY) {
        if (live) return json(pushed, 200, origin);
        return json({ error: "STRIPE_SECRET_KEY is not set on this Worker." }, 500, origin);
      }
      try {
        const polled = await recentOrders(env, since);
        const seen = new Set(pushed.map((o) => o.id));
        return json([...pushed, ...polled.filter((o) => !seen.has(o.id))], 200, origin);
      } catch (e) {
        if (pushed.length) return json(pushed, 200, origin); // partial beats nothing
        return json({ error: String(e.message || e) }, 502, origin);
      }
    }

    /* Shared board storage. Point the app at this Worker with
       VITE_STORAGE_URL and every browser reads one record. */
    if (path.startsWith("/kv/")) {
      if (!env.BOARD) return json({ error: "No KV namespace bound. Add [[kv_namespaces]] BOARD in wrangler.toml." }, 501, origin);
      const key = decodeURIComponent(path.slice(4));
      if (!key) return json({ error: "Missing key" }, 400, origin);

      /* The desk token is scoped. Anything else it asks for is refused here,
         so a copy of the desk page is not a copy of the relay. */
      if (who.role === "desk") {
        if (!DESK_KEYS.has(key)) {
          return json({ error: "This token may only reach the desk's own keys." }, 403, origin);
        }
        if (req.method === "DELETE") {
          return json({ error: "This token may not delete." }, 403, origin);
        }
      }

      if (req.method === "GET") {
        const value = await env.BOARD.get(key);
        return value == null ? json({ error: "Not found" }, 404, origin) : json({ key, value }, 200, origin);
      }
      if (req.method === "PUT") {
        const body = await req.json().catch(() => null);
        if (typeof body?.value !== "string") return json({ error: "Body must be {\"value\": \"<string>\"}" }, 400, origin);
        await env.BOARD.put(key, body.value);
        return json({ key, ok: true }, 200, origin);
      }
      if (req.method === "DELETE") {
        await env.BOARD.delete(key);
        return json({ key, ok: true }, 200, origin);
      }
    }

    return json({ error: "Not found" }, 404, origin);
  },
};
