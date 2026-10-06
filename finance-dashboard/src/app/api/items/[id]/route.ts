import { fail, ok } from "@/lib/api";
import { removeItem } from "@/lib/sync";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    await removeItem(id);
    return ok();
  } catch (err) {
    return fail(err);
  }
}
