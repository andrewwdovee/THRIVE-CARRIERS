import { db } from "./db";
import type { EntityId } from "./entities";

import { type Range } from "./analytics-shared";
export * from "./analytics-shared";

/** SQL fragment + params restricting to one entity (or all when null). */
function entityFilter(entity: EntityId | null, col = "t.entity_id"): [string, unknown[]] {
  return entity ? [`AND ${col} = ?`, [entity]] : ["", []];
}

// A transaction counts as a transfer (excluded from income/spend) when its category is a transfer.
const NOT_TRANSFER = "(c.kind IS NULL OR c.kind != 'transfer')";

export interface MonthFlow {
  month: string;
  income: number;
  spending: number;
  net: number;
}

export function cashflowByMonth(entity: EntityId | null, months: string[]): MonthFlow[] {
  const [ef, ep] = entityFilter(entity);
  const rows = db()
    .prepare(
      `SELECT substr(t.date, 1, 7) AS month,
              SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END) AS income,
              SUM(CASE WHEN t.amount < 0 THEN -t.amount ELSE 0 END) AS spending
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
       JOIN accounts a ON a.account_id = t.account_id
       WHERE ${NOT_TRANSFER} AND a.hidden = 0 AND substr(t.date, 1, 7) >= ? AND substr(t.date, 1, 7) <= ? ${ef}
       GROUP BY month`,
    )
    .all(months[0], months[months.length - 1], ...ep) as { month: string; income: number; spending: number }[];
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  return months.map((m) => {
    const r = byMonth.get(m);
    const income = r?.income ?? 0;
    const spending = r?.spending ?? 0;
    return { month: m, income, spending, net: income - spending };
  });
}

/** Money in / out between two ISO dates (inclusive), transfers excluded. */
export function flowBetween(entity: EntityId | null, fromDate: string, toDate: string): { income: number; spending: number } {
  const [ef, ep] = entityFilter(entity);
  const r = db()
    .prepare(
      `SELECT SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END) AS income,
              SUM(CASE WHEN t.amount < 0 THEN -t.amount ELSE 0 END) AS spending
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
       JOIN accounts a ON a.account_id = t.account_id
       WHERE ${NOT_TRANSFER} AND a.hidden = 0 AND t.date BETWEEN ? AND ? ${ef}`,
    )
    .get(fromDate, toDate, ...ep) as { income: number | null; spending: number | null };
  return { income: r.income ?? 0, spending: r.spending ?? 0 };
}

/** Net cash flow per entity per month (for the Overview comparison). */
export function netByEntityByMonth(months: string[]): { month: string; thrive: number; leadtech: number }[] {
  const rows = db()
    .prepare(
      `SELECT substr(t.date, 1, 7) AS month, t.entity_id, SUM(t.amount) AS net
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
       JOIN accounts a ON a.account_id = t.account_id
       WHERE ${NOT_TRANSFER} AND a.hidden = 0 AND substr(t.date, 1, 7) >= ? AND substr(t.date, 1, 7) <= ?
       GROUP BY month, t.entity_id`,
    )
    .all(months[0], months[months.length - 1]) as { month: string; entity_id: string; net: number }[];
  return months.map((m) => ({
    month: m,
    thrive: rows.find((r) => r.month === m && r.entity_id === "thrive")?.net ?? 0,
    leadtech: rows.find((r) => r.month === m && r.entity_id === "leadtech")?.net ?? 0,
  }));
}

export interface Slice {
  label: string;
  value: number;
  count: number;
}

function topN(rows: Slice[], n: number): Slice[] {
  if (rows.length <= n) return rows;
  const head = rows.slice(0, n - 1);
  const tail = rows.slice(n - 1);
  return [
    ...head,
    { label: `Other (${tail.length})`, value: tail.reduce((s, r) => s + r.value, 0), count: tail.reduce((s, r) => s + r.count, 0) },
  ];
}

export function spendingByCategory(entity: EntityId | null, from: string, to: string, n = 10): Slice[] {
  const [ef, ep] = entityFilter(entity);
  const rows = db()
    .prepare(
      `SELECT COALESCE(c.name, 'Uncategorized') AS label, SUM(-t.amount) AS value, COUNT(*) AS count
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
       JOIN accounts a ON a.account_id = t.account_id
       WHERE ${NOT_TRANSFER} AND a.hidden = 0 AND t.amount < 0 AND substr(t.date,1,7) BETWEEN ? AND ? ${ef}
       GROUP BY label ORDER BY value DESC`,
    )
    .all(from, to, ...ep) as Slice[];
  return topN(rows, n);
}

export function incomeByCategory(entity: EntityId | null, from: string, to: string, n = 8): Slice[] {
  const [ef, ep] = entityFilter(entity);
  const rows = db()
    .prepare(
      `SELECT COALESCE(c.name, 'Uncategorized') AS label, SUM(t.amount) AS value, COUNT(*) AS count
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
       JOIN accounts a ON a.account_id = t.account_id
       WHERE ${NOT_TRANSFER} AND a.hidden = 0 AND t.amount > 0 AND substr(t.date,1,7) BETWEEN ? AND ? ${ef}
       GROUP BY label ORDER BY value DESC`,
    )
    .all(from, to, ...ep) as Slice[];
  return topN(rows, n);
}

/** Who is paying you: income grouped by payer (merchant / counterparty name). */
export function incomeBySource(entity: EntityId | null, from: string, to: string, n = 8): Slice[] {
  const [ef, ep] = entityFilter(entity);
  const rows = db()
    .prepare(
      `SELECT COALESCE(NULLIF(t.merchant_name, ''), t.name) AS label, SUM(t.amount) AS value, COUNT(*) AS count
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
       JOIN accounts a ON a.account_id = t.account_id
       WHERE ${NOT_TRANSFER} AND a.hidden = 0 AND t.amount > 0 AND substr(t.date,1,7) BETWEEN ? AND ? ${ef}
       GROUP BY label ORDER BY value DESC`,
    )
    .all(from, to, ...ep) as Slice[];
  return topN(rows, n);
}

/** Where money goes: spending grouped by payee. */
export function spendingByPayee(entity: EntityId | null, from: string, to: string, n = 8): Slice[] {
  const [ef, ep] = entityFilter(entity);
  const rows = db()
    .prepare(
      `SELECT COALESCE(NULLIF(t.merchant_name, ''), t.name) AS label, SUM(-t.amount) AS value, COUNT(*) AS count
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
       JOIN accounts a ON a.account_id = t.account_id
       WHERE ${NOT_TRANSFER} AND a.hidden = 0 AND t.amount < 0 AND substr(t.date,1,7) BETWEEN ? AND ? ${ef}
       GROUP BY label ORDER BY value DESC`,
    )
    .all(from, to, ...ep) as Slice[];
  return topN(rows, n);
}

/** Category x month matrix of spending, for the category trend table. */
export function categoryByMonth(entity: EntityId | null, months: string[], kind: "income" | "expense") {
  const [ef, ep] = entityFilter(entity);
  const sign = kind === "income" ? "t.amount > 0" : "t.amount < 0";
  const rows = db()
    .prepare(
      `SELECT COALESCE(c.name, 'Uncategorized') AS category, substr(t.date,1,7) AS month, SUM(ABS(t.amount)) AS value
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
       JOIN accounts a ON a.account_id = t.account_id
       WHERE ${NOT_TRANSFER} AND a.hidden = 0 AND ${sign} AND substr(t.date,1,7) BETWEEN ? AND ? ${ef}
       GROUP BY category, month`,
    )
    .all(months[0], months[months.length - 1], ...ep) as { category: string; month: string; value: number }[];
  const cats = new Map<string, Record<string, number>>();
  for (const r of rows) {
    if (!cats.has(r.category)) cats.set(r.category, {});
    cats.get(r.category)![r.month] = r.value;
  }
  return [...cats.entries()]
    .map(([category, byMonth]) => ({
      category,
      byMonth,
      total: Object.values(byMonth).reduce((s, v) => s + v, 0),
    }))
    .sort((a, b) => b.total - a.total);
}

export interface BalanceSummary {
  cash: number;
  credit: number;
  loans: number;
  investments: number;
  netWorth: number;
}

export function balances(entity: EntityId | null): BalanceSummary {
  const [ef, ep] = entityFilter(entity, "a.entity_id");
  const rows = db()
    .prepare(
      `SELECT a.type, SUM(COALESCE(a.current_balance, 0)) AS total FROM accounts a WHERE a.hidden = 0 ${ef} GROUP BY a.type`,
    )
    .all(...ep) as { type: string; total: number }[];
  const get = (t: string) => rows.find((r) => r.type === t)?.total ?? 0;
  const cash = get("depository");
  const credit = get("credit");
  const loans = get("loan");
  const investments = get("investment") + get("brokerage");
  return { cash, credit, loans, investments, netWorth: cash + investments - credit - loans };
}

export interface AccountRow {
  account_id: string;
  item_id: string;
  entity_id: EntityId;
  name: string;
  official_name: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  current_balance: number | null;
  available_balance: number | null;
  institution_name: string | null;
  hidden: number;
  updated_at: string | null;
}

export function accounts(entity: EntityId | null, includeHidden = false): AccountRow[] {
  const [ef, ep] = entityFilter(entity, "a.entity_id");
  return db()
    .prepare(
      `SELECT a.*, p.institution_name FROM accounts a JOIN plaid_items p ON p.item_id = a.item_id
       WHERE 1=1 ${includeHidden ? "" : "AND a.hidden = 0"} ${ef}
       ORDER BY a.entity_id, CASE a.type WHEN 'depository' THEN 0 WHEN 'investment' THEN 1 WHEN 'credit' THEN 2 ELSE 3 END, a.name`,
    )
    .all(...ep) as AccountRow[];
}

export interface TxRow {
  transaction_id: string;
  account_id: string;
  entity_id: EntityId;
  date: string;
  name: string;
  merchant_name: string | null;
  amount: number;
  category_id: number | null;
  category_name: string | null;
  category_kind: string | null;
  category_source: string;
  pending: number;
  note: string | null;
  account_name: string;
  account_mask: string | null;
}

export interface TxQuery {
  entity?: EntityId | null;
  month?: string | null;
  categoryId?: number | "none" | null;
  direction?: "in" | "out" | null;
  q?: string | null;
  limit?: number;
  offset?: number;
}

export function transactions(f: TxQuery): { rows: TxRow[]; total: number; sumIn: number; sumOut: number } {
  const where: string[] = ["a.hidden = 0"];
  const params: unknown[] = [];
  if (f.entity) {
    where.push("t.entity_id = ?");
    params.push(f.entity);
  }
  if (f.month) {
    where.push("substr(t.date,1,7) = ?");
    params.push(f.month);
  }
  if (f.categoryId === "none") where.push("t.category_id IS NULL");
  else if (f.categoryId) {
    where.push("t.category_id = ?");
    params.push(f.categoryId);
  }
  if (f.direction === "in") where.push("t.amount > 0");
  if (f.direction === "out") where.push("t.amount < 0");
  if (f.q) {
    where.push("(t.name LIKE ? OR t.merchant_name LIKE ? OR t.note LIKE ?)");
    params.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`);
  }
  const w = where.join(" AND ");
  const from = `FROM transactions t JOIN accounts a ON a.account_id = t.account_id LEFT JOIN categories c ON c.id = t.category_id WHERE ${w}`;
  const agg = db()
    .prepare(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END) AS sumIn,
              SUM(CASE WHEN t.amount < 0 THEN -t.amount ELSE 0 END) AS sumOut ${from}`,
    )
    .get(...params) as { total: number; sumIn: number | null; sumOut: number | null };
  const rows = db()
    .prepare(
      `SELECT t.*, c.name AS category_name, c.kind AS category_kind, a.name AS account_name, a.mask AS account_mask
       ${from} ORDER BY t.date DESC, t.created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, f.limit ?? 100, f.offset ?? 0) as TxRow[];
  return { rows, total: agg.total, sumIn: agg.sumIn ?? 0, sumOut: agg.sumOut ?? 0 };
}

export function lastSync(): string | null {
  const r = db().prepare("SELECT MAX(last_synced_at) AS t FROM plaid_items").get() as { t: string | null };
  return r.t;
}

export function hasAnyData(): boolean {
  const r = db().prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number };
  return r.n > 0;
}

export interface Category {
  id: number;
  name: string;
  kind: "income" | "expense" | "transfer";
  builtin: number;
}

export function categories(): Category[] {
  return db()
    .prepare("SELECT * FROM categories ORDER BY CASE kind WHEN 'income' THEN 0 WHEN 'expense' THEN 1 ELSE 2 END, name")
    .all() as Category[];
}
