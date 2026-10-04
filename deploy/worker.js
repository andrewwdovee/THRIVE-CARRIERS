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
 * Plus one route the board did not ask for, added for onboarding:
 *
 *   POST /onboarding/submit   no token, {record}  -> {ok: true, id}
 *
 * It is the only unauthenticated write, because the person signing the
 * agreement has no account yet. It is not open: the CORS allow-list
 * above still applies, so only the onboarding page's own origin can
 * reach it from a browser. It only ever appends, never reads back.
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

/* Onboarding. The index key is written with the `kv:` prefix the board
   uses, so an ordinary GET /kv/onboarding/submissions reads it. */
const ONBOARD_INDEX = "kv:onboarding/submissions";
const ONBOARD_DOC = "onboarding/doc/";
const ONBOARD_MAX_BYTES = 3.2 * 1024 * 1024;
const ONBOARD_MAX_SIG = 400 * 1024;
const ONBOARD_MAX_PHOTO = 2.6 * 1024 * 1024;
const ONBOARD_MAX_ROWS = 2000;
const ONBOARD_PER_HOUR = 6;

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

/* Which pieces of configuration are present. Booleans only — never a
   value — so this is safe to read from a browser or paste into a chat. */
function configReport(env) {
  return {
    ownerEmail: !!env.OWNER_EMAIL && env.OWNER_EMAIL !== "you@example.com",
    passwordSalt: typeof env.OWNER_PASSWORD_SALT === "string" && env.OWNER_PASSWORD_SALT.length > 0,
    saltLooksValid: typeof env.OWNER_PASSWORD_SALT === "string" && /^[0-9a-fA-F]{32}$/.test(env.OWNER_PASSWORD_SALT.trim()),
    passwordHash: typeof env.OWNER_PASSWORD_HASH === "string" && env.OWNER_PASSWORD_HASH.length > 0,
    hashLooksValid: typeof env.OWNER_PASSWORD_HASH === "string" && /^[0-9a-fA-F]{64}$/.test(env.OWNER_PASSWORD_HASH.trim()),
    tokenSecret: typeof env.TOKEN_SECRET === "string" && env.TOKEN_SECRET.length > 0,
    kv: !!env.THRIVE_KV,
    iterations: Number(env.OWNER_PASSWORD_ITER || 0),
    allowedOrigins: (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean),
  };
}

/* A missing secret used to surface as Cloudflare's blank 500 page, which
   says nothing about what is wrong. Name the gap instead. */
function missingConfig(env) {
  const c = configReport(env);
  const gaps = [];
  if (!c.passwordSalt) gaps.push("OWNER_PASSWORD_SALT is not set");
  else if (!c.saltLooksValid) gaps.push("OWNER_PASSWORD_SALT is not 32 hex characters — the wrong value was pasted");
  if (!c.passwordHash) gaps.push("OWNER_PASSWORD_HASH is not set");
  else if (!c.hashLooksValid) gaps.push("OWNER_PASSWORD_HASH is not 64 hex characters — the wrong value was pasted");
  if (!c.tokenSecret) gaps.push("TOKEN_SECRET is not set");
  if (!c.ownerEmail) gaps.push("OWNER_EMAIL is not set in wrangler.toml");
  /* Workers cap PBKDF2 here. Above it, every login throws — so say so on
     /health rather than letting it surface as a failed sign-in. */
  if (c.iterations > 100000) {
    gaps.push("OWNER_PASSWORD_ITER is " + c.iterations + " — Cloudflare Workers do not support PBKDF2 above 100000");
  }
  return gaps;
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (err) {
      /* Never let an exception become a blank Cloudflare error page. */
      return json({
        error: "The relay hit an unexpected error.",
        detail: (err && err.message) || String(err),
        config: configReport(env),
      }, 500);
    }
  },
};

async function handle(request, env) {
  {
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
      return json({
        ok: true,
        service: "thrive-relay",
        config: configReport(env),
        missing: missingConfig(env),
      }, 200, head);
    }

    /* ---- auth ---- */
    if (path === "/auth/login" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "Bad request" }, 400, head); }
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      if (!email || !password) return json({ error: "Email and password are required." }, 400, head);

      const gaps = missingConfig(env);
      if (gaps.length) {
        return json({ error: "The relay is not fully configured.", missing: gaps }, 500, head);
      }

      if (email !== String(env.OWNER_EMAIL || "").trim().toLowerCase()) {
        return json({ error: "That email and password don't match." }, 401, head);
      }
      const hash = await pbkdf2(password, env.OWNER_PASSWORD_SALT.trim(), Number(env.OWNER_PASSWORD_ITER || 210000));
      if (!sameBytes(enc.encode(hash), enc.encode(env.OWNER_PASSWORD_HASH.trim()))) {
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

    /* ---- onboarding ----
       The signer has no login, so this one write carries no token. Four
       things keep it from being a hole: the CORS allow-list above, a
       size cap, a per-address hourly throttle, and the fact that it can
       only append. Reading the submissions back is an ordinary
       authenticated GET /kv/onboarding/submissions.

       The index holds everything except the two images, so the board's
       grid is one small read however many people have signed. The
       signature and the photo go in their own document, fetched only
       when a row is opened. */
    if (path === "/onboarding/submit" && request.method === "POST") {
      const raw = await request.text();
      if (raw.length > ONBOARD_MAX_BYTES) {
        return json({ error: "That submission is too large. Try a smaller photo." }, 413, head);
      }
      let body;
      try { body = JSON.parse(raw); } catch { return json({ error: "Bad request" }, 400, head); }

      /* Best effort only: KV is eventually consistent, so two requests
         landing together can both read the same count. It is a brake on
         a script, not a lock. */
      const who = await hmac(
        env.TOKEN_SECRET || "onboarding",
        request.headers.get("CF-Connecting-IP") || "unknown"
      );
      const bucket = `rate:onboard:${who.slice(0, 24)}:${Math.floor(Date.now() / 36e5)}`;
      const seen = Number(await env.THRIVE_KV.get(bucket)) || 0;
      if (seen >= ONBOARD_PER_HOUR) {
        return json({ error: "Too many submissions from here in the last hour." }, 429, head);
      }

      const text = (v, max) => String(v == null ? "" : v).trim().slice(0, max);
      const rec = {
        legalName: text(body.legalName, 160),
        business:  text(body.business, 160),
        email:     text(body.email, 160).toLowerCase(),
        phone:     text(body.phone, 60),
        npn:       text(body.npn, 60),
        referrer:  text(body.referrer, 120),
        states:    text(body.states, 400),
        hours:     text(body.hours, 160),
        title:     text(body.title, 80),
        signedName: text(body.signedName, 160),
        agency:    body.agency === "yes" ? "yes" : body.agency === "no" ? "no" : "",
        version:   text(body.version, 40),
        tz:        text(body.tz, 60),
        agent:     text(body.agent, 200),
      };
      const signature = typeof body.signature === "string" ? body.signature : "";
      const photo = typeof body.photo === "string" ? body.photo : "";

      const missing = ["legalName", "business", "email", "phone", "states", "signedName"]
        .filter((k) => !rec[k]);
      if (missing.length) return json({ error: "Missing fields", missing }, 400, head);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(rec.email)) {
        return json({ error: "That email does not look right." }, 400, head);
      }
      if (!rec.agency) return json({ error: "Say whether you are with the agency." }, 400, head);
      if (!signature.startsWith("data:image/png")) {
        return json({ error: "The signature is missing." }, 400, head);
      }
      if (signature.length > ONBOARD_MAX_SIG) {
        return json({ error: "That signature is too large." }, 413, head);
      }
      if (photo && !photo.startsWith("data:image/")) {
        return json({ error: "That photo is not an image." }, 400, head);
      }
      if (photo.length > ONBOARD_MAX_PHOTO) {
        return json({ error: "That photo is too large." }, 413, head);
      }
      if (rec.agency === "yes" && !photo) {
        return json({ error: "Agency agents need a headshot." }, 400, head);
      }

      const id = "ob_" + Date.now().toString(36) + "_" + b64url(crypto.getRandomValues(new Uint8Array(6)));
      const signedAt = new Date().toISOString();

      let index = [];
      try { index = JSON.parse((await env.THRIVE_KV.get(ONBOARD_INDEX)) || "[]"); } catch { index = []; }
      if (!Array.isArray(index)) index = [];
      if (index.length >= ONBOARD_MAX_ROWS) {
        return json({ error: "The onboarding list is full. Clear it from the board." }, 507, head);
      }

      /* What the grid needs, and nothing that costs bytes. */
      index.unshift({
        id,
        signedAt,
        legalName: rec.legalName,
        business: rec.business,
        email: rec.email,
        phone: rec.phone,
        states: rec.states,
        agency: rec.agency,
        version: rec.version,
        steps: {
          details: true,
          read: true,
          agreed: true,
          signed: true,
          photo: rec.agency === "yes" ? !!photo : null,
        },
        reviewed: false,
      });

      await env.THRIVE_KV.put(`kv:${ONBOARD_DOC}${id}`, JSON.stringify({ ...rec, id, signedAt, signature, photo }));
      await env.THRIVE_KV.put(ONBOARD_INDEX, JSON.stringify(index));
      await env.THRIVE_KV.put(bucket, String(seen + 1), { expirationTtl: 7200 });

      return json({ ok: true, id, signedAt }, 200, head);
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
  }
}
