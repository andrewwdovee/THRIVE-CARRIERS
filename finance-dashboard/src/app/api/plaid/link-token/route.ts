import { bad, body, fail, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { LINK_OPTIONAL_PRODUCTS, LINK_PRODUCTS, countryCodes, plaid, plaidConfigured } from "@/lib/plaid";

/** Create a Link token. Pass { itemId } to re-authenticate an existing connection (update mode). */
export async function POST(req: Request) {
  if (!plaidConfigured()) return bad("Plaid keys are not configured. Add PLAID_CLIENT_ID and PLAID_SECRET to .env.");
  const { itemId } = await body<{ itemId?: string }>(req);
  try {
    const base = {
      user: { client_user_id: "owner" },
      client_name: "Thrive Finance",
      country_codes: countryCodes(),
      language: "en",
      webhook: process.env.PLAID_WEBHOOK_URL || undefined,
    };
    if (itemId) {
      const row = db().prepare("SELECT access_token_enc FROM plaid_items WHERE item_id = ?").get(itemId) as
        | { access_token_enc: string }
        | undefined;
      if (!row) return bad("Unknown connection", 404);
      const { data } = await plaid().linkTokenCreate({ ...base, access_token: decrypt(row.access_token_enc) });
      return ok({ link_token: data.link_token });
    }
    const { data } = await plaid().linkTokenCreate({
      ...base,
      products: LINK_PRODUCTS,
      optional_products: LINK_OPTIONAL_PRODUCTS,
      transactions: { days_requested: 730 },
    });
    return ok({ link_token: data.link_token });
  } catch (err) {
    return fail(err);
  }
}
