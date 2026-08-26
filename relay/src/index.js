/* Stripe relay — the one piece that holds your secret key.

   The browser can't call Stripe directly: a secret key in front-end code is a
   secret key on every laptop that opens the page. So this Worker sits in
   between. It holds the key as a Worker secret, exposes exactly two things,
   and refuses everything else.

     GET  /orders?since=<unix seconds>   recent charges, newest first
     GET  /kv/:key   PUT /kv/:key        the shared board record (optional)

   Both are gated on SYNC_TOKEN — a password you invent, not your Stripe key.

   Deploy:
     cd relay
     npx wrangler kv namespace create BOARD      # only if you want shared storage
     npx wrangler secret put STRIPE_SECRET_KEY   # sk_live_… or sk_test_…
     npx wrangler secret put SYNC_TOKEN          # any long random string
     npx wrangler deploy

   Then paste https://<your-worker>.workers.dev/orders into the Admin Console
   under Settings → Stripe connection, with the same SYNC_TOKEN. */

const STRIPE = "https://api.stripe.com/v1";

const cors = (origin) => ({
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Methods": "GET,PUT,DELETE,OPTIONS",
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

function authed(req, env) {
  const want = env.SYNC_TOKEN;
  if (!want) return false; // unset means locked, never open
  const got = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  return sameToken(got, want);
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
   hand the Desk one flat object per payment. */
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
    if (path === "/" || path === "/health") return json({ ok: true, service: "stripe-relay" }, 200, origin);

    if (!authed(req, env)) return json({ error: "Unauthorized" }, 401, origin);

    if (path === "/orders" && req.method === "GET") {
      if (!env.STRIPE_SECRET_KEY) return json({ error: "STRIPE_SECRET_KEY is not set on this Worker." }, 500, origin);
      const raw = Number(url.searchParams.get("since"));
      // Default to 30 days back; ignore anything that isn't a sane timestamp.
      const floor = Math.floor(Date.now() / 1000) - 30 * 24 * 3600;
      const since = Number.isFinite(raw) && raw > 0 ? Math.max(Math.floor(raw), floor) : floor;
      try {
        return json(await recentOrders(env, since), 200, origin);
      } catch (e) {
        return json({ error: String(e.message || e) }, 502, origin);
      }
    }

    /* Shared board storage. Point the app at this Worker with
       VITE_STORAGE_URL and every browser reads one record. */
    if (path.startsWith("/kv/")) {
      if (!env.BOARD) return json({ error: "No KV namespace bound. Add [[kv_namespaces]] BOARD in wrangler.toml." }, 501, origin);
      const key = decodeURIComponent(path.slice(4));
      if (!key) return json({ error: "Missing key" }, 400, origin);

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
