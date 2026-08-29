import React, { useState, useMemo } from "react";
import { Plus, Wallet, TrendingDown, Check, X } from "lucide-react";
import {
  BD, CARD, PANEL, IN, BTN, PRI, M, F, W, TD, cash, uid, L, Field, Confirm,
  custName, findCustomers, satOf, weekLabel, walletTotals, walletWeeks, DAY, SCROLL, STICKY,
} from "../lib/shared";
import { CustomerForm } from "./admin";
import WipeLine from "./WipeLine";

/* Money that never gets spent.

   Agents top up a wallet and spend it on calls. Every Saturday whatever is
   left is wiped, and that wipe is revenue the business keeps. The number
   worth watching per person is not one week's wipe but the pattern: somebody
   wiped for a lot every week is being sold more than they can use, which is
   a conversation to have before they work it out themselves. */
export default function Wallets({ customers, wipes, n, onRecord, onRemove, onAddCustomer, onRemoveCustomer }) {
  /* Two boxes, not one. The weekly table and the totals table are different
     jobs — filtering one from a box sitting in the other card is a search
     nobody would think to look for. */
  const [wq, setWq] = useState("");
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(null);
  const [week, setWeek] = useState(() => satOf(Date.now()));
  const [entry, setEntry] = useState({});
  const [saved, setSaved] = useState(0);

  const users = customers || [];
  const rows = wipes || [];

  /* One record per person per week: entering the same Saturday twice should
     correct the number, not add a second one nobody can see. */
  const thisWeek = useMemo(() => {
    const by = new Map();
    for (const w of rows) if (satOf(w.at) === week) by.set(w.userId, w);
    return by;
  }, [rows, week]);

  const forWeek = useMemo(() => findCustomers(users, wq), [users, wq]);
  const totals = useMemo(() => walletTotals(users, rows), [users, rows]);
  const shown = useMemo(() => {
    const hits = findCustomers(users, q);
    const ids = new Set(hits.map((u) => u.id));
    return totals.filter((t) => ids.has(t.id)).sort((a, b) => b.total - a.total);
  }, [totals, users, q]);

  const weeks = useMemo(() => walletWeeks(rows), [rows]);
  const wipedAllTime = rows.reduce((s, w) => s + (w.amount || 0), 0);
  const wipedThisWeek = [...thisWeek.values()].reduce((s, w) => s + (w.amount || 0), 0);
  const perWeek = weeks.length ? Math.round(wipedAllTime / weeks.length) : 0;

  /* Only what was actually typed gets saved. A blank box means "not wiped",
     which is different from wiped for nothing, and neither should overwrite
     a figure already recorded for that week. */
  const pending = Object.entries(entry).filter(([, v]) => String(v).trim() !== "");
  /* Typing an amount, then searching for somebody else, hides the figure but
     doesn't discard it — so say how many are about to be saved out of sight
     rather than letting the count on the button look wrong. */
  const hiddenPending = useMemo(() => {
    const seen = new Set(forWeek.map((u) => u.id));
    return pending.filter(([id]) => !seen.has(id)).length;
  }, [pending, forWeek]);
  const saveWeek = () => {
    const made = pending.map(([userId, v]) => ({
      id: uid("wp"), userId, amount: Math.round(Number(v) * 100), at: week, recordedAt: Date.now(),
      /* The name as it stood when the figure was entered. Removing somebody
         later must not turn their history into a row of "Unknown". */
      name: custName(users.find((u) => u.id === userId)),
    })).filter((w) => Number.isFinite(w.amount) && w.amount >= 0);
    if (!made.length) return;
    onRecord(made, week);
    setEntry({});
    setSaved(made.length);
    setTimeout(() => setSaved(0), 3000);
  };

  const Tile = ({ label, value, note }) => (
    <div className={`${CARD} p-3`}>
      <L>{label}</L>
      <div className={`mt-1 font-mono text-xl ${W}`}>{value}</div>
      {note && <div className={`text-xs ${F}`}>{note}</div>}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Wiped this week" value={cash(wipedThisWeek)} note={`${thisWeek.size} of ${users.length} entered`} />
        <Tile label="Wiped all time" value={cash(wipedAllTime)} note={`${weeks.length} week${weeks.length === 1 ? "" : "s"} recorded`} />
        <Tile label="Average a week" value={cash(perWeek)} />
        <Tile label="People" value={String(users.length)} note="shared with Customers" />
      </div>

      {/* ── the Saturday job ── */}
      <div className={`${CARD} p-4`}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className={`flex items-center gap-2 text-sm font-semibold ${W}`}>
              <Wallet className="h-4 w-4 text-blue-600 dark:text-blue-400" /> Week of {weekLabel(week)}
            </h3>
            <p className={`mt-0.5 text-sm ${M}`}>
              Type what was wiped from each wallet, then save the lot in one go. Leave someone blank if they weren't wiped.
            </p>
          </div>
          <div className="flex items-end gap-2">
            <div className="w-36">
              <Field label="Saturday">
                <input type="date" className={IN}
                  value={new Date(week - new Date(week).getTimezoneOffset() * 6e4).toISOString().slice(0, 10)}
                  onChange={(e) => {
                    const t = Date.parse(e.target.value + "T12:00:00");
                    if (!isNaN(t)) { setWeek(satOf(t)); setEntry({}); }
                  }} />
              </Field>
            </div>
            <button onClick={() => { setWeek(satOf(week - DAY)); setEntry({}); }} className={BTN} title="Previous week">←</button>
            <button onClick={() => { setWeek(satOf(week + 8 * DAY)); setEntry({}); }} className={BTN} title="Next week">→</button>
          </div>
        </div>

        {!users.length ? (
          <div className={`mt-3 rounded-lg border-l-4 border-amber-500 ${PANEL} py-2 pl-3 pr-2`}>
            <p className={`text-sm ${W}`}>Nobody to wipe yet.</p>
            <p className={`mt-0.5 text-sm ${M}`}>Add the agents who hold wallets — they're the same list as Customers, so anyone you've already saved is here.</p>
          </div>
        ) : (
          <>
            <input value={wq} onChange={(e) => setWq(e.target.value)}
              placeholder={`Search ${users.length} ${users.length === 1 ? "person" : "people"}…`}
              className={`${IN} mt-3`} />

            <div className={`mt-2 overflow-hidden rounded-lg border ${BD}`}>
              <div className={SCROLL}>
                <table className="w-full text-sm">
                  <thead className={`sticky top-0 z-10 bg-white dark:bg-slate-900`}>
                    <tr className={`border-b ${BD} text-left`}>
                      <th className={`px-3 py-2 text-xs font-medium uppercase tracking-wide ${F}`}>Person</th>
                      <th className={`px-3 py-2 text-right text-xs font-medium uppercase tracking-wide ${F}`}>Wiped this week</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {!forWeek.length && (
                      <tr><td colSpan={2} className={`px-3 py-6 text-center text-sm ${M}`}>Nobody matches “{wq}”.</td></tr>
                    )}
                    {forWeek.map((u) => {
                      const already = thisWeek.get(u.id);
                      return (
                        <tr key={u.id}>
                          <td className="px-3 py-1.5">
                            <div className={`truncate ${W}`}>{custName(u) || "Unnamed"}</div>
                            {u.email && <div className={`truncate text-xs ${F}`}>{u.email}</div>}
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {already && (
                                <span className={`font-mono text-xs text-emerald-600 dark:text-emerald-400`} title="Already recorded for this week">
                                  {cash(already.amount)}
                                </span>
                              )}
                              <div className="w-28">
                                <input inputMode="decimal" className={`${IN} text-right`}
                                  placeholder={already ? "change it" : "0.00"}
                                  value={entry[u.id] ?? ""}
                                  onChange={(e) => setEntry((x) => ({ ...x, [u.id]: e.target.value }))} />
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button onClick={saveWeek} disabled={!pending.length}
                title={pending.length ? "" : "Nothing typed yet"}
                className={`${PRI} disabled:cursor-not-allowed disabled:opacity-40`}>
                Save {pending.length || ""} {pending.length === 1 ? "wipe" : "wipes"}
              </button>
              {!!pending.length && (
                <span className={`text-sm ${M}`}>
                  {cash(pending.reduce((s, [, v]) => s + Math.round(Number(v) * 100 || 0), 0))} for week of {weekLabel(week)}
                </span>
              )}
              {hiddenPending > 0 && (
                <span className="text-sm text-amber-600 dark:text-amber-400">
                  {hiddenPending} more typed for {hiddenPending === 1 ? "somebody" : "people"} the search is hiding — {hiddenPending === 1 ? "it saves" : "they save"} too.
                </span>
              )}
              {!!saved && (
                <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
                  <Check className="h-4 w-4" /> Saved {saved}
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── who is being wiped ── */}
      <div className={`${CARD} p-4`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className={`flex items-center gap-2 text-sm font-semibold ${W}`}>
            <TrendingDown className="h-4 w-4 text-blue-600 dark:text-blue-400" /> By person
          </h3>
          <button onClick={() => setAdding({})} className={`${BTN} flex items-center gap-1.5`}>
            <Plus className="h-3.5 w-3.5" /> Add person
          </button>
        </div>
        {!!users.length && (
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email…" className={`${IN} mt-3`} />
        )}

        <p className={`mt-2 text-xs ${F}`}>
          Removing somebody takes them off this list and out of Customers. Money already recorded stays on the week
          it was wiped, so past totals don't change underneath you.
        </p>

        <div className={`mt-3 overflow-hidden rounded-lg border ${BD}`}>
          {!shown.length && <p className={`px-3 py-6 text-center text-sm ${M}`}>
            {users.length ? `Nobody matches “${q}”.` : "No people yet."}
          </p>}
          {!!shown.length && (
            <div className={SCROLL}>
              <table className="w-full text-sm">
                <thead className={STICKY}>
                  <tr className={`border-b ${BD} text-left`}>
                    <th className={`px-3 py-2 text-xs font-medium uppercase tracking-wide ${F}`}>Person</th>
                    <th className={`px-3 py-2 text-right text-xs font-medium uppercase tracking-wide ${F}`}>Total wiped</th>
                    <th className={`px-3 py-2 text-right text-xs font-medium uppercase tracking-wide ${F}`}>Weeks</th>
                    <th className={`px-3 py-2 text-right text-xs font-medium uppercase tracking-wide ${F}`}>Average</th>
                    <th className={`px-3 py-2 text-right text-xs font-medium uppercase tracking-wide ${F}`}>Last</th>
                    <th className="w-10 px-3 py-2"><span className="sr-only">Remove</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {shown.map((u) => (
                    <tr key={u.id}>
                      <td className="px-3 py-2">
                        <div className={`truncate ${W}`}>{custName(u) || "Unnamed"}</div>
                        {u.email && <div className={`truncate text-xs ${F}`}>{u.email}</div>}
                      </td>
                      <td className={`${TD} text-right ${u.total ? W : F}`}>{cash(u.total)}</td>
                      <td className={`${TD} text-right ${M}`}>{u.count || "—"}</td>
                      <td className={`${TD} text-right ${M}`}>{u.count ? cash(u.average) : "—"}</td>
                      <td className={`px-3 py-2 text-right text-xs ${F}`}>{u.lastAt ? weekLabel(satOf(u.lastAt)) : "never"}</td>
                      <td className="px-3 py-2 text-right">
                        <Confirm label={`Remove ${custName(u) || "this person"}`} onConfirm={() => onRemoveCustomer(u.id)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <WalletWeeks weeks={weeks} wipes={rows} users={users} onRemove={onRemove} />

      {adding && <CustomerForm draft={adding} customers={users} onCancel={() => setAdding(null)}
        onSave={(c) => { onAddCustomer(c); setAdding(null); }} />}
    </div>
  );
}

/* Week by week, newest first — the shape of the thing over time, and the one
   place a wrong figure can be taken back out. */
function WalletWeeks({ weeks, wipes, users, onRemove }) {
  const [open, setOpen] = useState(null);
  /* Each wipe carries the name it was entered under, so removing somebody
     doesn't turn last month's history into a column of "Removed person". */
  const name = (r) => custName(users.find((u) => u.id === r.userId)) || r.name || "Removed person";
  const rows = open == null ? [] : wipes.filter((x) => satOf(x.at) === open).sort((a, b) => b.amount - a.amount);

  return (
    <div className={`${CARD} p-4`}>
      <h3 className={`text-sm font-semibold ${W}`}>Week by week</h3>
      <p className={`mt-0.5 text-sm ${M}`}>Hover to read a week. Click one to check or remove a figure.</p>

      <WipeLine weeks={weeks} active={open} onPick={(wk) => setOpen(open === wk ? null : wk)} />

      {open != null && (
        <div className={`mt-3 rounded-lg border ${BD} p-3`}>
          <div className="flex items-baseline justify-between gap-2">
            <span className={`text-sm font-medium ${W}`}>{weekLabel(open)}</span>
            <button onClick={() => setOpen(null)} className={`text-xs ${F} hover:underline`}>close</button>
          </div>
          <ul className={`mt-1 space-y-0.5 ${SCROLL}`}>
            {!rows.length && <li className={`py-1 text-sm ${F}`}>Nothing recorded for this week.</li>}
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-2 py-0.5">
                <span className={`min-w-0 flex-1 truncate text-sm ${M}`}>{name(r)}</span>
                <span className={`font-mono text-sm ${W}`}>{cash(r.amount)}</span>
                <Confirm label="Remove this figure" onConfirm={() => onRemove(r.id)} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
