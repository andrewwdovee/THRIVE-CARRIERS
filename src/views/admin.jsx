import React, { useState, useEffect, useMemo } from "react";
import {
  Plus, RefreshCw, Download, X, Package, Bell, Link2, Users, Sun, Moon, Monitor,
  ArrowUpDown, FlaskConical, Settings as GearIcon, AlarmClock, Ban, Eye, Undo2, Wallet, PhoneCall,
} from "lucide-react";
import {
  BD, CARD, PANEL, IN, BTN, PRI, M, F, W, TD, P, c, sm, DEF, DAY,
  uid, paidOk, brief, dk, dl, sod, cash, L, Field, Confirm, grab, grabTrouble, dump, SCROLL, STICKY,
  THEMES, useTheme, custName, findCustomers, walletTotals, walletWeeks, weekLabel, buildStamp,
  BLOCK_FIELDS, BLOCK_OPS, bf, opsFor, blockHits, blockedBy, describeBlock,
} from "../lib/shared";
import { buildSamples } from "../lib/samples";
import WipeLine from "./WipeLine";

/* The owner's screens: what sold, what you sell, and how it's all wired up. */

/* ═════ REPORTS ═════ */
const RANGES = [["today", "Today"], ["7", "Last 7 days"], ["30", "Last 30 days"], ["90", "Last 90 days"], ["all", "All time"], ["custom", "Custom"]];

export function Reports({ orders, products, n, flash, refunds, refundTypes, customers, wipes }) {
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

  const avgAll = done.length ? done.reduce((s, o) => s + (o.completedAt - o.receivedAt), 0) / done.length : null;
  const pctAll = done.length ? Math.round((done.filter((o) => o.completedAt <= o.dueAt).length / done.length) * 100) : null;
  const tone = (p) => (p == null ? W : p >= 90 ? "text-emerald-600 dark:text-emerald-400" : p >= 70 ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400");

  const Th = ({ label, k, s, set }) => <th className="px-4 py-2">
    <button onClick={() => set({ k, d: s.k === k && s.d === "desc" ? "asc" : "desc" })}
      className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${s.k === k ? "text-blue-600 dark:text-blue-400" : F}`}>{label}<ArrowUpDown className="h-3 w-3" /></button>
  </th>;

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-center gap-2">
        <div className={`flex flex-wrap gap-1 rounded-lg border ${BD} bg-white dark:bg-slate-900 p-1`}>
          {RANGES.map(([id, label]) => <button key={id} onClick={() => setRange(id)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${range === id ? "bg-blue-600 text-slate-900 dark:text-white" : `${M} hover:bg-slate-200 dark:hover:bg-slate-800`}`}>{label}</button>)}
        </div>
        {range === "custom" && <div className={`flex items-center gap-2 rounded-lg border ${BD} bg-white dark:bg-slate-900 px-3 py-1.5`}>
          <div className="w-40"><input type="date" value={a} onChange={(e) => setA(e.target.value)} className={IN} /></div>
          <span className={`text-sm ${F}`}>to</span>
          <div className="w-40"><input type="date" value={b} onChange={(e) => setB(e.target.value)} className={IN} /></div>
        </div>}
        <div className="ml-auto flex gap-2">
          <button onClick={() => save("csv")} className={`inline-flex items-center gap-1.5 ${BTN}`}><Download className="h-4 w-4" /> Orders CSV</button>
          <button onClick={() => save("json")} className={`inline-flex items-center gap-1.5 ${BTN}`}><Download className="h-4 w-4" /> JSON</button>
        </div>
      </div>

      <Section icon={Package} title="Orders" note="What sold, and how fast it went out.">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Metric t="Orders placed" v={paid.length} /><Metric t="Delivered" v={done.length} />
        <Metric t="Avg time to fulfill" v={avgAll ? brief(avgAll) : "—"} />
        <Metric t="Hit the target" v={pctAll == null ? "—" : `${pctAll}%`} k={tone(pctAll)} />
        <Metric t="Most ordered" v={top?.count ? top.name : "—"} small />
      </div>

      <div className={`${CARD} p-4`}>
        <h3 className={`text-sm font-semibold ${W}`}>Orders placed per day</h3>
        <WipeLine money={false} empty="No orders in this window."
          points={chart.map((d) => ({ at: Date.parse(d.day + "T12:00:00"), value: d.placed,
            note: `${d.delivered} delivered` }))} />
      </div>

      <div className={`overflow-hidden rounded-xl border ${BD}`}>
        <div className={`flex items-center justify-between border-b ${BD} bg-white dark:bg-slate-900 px-4 py-3`}>
          <h3 className={`text-sm font-semibold ${W}`}>Day by day</h3><span className={`text-xs ${F}`}>Click a column to sort</span>
        </div>
        <div className={SCROLL}><table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-white dark:bg-slate-900"><tr className={`border-b text-left ${BD}`}>
            <Th label="Date" k="day" s={ds} set={setDs} /><Th label="Placed" k="placed" s={ds} set={setDs} />
            <Th label="Delivered" k="delivered" s={ds} set={setDs} /><Th label="Avg fulfillment" k="avg" s={ds} set={setDs} />
            <Th label="Late" k="late" s={ds} set={setDs} /><Th label="Declined" k="dec" s={ds} set={setDs} />
            <Th label="Order value" k="revenue" s={ds} set={setDs} />
          </tr></thead>
          <tbody>
            {!daily.length && <tr><td colSpan={7} className={`px-4 py-6 text-sm ${M}`}>Nothing in this window yet.</td></tr>}
            {daily.map((d) => <tr key={d.day} className={`border-b last:border-0 ${BD}`}>
              <td className={`px-4 py-2.5 ${W}`}>{dl(d.day)}</td>
              <td className={`${TD} text-slate-700 dark:text-slate-300`}>{d.placed}</td><td className={`${TD} text-slate-700 dark:text-slate-300`}>{d.delivered}</td>
              <td className={`${TD} ${M}`}>{d.avg ? brief(d.avg) : "—"}</td>
              <td className={`${TD} ${d.late ? "text-rose-600 dark:text-rose-400" : M}`}>{d.late || "—"}</td>
              <td className={`${TD} ${d.dec ? "text-rose-600 dark:text-rose-400" : M}`}>{d.dec || "—"}</td>
              <td className={`${TD} ${M}`}>{d.revenue ? cash(d.revenue) : "—"}</td>
            </tr>)}
          </tbody>
        </table></div>
      </div>

      <div className={`overflow-hidden rounded-xl border ${BD}`}>
        <div className={`border-b ${BD} bg-white dark:bg-slate-900 px-4 py-3`}><h3 className={`text-sm font-semibold ${W}`}>By product</h3></div>
        <div className={SCROLL}><table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-white dark:bg-slate-900"><tr className={`border-b text-left ${BD}`}>
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
                <div className="mt-1.5 h-1 w-full max-w-[180px] overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  <div className={`h-full ${c(r.color)[0]}`} style={{ width: `${(r.count / maxC) * 100}%` }} />
                </div>
              </td>
              <td className={`${TD} text-slate-700 dark:text-slate-300`}>{r.count}</td><td className={`${TD} ${M}`}>{r.open}</td>
              <td className={`${TD} text-slate-700 dark:text-slate-300`}>{r.avg ? brief(r.avg) : "—"}</td>
              <td className={`${TD} ${tone(r.pct)}`}>{r.pct == null ? "—" : `${r.pct}%`}</td>
              <td className={`${TD} ${M}`}>{r.revenue ? cash(r.revenue) : "—"}</td>
            </tr>)}
          </tbody>
        </table></div>
      </div>
      </Section>

      <Section icon={Undo2} title="Refunds" note="What went back out, and who to.">
        <RefundReport refunds={(refunds || []).filter((r) => r.at >= from && r.at <= to)}
          products={products} types={refundTypes || []} n={n} />
      </Section>

      <Section icon={Wallet} title="Wallets" note="What was wiped each Saturday, and from whom.">
        <WalletReport customers={customers} wipes={wipes} from={from} to={to} />
      </Section>
    </div>
  );
}

/* One question per section. The range picker at the top governs all of them,
   so the headings are what tell you which numbers belong together — without
   them the page is a stack of tables that happen to be adjacent. */
const Section = ({ icon: Icon, title, note, children }) => (
  <section className="space-y-3">
    <div className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b ${BD} pb-2`}>
      <h2 className={`flex items-center gap-2 text-base font-semibold ${W}`}>
        <Icon className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />{title}
      </h2>
      {note && <p className={`text-xs ${F}`}>{note}</p>}
    </div>
    {children}
  </section>
);

const Metric = ({ t, v, k, small }) => <div className={`${CARD} p-4`}>
  <L>{t}</L><div className={`mt-2 font-bold tabular-nums ${small ? "text-base leading-tight" : "font-mono text-2xl"} ${k || W}`}>{v}</div>
</div>;

/* How much is going back out, and where from. A refund total on its own says
   little; what's useful is the trend week to week, which agent keeps asking,
   and which of your products keeps causing it. */
/* Wallets, in the same range as everything else on this page. A wipe is
   money the business keeps, so it belongs beside what was sold rather than
   only on its own tab. */
function WalletReport({ customers, wipes, from, to }) {
  const rows = useMemo(() => (wipes || []).filter((w) => w.at >= from && w.at <= to), [wipes, from, to]);
  const weeks = useMemo(() => walletWeeks(rows), [rows]);
  const people = useMemo(
    () => walletTotals(customers, rows).filter((u) => u.count).sort((a, b) => b.total - a.total),
    [customers, rows],
  );
  const total = rows.reduce((s, w) => s + (w.amount || 0), 0);
  const perWeek = weeks.length ? Math.round(total / weeks.length) : 0;

  /* The same shape as every other section: headline numbers, then the detail
     behind them. */
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric t="Wiped in this window" v={cash(total)} k={total ? "text-emerald-600 dark:text-emerald-400" : W} />
        <Metric t="Weeks recorded" v={weeks.length || "—"} />
        <Metric t="Average a week" v={weeks.length ? cash(perWeek) : "—"} />
      </div>

      <div className={`${CARD} p-4`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className={`text-sm font-semibold ${W}`}>Wallets wiped</h3>
        <span className={`font-mono text-sm ${W}`}>{cash(total)} <span className={F}>over {weeks.length} week{weeks.length === 1 ? "" : "s"}</span></span>
      </div>
      {!rows.length
        ? <p className={`mt-3 text-sm ${M}`}>Nothing wiped in this range.</p>
        : (
          <>
            <p className={`mt-0.5 text-sm ${M}`}>{cash(perWeek)} a week on average, across {people.length} {people.length === 1 ? "person" : "people"}.</p>
            <div className="mt-3 grid gap-4 lg:grid-cols-2">
              <div>
                <L className="mb-2">By week</L>
                <WipeLine empty="Nothing wiped in this range."
                  points={weeks.map((w) => ({ at: w.week, value: w.total,
                    note: `${w.count} ${w.count === 1 ? "person" : "people"}` }))} />
              </div>
              <div>
                <L className="mb-2">Most wiped</L>
                <div className="max-h-64 overflow-auto pr-1">
                  <table className="w-full text-sm">
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {people.slice(0, 20).map((u) => (
                        <tr key={u.id}>
                          <td className={`py-1.5 pr-2 ${W}`}><span className="truncate">{custName(u) || "Unnamed"}</span></td>
                          <td className={`py-1.5 text-right font-mono ${W}`}>{cash(u.total)}</td>
                          <td className={`py-1.5 pl-2 text-right text-xs ${F}`}>{cash(u.average)} avg</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

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
      <div className={`border-b ${BD} bg-white dark:bg-slate-900 px-4 py-3`}><h3 className={`text-sm font-semibold ${W}`}>{title}</h3></div>
      {!rows.length && <p className={`px-4 py-6 text-sm ${M}`}>{empty}</p>}
      <div className={`divide-y divide-slate-200 dark:divide-slate-800 ${SCROLL}`}>
        {rows.map((r) => (
          <div key={r.key} className="flex items-center gap-3 px-4 py-2.5">
            <span className={`flex-1 truncate text-sm ${W}`}>{r.label}</span>
            <span className={`font-mono text-xs ${F}`}>{r.n}</span>
            <span className="w-24 text-right font-mono text-sm text-rose-600 dark:text-rose-400">{cash(r.amount)}</span>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric t="Refunded in this window" v={cash(total)} k={total ? "text-rose-600 dark:text-rose-400" : W} />
        <Metric t="Refunds issued" v={refunds.length} />
        <Metric t="Average refund" v={refunds.length ? cash(Math.round(total / refunds.length)) : "—"} />
      </div>

      <div className={`${CARD} p-4`}>
        <h3 className={`text-sm font-semibold ${W}`}>Refunded per week</h3>
        <WipeLine empty="No refunds in this window."
          points={weekly.map((w) => ({ at: w.at, value: w.amount,
            note: `${w.n} refund${w.n === 1 ? "" : "s"}` }))} />
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
          <h2 className={`text-sm font-semibold ${W}`}>Products</h2>
          <p className={`text-xs ${F}`}>Each product's color follows its orders everywhere.</p>
        </div>
        <button onClick={() => setEd({ id: uid("p"), name: "", kind: "one-time", slaHours: 24, color: "blue", stripeMatch: "", stripeIds: [] })}
          className={`inline-flex items-center gap-1.5 ${PRI}`}><Plus className="h-4 w-4" /> New product</button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {products.map((p) => (
          <div key={p.id} className={`rounded-xl border-l-4 ${c(p.color)[2]} border-y border-r ${BD} bg-white dark:bg-slate-900 p-4`}>
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
                <button onClick={() => setEd({ ...p })} className={`rounded-md p-1.5 ${F} hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white`}><GearIcon className="h-4 w-4" /></button>
                <Confirm label="Delete product" onConfirm={() => commit((s) => ({ ...s, products: s.products.filter((x) => x.id !== p.id) }), "Product deleted")} />
              </div>
            </div>
            <div className={`mt-3 rounded-lg border ${BD} bg-slate-200/60 dark:bg-slate-950/60 p-2.5`}>
              <L className="mb-1.5">Matches Stripe on</L>
              {(p.stripeIds || []).length ? (
                <div className="flex flex-wrap gap-1.5">
                  {p.stripeIds.map((id) => (
                    <span key={id} className={`rounded border ${BD} bg-white dark:bg-slate-900 px-1.5 py-0.5 font-mono text-[11px] text-slate-700 dark:text-slate-300`}>{id}</span>
                  ))}
                </div>
              ) : (
                <button onClick={() => setEd({ ...p })}
                  className="text-left text-xs text-amber-300/90 hover:underline">
                  No Stripe ID yet — matching on the name “{p.stripeMatch || p.name}”. Add the price or product ID.
                </button>
              )}
            </div>

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
            <div key={t.id} className={`rounded-xl border-l-4 ${c(t.color)[2]} border-y border-r ${BD} bg-white dark:bg-slate-900 p-4`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className={`font-semibold ${W}`}>{t.name}</h3>
                  <div className={`mt-1 text-xs ${M}`}>
                    {refundCount(t.id)} issued · {(t.steps || []).filter(Boolean).length} step{(t.steps || []).filter(Boolean).length === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setEdT({ ...t, steps: t.steps?.length ? t.steps : [""] })}
                    className={`rounded-md p-1.5 ${F} hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white`}><GearIcon className="h-4 w-4" /></button>
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
  const [p, setP] = useState({ stripeIds: [], color: "blue", ...draft });
  const [v, setV] = useState("");
  const add = () => { if (v.trim()) { setP({ ...p, stripeIds: [...(p.stripeIds || []), v.trim()] }); setV(""); } };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 dark:bg-black/75 p-4" onClick={onCancel}>
      <div className={`max-h-[86vh] w-full max-w-lg overflow-y-auto ${CARD} p-5 shadow-2xl`} onClick={(e) => e.stopPropagation()}>
        <h3 className={`text-base font-semibold ${W}`}>{draft.name ? "Edit product" : "New product"}</h3>
        <div className="mt-4 space-y-3">
          <Field label="Name"><input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} className={IN} /></Field>
          <Field label="Color" hint="Used on every order of this type.">
            <div className="flex flex-wrap gap-2">{Object.keys(P).map((k) => (
              <button key={k} onClick={() => setP({ ...p, color: k })}
                className={`h-7 w-7 rounded-full ${P[k][0]} ${p.color === k ? "ring-2 ring-slate-900 dark:ring-white ring-offset-2 ring-offset-white dark:ring-offset-slate-900" : "opacity-60"}`} />
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
              <span key={s} className={`inline-flex items-center gap-1 rounded border ${BD} bg-slate-100 dark:bg-slate-950 px-2 py-1 font-mono text-xs text-slate-700 dark:text-slate-300`}>{s}
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
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} className={`rounded-md px-3 py-2 text-sm ${M}`}>Cancel</button>
          <button disabled={!p.name.trim()} title={p.name.trim() ? "" : "Give the product a name first"}
            onClick={() => p.name.trim() && onSave(p)}
            className={`${PRI} disabled:opacity-40`}>Save product</button>
        </div>
      </div>
    </div>
  );
}

/* ═════ SETTINGS ═════ */
/* ── who you deal with ──
   Stripe records who paid. It doesn't record who to credit — a refund goes
   to the agent who complained, who may never have appeared on a payment
   under that name. So the people are kept here, once, and picked by name
   everywhere else. */
export function CustomerBook({ customers, commit, flash }) {
  const [q, setQ] = useState("");
  const [add, setAdd] = useState(null);
  const rows = useMemo(() => findCustomers(customers, q), [customers, q]);

  const remove = (id) =>
    commit((x) => ({ ...x, customers: (x.customers || []).filter((c) => c.id !== id) }), "Customer removed");

  return (
    <div className={`${CARD} p-4`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={`flex items-center gap-2 text-sm font-semibold ${W}`}>
          <Users className="h-4 w-4 text-blue-600 dark:text-blue-400" /> Customers
        </h3>
        <button onClick={() => setAdd({})} className={`${BTN} flex items-center gap-1.5`}>
          <Plus className="h-3.5 w-3.5" /> Add customer
        </button>
      </div>
      <p className={`mt-1 text-sm ${M}`}>
        The people you issue refunds to. Adding them here means typing a name once instead of every time.
      </p>

      {!!customers?.length && (
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email or Stripe ID…"
          className={`${IN} mt-3`} />
      )}

      <div className={`mt-3 overflow-hidden rounded-lg border ${BD}`}>
        {!rows.length && (
          <p className={`px-3 py-6 text-center text-sm ${M}`}>
            {customers?.length ? `Nobody matches "${q}".` : "No customers yet. Add the agents you deal with most."}
          </p>
        )}
        <div className={`divide-y divide-slate-200 dark:divide-slate-800 ${SCROLL}`}>
          {rows.map((cst) => (
            <div key={cst.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className={`truncate text-sm font-medium ${W}`}>{custName(cst) || "Unnamed"}</div>
                <div className={`truncate font-mono text-xs ${F}`}>{cst.stripeId || "no Stripe ID"}{cst.email ? ` · ${cst.email}` : ""}</div>
              </div>
              <div className="shrink-0">
                <Confirm label={`Remove ${custName(cst) || "customer"}`} onConfirm={() => remove(cst.id)} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {add && <CustomerForm draft={add} customers={customers} onCancel={() => setAdd(null)}
        onSave={(cst) => { commit((x) => ({ ...x, customers: [...(x.customers || []), cst] }), "Customer added"); setAdd(null); }} />}
    </div>
  );
}

/* Shared by Settings and the refund form, so "add someone new" asks for the
   same things in both places and can't drift. */
export function CustomerForm({ draft, customers, onCancel, onSave }) {
  const [f, setF] = useState({ first: "", last: "", stripeId: "", email: "", ...draft });
  const name = custName(f);
  /* Two people with one name is a coin toss every time you pick one later. */
  const clash = (customers || []).some((c) => custName(c).toLowerCase() === name.toLowerCase() && c.id !== f.id);
  const dupId = f.stripeId && (customers || []).some((c) => c.stripeId === f.stripeId.trim() && c.id !== f.id);
  const bad = !name ? "A first or last name is needed."
    : dupId ? "That Stripe ID is already on someone else."
      : "";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4 dark:bg-black/75" onClick={onCancel}>
      <div className={`w-full max-w-md ${CARD} p-4`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className={`text-sm font-semibold ${W}`}>Add customer</h3>
          <button onClick={onCancel} className={`rounded p-1 ${F} hover:bg-slate-200 dark:hover:bg-slate-800`}><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-3 grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="First name">
              <input autoFocus className={IN} value={f.first} onChange={(e) => setF({ ...f, first: e.target.value })} />
            </Field>
            <Field label="Last name">
              <input className={IN} value={f.last} onChange={(e) => setF({ ...f, last: e.target.value })} />
            </Field>
          </div>
          <Field label="Stripe customer ID" hint="Optional. Starts with cus_ — find it on their customer page in Stripe.">
            <input className={`${IN} font-mono text-xs`} placeholder="cus_…" value={f.stripeId}
              onChange={(e) => setF({ ...f, stripeId: e.target.value })} />
          </Field>
          <Field label="Email" hint="Optional. Useful when two people share a name.">
            <input className={IN} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </Field>
        </div>
        {clash && !bad && <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">Somebody with this name is already saved. Adding them twice makes them hard to tell apart later.</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className={BTN}>Cancel</button>
          <button disabled={!!bad} title={bad || undefined}
            onClick={() => onSave({ id: uid("cst"), ...f, first: f.first.trim(), last: f.last.trim(), stripeId: f.stripeId.trim(), email: f.email.trim(), addedAt: Date.now() })}
            className={`${PRI} disabled:cursor-not-allowed disabled:opacity-40`}>Add customer</button>
        </div>
      </div>
    </div>
  );
}

/* ── payments you don't want to see ──
   A test charge, a five-dollar nuisance subscription, an internal card. They
   arrive like any other payment and bury the orders that matter. A rule hides
   them — and says how many it has caught, because a filter whose effect is
   invisible is how an order goes missing. */
export function BlockRules({ blocks, hidden, orders, commit, flash }) {
  const [draft, setDraft] = useState(null);
  const [peek, setPeek] = useState(false);
  const rules = blocks || [];

  const toggle = (id) => commit((x) => ({
    ...x, blocks: (x.blocks || []).map((r) => (r.id === id ? { ...r, enabled: r.enabled === false } : r)),
  }), "Rule updated");
  const drop = (id) => commit((x) => ({ ...x, blocks: (x.blocks || []).filter((r) => r.id !== id) }), "Rule removed");

  return (
    <div className={`${CARD} p-4`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={`flex items-center gap-2 text-sm font-semibold ${W}`}>
          <Ban className="h-4 w-4 text-blue-600 dark:text-blue-400" /> Blocked payments
        </h3>
        <button onClick={() => setDraft({ field: "subscriptionId", op: "is", value: "", note: "" })}
          className={`${BTN} flex items-center gap-1.5`}><Plus className="h-3.5 w-3.5" /> Add rule</button>
      </div>
      <p className={`mt-1 text-sm ${M}`}>
        Payments matching a rule never reach the board. Nothing is deleted — switch a rule off and anything
        still on the board comes back.
      </p>

      <div className={`mt-3 overflow-hidden rounded-lg border ${BD}`}>
        {!rules.length && <p className={`px-3 py-6 text-center text-sm ${M}`}>No rules. Every payment reaches the board.</p>}
        <div className={`divide-y divide-slate-200 dark:divide-slate-800 ${SCROLL}`}>
          {rules.map((r) => {
            const on = r.enabled !== false;
            return (
              <div key={r.id} className={`flex items-center gap-3 px-3 py-2 ${on ? "" : "opacity-50"}`}>
                <button onClick={() => toggle(r.id)} title={on ? "Turn this rule off" : "Turn this rule on"}
                  className={`relative h-5 w-9 shrink-0 rounded-full ${on ? "bg-blue-600" : "bg-slate-300 dark:bg-slate-700"}`}>
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
                </button>
                <div className="min-w-0 flex-1">
                  <div className={`truncate text-sm ${W}`}>{describeBlock(r)}</div>
                  <div className={`truncate text-xs ${F}`}>
                    {r.note ? `${r.note} · ` : ""}{r.hits ? `${r.hits} kept off the board` : "nothing caught yet"}
                  </div>
                </div>
                <div className="shrink-0"><Confirm label="Remove this rule" onConfirm={() => drop(r.id)} /></div>
              </div>
            );
          })}
        </div>
      </div>

      {!!hidden?.length && (
        <div className={`mt-3 rounded-lg border-l-4 border-amber-500 ${PANEL} py-2 pl-3 pr-2`}>
          <button onClick={() => setPeek(!peek)} className={`flex items-center gap-1.5 text-sm ${W}`}>
            <Eye className="h-3.5 w-3.5" />
            {hidden.length} order{hidden.length === 1 ? "" : "s"} on the board {hidden.length === 1 ? "is" : "are"} hidden by these rules
          </button>
          {peek && (
            <ul className={`mt-2 max-h-48 space-y-1 overflow-auto text-xs ${M}`}>
              {hidden.map((o) => (
                <li key={o.id} className="truncate">
                  {o.productName} — {o.customer} — {cash(o.amount)}
                  <span className={F}> · {describeBlock(blockedBy(o, blocks))}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {draft && <BlockForm draft={draft} orders={orders} onCancel={() => setDraft(null)}
        onSave={(r) => {
          commit((x) => ({ ...x, blocks: [...(x.blocks || []), r] }), "Rule added");
          setDraft(null);
        }} />}
    </div>
  );
}

/* Shows what the rule would catch before it is saved. Typing "5" into an
   amount rule and meaning "$5" while it quietly hides every order under
   five hundred dollars is the mistake worth preventing. */
function BlockForm({ draft, orders, onCancel, onSave }) {
  const [r, setR] = useState({ enabled: true, ...draft });
  const kind = bf(r.field)[2];
  const ops = opsFor(r.field);
  const value = String(r.value ?? "").trim();
  const bad = !value ? "Type what to match on."
    : kind === "money" && !Number.isFinite(Number(value)) ? "That isn't a number."
      : "";
  const would = useMemo(
    () => (bad ? [] : (orders || []).filter((o) => blockHits(o, { ...r, enabled: true }))),
    [orders, r, bad],
  );

  /* Changing the field can strand an operator the new field doesn't offer. */
  const pickField = (field) => {
    const allowed = opsFor(field).map(([id]) => id);
    setR((x) => ({ ...x, field, op: allowed.includes(x.op) ? x.op : allowed[0] }));
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4 dark:bg-black/75" onClick={onCancel}>
      <div className={`w-full max-w-lg ${CARD} p-4`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className={`text-sm font-semibold ${W}`}>Block a payment</h3>
          <button onClick={onCancel} className={`rounded p-1 ${F} hover:bg-slate-200 dark:hover:bg-slate-800`}><X className="h-4 w-4" /></button>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Field label="Match on">
            <select className={IN} value={r.field} onChange={(e) => pickField(e.target.value)}>
              {BLOCK_FIELDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </Field>
          <Field label="That">
            <select className={IN} value={r.op} onChange={(e) => setR({ ...r, op: e.target.value })}>
              {ops.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </Field>
          <Field label={kind === "money" ? "Amount in dollars" : "Value"}>
            <input autoFocus className={`${IN} ${kind === "money" ? "" : "font-mono text-xs"}`}
              placeholder={kind === "money" ? "5.00" : bf(r.field)[0] === "subscriptionId" ? "sub_…" : ""}
              value={r.value} onChange={(e) => setR({ ...r, value: e.target.value })} />
          </Field>
        </div>

        <div className="mt-3">
          <Field label="Why" hint="Optional, but the next person to read this list will want to know.">
            <input className={IN} placeholder="e.g. internal test card" value={r.note || ""}
              onChange={(e) => setR({ ...r, note: e.target.value })} />
          </Field>
        </div>

        <div className={`mt-3 rounded-lg border-l-4 ${would.length ? "border-amber-500" : "border-slate-300 dark:border-slate-700"} ${PANEL} py-2 pl-3 pr-2`}>
          <p className={`text-sm ${W}`}>
            {bad ? "Nothing to preview yet."
              : would.length ? `Hides ${would.length} order${would.length === 1 ? "" : "s"} already on the board.`
                : "Matches nothing on the board right now. It still applies to payments that arrive later."}
          </p>
          {!!would.length && (
            <ul className={`mt-1 max-h-32 space-y-0.5 overflow-auto text-xs ${M}`}>
              {would.slice(0, 12).map((o) => (
                <li key={o.id} className="truncate">{o.productName} — {o.customer} — {cash(o.amount)}</li>
              ))}
              {would.length > 12 && <li className={F}>and {would.length - 12} more</li>}
            </ul>
          )}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className={BTN}>Cancel</button>
          <button disabled={!!bad} title={bad || undefined}
            onClick={() => onSave({ id: uid("blk"), ...r, value: value, hits: 0, createdAt: Date.now() })}
            className={`${PRI} disabled:cursor-not-allowed disabled:opacity-40`}>Add rule</button>
        </div>
      </div>
    </div>
  );
}

export function Settings({ cfg, products, orders, customers, blocks, hidden, saveCfg, commit, sync, onSync, addOrders, flash, live }) {
  const [theme, setTheme] = useTheme();
  const [l, setL] = useState(cfg);
  useEffect(() => setL(cfg), [cfg.syncUrl, cfg.autoSyncMinutes, cfg.archiveAfterDays, cfg.pastDueHours, cfg.callCost, cfg.callPrice]);
  const set = (p) => setL((x) => ({ ...x, ...p }));
  const T = ({ label, k }) => <button onClick={() => { set({ [k]: !l[k] }); saveCfg({ [k]: !l[k] }); }} className="flex w-full items-center gap-3 text-left">
    <span className={`relative h-5 w-9 shrink-0 rounded-full ${l[k] ? "bg-blue-600" : "bg-slate-300 dark:bg-slate-700"}`}>
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${l[k] ? "left-[18px]" : "left-0.5"}`} />
    </span><span className="text-sm text-slate-700 dark:text-slate-300">{label}</span>
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
          <h3 className={`flex items-center gap-2 text-sm font-semibold ${W}`}><Link2 className="h-4 w-4 text-blue-600 dark:text-blue-400" /> Stripe connection</h3>
          <div className={`mt-3 rounded-lg border-l-4 border-amber-500 ${PANEL} py-2 pl-3 pr-2 text-sm`}>
            <p className="text-slate-700 dark:text-slate-300"><strong>Your secret key doesn't go in this portal.</strong> Anything typed here sits in shared storage the whole team can read, and browsers can't call Stripe with a secret key anyway.</p>
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
              <div className={`rounded-lg border-l-4 ${live ? "border-emerald-500" : "border-slate-400 dark:border-slate-600"} ${PANEL} py-2 pl-3 pr-2 text-sm`}>
                {live
                  ? <p className="text-slate-700 dark:text-slate-300"><strong className="text-emerald-600 dark:text-emerald-400">Stripe is pushing payments here.</strong> New orders appear within about fifteen seconds of the charge, without anyone pressing anything.</p>
                  : <p className="text-slate-700 dark:text-slate-300"><strong>Checking Stripe on a timer.</strong> Orders can take up to the interval above to appear. Add the webhook (see the README) and they arrive as they happen.</p>}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={onSync} disabled={sync.busy} className={`inline-flex items-center gap-1.5 ${PRI} disabled:opacity-50`}>
                <RefreshCw className={`h-4 w-4 ${sync.busy ? "animate-spin" : ""}`} /> Test connection</button>
              {sync.at && !sync.error && <span className="text-sm text-emerald-600 dark:text-emerald-400">Connected — pulled {sync.added} new.</span>}
              {sync.error && <span className="text-sm text-rose-600 dark:text-rose-400">{sync.error}</span>}
            </div>
          </div>
        </div>

        <div className={`${CARD} p-4`}>
          <h3 className={`flex items-center gap-2 text-sm font-semibold ${W}`}><Package className="h-4 w-4 text-blue-600 dark:text-blue-400" /> Stripe product mapping</h3>
          <p className={`mt-1 text-sm ${M}`}>Paste the price or product ID from Stripe so orders land in the right lane and pick up the right color.</p>
          <div className="mt-3 space-y-2">{products.map((p) => <Mapper key={p.id} p={p} commit={commit} />)}</div>
        </div>

        <CustomerBook customers={customers} commit={commit} flash={flash} />

        <BlockRules blocks={blocks} hidden={hidden} orders={orders} commit={commit} flash={flash} />

        <div className={`${CARD} p-4`}>
          <h3 className={`flex items-center gap-2 text-sm font-semibold ${W}`}><Bell className="h-4 w-4 text-blue-600 dark:text-blue-400" /> Notifications</h3>
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
          <h3 className={`flex items-center gap-2 text-sm font-semibold ${W}`}><Sun className="h-4 w-4 text-blue-600 dark:text-blue-400" /> Appearance</h3>
          <p className={`mt-1 font-mono text-[11px] ${F}`}>{buildStamp()}</p>
          <p className={`mt-1 text-sm ${M}`}>Applies to this browser only — everyone signing in picks their own.</p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {THEMES.map(([id, label]) => {
              const Icon = id === "light" ? Sun : id === "dark" ? Moon : Monitor;
              const on = theme === id;
              return (
                <button key={id} onClick={() => setTheme(id)} aria-pressed={on}
                  className={`flex flex-col items-center gap-1.5 rounded-lg border px-2 py-3 text-xs font-medium ${
                    on ? "border-blue-500 bg-blue-500/10 text-blue-700 dark:text-blue-300"
                      : `${BD} ${M} hover:bg-slate-100 dark:hover:bg-slate-800`}`}>
                  <Icon className="h-4 w-4" />{label}
                </button>
              );
            })}
          </div>
        </div>

        <div className={`${CARD} p-4`}>
          <h3 className={`flex items-center gap-2 text-sm font-semibold ${W}`}><PhoneCall className="h-4 w-4 text-blue-600 dark:text-blue-400" /> Call rates</h3>
          <p className={`mt-1 text-sm ${M}`}>What the Calls tab prices each side at. Changing these re-prices every day already logged.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="You pay, per call">
              <input type="number" min="0" step="0.01" className={IN}
                value={(Number(l.callCost) || 0) / 100}
                onChange={(e) => set({ callCost: Math.max(0, Math.round(Number(e.target.value) * 100) || 0) })}
                onBlur={() => saveCfg({ callCost: Math.max(0, Number(l.callCost) || 0) })} />
            </Field>
            <Field label="Agents pay, per call">
              <input type="number" min="0" step="0.01" className={IN}
                value={(Number(l.callPrice) || 0) / 100}
                onChange={(e) => set({ callPrice: Math.max(0, Math.round(Number(e.target.value) * 100) || 0) })}
                onBlur={() => saveCfg({ callPrice: Math.max(0, Number(l.callPrice) || 0) })} />
            </Field>
          </div>
          <p className={`mt-2 text-xs ${F}`}>
            {cash(Number(l.callPrice) || 0)} in less {cash(Number(l.callCost) || 0)} out ={" "}
            <span className={(Number(l.callPrice) || 0) - (Number(l.callCost) || 0) >= 0
              ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}>
              {cash((Number(l.callPrice) || 0) - (Number(l.callCost) || 0))}
            </span> a call
          </p>
        </div>

        <div className={`${CARD} p-4`}>
          <h3 className={`flex items-center gap-2 text-sm font-semibold ${W}`}><AlarmClock className="h-4 w-4 text-blue-600 dark:text-blue-400" /> Past due</h3>
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
          <h3 className={`flex items-center gap-2 text-sm font-semibold ${W}`}><FlaskConical className="h-4 w-4 text-blue-600 dark:text-blue-400" /> Try it out</h3>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 dark:bg-black/75 p-4" onClick={onCancel}>
      <div className={`max-h-[86vh] w-full max-w-lg overflow-y-auto ${CARD} p-5 shadow-2xl`} onClick={(e) => e.stopPropagation()}>
        <h3 className={`text-base font-semibold ${W}`}>{draft.name ? "Edit refund type" : "New refund type"}</h3>
        <div className="mt-4 space-y-3">
          <Field label="What is it?" hint="What you'd call this kind of refund — an individual call, a cancelled membership.">
            <input value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} placeholder="Individual call" className={IN} />
          </Field>
          <Field label="Colour">
            <div className="flex flex-wrap gap-2">{Object.keys(P).map((k) => (
              <button key={k} onClick={() => setT({ ...t, color: k })}
                className={`h-7 w-7 rounded-full ${P[k][0]} ${t.color === k ? "ring-2 ring-slate-900 dark:ring-white ring-offset-2 ring-offset-white dark:ring-offset-slate-900" : "opacity-60"}`} />
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
    <div className={`flex flex-wrap items-center gap-3 rounded-lg border-l-4 ${c(p.color)[2]} border-y border-r ${BD} bg-slate-50 dark:bg-slate-900/70 p-2.5`}>
      <div className="min-w-[150px] flex-1">
        <div className={`text-sm font-medium ${W}`}>{p.name}</div><div className={`text-xs ${M}`}>{p.slaHours}h target</div>
      </div>
      <input value={v} onChange={(e) => setV(e.target.value)}
        onBlur={() => commit((s) => ({ ...s, products: s.products.map((x) => (x.id === p.id ? { ...x, stripeIds: v.split(",").map((y) => y.trim()).filter(Boolean) } : x)) }), "Mapping saved")}
        placeholder="price_1Ab…, prod_Xyz…" className={`${IN} flex-[2] font-mono text-xs`} />
    </div>
  );
}
