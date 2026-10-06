import { bad, body, ok } from "@/lib/api";
import { isEntityId } from "@/lib/entities";
import { isKnownMetric, saveMetric } from "@/lib/metrics";

export async function PUT(req: Request) {
  const { entity, month, metric, value } = await body<{ entity?: string; month?: string; metric?: string; value?: number | null }>(req);
  if (!entity || !isEntityId(entity)) return bad("Unknown company");
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return bad("Month must be YYYY-MM");
  if (!metric || !isKnownMetric(entity, metric)) return bad("Unknown metric");
  saveMetric(entity, month, metric, value == null || (value as unknown) === "" ? null : Number(value));
  return ok();
}
