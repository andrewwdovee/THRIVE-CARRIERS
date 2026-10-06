import crypto from "node:crypto";
import { decodeProtectedHeader, importJWK, jwtVerify, type JWK } from "jose";
import { db } from "@/lib/db";
import { plaid, plaidConfigured } from "@/lib/plaid";
import { snapshotInvestmentTotals, syncItem } from "@/lib/sync";

const keyCache = new Map<string, JWK>();

async function verify(raw: string, token: string | null): Promise<boolean> {
  if (!token) return false;
  try {
    const { kid, alg } = decodeProtectedHeader(token);
    if (alg !== "ES256" || !kid) return false;
    let jwk = keyCache.get(kid);
    if (!jwk) {
      const { data } = await plaid().webhookVerificationKeyGet({ key_id: kid });
      jwk = data.key as unknown as JWK;
      keyCache.set(kid, jwk);
    }
    const key = await importJWK(jwk, "ES256");
    const { payload } = await jwtVerify(token, key, { maxTokenAge: "5 min" });
    const expected = crypto.createHash("sha256").update(raw).digest("hex");
    const got = String(payload.request_body_sha256 || "");
    return got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  if (!plaidConfigured()) return new Response("not configured", { status: 503 });
  const raw = await req.text();
  if (!(await verify(raw, req.headers.get("plaid-verification")))) {
    return new Response("invalid signature", { status: 401 });
  }
  const event = JSON.parse(raw) as { webhook_type: string; webhook_code: string; item_id: string; error?: { error_code?: string } };
  const known = db().prepare("SELECT 1 FROM plaid_items WHERE item_id = ?").get(event.item_id);
  if (!known) return new Response("ok");

  const key = `${event.webhook_type}.${event.webhook_code}`;
  console.log(`[webhook] ${key} for ${event.item_id}`);
  // Respond quickly; do the work in the background.
  const run = async () => {
    switch (key) {
      case "TRANSACTIONS.SYNC_UPDATES_AVAILABLE":
        await syncItem(event.item_id, "webhook", { investments: false });
        break;
      case "HOLDINGS.DEFAULT_UPDATE":
      case "INVESTMENTS_TRANSACTIONS.DEFAULT_UPDATE":
        await syncItem(event.item_id, "webhook");
        snapshotInvestmentTotals();
        break;
      case "ITEM.ERROR":
      case "ITEM.PENDING_EXPIRATION":
      case "ITEM.PENDING_DISCONNECT":
      case "ITEM.LOGIN_REPAIRED":
        db()
          .prepare("UPDATE plaid_items SET status = ?, error = ? WHERE item_id = ?")
          .run(
            event.webhook_code === "LOGIN_REPAIRED" ? "ok" : "login_required",
            event.webhook_code === "LOGIN_REPAIRED" ? null : event.error?.error_code || event.webhook_code,
            event.item_id,
          );
        break;
    }
  };
  run().catch((err) => console.error("[webhook] handler failed:", err));
  return new Response("ok");
}
