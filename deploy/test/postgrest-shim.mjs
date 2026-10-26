/* Just enough PostgREST to run the relay's store against a real Postgres.
   Only the query shapes supabase-store.js actually produces. */
import http from "node:http";
import pg from "pg";

const db = new pg.Pool({ host: "/var/run/postgresql", user: "postgres", database: "thrive" });
const TABLES = new Set(["kv", "orders", "onboarding_submissions", "onboarding_documents", "board_rows"]);

/* Faithful to PostgREST: the value is taken as it arrives. An earlier
   version stripped surrounding double quotes, which real PostgREST does
   not do. That one kindness made every test pass against a store whose
   every lookup failed in production. A stand-in that is more forgiving
   than the real thing is worse than no stand-in. */
function unquote(v) {
  return v;
}

/* key=eq."x" | key=like."pre*" | or=(expires_at.is.null,expires_at.gt.ISO) */
function where(params, vals) {
  const parts = [];
  for (const [k, v] of params) {
    if (k === "select" || k === "order" || k === "limit" || k === "offset" || k === "on_conflict") continue;
    if (k === "or") {
      const m = /^\(expires_at\.is\.null,expires_at\.gt\.(.+)\)$/.exec(v);
      if (!m) throw new Error("shim: unsupported or() " + v);
      vals.push(m[1]);
      parts.push(`(expires_at is null or expires_at > $${vals.length})`);
      continue;
    }
    const [op, ...rest] = v.split(".");
    const raw = unquote(rest.join("."));
    if (op === "eq") { vals.push(raw); parts.push(`${k} = $${vals.length}`); }
    else if (op === "like") { vals.push(raw.replace(/\*/g, "%")); parts.push(`${k} like $${vals.length}`); }
    else throw new Error("shim: unsupported op " + op);
  }
  return parts.length ? " where " + parts.join(" and ") : "";
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const send = (code, body) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(body === undefined ? "" : JSON.stringify(body));
  };
  if (req.headers.apikey !== "test-service-key") return send(401, { message: "bad key" });

  let raw = "";
  for await (const c of req) raw += c;

  try {
    const seg = url.pathname.replace(/^\/rest\/v1\//, "");
    if (seg === "rpc/kv_sweep") {
      const r = await db.query("select public.kv_sweep() as n");
      return send(200, r.rows[0].n);
    }
    if (!TABLES.has(seg)) return send(404, { message: "no table " + seg });

    const params = [...url.searchParams.entries()];
    const vals = [];

    if (req.method === "GET") {
      if (String(req.headers.prefer || "").includes("count=exact")) {
        const c = await db.query(`select count(*)::int as n from public.${seg}` + where(params, vals), vals);
        res.writeHead(206, { "Content-Type": "application/json", "Content-Range": `0-0/${c.rows[0].n}` });
        return res.end("[]");
      }
      const sel = url.searchParams.get("select") || "*";
      const ord = url.searchParams.get("order");
      const lim = url.searchParams.get("limit");
      const off = url.searchParams.get("offset");
      let sql = `select ${sel} from public.${seg}` + where(params, vals);
      if (ord) sql += ` order by ${ord.replace(/\.asc$/, " asc").replace(/\.desc$/, " desc")}`;
      if (lim) sql += ` limit ${Number(lim)}`;
      if (off) sql += ` offset ${Number(off)}`;
      const r = await db.query(sql, vals);
      return send(200, r.rows);
    }

    if (req.method === "POST") {
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      if (!list.length) return send(201);
      const conflictKey = url.searchParams.get("on_conflict");
      const mergeAll = String(req.headers.prefer || "").includes("merge-duplicates");
      for (const row of list) {
        const cols = Object.keys(row);
        const sql = `insert into public.${seg} (${cols.map((c) => `"${c}"`).join(",")})
          values (${cols.map((_, i) => "$" + (i + 1)).join(",")})` +
          (conflictKey && mergeAll
            ? ` on conflict (${conflictKey}) do update set ` +
              cols.filter((c) => c !== conflictKey).map((c) => `"${c}" = excluded."${c}"`).join(",")
            : "");
        await db.query(sql, cols.map((c) => (row[c] !== null && typeof row[c] === "object" ? JSON.stringify(row[c]) : row[c])));
      }
      return send(201);
    }

    if (req.method === "__never__") {
      const row = JSON.parse(raw);
      const cols = Object.keys(row);
      const conflict = url.searchParams.get("on_conflict");
      const merge = String(req.headers.prefer || "").includes("merge-duplicates");
      const sql = `insert into public.${seg} (${cols.map((c) => `"${c}"`).join(",")})
        values (${cols.map((_, i) => "$" + (i + 1)).join(",")})` +
        (conflict && merge
          ? ` on conflict (${conflict}) do update set ` +
            cols.filter((c) => c !== conflict).map((c) => `"${c}" = excluded."${c}"`).join(",")
          : "");
      await db.query(sql, cols.map((c) => (row[c] !== null && typeof row[c] === "object" ? JSON.stringify(row[c]) : row[c])));
      return send(201);
    }

    if (req.method === "DELETE") {
      await db.query(`delete from public.${seg}` + where(params, vals), vals);
      return send(204);
    }
    return send(405, { message: "no" });
  } catch (e) {
    return send(400, { message: String(e.message || e) });
  }
}).listen(54321, () => console.log("shim on 54321"));
