import React, { useState, useMemo } from "react";
import { Plus, X, Undo2, TrendingDown, UserPlus } from "lucide-react";
import {
  BD, CARD, IN, BTN, PRI, M, F, W, c, cash, uid, L, Field, Confirm,
  custName, findCustomers, SCROLL,
} from "../lib/shared";
import { CheckCircle2, Circle } from "lucide-react";
import { CustomerForm } from "./admin";

/* Type a name, get the people you've saved. Nothing is forced: what's typed
   is what gets recorded, so an unsaved name still works — picking from the
   list only saves the typing and keeps the spelling consistent, which is what
   makes "who are we refunding most" answerable later. */
function CustomerPick({ value, customers, onPick, onAddNew }) {
  const [open, setOpen] = useState(false);
  const hits = useMemo(() => findCustomers(customers, value).slice(0, 6), [customers, value]);
  const exact = (customers || []).some((c) => custName(c).toLowerCase() === String(value || "").trim().toLowerCase());

  return (
    <div className="relative">
      <input className={IN} value={value || ""} autoComplete="off"
        placeholder={customers?.length ? "Start typing a name…" : "Customer name"}
        onChange={(e) => { onPick(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        /* A click on a suggestion has to land before the list closes. */
        onBlur={() => setTimeout(() => setOpen(false), 150)} />

      {open && (
        <div className={`absolute z-20 mt-1 w-full overflow-hidden rounded-lg border ${BD} bg-white shadow-lg dark:bg-slate-900`}>
          {hits.map((cst) => (
            <button key={cst.id} type="button"
              onMouseDown={(e) => { e.preventDefault(); onPick(custName(cst)); setOpen(false); }}
              className="flex w-full items-baseline gap-2 px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800">
              <span className={`truncate text-sm ${W}`}>{custName(cst)}</span>
              {cst.email && <span className={`truncate text-xs ${F}`}>{cst.email}</span>}
            </button>
          ))}
          {!hits.length && (
            <p className={`px-3 py-2 text-sm ${M}`}>
              {customers?.length ? "Nobody saved by that name." : "No customers saved yet."}
            </p>
          )}
          {!exact && (
            <button type="button" onMouseDown={(e) => { e.preventDefault(); setOpen(false); onAddNew(); }}
              className={`flex w-full items-center gap-2 border-t px-3 py-2 text-left text-sm ${BD} text-blue-700 hover:bg-slate-100 dark:text-blue-300 dark:hover:bg-slate-800`}>
              <UserPlus className="h-3.5 w-3.5" /> Add new customer
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* Money that went back out.

   Two kinds end up here. A charge Stripe tells us was refunded shows up on its
   own; anything settled outside Stripe — a call credited back, a partial —
   gets recorded by hand. Both are grouped by product, because the question
   worth answering is which thing you sell is costing you the most in refunds,
   not which customer asked. */

const money = (rows) => rows.reduce((s, r) => s + (r.amount || 0), 0);

export default function Refunds({ refunds, products, orders, refundTypes, customers, onRecord, onRemove, onAnnotate, onUpdate, onSetUp, onAddCustomer }) {
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
  const types = refundTypes || [];
  const typeOf = (r) => types.find((t) => t.id === r.typeId);
  const byReason = useMemo(() => {
    const m = new Map();
    refunds.forEach((r) => {
      const k = types.find((t) => t.id === r.typeId)?.name || r.reason || "Not categorised";
      m.set(k, { reason: k, n: (m.get(k)?.n || 0) + 1, amount: (m.get(k)?.amount || 0) + (r.amount || 0) });
    });
    return [...m.values()].sort((a, b) => b.amount - a.amount);
  }, [refunds, types]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid flex-1 gap-3 sm:grid-cols-3">
          <div className={`${CARD} p-4`}>
            <L>Refunded</L>
            <div className={`mt-2 font-mono text-2xl font-bold tabular-nums ${total ? "text-rose-600 dark:text-rose-400" : W}`}>{cash(total)}</div>
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
          <section key={g.id} className={`overflow-hidden rounded-xl border-l-4 ${c(g.color)[2]} border-y border-r ${BD} bg-slate-50 dark:bg-slate-900/40`}>
            <button onClick={() => setOpenGroup(open ? null : g.id)}
              className="flex w-full flex-wrap items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-900">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${c(g.color)[0]}`} />
              <span className={`font-semibold ${W}`}>{g.name}</span>
              <span className={`text-xs ${F}`}>{g.rows.length} refund{g.rows.length === 1 ? "" : "s"}</span>
              <span className="ml-auto flex items-center gap-3">
                <TrendingDown className="h-3.5 w-3.5 text-rose-400/70" />
                <span className="font-mono text-sm text-rose-600 dark:text-rose-400">{cash(money(g.rows))}</span>
              </span>
            </button>

            <div className={`divide-y divide-slate-200 dark:divide-slate-800 border-t border-slate-200 dark:border-slate-800 ${SCROLL}`}>
              {(open ? g.rows : g.rows.slice(0, 3)).map((r) => (
                <RefundRow key={r.id} r={r} type={typeOf(r)} onOpen={() => setAdding({ ...r, editing: true })} onRemove={onRemove} />
              ))}
              {!open && g.rows.length > 3 && (
                <button onClick={() => setOpenGroup(g.id)} className={`w-full px-4 py-2 text-left text-xs ${F} hover:bg-slate-50 dark:hover:bg-slate-900`}>
                  Show {g.rows.length - 3} more
                </button>
              )}
            </div>
          </section>
        );
      })}

      {byReason.length > 1 && (
        <div className={`overflow-hidden rounded-xl border ${BD}`}>
          <div className={`border-b ${BD} bg-white dark:bg-slate-900 px-4 py-3`}>
            <h3 className={`text-sm font-semibold ${W}`}>Why money went back</h3>
          </div>
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {byReason.map((r) => (
              <div key={r.reason} className="flex items-center gap-3 px-4 py-2.5">
                <span className={`flex-1 text-sm ${M}`}>{r.reason}</span>
                <span className={`font-mono text-xs ${F}`}>{r.n}</span>
                <span className="w-24 text-right font-mono text-sm text-rose-600 dark:text-rose-400">{cash(r.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {adding && <RefundForm draft={adding} products={products} orders={orders} types={types} onSetUp={onSetUp}
        customers={customers} onAddCustomer={onAddCustomer}
        onCancel={() => setAdding(null)}
        onSave={(r) => {
          if (!r.editing) onRecord(r);
          else if (r.source === "stripe") onAnnotate(r, { typeId: r.typeId, note: r.note, steps: r.steps });
          else onUpdate(r);
          setAdding(null);
        }} />}
    </div>
  );
}

function RefundRow({ r, type, onOpen, onRemove }) {
  const list = (type?.steps || []).filter(Boolean);
  const did = list.filter((_, i) => r.steps?.[i]).length;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-slate-100 dark:hover:bg-slate-900/60">
      <button onClick={onOpen} className="min-w-[150px] flex-1 text-left">
        <div className={`text-sm ${W}`}>{r.customer || "—"}</div>
        {r.note && <div className={`truncate text-xs ${F}`}>{r.note}</div>}
      </button>
      <span className="w-20 text-right font-mono text-sm text-rose-600 dark:text-rose-400">−{cash(r.amount).slice(1)}</span>
      <button onClick={onOpen} className={`w-44 shrink-0 truncate text-left text-xs ${type ? M : "text-amber-300/80"}`}>
        {type?.name || "Not categorised — set one"}
      </button>
      <span className={`w-14 shrink-0 text-right font-mono text-xs ${!list.length ? F : did === list.length ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
        {list.length ? `${did}/${list.length}` : "—"}
      </span>
      <span className={`w-24 shrink-0 text-xs ${F}`}>{r.source === "stripe" ? "from Stripe" : r.by || "recorded"}</span>
      <span className={`w-28 shrink-0 text-right text-xs ${F}`}>{new Date(r.at).toLocaleDateString()}</span>
      {r.source === "stripe"
        ? <button onClick={onOpen} className={`rounded-md px-2 py-1 text-xs ${M} hover:bg-slate-200 dark:hover:bg-slate-800`}>Open</button>
        : <Confirm label="Delete this record" onConfirm={() => onRemove(r.id)} />}
    </div>
  );
}

/* One picker, used for both. Sorted by name rather than by when it was added,
   because a list you scan is a list you sort — a product added five minutes
   ago should not be hiding at the bottom. */
function Picker({ label, hint, value, rows, onChange, onSetUp, addLabel }) {
  const sorted = useMemo(() => [...rows].sort((a, b) => (a.name || "").localeCompare(b.name || "")), [rows]);
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <L>{label}</L>
        <span className={`text-[10px] ${F}`}>{sorted.length} to choose from</span>
      </div>
      <select className={IN} value={value || ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose one…</option>
        {sorted.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
      <p className={`mt-1 text-xs ${F}`}>
        {hint}{" "}
        {onSetUp && <button type="button" onClick={onSetUp} className="text-blue-600 dark:text-blue-400 hover:underline">{addLabel}</button>}
      </p>
    </div>
  );
}

function RefundForm({ draft, products, orders, types, customers, onCancel, onSave, onSetUp, onAddCustomer }) {
  const [r, setR] = useState({ typeId: types[0]?.id || "", ...draft });
  /* Adding someone mid-refund must not lose the half-filled form behind it. */
  const [newCust, setNewCust] = useState(null);
  const [dollars, setDollars] = useState(draft.amount != null ? (draft.amount / 100).toFixed(2) : "");
  const cents = Math.round(Number(dollars) * 100);
  const ok = r.productId && r.typeId && Number.isFinite(cents) && cents > 0;
  const type = types.find((t) => t.id === r.typeId);
  const stepList = (type?.steps || []).filter(Boolean);

  /* Picking a past order fills the rest in, which is most refunds. */
  const recent = useMemo(() => orders.slice(0, 60), [orders]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 dark:bg-black/75 p-4" onClick={onCancel}>
      <div className={`max-h-[86vh] w-full max-w-lg overflow-y-auto ${CARD} p-5 shadow-2xl`} onClick={(e) => e.stopPropagation()}>
        <h3 className={`text-base font-semibold ${W}`}>{draft.editing ? "Refund" : "Record a refund"}</h3>
        <p className={`mt-1 text-sm ${M}`}>
          {draft.editing
            ? "Say what kind it is, and work the steps for it."
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

          <Picker label="Which product was refunded?" hint="Not listed?" addLabel="Add a product"
            value={r.productId} rows={products} onSetUp={onSetUp}
            onChange={(v) => setR({ ...r, productId: v })} />

          <Picker label="What kind of refund is it?" hint="Not listed?" addLabel="Add a refund type"
            value={r.typeId} rows={types} onSetUp={onSetUp}
            onChange={(v) => setR({ ...r, typeId: v, steps: {} })} />

          <Field label="Amount refunded" hint="In dollars, e.g. 35.00">
            <input className={IN} inputMode="decimal" value={dollars} placeholder="35.00"
              onChange={(e) => setDollars(e.target.value.replace(/[^0-9.]/g, ""))}
              disabled={!!draft.editing} />
          </Field>

          {!!stepList.length && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <L>Refund steps</L>
                <span className={`font-mono text-xs ${F}`}>
                  {stepList.filter((_, i) => r.steps?.[i]).length}/{stepList.length}
                </span>
              </div>
              <ul className="space-y-1">
                {stepList.map((st, i) => {
                  const on = !!r.steps?.[i];
                  return (
                    <li key={i}>
                      <button onClick={() => setR({ ...r, steps: { ...r.steps, [i]: !on } })}
                        className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-200 dark:hover:bg-slate-800 ${on ? F : "text-slate-700 dark:text-slate-300"}`}>
                        {on ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" /> : <Circle className={`mt-0.5 h-4 w-4 shrink-0 ${F}`} />}
                        <span className={on ? "line-through" : ""}>{st}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {!draft.editing && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Customer" hint={customers?.length ? "Pick a saved name, or type a new one." : undefined}>
                <CustomerPick value={r.customer} customers={customers}
                  onPick={(v) => setR({ ...r, customer: v })} onAddNew={() => setNewCust({ first: r.customer || "" })} />
              </Field>
              <Field label="Who issued it"><input className={IN} value={r.by || ""} placeholder="Your name" onChange={(e) => setR({ ...r, by: e.target.value })} /></Field>
            </div>
          )}

          <Field label="Note" hint="Anything worth remembering next time this comes up.">
            <textarea rows={3} className={IN} value={r.note || ""} onChange={(e) => setR({ ...r, note: e.target.value })} />
          </Field>
        </div>

        {newCust && <CustomerForm draft={newCust} customers={customers}
          onCancel={() => setNewCust(null)}
          onSave={(cst) => { onAddCustomer(cst); setR({ ...r, customer: custName(cst) }); setNewCust(null); }} />}

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
