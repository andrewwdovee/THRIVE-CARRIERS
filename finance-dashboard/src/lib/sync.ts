import type { AccountBase, Holding, RemovedTransaction, Security, Transaction } from "plaid";
import { db } from "./db";
import { decrypt, encrypt } from "./crypto";
import { countryCodes, plaid, plaidErrorMessage } from "./plaid";
import { categorize, loadRules } from "./categorize";
import type { EntityId } from "./entities";

export type SyncTrigger = "link" | "manual" | "schedule" | "webhook";

interface ItemRow {
  item_id: string;
  entity_id: EntityId;
  access_token_enc: string;
  cursor: string | null;
  has_investments: number;
}

const running = new Map<string, Promise<void>>();

const today = () => new Date().toISOString().slice(0, 10);

function getItem(itemId: string): ItemRow | undefined {
  return db()
    .prepare("SELECT item_id, entity_id, access_token_enc, cursor, has_investments FROM plaid_items WHERE item_id = ?")
    .get(itemId) as ItemRow | undefined;
}

// ---------------------------------------------------------------- linking

export async function linkItem(publicToken: string, entityId: EntityId): Promise<string> {
  const client = plaid();
  const { data } = await client.itemPublicTokenExchange({ public_token: publicToken });
  const accessToken = data.access_token;
  const itemId = data.item_id;

  let institutionId: string | null = null;
  let institutionName: string | null = null;
  // Investments is requested as an optional product; assume yes and let the first
  // holdings call turn it off if the institution doesn't support it.
  const hasInvestments = 1;
  try {
    const item = await client.itemGet({ access_token: accessToken });
    institutionId = item.data.item.institution_id ?? null;
    if (institutionId) {
      const inst = await client.institutionsGetById({ institution_id: institutionId, country_codes: countryCodes() });
      institutionName = inst.data.institution.name;
    }
  } catch {
    /* institution name is cosmetic */
  }

  db()
    .prepare(
      `INSERT INTO plaid_items (item_id, entity_id, access_token_enc, institution_id, institution_name, has_investments)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(item_id) DO UPDATE SET access_token_enc = excluded.access_token_enc, entity_id = excluded.entity_id,
         status = 'ok', error = NULL`,
    )
    .run(itemId, entityId, encrypt(accessToken), institutionId, institutionName, hasInvestments);

  await syncItem(itemId, "link");
  return itemId;
}

export async function removeItem(itemId: string) {
  const item = getItem(itemId);
  if (!item) return;
  try {
    await plaid().itemRemove({ access_token: decrypt(item.access_token_enc) });
  } catch (err) {
    console.warn("[plaid] itemRemove failed, deleting locally anyway:", plaidErrorMessage(err).message);
  }
  const d = db();
  d.transaction(() => {
    const accountIds = (d.prepare("SELECT account_id FROM accounts WHERE item_id = ?").all(itemId) as { account_id: string }[]).map(
      (a) => a.account_id,
    );
    for (const id of accountIds) {
      d.prepare("DELETE FROM transactions WHERE account_id = ?").run(id);
      d.prepare("DELETE FROM holdings WHERE account_id = ?").run(id);
      d.prepare("DELETE FROM balance_snapshots WHERE account_id = ?").run(id);
    }
    d.prepare("DELETE FROM accounts WHERE item_id = ?").run(itemId);
    d.prepare("DELETE FROM plaid_items WHERE item_id = ?").run(itemId);
  })();
}

// ---------------------------------------------------------------- syncing

/** Sync one Item. Concurrent calls for the same Item share one run. */
export function syncItem(itemId: string, trigger: SyncTrigger, opts: { investments?: boolean } = {}): Promise<void> {
  const existing = running.get(itemId);
  if (existing) return existing;
  const p = doSync(itemId, trigger, opts).finally(() => running.delete(itemId));
  running.set(itemId, p);
  return p;
}

export async function syncAll(trigger: SyncTrigger, opts: { investments?: boolean } = {}) {
  // Demo items (access token "demo") have nothing to sync.
  const items = db().prepare("SELECT item_id FROM plaid_items WHERE access_token_enc != 'demo'").all() as { item_id: string }[];
  for (const { item_id } of items) {
    try {
      await syncItem(item_id, trigger, opts);
    } catch (err) {
      console.error(`[sync] ${item_id} failed:`, err);
    }
  }
  snapshotInvestmentTotals();
}

async function doSync(itemId: string, trigger: SyncTrigger, opts: { investments?: boolean }) {
  const item = getItem(itemId);
  if (!item) throw new Error(`Unknown item ${itemId}`);
  if (item.access_token_enc === "demo") return;
  const d = db();
  const log = d
    .prepare("INSERT INTO sync_log (item_id, trigger, started_at) VALUES (?, ?, datetime('now'))")
    .run(itemId, trigger);
  const logId = log.lastInsertRowid;
  const accessToken = decrypt(item.access_token_enc);

  try {
    await refreshAccounts(item, accessToken);
    const counts = await syncTransactions(item, accessToken);
    if (opts.investments !== false && item.has_investments) {
      await syncHoldings(item, accessToken);
    }
    d.prepare("UPDATE plaid_items SET status = 'ok', error = NULL, last_synced_at = datetime('now') WHERE item_id = ?").run(itemId);
    d.prepare(
      "UPDATE sync_log SET finished_at = datetime('now'), status = 'ok', added = ?, modified = ?, removed = ? WHERE id = ?",
    ).run(counts.added, counts.modified, counts.removed, logId);
  } catch (err) {
    const { code, message } = plaidErrorMessage(err);
    const status = code === "ITEM_LOGIN_REQUIRED" ? "login_required" : "error";
    d.prepare("UPDATE plaid_items SET status = ?, error = ? WHERE item_id = ?").run(status, message, itemId);
    d.prepare("UPDATE sync_log SET finished_at = datetime('now'), status = 'error', message = ? WHERE id = ?").run(message, logId);
    throw err;
  }
}

function upsertAccounts(item: ItemRow, accounts: Pick<AccountBase, "account_id" | "name" | "official_name" | "mask" | "type" | "subtype" | "balances">[]) {
  const d = db();
  const up = d.prepare(
    `INSERT INTO accounts (account_id, item_id, entity_id, name, official_name, mask, type, subtype,
        current_balance, available_balance, iso_currency, updated_at)
     VALUES (@account_id, @item_id, @entity_id, @name, @official_name, @mask, @type, @subtype,
        @current, @available, @iso, datetime('now'))
     ON CONFLICT(account_id) DO UPDATE SET name = excluded.name, official_name = excluded.official_name,
        mask = excluded.mask, type = excluded.type, subtype = excluded.subtype,
        current_balance = excluded.current_balance, available_balance = excluded.available_balance,
        iso_currency = excluded.iso_currency, updated_at = excluded.updated_at`,
  );
  const snap = d.prepare(
    "INSERT INTO balance_snapshots (account_id, date, current_balance) VALUES (?, ?, ?) ON CONFLICT(account_id, date) DO UPDATE SET current_balance = excluded.current_balance",
  );
  d.transaction(() => {
    for (const a of accounts) {
      up.run({
        account_id: a.account_id,
        item_id: item.item_id,
        entity_id: item.entity_id,
        name: a.name,
        official_name: a.official_name ?? null,
        mask: a.mask ?? null,
        type: a.type,
        subtype: a.subtype ?? null,
        current: a.balances.current ?? null,
        available: a.balances.available ?? null,
        iso: a.balances.iso_currency_code ?? "USD",
      });
      snap.run(a.account_id, today(), a.balances.current ?? null);
    }
  })();
}

async function refreshAccounts(item: ItemRow, accessToken: string) {
  // /accounts/get returns cached balances (free). Plaid refreshes them on its own
  // schedule and on every transactions update, which is fine for a twice-daily view.
  const { data } = await plaid().accountsGet({ access_token: accessToken });
  upsertAccounts(item, data.accounts);
}

async function syncTransactions(item: ItemRow, accessToken: string) {
  const client = plaid();
  const startCursor = item.cursor ?? undefined;
  let cursor = startCursor;
  let added: Transaction[] = [];
  let modified: Transaction[] = [];
  let removed: RemovedTransaction[] = [];
  let hasMore = true;

  while (hasMore) {
    try {
      const { data } = await client.transactionsSync({ access_token: accessToken, cursor, count: 500 });
      added = added.concat(data.added);
      modified = modified.concat(data.modified);
      removed = removed.concat(data.removed);
      hasMore = data.has_more;
      cursor = data.next_cursor;
    } catch (err) {
      if (plaidErrorMessage(err).code === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION") {
        // Plaid says: restart the whole pagination loop from the original cursor.
        cursor = startCursor;
        added = [];
        modified = [];
        removed = [];
        hasMore = true;
        continue;
      }
      throw err;
    }
  }

  const d = db();
  const rules = loadRules();
  const accountEntity = new Map(
    (d.prepare("SELECT account_id, entity_id FROM accounts WHERE item_id = ?").all(item.item_id) as {
      account_id: string;
      entity_id: string;
    }[]).map((a) => [a.account_id, a.entity_id]),
  );

  const existing = d.prepare("SELECT category_source, category_id, note FROM transactions WHERE transaction_id = ?");
  const upsert = d.prepare(
    `INSERT INTO transactions (transaction_id, account_id, entity_id, date, name, merchant_name, amount, iso_currency,
        plaid_category, plaid_detailed, category_id, category_source, pending)
     VALUES (@transaction_id, @account_id, @entity_id, @date, @name, @merchant_name, @amount, @iso,
        @plaid_category, @plaid_detailed, @category_id, @category_source, @pending)
     ON CONFLICT(transaction_id) DO UPDATE SET account_id = excluded.account_id, date = excluded.date, name = excluded.name,
        merchant_name = excluded.merchant_name, amount = excluded.amount, iso_currency = excluded.iso_currency,
        plaid_category = excluded.plaid_category, plaid_detailed = excluded.plaid_detailed,
        category_id = excluded.category_id, category_source = excluded.category_source, pending = excluded.pending`,
  );
  const del = d.prepare("DELETE FROM transactions WHERE transaction_id = ?");

  d.transaction(() => {
    for (const t of [...added, ...modified]) {
      const entityId = accountEntity.get(t.account_id) ?? item.entity_id;
      const amount = -t.amount; // Plaid: positive = outflow. We store positive = inflow.
      const base = {
        transaction_id: t.transaction_id,
        account_id: t.account_id,
        entity_id: entityId,
        date: t.authorized_date && t.pending ? t.authorized_date : t.date,
        name: t.name,
        merchant_name: t.merchant_name ?? t.counterparties?.[0]?.name ?? null,
        amount,
        iso: t.iso_currency_code ?? "USD",
        plaid_category: t.personal_finance_category?.primary ?? null,
        plaid_detailed: t.personal_finance_category?.detailed ?? null,
        pending: t.pending ? 1 : 0,
      };
      const prev = existing.get(t.transaction_id) as { category_source: string; category_id: number | null } | undefined;
      let category_id: number | null;
      let category_source: string;
      if (prev?.category_source === "manual") {
        category_id = prev.category_id;
        category_source = "manual";
      } else {
        const c = categorize({ ...base, entity_id: entityId }, rules);
        category_id = c.category_id;
        category_source = c.source;
      }
      upsert.run({ ...base, category_id, category_source });
    }
    for (const r of removed) if (r.transaction_id) del.run(r.transaction_id);
    d.prepare("UPDATE plaid_items SET cursor = ? WHERE item_id = ?").run(cursor ?? null, item.item_id);
  })();

  return { added: added.length, modified: modified.length, removed: removed.length };
}

async function syncHoldings(item: ItemRow, accessToken: string) {
  let holdings: Holding[];
  let securities: Security[];
  try {
    const { data } = await plaid().investmentsHoldingsGet({ access_token: accessToken });
    holdings = data.holdings;
    securities = data.securities;
    upsertAccounts(item, data.accounts);
  } catch (err) {
    const code = plaidErrorMessage(err).code;
    if (
      code === "PRODUCTS_NOT_SUPPORTED" ||
      code === "NO_INVESTMENT_ACCOUNTS" ||
      code === "PRODUCT_NOT_ENABLED" ||
      code === "INVALID_PRODUCT" ||
      code === "ADDITIONAL_CONSENT_REQUIRED"
    ) {
      db().prepare("UPDATE plaid_items SET has_investments = 0 WHERE item_id = ?").run(item.item_id);
      return;
    }
    if (code === "PRODUCT_NOT_READY") return; // initial extraction still running; next sync will pick it up
    throw err;
  }

  const d = db();
  d.transaction(() => {
    const upSec = d.prepare(
      `INSERT INTO securities (security_id, name, ticker, type, close_price, close_price_as_of)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(security_id) DO UPDATE SET name = excluded.name, ticker = excluded.ticker, type = excluded.type,
         close_price = excluded.close_price, close_price_as_of = excluded.close_price_as_of`,
    );
    for (const s of securities) {
      upSec.run(s.security_id, s.name ?? null, s.ticker_symbol ?? null, s.type ?? null, s.close_price ?? null, s.close_price_as_of ?? null);
    }
    const accountIds = [...new Set(holdings.map((h) => h.account_id))];
    for (const id of accountIds) d.prepare("DELETE FROM holdings WHERE account_id = ?").run(id);
    const upH = d.prepare(
      `INSERT INTO holdings (account_id, security_id, quantity, institution_price, institution_value, cost_basis, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
    );
    for (const h of holdings) {
      upH.run(h.account_id, h.security_id, h.quantity, h.institution_price, h.institution_value, h.cost_basis ?? null);
    }
  })();
}

/** Record today's total investment value per entity for the trend chart. */
export function snapshotInvestmentTotals() {
  const d = db();
  const rows = d
    .prepare(
      `SELECT a.entity_id, SUM(h.institution_value) AS value, SUM(h.cost_basis) AS cost
       FROM holdings h JOIN accounts a ON a.account_id = h.account_id
       WHERE a.hidden = 0 GROUP BY a.entity_id`,
    )
    .all() as { entity_id: string; value: number; cost: number | null }[];
  const up = d.prepare(
    `INSERT INTO investment_snapshots (entity_id, date, value, cost_basis) VALUES (?, ?, ?, ?)
     ON CONFLICT(entity_id, date) DO UPDATE SET value = excluded.value, cost_basis = excluded.cost_basis`,
  );
  for (const r of rows) up.run(r.entity_id, today(), r.value ?? 0, r.cost);
}
