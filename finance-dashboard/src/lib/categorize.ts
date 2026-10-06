import { db } from "./db";
import { mapPlaidCategory } from "./categories";

export interface Rule {
  id: number;
  pattern: string;
  category_id: number;
  entity_id: string | null;
  direction: "any" | "in" | "out";
}

interface TxLike {
  name: string;
  merchant_name: string | null;
  amount: number;
  entity_id: string;
  plaid_category: string | null;
  plaid_detailed: string | null;
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()[\]\\]/g, "\\$&");
}

/** Pattern is "|"-separated plain text; each alternative matches as a whole word/phrase, case-insensitive. */
export function compilePattern(pattern: string): RegExp {
  const alts = pattern
    .split("|")
    .map((a) => a.trim())
    .filter(Boolean)
    .map(escapeRegex);
  if (alts.length === 0) return /$^/;
  return new RegExp(`(?:^|[^a-z0-9])(?:${alts.join("|")})(?:$|[^a-z0-9])`, "i");
}

export function loadRules(): (Rule & { re: RegExp })[] {
  const rows = db().prepare("SELECT id, pattern, category_id, entity_id, direction FROM rules ORDER BY id DESC").all() as Rule[];
  return rows.map((r) => ({ ...r, re: compilePattern(r.pattern) }));
}

export function ruleMatches(rule: Rule & { re: RegExp }, tx: TxLike): boolean {
  if (rule.entity_id && rule.entity_id !== tx.entity_id) return false;
  if (rule.direction === "in" && tx.amount <= 0) return false;
  if (rule.direction === "out" && tx.amount >= 0) return false;
  return rule.re.test(`${tx.merchant_name ?? ""} ${tx.name}`);
}

let categoryIdsByName: Map<string, number> | null = null;
function categoryId(name: string): number | null {
  if (!categoryIdsByName) {
    const rows = db().prepare("SELECT id, name FROM categories").all() as { id: number; name: string }[];
    categoryIdsByName = new Map(rows.map((r) => [r.name, r.id]));
  }
  return categoryIdsByName.get(name) ?? null;
}
export function invalidateCategoryCache() {
  categoryIdsByName = null;
}

/** Newest rule wins; otherwise fall back to Plaid's category mapping. */
export function categorize(tx: TxLike, rules = loadRules()): { category_id: number | null; source: "rule" | "auto" } {
  for (const rule of rules) {
    if (ruleMatches(rule, tx)) return { category_id: rule.category_id, source: "rule" };
  }
  return { category_id: categoryId(mapPlaidCategory(tx.plaid_category, tx.plaid_detailed, tx.amount)), source: "auto" };
}

/** Re-run rules over every transaction that was not categorized by hand. Returns number changed. */
export function reapplyRules(): number {
  const d = db();
  const rules = loadRules();
  const rows = d
    .prepare(
      "SELECT transaction_id, name, merchant_name, amount, entity_id, plaid_category, plaid_detailed, category_id FROM transactions WHERE category_source != 'manual'",
    )
    .all() as (TxLike & { transaction_id: string; category_id: number | null })[];
  const upd = d.prepare("UPDATE transactions SET category_id = ?, category_source = ? WHERE transaction_id = ?");
  let changed = 0;
  d.transaction(() => {
    for (const r of rows) {
      const c = categorize(r, rules);
      // No Plaid category to fall back on (e.g. imported/demo rows): keep what it had.
      if (c.source === "auto" && !r.plaid_category && r.category_id != null) c.category_id = r.category_id;
      if (c.category_id !== r.category_id) changed++;
      upd.run(c.category_id, c.source, r.transaction_id);
    }
  })();
  return changed;
}
