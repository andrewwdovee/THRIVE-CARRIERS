/**
 * The relay's store, on Supabase instead of Cloudflare KV.
 *
 * Every portal -- the LOA desk, Thrive Command, the Lead Tech board, the
 * onboarding pages -- reads and writes through this Worker and nothing
 * else touches the data. So the move is a change here, and the call
 * sites keep the shape they already had: get, put, list, with the same
 * arguments and the same answers KV gave. That is deliberate. A storage
 * swap that also rewrites the logic on top of it gives you no way to
 * tell which half broke.
 *
 * Talking to Postgres from a Worker means PostgREST, the REST interface
 * Supabase puts in front of the database: plain fetch, no driver, no
 * connection pool to exhaust. The service role key goes in the header
 * and never leaves the Worker.
 *
 * Two things KV did for free that Postgres does not:
 *
 *   expiry   `expirationTtl` becomes an `expires_at` column. Expired
 *            rows are stepped over on read and swept on write, so the
 *            rate-limit counters still age out and the call sites do
 *            not have to know.
 *
 *   listing  `list({prefix})` becomes a LIKE on the key with the page
 *            offset carried in the cursor, which is what KV's opaque
 *            cursor amounted to anyway.
 */

const PAGE = 1000;

/* Values travel percent-encoded and NOT quoted. An earlier version wrapped
   every key in double quotes, reasoning that a comma or parenthesis in a value
   would otherwise read as syntax. PostgREST does not strip those quotes --
   it matched on a key that literally began and ended with one, so every
   lookup came back empty while every write succeeded. Percent-encoding is
   enough on its own: the query string is split before values are decoded,
   so a comma arrives as data, and `eq.` takes one value anyway. */

/* LIKE wants % for "anything"; PostgREST spells it *. Either way a
   wildcard already inside a key has to stop meaning wildcard. */
function likePrefix(prefix) {
  return String(prefix).replace(/([%_\\])/g, "\\$1") + "*";
}

/* An upsert sets every column it is given, so a second Stripe event that
   happens not to carry the customer's email would blank the one the
   first event supplied. Columns with nothing in them are left out
   instead, which leaves whatever is already there alone. The keys named
   in `keep` go through regardless -- they identify the row or are the
   record itself. */
function dropEmpty(row, keep) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (keep.includes(k) || (v !== null && v !== undefined && v !== "")) out[k] = v;
  }
  return out;
}

export function makeStore(env) {
  const root = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = String(env.SUPABASE_SERVICE_KEY || "");
  if (!root || !key) return null;

  const base = root + "/rest/v1";
  const headers = {
    apikey: key,
    "Content-Type": "application/json",
  };
  /* Supabase issues two kinds of secret. A legacy service_role key is a
     JWT and PostgREST is happy to see it in both headers. A newer
     sb_secret_ key is not a JWT at all: send it as a Bearer token and
     the platform tries to parse it as one and refuses the request with
     "Invalid JWT". So the Authorization header goes on only when the key
     is actually a JWT, and the apikey header carries it either way. */
  if (/^ey[A-Za-z0-9_-]/.test(key)) headers.Authorization = `Bearer ${key}`;

  async function call(path, init = {}) {
    const res = await fetch(base + path, {
      ...init,
      headers: { ...headers, ...(init.headers || {}) },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Supabase ${res.status} on ${path}${detail ? ": " + detail.slice(0, 300) : ""}`);
    }
    return res;
  }

  async function rows(path) {
    const res = await call(path);
    const body = await res.json();
    return Array.isArray(body) ? body : [];
  }

  /* Expired but not yet swept is the same as absent. */
  function live() {
    return `or=(expires_at.is.null,expires_at.gt.${new Date().toISOString()})`;
  }

  const store = {
    async get(k) {
      const got = await rows(`/kv?key=eq.${encodeURIComponent(k)}&${live()}&select=value&limit=1`);
      return got.length ? got[0].value : null;
    },

    async put(k, value, opts = {}) {
      const ttl = Number(opts.expirationTtl);
      const row = {
        key: String(k),
        value: String(value),
        expires_at: Number.isFinite(ttl) && ttl > 0
          ? new Date(Date.now() + ttl * 1000).toISOString()
          : null,
        updated_at: new Date().toISOString(),
      };
      await call("/kv?on_conflict=key", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(row),
      });
      /* Sweeping on write rather than on a timer. One expired key per
         write is enough to keep the rate-limit rows from piling up, and
         it costs nothing when there are none. */
      if (Math.random() < 0.02) {
        try { await call("/rpc/kv_sweep", { method: "POST", body: "{}" }); } catch { /* best effort */ }
      }
    },

    async delete(k) {
      await call(`/kv?key=eq.${encodeURIComponent(k)}`, {
        method: "DELETE",
        headers: { Prefer: "return=minimal" },
      });
    },

    /* KV's shape: { keys: [{ name }], list_complete, cursor }. The cursor
       is the next offset, stringified, which is all the callers here do
       with it -- hand it straight back. */
    async list(opts = {}) {
      const offset = Number(opts.cursor) || 0;
      const limit = Number(opts.limit) || PAGE;
      const where = opts.prefix
        ? `key=like.${encodeURIComponent(likePrefix(opts.prefix))}&`
        : "";
      const got = await rows(
        `/kv?${where}${live()}&select=key&order=key.asc&limit=${limit}&offset=${offset}`
      );
      const complete = got.length < limit;
      return {
        keys: got.map((r) => ({ name: r.key })),
        list_complete: complete,
        cursor: complete ? null : String(offset + got.length),
      };
    },

    /* Listing keys and then fetching each one is a round trip per row.
       Through a Cloudflare KV binding those reads cost nothing; here
       every one is an HTTP call, and a Worker may make only so many per
       invocation. Fifty-odd refund slips were enough to pass that limit,
       and the whole sheet failed rather than part of it. So a caller
       that wants the values asks for them once, with the page. */
    async entries(opts = {}) {
      const offset = Number(opts.cursor) || 0;
      const limit = Number(opts.limit) || PAGE;
      const where = opts.prefix
        ? `key=like.${encodeURIComponent(likePrefix(opts.prefix))}&`
        : "";
      const got = await rows(
        `/kv?${where}${live()}&select=key,value&order=key.asc&limit=${limit}&offset=${offset}`
      );
      const complete = got.length < limit;
      return {
        rows: got.map((r) => ({ name: r.key, value: r.value })),
        list_complete: complete,
        cursor: complete ? null : String(offset + got.length),
      };
    },

    /* ---- the typed rows, written alongside the blobs ----
       These are for reading in SQL -- revenue by month, who signed and
       when -- not for the portals, which keep reading what they always
       read. A projection that fails must never cost the relay the write
       that matters, so both are best effort and say so in the log. */

    async saveOrder(order) {
      const at = Number(order.created) || Date.now();
      const row = dropEmpty({
        id: String(order.id),
        received_at: new Date(at > 1e12 ? at : at * 1000).toISOString(),
        amount: Number.isFinite(Number(order.amount)) ? Number(order.amount) : null,
        currency: order.currency || null,
        status: order.status || null,
        payment_status: order.paymentStatus || null,
        customer: order.customer || null,
        email: order.ownerEmail || order.email || null,
        product_name: order.productName || null,
        receipt_url: order.receiptUrl || null,
        refunded: !!order.refunded,
        raw: order,
        updated_at: new Date().toISOString(),
      }, ["id", "received_at", "raw", "refunded", "updated_at"]);
      await call("/orders?on_conflict=id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(row),
      });
    },

    async saveSubmission(rec, images) {
      await call("/onboarding_submissions?on_conflict=id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(dropEmpty({
          id: rec.id,
          signed_at: rec.signedAt,
          legal_name: rec.legalName,
          business: rec.business || null,
          email: rec.email,
          phone: rec.phone || null,
          npn: rec.npn || null,
          referrer: rec.referrer || null,
          start_time: rec.startTime || null,
          signed_name: rec.signedName || null,
          signed_date: rec.signedDate || null,
          thrive_signed_name: rec.thriveSignedName || null,
          thrive_signed_date: rec.thriveSignedDate || null,
          agreement_version: rec.version || null,
          steps: rec.steps || {},
          reviewed: false,
          raw: rec,
        }, ["id", "signed_at", "legal_name", "email", "steps", "reviewed", "raw"])),
      });
      await call("/onboarding_documents?on_conflict=id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(dropEmpty({
          id: rec.id,
          signature: images.signature || null,
          thrive_signature: images.thriveSignature || null,
          photo: images.photo || null,
        }, ["id"])),
      });
    },
  };

  return store;
}

/* The relay takes whichever store is configured. Supabase when its two
   secrets are set, Cloudflare KV otherwise -- so a deploy that has not
   been given the secrets yet keeps serving from KV rather than falling
   over, and switching back is removing a secret. */
/* The KV binding has no bulk read, so entries() is the same loop the
   relay used to write out by hand. That is fine here and only here: a
   KV read goes through a binding rather than the network, so it is not
   a subrequest and the per-invocation limit does not apply. */
function withEntries(kv) {
  if (!kv) return null;
  return {
    get: (...a) => kv.get(...a),
    put: (...a) => kv.put(...a),
    delete: (...a) => kv.delete(...a),
    list: (...a) => kv.list(...a),
    async entries(opts = {}) {
      const page = await kv.list(opts);
      const out = [];
      for (const k of page.keys) {
        const value = await kv.get(k.name);
        if (value !== null && value !== undefined) out.push({ name: k.name, value });
      }
      return {
        rows: out,
        list_complete: page.list_complete,
        cursor: page.list_complete ? null : page.cursor,
      };
    },
  };
}

export function pickStore(env) {
  return makeStore(env) || withEntries(env.THRIVE_KV);
}
