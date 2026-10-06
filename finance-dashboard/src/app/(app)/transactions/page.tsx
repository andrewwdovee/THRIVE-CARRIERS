import { categories, monthLabel, monthsFor, transactions } from "@/lib/analytics";
import { ENTITIES, isEntityId } from "@/lib/entities";
import { usd } from "@/lib/format";
import { TransactionTable } from "@/components/TransactionTable";

const PAGE = 100;

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const entity = sp.entity && isEntityId(sp.entity) ? sp.entity : null;
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : null;
  const categoryId = sp.category === "none" ? "none" : sp.category ? Number(sp.category) : null;
  const dir = sp.dir === "in" || sp.dir === "out" ? sp.dir : null;
  const q = sp.q?.trim() || null;
  const page = Math.max(1, Number(sp.page) || 1);

  const res = transactions({ entity, month, categoryId, direction: dir, q, limit: PAGE, offset: (page - 1) * PAGE });
  const cats = categories();
  const months = monthsFor("12m").reverse();
  const qs = (over: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const merged = { entity, month, category: sp.category ?? null, dir, q, page: String(page), ...over };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `?${p.toString()}`;
  };
  const exportHref = `/api/transactions/export?${new URLSearchParams({ ...(entity ? { entity } : {}), ...(month ? { month } : {}) })}`;

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Transactions</h1>
          <div className="sub">Pick a category to fix one, select several to bulk-move, or turn one into a rule so future matches file themselves.</div>
        </div>
        <div className="actions">
          <a className="btn" href={exportHref}>Export CSV</a>
        </div>
      </div>

      <form className="toolbar card" method="get" style={{ padding: 12 }}>
        <label className="field grow">
          Search
          <input className="input" name="q" defaultValue={q ?? ""} placeholder="Merchant, description or note" />
        </label>
        <label className="field">
          Company
          <select className="select" name="entity" defaultValue={entity ?? ""}>
            <option value="">Both</option>
            {ENTITIES.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Month
          <select className="select" name="month" defaultValue={month ?? ""}>
            <option value="">All</option>
            {months.map((m) => (
              <option key={m} value={m}>{monthLabel(m, true)}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Category
          <select className="select" name="category" defaultValue={sp.category ?? ""}>
            <option value="">All</option>
            <option value="none">Uncategorized</option>
            {(["income", "expense", "transfer"] as const).map((k) => (
              <optgroup key={k} label={k[0].toUpperCase() + k.slice(1)}>
                {cats.filter((c) => c.kind === k).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="field">
          Direction
          <select className="select" name="dir" defaultValue={dir ?? ""}>
            <option value="">In &amp; out</option>
            <option value="in">Money in</option>
            <option value="out">Money out</option>
          </select>
        </label>
        <button className="btn primary">Apply</button>
        <a className="btn" href="/transactions">Reset</a>
      </form>

      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <div className="card stat"><div className="label">Matching transactions</div><div className="value num">{res.total.toLocaleString()}</div></div>
        <div className="card stat"><div className="label">Money in</div><div className="value num">{usd(res.sumIn)}</div></div>
        <div className="card stat"><div className="label">Money out</div><div className="value num">{usd(res.sumOut)}</div></div>
      </div>

      <div className="card">
        <TransactionTable rows={res.rows} categories={cats} showEntity={!entity} />
        <div className="pager">
          <span>
            {res.total === 0 ? "No results" : `${(page - 1) * PAGE + 1}–${Math.min(page * PAGE, res.total)} of ${res.total.toLocaleString()}`}
          </span>
          <span className="actions">
            {page > 1 && <a className="btn sm" href={qs({ page: String(page - 1) })}>← Newer</a>}
            {page * PAGE < res.total && <a className="btn sm" href={qs({ page: String(page + 1) })}>Older →</a>}
          </span>
        </div>
      </div>
    </>
  );
}
