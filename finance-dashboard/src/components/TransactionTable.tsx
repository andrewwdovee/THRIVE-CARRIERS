"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Category, TxRow } from "@/lib/analytics";
import { ENTITIES } from "@/lib/entities";
import { shortDate, usd } from "@/lib/format";

function CategorySelect({
  value,
  categories,
  onChange,
  includeAuto,
}: {
  value: number | null;
  categories: Category[];
  onChange: (v: number | null) => void;
  includeAuto?: boolean;
}) {
  return (
    <select
      className="select sm"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      style={{ maxWidth: 210 }}
    >
      {includeAuto ? <option value="">↺ Automatic</option> : <option value="">Choose…</option>}
      {(["income", "expense", "transfer"] as const).map((k) => (
        <optgroup key={k} label={k[0].toUpperCase() + k.slice(1)}>
          {categories.filter((c) => c.kind === k).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

export function TransactionTable({ rows, categories, showEntity }: { rows: TxRow[]; categories: Category[]; showEntity: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCat, setBulkCat] = useState<number | null>(null);
  const [ruleFor, setRuleFor] = useState<TxRow | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function setCategory(id: string, category_id: number | null) {
    await fetch(`/api/transactions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ category_id }),
    });
    router.refresh();
  }

  async function bulk() {
    if (!bulkCat || selected.size === 0) return;
    await fetch("/api/transactions/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [...selected], category_id: bulkCat }),
    });
    setMsg(`Moved ${selected.size} transactions.`);
    setSelected(new Set());
    router.refresh();
  }

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  if (rows.length === 0) return <p className="muted">No transactions match these filters.</p>;

  return (
    <>
      {selected.size > 0 && (
        <div className="toolbar" style={{ alignItems: "center" }}>
          <b>{selected.size} selected</b>
          <CategorySelect value={bulkCat} categories={categories} onChange={setBulkCat} />
          <button className="btn sm primary" onClick={bulk} disabled={!bulkCat}>Move to category</button>
          <button className="btn sm" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}
      {msg && <div className="banner" style={{ background: "var(--surface-2)", color: "var(--ink-2)" }}>{msg}</div>}
      {ruleFor && (
        <RuleForm
          tx={ruleFor}
          categories={categories}
          onDone={(m) => {
            setRuleFor(null);
            if (m) setMsg(m);
            router.refresh();
          }}
        />
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: 28 }}>
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={selected.size === rows.length}
                  onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.transaction_id)) : new Set())}
                />
              </th>
              <th>Date</th>
              <th>Description</th>
              {showEntity && <th>Company</th>}
              <th>Account</th>
              <th>Category</th>
              <th className="r">Amount</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.transaction_id}>
                <td>
                  <input type="checkbox" aria-label="Select" checked={selected.has(t.transaction_id)} onChange={() => toggle(t.transaction_id)} />
                </td>
                <td className="muted">{shortDate(t.date)}</td>
                <td className="wrap">
                  <div>
                    {t.merchant_name || t.name} {t.pending ? <span className="tag">pending</span> : null}
                  </div>
                  {t.merchant_name && t.merchant_name !== t.name && <div className="muted" style={{ fontSize: 12 }}>{t.name}</div>}
                </td>
                {showEntity && (
                  <td>
                    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                      <span className="dot" style={{ background: `var(--entity-${t.entity_id})` }} />
                      {ENTITIES.find((e) => e.id === t.entity_id)?.short}
                    </span>
                  </td>
                )}
                <td className="muted">
                  {t.account_name} {t.account_mask ? `••${t.account_mask}` : ""}
                </td>
                <td>
                  <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                    <CategorySelect value={t.category_id} categories={categories} onChange={(v) => setCategory(t.transaction_id, v)} includeAuto />
                    {t.category_source === "rule" && <span className="tag" title="Set by a rule">rule</span>}
                    {t.category_source === "manual" && <span className="tag" title="Set by hand">manual</span>}
                  </span>
                </td>
                <td className={`r num ${t.amount > 0 ? "amount-in" : ""}`}>{usd(t.amount, { cents: true, sign: true })}</td>
                <td>
                  <button className="btn sm" onClick={() => setRuleFor(t)} title="Always categorize transactions like this one">
                    Rule…
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

function RuleForm({ tx, categories, onDone }: { tx: TxRow; categories: Category[]; onDone: (msg?: string) => void }) {
  const [pattern, setPattern] = useState((tx.merchant_name || tx.name).toLowerCase());
  const [cat, setCat] = useState<number | null>(tx.category_id);
  const [scope, setScope] = useState<string>("");
  const [direction, setDirection] = useState(tx.amount > 0 ? "in" : "out");
  const [err, setErr] = useState<string | null>(null);
  async function save() {
    const res = await fetch("/api/rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pattern, category_id: cat, entity_id: scope || null, direction }),
    });
    const j = await res.json();
    if (!res.ok) return setErr(j.error);
    onDone(`Rule saved — ${j.changed} existing transaction${j.changed === 1 ? "" : "s"} re-categorized.`);
  }
  return (
    <div className="card" style={{ background: "var(--surface-2)", marginBottom: 12 }}>
      <h2>New rule</h2>
      <p className="hint">
        Transactions whose description or merchant contains this text get this category. Separate alternatives with “|”. Hand-set categories are never overwritten.
      </p>
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <label className="field grow">
          Contains
          <input className="input" value={pattern} onChange={(e) => setPattern(e.target.value)} />
        </label>
        <label className="field">
          Category
          <CategorySelect value={cat} categories={categories} onChange={setCat} />
        </label>
        <label className="field">
          Company
          <select className="select" value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="">Both</option>
            {ENTITIES.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Applies to
          <select className="select" value={direction} onChange={(e) => setDirection(e.target.value)}>
            <option value="any">In &amp; out</option>
            <option value="in">Money in</option>
            <option value="out">Money out</option>
          </select>
        </label>
        <button className="btn primary" onClick={save} disabled={!pattern.trim() || !cat}>Save rule</button>
        <button className="btn" onClick={() => onDone()}>Cancel</button>
      </div>
      {err && <div className="tag err" style={{ marginTop: 8 }}>{err}</div>}
    </div>
  );
}
