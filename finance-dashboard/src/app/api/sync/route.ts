import { body, fail, ok } from "@/lib/api";
import { snapshotInvestmentTotals, syncAll, syncItem } from "@/lib/sync";

export async function POST(req: Request) {
  const { itemId } = await body<{ itemId?: string }>(req);
  try {
    if (itemId) {
      await syncItem(itemId, "manual");
      snapshotInvestmentTotals();
    } else await syncAll("manual");
    return ok();
  } catch (err) {
    return fail(err);
  }
}
