import React, { useState } from "react";
import { Plus, Trash2, Check, Loader2, AlertTriangle } from "lucide-react";
import { BD, CARD, PANEL, IN, BTN, PRI, M, F, W, L, Field, dk } from "../lib/shared";
import Logo from "../components/Logo";
import { RELAY } from "../lib/auth";

/* The one page a stranger sees.

   It is reached without signing in, renders before the auth gate, and talks
   to exactly one endpoint. Nothing about the board is loaded here — not the
   orders, not the customers, not the settings — so there is nothing for a
   link recipient to find, whatever they do with the page. */

const REASONS = [
  ["non_consumer", "Non-consumer"],
  ["agent", "Life insurance agent"],
  ["dead_air", "Dead air"],
  ["other", "Other"],
];

const BLANK = () => ({ phone: "", reason: "" });

export default function RefundRequest() {
  const [f, setF] = useState(() => ({ day: dk(Date.now()), first: "", last: "", email: "" }));
  /* Two to begin with, because two is the rule. */
  const [calls, setCalls] = useState([BLANK(), BLANK()]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const setCall = (i, k) => (e) =>
    setCalls((xs) => xs.map((c, j) => (j === i ? { ...c, [k]: e.target.value } : c)));

  const digits = (p) => String(p || "").replace(/\D/g, "");
  const pairs = Math.floor(calls.filter((c) => digits(c.phone).length >= 10 && c.reason).length / 2);
  const ready = f.first.trim() && f.last.trim() && /\S+@\S+\.\S+/.test(f.email) && f.day
    && calls.length >= 2 && calls.every((c) => digits(c.phone).length >= 10 && c.reason);

  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      const r = await fetch(`${RELAY}/refund-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...f, calls }),
      });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(out.error || "That didn't send. Try again in a moment.");
      setDone(true);
    } catch (e2) {
      setErr(e2.message || "That didn't send.");
    } finally { setBusy(false); }
  };

  if (done) return (
    <Shell>
      <div className={`${CARD} p-6 text-center`}>
        <Check className="mx-auto h-8 w-8 text-emerald-600 dark:text-emerald-400" />
        <h2 className={`mt-3 text-lg font-bold ${W}`}>Sent</h2>
        <p className={`mt-2 text-sm ${M}`}>
          {calls.length} call{calls.length === 1 ? "" : "s"} submitted for review. Anything that meets the
          criteria is credited to your account <strong>the following Saturday</strong>, not straight away.
        </p>
        <button onClick={() => { setDone(false); setCalls([BLANK(), BLANK()]); }} className={`mt-4 ${BTN}`}>
          Submit another
        </button>
      </div>
    </Shell>
  );

  return (
    <Shell>
      <Policy />

      <form onSubmit={submit} className={`${CARD} mt-4 space-y-4 p-5`}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date of the calls">
            <input type="date" required className={IN} value={f.day} onChange={set("day")} max={dk(Date.now())} />
          </Field>
          <Field label="Email on your Lead Tech account" hint="Where the credit goes">
            <input type="email" required className={IN} value={f.email} onChange={set("email")}
              placeholder="you@yourcompany.com" autoComplete="email" />
          </Field>
          <Field label="First name">
            <input required className={IN} value={f.first} onChange={set("first")} autoComplete="given-name" />
          </Field>
          <Field label="Last name">
            <input required className={IN} value={f.last} onChange={set("last")} autoComplete="family-name" />
          </Field>
        </div>

        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <L>The calls</L>
            <span className={`text-xs ${F}`}>
              {pairs
                ? `${pairs} refund${pairs === 1 ? "" : "s"} from ${pairs * 2} call${pairs * 2 === 1 ? "" : "s"}`
                : "Two calls earn one refund"}
            </span>
          </div>

          <div className="mt-2 space-y-3">
            {calls.map((c, i) => (
              <div key={i} className={`rounded-lg border ${BD} p-3`}>
                <div className="flex items-baseline justify-between gap-2">
                  <L>Call {i + 1}</L>
                  {calls.length > 2 && (
                    <button type="button" onClick={() => setCalls((xs) => xs.filter((_, j) => j !== i))}
                      className={`rounded p-1 ${F} hover:text-rose-500`} title={`Remove call ${i + 1}`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <Field label="Phone number">
                    <input required inputMode="tel" className={IN} value={c.phone}
                      onChange={setCall(i, "phone")} placeholder="(555) 123-4567" />
                  </Field>
                  <Field label="Reason for the refund">
                    <select required className={IN} value={c.reason} onChange={setCall(i, "reason")}>
                      <option value="">Choose one…</option>
                      {REASONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                    </select>
                  </Field>
                </div>
              </div>
            ))}
          </div>

          <button type="button" onClick={() => setCalls((xs) => [...xs, BLANK(), BLANK()])}
            className={`mt-3 inline-flex items-center gap-1.5 ${BTN}`}>
            <Plus className="h-4 w-4" /> Add two more calls
          </button>
        </div>

        {err && (
          <p role="alert" className={`flex items-start gap-2 rounded-md border border-rose-300 bg-rose-100 px-3 py-2 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200`}>
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{err}
          </p>
        )}

        <button type="submit" disabled={!ready || busy}
          title={ready ? "" : "Fill in every box, and at least two calls"}
          className={`w-full ${PRI} disabled:cursor-not-allowed disabled:opacity-40`}>
          {busy
            ? <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Sending</span>
            : "Submit refund request"}
        </button>
      </form>
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-slate-100 px-4 py-8 dark:bg-slate-950">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-6 text-center">
          <Logo size="lg" className={`justify-center ${W}`} />
          <L className="mt-3 block">Google call refund request</L>
        </div>
        {children}
        <p className={`mt-6 text-center text-xs ${F}`}>
          Questions about a decision go to whoever sent you this form.
        </p>
      </div>
    </div>
  );
}

/* The rules, in front of the form rather than behind a link — somebody
   reading them before they type is a request that doesn't need rejecting. */
function Policy() {
  return (
    <div className={`${PANEL} rounded-xl p-5`}>
      <h2 className={`text-base font-bold ${W}`}>Inbound refund policy</h2>

      <h3 className={`mt-4 text-sm font-semibold ${W}`}>Meta / TV calls</h3>
      <p className={`mt-1 text-sm ${M}`}>
        There are no refunds on Meta or TV calls. These have a buffer to prevent being billed for dead air calls.
      </p>

      <h3 className={`mt-4 text-sm font-semibold ${W}`}>Google calls</h3>
      <p className={`mt-1 text-sm ${M}`}>
        For every <strong>2 bad calls</strong> you get in a day, <strong>1 refund</strong> is added to your account.
      </p>

      <p className={`mt-3 text-sm ${M}`}>A bad call is either of the following:</p>
      <ul className={`mt-2 space-y-2 text-sm ${M}`}>
        <li className="flex gap-2">
          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-blue-500" />
          <span>An agent called in for customer support — not a consumer on the line.</span>
        </li>
        <li className="flex gap-2">
          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-blue-500" />
          <span>The call was dead air, with nobody on the other end. The agent must be in the USA for this to apply.</span>
        </li>
      </ul>

      <p className={`mt-4 text-sm ${M}`}>
        Fill in the form below and the calls will be reviewed. Anything meeting the criteria is credited to your
        account <strong className={W}>the following Saturday</strong> — not immediately.
      </p>
    </div>
  );
}
