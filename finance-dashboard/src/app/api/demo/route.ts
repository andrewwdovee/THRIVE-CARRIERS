import { body, ok } from "@/lib/api";
import { clearDemoData, loadDemoData } from "@/lib/demo";

export async function POST(req: Request) {
  const { action } = await body<{ action?: string }>(req);
  if (action === "clear") clearDemoData();
  else loadDemoData();
  return ok();
}
