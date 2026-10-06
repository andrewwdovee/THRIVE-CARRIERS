"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import type { AccountRow, Category } from "@/lib/analytics";
import { ENTITIES } from "@/lib/entities";
import { usd } from "@/lib/format";

async function api(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `Request failed (${res.status})`);
  return j;
}

// ------------------------------------------------------------ Plaid Link

function PlaidLauncher({ token, onSuccess, onExit }: { token: string; onSuccess: (publicToken: string) => void; onExit: () => void }) {
  const { open, ready } = usePlaidLink({ token, onSuccess: (pt) => { if (pt) onSuccess(pt); }, onExit: () => onExit() });
  useEffect(() => {
    if (ready) open();
  }, [ready, open]);
  return null;
}

export function ConnectBank({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const [entity, setEntity] = useState<string>("thrive");
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "starting" | "importing">("idle");
  const [err, setErr] = useState<string | null>(null);

  async function start() {
    setErr(null);
    setState("starting");
    try {
      const { link_token } = await api("/api/plaid/link-token", "POST", {});
      setToken(link_token);
    } catch (e) {
      setErr((e as Error).message);
      setState("idle");
    }
  }

  const onSuccess = useCallback(
    async (publicToken: string) => {
      setToken(null);
      setState("importing");
      try {
        await api("/api/plaid/exchange", "POST", { public_token: publicToken, entity });
        router.refresh();
      } catch (e) {
        setErr((e as Error).message);
      }
      setState("idle");
    },
    [entity, router],
  );

  return (
    <div className="toolbar" style={{ marginBottom: 0 }}>
      <label className="field">
        Company
        <select className="select" value={entity} onChange={(e) => setEntity(e.target.value)}>
          {ENTITIES.map((e) => (
            <option key={e.id} value={e.id}>{e.name}</option>
          ))}
        </select>
      </label>
      <button className="btn primary" onClick={start} disabled={disabled || state !== "idle"}>
        {state === "starting" ? "Opening Plaid…" : state === "importing" ? "Importing transactions…" : "Connect with Plaid"}
      </button>
      {token && <PlaidLauncher token={token} onSuccess={onSuccess} onExit={() => { setToken(null); setState("idle"); }} />}
      {err && <span className="tag err">{err}</span>}
    </div>
  );
}

// ------------------------------------------------------------ connections

interface ItemView {
  item_id: string;
  entity_id: string;
  entity_name: string;
  institution_name: string | null;
  status: string;
  error: string | null;
  last: string;
  demo: boolean;
}

export function ItemCard({ item, accounts }: { item: ItemView; accounts: AccountRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [relinkToken, setRelinkToken] = useState<string | null>(null);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setErr(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(null);
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="dot" style={{ background: `var(--entity-${item.entity_id})` }} />
          {item.institution_name ?? "Bank"}
        </h2>
        {item.status === "ok" ? (
          <span className="muted" style={{ fontSize: 12 }}>Synced {item.last}</span>
        ) : (
          <span className="tag err" title={item.error ?? ""}>{item.status === "login_required" ? "Needs reconnect" : "Error"}</span>
        )}
      </div>
      {item.error && <p className="hint" style={{ color: "var(--err-ink)" }}>{item.error}</p>}
      <div className="table-wrap">
        <table>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.account_id} style={a.hidden ? { opacity: 0.5 } : undefined}>
                <td>
                  {a.name} <span className="muted">{a.mask ? `••${a.mask}` : ""}</span>
                  <div className="muted" style={{ fontSize: 12 }}>{a.subtype || a.type}</div>
                </td>
                <td className="r num">{usd(a.current_balance)}</td>
                <td>
                  <select
                    className="select sm"
                    aria-label="Company"
                    value={a.entity_id}
                    onChange={(e) => run("move", () => api(`/api/accounts/${a.account_id}`, "PATCH", { entity_id: e.target.value }))}
                  >
                    {ENTITIES.map((e) => (
                      <option key={e.id} value={e.id}>{e.short}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <button className="btn sm" onClick={() => run("hide", () => api(`/api/accounts/${a.account_id}`, "PATCH", { hidden: !a.hidden }))}>
                    {a.hidden ? "Show" : "Hide"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="actions" style={{ marginTop: 12 }}>
        {!item.demo && (
          <>
            <button className="btn sm" disabled={!!busy} onClick={() => run("sync", () => api("/api/sync", "POST", { itemId: item.item_id }))}>
              {busy === "sync" ? "Syncing…" : "Sync"}
            </button>
            <button
              className="btn sm"
              disabled={!!busy}
              onClick={() =>
                run("relink", async () => {
                  const { link_token } = await api("/api/plaid/link-token", "POST", { itemId: item.item_id });
                  setRelinkToken(link_token);
                })
              }
            >
              Reconnect
            </button>
          </>
        )}
        <button
          className="btn sm danger"
          disabled={!!busy}
          onClick={() => {
            if (confirm(`Disconnect ${item.institution_name ?? "this bank"} and delete its transactions from this dashboard?`))
              run("remove", () => api(`/api/items/${encodeURIComponent(item.item_id)}`, "DELETE"));
          }}
        >
          {busy === "remove" ? "Removing…" : "Remove"}
        </button>
        {err && <span className="tag err">{err}</span>}
      </div>
      {relinkToken && (
        <PlaidLauncher
          token={relinkToken}
          onSuccess={() => {
            setRelinkToken(null);
            run("sync", () => api("/api/plaid/exchange", "POST", { itemId: item.item_id }));
          }}
          onExit={() => setRelinkToken(null)}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------ categories

export function CategoryManager({ categories }: { categories: (Category & { used: number })[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [kind, setKind] = useState("expense");
  const [err, setErr] = useState<string | null>(null);

  async function act(fn: () => Promise<unknown>) {
    setErr(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <>
      <div className="toolbar">
        <input className="input grow" placeholder="New category name" value={name} onChange={(e) => setName(e.target.value)} />
        <select className="select" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="income">Income</option>
          <option value="expense">Expense</option>
          <option value="transfer">Transfer</option>
        </select>
        <button className="btn primary" disabled={!name.trim()} onClick={() => act(async () => { await api("/api/categories", "POST", { name, kind }); setName(""); })}>
          Add
        </button>
      </div>
      {err && <div className="tag err" style={{ marginBottom: 8 }}>{err}</div>}
      <div className="table-wrap" style={{ maxHeight: 420, overflowY: "auto" }}>
        <table>
          <thead>
            <tr><th>Name</th><th>Kind</th><th className="r">Used</th><th /></tr>
          </thead>
          <tbody>
            {categories.map((c) => (
              <tr key={c.id}>
                <td>
                  <input
                    className="input sm"
                    defaultValue={c.name}
                    aria-label="Category name"
                    style={{ border: "1px solid transparent", background: "transparent", width: "100%" }}
                    onBlur={(e) => e.target.value.trim() !== c.name && act(() => api(`/api/categories/${c.id}`, "PATCH", { name: e.target.value }))}
                  />
                </td>
                <td>
                  <select className="select sm" value={c.kind} onChange={(e) => act(() => api(`/api/categories/${c.id}`, "PATCH", { kind: e.target.value }))}>
                    <option value="income">Income</option>
                    <option value="expense">Expense</option>
                    <option value="transfer">Transfer</option>
                  </select>
                </td>
                <td className="r num muted">{c.used}</td>
                <td>
                  {!c.builtin && (
                    <button className="btn sm danger" onClick={() => confirm(`Delete “${c.name}”?`) && act(() => api(`/api/categories/${c.id}`, "DELETE"))}>
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ------------------------------------------------------------ rules

export function RuleManager({
  rules,
  categories,
}: {
  rules: { id: number; pattern: string; entity_id: string | null; direction: string; category_name: string }[];
  categories: Category[];
}) {
  const router = useRouter();
  const [pattern, setPattern] = useState("");
  const [cat, setCat] = useState<string>("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function act(fn: () => Promise<{ changed?: number }>) {
    setErr(null);
    try {
      const r = await fn();
      if (r?.changed != null) setMsg(`${r.changed} transaction${r.changed === 1 ? "" : "s"} re-categorized.`);
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <>
      <div className="toolbar">
        <input className="input grow" placeholder='Text to match, e.g. "facebk|meta ads"' value={pattern} onChange={(e) => setPattern(e.target.value)} />
        <select className="select" value={cat} onChange={(e) => setCat(e.target.value)} style={{ maxWidth: 200 }}>
          <option value="">Category…</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <button
          className="btn primary"
          disabled={!pattern.trim() || !cat}
          onClick={() =>
            act(async () => {
              const r = await api("/api/rules", "POST", { pattern, category_id: Number(cat) });
              setPattern("");
              return r;
            })
          }
        >
          Add
        </button>
        <button className="btn" onClick={() => act(() => api("/api/rules/apply", "POST"))} title="Re-run all rules over existing transactions">
          Re-apply all
        </button>
      </div>
      {msg && <div className="muted" style={{ marginBottom: 8 }}>{msg}</div>}
      {err && <div className="tag err" style={{ marginBottom: 8 }}>{err}</div>}
      <div className="table-wrap" style={{ maxHeight: 420, overflowY: "auto" }}>
        <table>
          <thead>
            <tr><th>Matches</th><th>Category</th><th>Scope</th><th /></tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id}>
                <td className="wrap"><code style={{ fontSize: 12, wordBreak: "break-word", whiteSpace: "normal" }}>{r.pattern}</code></td>
                <td>{r.category_name}</td>
                <td className="muted">
                  {r.entity_id ? ENTITIES.find((e) => e.id === r.entity_id)?.short : "Both"}
                  {r.direction !== "any" ? ` · ${r.direction === "in" ? "money in" : "money out"}` : ""}
                </td>
                <td>
                  <button className="btn sm danger" onClick={() => act(() => api(`/api/rules/${r.id}`, "DELETE"))}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ------------------------------------------------------------ demo

export function DemoControls({ loaded }: { loaded: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function act(action: "load" | "clear") {
    setBusy(true);
    await api("/api/demo", "POST", { action });
    setBusy(false);
    router.refresh();
  }
  return (
    <div className="toolbar" style={{ marginBottom: 0, alignItems: "center" }}>
      <span className="muted grow">
        {loaded
          ? "Demo data is loaded (13 months of sample transactions, holdings and KPIs). Clear it before going live."
          : "Load 13 months of realistic sample data to try the dashboards without connecting a bank."}
      </span>
      <button className="btn" disabled={busy} onClick={() => act("load")}>{loaded ? "Reload demo data" : "Load demo data"}</button>
      {loaded && <button className="btn danger" disabled={busy} onClick={() => act("clear")}>Clear demo data</button>}
    </div>
  );
}
