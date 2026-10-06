import { bad, body, ok } from "@/lib/api";
import { db } from "@/lib/db";

export async function POST(req: Request) {
  const { ids, category_id } = await body<{ ids?: string[]; category_id?: number }>(req);
  if (!Array.isArray(ids) || ids.length === 0 || !category_id) return bad("ids and category_id are required");
  const d = db();
  const upd = d.prepare("UPDATE transactions SET category_id = ?, category_source = 'manual' WHERE transaction_id = ?");
  d.transaction(() => ids.forEach((id) => upd.run(category_id, id)))();
  return ok({ updated: ids.length });
}
