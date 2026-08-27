/* Stripe pushing payments to us, instead of us asking every few minutes.

   A webhook URL is public — anyone can POST to it. So the only thing that
   makes this safe is the signature: Stripe signs each delivery with a secret
   only it and this Worker know, and anything that doesn't verify is dropped
   before it's looked at. Without that check, a stranger could invent orders
   on your board. */

const TOLERANCE = 300; // seconds; an old delivery is a replay, not news

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

function equalHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* Verify against the RAW body. Re-serializing the JSON first would change a
   byte somewhere and every delivery would fail to verify. */
export async function verify(rawBody, header, secret, nowSeconds) {
  if (!secret) return { ok: false, reason: "No STRIPE_WEBHOOK_SECRET is set on this Worker." };
  if (!header) return { ok: false, reason: "Missing Stripe-Signature header." };

  const parts = Object.create(null);
  const v1 = [];
  for (const piece of header.split(",")) {
    const i = piece.indexOf("=");
    if (i < 0) continue;
    const k = piece.slice(0, i).trim(), v = piece.slice(i + 1).trim();
    if (k === "v1") v1.push(v); else parts[k] = v;
  }

  const t = Number(parts.t);
  if (!Number.isFinite(t)) return { ok: false, reason: "Signature header has no timestamp." };
  const now = nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - t) > TOLERANCE) return { ok: false, reason: "Signature timestamp is outside the tolerance window." };
  if (!v1.length) return { ok: false, reason: "Signature header has no v1 signature." };

  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${rawBody}`));
  const expected = hex(mac);

  // Stripe sends several v1 values while a secret is being rotated.
  return v1.some((sig) => equalHex(sig, expected))
    ? { ok: true }
    : { ok: false, reason: "Signature does not match." };
}

/* Which events carry a payment worth putting on the board. */
export const HANDLED = new Set([
  "charge.succeeded",
  "charge.failed",
  "charge.refunded",
  "checkout.session.completed",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
]);

/* Flatten an event into the same shape GET /orders returns, so the app's
   normalizer doesn't need to know which of the two paths it came from. */
export function fromEvent(event) {
  const o = event?.data?.object;
  if (!o) return null;
  const type = event.type || "";
  const card = o.payment_method_details?.card || {};
  const failed = type.endsWith(".failed") || o.status === "failed";

  const lines = o.lines?.data || o.line_items?.data || [];
  const first = lines[0] || {};
  const price = first.price || {};

  return {
    id: o.id,
    chargeId: String(o.id || "").startsWith("ch_") ? o.id : (o.charge || ""),
    paymentId: typeof o.payment_intent === "string" ? o.payment_intent : o.id,
    status: failed ? "failed" : "succeeded",
    paymentStatus: failed ? "failed" : "succeeded",
    declineCode: o.failure_code || o.outcome?.reason || "",
    declineReason: o.failure_message || o.outcome?.seller_message || o.last_payment_error?.message || "",
    refunded: !!o.refunded,
    amount: o.amount ?? o.amount_total ?? o.amount_paid ?? null,
    currency: o.currency || "usd",
    created: o.created,
    receiptUrl: o.receipt_url || "",
    payment_method_details: o.payment_method_details,
    billing_details: o.billing_details,
    customer: o.customer,
    customer_details: o.customer_details,
    invoice: typeof o.invoice === "string" ? o.invoice : "",
    subscriptionId: typeof o.subscription === "string" ? o.subscription : "",
    description: o.description || "",
    metadata: o.metadata || {},
    priceId: price.id || "",
    stripeProductId: typeof price.product === "string" ? price.product : "",
    productName: first.description || price.nickname || o.description || "",
    interval: price.recurring?.interval || "",
    intervalCount: price.recurring?.interval_count || 1,
    quantity: first.quantity ?? 1,
    cardBrand: card.brand || "",
    cardLast4: card.last4 || "",
    items: lines.map((l) => ({
      description: l.description || l.price?.nickname || "",
      quantity: l.quantity ?? 1,
      amount: l.amount ?? l.amount_total ?? null,
      priceId: l.price?.id || "",
      productId: typeof l.price?.product === "string" ? l.price.product : "",
      interval: l.price?.recurring?.interval || null,
      intervalCount: l.price?.recurring?.interval_count || 1,
    })),
  };
}
