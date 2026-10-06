"use client";

import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useCssVars } from "./useCssVars";

const VARS = ["--income", "--spending", "--net", "--entity-thrive", "--entity-leadtech", "--grid", "--muted", "--surface"] as const;

const compact = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(n);
const full = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

interface Series {
  key: string;
  label: string;
  color: string;
  kind: "bar" | "line";
}

interface TipProps {
  active?: boolean;
  label?: string | number;
  payload?: readonly { dataKey?: unknown; value?: unknown }[];
  series: Series[];
}

function Tip({ active, payload, label, series }: TipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tip">
      <div className="t">{label}</div>
      {series.map((s) => {
        const p = payload.find((x) => x.dataKey === s.key);
        if (!p || p.value == null) return null;
        return (
          <div className="r" key={s.key}>
            <span>
              <i className="dot" style={{ background: s.color, borderRadius: s.kind === "line" ? 1 : 3, height: s.kind === "line" ? 2 : 9 }} />
              {s.label}
            </span>
            <b className="num">{full(Number(p.value))}</b>
          </div>
        );
      })}
    </div>
  );
}

function Legend({ series }: { series: Series[] }) {
  return (
    <div className="legend" style={{ marginBottom: 8 }}>
      {series.map((s) => (
        <span key={s.key}>
          <i className={`sw ${s.kind === "line" ? "line" : ""}`} style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

function axisProps(c: Record<string, string>) {
  return {
    x: { tickLine: false, axisLine: { stroke: c["--grid"] }, tick: { fill: c["--muted"], fontSize: 12 } },
    y: { tickLine: false, axisLine: false, tick: { fill: c["--muted"], fontSize: 12 }, tickFormatter: compact, width: 56 },
  };
}

/** Monthly income vs spending bars with a net line (all USD, one axis). */
export function CashflowChart({ data }: { data: { label: string; income: number; spending: number; net: number }[] }) {
  const c = useCssVars(VARS);
  const a = axisProps(c);
  const series: Series[] = [
    { key: "income", label: "Money in", color: c["--income"], kind: "bar" },
    { key: "spending", label: "Money out", color: c["--spending"], kind: "bar" },
    { key: "net", label: "Net", color: c["--net"], kind: "line" },
  ];
  return (
    <>
      <Legend series={series} />
      <div style={{ height: 260 }}>
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke={c["--grid"]} />
            <XAxis dataKey="label" {...a.x} />
            <YAxis {...a.y} />
            <Tooltip cursor={{ fill: c["--grid"], opacity: 0.5 }} content={(p: Omit<TipProps, "series">) => <Tip active={p.active} payload={p.payload} label={p.label} series={series} />} />
            <Bar isAnimationActive={false} dataKey="income" fill={series[0].color} radius={[4, 4, 0, 0]} maxBarSize={28} />
            <Bar isAnimationActive={false} dataKey="spending" fill={series[1].color} radius={[4, 4, 0, 0]} maxBarSize={28} />
            <Line isAnimationActive={false} dataKey="net" stroke={series[2].color} strokeWidth={2} dot={{ r: 3, strokeWidth: 2, fill: c["--surface"] }} activeDot={{ r: 5 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

/** Net cash flow per company per month. */
export function EntityNetChart({ data }: { data: { label: string; thrive: number; leadtech: number }[] }) {
  const c = useCssVars(VARS);
  const a = axisProps(c);
  const series: Series[] = [
    { key: "thrive", label: "Thrive Companies", color: c["--entity-thrive"], kind: "bar" },
    { key: "leadtech", label: "Lead Tech", color: c["--entity-leadtech"], kind: "bar" },
  ];
  return (
    <>
      <Legend series={series} />
      <div style={{ height: 240 }}>
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke={c["--grid"]} />
            <XAxis dataKey="label" {...a.x} />
            <YAxis {...a.y} />
            <Tooltip cursor={{ fill: c["--grid"], opacity: 0.5 }} content={(p: Omit<TipProps, "series">) => <Tip active={p.active} payload={p.payload} label={p.label} series={series} />} />
            {series.map((s) => (
              <Bar isAnimationActive={false} key={s.key} dataKey={s.key} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={28} />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

/** Investment value over time, stacked by company. */
export function InvestmentChart({
  data,
  entities,
}: {
  data: { label: string; thrive: number | null; leadtech: number | null }[];
  entities: ("thrive" | "leadtech")[];
}) {
  const c = useCssVars(VARS);
  const a = axisProps(c);
  const all: Series[] = [
    { key: "thrive", label: "Thrive Companies", color: c["--entity-thrive"], kind: "bar" },
    { key: "leadtech", label: "Lead Tech", color: c["--entity-leadtech"], kind: "bar" },
  ];
  const series = all.filter((s) => entities.includes(s.key as "thrive" | "leadtech"));
  return (
    <>
      {series.length > 1 && <Legend series={series} />}
      <div style={{ height: 260 }}>
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={c["--grid"]} />
            <XAxis dataKey="label" {...a.x} minTickGap={40} />
            <YAxis {...a.y} domain={["auto", "auto"]} />
            <Tooltip content={(p: Omit<TipProps, "series">) => <Tip active={p.active} payload={p.payload} label={p.label} series={series} />} />
            {series.map((s) => (
              <Area
                isAnimationActive={false}
                key={s.key}
                dataKey={s.key}
                stackId="1"
                type="monotone"
                stroke={s.color}
                strokeWidth={2}
                fill={s.color}
                fillOpacity={0.18}
                connectNulls
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

/** Small single-series trend used on the KPI page. */
export function TrendChart({
  data,
  format,
}: {
  data: { label: string; value: number | null }[];
  format: "usd" | "count" | "pct" | "ratio";
}) {
  const c = useCssVars(VARS);
  const a = axisProps(c);
  const fmt = (n: number) =>
    format === "usd" ? compact(n) : format === "pct" ? `${+n.toFixed(1)}%` : format === "ratio" ? `${n.toFixed(1)}×` : n.toLocaleString();
  return (
    <div style={{ height: 160 }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={c["--grid"]} />
          <XAxis dataKey="label" {...a.x} />
          <YAxis {...a.y} tickFormatter={fmt} />
          <Tooltip
            content={({ active, payload, label }) =>
              active && payload?.length && payload[0].value != null ? (
                <div className="chart-tip">
                  <div className="t">{label}</div>
                  <b className="num">
                    {format === "usd" ? full(Number(payload[0].value)) : fmt(Number(payload[0].value))}
                  </b>
                </div>
              ) : null
            }
          />
          <Line isAnimationActive={false} dataKey="value" stroke={c["--income"]} strokeWidth={2} dot={{ r: 3, strokeWidth: 2, fill: c["--surface"] }} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
