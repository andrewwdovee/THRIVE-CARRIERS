/* window.storage — the tiny key/value layer both windows talk to.
   Every window shares one record, so whatever
   backs this has to be visible to every browser that opens the app.

   Two modes:
     local  — localStorage. Fine for one machine; each browser has its own copy.
     remote — the relay's KV (see ./relay). Set VITE_RELAY_URL to put every
              window on one database; reads and writes carry the signed-in
              session, so the page holds no shared secret.

   The shape is deliberately small because the app only ever asks for two
   things: read a JSON string, write a JSON string. */

const MEM = new Map(); // last-resort store when localStorage is walled off
const CHANNEL = "fulfillment_storage";

import { relayUrl, authHeaders, expired } from "./auth";

const REMOTE = relayUrl();

let bc = null;
try {
  bc = "BroadcastChannel" in window ? new BroadcastChannel(CHANNEL) : null;
} catch {
  bc = null;
}

function localGet(key) {
  try {
    const v = window.localStorage.getItem(key);
    return v == null ? (MEM.has(key) ? MEM.get(key) : null) : v;
  } catch {
    return MEM.has(key) ? MEM.get(key) : null;
  }
}

function localSet(key, value) {
  MEM.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch (e) {
    // Quota or private mode. The in-memory copy above keeps this session
    // working; surfacing the throw would only break the save path.
    return false;
  }
  return true;
}

async function remoteGet(key) {
  const r = await fetch(`${REMOTE}/kv/${encodeURIComponent(key)}`, { headers: authHeaders() });
  if (r.status === 401) { expired(); throw new Error("Your session ended. Sign in again."); }
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Storage read failed (${r.status})`);
  const j = await r.json();
  return j?.value ?? null;
}

async function remoteSet(key, value) {
  const r = await fetch(`${REMOTE}/kv/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ value }),
  });
  if (r.status === 401) { expired(); throw new Error("Your session ended. Sign in again."); }
  if (!r.ok) throw new Error(`Storage write failed (${r.status})`);
  return true;
}

export const storage = {
  mode: REMOTE ? "remote" : "local",

  async get(key) {
    if (REMOTE) {
      try {
        const value = await remoteGet(key);
        if (value != null) localSet(key, value); // keep an offline copy
        return value == null ? null : { key, value };
      } catch (e) {
        const value = localGet(key); // fall back to the cached copy
        if (value == null) throw e;
        return { key, value, stale: true };
      }
    }
    const value = localGet(key);
    return value == null ? null : { key, value };
  },

  async set(key, value) {
    localSet(key, value);
    if (REMOTE) await remoteSet(key, value);
    try {
      bc?.postMessage({ key, at: Date.now() });
    } catch {
      /* channel closed — the 20s poll still catches it */
    }
    return { key };
  },

  async remove(key) {
    MEM.delete(key);
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* nothing to do */
    }
    if (REMOTE) {
      await fetch(`${REMOTE}/kv/${encodeURIComponent(key)}`, { method: "DELETE", headers: authHeaders() });
    }
    return { key };
  },

  /* Fires when another tab writes. Returns an unsubscribe. */
  subscribe(key, fn) {
    const onBc = (e) => e?.data?.key === key && fn();
    const onStorage = (e) => e.key === key && fn();
    bc?.addEventListener("message", onBc);
    window.addEventListener("storage", onStorage);
    return () => {
      bc?.removeEventListener("message", onBc);
      window.removeEventListener("storage", onStorage);
    };
  },
};

export function installStorage() {
  if (!window.storage) window.storage = storage;
  return storage;
}
