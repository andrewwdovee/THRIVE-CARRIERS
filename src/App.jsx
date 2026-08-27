import React, { useState, useEffect, useCallback } from "react";
import { LayoutGrid, ShieldCheck, ExternalLink, LogOut, RefreshCw } from "lucide-react";
import AdminConsole from "./AdminConsole";
import FulfillmentDesk from "./FulfillmentDesk";
import Login from "./Login";
import { storage } from "./lib/storage";
import { relayConfigured, token, whoami, signOut } from "./lib/auth";

/* Two windows, one database. The hash route is what lets you keep the Desk
   open on one screen and the Console on another.

   Whether there's a sign-in depends on whether there's a server to enforce
   one. With a relay configured, nothing loads until the relay says who you
   are. Without one, the board is this browser's own — there is nothing to
   sign in to, and pretending otherwise would be theatre. */

const route = () => (window.location.hash.replace(/^#\/?/, "").split("?")[0] || "desk");

export default function App() {
  const [view, setView] = useState(route);
  const gated = relayConfigured();
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(gated);

  useEffect(() => {
    const on = () => setView(route());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

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

  const out = async () => { await signOut(); setUser(null); };

  if (gated && checking) return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-400">
      <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Checking your session…
    </div>
  );
  if (gated && !user) return <Login onSignedIn={setUser} />;

  const admin = view === "admin";
  return (
    <>
      {admin ? <AdminConsole me={user} /> : <FulfillmentDesk me={user} />}
      <Switcher admin={admin} user={user} onSignOut={out} />
    </>
  );
}

function Switcher({ admin, user, onSignOut }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="fixed bottom-4 right-4 z-40 flex items-center gap-2"
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      {open && (
        <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/95 px-2 py-1.5 shadow-xl backdrop-blur">
          <span className="text-[10px] uppercase tracking-[0.12em] text-slate-500">
            {user ? user.name || user.email : storage.mode === "remote" ? "shared db" : "this browser"}
          </span>
          <a href={admin ? "#/desk" : "#/admin"}
            className="rounded-md px-2 py-1 text-xs font-medium text-slate-300 hover:bg-slate-800">
            {admin ? "Fulfillment Desk" : "Admin Console"}
          </a>
          <a href={admin ? "#/desk" : "#/admin"} target="_blank" rel="noreferrer"
            title="Open in a second window" className="rounded-md p-1 text-slate-500 hover:bg-slate-800 hover:text-white">
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          {user && (
            <button onClick={onSignOut} title="Sign out"
              className="rounded-md p-1 text-slate-500 hover:bg-slate-800 hover:text-rose-400">
              <LogOut className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
      <a href={admin ? "#/desk" : "#/admin"} title={admin ? "Switch to the Fulfillment Desk" : "Switch to the Admin Console"}
        className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-slate-300 shadow-xl hover:bg-slate-800 hover:text-white">
        {admin ? <LayoutGrid className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
      </a>
    </div>
  );
}
