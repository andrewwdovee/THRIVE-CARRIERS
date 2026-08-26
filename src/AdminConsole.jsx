import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Plus, Trash2, RefreshCw, Download, X, Package, BarChart3, Settings, User,
  Bell, Link2, ArrowUpDown, FlaskConical,
} from "lucide-react";
import {
  BD, CARD, PANEL, IN, BTN, PRI, M, F, W, TD, P, c, ST, sm, SEED, DEF, KEY, HOUR, DAY,
  uid, paidOk, brief, dk, dl, sod, cash, freq, L, Field, Confirm, grab, dump,
} from "./lib/shared";
import { useBoard, appendOrders } from "./lib/useBoard";
import { pullStripe } from "./lib/sync";

/* Admin Console — products, reports, and the Stripe connection.
   Shares one database with the Fulfillment Desk via the same storage key. */

/* ═════ APP ═════ */
export default function AdminConsole() {
  const { st, loading, err, load, commit: rawCommit, R } = useBoard();
  const [tab, setTab] = useState("reports");
  const [n, setN] = useState(Date.now());
  const [toast, setToast] = useState(null);
  const [sync, setSync] = useState({ busy: false, at: null, error: null, added: 0 });
  const cfg = { ...DEF, ...(st.settings || {}) };

  useEffect(() => { const t = setInterval(() => setN(Date.now()), 3e4); return () => clearInterval(t); }, []);
  const flash = useCallback((m) => { setToast(m); setTimeout(() => setToast(null), 2600); }, []);
  const commit = useCallback((fn, note) => rawCommit(fn, note, flash), [rawCommit, flash]);

  const { orders, products } = st;
  const saveCfg = (p) => commit((s) => ({ ...s, settings: { ...DEF, ...(s.settings || {}), ...p } }));

  const addOrders = useCallback((drafts) => {
    commit((x) => appendOrders(x, drafts).next);
  }, [commit]);

  const runSync = useCallback(async () => {
    const s = { ...DEF, ...(R.current.settings || {}) };
    if (!s.syncUrl) { setSync({ busy: false, at: Date.now(), added: 0, error: "Add your sync endpoint below first." }); return; }
    setSync((p) => ({ ...p, busy: true, error: null }));
    try {
      const drafts = await pullStripe(s, R.current.orders, R.current.products);
      addOrders(drafts);
      setSync({ busy: false, at: Date.now(), error: null, added: drafts.length });
    } catch (e) { setSync({ busy: false, at: Date.now(), added: 0, error: `Couldn't reach the sync endpoint. ${e.message}` }); }
  }, [addOrders, R]);

  /* Auto-pull on the interval set in Settings. */
  useEffect(() => {
    const mins = Math.max(1, Number(cfg.autoSyncMinutes) || 5);
    if (!cfg.syncUrl) return;
    const t = setInterval(() => { if (!document.hidden) runSync(); }, mins * 6e4);
    return () => clearInterval(t);
  }, [cfg.syncUrl, cfg.autoSyncMinutes, runSync]);

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-400">
    <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Loading…</div>;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <header className={`sticky top-0 z-20 border-b ${BD} bg-slate-950/95 backdrop-blur`}>
        <div className="mx-auto max-w-7xl px-4 py-3">
          <div className="flex flex-wrap items-center gap-4">
            <div><h1 className={`text-lg font-bold tracking-tight ${W}`}>Admin Console</h1><L>Fulfillment Desk · owner view</L></div>
            <div className="ml-auto flex items-center gap-2">
              <button onClick={runSync} disabled={sync.busy} className={`inline-flex items-center gap-1.5 ${PRI} disabled:opacity-60`}>
                <RefreshCw className={`h-4 w-4 ${sync.busy ? "animate-spin" : ""}`} />{sync.busy ? "Syncing" : "Sync Stripe"}
              </button>
              <button onClick={() => load(false)} className={BTN} title="Refresh"><RefreshCw className="h-4 w-4" /></button>
              <button onClick={() => { grab(`backup-${dk(n)}.json`, new Blob([JSON.stringify({ ...st, settings: { ...cfg, syncToken: "" } })], { type: "application/json" })); flash("Backup downloaded"); }}
                className={BTN} title="Backup"><Download className="h-4 w-4" /></button>
            </div>
          </div>
          <nav className="mt-3 flex gap-1">
            {[["reports", "Reports", BarChart3], ["catalog", "Products", Package], ["settings", "Settings", Settings]].map(([id, label, Icon]) => (
              <button key={id} onClick={() => setTab(id)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium ${tab === id ? "bg-blue-600 text-white" : `${M} hover:bg-slate-800`}`}>
                <Icon className="h-4 w-4" />{label}
              </button>
            ))}
          </nav>
        </div>
        {err && <div className="border-t border-rose-900 bg-rose-950/50 px-4 py-2 text-sm text-rose-200">{err}</div>}
        {sync.error && <div className="border-t border-amber-900 bg-amber-950/40 px-4 py-2 text-sm text-amber-200">{sync.error}</div>}
      </header>

      <main className="mx-auto max-w-7xl px-4 py-5">
        {tab === "reports" && <Reports orders={orders} products={products} n={n} />}
        {tab === "catalog" && <Catalog products={products} orders={orders} commit={commit} />}
        {tab === "settings" && <Setup cfg={cfg} products={products} orders={orders} saveCfg={saveCfg} commit={commit}
          sync={sync} onSync={runSync} addOrders={addOrders} flash={flash} />}
      </main>

      {toast && <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-slate-800 px-4 py-2 text-sm text-white shadow-xl">{toast}</div>}
    </div>
  );
}

/* ═════ REPORTS ═════ */
const RANGES = [["today", "Today"], ["7", "Last 7 days"], ["30", "Last 30 days"], ["90", "Last 90 days"], ["all", "All time"], ["custom", "Custom"]];

function Reports({ orders, products, n }) {
  const [range, setRange] = useState("30"), [a, setA] = useState(dk(n - 14 * DAY)), [b, setB] = useState(dk(n));
  const [ds, setDs] = useState({ k: "day", d: "desc" }), [ps, setPs] = useState({ k: "count", d: "desc" });

  const [from, to] = useMemo(() => {
    if (range === "today") return [sod(n), n];
    if (range === "all") return [0, n];
    if (range === "custom") { const f = Date.parse(a + "T00:00:00"), t = Date.parse(b + "T23:59:59"); return [isNaN(f) ? 0 : f, isNaN(t) ? n : t]; }
    return [n - Number(range) * DAY, n];
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
          <button onClick={() => dump(scoped, "csv")} className={`inline-flex items-center gap-1.5 ${BTN}`}><Download className="h-4 w-4" /> Orders CSV</button>
          <button onClick={() => dump(scoped, "json")} className={`inline-flex items-center gap-1.5 ${BTN}`}><Download className="h-4 w-4" /> JSON</button>
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
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className={`border-b text-left ${BD}`}>
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
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className={`border-b text-left ${BD}`}>
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

      <div className={`overflow-hidden rounded-xl border ${BD}`}>
        <div className={`border-b ${BD} bg-slate-900 px-4 py-3`}><h3 className={`text-sm font-semibold ${W}`}>Team performance</h3></div>
        {!people.length ? <p className={`px-4 py-6 text-sm ${M}`}>Numbers appear here once orders get marked delivered.</p>
          : people.map((p) => <div key={p.name} className={`flex flex-wrap items-center gap-4 border-b px-4 py-3 last:border-0 ${BD}`}>
            <User className={`h-4 w-4 ${F}`} /><span className={`flex-1 text-sm ${W}`}>{p.name}</span>
            <span className="font-mono text-sm text-slate-300">{p.count} delivered</span>
            <span className={`font-mono text-sm ${M}`}>{brief(p.time / p.count)} avg</span>
            <span className={`font-mono text-sm ${p.late ? "text-rose-400" : "text-emerald-400"}`}>{Math.round(((p.count - p.late) / p.count) * 100)}% on target</span>
          </div>)}
      </div>
    </div>
  );
}

const Metric = ({ t, v, k, small }) => <div className={`${CARD} p-4`}>
  <L>{t}</L><div className={`mt-2 font-bold tabular-nums ${small ? "text-base leading-tight" : "font-mono text-2xl"} ${k || W}`}>{v}</div>
</div>;

/* ═════ PRODUCTS ═════ */
function Catalog({ products, orders, commit }) {
  const [ed, setEd] = useState(null);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className={`text-sm font-semibold ${W}`}>Products and fulfillment steps</h2>
          <p className={`text-xs ${F}`}>Each product's color follows its orders everywhere.</p>
        </div>
        <button onClick={() => setEd({ id: uid("p"), name: "", kind: "one-time", slaHours: 24, color: "blue", stripeMatch: "", stripeIds: [], steps: [""] })}
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
                  <span>· {orders.filter((o) => o.productId === p.id && o.status !== "done" && paidOk(o)).length} open</span>
                  <span>· {(p.stripeIds || []).length} Stripe ID{(p.stripeIds || []).length === 1 ? "" : "s"}</span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setEd({ ...p, steps: p.steps?.length ? p.steps : [""] })} className={`rounded-md p-1.5 ${F} hover:bg-slate-800 hover:text-white`}><Settings className="h-4 w-4" /></button>
                <Confirm label="Delete product" onConfirm={() => commit((s) => ({ ...s, products: s.products.filter((x) => x.id !== p.id) }), "Product deleted")} />
              </div>
            </div>
            <ul className="mt-3 space-y-1">
              {(p.steps || []).filter(Boolean).map((s, i) => (
                <li key={i} className={`flex items-start gap-2 text-sm ${M}`}><span className={`mt-1.5 h-1 w-1 shrink-0 rounded-full ${c(p.color)[0]}`} />{s}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {ed && <Editor draft={ed} onCancel={() => setEd(null)} onSave={(p) => {
        commit((s) => ({ ...s, products: s.products.some((x) => x.id === p.id) ? s.products.map((x) => (x.id === p.id ? p : x)) : [...s.products, p] }), "Product saved");
        setEd(null);
      }} />}
    </div>
  );
}

function Editor({ draft, onCancel, onSave }) {
  const [p, setP] = useState({ stripeIds: [], color: "blue", steps: [""], ...draft });
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
          <div>
            <L className="mb-1">Fulfillment steps</L>
            {(p.steps || []).map((s, i) => (
              <div key={i} className="mb-2 flex gap-2">
                <input value={s} onChange={(e) => setP({ ...p, steps: p.steps.map((x, j) => (j === i ? e.target.value : x)) })} className={IN} />
                <button onClick={() => setP({ ...p, steps: p.steps.filter((_, j) => j !== i) })} className={`rounded-md p-2 ${F} hover:text-rose-400`}><X className="h-4 w-4" /></button>
              </div>
            ))}
            <button onClick={() => setP({ ...p, steps: [...(p.steps || []), ""] })} className={`text-sm ${M} hover:underline`}>+ Add step</button>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} className={`rounded-md px-3 py-2 text-sm ${M}`}>Cancel</button>
          <button onClick={() => p.name.trim() && onSave({ ...p, steps: (p.steps || []).filter((s) => s.trim()) })} className={PRI}>Save product</button>
        </div>
      </div>
    </div>
  );
}

/* ═════ SETTINGS ═════ */
const NAMES = ["Marcus Webb", "Tanya Alvarez", "Derrick Poole", "Simone Carter", "Ray Whitfield", "Nina Okafor", "Chad Brenner", "Lucia Marín", "Owen Hartley", "Priya Raman", "Gus Delgado", "Halle Byrne"];
const STAFF = ["Alex Reyna", "Jordan Six", "Kim Petrov"];

function Setup({ cfg, products, orders, saveCfg, commit, sync, onSync, addOrders, flash }) {
  const [l, setL] = useState(cfg);
  useEffect(() => setL(cfg), [cfg.syncUrl, cfg.autoSyncMinutes, cfg.archiveAfterDays]);
  const set = (p) => setL((x) => ({ ...x, ...p }));
  const T = ({ label, k }) => <button onClick={() => { set({ [k]: !l[k] }); saveCfg({ [k]: !l[k] }); }} className="flex w-full items-center gap-3 text-left">
    <span className={`relative h-5 w-9 shrink-0 rounded-full ${l[k] ? "bg-blue-600" : "bg-slate-700"}`}>
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${l[k] ? "left-[18px]" : "left-0.5"}`} />
    </span><span className="text-sm text-slate-300">{label}</span>
  </button>;

  /* Fake orders that actually exercise the whole app: a week of delivered
     history so every report has numbers in it, plus a few live orders — one
     deliberately past its target — so the board shows both states. */
  const samples = () => {
    if (!products.length) { flash("Add a product first"); return; }
    const br = ["visa", "mastercard", "amex", "discover"];
    const now = Date.now();
    addOrders(NAMES.map((nm, i) => {
      const p = products[i % products.length], bad = i % 7 === 3, sub = p.kind === "subscription", id = uid();
      const amt = [29700, 49700, 99700, 19700][i % 4], mail = nm.toLowerCase().replace(/[^a-z]/g, ".") + "@example.com";
      const sla = (p.slaHours || 24) * HOUR;
      const shipped = i < 8 && !bad;
      // Two of the delivered ones ran long, so "on target" isn't a flat 100%.
      const took = sla * (i % 4 === 2 ? 1.4 : 0.3 + (i % 3) * 0.2);
      const age = shipped ? (6 - i * 0.7) * DAY : sla * (i === 9 ? 1.6 : 0.2 + (i % 3) * 0.15);
      const at = now - age;
      return { source: "sample", externalId: `ch_s_${id}`, paymentId: `pi_s_${id}`, chargeId: `ch_s_${id}`,
        paymentStatus: bad ? "failed" : "succeeded", declineCode: bad ? "insufficient_funds" : "",
        declineReason: bad ? "Your card has insufficient funds." : "", amount: amt, currency: "USD",
        status: shipped ? "done" : bad ? "new" : i % 2 ? "active" : "new",
        completedAt: shipped ? at + took : null,
        assignee: shipped || (!bad && i % 2) ? STAFF[i % STAFF.length] : "Unassigned",
        checklist: shipped ? Object.fromEntries((p.steps || []).map((_, k) => [k, true])) : {},
        overdueNotified: shipped,
        receivedAt: at, customerId: `cus_s_${id.slice(-8)}`, customer: nm,
        email: mail, phone: `+1727555${String(1e3 + i).slice(-4)}`, ownerName: nm, ownerEmail: mail,
        paymentMethodId: `pm_s_${id.slice(-8)}`, paymentMethodType: "card", cardBrand: br[i % 4],
        cardLast4: String(4e3 + i * 7).slice(-4), cardExp: "07/29",
        subscriptionId: sub ? `sub_s_${id.slice(-8)}` : "", subscriptionStatus: sub ? "active" : "",
        interval: sub ? "month" : "", intervalCount: 1, quantity: 1, invoiceId: sub ? `in_s_${id.slice(-8)}` : "",
        productId: p.id, productName: p.name, stripePriceId: `price_s_${p.id}`,
        items: [{ description: p.name, quantity: 1, amount: amt, priceId: `price_s_${p.id}`, interval: sub ? "month" : null, intervalCount: 1 }] };
    }));
    flash("Sample orders loaded");
  };

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <div className={`${CARD} p-4`}>
          <h3 className={`flex items-center gap-2 text-sm font-semibold ${W}`}><Link2 className="h-4 w-4 text-blue-400" /> Stripe connection</h3>
          <div className={`mt-3 rounded-lg border-l-4 border-amber-500 ${PANEL} py-2 pl-3 pr-2 text-sm`}>
            <p className="text-slate-300"><strong>Your secret key doesn't go in this portal.</strong> Anything typed here sits in shared storage the whole team can read, and browsers can't call Stripe with a secret key anyway.</p>
            <p className={`mt-2 ${M}`}>The key goes in the relay you deploy once — code is in <span className="font-mono text-xs">relay/</span> in this repo. Paste its address below and orders flow in on their own.</p>
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
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={onSync} disabled={sync.busy || !l.syncUrl} className={`inline-flex items-center gap-1.5 ${PRI} disabled:opacity-50`}>
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
          <p className={`mt-1 text-sm ${M}`}>A desktop alert and chime fire in the Fulfillment Desk while your assistant has it open. For email or text, point this at a Zapier or Make webhook — the Desk posts the order details and Zapier sends the message.</p>
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
                body: JSON.stringify({ title: "Test from Fulfillment Desk", body: "Notifications are wired up.", email: l.notifyEmail, phone: l.notifyPhone }) }); } catch (e) { }
              flash("Test sent");
            }} className={`w-fit ${BTN}`}>Send a test</button>
          </div>
        </div>
      </div>

      <aside className="space-y-4">
        <div className={`${CARD} p-4`}>
          <h3 className={`text-sm font-semibold ${W}`}>Board</h3>
          <div className="mt-3"><Field label="Move delivered orders off the board after (days)" hint="They stay in New orders and Reports.">
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
          <h3 className={`text-sm font-semibold ${W}`}>Two windows, one database</h3>
          <p className={`mt-2 text-sm ${M}`}>This console and the Fulfillment Desk read and write the same records. Changes here show up there within about twenty seconds.</p>
        </div>
      </aside>
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
