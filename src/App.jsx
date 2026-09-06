import React, { useState, useEffect, useCallback } from "react";
import { RefreshCw } from "lucide-react";
import Dashboard from "./Dashboard";
import Login from "./Login";
import { relayConfigured, token, whoami, signOut } from "./lib/auth";

/* One dashboard over one record.

   Whether there's a sign-in depends on whether there's a server to enforce
   one. With a relay configured, nothing loads until the relay says who you
   are. Without one, the board is this browser's own — there is nothing to
   sign in to, and pretending otherwise would be theatre. */

export default function App() {
  const gated = relayConfigured();
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(gated);

  const check = useCallback(async () => {
    if (!gated) return;
    setUser(token() ? await whoami() : null);
    setChecking(false);
  }, [gated]);
  useEffect(() => { check(); }, [check]);

  /* A 401 anywhere in the app drops the session; come back here. */
  useEffect(() => {
    const on = () => setUser(null);
    window.addEventListener("fulfillment:signedout", on);
    return () => window.removeEventListener("fulfillment:signedout", on);
  }, []);

  const out = useCallback(async () => { await signOut(); setUser(null); }, []);

  if (gated && checking) return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 dark:bg-slate-950 text-slate-600 dark:text-slate-400">
      <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Checking your session…
    </div>
  );
  if (gated && !user) return <Login onSignedIn={setUser} />;

  return <Dashboard me={user} onSignOut={gated ? out : null} />;
}
