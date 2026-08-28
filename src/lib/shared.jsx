import React, { useState, useEffect } from "react";
import { Trash2 } from "lucide-react";

/* Everything every screen needs.
   One storage key, one palette, one set of statuses — if these drift the
   two windows stop agreeing about what an order is. */

export const BD = "border-slate-200 dark:border-slate-800";
export const CARD = "rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900";
export const PANEL = "rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/70";
export const IN = "w-full rounded-md border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:border-blue-500 focus:outline-none";
export const BTN = "rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800";
export const PRI = "rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-slate-900 dark:text-white hover:bg-blue-500";
export const M = "text-slate-600 dark:text-slate-400", F = "text-slate-500", W = "text-slate-900 dark:text-white", TD = "px-4 py-2.5 font-mono";

export const P = {
  blue: ["bg-blue-500", "bg-blue-500/15 text-blue-700 dark:text-blue-300", "border-blue-500"],
  emerald: ["bg-emerald-500", "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", "border-emerald-500"],
  amber: ["bg-amber-500", "bg-amber-500/15 text-amber-700 dark:text-amber-300", "border-amber-500"],
  violet: ["bg-violet-500", "bg-violet-500/15 text-violet-700 dark:text-violet-300", "border-violet-500"],
  rose: ["bg-rose-500", "bg-rose-500/15 text-rose-700 dark:text-rose-300", "border-rose-500"],
  cyan: ["bg-cyan-500", "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300", "border-cyan-500"],
  orange: ["bg-orange-500", "bg-orange-500/15 text-orange-700 dark:text-orange-300", "border-orange-500"],
  fuchsia: ["bg-fuchsia-500", "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300", "border-fuchsia-500"],
  teal: ["bg-teal-500", "bg-teal-500/15 text-teal-700 dark:text-teal-300", "border-teal-500"],
  slate: ["bg-slate-500", "bg-slate-500/20 dark:bg-slate-500/20 text-slate-700 dark:text-slate-300", "border-slate-500"],
};
export const c = (k) => P[k] || P.slate;
export const ST = [["new", "New"], ["active", "In progress"], ["blocked", "Waiting on client"], ["done", "Delivered"]];
export const sm = (id) => ST.find((s) => s[0] === id) || ST[0];

/* A failed payment isn't fulfillment work — it's the opposite. Nothing gets
   built; something already running has to be switched off before it costs
   more money. So it carries its own set of states. */
export const MISS = [
  ["open", "Needs action"],
  ["contacted", "Client contacted"],
  ["stopped", "Service stopped"],
  ["recovered", "Payment recovered"],
];
export const mm = (id) => MISS.find((m) => m[0] === id) || MISS[0];
/* Both endings mean nobody has to do anything more: either the money came in,
   or the spending stopped. */
export const SETTLED = new Set(["stopped", "recovered"]);

/* The kinds of refund you give out, each with the steps to work through when
   you do. Same shape as a product: a name, a colour, and a checklist — because
   issuing a refund is a job with a procedure, not just a number to type in.
   Editable under Products, so the list matches what you actually refund. */
export const SEED_REFUND_TYPES = [
  { id: "rt_call", name: "Individual call", color: "cyan",
    steps: ["Listen back to the call recording", "Confirm the credit with the agent", "Refund the charge in Stripe", "Note it on the agent's account"] },
  { id: "rt_membership", name: "Cancelled membership", color: "violet",
    steps: ["Confirm the cancellation date", "Work out the pro-rata amount", "Refund in Stripe", "Cancel the subscription", "Switch off anything still running"] },
  { id: "rt_quality", name: "Service quality", color: "amber",
    steps: ["Get the specifics from the agent", "Agree what's being credited", "Refund in Stripe", "Log what went wrong"] },
  { id: "rt_duplicate", name: "Duplicate charge", color: "slate",
    steps: ["Find both charges in Stripe", "Refund the later one", "Email the agent confirming"] },
  { id: "rt_goodwill", name: "Goodwill", color: "emerald",
    steps: ["Get sign-off on the amount", "Refund in Stripe", "Note why, for next time"] },
];

export const SEED = [
  { id: "p_rec", name: "Recruiting Ad Campaign", kind: "one-time", slaHours: 48, color: "blue", stripeMatch: "recruit", stripeIds: [],
    steps: ["Kickoff call / intake form", "Write ad copy", "Build creative", "Launch campaign", "Send client confirmation"],
    cancelSteps: ["Pause the ad campaign (stops the spend)", "Email the client about the failed payment", "Cancel the subscription in Stripe"] },
  { id: "p_gc", name: "Google Calls Subscription", kind: "subscription", slaHours: 24, color: "emerald", stripeMatch: "google", stripeIds: [],
    steps: ["Confirm coverage area", "Set call routing", "Connect billing cycle", "Send onboarding email"],
    cancelSteps: ["Turn off call routing", "Email the client about the failed payment", "Cancel the subscription in Stripe"] },
  { id: "p_fe", name: "Inbound Final Expense Transfers", kind: "subscription", slaHours: 12, color: "orange", stripeMatch: "final expense", stripeIds: [],
    steps: ["Confirm licensed states", "Set daily transfer cap", "Add to dialer rotation", "Schedule first live day"],
    cancelSteps: ["Remove from the dialer rotation (stops the spend)", "Email the client about the failed payment", "Cancel the subscription in Stripe"] },
  { id: "p_call", name: "Individual Call", kind: "one-time", slaHours: 4, color: "cyan", stripeMatch: "call", stripeIds: [],
    steps: ["Confirm the transfer details", "Route the call", "Log the outcome"],
    cancelSteps: ["Stop sending calls to this client", "Email the client about the failed payment"] },
  { id: "p_ig", name: "Instagram Software", kind: "subscription", slaHours: 24, color: "fuchsia", stripeMatch: "instagram", stripeIds: [],
    steps: ["Create account", "Connect IG profile", "Load message templates", "Send login + walkthrough"],
    cancelSteps: ["Disable the account", "Email the client about the failed payment", "Cancel the subscription in Stripe"] },
];
export const DEF = { syncUrl: "", syncToken: "", autoSyncMinutes: 5, notifyWebhook: "", notifyEmail: "", notifyPhone: "",
  notifyBrowser: true, notifySound: true, notifyOverdue: true, archiveAfterDays: 14, pastDueHours: 12 };

/* ── customers ──
   Stripe knows who paid; it doesn't know who to credit. A refund for an
   individual call is issued to an agent who may never appear on a payment
   under that name, so the people you deal with are kept here and looked up
   by name when it matters. */
export const custName = (c) =>
  [c?.first, c?.last].filter(Boolean).join(" ").trim() || c?.name || "";

export function findCustomers(customers, q) {
  const t = String(q || "").trim().toLowerCase();
  const all = customers || [];
  if (!t) return all.slice().sort((a, b) => custName(a).localeCompare(custName(b)));
  return all
    .filter((c) => `${custName(c)} ${c.email || ""} ${c.stripeId || ""}`.toLowerCase().includes(t))
    .sort((a, b) => {
      /* A name that starts with what was typed is almost always the one
         wanted, so it goes above a mid-word match. */
      const A = custName(a).toLowerCase().startsWith(t), B = custName(b).toLowerCase().startsWith(t);
      return A === B ? custName(a).localeCompare(custName(b)) : A ? -1 : 1;
    });
}

/* ── theme ──
   A per-person preference, not board data: the owner liking dark doesn't
   mean the VA does, and the board record is shared between them. So it
   lives in this browser, and never syncs. */
export const THEME_KEY = "ltf_theme";
export const THEMES = [["light", "Light"], ["dark", "Dark"], ["system", "Match system"]];

export function readTheme() {
  try { const v = localStorage.getItem(THEME_KEY); return THEMES.some(([id]) => id === v) ? v : "system"; }
  catch { return "system"; }
}

export function applyTheme(pick) {
  const dark = pick === "dark" || (pick !== "light" &&
    typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches);
  const el = document.documentElement;
  el.classList.toggle("dark", dark);
  el.style.colorScheme = dark ? "dark" : "light";
  /* The phone status bar sits above the page and doesn't follow a class. */
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? "#020617" : "#f1f5f9");
  return dark;
}

/* Reads the stored choice, keeps <html> in step, and — on "match system" —
   follows the OS if it changes while the page is open. */
export function useTheme() {
  const [pick, setPick] = useState(readTheme);
  useEffect(() => {
    applyTheme(pick);
    try { localStorage.setItem(THEME_KEY, pick); } catch { /* private window */ }
    if (pick !== "system" || typeof matchMedia !== "function") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => applyTheme("system");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [pick]);
  return [pick, setPick];
}

export const KEY = "fulfillment_board_v3", HOUR = 36e5, DAY = 864e5;
export const uid = (p = "o") => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
export const paidOk = (o) => (o.paymentStatus || "succeeded") === "succeeded";
export function brief(x) {
  if (x == null || isNaN(x)) return "—";
  const a = Math.abs(x), h = Math.floor(a / HOUR), m = Math.floor((a % HOUR) / 6e4);
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : h ? `${h}h ${m}m` : `${m}m`;
}
export const dk = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
export const dl = (k) => new Date(k + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
export const sod = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const cash = (x) => (x == null ? "—" : `$${(x / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
export const freq = (o) => (!o.interval ? "" : `every ${o.intervalCount > 1 ? o.intervalCount + " " : ""}${o.interval}${o.intervalCount > 1 ? "s" : ""}`);

/* When is an order late?

   Two rules, and the tighter one wins: the product's own turnaround target,
   and a house rule that applies to everything. So a product promised in 48
   hours still goes past due at the house limit — but a product promised in 6
   is late at 6, not at the house limit. */
export function effHours(product, settings) {
  const sla = Number(product?.slaHours);
  const own = Number.isFinite(sla) && sla > 0 ? sla : 24;
  const cap = Number(settings?.pastDueHours);
  return Number.isFinite(cap) && cap > 0 ? Math.min(own, cap) : own;
}

/* The deadline for one order. Derived rather than stored, so changing the
   house rule re-dates every order already on the board instead of applying
   only to whatever arrives next. */
export function dueOf(order, products, settings) {
  const p = (products || []).find((x) => x.id === order.productId);
  return order.receivedAt + effHours(p, settings) * HOUR;
}

export const L = ({ children, className = "" }) => <div className={`text-[10px] font-semibold uppercase tracking-[0.12em] ${F} ${className}`}>{children}</div>;
/* The label wraps its control, so clicking the words focuses the box and a
   screen reader announces the two together. The hint sits outside, or it
   gets read out as part of the field's name. */
export const Field = ({ label, hint, children }) => (
  <div>
    <label><L className="mb-1">{label}</L>{children}</label>
    {hint && <p className={`mt-1 text-xs ${F}`}>{hint}</p>}
  </div>
);

export function Confirm({ onConfirm, label = "Delete" }) {
  const [a, setA] = useState(false);
  useEffect(() => { if (a) { const t = setTimeout(() => setA(false), 4e3); return () => clearTimeout(t); } }, [a]);
  return a ? <button onClick={() => { setA(false); onConfirm(); }} className="rounded-md bg-rose-600 px-2 py-1 text-xs font-semibold text-slate-900 dark:text-white">Confirm</button>
    : <button onClick={() => setA(true)} title={label} className={`rounded-md p-1.5 ${F} hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-rose-400`}><Trash2 className="h-4 w-4" /></button>;
}

/* Which product does this charge belong to? An exact Stripe ID wins; the
   keyword on the product is the fallback for charges that carry only a name. */
export function match(ps, ids, text) {
  const set = ids.filter(Boolean).map(String);
  const a = ps.find((p) => (p.stripeIds || []).some((s) => s && set.includes(String(s).trim())));
  if (a) return a.id;
  const t = String(text || "").toLowerCase();
  if (!t) return null;
  const b = ps.find((p) => [p.stripeMatch, p.name].filter(Boolean).some((k) => {
    const y = String(k).toLowerCase(); return y && (t.includes(y) || y.includes(t));
  }));
  return b ? b.id : null;
}
export const msOf = (v) => (v == null ? null : v > 1e12 ? v : v * 1e3);

/* Stripe hands back a dozen shapes depending on which object fired. Flatten
   them all into one order draft the board can render. */
export function normalize(payload, ps) {
  const list = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [payload];
  return list.map((ev) => {
    const o = ev?.data?.object ? ev.data.object : ev;
    if (!o || typeof o !== "object") return null;
    let items = Array.isArray(o.items) && !o.items.data ? o.items : null;
    if (!items) items = (o.lines?.data || o.line_items?.data || []).map((l) => ({
      description: l.description || l.price?.nickname || "", quantity: l.quantity ?? 1,
      amount: l.amount ?? l.amount_total ?? null, priceId: l.price?.id || "",
      productId: typeof l.price?.product === "string" ? l.price.product : "",
      interval: l.price?.recurring?.interval || null, intervalCount: l.price?.recurring?.interval_count || 1,
    }));
    const f = items[0] || {}, cd = o.payment_method_details?.card || {}, b = o.billing_details || {};
    const cu = typeof o.customer === "object" && o.customer ? o.customer : {};
    const pid = o.priceId || f.priceId || "", prid = o.stripeProductId || f.productId || "";
    const text = o.productName || o.metadata?.product || f.description || o.description || "";
    return {
      source: "stripe", externalId: o.chargeId || o.id || o.paymentId || "",
      paymentId: o.paymentId || o.payment_intent || o.id || "",
      chargeId: o.chargeId || (String(o.id || "").startsWith("ch_") ? o.id : ""),
      paymentStatus: o.status === "failed" || o.paymentStatus === "failed" ? "failed" : "succeeded",
      declineCode: o.declineCode || o.failure_code || "",
      declineReason: o.declineReason || o.failure_message || o.outcome?.seller_message || "",
      disputed: !!o.disputed, disputeStatus: o.disputeStatus || "",
      refunded: !!o.refunded, amount: o.amount ?? o.amount_total ?? o.amount_paid ?? o.amount_due ?? null,
      amountRefunded: o.amountRefunded ?? o.amount_refunded ?? null,
      refundedAt: o.refunded ? (msOf(o.created) || Date.now()) : null,
      currency: (o.currency || "usd").toUpperCase(), receiptUrl: o.receiptUrl || o.receipt_url || "",
      receivedAt: msOf(o.created) || o.receivedAt || Date.now(),
      paymentMethodId: o.paymentMethodId || (typeof o.payment_method === "string" ? o.payment_method : "") || "",
      paymentMethodType: o.paymentMethodType || o.payment_method_details?.type || "",
      cardBrand: o.cardBrand || cd.brand || "", cardLast4: o.cardLast4 || cd.last4 || "",
      cardExp: o.cardExp || (cd.exp_month ? `${String(cd.exp_month).padStart(2, "0")}/${String(cd.exp_year || "").slice(-2)}` : ""),
      ownerName: o.ownerName || b.name || "", ownerEmail: o.ownerEmail || b.email || "",
      customerId: o.customerId || (typeof o.customer === "string" ? o.customer : cu.id) || "",
      customer: o.customerName || o.customer_details?.name || cu.name || b.name || o.customer_name || "Unnamed customer",
      email: o.email || o.customerEmail || o.customer_details?.email || cu.email || b.email || "",
      phone: o.phone || o.customerPhone || o.customer_details?.phone || cu.phone || b.phone || "",
      invoiceId: o.invoiceId || (typeof o.invoice === "string" ? o.invoice : "") || "",
      subscriptionId: o.subscriptionId || o.subscription || "", subscriptionStatus: o.subscriptionStatus || "",
      interval: o.interval || f.interval || "", intervalCount: o.intervalCount || f.intervalCount || 1,
      quantity: o.quantity ?? f.quantity ?? 1, items,
      productName: text || "Needs triage", stripePriceId: pid || prid || "", productId: match(ps, [pid, prid], text),
    };
  }).filter(Boolean);
}

export const COLS = [
  ["Payment ID", (o) => o.paymentId], ["Charge ID", (o) => o.chargeId], ["Date", (o) => new Date(o.receivedAt).toISOString()],
  ["Payment status", (o) => o.paymentStatus], ["Decline code", (o) => o.declineCode], ["Decline reason", (o) => o.declineReason],
  ["Amount", (o) => (o.amount == null ? "" : (o.amount / 100).toFixed(2))], ["Currency", (o) => o.currency],
  ["Customer ID", (o) => o.customerId], ["Customer name", (o) => o.customer], ["Customer email", (o) => o.email],
  ["Customer phone", (o) => o.phone], ["Cardholder name", (o) => o.ownerName], ["Cardholder email", (o) => o.ownerEmail],
  ["Payment method ID", (o) => o.paymentMethodId], ["Payment method", (o) => [o.paymentMethodType, o.cardBrand, o.cardLast4].filter(Boolean).join(" ")],
  ["Card expiry", (o) => o.cardExp], ["Subscription ID", (o) => o.subscriptionId], ["Subscription status", (o) => o.subscriptionStatus],
  ["Disputed", (o) => (o.disputed ? "yes" : "")],
  ["Frequency", freq], ["Quantity", (o) => o.quantity ?? 1], ["Product", (o) => o.productName], ["Price ID", (o) => o.stripePriceId],
  ["Items", (o) => (o.items || []).map((i) => `${i.quantity || 1}x ${i.description}`).join(" | ")],
  ["Invoice ID", (o) => o.invoiceId], ["Receipt URL", (o) => o.receiptUrl], ["Fulfillment status", (o) => sm(o.status)[1]],
  ["Owner", (o) => o.assignee], ["Due", (o) => (o.dueAt ? new Date(o.dueAt).toISOString() : "")],
  ["Delivered", (o) => (o.completedAt ? new Date(o.completedAt).toISOString() : "")],
  ["Minutes to fulfill", (o) => (o.completedAt ? Math.round((o.completedAt - o.receivedAt) / 6e4) : "")], ["Notes", (o) => o.notes],
];

/* Handing the viewer a file.

   In a browser that's an anchor click. Inside the artifact viewer the frame
   can't download on its own, so the save goes through the host, which asks
   the viewer first. Resolve the namespace once at load so a click isn't
   waiting on a handshake. */
let dlPromise;
const downloads = () => (dlPromise ||= (typeof window !== "undefined" && window.claude?.use
  ? window.claude.use("downloads").catch(() => null)
  : Promise.resolve(null)));
if (typeof window !== "undefined") downloads();

export async function grab(name, blob) {
  const dl = await downloads();
  if (dl) {
    try { await dl.save({ filename: name, data: blob }); return { ok: true }; }
    catch (e) { return { ok: false, code: e?.code || "unavailable" }; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1e4);
  return { ok: true };
}

/* What to tell someone when a download doesn't happen. A decline is a
   choice, not a failure, so it says nothing. */
export function grabTrouble(r) {
  if (!r || r.ok || r.code === "declined") return null;
  if (r.code === "extension_not_enabled" || r.code === "rejected_extension") return "CSV isn't available here — try JSON.";
  if (r.code === "too_large") return "That's too much data for one file. Narrow the date range.";
  if (r.code === "rate_limited") return "One download at a time — try again in a moment.";
  return "The download didn't go through.";
}

export function dump(rows, kind) {
  const s = new Date().toISOString().slice(0, 10);
  if (kind === "json") return grab(`orders-${s}.json`, new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" }));
  const e = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return grab(`orders-${s}.csv`, new Blob([[COLS.map(([h]) => e(h)).join(","), ...rows.map((o) => COLS.map(([, g]) => e(g(o))).join(","))].join("\n")], { type: "text/csv" }));
}
