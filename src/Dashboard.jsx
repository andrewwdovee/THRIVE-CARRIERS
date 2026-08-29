import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  RefreshCw, Inbox, Clock, AlertTriangle, X, Mail, Phone,
  CreditCard, Receipt, CheckCircle2, Bell, BellOff, RotateCcw, User, PackageOpen, Wallet,
  Package, BarChart3, Settings as GearIcon, Layers, LogOut, Undo2,
} from "lucide-react";
import {
  BD, CARD, IN, BTN, PRI, M, F, W, c, ST, sm, MISS, mm, SETTLED, DEF, DAY,
  paidOk, cash, freq, L, Field, HOUR, dk, grab, dueOf, effHours, blockedBy, satOf,
} from "./lib/shared";
import { useBoard, appendOrders } from "./lib/useBoard";
import { pullStripe, relayHealth, syncEndpoint } from "./lib/sync";
import { buildSamples } from "./lib/samples";
import { chime, desktop, askPermission, hook } from "./lib/notify";
import { Stopwatch } from "./components/Elapsed";
import ByProduct from "./views/ByProduct";
import { Reports, Products, Settings as SettingsView } from "./views/admin";
import Refunds from "./views/Refunds";
import Wallets from "./views/Wallets";

/* The dashboard.

   Eight sections over one record, in two groups. The first four are today's
   work — what's owed, what didn't pay, what went back out, what's finished.
   The rest is the standing picture: each product's pipeline, what you sell,
   how it's selling, and how it's all wired to Stripe.

   The day's work first, then the things you set up and look back on. The
   marker is a tab id rather than a position, so moving a tab can't leave the
   divider stranded in the middle of a group. */
const TABS = [
  ["inbox", "New orders", Inbox],
  ["missed", "Missed payments", CreditCard],
  ["refunds", "Refunds", Undo2],
  ["completed", "Completed", CheckCircle2],
  ["wallets", "Wallets", Wallet],
  ["products-view", "By product", Layers],
  ["catalog", "Products", Package],
  ["reports", "Reports", BarChart3],
  ["settings", "Settings", GearIcon],
];
const DIVIDE_BEFORE = "products-view";
const WORK = new Set(["inbox", "missed", "completed", "products-view"]);

/* New orders leads with whatever is worst overdue, because that's the one
   someone needs to pick up. Flip it to see what just landed. */
const SORTS = [
  ["urgent", "Most overdue"],
  ["newest", "Latest in"],
];

/* Past due means "someone owes this customer work and the clock ran out".
   A declined payment is neither — it's chased, not fulfilled — so it never
   turns red on the strength of its age. */
const late = (o, now) => paidOk(o) && o.status !== "done" && o.dueAt && o.dueAt < now;
const target = (products, o, settings) =>
  effHours(products.find((x) => x.id === o.productId), settings) * HOUR;

export default function Dashboard({ me: account, onSignOut }) {
  const { st, loading, err, load, commit: rawCommit, R } = useBoard();
  const [tab, setTab] = useState(() => {
    const t = new URLSearchParams(window.location.hash.split("?")[1] || "").get("tab");
    return TABS.some(([id]) => id === t) ? t : "inbox";
  });
  const [sortBy, setSortBy] = useState("urgent");
  const [live, setLive] = useState(false);
  const [mine, setMine] = useState("");
  const [open, setOpen] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [toast, setToast] = useState(null);
  const [sync, setSync] = useState({ busy: false, error: null, at: null, added: 0 });
  const [perm, setPerm] = useState(typeof Notification !== "undefined" ? Notification.permission : "unsupported");

  const cfg = { ...DEF, ...(st.settings || {}) };
  const { products } = st;

  /* Deadlines are computed here, not read off the record, so changing the
     past-due rule re-dates every order already on the board. Everything
     downstream — the lists, By product, Reports, the CSV — reads this. */
  const orders = useMemo(
    () => st.orders
      /* Hidden, not deleted: switching a rule off brings these straight back.
         One place, so the lists, By product, Reports and the CSV all agree
         about what is on the board. */
      .filter((o) => !blockedBy(o, st.blocks))
      .map((o) => ({ ...o, dueAt: dueOf(o, products, cfg) })),
    [st.orders, st.blocks, products, cfg.pastDueHours],
  );
  /* What the rules are currently hiding, so Settings can show it rather than
     leaving someone to wonder where an order went. */
  const hidden = useMemo(
    () => st.orders.filter((o) => blockedBy(o, st.blocks)),
    [st.orders, st.blocks],
  );

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 3e4); return () => clearInterval(t); }, []);
  /* Keep the tab in the URL so a second window can open straight to one,
     and follow the URL when it changes underneath us. */
  useEffect(() => {
    const next = `#/?tab=${tab}`;
    if (window.location.hash !== next) window.history.replaceState(null, "", next);
  }, [tab]);
  useEffect(() => {
    const on = () => {
      const t = new URLSearchParams(window.location.hash.split("?")[1] || "").get("tab");
      if (t && TABS.some(([id]) => id === t)) setTab(t);
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const flash = useCallback((m) => { setToast(m); setTimeout(() => setToast(null), 2600); }, []);
  const commit = useCallback((fn, note) => rawCommit(fn, note, flash), [rawCommit, flash]);

  /* ── who is at this desk ──
     Whoever signed in. There is no second place to type a name: two answers
     to "who are you" is one more than the question has. */
  useEffect(() => setMine(account?.name || account?.email || ""), [account]);

  /* ── alerts ──
     `seen` is primed on the first load so opening the dashboard doesn't fire a
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

  /* A failed payment is the alert that actually saves money: until someone
     switches the service off, it keeps running on your spend. Separate from
     the new-order chime so it can't be mistaken for good news. */
  const seenMissed = useRef(null);
  useEffect(() => {
    if (loading) return;
    const failed = orders.filter((o) => !paidOk(o));
    const ids = new Set(failed.map((o) => o.id));
    if (seenMissed.current === null) { seenMissed.current = ids; return; }
    const fresh = failed.filter((o) => !seenMissed.current.has(o.id));
    seenMissed.current = ids;
    if (!fresh.length) return;
    const one = fresh[0];
    const title = fresh.length === 1
      ? `Payment failed — ${one.productName}`
      : `${fresh.length} payments failed`;
    const body = fresh.length === 1
      ? `${one.customer} · ${cash(one.amount)}${one.declineReason ? ` · ${one.declineReason}` : ""} — stop the service`
      : fresh.map((o) => o.customer).join(", ");
    if (cfg.notifySound) chime();
    if (cfg.notifyBrowser) desktop(title, body);
    hook(cfg.notifyWebhook, {
      event: "payment.failed", title, body, email: cfg.notifyEmail, phone: cfg.notifyPhone,
      orders: fresh.map((o) => ({
        id: o.id, customer: o.customer, email: o.email, phone: o.phone,
        product: o.productName, amount: o.amount, currency: o.currency,
        declineCode: o.declineCode, declineReason: o.declineReason,
        subscriptionId: o.subscriptionId,
      })),
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

  const saveCfg = (patch) => commit((x) => ({ ...x, settings: { ...DEF, ...(x.settings || {}), ...patch } }));
  const addOrders = useCallback((drafts) => { commit((x) => appendOrders(x, drafts).next); }, [commit]);

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

  const settle = useCallback((id, recovery) => {
    patch(id, () => ({
      recovery,
      // Stop the clock once there's nothing left to do about it.
      stoppedAt: SETTLED.has(recovery) ? Date.now() : null,
    }), `Marked ${mm(recovery)[1].toLowerCase()}`);
  }, [patch]);

  const runSync = useCallback(async (opts) => {
    const s = { ...DEF, ...(R.current.settings || {}) };
    if (!syncEndpoint(s)) { setSync((p) => ({ ...p, busy: false, error: "No sync endpoint set — add one under Settings." })); return; }
    if (!opts?.quiet) setSync((p) => ({ ...p, busy: true, error: null }));
    try {
      const drafts = await pullStripe(s, R.current.orders, R.current.products, { backfill: opts?.backfill });
      let n = 0;
      await rawCommit((x) => { const r = appendOrders(x, drafts); n = r.added.length; return r.next; });
      setSync({ busy: false, error: null, at: Date.now(), added: n });
      if (!opts?.quiet || n) flash(n ? `${n} new order${n === 1 ? "" : "s"}` : "Up to date");
    } catch (e) {
      // A background check that fails shouldn't paint a banner over the board.
      if (opts?.quiet) return;
      setSync({ busy: false, at: Date.now(), added: 0, error: `Couldn't reach the sync endpoint. ${e.message}` });
    }
  }, [rawCommit, R, flash]);

  /* Ask the relay whether Stripe is pushing to it. If it is, checking is a
     cheap read and we can do it every few seconds; if we're still polling
     Stripe ourselves, stick to the interval in Settings. */
  useEffect(() => {
    let gone = false;
    if (!syncEndpoint(cfg)) { setLive(false); return; }
    relayHealth({ ...DEF, ...(R.current.settings || {}) }).then((h) => { if (!gone) setLive(!!h?.webhook); });
    return () => { gone = true; };
  }, [cfg.syncUrl, R]);

  useEffect(() => {
    if (!syncEndpoint(cfg)) return;
    const every = live ? 15e3 : Math.max(1, Number(cfg.autoSyncMinutes) || 5) * 6e4;
    const t = setInterval(() => { if (!document.hidden) runSync({ quiet: true }); }, every);
    return () => clearInterval(t);
  }, [cfg.syncUrl, cfg.autoSyncMinutes, live, runSync]);

  const loadSamples = useCallback(() => {
    commit((x) => appendOrders(x, buildSamples(x.products)).next, "Sample orders loaded");
  }, [commit]);

  /* ── what each view shows ── */
  /* By product drops long-delivered orders so the groups stay readable;
     Completed keeps every one of them. */
  const grouped = useMemo(() => {
    const cut = now - Math.max(1, Number(cfg.archiveAfterDays) || 14) * DAY;
    return orders.filter((o) => paidOk(o) && !(o.status === "done" && (o.completedAt || 0) < cut));
  }, [orders, now, cfg.archiveAfterDays]);

  /* New orders is everything still outstanding — a delivered order moves to
     Completed and stops cluttering the list someone works from. A declined
     payment stays put: it's unfinished business, not finished work. */
  const inbox = useMemo(() => {
    const rows = orders.filter((o) => o.status !== "done" && paidOk(o));
    if (sortBy === "newest") return rows.sort((x, y) => y.receivedAt - x.receivedAt);
    // Furthest past its target first; among orders still inside their target,
    // the one closest to blowing it.
    return rows.sort((x, y) => (x.dueAt || Infinity) - (y.dueAt || Infinity));
  }, [orders, sortBy]);

  /* Payments that failed and still have something running behind them. Once
     the service is stopped — or the money turns up — there's nothing left to
     do, so it files into Completed with everything else that's finished. */
  const settledOf = (o) => !paidOk(o) && SETTLED.has(o.recovery || "open");
  const missed = useMemo(() => orders.filter((o) => !paidOk(o) && !SETTLED.has(o.recovery || "open"))
    .sort((x, y) => y.receivedAt - x.receivedAt), [orders]);
  const bleeding = missed.length;
  /* A charge whose product we don't recognise still has to be worked, but it
     arrives with no target and no steps — worth saying out loud. */
  const unmapped = useMemo(() => orders.filter((o) => paidOk(o) && !o.productId && o.status !== "done"), [orders]);

  /* Stripe-reported refunds are derived from the charge itself, so a re-sync
     can't duplicate them; anything settled outside Stripe is a record of its
     own. The reason for a Stripe one lives on the order it came from. */
  const refunds = useMemo(() => {
    const fromStripe = orders.filter((o) => o.refunded).map((o) => ({
      id: `rf_${o.id}`, source: "stripe", orderId: o.id,
      productId: o.productId, productName: o.productName,
      customer: o.customer, email: o.email,
      amount: o.amountRefunded ?? o.amount, currency: o.currency,
      at: o.refundedAt || o.receivedAt,
      typeId: o.refundTypeId || "", note: o.refundNote || "",
      steps: o.refundSteps || {}, chargeId: o.chargeId,
    }));
    return [...fromStripe, ...(st.refunds || [])].sort((a, b) => b.at - a.at);
  }, [orders, st.refunds]);

  /* One record per person per week: entering the same Saturday twice
     corrects the figure rather than adding a second nobody can see. */
  const recordWipes = useCallback((made, week) => {
    commit((x) => {
      const ids = new Set(made.map((w) => w.userId));
      const kept = (x.wipes || []).filter((w) => !(satOf(w.at) === week && ids.has(w.userId)));
      return { ...x, wipes: [...made, ...kept] };
    }, made.length === 1 ? "Wipe recorded" : `${made.length} wipes recorded`);
  }, [commit]);
  const removeWipe = useCallback((id) => {
    commit((x) => ({ ...x, wipes: (x.wipes || []).filter((w) => w.id !== id) }), "Figure removed");
  }, [commit]);

  const addCustomer = useCallback((cst) => {
    commit((x) => ({ ...x, customers: [...(x.customers || []), cst] }), "Customer added");
  }, [commit]);
  const recordRefund = useCallback((r) => {
    commit((x) => ({ ...x, refunds: [{ ...r, source: "manual" }, ...(x.refunds || [])] }), "Refund recorded");
  }, [commit]);
  const removeRefund = useCallback((id) => {
    commit((x) => ({ ...x, refunds: (x.refunds || []).filter((r) => r.id !== id) }), "Record removed");
  }, [commit]);
  /* A Stripe refund's amount isn't ours to change — only what we file it as
     and how far through the steps we are. Those live on the order it came from. */
  const annotateRefund = useCallback((r, patchIn) => {
    commit((x) => ({ ...x, orders: x.orders.map((o) => (o.id === r.orderId
      ? { ...o, refundTypeId: patchIn.typeId, refundNote: patchIn.note, refundSteps: patchIn.steps } : o)) }), "Refund saved");
  }, [commit]);
  const updateRefund = useCallback((r) => {
    commit((x) => ({ ...x, refunds: (x.refunds || []).map((y) => (y.id === r.id ? { ...y, ...r } : y)) }), "Refund saved");
  }, [commit]);

  const completed = useMemo(() => orders
    .filter((o) => (paidOk(o) && o.status === "done") || (!paidOk(o) && SETTLED.has(o.recovery || "open")))
    .sort((x, y) => ((y.completedAt || y.stoppedAt || 0) - (x.completedAt || x.stoppedAt || 0))), [orders]);
  const overdue = orders.filter((o) => paidOk(o) && late(o, now)).length;
  const openOrder = open ? orders.find((o) => o.id === open) : null;
  const people = useMemo(() => [...new Set(orders.map((o) => o.assignee).filter((a) => a && a !== "Unassigned"))], [orders]);

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-slate-100 dark:bg-slate-950 text-slate-600 dark:text-slate-400">
    <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Loading…</div>;

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 text-slate-800 dark:text-slate-200">
      <header className={`sticky top-0 z-20 border-b ${BD} bg-white/95 dark:bg-slate-950/95 backdrop-blur`}>
        <div className="mx-auto max-w-[1600px] px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <h1 className={`text-lg font-bold tracking-tight ${W}`}>Lead Tech Fulfillment</h1>
              <L>{orders.filter((o) => paidOk(o) && o.status !== "done").length} open
                {overdue > 0 && <span className="text-rose-600 dark:text-rose-400"> · {overdue} past due</span>}
                {bleeding > 0 && <span className="text-amber-600 dark:text-amber-400"> · {bleeding} unpaid</span>}
              </L>
            </div>

            <datalist id="desk-people">{people.map((p) => <option key={p} value={p} />)}</datalist>
            <div className="ml-auto" />

            {perm !== "granted" && perm !== "unsupported" && (
              <button onClick={async () => setPerm(await askPermission())} className={`inline-flex items-center gap-1.5 ${BTN}`} title="Allow desktop alerts">
                <BellOff className="h-4 w-4" /> Alerts off
              </button>
            )}
            {perm === "granted" && <span className={`inline-flex items-center gap-1.5 text-xs ${F}`}><Bell className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> Alerts on</span>}

            <button onClick={() => runSync({ backfill: true })} disabled={sync.busy} className={`inline-flex items-center gap-1.5 ${PRI} disabled:opacity-60`}>
              <RefreshCw className={`h-4 w-4 ${sync.busy ? "animate-spin" : ""}`} />{sync.busy ? "Syncing" : "Sync"}
            </button>
            <button onClick={() => load(false)} className={BTN} title="Refresh"><RotateCcw className="h-4 w-4" /></button>
            {onSignOut && <button onClick={onSignOut} className={BTN} title={account ? `Sign out ${account.name || account.email}` : "Sign out"}>
              <LogOut className="h-4 w-4" />
            </button>}
          </div>

          <nav className="mt-3 flex flex-wrap items-center gap-1">
            {TABS.map(([id, label, Icon], i) => (
              <React.Fragment key={id}>
                {id === DIVIDE_BEFORE && <span className="mx-2 hidden h-5 w-px bg-slate-200 dark:bg-slate-800 sm:block" aria-hidden />}
                <button onClick={() => setTab(id)}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium ${tab === id ? "bg-blue-600 text-slate-900 dark:text-white" : `${M} hover:bg-slate-200 dark:hover:bg-slate-800`}`}>
                  <Icon className="h-4 w-4" />{label}
                </button>
              </React.Fragment>
            ))}
          </nav>
        </div>
        {err && <div className="border-t border-rose-300 dark:border-rose-900 bg-rose-100 dark:bg-rose-950/50 px-4 py-2 text-sm text-rose-800 dark:text-rose-200">{err}</div>}
        {sync.error && <div className="border-t border-amber-300 dark:border-amber-900 bg-amber-100 dark:bg-amber-950/40 px-4 py-2 text-sm text-amber-800 dark:text-amber-200">{sync.error}</div>}
      </header>

      <main className="mx-auto max-w-[1600px] px-4 py-5">
        {tab === "inbox" && !!unmapped.length && (
          <div className={`mb-3 rounded-xl border-l-4 border-amber-500 border-y border-r ${BD} bg-white dark:bg-slate-900 px-4 py-3`}>
            <h3 className={`text-sm font-semibold ${W}`}>
              {unmapped.length} order{unmapped.length === 1 ? "" : "s"} didn't match a product
            </h3>
            <p className={`mt-0.5 text-sm ${M}`}>
              They're on the board with no turnaround target and no fulfillment steps.{" "}
              <button onClick={() => setTab("catalog")} className="text-blue-600 dark:text-blue-400 hover:underline">
                Add their Stripe price or product ID under Products
              </button>{" "}
              and they'll sort themselves out.
            </p>
          </div>
        )}

        {WORK.has(tab) && !orders.length
          ? <FirstRun hasSync={!!syncEndpoint(cfg)} onSync={runSync} onSamples={loadSamples} onAddProducts={() => setTab("catalog")} />
          : tab === "inbox"
            ? <OrderList rows={inbox} products={products} now={now} onOpen={setOpen}
                sortBy={sortBy} onSort={setSortBy} settings={cfg}
                title="Still to fulfill" note="Most overdue first. A delivered order moves to Completed."
                empty="Nothing outstanding — everything that came in has been delivered." />
          : tab === "missed"
            ? <MissedList rows={missed} products={products} now={now} onOpen={setOpen} settings={cfg} />
          : tab === "refunds"
            ? <Refunds refunds={refunds} products={products} orders={orders}
                refundTypes={st.refundTypes} customers={st.customers} onAddCustomer={addCustomer}
                onRecord={recordRefund} onRemove={removeRefund}
                onAnnotate={annotateRefund} onUpdate={updateRefund}
                onSetUp={() => setTab("catalog")} />
          : tab === "completed"
            ? <OrderList rows={completed} products={products} now={now} onOpen={setOpen} done settings={cfg}
                title="Delivered" note="Delivered orders and settled failed payments, newest first."
                empty="Nothing delivered yet. Orders land here once someone stops the clock." />
          : tab === "wallets"
            ? <Wallets customers={st.customers} wipes={st.wipes} n={now}
                onRecord={recordWipes} onRemove={removeWipe} onAddCustomer={addCustomer} />
          : tab === "products-view" ? <ByProduct products={products} orders={grouped} now={now} onOpen={setOpen} onMove={move} Card={Card} settings={cfg} />
          : tab === "catalog" ? <Products products={products} orders={orders} commit={commit} house={cfg.pastDueHours}
                refundTypes={st.refundTypes} refunds={refunds} />
          : tab === "reports" ? <Reports orders={orders} products={products} n={now} flash={flash}
                refunds={refunds} refundTypes={st.refundTypes}
                customers={st.customers} wipes={st.wipes} />
          : <SettingsView cfg={cfg} products={products} orders={orders} customers={st.customers} blocks={st.blocks} hidden={hidden} saveCfg={saveCfg} commit={commit}
              sync={{ busy: sync.busy, at: sync.at, error: sync.error, added: sync.added }}
              onSync={() => runSync({ backfill: true })} addOrders={addOrders} flash={flash} live={syncEndpoint(cfg) ? live : null} />}
      </main>

      {openOrder && <Drawer o={openOrder} products={products} now={now} me={mine} people={people}
        onClose={() => setOpen(null)} onPatch={patch} onMove={move} onSettle={settle} settings={cfg} />}

      {toast && <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-slate-200 dark:bg-slate-800 px-4 py-2 text-sm text-slate-900 dark:text-white shadow-xl">{toast}</div>}
    </div>
  );
}

/* Four empty columns tell a new user nothing. Say where orders come from. */
function FirstRun({ hasSync, onSync, onSamples, onAddProducts }) {
  return (
    <div className={`mx-auto max-w-lg ${CARD} px-6 py-10 text-center`}>
      <PackageOpen className={`mx-auto h-8 w-8 ${F}`} />
      <h2 className={`mt-3 text-base font-semibold ${W}`}>No orders yet</h2>
      <p className={`mx-auto mt-2 max-w-sm text-sm ${M}`}>
        Orders arrive on their own once Stripe is connected under Settings.
        Until then, load a dozen fake ones to see how it all works.
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        <button onClick={onSamples} className={PRI}>Load sample orders</button>
        {hasSync && <button onClick={onSync} className={BTN}>Check Stripe now</button>}
        <button onClick={onAddProducts} className={BTN}>Set up products</button>
      </div>
    </div>
  );
}

/* ═════ ONE ORDER ═════ */
function Card({ o, products, now, onOpen, hideProduct, settings }) {
  const p = products.find((x) => x.id === o.productId);
  const bad = late(o, now), tgt = target(products, o, settings);
  return (
    <article draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", o.id)}
      onClick={() => onOpen(o.id)}
      className={`cursor-pointer rounded-lg border-l-4 ${c(p?.color)[2]} border-y border-r ${BD} bg-white dark:bg-slate-900 p-3 hover:bg-slate-200/70 dark:hover:bg-slate-800/70`}>
      <div className="flex items-start justify-between gap-2">
        <h4 className={`text-sm font-semibold leading-tight ${W}`}>{o.customer}</h4>
        <span className={`shrink-0 font-mono text-xs ${M}`}>{cash(o.amount)}</span>
      </div>
      {!hideProduct && <p className={`mt-0.5 truncate text-xs ${M}`}>{o.productName}</p>}

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        {o.status === "done"
          ? <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
          : bad ? <AlertTriangle className="h-3 w-3 text-rose-600 dark:text-rose-400" /> : <Clock className={`h-3 w-3 ${F}`} />}
        <Stopwatch startedAt={o.receivedAt} stoppedAt={o.completedAt} target={tgt} />
        {tgt && <span className={F}>of {Math.round(tgt / HOUR)}h</span>}
      </div>


      {o.assignee && o.assignee !== "Unassigned" &&
        <div className={`mt-2 inline-flex items-center gap-1 text-xs ${F}`}><User className="h-3 w-3" />{o.assignee}</div>}
    </article>
  );
}

/* ═════ THE ORDER LISTS ═════ */

/* New orders and Completed are the same table with different contents, so
   they're one component. The columns earn their place: who it's for, what
   they bought, what it cost, who owns it, and the clock. */
function OrderList({ rows, products, now, onOpen, sortBy, onSort, done, title, note, empty, settings }) {
  return (
    <div className={`overflow-hidden rounded-xl border ${BD}`}>
      <div className={`flex flex-wrap items-center gap-3 border-b ${BD} bg-white dark:bg-slate-900 px-4 py-3`}>
        <div>
          <h3 className={`flex items-center gap-2 text-sm font-semibold ${W}`}>
            {title}
            <span className={`rounded bg-slate-200 dark:bg-slate-800 px-1.5 py-0.5 font-mono text-xs ${M}`}>{rows.length}</span>
          </h3>
          <p className={`text-xs ${F}`}>{note}</p>
        </div>
        {onSort && (
          <div className={`ml-auto flex shrink-0 gap-1 rounded-lg border ${BD} bg-slate-100 dark:bg-slate-950 p-1`}>
            {SORTS.map(([id, label]) => (
              <button key={id} onClick={() => onSort(id)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium ${sortBy === id ? "bg-blue-600 text-slate-900 dark:text-white" : `${M} hover:bg-slate-200 dark:hover:bg-slate-800`}`}>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {!rows.length && <p className={`px-4 py-8 text-sm ${M}`}>{empty}</p>}

      <div className="divide-y divide-slate-200 dark:divide-slate-800">
        {rows.map((o) => {
          const p = products.find((x) => x.id === o.productId);
          const tgt = target(products, o, settings);
          const bad = late(o, now);
          return (
            <button key={o.id} onClick={() => onOpen(o.id)}
              className={`flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-900 ${bad ? "bg-rose-50 dark:bg-rose-950/20" : ""}`}>
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${c(p?.color)[0]}`} />

              {/* What was bought leads; who bought it is the second line.
                  Someone scanning this list is deciding what work to pick up. */}
              <div className="min-w-[170px] flex-1">
                <div className={`truncate text-sm font-semibold ${W}`}>
                  {o.productName}{freq(o) ? <span className={`font-normal ${F}`}> · {freq(o)}</span> : null}
                </div>
                <div className={`flex items-center gap-1.5 truncate text-xs ${M}`}>
                  {o.renewal && <span className="rounded bg-slate-300/60 dark:bg-slate-700/60 px-1 py-px text-[10px] uppercase tracking-wide text-slate-700 dark:text-slate-300">Renewal</span>}
                  {!o.productId && <span className="rounded bg-amber-500/15 px-1 py-px text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-300">Unmapped</span>}
                  <span className="truncate">{o.customer}</span>
                </div>
              </div>

              <span className={`w-20 text-right font-mono text-sm ${M}`}>{cash(o.amount)}</span>

              <span className={`hidden w-32 truncate text-xs sm:block ${o.assignee && o.assignee !== "Unassigned" ? M : F}`}>
                {o.assignee && o.assignee !== "Unassigned" ? o.assignee : "Unassigned"}
              </span>

              {paidOk(o)
                ? <span className={`w-28 shrink-0 rounded px-1.5 py-0.5 text-center text-xs ${done ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : c(p?.color)[1]}`}>{sm(o.status)[1]}</span>
                : <span className="w-28 shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-center text-xs text-amber-700 dark:text-amber-300" title={o.declineReason}>
                    {mm(o.recovery || "open")[1]}
                  </span>}

              <span className="flex w-40 shrink-0 items-center justify-end gap-1.5">
                {bad && <AlertTriangle className="h-3 w-3 shrink-0 text-rose-600 dark:text-rose-400" />}
                <Stopwatch startedAt={o.receivedAt} stoppedAt={o.completedAt || o.stoppedAt} target={paidOk(o) ? tgt : null} />
                {tgt && paidOk(o) && <span className={`text-xs ${F}`}>of {Math.round(tgt / HOUR)}h</span>}
              </span>

              <span className={`hidden w-36 shrink-0 text-right text-xs md:block ${F}`}>
                {done && (o.completedAt || o.stoppedAt)
                  ? `done ${new Date(o.completedAt || o.stoppedAt).toLocaleDateString()}`
                  : new Date(o.receivedAt).toLocaleString()}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ═════ MISSED PAYMENTS ═════ */

/* Money going out with none coming in. The job here is the opposite of
   fulfillment: find what's still running on this customer's behalf and switch
   it off. The clock counts how long that's been true. */
/* Why the money stopped changes what she does about it: a decline can be
   retried, a cancellation cannot, and a dispute has a deadline attached. */
const why = (o) =>
  o.disputed ? ["Disputed", "bg-rose-500/15 text-rose-700 dark:text-rose-300"]
    : o.subscriptionStatus === "canceled" && !o.chargeId ? ["Cancelled", "bg-slate-500/20 dark:bg-slate-500/20 text-slate-700 dark:text-slate-300"]
      : null;

function MissedList({ rows, products, now, onOpen, settings }) {
  const live = rows.filter((o) => !SETTLED.has(o.recovery || "open"));
  return (
    <div className="space-y-3">
      <div className={`rounded-xl border-l-4 ${live.length ? "border-amber-500" : "border-slate-300 dark:border-slate-700"} border-y border-r ${BD} bg-white dark:bg-slate-900 px-4 py-3`}>
        <h3 className={`text-sm font-semibold ${W}`}>
          {live.length
            ? `${live.length} service${live.length === 1 ? "" : "s"} still running with nothing coming in`
            : "Nothing running unpaid"}
        </h3>
        <p className={`mt-0.5 text-sm ${M}`}>
          {live.length
            ? "Open each one and work the shutdown steps — every hour these stay on is spend you don't get back."
            : "Every stopped payment here has been dealt with."}
        </p>
      </div>

      <div className={`overflow-hidden rounded-xl border ${BD}`}>
        {!rows.length && <p className={`px-4 py-8 text-sm ${M}`}>Nothing to shut down. Stripe tells us the moment a payment bounces, a subscription is cancelled, or a charge is disputed.</p>}
        <div className="divide-y divide-slate-200 dark:divide-slate-800">
          {rows.map((o) => {
            const p = products.find((x) => x.id === o.productId);
            const settled = SETTLED.has(o.recovery || "open");
            return (
              <button key={o.id} onClick={() => onOpen(o.id)}
                className={`flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-900 ${settled ? "opacity-60" : "bg-amber-50 dark:bg-amber-950/15"}`}>
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${c(p?.color)[0]}`} />
                <div className="min-w-[170px] flex-1">
                  <div className={`flex items-center gap-1.5 text-sm font-semibold ${W}`}>
                    <span className="truncate">{o.productName}</span>
                    {freq(o) ? <span className={`shrink-0 font-normal ${F}`}>· {freq(o)}</span> : null}
                    {why(o) && <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${why(o)[1]}`}>{why(o)[0]}</span>}
                  </div>
                  <div className={`truncate text-xs ${M}`}>{o.customer}</div>
                </div>

                <span className={`w-20 text-right font-mono text-sm ${M}`}>{cash(o.amount)}</span>

                <span className={`hidden min-w-[150px] flex-1 truncate text-xs md:block ${F}`}
                  title={o.declineReason || o.declineCode}>
                  {o.declineReason || o.declineCode || "Payment declined"}
                </span>

                <span className={`w-36 shrink-0 rounded px-1.5 py-0.5 text-center text-xs ${
                  settled ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/15 text-amber-700 dark:text-amber-300"}`}>
                  {mm(o.recovery || "open")[1]}
                </span>


                <span className="flex w-32 shrink-0 items-center justify-end gap-1.5">
                  {!settled && <AlertTriangle className="h-3 w-3 shrink-0 text-amber-600 dark:text-amber-400" />}
                  <Stopwatch startedAt={o.receivedAt} stoppedAt={o.stoppedAt}
                    target={settled ? null : target(products, o, settings)} />
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ═════ ORDER DETAIL ═════ */
function Drawer({ o, products, now, me, people, onClose, onPatch, onMove, onSettle, settings }) {
  /* A failed payment gets a different job: shut things down, not build them. */
  const unpaid = !paidOk(o);
  const settled = SETTLED.has(o.recovery || "open");
  const p = products.find((x) => x.id === o.productId);
  const tgt = target(products, o, settings);
  const [notes, setNotes] = useState(o.notes || "");
  useEffect(() => setNotes(o.notes || ""), [o.id]);

  useEffect(() => {
    const k = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const Row = ({ label, children }) => children ? <div className="flex gap-3 py-1 text-sm">
    <span className={`w-32 shrink-0 ${F}`}>{label}</span><span className="min-w-0 break-words text-slate-700 dark:text-slate-300">{children}</span>
  </div> : null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 dark:bg-black/70" onClick={onClose}>
      <aside className={`h-full w-full max-w-xl overflow-y-auto border-l ${BD} bg-slate-100 dark:bg-slate-950 shadow-2xl`} onClick={(e) => e.stopPropagation()}>
        <div className={`sticky top-0 flex items-start gap-3 border-b ${BD} bg-white/95 dark:bg-slate-950/95 px-5 py-4 backdrop-blur`}>
          <span className={`mt-1.5 h-3 w-3 shrink-0 rounded-full ${c(p?.color)[0]}`} />
          <div className="min-w-0 flex-1">
            <h2 className={`truncate text-base font-bold ${W}`}>{o.customer}</h2>
            <p className={`truncate text-sm ${M}`}>{o.productName}{freq(o) ? ` · ${freq(o)}` : ""}</p>
          </div>
          <button onClick={onClose} className={`rounded-md p-1.5 ${F} hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white`}><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-5 px-5 py-5">
          {unpaid && <div className="rounded-lg border-l-4 border-rose-500 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
            <strong>This payment failed.</strong>{o.declineReason ? ` ${o.declineReason}` : ""}
            {o.declineCode && <span className={`ml-1 font-mono text-xs ${F}`}>({o.declineCode})</span>}
            <p className="mt-1 text-rose-300/80">
              {settled ? "Already dealt with." : "Switch the service off before it costs more, and don't fulfill anything new."}
            </p>
          </div>}

          {unpaid ? (
            <>
              <div className={`${CARD} p-4`}>
                <div className="flex items-baseline justify-between gap-3">
                  <L>{settled ? "Ran unpaid for" : "Running unpaid for"}</L>
                  {tgt && !settled && <span className={`text-xs ${F}`}>flagged at {Math.round(tgt / HOUR)}h</span>}
                </div>
                <div className="mt-1">
                  <Stopwatch startedAt={o.receivedAt} stoppedAt={o.stoppedAt} target={settled ? null : tgt} size="lg" />
                </div>
                <p className={`mt-1 text-xs ${F}`}>
                  Failed {new Date(o.receivedAt).toLocaleString()}
                  {o.stoppedAt ? ` · settled ${new Date(o.stoppedAt).toLocaleString()}` : ""}
                </p>
                {!settled && <button onClick={() => onSettle(o.id, "stopped")} className={`mt-3 w-full ${PRI}`}>
                  Service stopped — stop the clock
                </button>}
              </div>

              <div>
                <L className="mb-2">Where this is at</L>
                <div className="flex flex-wrap gap-1.5">
                  {MISS.map(([id, label]) => (
                    <button key={id} onClick={() => onSettle(o.id, id)}
                      className={`rounded-md px-3 py-1.5 text-sm font-medium ${(o.recovery || "open") === id ? "bg-blue-600 text-slate-900 dark:text-white" : `border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 ${M} hover:bg-slate-200 dark:hover:bg-slate-800`}`}>{label}</button>
                  ))}
                </div>
              </div>

            </>
          ) : (
            <>
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
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${(o.status || "new") === id ? "bg-blue-600 text-slate-900 dark:text-white" : `border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 ${M} hover:bg-slate-200 dark:hover:bg-slate-800`}`}>{label}</button>
              ))}
            </div>
          </div>

            </>
          )}

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
            <h3 className={`mb-2 flex items-center gap-2 text-sm font-semibold ${W}`}><User className="h-4 w-4 text-blue-600 dark:text-blue-400" /> Customer</h3>
            <Row label="Email">{o.email && <a href={`mailto:${o.email}`} className="text-blue-600 dark:text-blue-400 hover:underline">{o.email}</a>}</Row>
            <Row label="Phone">{o.phone && <a href={`tel:${o.phone}`} className="text-blue-600 dark:text-blue-400 hover:underline">{o.phone}</a>}</Row>
            <Row label="Customer ID"><span className="font-mono text-xs">{o.customerId}</span></Row>
            {(o.email || o.phone) && <div className="mt-3 flex gap-2">
              {o.email && <a href={`mailto:${o.email}`} className={`inline-flex items-center gap-1.5 ${BTN}`}><Mail className="h-4 w-4" /> Email</a>}
              {o.phone && <a href={`tel:${o.phone}`} className={`inline-flex items-center gap-1.5 ${BTN}`}><Phone className="h-4 w-4" /> Call</a>}
            </div>}
          </div>

          <div className={`${CARD} p-4`}>
            <h3 className={`mb-2 flex items-center gap-2 text-sm font-semibold ${W}`}><CreditCard className="h-4 w-4 text-blue-600 dark:text-blue-400" /> Payment</h3>
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
                <span className="text-slate-700 dark:text-slate-300">{i.quantity || 1}× {i.description || "—"}</span>
                <span className={`font-mono ${M}`}>{cash(i.amount)}</span>
              </div>
            ))}
          </div>}
        </div>
      </aside>
    </div>
  );
}
