// Thrive call dashboard API (Cloudflare Pages Function + D1).
// Every upload is kept. "Remove" only hides it (sets deleted_at); nothing is erased.
//   GET    /api/health              -> { ok, db, keyRequired }
//   GET    /api/uploads             -> { uploads: [...] }   (not removed, oldest first)
//   GET    /api/uploads/:id/csv     -> the cleaned CSV text
//   POST   /api/uploads             -> { id }   body: { kind, name, rows, from, to, csv }
//   DELETE /api/uploads/:id         -> { removed: true }    (soft delete)
// Optional password: if a DASHBOARD_KEY secret is set, every call except /health needs the header
// x-dashboard-key: <DASHBOARD_KEY>. With no secret set, anyone with the link can read and add data.

const CHUNK = 60000;            // D1 statements are capped at 100 KB, so CSV text is stored in pieces.
const MAX_CSV = 25 * 1024 * 1024;
const KINDS = new Set(['policies', 'calls']);

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

function sameKey(a, b) {
  const x = new TextEncoder().encode(a || ''), y = new TextEncoder().encode(b || '');
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

export async function onRequest({ request, env, params }) {
  const parts = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
  const method = request.method.toUpperCase();

  if (parts[0] === 'health') return json({ ok: true, db: !!env.DB, keyRequired: !!env.DASHBOARD_KEY });
  if (!env.DB) return json({ error: 'The database is not connected. Add the D1 binding named DB.' }, 503);
  if (env.DASHBOARD_KEY && !sameKey(request.headers.get('x-dashboard-key'), env.DASHBOARD_KEY)) return json({ error: 'Wrong or missing dashboard password.' }, 401);
  if (parts[0] !== 'uploads') return json({ error: 'Not found.' }, 404);

  const id = parts[1] ? decodeURIComponent(parts[1]) : null;

  if (method === 'GET' && !id) {
    const { results } = await env.DB.prepare(
      'SELECT id, kind, name, rows, from_day AS "from", to_day AS "to", uploaded_at AS uploadedAt FROM uploads WHERE deleted_at IS NULL ORDER BY uploaded_at'
    ).all();
    return json({ uploads: results || [] });
  }

  if (method === 'GET' && id && parts[2] === 'csv') {
    const head = await env.DB.prepare('SELECT id FROM uploads WHERE id = ?').bind(id).first();
    if (!head) return json({ error: 'Upload not found.' }, 404);
    const { results } = await env.DB.prepare('SELECT data FROM upload_chunks WHERE upload_id = ? ORDER BY seq').bind(id).all();
    return new Response((results || []).map((r) => r.data).join(''), {
      headers: { 'content-type': 'text/csv; charset=utf-8', 'cache-control': 'private, max-age=31536000, immutable' }
    });
  }

  if (method === 'POST' && !id) {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'Send JSON.' }, 400); }
    const { kind, name, rows, from, to, csv } = body || {};
    if (!KINDS.has(kind)) return json({ error: 'kind must be "policies" or "calls".' }, 400);
    if (typeof csv !== 'string' || !csv.length) return json({ error: 'csv is missing.' }, 400);
    if (csv.length > MAX_CSV) return json({ error: 'File is too large. Export a shorter date range.' }, 413);
    const newId = crypto.randomUUID();
    const now = new Date().toISOString();
    const day = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    const stmts = [env.DB.prepare(
      'INSERT INTO uploads (id, kind, name, rows, from_day, to_day, uploaded_at, bytes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(newId, kind, String(name || 'upload.csv').slice(0, 200), Number(rows) || 0, day(from), day(to), now, csv.length)];
    for (let i = 0, seq = 0; i < csv.length; i += CHUNK, seq++) {
      stmts.push(env.DB.prepare('INSERT INTO upload_chunks (upload_id, seq, data) VALUES (?, ?, ?)').bind(newId, seq, csv.slice(i, i + CHUNK)));
    }
    await env.DB.batch(stmts);
    return json({ id: newId, uploadedAt: now }, 201);
  }

  if (method === 'DELETE' && id) {
    const res = await env.DB.prepare('UPDATE uploads SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').bind(new Date().toISOString(), id).run();
    return json({ removed: (res.meta && res.meta.changes) > 0 });
  }

  return json({ error: 'Not allowed.' }, 405);
}
