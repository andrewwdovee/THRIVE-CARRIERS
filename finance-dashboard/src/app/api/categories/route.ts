import { bad, body, ok } from "@/lib/api";
import { categories } from "@/lib/analytics";
import { db } from "@/lib/db";
import { invalidateCategoryCache } from "@/lib/categorize";

export async function GET() {
  return ok(categories());
}

export async function POST(req: Request) {
  const { name, kind } = await body<{ name?: string; kind?: string }>(req);
  if (!name?.trim()) return bad("Name is required");
  if (!["income", "expense", "transfer"].includes(kind || "")) return bad("Kind must be income, expense or transfer");
  try {
    const r = db().prepare("INSERT INTO categories (name, kind) VALUES (?, ?)").run(name.trim(), kind);
    invalidateCategoryCache();
    return ok({ id: r.lastInsertRowid });
  } catch {
    return bad("A category with that name already exists");
  }
}
