import { bad, body, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { categorize } from "@/lib/categorize";

/** Set a transaction's category by hand (category_id: null reverts to automatic) or its note. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const b = await body<{ category_id?: number | null; note?: string }>(req);
  const d = db();
  const tx = d.prepare("SELECT * FROM transactions WHERE transaction_id = ?").get(id) as
    | { name: string; merchant_name: string | null; amount: number; entity_id: string; plaid_category: string | null; plaid_detailed: string | null }
    | undefined;
  if (!tx) return bad("Unknown transaction", 404);
  if ("category_id" in b) {
    if (b.category_id == null && tx.plaid_category) {
      const c = categorize(tx);
      d.prepare("UPDATE transactions SET category_id = ?, category_source = ? WHERE transaction_id = ?").run(c.category_id, c.source, id);
    } else {
      d.prepare("UPDATE transactions SET category_id = ?, category_source = 'manual' WHERE transaction_id = ?").run(b.category_id, id);
    }
  }
  if ("note" in b) d.prepare("UPDATE transactions SET note = ? WHERE transaction_id = ?").run(b.note || null, id);
  return ok();
}
