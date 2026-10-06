import Link from "next/link";
import { InvestmentChart } from "@/components/Charts";
import { SyncButton } from "@/components/SyncButton";
import { BarList, DataTable, Stat } from "@/components/ui";
import { lastSync } from "@/lib/analytics";
import { ENTITIES, getEntity, isEntityId } from "@/lib/entities";
import { relativeTime, shortDate, usd } from "@/lib/format";
import { allocation, holdings, typeLabel, valueHistory } from "@/lib/investments";

export default async function InvestmentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const entity = sp.entity && isEntityId(sp.entity) ? sp.entity : null;
  const rows = holdings(entity);
  const value = rows.reduce((s, r) => s + (r.value ?? 0), 0);
  const cost = rows.reduce((s, r) => s + (r.cost_basis ?? 0), 0);
  const hasCost = rows.some((r) => r.cost_basis != null);
  const gain = value - cost;
  const alloc = allocation(rows);
  const days = Number(sp.days) || 180;
  const history = valueHistory(days).map((h) => ({
    ...h,
    label: shortDate(h.date),
    ...(entity === "thrive" ? { leadtech: null } : entity === "leadtech" ? { thrive: null } : {}),
  }));
  const first = history.find((h) => (entity ? h[entity] : (h.thrive ?? 0) + (h.leadtech ?? 0)) != null);
  const firstVal = first ? (entity ? first[entity] ?? 0 : (first.thrive ?? 0) + (first.leadtech ?? 0)) : null;
  const change = firstVal ? value - firstVal : null;

  const tab = (id: string | null, label: string) => (
    <Link href={id ? `/investments?entity=${id}` : "/investments"} aria-current={entity === id ? "page" : undefined}>
      {id && <span className="dot" style={{ background: `var(--entity-${id})` }} />}
      {label}
    </Link>
  );

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Investments</h1>
          <div className="sub">Brokerage and treasury holdings. Refreshed with every scheduled sync (twice a day) and on Plaid holdings updates.</div>
        </div>
        <div className="actions">
          <nav className="switcher" aria-label="Company">
            {tab(null, "Both")}
            {ENTITIES.map((e) => tab(e.id, e.name))}
          </nav>
          <SyncButton lastSync={relativeTime(lastSync())} />
        </div>
      </div>

      <div className="grid cols-4">
        <Stat label="Total value" value={usd(value)} />
        <Stat
          label="Unrealized gain / loss"
          value={hasCost ? usd(gain, { sign: true }) : "—"}
          delta={hasCost && cost ? `${((gain / cost) * 100).toFixed(1)}% on ${usd(cost)} cost basis` : "Cost basis not reported"}
          deltaGood={hasCost ? gain >= 0 : undefined}
        />
        <Stat
          label={`Change · last ${days} days`}
          value={change == null ? "—" : usd(change, { sign: true })}
          delta={change != null && firstVal ? `${((change / firstVal) * 100).toFixed(1)}% (includes deposits)` : "Builds up as daily snapshots accumulate"}
          deltaGood={change == null ? undefined : change >= 0}
        />
        <Stat label="Positions" value={String(rows.length)} delta={`${new Set(rows.map((r) => r.account_id)).size} accounts`} />
      </div>

      <div className="grid cols-3" style={{ marginTop: 16 }}>
        <div className="card span-2">
          <div className="card-head">
            <h2>Portfolio value</h2>
            <span className="actions">
              {[30, 90, 180, 365].map((d) => (
                <Link key={d} className="btn sm" href={`/investments?${new URLSearchParams({ ...(entity ? { entity } : {}), days: String(d) })}`} aria-current={d === days ? "page" : undefined} style={d === days ? { borderColor: "var(--accent)" } : undefined}>
                  {d === 365 ? "1y" : `${d}d`}
                </Link>
              ))}
            </span>
          </div>
          {history.length > 1 ? (
            <>
              <InvestmentChart data={history} entities={entity ? [entity] : ["thrive", "leadtech"]} />
              <DataTable
                head={["Date", "Thrive", "Lead Tech"]}
                rows={history.slice(-30).map((h) => [h.date, usd(h.thrive), usd(h.leadtech)])}
              />
            </>
          ) : (
            <p className="muted">One snapshot is saved each sync. The trend fills in after a couple of days.</p>
          )}
        </div>
        <div className="card">
          <h2>Allocation</h2>
          <p className="hint">By security type</p>
          <BarList rows={alloc.map((a) => ({ ...a, count: 0 }))} color="var(--income)" empty="No holdings yet" />
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Holdings</h2>
        <p className="hint">Prices as reported by your institution</p>
        {rows.length === 0 ? (
          <p className="muted">
            No investment accounts yet. Link a brokerage in <Link href="/settings">Banks &amp; Settings</Link>; Plaid requests investments access automatically when it&apos;s available.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Security</th>
                  {!entity && <th>Company</th>}
                  <th>Account</th>
                  <th>Type</th>
                  <th className="r">Quantity</th>
                  <th className="r">Price</th>
                  <th className="r">Value</th>
                  <th className="r">Cost basis</th>
                  <th className="r">Gain / loss</th>
                  <th className="r">Weight</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((h) => {
                  const g = h.cost_basis != null ? h.value - h.cost_basis : null;
                  return (
                    <tr key={`${h.account_id}-${h.security_id}`}>
                      <td>
                        <b>{h.ticker || "—"}</b> <span className="muted">{h.name}</span>
                      </td>
                      {!entity && (
                        <td>
                          <span className="dot" style={{ background: `var(--entity-${h.entity_id})` }} /> {getEntity(h.entity_id)?.short}
                        </td>
                      )}
                      <td className="muted">{h.account_name}</td>
                      <td className="muted">{typeLabel(h.type)}</td>
                      <td className="r num">{h.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                      <td className="r num">{usd(h.price, { cents: true })}</td>
                      <td className="r num"><b>{usd(h.value)}</b></td>
                      <td className="r num muted">{usd(h.cost_basis)}</td>
                      <td className={`r num ${g == null ? "" : g >= 0 ? "up" : "down"}`}>
                        {g == null ? "—" : `${usd(g, { sign: true })} (${h.cost_basis ? ((g / h.cost_basis) * 100).toFixed(1) : "0"}%)`}
                      </td>
                      <td className="r num muted">{value ? ((h.value / value) * 100).toFixed(1) : 0}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
