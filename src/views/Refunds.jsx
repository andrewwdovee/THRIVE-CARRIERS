import React, { useState, useMemo } from "react";
import { Plus, X, Undo2, TrendingDown } from "lucide-react";
import {
  BD, CARD, IN, BTN, PRI, M, F, W, c, cash, uid, L, Field, Confirm, REFUND_REASONS,
} from "../lib/shared";

/* Money that went back out.

   Two kinds end up here. A charge Stripe tells us was refunded shows up on its
   own; anything settled outside Stripe — a call credited back, a partial —
   gets recorded by hand. Both are grouped by product, because the question
   worth answering is which thing you sell is costing you the most in refunds,
   not which customer asked. */

const money = (rows) => rows.reduce((s, r) => s + (r.amount || 0), 0);

export default function Refunds({ refunds, products, orders, onRecord, onRemove, onAnnotate }) {
  const [adding, setAdding] = useState(null);
  const [openGroup, setOpenGroup] = useState(null);

  const groups = useMemo(() => {
    const rows = products.map((p) => ({
      id: p.id, name: p.name, color: p.color,
      rows: refunds.filter((r) => r.productId === p.id),
    }));
    const loose = refunds.filter((r) => !r.productId || !products.some((p) => p.id === r.productId));
    if (loose.length) rows.push({ id: "_none", name: "Not linked to a product", color: "slate", rows: loose });
    return rows.filter((g) => g.rows.length).sort((a, b) => money(b.rows) - money(a.rows));
  }, [refunds, products]);

  const total = money(refunds);
  const worst = groups[0];
  const byReason = useMemo(() => {
    const m = new Map();
    refunds.forEach((r) => {
      const k = r.reason || "Not given";
      m.set(k, { reason: k, n: (m.get(k)?.n || 0) + 1, amount: (m.get(k)?.amount || 0) + (r.amount || 0) });
    });
    return [...m.values()].sort((a, b) => b.amount - a.amount);
  }, [refunds]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid flex-1 gap-3 sm:grid-cols-3">
          <div className={`${CARD} p-4`}>
            <L>Refunded</L>
            <div className={`mt-2 font-mono text-2xl font-bold tabular-nums ${total ? "text-rose-400" : W}`}>{cash(total)}</div>
          </div>
          <div className={`${CARD} p-4`}>
            <L>Refunds given</L>
            <div className={`mt-2 font-mono text-2xl font-bold tabular-nums ${W}`}>{refunds.length}</div>
          </div>
          <div className={`${CARD} p-4`}>
            <L>Costs you most</L>
            <div className={`mt-2 text-base font-bold leading-tight ${W}`}>{worst ? worst.name : "—"}</div>
            {worst && <div className={`mt-0.5 font-mono text-xs ${M}`}>{cash(money(worst.rows))}</div>}
          </div>
        </div>
        <button onClick={() => setAdding({ id: uid("rf"), at: Date.now(), currency: "USD" })}
          className={`inline-flex items-center gap-1.5 ${PRI}`}><Plus className="h-4 w-4" /> Record a refund</button>
      </div>

      {!refunds.length && (
        <div className={`${CARD} px-6 py-10 text-center`}>
          <Undo2 className={`mx-auto h-8 w-8 ${F}`} />
          <h2 className={`mt-3 text-base font-semibold ${W}`}>No refunds yet</h2>
          <p className={`mx-auto mt-2 max-w-sm text-sm ${M}`}>
            A refund you issue in Stripe turns up here on its own. Anything you settle another way,
            record it here so the totals stay honest.
          </p>
        </div>
      )}

      {groups.map((g) => {
        const open = openGroup === g.id;
        return (
          <section key={g.id} className={`overflow-hidden rounded-xl border-l-4 ${c(g.color)[2]} border-y border-r ${BD} bg-slate-900/40`}>
            <button onClick={() => setOpenGroup(open ? null : g.id)}
              className="flex w-full flex-wrap items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-900">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${c(g.color)[0]}`} />
              <span className={`font-semibold ${W}`}>{g.name}</span>
              <span className={`text-xs ${F}`}>{g.rows.length} refund{g.rows.length === 1 ? "" : "s"}</span>
              <span className="ml-auto flex items-center gap-3">
                <TrendingDown className="h-3.5 w-3.5 text-rose-400/70" />
                <span className="font-mono text-sm text-rose-400">{cash(money(g.rows))}</span>
              </span>
            </button>

            <div className="divide-y divide-slate-800 border-t border-slate-800">
              {(open ? g.rows : g.rows.slice(0, 3)).map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                  <div className="min-w-[150px] flex-1">
                    <div className={`text-sm ${W}`}>{r.customer || "—"}</div>
                    {r.note && <div className={`truncate text-xs ${F}`}>{r.note}</div>}
                  </div>
                  <span className={`w-20 text-right font-mono text-sm text-rose-400`}>−{cash(r.amount).slice(1)}</span>
                  <span className={`w-44 shrink-0 truncate text-xs ${M}`}>{r.reason || "No reason given"}</span>
                  <span className={`w-24 shrink-0 text-xs ${F}`}>{r.source === "stripe" ? "from Stripe" : r.by || "recorded"}</span>
                  <span className={`w-28 shrink-0 text-right text-xs ${F}`}>{new Date(r.at).toLocaleDateString()}</span>
                  {r.source === "stripe"
                    ? <button onClick={() => setAdding({ ...r, editing: true })} className={`rounded-md px-2 py-1 text-xs ${M} hover:bg-slate-800`}>
                        {r.reason ? "Edit" : "Add reason"}
                      </button>
                    : <Confirm label="Delete this record" onConfirm={() => onRemove(r.id)} />}
                </div>
              ))}
              {!open && g.rows.length > 3 && (
                <button onClick={() => setOpenGroup(g.id)} className={`w-full px-4 py-2 text-left text-xs ${F} hover:bg-slate-900`}>
                  Show {g.rows.length - 3} more
                </button>
              )}
            </div>
          </section>
        );
      })}

      {byReason.length > 1 && (
        <div className={`overflow-hidden rounded-xl border ${BD}`}>
          <div className={`border-b ${BD} bg-slate-900 px-4 py-3`}>
            <h3 className={`text-sm font-semibold ${W}`}>Why money went back</h3>
          </div>
          <div className="divide-y divide-slate-800">
            {byReason.map((r) => (
              <div key={r.reason} className="flex items-center gap-3 px-4 py-2.5">
                <span className={`flex-1 text-sm ${M}`}>{r.reason}</span>
                <span className={`font-mono text-xs ${F}`}>{r.n}</span>
                <span className="w-24 text-right font-mono text-sm text-rose-400">{cash(r.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {adding && <RefundForm draft={adding} products={products} orders={orders}
        onCancel={() => setAdding(null)}
        onSave={(r) => {
          if (r.editing) onAnnotate(r, { reason: r.reason, note: r.note });
          else onRecord(r);
          setAdding(null);
        }} />}
    </div>
  );
}

function RefundForm({ draft, products, orders, onCancel, onSave }) {
  const [r, setR] = useState({ reason: REFUND_REASONS[0], ...draft });
  const [dollars, setDollars] = useState(draft.amount != null ? (draft.amount / 100).toFixed(2) : "");
  const cents = Math.round(Number(dollars) * 100);
  const ok = r.productId && Number.isFinite(cents) && cents > 0;

  /* Picking a past order fills the rest in, which is most refunds. */
  const recent = useMemo(() => orders.slice(0, 60), [orders]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onClick={onCancel}>
      <div className={`max-h-[86vh] w-full max-w-lg overflow-y-auto ${CARD} p-5 shadow-2xl`} onClick={(e) => e.stopPropagation()}>
        <h3 className={`text-base font-semibold ${W}`}>{draft.editing ? "Refund details" : "Record a refund"}</h3>
        <p className={`mt-1 text-sm ${M}`}>
          {draft.editing
            ? "Stripe told us about this one. Say why, so the totals mean something."
            : "For a refund you settled outside Stripe. Ones you issue in Stripe appear here on their own."}
        </p>

        <div className="mt-4 space-y-3">
          {!draft.editing && (
            <Field label="Which order?" hint="Optional — picking one fills in the rest.">
              <select className={IN} value={r.orderId || ""}
                onChange={(e) => {
                  const o = recent.find((x) => x.id === e.target.value);
                  setR(o ? { ...r, orderId: o.id, productId: o.productId || "", customer: o.customer, email: o.email, chargeId: o.chargeId }
                         : { ...r, orderId: "" });
                  if (o?.amount != null) setDollars((o.amount / 100).toFixed(2));
                }}>
                <option value="">Not tied to one</option>
                {recent.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.customer} — {o.productName} — {cash(o.amount)} — {new Date(o.receivedAt).toLocaleDateString()}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Product">
              <select className={IN} value={r.productId || ""} onChange={(e) => setR({ ...r, productId: e.target.value })}>
                <option value="">Choose one…</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Amount refunded" hint="In dollars, e.g. 35.00">
              <input className={IN} inputMode="decimal" value={dollars} placeholder="35.00"
                onChange={(e) => setDollars(e.target.value.replace(/[^0-9.]/g, ""))}
                disabled={!!draft.editing} />
            </Field>
          </div>

          <Field label="Reason">
            <select className={IN} value={r.reason || ""} onChange={(e) => setR({ ...r, reason: e.target.value })}>
              {REFUND_REASONS.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </Field>

          {!draft.editing && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Customer"><input className={IN} value={r.customer || ""} onChange={(e) => setR({ ...r, customer: e.target.value })} /></Field>
              <Field label="Who issued it"><input className={IN} value={r.by || ""} placeholder="Your name" onChange={(e) => setR({ ...r, by: e.target.value })} /></Field>
            </div>
          )}

          <Field label="Note" hint="Anything worth remembering next time this comes up.">
            <textarea rows={3} className={IN} value={r.note || ""} onChange={(e) => setR({ ...r, note: e.target.value })} />
          </Field>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} className={`rounded-md px-3 py-2 text-sm ${M}`}>Cancel</button>
          <button disabled={!draft.editing && !ok}
            title={draft.editing || ok ? "" : "Pick a product and an amount above"}
            onClick={() => onSave({ ...r, amount: draft.editing ? r.amount : cents })}
            className={`${PRI} disabled:opacity-40`}>Save</button>
        </div>
      </div>
    </div>
  );
}
