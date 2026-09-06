import React, { useState, useMemo } from "react";
import { Plus, Wallet, TrendingDown, Check, X, ArrowUpDown } from "lucide-react";
import {
  BD, CARD, PANEL, IN, BTN, PRI, M, F, W, TD, cash, uid, L, Field, Confirm,
  custName, findCustomers, satOf, weekLabel, walletTotals, walletWeeks, DAY, SCROLL, STICKY, dk,
} from "../lib/shared";
import { CustomerForm } from "./admin";
import WipeLine from "./WipeLine";

/* Money that never gets spent.

   Agents top up a wallet and spend it on calls. Every Saturday whatever is
   left is wiped, and that wipe is revenue the business keeps. The number
   worth watching per person is not one week's wipe but the pattern: somebody
   wiped for a lot every week is being sold more than they can use, which is
   a conversation to have before they work it out themselves. */
const WALLET_RANGES = [["4", "Last 4 weeks"], ["12", "Last 12 weeks"], ["26", "Last 26 weeks"], ["all", "All time"], ["custom", "Custom"]];

/* Click to sort, click again to flip it. */
function SortTh({ label, k, sort, set, right }) {
  const on = sort.k === k;
  return (
    <th className={`px-3 py-2 ${right ? "text-right" : "text-left"}`}>
      <button onClick={() => set({ k, d: on && sort.d === "desc" ? "asc" : "desc" })}
        className={`inline-flex items-center gap-1 text-xs font-medium uppercase tracking-wide ${on ? "text-blue-600 dark:text-blue-400" : F}`}>
        {label}<ArrowUpDown className="h-3 w-3" />
      </button>
    </th>
  );
}

export default function Wallets({ customers, wipes, n, onRecord, onRemove, onAddCustomer, onRemoveCustomer, orphans = [], onDropOrphans }) {
  /* Two boxes, not one. The weekly table and the totals table are different
     jobs — filtering one from a box sitting in the other card is a search
     nobody would think to look for. */
  const [wq, setWq] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState({ k: "total", d: "desc" });
  const [range, setRange] = useState("all");
  const [ra, setRa] = useState(dk(Date.now() - 84 * DAY)), [rb, setRb] = useState(dk(Date.now()));
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
  /* Scopes the analysis below — who is being wiped, and the shape over time.
     The headline tiles stay lifetime and current-week, so the two big numbers
     never quietly change meaning under a filter. */
  const [from, to] = useMemo(() => {
    if (range === "all") return [0, Infinity];
    if (range === "custom") {
      const f = Date.parse(ra + "T00:00:00"), t = Date.parse(rb + "T23:59:59");
      return [isNaN(f) ? 0 : f, isNaN(t) ? Infinity : t];
    }
    return [satOf(Date.now() - (Number(range) - 1) * 7 * DAY), Infinity];
  }, [range, ra, rb]);
  const scoped = useMemo(() => rows.filter((w) => w.at >= from && w.at <= to), [rows, from, to]);

  const totals = useMemo(() => walletTotals(users, scoped), [users, scoped]);
  /* The actual current Saturday, not the one being edited. Navigating back to
     fill in a past week used to silently repoint this tile at that week, so
     the headline said "this week" and showed something else. */
  const nowWeek = satOf(Date.now());
  const wipedNow = useMemo(
    () => rows.filter((w) => satOf(w.at) === nowWeek).reduce((s, w) => s + (w.amount || 0), 0),
    [rows, nowWeek],
  );
  const shown = useMemo(() => {
    const ids = new Set(findCustomers(users, q).map((u) => u.id));
    const rows = totals.filter((t) => ids.has(t.id));
    const dir = sort.d === "asc" ? 1 : -1;
    return rows.sort((a, b) => {
      if (sort.k === "name") return dir * custName(a).localeCompare(custName(b));
      const av = a[sort.k] || 0, bv = b[sort.k] || 0;
      /* Ties on a number fall back to the name, so the order is stable
         instead of reshuffling every time the data reloads. */
      return av === bv ? custName(a).localeCompare(custName(b)) : dir * (av - bv);
    });
  }, [totals, users, q, sort]);

  const weeks = useMemo(() => walletWeeks(scoped), [scoped]);
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
      <div className="flex flex-wrap items-center gap-2">
        <div className={`flex flex-wrap gap-1 rounded-lg border ${BD} bg-white p-1 dark:bg-slate-900`}>
          {WALLET_RANGES.map(([id, label]) => (
            <button key={id} onClick={() => setRange(id)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${range === id
                ? "bg-blue-600 text-white" : `${M} hover:bg-slate-200 dark:hover:bg-slate-800`}`}>{label}</button>
          ))}
        </div>
        {range === "custom" && (
          <div className={`flex items-center gap-2 rounded-lg border ${BD} bg-white px-3 py-1.5 dark:bg-slate-900`}>
            <div className="w-40"><input type="date" value={ra} onChange={(e) => setRa(e.target.value)} className={IN} /></div>
            <span className={`text-sm ${F}`}>to</span>
            <div className="w-40"><input type="date" value={rb} onChange={(e) => setRb(e.target.value)} className={IN} /></div>
          </div>
        )}
        <span className={`text-xs ${F}`}>scopes “By person” and the chart below</span>
      </div>

      {!!orphans.length && (
        <div className={`rounded-xl border-l-4 border-amber-500 ${PANEL} px-4 py-3`}>
          <h3 className={`text-sm font-semibold ${W}`}>
            {cash(orphans.reduce((s2, w) => s2 + (w.amount || 0), 0))} is recorded against{" "}
            {new Set(orphans.map((w) => w.userId)).size} {new Set(orphans.map((w) => w.userId)).size === 1 ? "person" : "people"} who
            {new Set(orphans.map((w) => w.userId)).size === 1 ? " is" : " are"} no longer on the board
          </h3>
          <p className={`mt-0.5 text-sm ${M}`}>
            It counts in the totals above but appears in none of the lists, which is why they don't add up.
            Removing somebody now takes their figures with them; this is what earlier removals left behind.
          </p>
          <ul className={`mt-2 max-h-32 space-y-0.5 overflow-auto text-xs ${F}`}>
            {orphans.slice(0, 20).map((w) => (
              <li key={w.id}>{w.name || "Removed person"} · {cash(w.amount)} · {weekLabel(satOf(w.at))}</li>
            ))}
            {orphans.length > 20 && <li>and {orphans.length - 20} more</li>}
          </ul>
          <button onClick={onDropOrphans} className={`mt-3 ${BTN}`}>
            Remove these {orphans.length} figure{orphans.length === 1 ? "" : "s"}
          </button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Wiped all time" value={cash(wipedAllTime)} note={`${weeks.length} week${weeks.length === 1 ? "" : "s"} recorded`} />
        {/* Follows the week being looked at, and names it. A tile that says
            "this week" while showing another one is how the number came to
            look broken; a tile that ignores the week you navigated to looks
            broken too. So it tracks, and the label tracks with it. */}
        <Tile label={week === nowWeek ? "Wiped this week" : "Wiped that week"}
          value={cash(wipedThisWeek)}
          note={`${weekLabel(week)}${week === nowWeek ? "" : " · not the current week"}`} />
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
              {cash(wipedThisWeek)} recorded so far, {thisWeek.size} of {users.length} entered.
              Leave someone blank if they weren't wiped.
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
                      <th className={`px-3 py-2 text-right text-xs font-medium uppercase tracking-wide ${F}`}>Amount wiped</th>
                      <th className="w-8 px-3 py-2"><span className="sr-only">Remove</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {!forWeek.length && (
                      <tr><td colSpan={3} className={`px-3 py-6 text-center text-sm ${M}`}>Nobody matches “{wq}”.</td></tr>
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
                              {/* Taking a figure back out has to be as easy as
                                  putting it in. It used to mean finding the
                                  right point on a chart. */}
                              <span className="w-8 shrink-0">
                                {already && <Confirm label={`Remove ${cash(already.amount)} for ${custName(u)}`}
                                  onConfirm={() => onRemove(already.id)} />}
                              </span>
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
            <span className={`font-normal ${F}`}>
              {range === "all" ? "all time" : range === "custom" ? `${ra} to ${rb}` : `last ${range} weeks`}
            </span>
          </h3>
          <button onClick={() => setAdding({})} className={`${BTN} flex items-center gap-1.5`}>
            <Plus className="h-3.5 w-3.5" /> Add person
          </button>
        </div>
        {!!users.length && (
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email…" className={`${IN} mt-3`} />
        )}

        <p className={`mt-2 text-xs ${F}`}>
          Removing somebody takes them off this list, out of Customers, and takes their recorded figures with them —
          so the totals above always match what you can see here.
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
                    <SortTh label="Person" k="name" sort={sort} set={setSort} />
                    <SortTh label="Total wiped" k="total" sort={sort} set={setSort} right />
                    <SortTh label="Weeks" k="count" sort={sort} set={setSort} right />
                    <SortTh label="Average" k="average" sort={sort} set={setSort} right />
                    <SortTh label="Last" k="lastAt" sort={sort} set={setSort} right />
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

      <WipeLine points={weeks.map((w) => ({ at: w.week, value: w.total, note: `${w.count} ${w.count === 1 ? "person" : "people"}` }))}
        active={open} onPick={(wk) => setOpen(open === wk ? null : wk)} />

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
