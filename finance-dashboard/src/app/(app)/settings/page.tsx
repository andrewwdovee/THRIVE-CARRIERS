import { CategoryManager, ConnectBank, DemoControls, ItemCard, RuleManager } from "@/components/Settings";
import { accounts, categories } from "@/lib/analytics";
import { db } from "@/lib/db";
import { hasDemoData } from "@/lib/demo";
import { getEntity } from "@/lib/entities";
import { relativeTime } from "@/lib/format";
import { plaidConfigured } from "@/lib/plaid";

export default function SettingsPage() {
  const d = db();
  const items = d
    .prepare("SELECT item_id, entity_id, institution_name, status, error, last_synced_at, access_token_enc = 'demo' AS demo FROM plaid_items ORDER BY created_at")
    .all() as { item_id: string; entity_id: string; institution_name: string | null; status: string; error: string | null; last_synced_at: string | null; demo: number }[];
  const accts = accounts(null, true);
  const rules = d
    .prepare("SELECT r.id, r.pattern, r.entity_id, r.direction, c.name AS category_name FROM rules r JOIN categories c ON c.id = r.category_id ORDER BY r.id DESC")
    .all() as { id: number; pattern: string; entity_id: string | null; direction: string; category_name: string }[];
  const cats = categories();
  const usage = new Map(
    (d.prepare("SELECT category_id, COUNT(*) AS n FROM transactions GROUP BY category_id").all() as { category_id: number; n: number }[]).map((r) => [
      r.category_id,
      r.n,
    ]),
  );
  const log = d
    .prepare(
      "SELECT l.*, p.institution_name FROM sync_log l LEFT JOIN plaid_items p ON p.item_id = l.item_id ORDER BY l.id DESC LIMIT 12",
    )
    .all() as { id: number; institution_name: string | null; trigger: string; started_at: string; status: string; added: number; modified: number; removed: number; message: string | null }[];
  const ready = plaidConfigured();

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Banks &amp; Settings</h1>
          <div className="sub">Connections, categories and auto-categorization rules</div>
        </div>
      </div>

      {!ready && (
        <div className="banner">
          <b>Plaid isn&apos;t configured yet.</b> Add <code>PLAID_CLIENT_ID</code>, <code>PLAID_SECRET</code> and <code>PLAID_ENV</code> to{" "}
          <code>.env</code> (see <code>.env.example</code>), then restart. You can explore with demo data in the meantime.
        </div>
      )}

      <div className="grid cols-3">
        <div className="card span-2">
          <h2>Connect a bank, card or brokerage</h2>
          <p className="hint">
            Choose which company the login belongs to. If one login holds both companies&apos; accounts, connect it once and move
            individual accounts below.
          </p>
          <ConnectBank disabled={!ready} />
        </div>
        <div className="card">
          <h2>How data stays current</h2>
          <ul className="hint" style={{ paddingLeft: 18, marginBottom: 0 }}>
            <li><b>Real time:</b> {process.env.PLAID_WEBHOOK_URL ? "Plaid webhooks are on — new transactions arrive within minutes of your bank posting them." : "Set PLAID_WEBHOOK_URL to a public URL to get new transactions within minutes."}</li>
            <li><b>Scheduled:</b> full refresh of balances, transactions and investments at <code>{process.env.SYNC_CRON || "0 7,19 * * *"}</code> ({process.env.TZ || "America/New_York"}).</li>
            <li><b>On demand:</b> the Sync now button.</li>
          </ul>
        </div>
      </div>

      <div className="section-title">Connections</div>
      {items.length === 0 ? (
        <div className="card"><p className="muted" style={{ margin: 0 }}>No banks connected yet.</p></div>
      ) : (
        <div className="grid cols-2">
          {items.map((i) => (
            <ItemCard
              key={i.item_id}
              item={{ ...i, entity_name: getEntity(i.entity_id)?.name ?? i.entity_id, last: relativeTime(i.last_synced_at), demo: !!i.demo }}
              accounts={accts.filter((a) => a.item_id === i.item_id)}
            />
          ))}
        </div>
      )}

      <div className="section-title">Categories &amp; rules</div>
      <div className="grid cols-2">
        <div className="card">
          <h2>Categories</h2>
          <p className="hint">Transfer categories are left out of income and spending totals.</p>
          <CategoryManager categories={cats.map((c) => ({ ...c, used: usage.get(c.id) ?? 0 }))} />
        </div>
        <div className="card">
          <h2>Rules</h2>
          <p className="hint">Checked newest first. Create rules from any transaction with the “Rule…” button.</p>
          <RuleManager rules={rules} categories={cats} />
        </div>
      </div>

      <div className="section-title">Sync history</div>
      <div className="card">
        {log.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Nothing synced yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>When</th><th>Bank</th><th>Trigger</th><th>Result</th><th className="r">Added</th><th className="r">Updated</th><th className="r">Removed</th></tr>
              </thead>
              <tbody>
                {log.map((l) => (
                  <tr key={l.id}>
                    <td className="muted">{relativeTime(l.started_at)}</td>
                    <td>{l.institution_name ?? "—"}</td>
                    <td>{l.trigger}</td>
                    <td>{l.status === "ok" ? "OK" : <span className="tag err" title={l.message ?? ""}>{l.status}</span>}</td>
                    <td className="r num">{l.added}</td>
                    <td className="r num">{l.modified}</td>
                    <td className="r num">{l.removed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="section-title">Demo data</div>
      <div className="card">
        <DemoControls loaded={hasDemoData()} />
      </div>
    </>
  );
}
