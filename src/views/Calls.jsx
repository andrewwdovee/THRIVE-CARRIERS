import React, { useState, useMemo } from "react";
import { PhoneCall, Check, TrendingUp, TrendingDown } from "lucide-react";
import {
  BD, CARD, PANEL, IN, BTN, PRI, M, F, W, TD, cash, uid, L, Field, Confirm,
  dk, dl, satOf, weekLabel, callMath, callTotals, callWeeks, SCROLL, STICKY, DAY,
} from "../lib/shared";
import WipeLine from "./WipeLine";

/* Calls bought against calls sold.

   Two numbers at the end of the day, and everything else on this page is
   arithmetic on them. The entry sits at the top and takes two keystrokes and
   a click, because a number that is a chore to log stops being logged, and a
   gap in the record is worse than a rough figure in it. */

const RANGES = [["14", "Last 14 days"], ["30", "Last 30 days"], ["90", "Last 90 days"], ["all", "All time"]];

export default function Calls({ calls, settings, onSave, onRemove }) {
  const rows = calls || [];
  const [day, setDay] = useState(() => dk(Date.now()));
  const [billable, setBillable] = useState("");
  const [sold, setSold] = useState("");
  const [saved, setSaved] = useState(false);
  const [range, setRange] = useState("30");
  const [grain, setGrain] = useState("day");

  const cost = Number(settings?.callCost) || 0;
  const price = Number(settings?.callPrice) || 0;

  const existing = useMemo(() => rows.find((r) => r.day === day), [rows, day]);
  /* What is typed wins; what is already logged fills the gaps. Editing one of
     the two numbers must not blank the other. */
  const draft = {
    billable: billable === "" ? (existing?.billable ?? "") : billable,
    sold: sold === "" ? (existing?.sold ?? "") : sold,
  };
  const preview = callMath({ billable: draft.billable || 0, sold: draft.sold || 0 }, settings);
  const dirty = billable !== "" || sold !== "";

  const save = () => {
    onSave({
      id: existing?.id || uid("cl"), day,
      billable: Math.max(0, Number(draft.billable) || 0),
      sold: Math.max(0, Number(draft.sold) || 0),
      at: Date.now(),
    });
    setBillable(""); setSold("");
    setSaved(true); setTimeout(() => setSaved(false), 2500);
  };

  const scoped = useMemo(() => {
    if (range === "all") return rows;
    const from = dk(Date.now() - (Number(range) - 1) * DAY);
    return rows.filter((r) => r.day >= from);
  }, [rows, range]);

  const sorted = useMemo(() => [...scoped].sort((a, b) => b.day.localeCompare(a.day)), [scoped]);
  const total = useMemo(() => callTotals(scoped, settings), [scoped, settings]);
  const weeks = useMemo(() => callWeeks(rows, settings), [rows, settings]);

  const today = useMemo(() => callMath(rows.find((r) => r.day === dk(Date.now())) || {}, settings), [rows, settings]);
  const thisWeek = weeks.find((w) => w.week === satOf(Date.now()));

  /* Two days into a week against a full seven is always a collapse, so the
     comparison is against the same number of days of the week before. On a
     Monday that is Saturday and Sunday either side, which is a question
     somebody can actually act on. */
  const compare = useMemo(() => {
    const here = satOf(Date.now());
    const prevWeek = weeks.filter((w) => w.week < here).slice(-1)[0];
    if (!thisWeek || !prevWeek) return null;
    const daysIn = thisWeek.days;
    const prevDays = rows
      .filter((r) => satOf(Date.parse(r.day + "T12:00:00")) === prevWeek.week)
      .sort((a, b) => a.day.localeCompare(b.day))
      .slice(0, daysIn);
    if (!prevDays.length) return null;
    const then = callTotals(prevDays, settings);
    return {
      then, daysIn, full: prevDays.length === prevWeek.days,
      pct: then.profit > 0 ? Math.round(((thisWeek.profit - then.profit) / then.profit) * 100) : null,
    };
  }, [weeks, rows, thisWeek, settings]);
  const growth = compare?.pct ?? null;

  const points = grain === "week"
    ? weeks.map((w) => ({ at: w.week, value: w.profit, note: `${w.sold} sold · ${w.billable} billed` }))
    : [...scoped].sort((a, b) => a.day.localeCompare(b.day)).map((r) => {
      const m = callMath(r, settings);
      return { at: Date.parse(r.day + "T12:00:00"), value: m.profit, note: `${m.sold} sold · ${m.billable} billed` };
    });

  const Tile = ({ label, value, note, tone }) => (
    <div className={`${CARD} p-4`}>
      <L>{label}</L>
      <div className={`mt-1 font-mono text-2xl font-bold tabular-nums ${tone || W}`}>{value}</div>
      {note && <div className={`mt-0.5 text-xs ${F}`}>{note}</div>}
    </div>
  );
  const money = (c) => (c < 0 ? `−${cash(Math.abs(c))}` : cash(c));
  const tone = (c) => (c > 0 ? "text-emerald-600 dark:text-emerald-400" : c < 0 ? "text-rose-600 dark:text-rose-400" : W);

  return (
    <div className="space-y-4">
      {/* ── the end-of-day job ── */}
      <div className={`${CARD} p-4`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className={`flex items-center gap-2 text-sm font-semibold ${W}`}>
              <PhoneCall className="h-4 w-4 text-blue-600 dark:text-blue-400" /> Log the day
            </h3>
            <p className={`mt-0.5 text-sm ${M}`}>
              Two numbers. Logging a day again corrects it rather than adding a second entry.
            </p>
          </div>
          <div className="w-44">
            <Field label="Day">
              <input type="date" className={IN} value={day}
                onChange={(e) => { setDay(e.target.value || dk(Date.now())); setBillable(""); setSold(""); }} />
            </Field>
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Lead Tech billable calls" hint={`What you pay for, at ${cash(cost)} each`}>
            <input inputMode="numeric" className={`${IN} text-lg`} placeholder="0"
              value={draft.billable} onChange={(e) => setBillable(e.target.value)} />
          </Field>
          <Field label="Calls sold" hint={`What agents bought, at ${cash(price)} each`}>
            <input inputMode="numeric" className={`${IN} text-lg`} placeholder="0"
              value={draft.sold} onChange={(e) => setSold(e.target.value)} />
          </Field>

          {/* The answer, before you commit to it. */}
          <div className={`rounded-lg border-l-4 ${preview.profit >= 0 ? "border-emerald-500" : "border-rose-500"} ${PANEL} px-3 py-2 sm:col-span-2`}>
            <L>That day</L>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className={`font-mono text-xl font-bold ${tone(preview.profit)}`}>{money(preview.profit)}</span>
              <span className={`text-xs ${F}`}>
                {cash(preview.revenue)} in · {cash(preview.spend)} out
                {preview.margin != null ? ` · ${preview.margin}% margin` : ""}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button onClick={save} disabled={!dirty && !existing}
            title={dirty || existing ? "" : "Type the day's numbers first"}
            className={`${PRI} disabled:cursor-not-allowed disabled:opacity-40`}>
            {existing ? "Update" : "Save"} {dl(day)}
          </button>
          {existing && !dirty && <span className={`text-sm ${M}`}>Already logged — type over a number to change it.</span>}
          {saved && <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
            <Check className="h-4 w-4" /> Saved</span>}
        </div>
      </div>

      {/* ── where it stands ── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Today" value={money(today.profit)} tone={tone(today.profit)}
          note={`${today.sold} sold · ${today.billable} billed`} />
        <Tile label="This week" value={money(thisWeek?.profit || 0)} tone={tone(thisWeek?.profit || 0)}
          note={thisWeek ? `${thisWeek.days} day${thisWeek.days === 1 ? "" : "s"} logged` : "nothing logged yet"} />
        <Tile label="Against last week"
          value={growth == null ? "—" : `${growth > 0 ? "+" : ""}${growth}%`}
          tone={growth == null ? W : tone(growth)}
          note={compare
            ? `${money(compare.then.profit)} over the same ${compare.daysIn} day${compare.daysIn === 1 ? "" : "s"} last week`
            : "no week to compare yet"} />
        <Tile label={range === "all" ? "All time" : `Last ${range} days`} value={money(total.profit)}
          tone={tone(total.profit)}
          note={`${total.sold} sold · ${total.billable} billed${total.margin != null ? "" : ""}`} />
      </div>

      {/* ── the shape of it ── */}
      <div className={`${CARD} p-4`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className={`text-sm font-semibold ${W}`}>Profit {grain === "week" ? "per week" : "per day"}</h3>
          <div className="flex items-center gap-2">
            <div className={`flex gap-1 rounded-lg border ${BD} p-1`}>
              {[["day", "Daily"], ["week", "Weekly"]].map(([id, label]) => (
                <button key={id} onClick={() => setGrain(id)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium ${grain === id
                    ? "bg-blue-600 text-white" : `${M} hover:bg-slate-200 dark:hover:bg-slate-800`}`}>{label}</button>
              ))}
            </div>
            <div className={`flex flex-wrap gap-1 rounded-lg border ${BD} p-1`}>
              {RANGES.map(([id, label]) => (
                <button key={id} onClick={() => setRange(id)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium ${range === id
                    ? "bg-blue-600 text-white" : `${M} hover:bg-slate-200 dark:hover:bg-slate-800`}`}>{label}</button>
              ))}
            </div>
          </div>
        </div>
        <p className={`mt-0.5 text-sm ${M}`}>
          {grain === "week" ? "Every week recorded — the line to watch for whether this is growing."
            : "Day by day, over the window chosen above."}
        </p>
        <WipeLine points={points} empty="Nothing logged yet. Put in today's two numbers above." />
      </div>

      {/* ── the record ── */}
      <div className={`overflow-hidden rounded-xl border ${BD}`}>
        <div className={`flex flex-wrap items-center justify-between gap-2 border-b ${BD} bg-white px-4 py-3 dark:bg-slate-900`}>
          <h3 className={`text-sm font-semibold ${W}`}>Day by day</h3>
          <span className={`text-xs ${F}`}>
            {total.days} day{total.days === 1 ? "" : "s"} · {cash(total.revenue)} in · {cash(total.spend)} out
          </span>
        </div>
        {!sorted.length && <p className={`px-4 py-8 text-sm ${M}`}>Nothing logged in this window.</p>}
        {!!sorted.length && (
          <div className={SCROLL}>
            <table className="w-full text-sm">
              <thead className={STICKY}>
                <tr className={`border-b ${BD} text-left`}>
                  {["Day", "Billed", "Sold", "Out", "In", "Profit", ""].map((h, i) => (
                    <th key={h + i} className={`px-4 py-2 text-xs font-medium uppercase tracking-wide ${F} ${i && i < 6 ? "text-right" : ""}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {sorted.map((r) => {
                  const m = callMath(r, settings);
                  return (
                    <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-900">
                      <td className="px-4 py-2">
                        <button onClick={() => { setDay(r.day); setBillable(""); setSold(""); }}
                          className={`${W} hover:underline`} title="Load this day above">{dl(r.day)}</button>
                      </td>
                      <td className={`${TD} text-right ${M}`}>{m.billable}</td>
                      <td className={`${TD} text-right ${M}`}>{m.sold}</td>
                      <td className={`${TD} text-right ${F}`}>{cash(m.spend)}</td>
                      <td className={`${TD} text-right ${F}`}>{cash(m.revenue)}</td>
                      <td className={`${TD} text-right font-semibold ${tone(m.profit)}`}>{money(m.profit)}</td>
                      <td className="px-4 py-2 text-right">
                        <Confirm label={`Remove ${dl(r.day)}`} onConfirm={() => onRemove(r.id)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
