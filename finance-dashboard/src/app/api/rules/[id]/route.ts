import { ok } from "@/lib/api";
import { db } from "@/lib/db";
import { reapplyRules } from "@/lib/categorize";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  db().prepare("DELETE FROM rules WHERE id = ?").run(id);
  return ok({ changed: reapplyRules() });
}
