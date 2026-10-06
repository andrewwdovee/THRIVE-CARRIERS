import Link from "next/link";
import { TrendChart } from "@/components/Charts";
import { MetricGrid } from "@/components/MetricGrid";
import { monthLabel, monthsFor, parseRange } from "@/lib/analytics";
import { ENTITIES, getEntity, isEntityId } from "@/lib/entities";
import { formatUnit } from "@/lib/format";
import { METRIC_DEFS, metricsFor } from "@/lib/metrics";

export default async function KpiPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const entity = sp.entity && isEntityId(sp.entity) ? sp.entity : "thrive";
  const range = sp.range ? parseRange(sp.range) : "12m";
  const months = monthsFor(range);
  const data = metricsFor(entity, months);
  const defs = METRIC_DEFS[entity];
  const e = getEntity(entity)!;

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Business KPIs</h1>
          <div className="sub">
            {e.name} · {e.description}. Type monthly numbers into the grid; dollar rows fill in from categorized bank
            transactions unless you override them.
          </div>
        </div>
        <div className="actions">
          <nav className="switcher" aria-label="Company">
            {ENTITIES.map((x) => (
              <Link key={x.id} href={`/kpis?entity=${x.id}&range=${range}`} aria-current={x.id === entity ? "page" : undefined}>
                <span className="dot" style={{ background: `var(${x.colorVar})` }} />
                {x.name}
              </Link>
            ))}
          </nav>
          <nav className="switcher" aria-label="Range">
            {(["6m", "12m", "ytd"] as const).map((r) => (
              <Link key={r} href={`/kpis?entity=${entity}&range=${r}`} aria-current={r === range ? "page" : undefined}>
                {r === "ytd" ? "YTD" : r}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      <div className="grid cols-3">
        {defs.derived.map((d) => {
          const series = data.map((m) => ({ label: monthLabel(m.month), value: m.derived[d.key] }));
          // Headline the last complete month; the current month is still filling in.
          const complete = data.filter((m) => m.month < months[months.length - 1] || months.length === 1);
          const latest = [...complete].reverse().find((m) => m.derived[d.key] != null);
          return (
            <div className="card" key={d.key}>
              <div className="card-head">
                <h2>{d.label}</h2>
                <b className="num">{formatUnit(latest?.derived[d.key] ?? null, d.unit)}</b>
              </div>
              <p className="hint">
                {d.help}
                {latest ? ` · ${monthLabel(latest.month, true)}` : ""}
              </p>
              <TrendChart data={series} format={d.unit} />
            </div>
          );
        })}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Monthly numbers</h2>
        <p className="hint">
          Click a cell to edit; it saves when you leave the cell. <i>Italic grey</i> values come from bank transactions —
          type over one to override it, clear it to go back to the bank figure.
        </p>
        <MetricGrid
          entity={entity}
          months={months.map((m) => ({ id: m, label: monthLabel(m, true) }))}
          inputs={defs.inputs}
          bank={defs.bank}
          derived={defs.derived.map(({ key, label, unit }) => ({ key, label, unit }))}
          data={data}
        />
      </div>
    </>
  );
}
