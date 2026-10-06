// Runs in both the proxy and route handlers, so stick to Web Crypto.
export const SESSION_COOKIE = "tf_session";

async function hmac(message: string): Promise<string> {
  const secret = process.env.APP_SECRET || "";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Buffer.from(sig).toString("base64url");
}

/** Token = issuedAt.signature; valid for 30 days. Changing APP_PASSWORD or APP_SECRET logs everyone out. */
export async function createSessionToken(): Promise<string> {
  const issued = Date.now().toString();
  return `${issued}.${await hmac(`${issued}:${process.env.APP_PASSWORD}`)}`;
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const [issued, sig] = token.split(".");
  if (!issued || !sig) return false;
  if (Date.now() - Number(issued) > 30 * 24 * 3600 * 1000) return false;
  const expected = await hmac(`${issued}:${process.env.APP_PASSWORD}`);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export function authConfigured() {
  return Boolean(process.env.APP_PASSWORD && process.env.APP_SECRET && process.env.APP_SECRET.length >= 32);
}
