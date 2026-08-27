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
  /* Stripe separates the last word with a dot on some events and an underscore
     on others — charge.failed against invoice.payment_failed. Matching on
     ".failed" quietly let every failed subscription renewal through as a
     success, which is the one thing that must never happen here. */
  const failed = /fail/.test(type) || o.status === "failed" || o.status === "uncollectible";

  const lines = o.lines?.data || o.line_items?.data || [];
  const first = lines[0] || {};
  const price = first.price || {};
  const chargeId = String(o.id || "").startsWith("ch_") ? o.id : (typeof o.charge === "string" ? o.charge : "");
  const paymentId = typeof o.payment_intent === "string" ? o.payment_intent : "";

  return {
    /* One payment, one id. Stripe fires several events for the same money —
       charge.succeeded and invoice.payment_succeeded both land for every
       subscription renewal — so they key on the payment itself, or the board
       grows a duplicate order every month. */
    id: paymentId || chargeId || o.id,
    chargeId,
    paymentId: paymentId || o.id,
    status: failed ? "failed" : "succeeded",
    paymentStatus: failed ? "failed" : "succeeded",
    declineCode: o.failure_code || o.outcome?.reason || "",
    declineReason: o.failure_message || o.outcome?.seller_message || o.last_payment_error?.message || "",
    refunded: !!o.refunded,
    amount: o.amount ?? o.amount_total ?? o.amount_paid ?? o.amount_due ?? null,
    amountRefunded: o.amount_refunded ?? null,
    currency: o.currency || "usd",
    created: o.created,
    receiptUrl: o.receipt_url || "",
    payment_method_details: o.payment_method_details,
    billing_details: o.billing_details,
    customer: o.customer,
    customer_details: o.customer_details,
    /* An invoice carries the customer's name on itself rather than in
       billing_details. Without these a failed renewal reads "Unnamed
       customer", and nobody knows who to chase. */
    customerName: o.customer_name || "",
    customerEmail: o.customer_email || "",
    customerPhone: o.customer_phone || "",
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

/* Combine two views of the same payment. A later event wins only where it
   actually says something; a failure is sticky, because a charge.succeeded
   arriving alongside a failed invoice must not quietly mark it paid. */
export function mergeOrders(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const empty = v == null || v === "" || (Array.isArray(v) && !v.length)
      || (typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length);
    if (!empty) out[k] = v;
  }
  /* Only the invoice knows what was actually sold. A charge for a subscription
     carries the description "Subscription creation", which is true and
     useless — and would replace the real product name depending on which
     event happened to arrive second. */
  const LINE_DERIVED = ["productName", "priceId", "stripeProductId", "interval", "intervalCount", "quantity", "items"];
  if (!b.items?.length && a.items?.length) {
    for (const k of LINE_DERIVED) if (a[k] != null && a[k] !== "") out[k] = a[k];
  }

  if (a.paymentStatus === "failed" || b.paymentStatus === "failed") {
    out.paymentStatus = "failed";
    out.status = "failed";
    out.declineCode = b.declineCode || a.declineCode || "";
    out.declineReason = b.declineReason || a.declineReason || "";
  }
  out.refunded = !!(a.refunded || b.refunded);
  return out;
}
