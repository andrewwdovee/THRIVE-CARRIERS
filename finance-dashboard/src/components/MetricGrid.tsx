"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatUnit } from "@/lib/format";
import type { InputMetric, MetricMonth, Unit } from "@/lib/metrics-types";

function Cell({
  entity,
  month,
  metric,
  value,
  fromBank,
  unit,
}: {
  entity: string;
  month: string;
  metric: string;
  value: number | null;
  fromBank: boolean;
  unit: Unit;
}) {
  const router = useRouter();
  const initial = value == null ? "" : String(fromBank || unit === "usd" ? Math.round(value) : Math.round(value * 100) / 100);
  const [v, setV] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  async function save() {
    if (v === initial) return;
    const clean = v.replace(/[$,%\s]/g, "");
    if (clean !== "" && Number.isNaN(Number(clean))) return setState("error");
    setState("saving");
    const res = await fetch("/api/metrics", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entity, month, metric, value: clean === "" ? null : Number(clean) }),
    });
    setState(res.ok ? "idle" : "error");
    router.refresh();
  }
  return (
    <input
      inputMode="decimal"
      aria-label={`${metric} ${month}`}
      className={`num ${fromBank ? "bank" : ""}`}
      value={v}
      placeholder="—"
      title={fromBank ? `From bank transactions: ${formatUnit(value, unit)}` : undefined}
      onChange={(e) => setV(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      style={state === "error" ? { borderColor: "var(--bad)" } : state === "saving" ? { opacity: 0.6 } : undefined}
    />
  );
}

export function MetricGrid({
  entity,
  months,
  inputs,
  bank,
  derived,
  data,
}: {
  entity: string;
  months: { id: string; label: string }[];
  inputs: InputMetric[];
  bank: InputMetric[];
  derived: { key: string; label: string; unit: Unit }[];
  data: MetricMonth[];
}) {
  const row = (m: InputMetric) => (
    <tr key={m.key}>
      <td title={m.help}>
        {m.label}
        {m.unit === "usd" ? <span className="muted"> ($)</span> : m.unit === "pct" ? <span className="muted"> (%)</span> : null}
      </td>
      {data.map((d) => (
        <td key={d.month} className="r">
          <Cell
            key={`${d.month}-${m.key}-${d.values[m.key]}`}
            entity={entity}
            month={d.month}
            metric={m.key}
            value={d.values[m.key]}
            fromBank={d.fromBank[m.key]}
            unit={m.unit}
          />
        </td>
      ))}
    </tr>
  );
  return (
    <div className="table-wrap metric-grid">
      <table>
        <thead>
          <tr>
            <th>Metric</th>
            {months.map((m) => (
              <th key={m.id} className="r">{m.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr><td colSpan={months.length + 1} className="muted" style={{ fontSize: 12, fontWeight: 600 }}>ACTIVITY (enter by hand)</td></tr>
          {inputs.map(row)}
          <tr><td colSpan={months.length + 1} className="muted" style={{ fontSize: 12, fontWeight: 600 }}>DOLLARS (from bank categories)</td></tr>
          {bank.map(row)}
          <tr><td colSpan={months.length + 1} className="muted" style={{ fontSize: 12, fontWeight: 600 }}>CALCULATED</td></tr>
          {derived.map((k) => (
            <tr key={k.key}>
              <td><b>{k.label}</b></td>
              {data.map((d) => (
                <td key={d.month} className="r num" style={{ paddingRight: 16 }}>
                  {formatUnit(d.derived[k.key], k.unit)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
