import { useState, useEffect, useRef, useCallback } from "react";
import { KEY, SEED, SEED_REFUND_TYPES, DEF, HOUR, uid } from "./shared";
import { storage } from "./storage";

/* The shared record, and the rules for reading and writing it.

   Both windows poll every 20 seconds and skip the poll while a local write is
   in flight, so the last writer wins rather than a stale read clobbering a
   fresh edit. `updatedAt` on the record is what tells a poll whether the copy
   it just read is newer than what we already have. */

export function useBoard() {
  const [st, setSt] = useState({ orders: [], products: SEED, refundTypes: SEED_REFUND_TYPES, refunds: [], settings: DEF, updatedAt: 0 });
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
          setSt({ products: SEED, refundTypes: SEED_REFUND_TYPES, refunds: [], settings: DEF, orders: [], ...p });
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
          toSave = fn({ products: SEED, refundTypes: SEED_REFUND_TYPES, refunds: [], settings: DEF, orders: [], ...remote });
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
  "amountRefunded", "refundedAt", "receiptUrl", "subscriptionStatus", "cardBrand", "cardLast4", "cardExp"];

/* Turning payment drafts into board orders.

   Deduped on the Stripe id, but a repeat is not simply dropped: a refund or a
   failure reaches us on the same payment we already have, so the payment side
   of an existing order is updated in place. Without that, a refund issued in
   Stripe would never appear on the board at all. */
export function appendOrders(x, drafts) {
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
    const p = x.products.find((y) => y.id === d.productId), at = d.receivedAt || Date.now();
    /* A renewal of a subscription already on the board is not a new signup.
       Marked so the board can say so, rather than sending someone off to
       onboard a client who was onboarded months ago. */
    const renewal = !!(d.subscriptionId && x.orders.some((o) => o.subscriptionId === d.subscriptionId));

    /* A draft may carry its own fulfillment state — the sample loader builds
       delivered history that way. Stripe drafts never do, so they land as new. */
    return { id: uid(), ...d, paymentStatus: d.paymentStatus || "succeeded", productName: p ? p.name : d.productName,
      receivedAt: at, dueAt: at + (p ? p.slaHours : 24) * HOUR, status: d.status || "new",
      assignee: d.assignee || "Unassigned", notes: d.notes || "", checklist: d.checklist || {},
      completedAt: d.completedAt ?? null, overdueNotified: d.overdueNotified ?? false,
      renewal: d.renewal ?? renewal };
  });
  const orders = updates.size
    ? x.orders.map((o) => (updates.has(o.id) ? { ...o, ...updates.get(o.id) } : o))
    : x.orders;
  return { next: { ...x, orders: [...added, ...orders] }, added, updated: updates.size };
}
