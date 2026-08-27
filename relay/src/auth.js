/* Accounts and sessions.

   This is the only place a login can mean anything: the browser can't be
   trusted to decide whether someone is allowed in, because whoever is holding
   it can edit the page. So the relay checks the password, hands back a session
   token, and refuses to serve orders to anyone who can't present one.

   Passwords are stored as PBKDF2-SHA256 hashes, never in the clear. Sessions
   are opaque random tokens kept in KV with an expiry, so signing someone out
   (or revoking them) actually takes effect — unlike a self-contained token
   that stays valid until it expires. */

const ITERATIONS = 100_000;     // a compromise: Workers bill CPU time
const SESSION_DAYS = 14;
const MIN_PASSWORD = 10;

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

function randomToken(bytes = 32) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return b64(a).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function pbkdf2(password, salt, iterations = ITERATIONS) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, 256);
  return new Uint8Array(bits);
}

/* Compare every byte regardless of where the first mismatch is, so the
   time taken doesn't leak how much of the hash was right. */
function equalBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

const emailKey = (email) => `user:${String(email).trim().toLowerCase()}`;

export async function createUser(env, { email, password, name, role }) {
  const addr = String(email || "").trim().toLowerCase();
  if (!addr || !addr.includes("@")) throw new Error("A valid email address is required.");
  if (String(password || "").length < MIN_PASSWORD) throw new Error(`Password must be at least ${MIN_PASSWORD} characters.`);
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const hash = await pbkdf2(password, salt);
  const user = { email: addr, name: name || addr.split("@")[0], role: role === "owner" ? "owner" : "staff",
    salt: b64(salt), hash: b64(hash), iterations: ITERATIONS, createdAt: Date.now() };
  await env.BOARD.put(emailKey(addr), JSON.stringify(user));
  return { email: user.email, name: user.name, role: user.role, createdAt: user.createdAt };
}

export async function deleteUser(env, email) {
  await env.BOARD.delete(emailKey(email));
}

export async function listUsers(env) {
  const out = [];
  let cursor;
  do {
    const page = await env.BOARD.list({ prefix: "user:", cursor });
    for (const k of page.keys) {
      const raw = await env.BOARD.get(k.name);
      if (!raw) continue;
      const u = JSON.parse(raw);
      out.push({ email: u.email, name: u.name, role: u.role, createdAt: u.createdAt });
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return out;
}

export async function login(env, email, password) {
  const raw = await env.BOARD.get(emailKey(email));
  // Hash even when there's no such account, so a missing user and a wrong
  // password take the same time and can't be told apart.
  const user = raw ? JSON.parse(raw) : null;
  const salt = user ? unb64(user.salt) : new Uint8Array(16);
  const got = await pbkdf2(password || "", salt, user?.iterations || ITERATIONS);
  if (!user || !equalBytes(got, unb64(user.hash))) return null;

  const token = randomToken();
  const ttl = SESSION_DAYS * 24 * 3600;
  const session = { email: user.email, name: user.name, role: user.role, issuedAt: Date.now(), expiresAt: Date.now() + ttl * 1000 };
  await env.BOARD.put(`session:${token}`, JSON.stringify(session), { expirationTtl: ttl });
  return { token, user: { email: user.email, name: user.name, role: user.role }, expiresAt: session.expiresAt };
}

export async function session(env, token) {
  if (!token || !env.BOARD) return null;
  const raw = await env.BOARD.get(`session:${token}`);
  if (!raw) return null;
  const s = JSON.parse(raw);
  if (s.expiresAt && s.expiresAt < Date.now()) { await env.BOARD.delete(`session:${token}`); return null; }
  return s;
}

export async function logout(env, token) {
  if (token && env.BOARD) await env.BOARD.delete(`session:${token}`);
}

export const bearer = (req) => (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
