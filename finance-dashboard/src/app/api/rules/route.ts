import { bad, body, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { reapplyRules } from "@/lib/categorize";
import { isEntityId } from "@/lib/entities";

export async function GET() {
  return ok(
    db()
      .prepare("SELECT r.*, c.name AS category_name FROM rules r JOIN categories c ON c.id = r.category_id ORDER BY r.id DESC")
      .all(),
  );
}

/** Create a rule, then re-run all rules so existing transactions pick it up. */
export async function POST(req: Request) {
  const { pattern, category_id, entity_id, direction } = await body<{
    pattern?: string;
    category_id?: number;
    entity_id?: string | null;
    direction?: string;
  }>(req);
  if (!pattern?.trim()) return bad("Pattern is required");
  if (!category_id) return bad("Pick a category");
  if (entity_id && !isEntityId(entity_id)) return bad("Unknown company");
  const dir = ["any", "in", "out"].includes(direction || "") ? direction : "any";
  db()
    .prepare("INSERT INTO rules (pattern, category_id, entity_id, direction) VALUES (?, ?, ?, ?)")
    .run(pattern.trim().toLowerCase(), category_id, entity_id || null, dir);
  const changed = reapplyRules();
  return ok({ changed });
}
