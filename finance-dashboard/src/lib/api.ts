import { NextResponse } from "next/server";
import { plaidErrorMessage } from "./plaid";

export function ok(data: unknown = { ok: true }) {
  return NextResponse.json(data);
}

export function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function fail(err: unknown) {
  const { message } = plaidErrorMessage(err);
  console.error("[api]", message);
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}
