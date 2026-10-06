import { db } from "./db";
import type { EntityId } from "./entities";

export interface HoldingRow {
  account_id: string;
  account_name: string;
  entity_id: EntityId;
  security_id: string;
  name: string | null;
  ticker: string | null;
  type: string | null;
  quantity: number;
  price: number | null;
  value: number;
  cost_basis: number | null;
  updated_at: string | null;
}

export function holdings(entity: EntityId | null): HoldingRow[] {
  return db()
    .prepare(
      `SELECT h.account_id, a.name AS account_name, a.entity_id, h.security_id, s.name, s.ticker, s.type,
              h.quantity, h.institution_price AS price, h.institution_value AS value, h.cost_basis, h.updated_at
       FROM holdings h JOIN accounts a ON a.account_id = h.account_id JOIN securities s ON s.security_id = h.security_id
       WHERE a.hidden = 0 ${entity ? "AND a.entity_id = ?" : ""}
       ORDER BY h.institution_value DESC`,
    )
    .all(...(entity ? [entity] : [])) as HoldingRow[];
}

export function allocation(rows: HoldingRow[]) {
  const by = new Map<string, number>();
  for (const r of rows) {
    const k = typeLabel(r.type);
    by.set(k, (by.get(k) ?? 0) + (r.value ?? 0));
  }
  return [...by.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

export function typeLabel(t: string | null) {
  switch (t) {
    case "equity":
      return "Stocks";
    case "etf":
      return "ETFs";
    case "mutual fund":
      return "Mutual funds";
    case "fixed income":
      return "Bonds";
    case "cash":
      return "Cash";
    case "cryptocurrency":
      return "Crypto";
    case "derivative":
      return "Options";
    default:
      return "Other";
  }
}

/** Daily total value per entity, oldest first. */
export function valueHistory(days = 180): { date: string; thrive: number | null; leadtech: number | null }[] {
  const rows = db()
    .prepare(
      `SELECT date, entity_id, value FROM investment_snapshots WHERE date >= date('now', ?) ORDER BY date`,
    )
    .all(`-${days} days`) as { date: string; entity_id: string; value: number }[];
  const dates = [...new Set(rows.map((r) => r.date))];
  return dates.map((date) => ({
    date,
    thrive: rows.find((r) => r.date === date && r.entity_id === "thrive")?.value ?? null,
    leadtech: rows.find((r) => r.date === date && r.entity_id === "leadtech")?.value ?? null,
  }));
}
