import { useState, useEffect, useRef, useCallback } from "react";
import { KEY, SEED, DEF, HOUR, uid } from "./shared";
import { storage } from "./storage";

/* The shared record, and the rules for reading and writing it.

   Both windows poll every 20 seconds and skip the poll while a local write is
   in flight, so the last writer wins rather than a stale read clobbering a
   fresh edit. `updatedAt` on the record is what tells a poll whether the copy
   it just read is newer than what we already have. */

export function useBoard() {
  const [st, setSt] = useState({ orders: [], products: SEED, settings: DEF, updatedAt: 0 });
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
          setSt({ products: SEED, settings: DEF, orders: [], ...p });
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

  const commit = useCallback(async (fn, note, flash) => {
    dirty.current = true;
    const next = typeof fn === "function" ? fn(R.current) : fn;
    next.updatedAt = Date.now(); lu.current = next.updatedAt; R.current = next; setSt(next);
    if (note && flash) flash(note);
    try { await storage.set(KEY, JSON.stringify(next), true); setErr(null); }
    catch (e) { setErr("Changes did not save. Check your connection, then hit refresh."); }
    finally { dirty.current = false; }
    return next;
  }, []);

  return { st, setSt, loading, err, setErr, load, commit, R };
}

/* Turning payment drafts into board orders. Deduped on the Stripe id so a
   re-sync of an overlapping window doesn't double up. */
export function appendOrders(x, drafts) {
  const seen = new Set(x.orders.map((o) => o.externalId).filter(Boolean));
  const added = drafts.filter((d) => !d.externalId || !seen.has(d.externalId)).map((d) => {
    const p = x.products.find((y) => y.id === d.productId), at = d.receivedAt || Date.now();
    /* A draft may carry its own fulfillment state — the sample loader builds
       delivered history that way. Stripe drafts never do, so they land as new. */
    return { id: uid(), ...d, paymentStatus: d.paymentStatus || "succeeded", productName: p ? p.name : d.productName,
      receivedAt: at, dueAt: at + (p ? p.slaHours : 24) * HOUR, status: d.status || "new",
      assignee: d.assignee || "Unassigned", notes: d.notes || "", checklist: d.checklist || {},
      completedAt: d.completedAt ?? null, overdueNotified: d.overdueNotified ?? false };
  });
  return { next: { ...x, orders: [...added, ...x.orders] }, added };
}
