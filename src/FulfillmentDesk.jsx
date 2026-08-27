import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  RefreshCw, Search, Inbox, LayoutGrid, Clock, AlertTriangle, X, Mail, Phone,
  CreditCard, Receipt, CheckCircle2, Circle, Bell, BellOff, RotateCcw, User, PackageOpen,
} from "lucide-react";
import {
  BD, CARD, IN, BTN, PRI, M, F, W, c, ST, sm, DEF, DAY,
  paidOk, cash, freq, L, Field, HOUR,
} from "./lib/shared";
import { useBoard, appendOrders } from "./lib/useBoard";
import { pullStripe } from "./lib/sync";
import { buildSamples } from "./lib/samples";
import { chime, desktop, askPermission, hook } from "./lib/notify";
import { Stopwatch, clock } from "./components/Elapsed";

/* Fulfillment Desk — the working view.
   Same record as the Admin Console; this window is where orders actually move. */

const late = (o, now) => o.status !== "done" && o.dueAt && o.dueAt < now;
const steps = (products, o) => products.find((p) => p.id === o.productId)?.steps?.filter(Boolean) || [];
const doneCount = (o, list) => list.filter((_, i) => o.checklist?.[i]).length;
const target = (products, o) => {
  const p = products.find((x) => x.id === o.productId);
  return p?.slaHours ? p.slaHours * HOUR : null;
};

export default function FulfillmentDesk({ me: account }) {
  const { st, loading, err, load, commit: rawCommit, R } = useBoard();
  const [tab, setTab] = useState("board");
  const [q, setQ] = useState("");
  const [mine, setMine] = useState("");
  const [open, setOpen] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [toast, setToast] = useState(null);
  const [sync, setSync] = useState({ busy: false, error: null });
  const [perm, setPerm] = useState(typeof Notification !== "undefined" ? Notification.permission : "unsupported");

  const cfg = { ...DEF, ...(st.settings || {}) };
  const { orders, products } = st;

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 3e4); return () => clearInterval(t); }, []);
  const flash = useCallback((m) => { setToast(m); setTimeout(() => setToast(null), 2600); }, []);
  const commit = useCallback((fn, note) => rawCommit(fn, note, flash), [rawCommit, flash]);

  /* ── who is at this desk ── */
  useEffect(() => {
    // Signed in? That's who you are. Otherwise remember what was typed here.
    const named = account?.name || account?.email;
    setMine(named || localStorage.getItem("fulfillment_me") || "");
  }, [account]);
  const setMe = (v) => { setMine(v); try { localStorage.setItem("fulfillment_me", v); } catch { /* private mode */ } };

  /* ── alerts ──
     `seen` is primed on the first load so opening the Desk doesn't fire a
     dozen notifications for orders that have been sitting there all week. */
  const seen = useRef(null);
  useEffect(() => {
    if (loading) return;
    const ids = new Set(orders.map((o) => o.id));
    if (seen.current === null) { seen.current = ids; return; }
    const fresh = orders.filter((o) => !seen.current.has(o.id) && paidOk(o));
    seen.current = ids;
    if (!fresh.length) return;
    const title = fresh.length === 1 ? `New order — ${fresh[0].productName}` : `${fresh.length} new orders`;
    const body = fresh.length === 1 ? `${fresh[0].customer} · ${cash(fresh[0].amount)}` : fresh.map((o) => o.customer).join(", ");
    if (cfg.notifySound) chime();
    if (cfg.notifyBrowser) desktop(title, body);
    hook(cfg.notifyWebhook, {
      event: "order.new", title, body, email: cfg.notifyEmail, phone: cfg.notifyPhone,
      orders: fresh.map((o) => ({ id: o.id, customer: o.customer, product: o.productName, amount: o.amount, currency: o.currency, email: o.email, phone: o.phone, dueAt: o.dueAt })),
    });
  }, [orders, loading, cfg.notifySound, cfg.notifyBrowser, cfg.notifyWebhook, cfg.notifyEmail, cfg.notifyPhone]);

  /* One alert per order the moment it slips past its target, then never again. */
  useEffect(() => {
    if (loading || !cfg.notifyOverdue) return;
    const slipped = orders.filter((o) => late(o, now) && !o.overdueNotified && paidOk(o));
    if (!slipped.length) return;
    const title = slipped.length === 1 ? `Past due — ${slipped[0].customer}` : `${slipped.length} orders past due`;
    if (cfg.notifyBrowser) desktop(title, slipped.map((o) => o.productName).join(", "));
    if (cfg.notifySound) chime();
    hook(cfg.notifyWebhook, {
      event: "order.overdue", title, body: slipped.map((o) => `${o.customer} — ${o.productName}`).join("; "),
      email: cfg.notifyEmail, phone: cfg.notifyPhone,
      orders: slipped.map((o) => ({ id: o.id, customer: o.customer, product: o.productName, dueAt: o.dueAt })),
    });
    const ids = new Set(slipped.map((o) => o.id));
    commit((s) => ({ ...s, orders: s.orders.map((o) => (ids.has(o.id) ? { ...o, overdueNotified: true } : o)) }));
  }, [orders, now, loading, cfg.notifyOverdue, cfg.notifyBrowser, cfg.notifySound, cfg.notifyWebhook, cfg.notifyEmail, cfg.notifyPhone, commit]);

  /* ── order edits ── */
  const patch = useCallback((id, p, note) => {
    commit((s) => ({ ...s, orders: s.orders.map((o) => (o.id === id ? { ...o, ...(typeof p === "function" ? p(o) : p) } : o)) }), note);
  }, [commit]);

  const move = useCallback((id, status) => {
    patch(id, (o) => ({
      status,
      /* Stamp the delivery time on the way into done, clear it on the way back
         out — reports read completedAt to decide what actually shipped. */
      completedAt: status === "done" ? o.completedAt || Date.now() : null,
      assignee: o.assignee === "Unassigned" && mine ? mine : o.assignee,
    }), `Moved to ${sm(status)[1]}`);
  }, [patch, mine]);

  const runSync = useCallback(async () => {
    const s = { ...DEF, ...(R.current.settings || {}) };
    if (!s.syncUrl) { setSync({ busy: false, error: "No sync endpoint set — add one in the Admin Console." }); return; }
    setSync({ busy: true, error: null });
    try {
      const drafts = await pullStripe(s, R.current.orders, R.current.products);
      let n = 0;
      await rawCommit((x) => { const r = appendOrders(x, drafts); n = r.added.length; return r.next; });
      setSync({ busy: false, error: null });
      flash(n ? `${n} new order${n === 1 ? "" : "s"}` : "Up to date");
    } catch (e) { setSync({ busy: false, error: `Couldn't reach the sync endpoint. ${e.message}` }); }
  }, [rawCommit, R, flash]);

  useEffect(() => {
    const mins = Math.max(1, Number(cfg.autoSyncMinutes) || 5);
    if (!cfg.syncUrl) return;
    const t = setInterval(() => { if (!document.hidden) runSync(); }, mins * 6e4);
    return () => clearInterval(t);
  }, [cfg.syncUrl, cfg.autoSyncMinutes, runSync]);

  const loadSamples = useCallback(() => {
    commit((x) => appendOrders(x, buildSamples(x.products)).next, "Sample orders loaded");
  }, [commit]);

  /* ── what each view shows ── */
  const hits = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return orders;
    return orders.filter((o) => [o.customer, o.email, o.phone, o.productName, o.paymentId, o.chargeId, o.subscriptionId, o.notes, o.assignee]
      .filter(Boolean).some((v) => String(v).toLowerCase().includes(t)));
  }, [orders, q]);

  const board = useMemo(() => {
    const cut = now - Math.max(1, Number(cfg.archiveAfterDays) || 14) * DAY;
    return hits.filter((o) => paidOk(o) && !(o.status === "done" && (o.completedAt || 0) < cut));
  }, [hits, now, cfg.archiveAfterDays]);

  const lanes = useMemo(() => ST.map(([id, label]) => [id, label, board
    .filter((o) => (o.status || "new") === id)
    .sort((x, y) => (x.dueAt || 0) - (y.dueAt || 0))]), [board]);

  const inbox = useMemo(() => [...hits].sort((x, y) => y.receivedAt - x.receivedAt), [hits]);
  const overdue = board.filter((o) => late(o, now)).length;
  const openOrder = open ? orders.find((o) => o.id === open) : null;
  const people = useMemo(() => [...new Set(orders.map((o) => o.assignee).filter((a) => a && a !== "Unassigned"))], [orders]);

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-400">
    <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Loading…</div>;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <header className={`sticky top-0 z-20 border-b ${BD} bg-slate-950/95 backdrop-blur`}>
        <div className="mx-auto max-w-[1600px] px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <h1 className={`text-lg font-bold tracking-tight ${W}`}>Fulfillment Desk</h1>
              <L>{board.filter((o) => o.status !== "done").length} open{overdue > 0 && <span className="text-rose-400"> · {overdue} past due</span>}</L>
            </div>

            <div className="relative ml-auto w-full max-w-xs">
              <Search className={`pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 ${F}`} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, payment ID…" className={`${IN} pl-8`} />
            </div>

            <div className="w-40 shrink-0">
              <input value={mine} onChange={(e) => setMe(e.target.value)} placeholder="Your name" list="desk-people"
                className={IN} title="Claiming an order stamps this name on it" />
            </div>
            <datalist id="desk-people">{people.map((p) => <option key={p} value={p} />)}</datalist>

            {perm !== "granted" && perm !== "unsupported" && (
              <button onClick={async () => setPerm(await askPermission())} className={`inline-flex items-center gap-1.5 ${BTN}`} title="Allow desktop alerts">
                <BellOff className="h-4 w-4" /> Alerts off
              </button>
            )}
            {perm === "granted" && <span className={`inline-flex items-center gap-1.5 text-xs ${F}`}><Bell className="h-4 w-4 text-emerald-400" /> Alerts on</span>}

            <button onClick={runSync} disabled={sync.busy} className={`inline-flex items-center gap-1.5 ${PRI} disabled:opacity-60`}>
              <RefreshCw className={`h-4 w-4 ${sync.busy ? "animate-spin" : ""}`} />{sync.busy ? "Syncing" : "Sync"}
            </button>
            <button onClick={() => load(false)} className={BTN} title="Refresh"><RotateCcw className="h-4 w-4" /></button>
          </div>

          <nav className="mt-3 flex gap-1">
            {[["board", "Board", LayoutGrid], ["inbox", "New orders", Inbox]].map(([id, label, Icon]) => (
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

      <main className="mx-auto max-w-[1600px] px-4 py-5">
        {!orders.length ? <FirstRun hasSync={!!cfg.syncUrl} onSync={runSync} onSamples={loadSamples} />
          : tab === "board" ? <Board lanes={lanes} products={products} now={now} onOpen={setOpen} onMove={move} />
          : <InboxList rows={inbox} products={products} now={now} onOpen={setOpen} />}
      </main>

      {openOrder && <Drawer o={openOrder} products={products} now={now} me={mine} people={people}
        onClose={() => setOpen(null)} onPatch={patch} onMove={move} />}

      {toast && <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-slate-800 px-4 py-2 text-sm text-white shadow-xl">{toast}</div>}
    </div>
  );
}

/* Four empty columns tell a new user nothing. Say where orders come from. */
function FirstRun({ hasSync, onSync, onSamples }) {
  return (
    <div className={`mx-auto max-w-lg ${CARD} px-6 py-10 text-center`}>
      <PackageOpen className={`mx-auto h-8 w-8 ${F}`} />
      <h2 className={`mt-3 text-base font-semibold ${W}`}>No orders yet</h2>
      <p className={`mx-auto mt-2 max-w-sm text-sm ${M}`}>
        Orders arrive on their own once Stripe is connected in the Admin Console.
        Until then, load a dozen fake ones to see how the board works.
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        <button onClick={onSamples} className={PRI}>Load sample orders</button>
        {hasSync && <button onClick={onSync} className={BTN}>Check Stripe now</button>}
      </div>
    </div>
  );
}

/* ═════ BOARD ═════ */
function Board({ lanes, products, now, onOpen, onMove }) {
  const [over, setOver] = useState(null);
  return (
    <div className="grid gap-3 lg:grid-cols-4">
      {lanes.map(([id, label, rows]) => (
        <section key={id}
          onDragOver={(e) => { e.preventDefault(); setOver(id); }}
          onDragLeave={() => setOver((v) => (v === id ? null : v))}
          onDrop={(e) => { e.preventDefault(); setOver(null); const oid = e.dataTransfer.getData("text/plain"); if (oid) onMove(oid, id); }}
          className={`rounded-xl border ${over === id ? "border-blue-500 bg-slate-900" : `${BD} bg-slate-900/40`} p-2 transition-colors`}>
          <div className="flex items-center justify-between px-2 py-1.5">
            <L>{label}</L><span className={`font-mono text-xs ${F}`}>{rows.length}</span>
          </div>
          <div className="space-y-2">
            {!rows.length && <p className={`px-2 py-6 text-center text-xs ${F}`}>Nothing here.</p>}
            {rows.map((o) => <Card key={o.id} o={o} products={products} now={now} onOpen={onOpen} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

function Card({ o, products, now, onOpen }) {
  const p = products.find((x) => x.id === o.productId);
  const list = steps(products, o), did = doneCount(o, list);
  const bad = late(o, now), tgt = target(products, o);
  return (
    <article draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", o.id)}
      onClick={() => onOpen(o.id)}
      className={`cursor-pointer rounded-lg border-l-4 ${c(p?.color)[2]} border-y border-r ${BD} bg-slate-900 p-3 hover:bg-slate-800/70`}>
      <div className="flex items-start justify-between gap-2">
        <h4 className={`text-sm font-semibold leading-tight ${W}`}>{o.customer}</h4>
        <span className={`shrink-0 font-mono text-xs ${M}`}>{cash(o.amount)}</span>
      </div>
      <p className={`mt-0.5 truncate text-xs ${M}`}>{o.productName}</p>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        {o.status === "done"
          ? <CheckCircle2 className="h-3 w-3 text-emerald-400" />
          : bad ? <AlertTriangle className="h-3 w-3 text-rose-400" /> : <Clock className={`h-3 w-3 ${F}`} />}
        <Stopwatch startedAt={o.receivedAt} stoppedAt={o.completedAt} target={tgt} />
        {tgt && <span className={F}>of {Math.round(tgt / HOUR)}h</span>}
        {!!list.length && <span className={`ml-auto font-mono ${did === list.length ? "text-emerald-400" : F}`}>{did}/{list.length}</span>}
      </div>

      {!!list.length && <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full ${did === list.length ? "bg-emerald-500" : c(p?.color)[0]}`} style={{ width: `${(did / list.length) * 100}%` }} />
      </div>}

      {o.assignee && o.assignee !== "Unassigned" &&
        <div className={`mt-2 inline-flex items-center gap-1 text-xs ${F}`}><User className="h-3 w-3" />{o.assignee}</div>}
    </article>
  );
}

/* ═════ NEW ORDERS ═════ */
function InboxList({ rows, products, now, onOpen }) {
  return (
    <div className={`overflow-hidden rounded-xl border ${BD}`}>
      <div className={`border-b ${BD} bg-slate-900 px-4 py-3`}>
        <h3 className={`text-sm font-semibold ${W}`}>Every payment, newest first</h3>
        <p className={`text-xs ${F}`}>Declined charges stay here so nobody works an order that never paid.</p>
      </div>
      {!rows.length && <p className={`px-4 py-8 text-sm ${M}`}>No payments yet. Run a sync, or load samples from the Admin Console.</p>}
      <div className="divide-y divide-slate-800">
        {rows.map((o) => {
          const p = products.find((x) => x.id === o.productId);
          return (
            <button key={o.id} onClick={() => onOpen(o.id)} className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-slate-900">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${c(p?.color)[0]}`} />
              <div className="min-w-[160px] flex-1">
                <div className={`text-sm font-medium ${W}`}>{o.customer}</div>
                <div className={`text-xs ${F}`}>{o.productName}{freq(o) ? ` · ${freq(o)}` : ""}</div>
              </div>
              <span className={`font-mono text-sm ${M}`}>{cash(o.amount)}</span>
              {paidOk(o)
                ? <span className={`rounded px-1.5 py-0.5 text-xs ${c(p?.color)[1]}`}>{sm(o.status)[1]}</span>
                : <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-xs text-rose-300" title={o.declineReason}>Declined</span>}
              <span className="w-28 text-right">
                {paidOk(o) && <Stopwatch startedAt={o.receivedAt} stoppedAt={o.completedAt} target={target(products, o)} />}
              </span>
              <span className={`w-40 truncate text-right text-xs ${F}`}>{new Date(o.receivedAt).toLocaleString()}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ═════ ORDER DETAIL ═════ */
function Drawer({ o, products, now, me, people, onClose, onPatch, onMove }) {
  const p = products.find((x) => x.id === o.productId);
  const list = steps(products, o), did = doneCount(o, list), tgt = target(products, o);
  const [notes, setNotes] = useState(o.notes || "");
  useEffect(() => setNotes(o.notes || ""), [o.id]);

  useEffect(() => {
    const k = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const Row = ({ label, children }) => children ? <div className="flex gap-3 py-1 text-sm">
    <span className={`w-32 shrink-0 ${F}`}>{label}</span><span className="min-w-0 break-words text-slate-300">{children}</span>
  </div> : null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/70" onClick={onClose}>
      <aside className={`h-full w-full max-w-xl overflow-y-auto border-l ${BD} bg-slate-950 shadow-2xl`} onClick={(e) => e.stopPropagation()}>
        <div className={`sticky top-0 flex items-start gap-3 border-b ${BD} bg-slate-950/95 px-5 py-4 backdrop-blur`}>
          <span className={`mt-1.5 h-3 w-3 shrink-0 rounded-full ${c(p?.color)[0]}`} />
          <div className="min-w-0 flex-1">
            <h2 className={`truncate text-base font-bold ${W}`}>{o.customer}</h2>
            <p className={`truncate text-sm ${M}`}>{o.productName}{freq(o) ? ` · ${freq(o)}` : ""}</p>
          </div>
          <button onClick={onClose} className={`rounded-md p-1.5 ${F} hover:bg-slate-800 hover:text-white`}><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-5 px-5 py-5">
          {!paidOk(o) && <div className="rounded-lg border-l-4 border-rose-500 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
            <strong>This payment was declined.</strong>{o.declineReason ? ` ${o.declineReason}` : ""}
            {o.declineCode && <span className={`ml-1 font-mono text-xs ${F}`}>({o.declineCode})</span>}
            <p className="mt-1 text-rose-300/80">Don't fulfill until the customer pays.</p>
          </div>}

          <div className={`${CARD} p-4`}>
            <div className="flex items-baseline justify-between gap-3">
              <L>{o.status === "done" ? "Time to fulfill" : "Running since payment"}</L>
              {tgt && <span className={`text-xs ${F}`}>target {Math.round(tgt / HOUR)}h</span>}
            </div>
            <div className="mt-1">
              <Stopwatch startedAt={o.receivedAt} stoppedAt={o.completedAt} target={tgt} size="lg" />
            </div>
            <p className={`mt-1 text-xs ${F}`}>
              Started {new Date(o.receivedAt).toLocaleString()}
              {o.completedAt ? ` · stopped ${new Date(o.completedAt).toLocaleString()}` : ""}
            </p>
            {o.status !== "done"
              ? <button onClick={() => onMove(o.id, "done")} className={`mt-3 w-full ${PRI}`}>Mark delivered — stop the clock</button>
              : <button onClick={() => onMove(o.id, "new")} className={`mt-3 w-full ${BTN}`}>Reopen and restart the clock</button>}
          </div>

          <div>
            <L className="mb-2">Status</L>
            <div className="flex flex-wrap gap-1.5">
              {ST.map(([id, label]) => (
                <button key={id} onClick={() => onMove(o.id, id)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${(o.status || "new") === id ? "bg-blue-600 text-white" : `border border-slate-700 bg-slate-900 ${M} hover:bg-slate-800`}`}>{label}</button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <L>Fulfillment steps</L>
              {!!list.length && <span className={`font-mono text-xs ${did === list.length ? "text-emerald-400" : F}`}>{did}/{list.length}</span>}
            </div>
            {!list.length && <p className={`text-sm ${F}`}>No steps set for this product yet — add them in the Admin Console.</p>}
            <ul className="space-y-1">
              {list.map((s, i) => {
                const on = !!o.checklist?.[i];
                return (
                  <li key={i}>
                    <button onClick={() => onPatch(o.id, (x) => ({ checklist: { ...x.checklist, [i]: !on } }))}
                      className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-900 ${on ? F : "text-slate-300"}`}>
                      {on ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" /> : <Circle className={`mt-0.5 h-4 w-4 shrink-0 ${F}`} />}
                      <span className={on ? "line-through" : ""}>{s}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {!!list.length && did === list.length && o.status !== "done" &&
              <p className="mt-3 text-sm text-emerald-400">Every step is done — stop the clock above.</p>}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Owner">
              <input value={o.assignee === "Unassigned" ? "" : o.assignee || ""} list="desk-people"
                onChange={(e) => onPatch(o.id, { assignee: e.target.value || "Unassigned" })}
                placeholder="Unassigned" className={IN} />
            </Field>
            <div className="flex items-end">
              {me && o.assignee !== me && <button onClick={() => onPatch(o.id, { assignee: me }, "Claimed")} className={`${BTN} w-full`}>Claim for {me}</button>}
            </div>
          </div>

          <Field label="Notes" hint="Saved when you click away.">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4}
              onBlur={() => notes !== (o.notes || "") && onPatch(o.id, { notes }, "Notes saved")}
              placeholder="What's holding this up, what the client asked for…" className={IN} />
          </Field>

          <div className={`${CARD} p-4`}>
            <h3 className={`mb-2 flex items-center gap-2 text-sm font-semibold ${W}`}><User className="h-4 w-4 text-blue-400" /> Customer</h3>
            <Row label="Email">{o.email && <a href={`mailto:${o.email}`} className="text-blue-400 hover:underline">{o.email}</a>}</Row>
            <Row label="Phone">{o.phone && <a href={`tel:${o.phone}`} className="text-blue-400 hover:underline">{o.phone}</a>}</Row>
            <Row label="Customer ID"><span className="font-mono text-xs">{o.customerId}</span></Row>
            {(o.email || o.phone) && <div className="mt-3 flex gap-2">
              {o.email && <a href={`mailto:${o.email}`} className={`inline-flex items-center gap-1.5 ${BTN}`}><Mail className="h-4 w-4" /> Email</a>}
              {o.phone && <a href={`tel:${o.phone}`} className={`inline-flex items-center gap-1.5 ${BTN}`}><Phone className="h-4 w-4" /> Call</a>}
            </div>}
          </div>

          <div className={`${CARD} p-4`}>
            <h3 className={`mb-2 flex items-center gap-2 text-sm font-semibold ${W}`}><CreditCard className="h-4 w-4 text-blue-400" /> Payment</h3>
            <Row label="Amount">{o.amount != null && `${cash(o.amount)} ${o.currency || ""}`}</Row>
            <Row label="Paid">{new Date(o.receivedAt).toLocaleString()}</Row>
            <Row label="Card">{[o.cardBrand, o.cardLast4 && `•••• ${o.cardLast4}`, o.cardExp].filter(Boolean).join(" ")}</Row>
            <Row label="Payment ID"><span className="font-mono text-xs">{o.paymentId}</span></Row>
            <Row label="Charge ID"><span className="font-mono text-xs">{o.chargeId}</span></Row>
            <Row label="Subscription"><span className="font-mono text-xs">{o.subscriptionId}</span></Row>
            <Row label="Invoice"><span className="font-mono text-xs">{o.invoiceId}</span></Row>
            <Row label="Price ID"><span className="font-mono text-xs">{o.stripePriceId}</span></Row>
            {o.receiptUrl && <a href={o.receiptUrl} target="_blank" rel="noreferrer"
              className={`mt-3 inline-flex items-center gap-1.5 ${BTN}`}><Receipt className="h-4 w-4" /> Receipt</a>}
          </div>

          {!!(o.items || []).length && <div className={`${CARD} p-4`}>
            <h3 className={`mb-2 text-sm font-semibold ${W}`}>Line items</h3>
            {o.items.map((i, k) => (
              <div key={k} className="flex justify-between py-1 text-sm">
                <span className="text-slate-300">{i.quantity || 1}× {i.description || "—"}</span>
                <span className={`font-mono ${M}`}>{cash(i.amount)}</span>
              </div>
            ))}
          </div>}
        </div>
      </aside>
    </div>
  );
}
