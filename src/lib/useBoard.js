import { useState, useEffect, useRef, useCallback } from "react";
import { KEY, SEED, SEED_REFUND_TYPES, DEF, HOUR, uid, blockedBy } from "./shared";
import { storage } from "./storage";

/* The shared record, and the rules for reading and writing it.

   Both windows poll every 20 seconds and skip the poll while a local write is
   in flight, so the last writer wins rather than a stale read clobbering a
   fresh edit. `updatedAt` on the record is what tells a poll whether the copy
   it just read is newer than what we already have. */

export function useBoard() {
  const [st, setSt] = useState({ orders: [], products: SEED, refundTypes: SEED_REFUND_TYPES, refunds: [], customers: [], blocks: [], settings: DEF, updatedAt: 0 });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const dirty = useRef(false), lu = useRef(0), R = useRef(st);
  useEffect(() => { R.current = st; }, [st]);

  const load = useCallback(async (silent) => {
    try {
      const r = await storage.get(KEY, true);
      if (r?.value) {
        const p = JSON.parse(r.value);
        if (!silent || (p.updatedAt || 0) > lu.current) {
          setSt({ products: SEED, refundTypes: SEED_REFUND_TYPES, refunds: [], customers: [], blocks: [], settings: DEF, orders: [], ...p });
          lu.current = p.updatedAt || 0;
        }
      }
      setErr(null);
    } catch (e) {
      if (!silent) setErr("Couldn't read the shared record. Working from the last copy on this device.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(false); }, [load]);
  useEffect(() => { const t = setInterval(() => { if (!dirty.current) load(true); }, 2e4); return () => clearInterval(t); }, [load]);
  /* Another tab on this machine writing is worth picking up immediately. */
  useEffect(() => storage.subscribe(KEY, () => { if (!dirty.current) load(true); }), [load]);

  /* Saving a change.

     The whole record is written at once, so two people working at the same
     time could each overwrite the other's edit — the assistant marks an order
     delivered while the owner renames a product, and one of them silently
     loses it. Before writing, re-read: if someone else got there first, the
     same change is re-applied on top of theirs rather than over them. That
     needs `fn` to be a function of the record, which every caller here is. */
  const commit = useCallback(async (fn, note, flash) => {
    dirty.current = true;
    const base = lu.current;
    const next = typeof fn === "function" ? fn(R.current) : fn;
    next.updatedAt = Date.now(); lu.current = next.updatedAt; R.current = next; setSt(next);
    if (note && flash) flash(note);
    try {
      let toSave = next;
      if (typeof fn === "function") {
        const cur = await storage.get(KEY, true);
        const remote = cur?.value ? JSON.parse(cur.value) : null;
        if (remote && (remote.updatedAt || 0) > base) {
          toSave = fn({ products: SEED, refundTypes: SEED_REFUND_TYPES, refunds: [], customers: [], blocks: [], settings: DEF, orders: [], ...remote });
          toSave.updatedAt = Date.now();
          lu.current = toSave.updatedAt; R.current = toSave; setSt(toSave);
        }
      }
      await storage.set(KEY, JSON.stringify(toSave), true);
      setErr(null);
      return toSave;
    }
    catch (e) { setErr("Changes did not save. Check your connection, then hit refresh."); }
    finally { dirty.current = false; }
    return next;
  }, []);

  return { st, setSt, loading, err, setErr, load, commit, R };
}

/* What Stripe can tell us about a payment after the order already exists.
   Everything else on an order — who owns it, how far through it is, the notes
   — belongs to whoever is working it and is never touched from here. */
const PAYMENT_FACTS = ["paymentStatus", "declineCode", "declineReason", "refunded",
  "amountRefunded", "refundedAt", "receiptUrl", "subscriptionStatus", "cardBrand", "cardLast4", "cardExp",
  "disputed", "disputeStatus"];

/* Two events about one payment can arrive in the same poll — a charge and its
   invoice, or a charge and the dispute that later reverses it. Left alone,
   each becomes its own order and the same money is worked twice. Folded here
   on the Stripe id, with a failure winning: a chargeback must never be filed
   under a payment the board still shows as collected. */
function fold(drafts) {
  const out = [];
  const at = new Map();
  for (const d of drafts) {
    const key = d.externalId;
    if (!key || !at.has(key)) { if (key) at.set(key, out.length); out.push(d); continue; }
    const i = at.get(key), prev = out[i], next = { ...prev };
    for (const [k, v] of Object.entries(d)) {
      const empty = v == null || v === "" || (Array.isArray(v) && !v.length);
      if (!empty) next[k] = v;
    }
    if (prev.paymentStatus === "failed" || d.paymentStatus === "failed") next.paymentStatus = "failed";
    next.refunded = !!(prev.refunded || d.refunded);
    next.disputed = !!(prev.disputed || d.disputed);
    out[i] = next;
  }
  return out;
}

/* Turning payment drafts into board orders.

   Deduped on the Stripe id, but a repeat is not simply dropped: a refund or a
   failure reaches us on the same payment we already have, so the payment side
   of an existing order is updated in place. Without that, a refund issued in
   Stripe would never appear on the board at all. */
export function appendOrders(x, all) {
  /* A blocked payment never becomes an order. Filtering only on the way out
     would work, but the board would still fill up with records nobody wants,
     and every list would pay to skip them again. The count is kept so a rule
     can say what it has caught — a filter whose effect is invisible is how an
     order goes missing without anyone noticing. */
  const blocks = x.blocks || [];
  const caught = new Map();
  const drafts = fold(all).filter((d) => {
    const r = blocks.length ? blockedBy(d, blocks) : null;
    if (r) caught.set(r.id, (caught.get(r.id) || 0) + 1);
    return !r;
  });
  const byExternal = new Map(x.orders.map((o) => [o.externalId, o]).filter(([k]) => k));
  const updates = new Map();
  for (const d of drafts) {
    const prior = d.externalId && byExternal.get(d.externalId);
    if (!prior) continue;
    const patch = {};
    for (const k of PAYMENT_FACTS) {
      if (d[k] == null || d[k] === "") continue;
      if (prior[k] !== d[k]) patch[k] = d[k];
    }
    if (Object.keys(patch).length) updates.set(prior.id, patch);
  }

  const seen = new Set(byExternal.keys());
  const added = drafts.filter((d) => !d.externalId || !seen.has(d.externalId)).map((d) => {
    const at = d.receivedAt || Date.now();
    /* A renewal of a subscription already on the board is not a new signup.
       Marked so the board can say so, rather than sending someone off to
       onboard a client who was onboarded months ago. */
    const sib = d.subscriptionId ? x.orders.find((o) => o.subscriptionId === d.subscriptionId) : null;
    const renewal = !!sib;

    /* A subscription ending carries only the Stripe customer id and the price
       it billed — Stripe puts the name on the payment, and a cancellation has
       no payment. The board already knows this client from the months they
       did pay, so the row says who it is and sits with the right product
       rather than reading "Unnamed customer / Needs triage". */
    const known = sib
      ? {
        ...(d.customer === "Unnamed customer" ? { customer: sib.customer } : null),
        email: d.email || sib.email, phone: d.phone || sib.phone,
        productId: d.productId || sib.productId,
      }
      : null;
    const p = x.products.find((y) => y.id === (known?.productId || d.productId));

    /* A draft may carry its own fulfillment state — the sample loader builds
       delivered history that way. Stripe drafts never do, so they land as new. */
    return { id: uid(), ...d, ...known, paymentStatus: d.paymentStatus || "succeeded", productName: p ? p.name : d.productName,
      receivedAt: at, dueAt: at + (p ? p.slaHours : 24) * HOUR, status: d.status || "new",
      assignee: d.assignee || "Unassigned", notes: d.notes || "", checklist: d.checklist || {},
      completedAt: d.completedAt ?? null, overdueNotified: d.overdueNotified ?? false,
      renewal: d.renewal ?? renewal };
  });
  const orders = updates.size
    ? x.orders.map((o) => (updates.has(o.id) ? { ...o, ...updates.get(o.id) } : o))
    : x.orders;
  const nextBlocks = caught.size
    ? blocks.map((r) => (caught.has(r.id) ? { ...r, hits: (r.hits || 0) + caught.get(r.id), lastHit: Date.now() } : r))
    : blocks;
  return {
    next: { ...x, orders: [...added, ...orders], ...(caught.size ? { blocks: nextBlocks } : null) },
    added, updated: updates.size, blocked: [...caught.values()].reduce((a, b) => a + b, 0),
  };
}
