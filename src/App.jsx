import React, { useState, useEffect } from "react";
import { LayoutGrid, ShieldCheck, ExternalLink } from "lucide-react";
import AdminConsole from "./AdminConsole";
import FulfillmentDesk from "./FulfillmentDesk";
import { storage } from "./lib/storage";

/* Two windows, one database. The hash route is what lets you keep the Desk
   open on one screen and the Console on another — or hand the Desk URL to an
   assistant without handing over the Stripe settings. */

const route = () => (window.location.hash.replace(/^#\/?/, "").split("?")[0] || "desk");

export default function App() {
  const [view, setView] = useState(route);
  useEffect(() => {
    const on = () => setView(route());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  const admin = view === "admin";
  return (
    <>
      {admin ? <AdminConsole /> : <FulfillmentDesk />}
      <Switcher admin={admin} />
    </>
  );
}

function Switcher({ admin }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="fixed bottom-4 right-4 z-40 flex items-center gap-2"
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      {open && (
        <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/95 px-2 py-1.5 shadow-xl backdrop-blur">
          <span className="text-[10px] uppercase tracking-[0.12em] text-slate-500">
            {storage.mode === "remote" ? "shared db" : "this browser"}
          </span>
          <a href={admin ? "#/desk" : "#/admin"}
            className="rounded-md px-2 py-1 text-xs font-medium text-slate-300 hover:bg-slate-800">
            {admin ? "Fulfillment Desk" : "Admin Console"}
          </a>
          <a href={admin ? "#/desk" : "#/admin"} target="_blank" rel="noreferrer"
            title="Open in a second window" className="rounded-md p-1 text-slate-500 hover:bg-slate-800 hover:text-white">
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      )}
      <a href={admin ? "#/desk" : "#/admin"} title={admin ? "Switch to the Fulfillment Desk" : "Switch to the Admin Console"}
        className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-slate-300 shadow-xl hover:bg-slate-800 hover:text-white">
        {admin ? <LayoutGrid className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
      </a>
    </div>
  );
}
