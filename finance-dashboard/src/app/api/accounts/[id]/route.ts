import { bad, body, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { isEntityId } from "@/lib/entities";

/** Move an account to the other company (and its transactions with it), or hide it. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { entity_id, hidden } = await body<{ entity_id?: string; hidden?: boolean }>(req);
  const d = db();
  if (!d.prepare("SELECT 1 FROM accounts WHERE account_id = ?").get(id)) return bad("Unknown account", 404);
  d.transaction(() => {
    if (entity_id !== undefined) {
      if (!isEntityId(entity_id)) throw new Error("bad entity");
      d.prepare("UPDATE accounts SET entity_id = ? WHERE account_id = ?").run(entity_id, id);
      d.prepare("UPDATE transactions SET entity_id = ? WHERE account_id = ?").run(entity_id, id);
    }
    if (hidden !== undefined) d.prepare("UPDATE accounts SET hidden = ? WHERE account_id = ?").run(hidden ? 1 : 0, id);
  })();
  return ok();
}
