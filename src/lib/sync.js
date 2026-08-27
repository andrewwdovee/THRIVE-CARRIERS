import { DAY, normalize } from "./shared";
import { relayUrl, authHeaders, token as sessionToken } from "./auth";

/* Pull new charges from the relay.

   The relay holds the Stripe secret key. This app sends whoever is signed in;
   with no session it falls back to the access token from Settings, which is
   how a single-machine setup with no accounts still works. `since` is the
   newest order we already have, so a repeat pull stays cheap — and
   appendOrders dedupes whatever overlaps. */

/* Does this relay have Stripe pushing to it, or are we still asking?
   Decides how often it's worth checking. */
/* Where orders come from: whatever Settings names, or the relay this build
   was pointed at. One answer, so nothing is gated on the wrong one. */
export function syncEndpoint(settings) {
  return settings?.syncUrl || (relayUrl() ? `${relayUrl()}/orders` : "");
}

export async function relayHealth(settings) {
  const base = syncEndpoint(settings);
  if (!base) return null;
  try {
    const root = base.replace(/\/orders\b.*$/, "");
    const r = await fetch(`${root}/health`);
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

export async function pullStripe(settings, orders, products, { backfill } = {}) {
  const base = syncEndpoint(settings);
  if (!base) throw new Error("No sync endpoint is set.");
  const since = Math.max(...orders.map((o) => o.receivedAt || 0), Date.now() - 30 * DAY);
  const u = base + (base.includes("?") ? "&" : "?") + "since=" + Math.floor(since / 1e3)
    + (backfill ? "&backfill=1" : "");
  const headers = sessionToken()
    ? authHeaders()
    : (settings.syncToken ? { Authorization: `Bearer ${settings.syncToken}` } : {});
  const res = await fetch(u, { headers });
  if (res.status === 401) throw new Error("The relay didn't accept this session. Sign in again.");
  if (!res.ok) throw new Error(`Endpoint replied ${res.status}`);
  return normalize(await res.json(), products);
}
