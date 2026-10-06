"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function SyncButton({ lastSync, itemId, label = "Sync now" }: { lastSync?: string; itemId?: string; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemId }),
    });
    if (!res.ok) setErr((await res.json().catch(() => ({}))).error || "Sync failed");
    setBusy(false);
    router.refresh();
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      {lastSync && <span className="muted" style={{ fontSize: 12 }}>Updated {lastSync}</span>}
      <button className="btn sm" onClick={run} disabled={busy} title={err ?? undefined}>
        {busy ? "Syncing…" : label}
      </button>
      {err && <span className="tag err" title={err}>Sync error</span>}
    </span>
  );
}
