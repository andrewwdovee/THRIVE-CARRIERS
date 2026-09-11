/* Signing in.

   The relay decides who gets in; this file just carries the answer around.
   All the browser ever holds is a session token the relay can revoke — never
   a password, never the Stripe key, never a shared secret baked into the
   bundle. With no relay configured there is nothing to sign in to, and the
   app runs against this browser's own storage. */

const TOKEN_KEY = "fulfillment_session";
export const RELAY = String(import.meta.env?.VITE_RELAY_URL || import.meta.env?.VITE_STORAGE_URL || "").replace(/\/+$/, "");

export const relayUrl = () => RELAY;
export const relayConfigured = () => !!RELAY;

export function token() {
  try { return localStorage.getItem(TOKEN_KEY) || null; } catch { return null; }
}
function setToken(t) {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ }
}

/* Authorization header for every relay call, when we have a session. */
export function authHeaders(extra) {
  const t = token();
  return { ...(extra || {}), ...(t ? { Authorization: `Bearer ${t}` } : {}) };
}

/* Anything that comes back 401 means the session is gone — expired, revoked,
   or the relay was redeployed. Drop it so the app returns to the sign-in
   screen instead of retrying forever. */
export function expired() {
  setToken(null);
  window.dispatchEvent(new Event("fulfillment:signedout"));
}

export async function signIn(email, password) {
  if (!RELAY) throw new Error("No relay is configured for this app.");
  let res;
  try {
    res = await fetch(`${RELAY}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    throw new Error("Couldn't reach the server. Check your connection and try again.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "That email and password don't match.");
  setToken(body.token);
  return body.user;
}

export async function signOut() {
  const t = token();
  setToken(null);
  if (RELAY && t) {
    // Best effort — the local token is already gone either way.
    try { await fetch(`${RELAY}/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${t}` } }); } catch { /* offline */ }
  }
}

/* Who is signed in, according to the relay. Returns null when nobody is. */
export async function whoami() {
  if (!RELAY || !token()) return null;
  try {
    const res = await fetch(`${RELAY}/auth/me`, { headers: authHeaders() });
    if (res.status === 401) { setToken(null); return null; }
    if (!res.ok) return null;
    return (await res.json()).user || null;
  } catch {
    return null; // offline: treat as signed out rather than guessing
  }
}
