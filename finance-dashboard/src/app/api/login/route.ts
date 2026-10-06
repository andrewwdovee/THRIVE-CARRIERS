import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { SESSION_COOKIE, authConfigured, createSessionToken } from "@/lib/auth";
import { bad, body } from "@/lib/api";

const attempts = new Map<string, { n: number; until: number }>();

export async function POST(req: Request) {
  if (!authConfigured()) return bad("Set APP_PASSWORD and APP_SECRET (32+ chars) in .env first.", 500);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  const a = attempts.get(ip);
  if (a && a.n >= 5 && a.until > Date.now()) return bad("Too many attempts. Try again in a few minutes.", 429);

  const { password } = await body<{ password?: string }>(req);
  const expected = Buffer.from(process.env.APP_PASSWORD!);
  const given = Buffer.from(password || "");
  const match = given.length === expected.length && crypto.timingSafeEqual(given, expected);
  if (!match) {
    attempts.set(ip, { n: (a && a.until > Date.now() ? a.n : 0) + 1, until: Date.now() + 10 * 60 * 1000 });
    return bad("Wrong password", 401);
  }
  attempts.delete(ip);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 30 * 24 * 3600,
  });
  return res;
}
