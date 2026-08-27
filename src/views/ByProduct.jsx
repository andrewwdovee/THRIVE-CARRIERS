import React, { useState, useMemo } from "react";
import { ChevronDown, ChevronRight, Package, AlertTriangle } from "lucide-react";
import { BD, CARD, M, F, W, c, ST, cash, L, HOUR } from "../lib/shared";

/* The board, cut by product instead of by status.

   The lane view answers "what's the team working on"; this one answers "how
   is each thing we sell actually doing" — which product is backing up, which
   one is blowing its turnaround, where the money is. Each product keeps its
   own set of lanes, so a card can still be dragged between them. */

export default function ByProduct({ products, orders, now, onOpen, onMove, Card }) {
  const [shut, setShut] = useState(() => new Set());
  const toggle = (id) => setShut((s) => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const groups = useMemo(() => {
    const rows = products.map((p) => ({
      id: p.id, name: p.name, color: p.color, kind: p.kind, sla: p.slaHours,
      ids: (p.stripeIds || []).length,
      orders: orders.filter((o) => o.productId === p.id),
    }));
    const loose = orders.filter((o) => !o.productId);
    if (loose.length) rows.push({ id: "_none", name: "Needs triage", color: "slate",
      kind: "unmatched", sla: null, ids: 0, orders: loose });
    return rows;
  }, [products, orders]);

  if (!products.length) return (
    <div className={`${CARD} px-6 py-10 text-center`}>
      <Package className={`mx-auto h-8 w-8 ${F}`} />
      <h2 className={`mt-3 text-base font-semibold ${W}`}>No products yet</h2>
      <p className={`mx-auto mt-2 max-w-sm text-sm ${M}`}>Add what you sell under Products, and orders will sort themselves into these groups.</p>
    </div>
  );

  return (
    <div className="space-y-3">
      {groups.map((g) => {
        const open = g.orders.filter((o) => o.status !== "done");
        const overdue = open.filter((o) => o.dueAt && o.dueAt < now).length;
        const money = g.orders.reduce((s, o) => s + (o.amount || 0), 0);
        const closed = shut.has(g.id);
        const tgt = g.sla ? g.sla * HOUR : null;

        return (
          <section key={g.id} className={`overflow-hidden rounded-xl border-l-4 ${c(g.color)[2]} border-y border-r ${BD} bg-slate-900/40`}>
            <button onClick={() => toggle(g.id)} className="flex w-full flex-wrap items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-900">
              {closed ? <ChevronRight className={`h-4 w-4 shrink-0 ${F}`} /> : <ChevronDown className={`h-4 w-4 shrink-0 ${F}`} />}
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${c(g.color)[0]}`} />
              <span className={`font-semibold ${W}`}>{g.name}</span>
              {g.id !== "_none" && <>
                <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${c(g.color)[1]}`}>{g.kind}</span>
                {g.sla && <span className={`text-xs ${F}`}>{g.sla}h target</span>}
                <span className={`text-xs ${F}`}>{g.ids} Stripe ID{g.ids === 1 ? "" : "s"}</span>
              </>}
              {g.id === "_none" && <span className={`text-xs ${F}`}>no Stripe ID matched — map these under Products</span>}

              <span className="ml-auto flex items-center gap-3 text-xs">
                {overdue > 0 && <span className="inline-flex items-center gap-1 text-rose-400">
                  <AlertTriangle className="h-3 w-3" />{overdue} past due
                </span>}
                <span className={M}>{open.length} open</span>
                <span className={`font-mono ${F}`}>{g.orders.length} total</span>
                <span className={`font-mono ${M}`}>{money ? cash(money) : "—"}</span>
              </span>
            </button>

            {!closed && (
              <div className="grid gap-2 border-t border-slate-800 p-2 lg:grid-cols-4">
                {ST.map(([id, label]) => {
                  const rows = g.orders.filter((o) => (o.status || "new") === id)
                    .sort((x, y) => (x.dueAt || 0) - (y.dueAt || 0));
                  return (
                    <div key={id}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => { e.preventDefault(); const oid = e.dataTransfer.getData("text/plain"); if (oid) onMove(oid, id); }}
                      className="rounded-lg bg-slate-950/40 p-1.5">
                      <div className="flex items-center justify-between px-1 py-1">
                        <L>{label}</L><span className={`font-mono text-xs ${F}`}>{rows.length}</span>
                      </div>
                      <div className="space-y-2">
                        {!rows.length && <p className={`px-1 py-3 text-center text-xs ${F}`}>—</p>}
                        {rows.map((o) => <Card key={o.id} o={o} products={products} now={now} onOpen={onOpen} hideProduct />)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
