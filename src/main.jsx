import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { installStorage } from "./lib/storage";
import "./index.css";

/* Both screens call window.storage directly, so it has to exist before the
   first render. */
installStorage();

class Boundary extends React.Component {
  constructor(p) { super(p); this.state = { e: null }; }
  static getDerivedStateFromError(e) { return { e }; }
  componentDidCatch(e, info) { console.error("Fulfillment Desk crashed:", e, info); }
  render() {
    if (!this.state.e) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6">
        <div className="max-w-md rounded-xl border border-slate-800 bg-slate-900 p-5">
          <h1 className="text-base font-semibold text-white">Something broke on this screen.</h1>
          <p className="mt-2 text-sm text-slate-400">
            Your orders are safe — they live in storage, not in this window. Reload to pick up where you left off.
          </p>
          <pre className="mt-3 overflow-x-auto rounded bg-slate-950 p-2 text-xs text-rose-300">{String(this.state.e?.message || this.state.e)}</pre>
          <button onClick={() => window.location.reload()} className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500">Reload</button>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode><Boundary><App /></Boundary></React.StrictMode>
);
