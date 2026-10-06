import { bad, body, fail, ok } from "@/lib/api";
import { isEntityId } from "@/lib/entities";
import { linkItem, syncItem } from "@/lib/sync";

export async function POST(req: Request) {
  const { public_token, entity, itemId } = await body<{ public_token?: string; entity?: string; itemId?: string }>(req);
  try {
    // Update mode: the access token is unchanged, just re-sync.
    if (itemId) {
      await syncItem(itemId, "manual");
      return ok();
    }
    if (!public_token) return bad("Missing public_token");
    if (!entity || !isEntityId(entity)) return bad("Pick which company this bank belongs to");
    const id = await linkItem(public_token, entity);
    return ok({ itemId: id });
  } catch (err) {
    return fail(err);
  }
}
