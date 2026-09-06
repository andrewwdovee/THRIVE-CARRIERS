/**
 * Thrive relay — a Cloudflare Worker.
 *
 * Speaks exactly the protocol the Lead Tech Fulfillment board was already
 * built against, so pointing that board at this URL makes it sync without
 * changing a line of its app code:
 *
 *   POST /auth/login    {email, password}      -> {token, user}
 *   GET  /auth/me       Bearer token           -> {user} | 401
 *   POST /auth/logout   Bearer token           -> {ok: true}
 *   GET  /kv/:key       Bearer token           -> {value} | 404
 *   PUT  /kv/:key       Bearer token, {value}  -> {ok: true}
 *
 * Storage is a KV namespace. Tokens are stateless: an HMAC over the email
 * and an expiry, so there is no session table to keep and logging out is
 * client-side. That is a deliberate trade — see LOGOUT below.
 *
 * NOT TESTED against a live Cloudflare account. Deploy it to a throwaway
 * worker first and run the smoke tests in DEPLOY.md before pointing
 * anything real at it.
 */

const TOKEN_TTL_DAYS = 30;
const enc = new TextEncoder();

/* ---------------------------------------------------------------- utils */

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extra },
  });
}

/* The board sends credentials, so the allow-list is explicit: a bare
   wildcard would let any page on the internet drive this API as your
   browser. One narrow exception — an entry like
   "https://*.thrive-command.pages.dev" matches subdomains of that one
   domain, because Pages gives every deployment its own hostname and they
   are all yours. It never matches a different domain, and never http. */
function originAllowed(origin, allowed) {
  if (!origin) return false;
  let host;
  try {
    const u = new URL(origin);
    if (u.protocol !== "https:") return false;
    host = u.hostname;
  } catch {
    return false;
  }
  return allowed.some((entry) => {
    if (entry === origin) return true;
    if (!entry.startsWith("https://*.")) return false;
    const base = entry.slice("https://*.".length);
    return base.length > 0 && (host === base || host.endsWith("." + base));
  });
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!originAllowed(origin, allowed)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,PUT,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function b64url(bytes) {
  let s = "";
  const b = new Uint8Array(bytes);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlToBytes(s) {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(pad + "=".repeat((4 - (pad.length % 4)) % 4));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/* Constant-time compare: a plain === on a signature leaks its prefix to a
   patient attacker through timing. */
function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

async function pbkdf2(password, saltHex, iterations) {
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, 256
  );
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ----------------------------------------------------------- token auth */

async function issueToken(env, email) {
  const payload = b64url(enc.encode(JSON.stringify({
    e: email,
    x: Date.now() + TOKEN_TTL_DAYS * 86400000,
  })));
  const sig = b64url(await hmac(env.TOKEN_SECRET, payload));
  return `${payload}.${sig}`;
}

async function readToken(env, request) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || token.indexOf(".") < 0) return null;
  const [payload, sig] = token.split(".");
  const expect = await hmac(env.TOKEN_SECRET, payload);
  let given;
  try { given = b64urlToBytes(sig); } catch { return null; }
  if (!sameBytes(expect, given)) return null;
  let body;
  try { body = JSON.parse(new TextDecoder().decode(b64urlToBytes(payload))); } catch { return null; }
  if (!body || !body.x || Date.now() > body.x) return null;
  return { email: body.e };
}

/* --------------------------------------------------------------- routes */

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return cors
        ? new Response(null, { status: 204, headers: cors })
        : new Response("origin not allowed", { status: 403 });
    }
    /* A browser request from an unlisted origin is refused outright rather
       than answered without CORS headers, which would fail confusingly. */
    if (request.headers.get("Origin") && !cors) {
      return json({ error: "Origin not allowed" }, 403);
    }
    const head = cors || {};

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/" || path === "/health") {
      return json({ ok: true, service: "thrive-relay" }, 200, head);
    }

    /* ---- auth ---- */
    if (path === "/auth/login" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "Bad request" }, 400, head); }
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      if (!email || !password) return json({ error: "Email and password are required." }, 400, head);

      if (email !== String(env.OWNER_EMAIL || "").trim().toLowerCase()) {
        return json({ error: "That email and password don't match." }, 401, head);
      }
      const hash = await pbkdf2(password, env.OWNER_PASSWORD_SALT, Number(env.OWNER_PASSWORD_ITER || 210000));
      if (!sameBytes(enc.encode(hash), enc.encode(env.OWNER_PASSWORD_HASH))) {
        return json({ error: "That email and password don't match." }, 401, head);
      }
      return json({ token: await issueToken(env, email), user: { email } }, 200, head);
    }

    if (path === "/auth/me" && request.method === "GET") {
      const who = await readToken(env, request);
      if (!who) return json({ error: "Signed out" }, 401, head);
      return json({ user: { email: who.email } }, 200, head);
    }

    /* LOGOUT is a no-op by design. Tokens are stateless, so the client
       drops it and stops sending it. If you ever need real revocation,
       keep an issued-at floor in KV and reject tokens older than it. */
    if (path === "/auth/logout" && request.method === "POST") {
      return json({ ok: true }, 200, head);
    }

    /* ---- key/value ---- */
    if (path.startsWith("/kv/")) {
      const who = await readToken(env, request);
      if (!who) return json({ error: "Signed out" }, 401, head);

      const key = decodeURIComponent(path.slice(4));
      if (!key || key.length > 256) return json({ error: "Bad key" }, 400, head);

      if (request.method === "GET") {
        const value = await env.THRIVE_KV.get(`kv:${key}`);
        if (value === null) return json({ error: "Not found" }, 404, head);
        return json({ value, key }, 200, head);
      }

      if (request.method === "PUT") {
        let body;
        try { body = await request.json(); } catch { return json({ error: "Bad request" }, 400, head); }
        /* The board sends the record already serialized, as {value:"..."}.
           Anything else is stringified so the store stays uniform. */
        const value = typeof body.value === "string" ? body.value : JSON.stringify(body.value);
        if (value.length > 20 * 1024 * 1024) return json({ error: "Too large" }, 413, head);
        await env.THRIVE_KV.put(`kv:${key}`, value);
        return json({ ok: true, key, bytes: value.length }, 200, head);
      }
    }

    return json({ error: "Not found" }, 404, head);
  },
};
