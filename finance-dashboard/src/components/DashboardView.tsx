import Link from "next/link";
import {
  accounts,
  balances,
  cashflowByMonth,
  categoryByMonth,
  flowBetween,
  hasAnyData,
  incomeByCategory,
  incomeBySource,
  lastSync,
  monthLabel,
  monthsFor,
  netByEntityByMonth,
  spendingByCategory,
  spendingByPayee,
  transactions,
  type Range,
} from "@/lib/analytics";
import { ENTITIES, getEntity, type EntityId } from "@/lib/entities";
import { relativeTime, usd, formatUnit } from "@/lib/format";
import { METRIC_DEFS, metricsFor } from "@/lib/metrics";
import { plaidConfigured } from "@/lib/plaid";
import { db } from "@/lib/db";
import { CashflowChart, EntityNetChart } from "./Charts";
import { DashboardSwitcher } from "./DashboardSwitcher";
import { EmptyState } from "./EmptyState";
import { RangePicker } from "./RangePicker";
import { SyncButton } from "./SyncButton";
import { AccountsTable, BarList, DataTable, Stat, TxMiniTable, pctChange } from "./ui";

export function DashboardView({ entity, range }: { entity: EntityId | null; range: Range }) {
  const e = entity ? getEntity(entity)! : null;
  const title = e ? e.name : "Overview";
  const subtitle = e ? `${e.description} · cash flow, accounts and KPIs` : "Thrive Companies + Lead Tech combined";

  const header = (
    <div className="topbar">
      <div>
        <h1>{title}</h1>
        <div className="sub">{subtitle}</div>
      </div>
      <div className="actions">
        <DashboardSwitcher active={entity} range={range} />
        <RangePicker value={range} />
        <SyncButton lastSync={relativeTime(lastSync())} />
      </div>
    </div>
  );

  if (!hasAnyData()) {
    return (
      <>
        {header}
        <EmptyState plaidReady={plaidConfigured()} />
      </>
    );
  }

  const months = monthsFor(range);
  const from = months[0];
  const to = months[months.length - 1];
  const flow = cashflowByMonth(entity, months);
  const bal = balances(entity);
  const totalIn = flow.reduce((s, m) => s + m.income, 0);
  const totalOut = flow.reduce((s, m) => s + m.spending, 0);
  // Month-to-date vs the same days of last month, so a partial month isn't compared to a full one.
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const thisStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastSameDay = new Date(now.getFullYear(), now.getMonth() - 1, Math.min(now.getDate(), new Date(now.getFullYear(), now.getMonth(), 0).getDate()));
  const thisM = flowBetween(entity, isoDay(thisStart), isoDay(now));
  const lastM = flowBetween(entity, isoDay(lastStart), isoDay(lastSameDay));
  const mtdLabel = `${monthLabel(to)} 1–${now.getDate()}`;
  const inCh = pctChange(thisM.income, lastM.income);
  const outCh = pctChange(thisM.spending, lastM.spending);

  const spendCats = spendingByCategory(entity, from, to);
  const incomeCats = incomeByCategory(entity, from, to);
  const sources = incomeBySource(entity, from, to);
  const payees = spendingByPayee(entity, from, to);
  const matrix = categoryByMonth(entity, months, "expense").slice(0, 12);
  const accts = accounts(entity);
  const recent = transactions({ entity, limit: 10 }).rows;
  const problems = db()
    .prepare(`SELECT institution_name, status FROM plaid_items WHERE status != 'ok' ${entity ? "AND entity_id = ?" : ""}`)
    .all(...(entity ? [entity] : [])) as { institution_name: string | null; status: string }[];

  const chartData = flow.map((m) => ({ ...m, label: monthLabel(m.month) }));
  const txHref = (extra: Record<string, string>) =>
    `/transactions?${new URLSearchParams({ ...(entity ? { entity } : {}), ...extra }).toString()}`;
  const catId = new Map(
    (db().prepare("SELECT id, name FROM categories").all() as { id: number; name: string }[]).map((c) => [c.name, c.id]),
  );
  const catHref = (label: string) => (catId.has(label) ? txHref({ category: String(catId.get(label)) }) : null);

  return (
    <>
      {header}

      {problems.length > 0 && (
        <div className="banner err">
          {problems.map((p) => p.institution_name || "A bank").join(", ")} need{problems.length === 1 ? "s" : ""} attention —{" "}
          <Link href="/settings">reconnect in Settings</Link>.
        </div>
      )}

      <div className="grid cols-4">
        <Stat label="Cash on hand" value={usd(bal.cash)} delta={bal.credit ? `${usd(bal.credit)} on credit cards` : undefined} />
        <Stat label="Investments" value={usd(bal.investments)} delta={<Link href="/investments">View holdings →</Link>} />
        <Stat
          label={`Money in · ${mtdLabel}`}
          value={usd(thisM.income)}
          delta={inCh.text}
          deltaGood={inCh.dir === 0 ? undefined : inCh.dir > 0}
        />
        <Stat
          label={`Money out · ${mtdLabel}`}
          value={usd(thisM.spending)}
          delta={outCh.text}
          deltaGood={outCh.dir === 0 ? undefined : outCh.dir < 0}
        />
      </div>

      <div className="grid cols-3" style={{ marginTop: 16 }}>
        <div className="card span-2">
          <div className="card-head">
            <h2>Monthly cash flow</h2>
            <span className="muted num">
              {usd(totalIn)} in · {usd(totalOut)} out · <b className={totalIn - totalOut >= 0 ? "up" : "down"}>{usd(totalIn - totalOut, { sign: true })} net</b>
            </span>
          </div>
          <CashflowChart data={chartData} />
          <DataTable
            head={["Month", "Money in", "Money out", "Net"]}
            rows={flow.map((m) => [monthLabel(m.month, true), usd(m.income), usd(m.spending), usd(m.net, { sign: true })])}
          />
        </div>
        <div className="card">
          <h2>Net worth</h2>
          <p className="hint">Cash + investments − cards − loans</p>
          <div className="stat">
            <div className="value num">{usd(bal.netWorth)}</div>
          </div>
          <table style={{ marginTop: 12 }}>
            <tbody>
              <tr><td>Cash</td><td className="r num">{usd(bal.cash)}</td></tr>
              <tr><td>Investments</td><td className="r num">{usd(bal.investments)}</td></tr>
              <tr><td>Credit cards</td><td className="r num">{usd(-bal.credit)}</td></tr>
              {bal.loans ? <tr><td>Loans</td><td className="r num">{usd(-bal.loans)}</td></tr> : null}
            </tbody>
          </table>
          <p className="hint" style={{ marginTop: 12 }}>
            Avg monthly net: <b className="num">{usd((totalIn - totalOut) / months.length, { sign: true })}</b>
          </p>
        </div>
      </div>

      {!entity && <CompanyComparison months={months} range={range} />}
      {entity && <KpiSnapshot entity={entity} />}

      <div className="section-title">Where money comes from &amp; goes</div>
      <div className="grid cols-2">
        <div className="card">
          <h2>Spending by category</h2>
          <p className="hint">{monthLabel(from, true)} – {monthLabel(to, true)} · transfers excluded</p>
          <BarList rows={spendCats} color="var(--spending)" hrefFor={catHref} />
        </div>
        <div className="card">
          <h2>Income by category</h2>
          <p className="hint">{monthLabel(from, true)} – {monthLabel(to, true)}</p>
          <BarList rows={incomeCats} color="var(--income)" hrefFor={catHref} />
        </div>
        <div className="card">
          <h2>Top income sources</h2>
          <p className="hint">Who is paying you</p>
          <BarList rows={sources} color="var(--income)" hrefFor={(l) => (l.startsWith("Other (") ? null : txHref({ q: l, dir: "in" }))} />
        </div>
        <div className="card">
          <h2>Top payees</h2>
          <p className="hint">Who you are paying</p>
          <BarList rows={payees} color="var(--spending)" hrefFor={(l) => (l.startsWith("Other (") ? null : txHref({ q: l, dir: "out" }))} />
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <h2>Monthly spending by category</h2>
          <Link className="muted" href={txHref({})}>All transactions →</Link>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Category</th>
                {months.map((m) => (
                  <th key={m} className="r">{monthLabel(m)}</th>
                ))}
                <th className="r">Total</th>
                <th className="r">Avg / mo</th>
              </tr>
            </thead>
            <tbody>
              {matrix.map((row) => (
                <tr key={row.category}>
                  <td>{row.category}</td>
                  {months.map((m) => (
                    <td key={m} className="r num">
                      {row.byMonth[m] ? (
                        <Link href={catId.has(row.category) ? txHref({ category: String(catId.get(row.category)), month: m }) : "#"} style={{ textDecoration: "none" }}>
                          {usd(row.byMonth[m])}
                        </Link>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  ))}
                  <td className="r num"><b>{usd(row.total)}</b></td>
                  <td className="r num muted">{usd(row.total / months.length)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card-head">
            <h2>Accounts</h2>
            <Link className="muted" href="/settings">Manage →</Link>
          </div>
          <AccountsTable rows={accts} showEntity={!entity} />
        </div>
        <div className="card">
          <div className="card-head">
            <h2>Recent transactions</h2>
            <Link className="muted" href={txHref({})}>View all →</Link>
          </div>
          <TxMiniTable rows={recent} showEntity={!entity} />
        </div>
      </div>
    </>
  );
}

function CompanyComparison({ months, range }: { months: string[]; range: Range }) {
  const data = netByEntityByMonth(months).map((m) => ({ ...m, label: monthLabel(m.month) }));
  return (
    <>
      <div className="section-title">By company</div>
      <div className="grid cols-3">
        {ENTITIES.map((e) => {
          const f = cashflowByMonth(e.id, months);
          const b = balances(e.id);
          const inc = f.reduce((s, m) => s + m.income, 0);
          const out = f.reduce((s, m) => s + m.spending, 0);
          return (
            <Link key={e.id} href={`/${e.id}?range=${range}`} className="card" style={{ textDecoration: "none" }}>
              <div className="card-head">
                <h2 style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span className="dot" style={{ background: `var(${e.colorVar})` }} />
                  {e.name}
                </h2>
                <span className="muted">Open →</span>
              </div>
              <table>
                <tbody>
                  <tr><td className="muted">Cash</td><td className="r num">{usd(b.cash)}</td></tr>
                  <tr><td className="muted">Investments</td><td className="r num">{usd(b.investments)}</td></tr>
                  <tr><td className="muted">Money in</td><td className="r num">{usd(inc)}</td></tr>
                  <tr><td className="muted">Money out</td><td className="r num">{usd(out)}</td></tr>
                  <tr><td><b>Net</b></td><td className={`r num ${inc - out >= 0 ? "up" : "down"}`}><b>{usd(inc - out, { sign: true })}</b></td></tr>
                </tbody>
              </table>
            </Link>
          );
        })}
        <div className="card">
          <h2>Net cash flow by company</h2>
          <p className="hint">Money in − money out each month</p>
          <EntityNetChart data={data} />
          <DataTable
            head={["Month", "Thrive", "Lead Tech"]}
            rows={data.map((d) => [monthLabel(d.month, true), usd(d.thrive, { sign: true }), usd(d.leadtech, { sign: true })])}
          />
        </div>
      </div>
    </>
  );
}

function KpiSnapshot({ entity }: { entity: EntityId }) {
  const months = monthsFor("3m");
  const data = metricsFor(entity, months);
  // Headline the last complete month (the current one is still filling in).
  const latest = data[1];
  const prev = data[0];
  const defs = METRIC_DEFS[entity].derived;
  return (
    <>
      <div className="section-title" style={{ display: "flex", justifyContent: "space-between" }}>
        <span>Business KPIs · {monthLabel(latest.month, true)}</span>
        <Link href={`/kpis?entity=${entity}`} style={{ textTransform: "none", letterSpacing: 0 }}>Enter numbers &amp; trends →</Link>
      </div>
      <div className="grid cols-3">
        {defs.map((d) => {
          const v = latest.derived[d.key];
          const p = prev?.derived[d.key];
          let delta: string | undefined;
          let good: boolean | undefined;
          if (v != null && p != null && p !== 0) {
            const ch = ((v - p) / Math.abs(p)) * 100;
            delta = `${ch >= 0 ? "▲" : "▼"} ${Math.abs(ch).toFixed(0)}% vs ${monthLabel(prev!.month)}`;
            good = ch === 0 ? undefined : ch > 0 === d.higherIsBetter;
          } else if (v == null) delta = d.help;
          return <Stat key={d.key} label={d.label} value={formatUnit(v, d.unit)} delta={delta} deltaGood={good} />;
        })}
      </div>
    </>
  );
}
