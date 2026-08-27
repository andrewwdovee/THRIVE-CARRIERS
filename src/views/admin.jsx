import React, { useState, useEffect, useMemo } from "react";
import {
  Plus, RefreshCw, Download, X, Package, User, Bell, Link2,
  ArrowUpDown, FlaskConical, Settings as GearIcon, AlarmClock,
} from "lucide-react";
import {
  BD, CARD, PANEL, IN, BTN, PRI, M, F, W, TD, P, c, sm, DEF, DAY,
  uid, paidOk, brief, dk, dl, sod, cash, L, Field, Confirm, grab, grabTrouble, dump,
} from "../lib/shared";
import { buildSamples } from "../lib/samples";

/* The owner's screens: what sold, what you sell, and how it's all wired up. */

/* ═════ REPORTS ═════ */
const RANGES = [["today", "Today"], ["7", "Last 7 days"], ["30", "Last 30 days"], ["90", "Last 90 days"], ["all", "All time"], ["custom", "Custom"]];

export function Reports({ orders, products, n, flash, refunds, refundTypes }) {
  const save = async (kind) => { const bad = grabTrouble(await dump(scoped, kind)); if (bad) flash(bad); };
  const [range, setRange] = useState("30"), [a, setA] = useState(dk(n - 14 * DAY)), [b, setB] = useState(dk(n));
  const [ds, setDs] = useState({ k: "day", d: "desc" }), [ps, setPs] = useState({ k: "count", d: "desc" });

  /* Every range except a custom one runs up to the present, so the upper bound
     is open. Pinning it to `n` — which only ticks every thirty seconds — would
     drop anything recorded since the last tick straight out of the report. */
  const [from, to] = useMemo(() => {
    if (range === "today") return [sod(n), Infinity];
    if (range === "all") return [0, Infinity];
    if (range === "custom") { const f = Date.parse(a + "T00:00:00"), t = Date.parse(b + "T23:59:59"); return [isNaN(f) ? 0 : f, isNaN(t) ? Infinity : t]; }
    return [n - Number(range) * DAY, Infinity];
  }, [range, a, b, n]);

  const scoped = useMemo(() => orders.filter((o) => o.receivedAt >= from && o.receivedAt <= to), [orders, from, to]);
  const paid = scoped.filter(paidOk), done = paid.filter((o) => o.status === "done" && o.completedAt);

  const daily = useMemo(() => {
    const m = new Map();
    const t = (k) => { if (!m.has(k)) m.set(k, { day: k, placed: 0, delivered: 0, revenue: 0, sum: 0, ct: 0, late: 0, dec: 0 }); return m.get(k); };
    scoped.forEach((o) => { const r = t(dk(o.receivedAt)); if (!paidOk(o)) { r.dec++; return; } r.placed++; r.revenue += o.amount || 0; });
    done.forEach((o) => { const r = t(dk(o.completedAt)); r.delivered++; r.sum += o.completedAt - o.receivedAt; r.ct++; if (o.completedAt > o.dueAt) r.late++; });
    const rows = [...m.values()].map((r) => ({ ...r, avg: r.ct ? r.sum / r.ct : null }));
    const d = ds.d === "asc" ? 1 : -1;
    return rows.sort((x, y) => { const i = x[ds.k] ?? -1, j = y[ds.k] ?? -1; return i > j ? d : i < j ? -d : 0; });
  }, [scoped, done, ds]);

  const chart = useMemo(() => [...daily].sort((x, y) => (x.day < y.day ? -1 : 1)).slice(-45), [daily]);
  const peak = Math.max(1, ...chart.map((d) => d.placed));

  const prod = useMemo(() => {
    const rows = products.map((p) => {
      const all = paid.filter((o) => o.productId === p.id), fin = all.filter((o) => o.status === "done" && o.completedAt);
      const ok = fin.filter((o) => o.completedAt <= o.dueAt).length;
      return { id: p.id, name: p.name, color: p.color, sla: p.slaHours, count: all.length,
        open: all.filter((o) => o.status !== "done").length,
        avg: fin.length ? fin.reduce((s, o) => s + (o.completedAt - o.receivedAt), 0) / fin.length : null,
        pct: fin.length ? Math.round((ok / fin.length) * 100) : null, revenue: all.reduce((s, o) => s + (o.amount || 0), 0) };
    });
    const none = paid.filter((o) => !o.productId);
    if (none.length) rows.push({ id: "_n", name: "Needs triage", color: "slate", count: none.length,
      open: none.filter((o) => o.status !== "done").length, avg: null, pct: null, revenue: none.reduce((s, o) => s + (o.amount || 0), 0) });
    const d = ps.d === "asc" ? 1 : -1;
    return rows.sort((x, y) => { const i = x[ps.k] ?? -1, j = y[ps.k] ?? -1; return typeof i === "string" ? i.localeCompare(j) * d : i > j ? d : i < j ? -d : 0; });
  }, [paid, products, ps]);

  const top = [...prod].sort((x, y) => y.count - x.count)[0], maxC = Math.max(1, ...prod.map((r) => r.count));

  const people = useMemo(() => {
    const m = new Map();
    done.forEach((o) => {
      const k = o.assignee || "Unassigned";
      if (!m.has(k)) m.set(k, { name: k, count: 0, time: 0, late: 0 });
      const e = m.get(k); e.count++; e.time += o.completedAt - o.receivedAt; if (o.completedAt > o.dueAt) e.late++;
    });
    return [...m.values()].sort((x, y) => y.count - x.count);
  }, [done]);

  const avgAll = done.length ? done.reduce((s, o) => s + (o.completedAt - o.receivedAt), 0) / done.length : null;
  const pctAll = done.length ? Math.round((done.filter((o) => o.completedAt <= o.dueAt).length / done.length) * 100) : null;
  const tone = (p) => (p == null ? W : p >= 90 ? "text-emerald-400" : p >= 70 ? "text-amber-400" : "text-rose-400");

  const Th = ({ label, k, s, set }) => <th className="px-4 py-2">
    <button onClick={() => set({ k, d: s.k === k && s.d === "desc" ? "asc" : "desc" })}
      className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${s.k === k ? "text-blue-400" : F}`}>{label}<ArrowUpDown className="h-3 w-3" /></button>
  </th>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className={`flex flex-wrap gap-1 rounded-lg border ${BD} bg-slate-900 p-1`}>
          {RANGES.map(([id, label]) => <button key={id} onClick={() => setRange(id)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${range === id ? "bg-blue-600 text-white" : `${M} hover:bg-slate-800`}`}>{label}</button>)}
        </div>
        {range === "custom" && <div className={`flex items-center gap-2 rounded-lg border ${BD} bg-slate-900 px-3 py-1.5`}>
          <div className="w-40"><input type="date" value={a} onChange={(e) => setA(e.target.value)} className={IN} /></div>
          <span className={`text-sm ${F}`}>to</span>
          <div className="w-40"><input type="date" value={b} onChange={(e) => setB(e.target.value)} className={IN} /></div>
        </div>}
        <div className="ml-auto flex gap-2">
          <button onClick={() => save("csv")} className={`inline-flex items-center gap-1.5 ${BTN}`}><Download className="h-4 w-4" /> Orders CSV</button>
          <button onClick={() => save("json")} className={`inline-flex items-center gap-1.5 ${BTN}`}><Download className="h-4 w-4" /> JSON</button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Metric t="Orders placed" v={paid.length} /><Metric t="Delivered" v={done.length} />
        <Metric t="Avg time to fulfill" v={avgAll ? brief(avgAll) : "—"} />
        <Metric t="Hit the target" v={pctAll == null ? "—" : `${pctAll}%`} k={tone(pctAll)} />
        <Metric t="Most ordered" v={top?.count ? top.name : "—"} small />
      </div>

      <div className={`${CARD} p-4`}>
        <h3 className={`text-sm font-semibold ${W}`}>Orders placed per day</h3>
        <div className="mt-4 flex h-32 items-end gap-1">
          {!chart.length && <p className={`text-sm ${M}`}>No orders in this window.</p>}
          {chart.map((d) => <div key={d.day} className="group flex flex-1 flex-col justify-end" title={`${dl(d.day)} — ${d.placed} placed, ${d.delivered} delivered`}>
            <div className="w-full rounded-t bg-blue-500 group-hover:bg-blue-400" style={{ height: `${(d.placed / peak) * 100}px` }} />
            <div className="w-full bg-emerald-500" style={{ height: `${(d.delivered / peak) * 28}px` }} />
          </div>)}
        </div>
        <div className={`mt-2 flex items-center gap-4 text-xs ${M}`}>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-blue-500" /> placed</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-emerald-500" /> delivered</span>
          {chart.length > 0 && <span className="ml-auto">{dl(chart[0].day)} → {dl(chart[chart.length - 1].day)}</span>}
        </div>
      </div>

      <div className={`overflow-hidden rounded-xl border ${BD}`}>
        <div className={`flex items-center justify-between border-b ${BD} bg-slate-900 px-4 py-3`}>
          <h3 className={`text-sm font-semibold ${W}`}>Day by day</h3><span className={`text-xs ${F}`}>Click a column to sort</span>
        </div>
        <div className="max-h-[26rem] overflow-auto"><table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-slate-900"><tr className={`border-b text-left ${BD}`}>
            <Th label="Date" k="day" s={ds} set={setDs} /><Th label="Placed" k="placed" s={ds} set={setDs} />
            <Th label="Delivered" k="delivered" s={ds} set={setDs} /><Th label="Avg fulfillment" k="avg" s={ds} set={setDs} />
            <Th label="Late" k="late" s={ds} set={setDs} /><Th label="Declined" k="dec" s={ds} set={setDs} />
            <Th label="Order value" k="revenue" s={ds} set={setDs} />
          </tr></thead>
          <tbody>
            {!daily.length && <tr><td colSpan={7} className={`px-4 py-6 text-sm ${M}`}>Nothing in this window yet.</td></tr>}
            {daily.map((d) => <tr key={d.day} className={`border-b last:border-0 ${BD}`}>
              <td className={`px-4 py-2.5 ${W}`}>{dl(d.day)}</td>
              <td className={`${TD} text-slate-300`}>{d.placed}</td><td className={`${TD} text-slate-300`}>{d.delivered}</td>
              <td className={`${TD} ${M}`}>{d.avg ? brief(d.avg) : "—"}</td>
              <td className={`${TD} ${d.late ? "text-rose-400" : M}`}>{d.late || "—"}</td>
              <td className={`${TD} ${d.dec ? "text-rose-400" : M}`}>{d.dec || "—"}</td>
              <td className={`${TD} ${M}`}>{d.revenue ? cash(d.revenue) : "—"}</td>
            </tr>)}
          </tbody>
        </table></div>
      </div>

      <div className={`overflow-hidden rounded-xl border ${BD}`}>
        <div className={`border-b ${BD} bg-slate-900 px-4 py-3`}><h3 className={`text-sm font-semibold ${W}`}>By product</h3></div>
        <div className="max-h-[26rem] overflow-auto"><table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-slate-900"><tr className={`border-b text-left ${BD}`}>
            <Th label="Product" k="name" s={ps} set={setPs} /><Th label="Ordered" k="count" s={ps} set={setPs} />
            <Th label="Open" k="open" s={ps} set={setPs} /><Th label="Avg fulfillment" k="avg" s={ps} set={setPs} />
            <Th label="On target" k="pct" s={ps} set={setPs} /><Th label="Order value" k="revenue" s={ps} set={setPs} />
          </tr></thead>
          <tbody>
            {prod.map((r) => <tr key={r.id} className={`border-b last:border-0 ${BD}`}>
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${c(r.color)[0]}`} /><span className={W}>{r.name}</span>
                  {r.sla && <span className={`text-xs ${F}`}>target {r.sla}h</span>}
                </div>
                <div className="mt-1.5 h-1 w-full max-w-[180px] overflow-hidden rounded-full bg-slate-800">
                  <div className={`h-full ${c(r.color)[0]}`} style={{ width: `${(r.count / maxC) * 100}%` }} />
                </div>
              </td>
              <td className={`${TD} text-slate-300`}>{r.count}</td><td className={`${TD} ${M}`}>{r.open}</td>
              <td className={`${TD} text-slate-300`}>{r.avg ? brief(r.avg) : "—"}</td>
              <td className={`${TD} ${tone(r.pct)}`}>{r.pct == null ? "—" : `${r.pct}%`}</td>
              <td className={`${TD} ${M}`}>{r.revenue ? cash(r.revenue) : "—"}</td>
            </tr>)}
          </tbody>
        </table></div>
      </div>

      <RefundReport refunds={(refunds || []).filter((r) => r.at >= from && r.at <= to)}
        products={products} types={refundTypes || []} n={n} />

      <div className={`overflow-hidden rounded-xl border ${BD}`}>
        <div className={`border-b ${BD} bg-slate-900 px-4 py-3`}><h3 className={`text-sm font-semibold ${W}`}>Team performance</h3></div>
        {!people.length ? <p className={`px-4 py-6 text-sm ${M}`}>Numbers appear here once orders get marked delivered.</p>
          : <div className="max-h-[26rem] overflow-auto">{people.map((p) => <div key={p.name} className={`flex flex-wrap items-center gap-4 border-b px-4 py-3 last:border-0 ${BD}`}>
            <User className={`h-4 w-4 ${F}`} /><span className={`flex-1 text-sm ${W}`}>{p.name}</span>
            <span className="font-mono text-sm text-slate-300">{p.count} delivered</span>
            <span className={`font-mono text-sm ${M}`}>{brief(p.time / p.count)} avg</span>
            <span className={`font-mono text-sm ${p.late ? "text-rose-400" : "text-emerald-400"}`}>{Math.round(((p.count - p.late) / p.count) * 100)}% on target</span>
          </div>)}</div>}
      </div>
    </div>
  );
}

const Metric = ({ t, v, k, small }) => <div className={`${CARD} p-4`}>
  <L>{t}</L><div className={`mt-2 font-bold tabular-nums ${small ? "text-base leading-tight" : "font-mono text-2xl"} ${k || W}`}>{v}</div>
</div>;

/* How much is going back out, and where from. A refund total on its own says
   little; what's useful is the trend week to week, which agent keeps asking,
   and which of your products keeps causing it. */
function RefundReport({ refunds, products, types, n }) {
  const total = refunds.reduce((s, r) => s + (r.amount || 0), 0);

  /* Weeks starting Monday, most recent last. */
  const weekly = useMemo(() => {
    const key = (t) => {
      const d = new Date(t);
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      return d.getTime();
    };
    const m = new Map();
    refunds.forEach((r) => {
      const k = key(r.at);
      const e = m.get(k) || { at: k, n: 0, amount: 0 };
      e.n++; e.amount += r.amount || 0;
      m.set(k, e);
    });
    return [...m.values()].sort((a, b) => a.at - b.at).slice(-12);
  }, [refunds]);
  const peak = Math.max(1, ...weekly.map((w) => w.amount));

  const rank = (getKey, getLabel) => {
    const m = new Map();
    refunds.forEach((r) => {
      const k = getKey(r);
      if (!k) return;
      const e = m.get(k) || { key: k, label: getLabel(r, k), n: 0, amount: 0 };
      e.n++; e.amount += r.amount || 0;
      m.set(k, e);
    });
    return [...m.values()].sort((a, b) => b.amount - a.amount).slice(0, 8);
  };

  const agents = useMemo(() => rank((r) => (r.customer || "").trim(), (r) => r.customer), [refunds]);
  const byProduct = useMemo(() => rank((r) => r.productId,
    (r, k) => products.find((p) => p.id === k)?.name || "Not linked"), [refunds, products]);
  const byType = useMemo(() => rank((r) => r.typeId || "_none",
    (r, k) => types.find((t) => t.id === k)?.name || "Not categorised"), [refunds, types]);

  const Rank = ({ title, rows, empty }) => (
    <div className={`overflow-hidden rounded-xl border ${BD}`}>
      <div className={`border-b ${BD} bg-slate-900 px-4 py-3`}><h3 className={`text-sm font-semibold ${W}`}>{title}</h3></div>
      {!rows.length && <p className={`px-4 py-6 text-sm ${M}`}>{empty}</p>}
      <div className="max-h-[26rem] divide-y divide-slate-800 overflow-auto">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center gap-3 px-4 py-2.5">
            <span className={`flex-1 truncate text-sm ${W}`}>{r.label}</span>
            <span className={`font-mono text-xs ${F}`}>{r.n}</span>
            <span className="w-24 text-right font-mono text-sm text-rose-400">{cash(r.amount)}</span>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric t="Refunded in this window" v={cash(total)} k={total ? "text-rose-400" : W} />
        <Metric t="Refunds issued" v={refunds.length} />
        <Metric t="Average refund" v={refunds.length ? cash(Math.round(total / refunds.length)) : "—"} />
      </div>

      <div className={`${CARD} p-4`}>
        <h3 className={`text-sm font-semibold ${W}`}>Refunds per week</h3>
        {/* Capped width so one lonely week reads as a bar, not a filled panel. */}
        <div className="mt-4 flex h-24 items-end gap-1.5">
          {!weekly.length && <p className={`text-sm ${M}`}>No refunds in this window.</p>}
          {weekly.map((w) => (
            <div key={w.at} className="group flex max-w-[56px] flex-1 flex-col justify-end"
              title={`Week of ${dl(dk(w.at))} — ${w.n} refund${w.n === 1 ? "" : "s"}, ${cash(w.amount)}`}>
              <div className="w-full rounded-t bg-rose-500/70 group-hover:bg-rose-400"
                style={{ height: `${Math.max(3, (w.amount / peak) * 96)}px` }} />
            </div>
          ))}
        </div>
        {weekly.length > 0 && (
          <div className={`mt-2 flex items-center justify-between text-xs ${F}`}>
            <span>week of {dl(dk(weekly[0].at))}</span>
            <span>{weekly[weekly.length - 1].n} this week · {cash(weekly[weekly.length - 1].amount)}</span>
          </div>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Rank title="Agents refunded most" rows={agents} empty="No refunds in this window." />
        <Rank title="Products refunded most" rows={byProduct} empty="Nothing to show yet." />
        <Rank title="By refund type" rows={byType} empty="Nothing to show yet." />
      </div>
    </div>
  );
}

/* ═════ PRODUCTS ═════ */
export function Products({ products, orders, commit, house, refundTypes, refunds }) {
  const [ed, setEd] = useState(null);
  const [edT, setEdT] = useState(null);
  const types = refundTypes || [];
  const refundCount = (id) => (refunds || []).filter((r) => r.typeId === id).length;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className={`text-sm font-semibold ${W}`}>Products and fulfillment steps</h2>
          <p className={`text-xs ${F}`}>Each product's color follows its orders everywhere.</p>
        </div>
        <button onClick={() => setEd({ id: uid("p"), name: "", kind: "one-time", slaHours: 24, color: "blue", stripeMatch: "", stripeIds: [], steps: [""], cancelSteps: [""] })}
          className={`inline-flex items-center gap-1.5 ${PRI}`}><Plus className="h-4 w-4" /> New product</button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {products.map((p) => (
          <div key={p.id} className={`rounded-xl border-l-4 ${c(p.color)[2]} border-y border-r ${BD} bg-slate-900 p-4`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className={`font-semibold ${W}`}>{p.name}</h3>
                <div className={`mt-1 flex flex-wrap items-center gap-2 text-xs ${M}`}>
                  <span className={`rounded px-1.5 py-0.5 uppercase ${c(p.color)[1]}`}>{p.kind}</span>
                  <span>{p.slaHours}h turnaround</span>
                  {Number(p.slaHours) > Number(house) && <span className="text-amber-300/80">· past due at {house}h</span>}
                  <span>· {orders.filter((o) => o.productId === p.id && o.status !== "done" && paidOk(o)).length} open</span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setEd({ ...p, steps: p.steps?.length ? p.steps : [""], cancelSteps: p.cancelSteps?.length ? p.cancelSteps : [""] })} className={`rounded-md p-1.5 ${F} hover:bg-slate-800 hover:text-white`}><GearIcon className="h-4 w-4" /></button>
                <Confirm label="Delete product" onConfirm={() => commit((s) => ({ ...s, products: s.products.filter((x) => x.id !== p.id) }), "Product deleted")} />
              </div>
            </div>
            <div className={`mt-3 rounded-lg border ${BD} bg-slate-950/60 p-2.5`}>
              <L className="mb-1.5">Matches Stripe on</L>
              {(p.stripeIds || []).length ? (
                <div className="flex flex-wrap gap-1.5">
                  {p.stripeIds.map((id) => (
                    <span key={id} className={`rounded border ${BD} bg-slate-900 px-1.5 py-0.5 font-mono text-[11px] text-slate-300`}>{id}</span>
                  ))}
                </div>
              ) : (
                <button onClick={() => setEd({ ...p, steps: p.steps?.length ? p.steps : [""], cancelSteps: p.cancelSteps?.length ? p.cancelSteps : [""] })}
                  className="text-left text-xs text-amber-300/90 hover:underline">
                  No Stripe ID yet — matching on the name “{p.stripeMatch || p.name}”. Add the price or product ID.
                </button>
              )}
            </div>

            <ul className="mt-3 space-y-1">
              {(p.steps || []).filter(Boolean).map((s, i) => (
                <li key={i} className={`flex items-start gap-2 text-sm ${M}`}><span className={`mt-1.5 h-1 w-1 shrink-0 rounded-full ${c(p.color)[0]}`} />{s}</li>
              ))}
            </ul>
            {(p.cancelSteps || []).filter(Boolean).length
              ? <div className="mt-3">
                  <L className="mb-1">If a payment fails</L>
                  <ul className="space-y-1">
                    {p.cancelSteps.filter(Boolean).map((s, i) => (
                      <li key={i} className={`flex items-start gap-2 text-sm ${M}`}><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-500" />{s}</li>
                    ))}
                  </ul>
                </div>
              : <p className={`mt-3 text-xs text-amber-300/80`}>No shutdown steps — nobody will know what to switch off if a payment fails.</p>}
          </div>
        ))}
      </div>
      <div className={`mt-8 border-t ${BD} pt-6`}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className={`text-sm font-semibold ${W}`}>Refunds and refund steps</h2>
            <p className={`text-xs ${F}`}>The kinds of refund you give out, and what to do when you give one.</p>
          </div>
          <button onClick={() => setEdT({ id: uid("rt"), name: "", color: "cyan", steps: [""] })}
            className={`inline-flex items-center gap-1.5 ${PRI}`}><Plus className="h-4 w-4" /> New refund type</button>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {!types.length && <p className={`text-sm ${M}`}>No refund types yet. Add the things you actually give money back for.</p>}
          {types.map((t) => (
            <div key={t.id} className={`rounded-xl border-l-4 ${c(t.color)[2]} border-y border-r ${BD} bg-slate-900 p-4`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className={`font-semibold ${W}`}>{t.name}</h3>
                  <div className={`mt-1 text-xs ${M}`}>
                    {refundCount(t.id)} issued · {(t.steps || []).filter(Boolean).length} step{(t.steps || []).filter(Boolean).length === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setEdT({ ...t, steps: t.steps?.length ? t.steps : [""] })}
                    className={`rounded-md p-1.5 ${F} hover:bg-slate-800 hover:text-white`}><GearIcon className="h-4 w-4" /></button>
                  <Confirm label="Delete refund type"
                    onConfirm={() => commit((x) => ({ ...x, refundTypes: (x.refundTypes || []).filter((y) => y.id !== t.id) }), "Refund type deleted")} />
                </div>
              </div>
              <ul className="mt-3 space-y-1">
                {(t.steps || []).filter(Boolean).map((st, i) => (
                  <li key={i} className={`flex items-start gap-2 text-sm ${M}`}>
                    <span className={`mt-1.5 h-1 w-1 shrink-0 rounded-full ${c(t.color)[0]}`} />{st}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {edT && <TypeEditor draft={edT} onCancel={() => setEdT(null)} onSave={(t) => {
        commit((x) => {
          const list = x.refundTypes || [];
          return { ...x, refundTypes: list.some((y) => y.id === t.id) ? list.map((y) => (y.id === t.id ? t : y)) : [...list, t] };
        }, "Refund type saved");
        setEdT(null);
      }} />}

      {ed && <Editor draft={ed} onCancel={() => setEd(null)} onSave={(p) => {
        commit((s) => ({ ...s, products: s.products.some((x) => x.id === p.id) ? s.products.map((x) => (x.id === p.id ? p : x)) : [...s.products, p] }), "Product saved");
        setEd(null);
      }} />}
    </div>
  );
}

function Editor({ draft, onCancel, onSave }) {
  const [p, setP] = useState({ stripeIds: [], color: "blue", steps: [""], cancelSteps: [""], ...draft });
  const [v, setV] = useState("");
  const add = () => { if (v.trim()) { setP({ ...p, stripeIds: [...(p.stripeIds || []), v.trim()] }); setV(""); } };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onClick={onCancel}>
      <div className={`max-h-[86vh] w-full max-w-lg overflow-y-auto ${CARD} p-5 shadow-2xl`} onClick={(e) => e.stopPropagation()}>
        <h3 className={`text-base font-semibold ${W}`}>{draft.name ? "Edit product" : "New product"}</h3>
        <div className="mt-4 space-y-3">
          <Field label="Name"><input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} className={IN} /></Field>
          <Field label="Color" hint="Used on every order of this type.">
            <div className="flex flex-wrap gap-2">{Object.keys(P).map((k) => (
              <button key={k} onClick={() => setP({ ...p, color: k })}
                className={`h-7 w-7 rounded-full ${P[k][0]} ${p.color === k ? "ring-2 ring-white ring-offset-2 ring-offset-slate-900" : "opacity-60"}`} />
            ))}</div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <select value={p.kind} onChange={(e) => setP({ ...p, kind: e.target.value })} className={IN}>
                <option value="one-time">One-time</option><option value="subscription">Subscription</option>
              </select>
            </Field>
            <Field label="Turnaround target (hours)">
              <input type="number" value={p.slaHours} onChange={(e) => setP({ ...p, slaHours: Number(e.target.value) || 24 })} className={IN} />
            </Field>
          </div>
          <Field label="Stripe price or product IDs" hint="An exact ID match beats the keyword.">
            <div className="mb-2 flex flex-wrap gap-1.5">{(p.stripeIds || []).map((s) => (
              <span key={s} className={`inline-flex items-center gap-1 rounded border ${BD} bg-slate-950 px-2 py-1 font-mono text-xs text-slate-300`}>{s}
                <button onClick={() => setP({ ...p, stripeIds: p.stripeIds.filter((x) => x !== s) })} className={`${F} hover:text-rose-400`}><X className="h-3 w-3" /></button>
              </span>
            ))}</div>
            <div className="flex gap-2">
              <input value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="price_1Ab… or prod_Xyz…" className={`${IN} font-mono text-xs`} />
              <button onClick={add} className={BTN}>Add</button>
            </div>
          </Field>
          <Field label="Keyword fallback" hint="Checked against the product name on the charge when no ID matches.">
            <input value={p.stripeMatch || ""} onChange={(e) => setP({ ...p, stripeMatch: e.target.value })} placeholder="instagram" className={IN} />
          </Field>
          <StepList label="Fulfillment steps" hint="Ticked off as the order gets delivered."
            items={p.steps} onChange={(steps) => setP({ ...p, steps })} />

          <StepList label="When a payment fails" hint="What has to be switched off so this stops costing you money."
            items={p.cancelSteps} onChange={(cancelSteps) => setP({ ...p, cancelSteps })} />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} className={`rounded-md px-3 py-2 text-sm ${M}`}>Cancel</button>
          <button disabled={!p.name.trim()} title={p.name.trim() ? "" : "Give the product a name first"}
            onClick={() => p.name.trim() && onSave({
              ...p,
              steps: (p.steps || []).filter((s) => s.trim()),
              cancelSteps: (p.cancelSteps || []).filter((s) => s.trim()),
            })}
            className={`${PRI} disabled:opacity-40`}>Save product</button>
        </div>
      </div>
    </div>
  );
}

/* ═════ SETTINGS ═════ */
export function Settings({ cfg, products, orders, saveCfg, commit, sync, onSync, addOrders, flash, live }) {
  const [l, setL] = useState(cfg);
  useEffect(() => setL(cfg), [cfg.syncUrl, cfg.autoSyncMinutes, cfg.archiveAfterDays, cfg.pastDueHours]);
  const set = (p) => setL((x) => ({ ...x, ...p }));
  const T = ({ label, k }) => <button onClick={() => { set({ [k]: !l[k] }); saveCfg({ [k]: !l[k] }); }} className="flex w-full items-center gap-3 text-left">
    <span className={`relative h-5 w-9 shrink-0 rounded-full ${l[k] ? "bg-blue-600" : "bg-slate-700"}`}>
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${l[k] ? "left-[18px]" : "left-0.5"}`} />
    </span><span className="text-sm text-slate-300">{label}</span>
  </button>;

  const samples = () => {
    if (!products.length) { flash("Add a product first"); return; }
    addOrders(buildSamples(products));
    flash("Sample orders loaded");
  };

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <div className={`${CARD} p-4`}>
          <h3 className={`flex items-center gap-2 text-sm font-semibold ${W}`}><Link2 className="h-4 w-4 text-blue-400" /> Stripe connection</h3>
          <div className={`mt-3 rounded-lg border-l-4 border-amber-500 ${PANEL} py-2 pl-3 pr-2 text-sm`}>
            <p className="text-slate-300"><strong>Your secret key doesn't go in this portal.</strong> Anything typed here sits in shared storage the whole team can read, and browsers can't call Stripe with a secret key anyway.</p>
            <p className={`mt-2 ${M}`}>The key goes in the relay you deploy once — code is in <span className="font-mono text-xs">relay/</span> in this repo. Paste its address below, point a Stripe webhook at it, and orders arrive as they're paid for.</p>
          </div>
          <div className="mt-4 grid gap-3">
            <Field label="Sync endpoint URL" hint="e.g. https://stripe-sync.yourname.workers.dev/orders">
              <input value={l.syncUrl} onChange={(e) => set({ syncUrl: e.target.value })} onBlur={() => saveCfg({ syncUrl: l.syncUrl })} placeholder="https://…" className={`${IN} font-mono text-xs`} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Access token" hint="A secret you invent. Not your Stripe key.">
                <input type="password" value={l.syncToken} onChange={(e) => set({ syncToken: e.target.value })} onBlur={() => saveCfg({ syncToken: l.syncToken })} className={`${IN} font-mono text-xs`} />
              </Field>
              <Field label="Check every (minutes)">
                <input type="number" min="1" value={l.autoSyncMinutes} onChange={(e) => set({ autoSyncMinutes: Number(e.target.value) || 5 })} onBlur={() => saveCfg({ autoSyncMinutes: l.autoSyncMinutes })} className={IN} />
              </Field>
            </div>
            {live !== null && (
              <div className={`rounded-lg border-l-4 ${live ? "border-emerald-500" : "border-slate-600"} ${PANEL} py-2 pl-3 pr-2 text-sm`}>
                {live
                  ? <p className="text-slate-300"><strong className="text-emerald-400">Stripe is pushing payments here.</strong> New orders appear within about fifteen seconds of the charge, without anyone pressing anything.</p>
                  : <p className="text-slate-300"><strong>Checking Stripe on a timer.</strong> Orders can take up to the interval above to appear. Add the webhook (see the README) and they arrive as they happen.</p>}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={onSync} disabled={sync.busy} className={`inline-flex items-center gap-1.5 ${PRI} disabled:opacity-50`}>
                <RefreshCw className={`h-4 w-4 ${sync.busy ? "animate-spin" : ""}`} /> Test connection</button>
              {sync.at && !sync.error && <span className="text-sm text-emerald-400">Connected — pulled {sync.added} new.</span>}
              {sync.error && <span className="text-sm text-rose-400">{sync.error}</span>}
            </div>
          </div>
        </div>

        <div className={`${CARD} p-4`}>
          <h3 className={`flex items-center gap-2 text-sm font-semibold ${W}`}><Package className="h-4 w-4 text-blue-400" /> Stripe product mapping</h3>
          <p className={`mt-1 text-sm ${M}`}>Paste the price or product ID from Stripe so orders land in the right lane and pick up the right color.</p>
          <div className="mt-3 space-y-2">{products.map((p) => <Mapper key={p.id} p={p} commit={commit} />)}</div>
        </div>

        <div className={`${CARD} p-4`}>
          <h3 className={`flex items-center gap-2 text-sm font-semibold ${W}`}><Bell className="h-4 w-4 text-blue-400" /> Notifications</h3>
          <p className={`mt-1 text-sm ${M}`}>A desktop alert and chime fire in whichever browser has the dashboard open. For email or text, point this at a Zapier or Make webhook — the dashboard posts the order details and Zapier sends the message.</p>
          <div className="mt-3 grid gap-3">
            <Field label="Webhook URL" hint="Zapier 'Catch Hook', Make custom webhook, or your own endpoint.">
              <input value={l.notifyWebhook} onChange={(e) => set({ notifyWebhook: e.target.value })} onBlur={() => saveCfg({ notifyWebhook: l.notifyWebhook })} placeholder="https://hooks.zapier.com/…" className={`${IN} font-mono text-xs`} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Send to email"><input value={l.notifyEmail} onChange={(e) => set({ notifyEmail: e.target.value })} onBlur={() => saveCfg({ notifyEmail: l.notifyEmail })} placeholder="assistant@yourcompany.com" className={IN} /></Field>
              <Field label="Send to phone"><input value={l.notifyPhone} onChange={(e) => set({ notifyPhone: e.target.value })} onBlur={() => saveCfg({ notifyPhone: l.notifyPhone })} placeholder="+1…" className={IN} /></Field>
            </div>
            <div className="space-y-2">
              <T label="Desktop alert when a new order arrives" k="notifyBrowser" />
              <T label="Chime on new orders" k="notifySound" />
              <T label="Alert again when an order goes past due" k="notifyOverdue" />
            </div>
            <button onClick={async () => {
              if (l.notifyWebhook) try { await fetch(l.notifyWebhook, { method: "POST", mode: "no-cors", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: "Test from Lead Tech Fulfillment", body: "Notifications are wired up.", email: l.notifyEmail, phone: l.notifyPhone }) }); } catch (e) { }
              flash("Test sent");
            }} className={`w-fit ${BTN}`}>Send a test</button>
          </div>
        </div>
      </div>

      <aside className="space-y-4">
        <div className={`${CARD} p-4`}>
          <h3 className={`flex items-center gap-2 text-sm font-semibold ${W}`}><AlarmClock className="h-4 w-4 text-blue-400" /> Past due</h3>
          <div className="mt-3">
            <Field label="Mark an order past due after (hours)"
              hint="Applies to every order. A product promised faster than this goes past due at its own target instead.">
              <input type="number" min="1" value={l.pastDueHours}
                onChange={(e) => set({ pastDueHours: Number(e.target.value) || 12 })}
                onBlur={() => saveCfg({ pastDueHours: Math.max(1, Number(l.pastDueHours) || 12) })} className={IN} />
            </Field>
          </div>
          {(() => {
            const capped = products.filter((p) => Number(p.slaHours) > Number(l.pastDueHours));
            return capped.length ? (
              <p className={`mt-3 text-xs ${F}`}>
                Tighter than the turnaround target on {capped.map((p) => p.name).join(", ")} — {capped.length === 1 ? "it goes" : "they go"} past due at {l.pastDueHours}h.
              </p>
            ) : null;
          })()}
        </div>

        <div className={`${CARD} p-4`}>
          <h3 className={`text-sm font-semibold ${W}`}>Board</h3>
          <div className="mt-3"><Field label="Hide delivered orders from By product after (days)" hint="They stay in Completed orders and Reports for good.">
            <input type="number" min="1" value={l.archiveAfterDays} onChange={(e) => set({ archiveAfterDays: Number(e.target.value) || 14 })} onBlur={() => saveCfg({ archiveAfterDays: l.archiveAfterDays })} className={IN} />
          </Field></div>
        </div>
        <div className={`${CARD} p-4`}>
          <h3 className={`flex items-center gap-2 text-sm font-semibold ${W}`}><FlaskConical className="h-4 w-4 text-blue-400" /> Try it out</h3>
          <p className={`mt-2 text-sm ${M}`}>Load a dozen fake orders to see the board, colors, and reports before Stripe is wired up.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button onClick={samples} className={BTN}>Load sample orders</button>
            {orders.length > 0 && <Confirm label="Clear every order" onConfirm={() => commit((s) => ({ ...s, orders: [] }), "All orders cleared")} />}
          </div>
        </div>
        <div className={`${CARD} p-4`}>
          <h3 className={`text-sm font-semibold ${W}`}>One database, any number of screens</h3>
          <p className={`mt-2 text-sm ${M}`}>Every window reads and writes the same records, so a second screen — or your assistant's laptop — picks up a change within about twenty seconds.</p>
        </div>
      </aside>
    </div>
  );
}

function TypeEditor({ draft, onCancel, onSave }) {
  const [t, setT] = useState({ color: "cyan", steps: [""], ...draft });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onClick={onCancel}>
      <div className={`max-h-[86vh] w-full max-w-lg overflow-y-auto ${CARD} p-5 shadow-2xl`} onClick={(e) => e.stopPropagation()}>
        <h3 className={`text-base font-semibold ${W}`}>{draft.name ? "Edit refund type" : "New refund type"}</h3>
        <div className="mt-4 space-y-3">
          <Field label="What is it?" hint="What you'd call this kind of refund — an individual call, a cancelled membership.">
            <input value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} placeholder="Individual call" className={IN} />
          </Field>
          <Field label="Colour">
            <div className="flex flex-wrap gap-2">{Object.keys(P).map((k) => (
              <button key={k} onClick={() => setT({ ...t, color: k })}
                className={`h-7 w-7 rounded-full ${P[k][0]} ${t.color === k ? "ring-2 ring-white ring-offset-2 ring-offset-slate-900" : "opacity-60"}`} />
            ))}</div>
          </Field>
          <StepList label="Refund steps" hint="What to do when you give this refund. Ticked off on the record."
            items={t.steps} onChange={(steps) => setT({ ...t, steps })} />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} className={`rounded-md px-3 py-2 text-sm ${M}`}>Cancel</button>
          <button disabled={!t.name.trim()} title={t.name.trim() ? "" : "Give it a name first"}
            onClick={() => t.name.trim() && onSave({ ...t, steps: (t.steps || []).filter((x) => x.trim()) })}
            className={`${PRI} disabled:opacity-40`}>Save refund type</button>
        </div>
      </div>
    </div>
  );
}

/* Two lists, same shape: what to do to deliver it, and what to undo when the
   money stops. */
function StepList({ label, hint, items, onChange }) {
  const rows = items || [];
  return (
    <div>
      <L className="mb-1">{label}</L>
      {hint && <p className={`mb-2 text-xs ${F}`}>{hint}</p>}
      {rows.map((s, i) => (
        <div key={i} className="mb-2 flex gap-2">
          <input value={s} onChange={(e) => onChange(rows.map((x, j) => (j === i ? e.target.value : x)))} className={IN} />
          <button onClick={() => onChange(rows.filter((_, j) => j !== i))} className={`rounded-md p-2 ${F} hover:text-rose-400`}><X className="h-4 w-4" /></button>
        </div>
      ))}
      <button onClick={() => onChange([...rows, ""])} className={`text-sm ${M} hover:underline`}>+ Add step</button>
    </div>
  );
}

function Mapper({ p, commit }) {
  const [v, setV] = useState((p.stripeIds || []).join(", "));
  useEffect(() => setV((p.stripeIds || []).join(", ")), [p.id]);
  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-lg border-l-4 ${c(p.color)[2]} border-y border-r ${BD} bg-slate-900/70 p-2.5`}>
      <div className="min-w-[150px] flex-1">
        <div className={`text-sm font-medium ${W}`}>{p.name}</div><div className={`text-xs ${M}`}>{p.slaHours}h target</div>
      </div>
      <input value={v} onChange={(e) => setV(e.target.value)}
        onBlur={() => commit((s) => ({ ...s, products: s.products.map((x) => (x.id === p.id ? { ...x, stripeIds: v.split(",").map((y) => y.trim()).filter(Boolean) } : x)) }), "Mapping saved")}
        placeholder="price_1Ab…, prod_Xyz…" className={`${IN} flex-[2] font-mono text-xs`} />
    </div>
  );
}
