"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function EmptyState({ plaidReady }: { plaidReady: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function demo() {
    setBusy(true);
    await fetch("/api/demo", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    router.refresh();
  }
  return (
    <div className="card empty">
      <h2>Connect your first bank</h2>
      <p>
        Link the Thrive Companies and Lead Tech bank, card and brokerage accounts through Plaid. Transactions start
        flowing in right away, then stay current through Plaid webhooks and a twice-daily refresh.
      </p>
      <div className="actions" style={{ justifyContent: "center" }}>
        <Link className="btn primary" href="/settings">
          {plaidReady ? "Connect a bank" : "Set up Plaid"}
        </Link>
        <button className="btn" onClick={demo} disabled={busy}>
          {busy ? "Loading…" : "Explore with demo data"}
        </button>
      </div>
    </div>
  );
}
