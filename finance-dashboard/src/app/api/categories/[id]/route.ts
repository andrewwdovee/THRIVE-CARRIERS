import { bad, body, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { invalidateCategoryCache, reapplyRules } from "@/lib/categorize";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { name, kind } = await body<{ name?: string; kind?: string }>(req);
  const d = db();
  try {
    if (name?.trim()) d.prepare("UPDATE categories SET name = ? WHERE id = ?").run(name.trim(), id);
    if (kind && ["income", "expense", "transfer"].includes(kind)) d.prepare("UPDATE categories SET kind = ? WHERE id = ?").run(kind, id);
  } catch {
    return bad("A category with that name already exists");
  }
  invalidateCategoryCache();
  return ok();
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const d = db();
  const c = d.prepare("SELECT builtin FROM categories WHERE id = ?").get(id) as { builtin: number } | undefined;
  if (!c) return bad("Unknown category", 404);
  if (c.builtin) return bad("Built-in categories can't be deleted (rename them instead)");
  d.prepare("DELETE FROM categories WHERE id = ?").run(id);
  // Manually-set transactions lost their category; let them fall back to automatic.
  d.prepare("UPDATE transactions SET category_source = 'auto' WHERE category_id IS NULL AND category_source = 'manual'").run();
  invalidateCategoryCache();
  reapplyRules();
  return ok();
}
