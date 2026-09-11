/* Refund requests from agents.

   The only part of this system a stranger can reach. The form is sent to
   people who have no account here and must never get one, so the POST below
   takes no token — which makes everything about it a question of what an
   anonymous caller can do with it.

   What they can do: add one request, of a fixed shape, under a size cap,
   a few times an hour. What they cannot do: read anything, write anywhere
   else, or put more than a bounded amount of text into storage. */

export const REQUEST_TTL = 120 * 24 * 3600;   // kept long enough to settle disputes
const MAX_BODY = 8 * 1024;
const MAX_CALLS = 12;
const PER_WINDOW = 20;                        // submissions per IP per hour
const WINDOW = 3600;

export const REASONS = [
  ["non_consumer", "Non-consumer"],
  ["agent", "Life insurance agent"],
  ["dead_air", "Dead air"],
  ["other", "Other"],
];
const REASON_IDS = new Set(REASONS.map(([id]) => id));

const str = (v, max) => String(v ?? "").trim().slice(0, max);

/* Shape and limits, checked here rather than trusted from the page — the
   page is the part an attacker gets to replace. */
export function readRequest(body) {
  const first = str(body?.first, 80);
  const last = str(body?.last, 80);
  const email = str(body?.email, 160).toLowerCase();
  const day = str(body?.day, 10);

  if (!first || !last) return { error: "A first and last name are needed." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "That email address doesn't look right." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { error: "A date is needed." };

  const raw = Array.isArray(body?.calls) ? body.calls.slice(0, MAX_CALLS) : [];
  const calls = [];
  for (const c of raw) {
    const phone = str(c?.phone, 24);
    const reason = str(c?.reason, 32);
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) return { error: "Each call needs a phone number of at least 10 digits." };
    if (!REASON_IDS.has(reason)) return { error: "Pick a reason for each call." };
    calls.push({ phone, digits, reason, note: str(c?.note, 200) });
  }
  /* Two bad calls earn one refund, so one call is not a request. */
  if (calls.length < 2) return { error: "Two calls are needed for one refund." };

  return { value: { first, last, email, day, calls, note: str(body?.note, 500) } };
}

/* A small counter per address per hour. Not a defence against somebody
   determined — it is a cap on accidental floods and casual abuse, which is
   what an unauthenticated endpoint actually sees. */
export async function overLimit(env, ip) {
  if (!env.BOARD || !ip) return false;
  const key = `rl:${Math.floor(Date.now() / 1000 / WINDOW)}:${ip}`;
  const n = Number(await env.BOARD.get(key)) || 0;
  if (n >= PER_WINDOW) return true;
  await env.BOARD.put(key, String(n + 1), { expirationTtl: WINDOW * 2 });
  return false;
}

export const tooBig = (raw) => raw.length > MAX_BODY;

export const requestKey = (at, id) => `rr:${String(at).padStart(12, "0")}:${id}`;
