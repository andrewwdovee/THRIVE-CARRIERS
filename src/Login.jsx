import React, { useState } from "react";
import { LogIn, Loader2 } from "lucide-react";
import { BD, CARD, IN, PRI, M, F, W, L, Field } from "./lib/shared";
import { signIn } from "./lib/auth";

/* The way in.

   This screen is a courtesy, not the lock. The lock is on the relay, which
   won't hand over an order to anyone without a valid session — so getting
   past this form by editing the page gets you an empty board. */

export default function Login({ onSignedIn }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const user = await signIn(email.trim(), password);
      onSignedIn(user);
    } catch (e2) {
      setErr(e2.message);
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600">
            <LogIn className="h-5 w-5 text-white" />
          </div>
          <h1 className={`mt-3 text-lg font-bold tracking-tight ${W}`}>Fulfillment Desk</h1>
          <L className="mt-1">Sign in to see today's orders</L>
        </div>

        <form onSubmit={submit} className={`${CARD} space-y-3 p-5`}>
          <Field label="Email">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              autoComplete="username" autoFocus required className={IN} placeholder="you@yourcompany.com" />
          </Field>
          <Field label="Password">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password" required className={IN} />
          </Field>

          {err && <p role="alert" className="rounded-md border border-rose-900 bg-rose-950/50 px-3 py-2 text-sm text-rose-200">{err}</p>}

          <button type="submit" disabled={busy || !email || !password} className={`w-full ${PRI} disabled:opacity-50`}>
            {busy ? <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Signing in</span> : "Sign in"}
          </button>
        </form>

        <p className={`mt-4 text-center text-xs ${F}`}>
          Need an account? Whoever set this up creates one for you.
        </p>
      </div>
    </div>
  );
}
