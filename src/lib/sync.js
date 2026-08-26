import { DAY, normalize } from "./shared";

/* Pull new charges from the relay.

   The relay holds the Stripe secret key; this app only knows its address and a
   token you invent. `since` is the newest order we already have, so a repeat
   pull stays cheap — and appendOrders dedupes whatever overlaps. */

export async function pullStripe(settings, orders, products) {
  if (!settings.syncUrl) throw new Error("No sync endpoint is set.");
  const since = Math.max(...orders.map((o) => o.receivedAt || 0), Date.now() - 30 * DAY);
  const u = settings.syncUrl + (settings.syncUrl.includes("?") ? "&" : "?") + "since=" + Math.floor(since / 1e3);
  const res = await fetch(u, { headers: settings.syncToken ? { Authorization: `Bearer ${settings.syncToken}` } : {} });
  if (!res.ok) throw new Error(`Endpoint replied ${res.status}`);
  return normalize(await res.json(), products);
}
