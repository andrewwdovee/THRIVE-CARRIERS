"use client";

import { useState } from "react";

export function LoginForm() {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    if (res.ok) {
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
    } else {
      setErr((await res.json().catch(() => ({}))).error || "Sign-in failed");
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <label className="field">
        Password
        <input className="input" type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
      </label>
      {err && <div className="tag err" style={{ alignSelf: "flex-start" }}>{err}</div>}
      <button className="btn primary" disabled={busy || !pw} style={{ justifyContent: "center" }}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
