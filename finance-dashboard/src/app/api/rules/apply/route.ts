import { ok } from "@/lib/api";
import { reapplyRules } from "@/lib/categorize";

export async function POST() {
  return ok({ changed: reapplyRules() });
}
