import Link from "next/link";
import type { AccountRow, Slice, TxRow } from "@/lib/analytics";
import { getEntity } from "@/lib/entities";
import { shortDate, usd } from "@/lib/format";

export function Stat({
  label,
  value,
  delta,
  deltaGood,
}: {
  label: string;
  value: string;
  delta?: React.ReactNode;
  /** true = green, false = red, undefined = neutral */
  deltaGood?: boolean;
}) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value num">{value}</div>
      {delta && (
        <div className={`delta ${deltaGood === true ? "up" : deltaGood === false ? "down" : ""}`}>{delta}</div>
      )}
    </div>
  );
}

/** Ranked horizontal bars (one hue — the data is magnitude, not identity). */
export function BarList({
  rows,
  color,
  total,
  hrefFor,
  empty = "Nothing in this period",
}: {
  rows: Slice[];
  color: string;
  total?: number;
  hrefFor?: (label: string) => string | null;
  empty?: string;
}) {
  if (rows.length === 0) return <p className="muted">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.value));
  const sum = total ?? rows.reduce((s, r) => s + r.value, 0);
  return (
    <div className="barlist">
      {rows.map((r) => {
        const href = hrefFor?.(r.label);
        return (
          <div className="row" key={r.label} title={`${r.label}: ${usd(r.value, { cents: true })} · ${r.count} transactions`}>
            {href ? (
              <Link className="name" href={href}>
                {r.label}
              </Link>
            ) : (
              <span className="name">{r.label}</span>
            )}
            <span className="val num">
              {usd(r.value)}
              <small>{sum ? Math.round((r.value / sum) * 100) : 0}%</small>
            </span>
            <span className="track">
              <span className="fill" style={{ width: `${max ? (r.value / max) * 100 : 0}%`, background: color, display: "block" }} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function EntityDot({ id }: { id: string }) {
  return <span className="dot" style={{ background: `var(--entity-${id})` }} title={getEntity(id)?.name} />;
}

export function AccountsTable({ rows, showEntity }: { rows: AccountRow[]; showEntity: boolean }) {
  if (rows.length === 0) return <p className="muted">No accounts connected yet.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Account</th>
            {showEntity && <th>Company</th>}
            <th>Type</th>
            <th className="r">Balance</th>
            <th className="r">Available</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.account_id}>
              <td>
                {a.name} <span className="muted">{a.mask ? `••${a.mask}` : ""}</span>
                <div className="muted" style={{ fontSize: 12 }}>{a.institution_name}</div>
              </td>
              {showEntity && (
                <td>
                  <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                    <EntityDot id={a.entity_id} />
                    {getEntity(a.entity_id)?.short}
                  </span>
                </td>
              )}
              <td className="muted">{a.subtype || a.type}</td>
              <td className="r num">{usd(a.type === "credit" || a.type === "loan" ? -(a.current_balance ?? 0) : a.current_balance, { cents: true })}</td>
              <td className="r num muted">{a.available_balance == null ? "—" : usd(a.available_balance, { cents: true })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TxMiniTable({ rows, showEntity }: { rows: TxRow[]; showEntity: boolean }) {
  if (rows.length === 0) return <p className="muted">No transactions yet.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Description</th>
            {showEntity && <th>Co.</th>}
            <th>Category</th>
            <th className="r">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.transaction_id}>
              <td className="muted">{shortDate(t.date)}</td>
              <td>
                {t.merchant_name || t.name} {t.pending ? <span className="tag">pending</span> : null}
              </td>
              {showEntity && (
                <td>
                  <EntityDot id={t.entity_id} />
                </td>
              )}
              <td className="muted">{t.category_name ?? "Uncategorized"}</td>
              <td className={`r num ${t.amount > 0 ? "amount-in" : ""}`}>{usd(t.amount, { cents: true, sign: true })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="table-toggle">
      <summary>Show as table</summary>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {head.map((h, i) => (
                <th key={h} className={i ? "r" : ""}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((v, j) => (
                  <td key={j} className={j ? "r num" : ""}>
                    {v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export function pctChange(cur: number, prev: number): { text: string; dir: 1 | -1 | 0 } {
  if (!prev) return { text: "no prior month", dir: 0 };
  const ch = ((cur - prev) / Math.abs(prev)) * 100;
  return { text: `${ch >= 0 ? "▲" : "▼"} ${Math.abs(ch).toFixed(0)}% vs same days last month`, dir: ch > 0 ? 1 : ch < 0 ? -1 : 0 };
}
