import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_CATEGORIES, DEFAULT_RULES } from "./categories";
import { ENTITIES } from "./entities";

const globalForDb = globalThis as unknown as { __financeDb?: Database.Database };

function open(): Database.Database {
  const file = path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env.DATABASE_PATH || "./data/finance.db");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

export function db(): Database.Database {
  if (!globalForDb.__financeDb) globalForDb.__financeDb = open();
  return globalForDb.__financeDb;
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      short TEXT NOT NULL,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS plaid_items (
      item_id TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL REFERENCES entities(id),
      access_token_enc TEXT NOT NULL,
      institution_id TEXT,
      institution_name TEXT,
      cursor TEXT,
      status TEXT NOT NULL DEFAULT 'ok',
      error TEXT,
      has_investments INTEGER NOT NULL DEFAULT 0,
      last_synced_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS accounts (
      account_id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES plaid_items(item_id) ON DELETE CASCADE,
      entity_id TEXT NOT NULL REFERENCES entities(id),
      name TEXT NOT NULL,
      official_name TEXT,
      mask TEXT,
      type TEXT,
      subtype TEXT,
      current_balance REAL,
      available_balance REAL,
      iso_currency TEXT DEFAULT 'USD',
      hidden INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS balance_snapshots (
      account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      current_balance REAL,
      PRIMARY KEY (account_id, date)
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL CHECK (kind IN ('income','expense','transfer')),
      builtin INTEGER NOT NULL DEFAULT 0
    );

    -- Signed amount: positive = money IN, negative = money OUT (opposite of Plaid).
    CREATE TABLE IF NOT EXISTS transactions (
      transaction_id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
      entity_id TEXT NOT NULL REFERENCES entities(id),
      date TEXT NOT NULL,
      name TEXT NOT NULL,
      merchant_name TEXT,
      amount REAL NOT NULL,
      iso_currency TEXT DEFAULT 'USD',
      plaid_category TEXT,
      plaid_detailed TEXT,
      category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      category_source TEXT NOT NULL DEFAULT 'auto',
      pending INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_tx_entity_date ON transactions(entity_id, date);
    CREATE INDEX IF NOT EXISTS idx_tx_category ON transactions(category_id);

    CREATE TABLE IF NOT EXISTS rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern TEXT NOT NULL,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      entity_id TEXT REFERENCES entities(id),
      direction TEXT NOT NULL DEFAULT 'any' CHECK (direction IN ('any','in','out')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS securities (
      security_id TEXT PRIMARY KEY,
      name TEXT,
      ticker TEXT,
      type TEXT,
      close_price REAL,
      close_price_as_of TEXT
    );

    CREATE TABLE IF NOT EXISTS holdings (
      account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
      security_id TEXT NOT NULL REFERENCES securities(security_id),
      quantity REAL,
      institution_price REAL,
      institution_value REAL,
      cost_basis REAL,
      updated_at TEXT,
      PRIMARY KEY (account_id, security_id)
    );

    CREATE TABLE IF NOT EXISTS investment_snapshots (
      entity_id TEXT NOT NULL REFERENCES entities(id),
      date TEXT NOT NULL,
      value REAL NOT NULL,
      cost_basis REAL,
      PRIMARY KEY (entity_id, date)
    );

    CREATE TABLE IF NOT EXISTS business_metrics (
      entity_id TEXT NOT NULL REFERENCES entities(id),
      month TEXT NOT NULL,
      metric TEXT NOT NULL,
      value REAL NOT NULL,
      PRIMARY KEY (entity_id, month, metric)
    );

    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id TEXT,
      trigger TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      added INTEGER DEFAULT 0,
      modified INTEGER DEFAULT 0,
      removed INTEGER DEFAULT 0,
      message TEXT
    );
  `);

  const insEntity = db.prepare(
    "INSERT INTO entities (id, name, short, description) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, short=excluded.short, description=excluded.description",
  );
  for (const e of ENTITIES) insEntity.run(e.id, e.name, e.short, e.description);

  const insCat = db.prepare("INSERT OR IGNORE INTO categories (name, kind, builtin) VALUES (?, ?, 1)");
  for (const c of DEFAULT_CATEGORIES) insCat.run(c.name, c.kind);

  db.exec("CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT)");
  const seeded = db.prepare("SELECT value FROM app_meta WHERE key = 'default_rules_seeded'").get();
  if (!seeded) {
    const insRule = db.prepare(
      "INSERT INTO rules (pattern, category_id, direction) SELECT ?, id, ? FROM categories WHERE name = ?",
    );
    for (const r of DEFAULT_RULES) insRule.run(r.pattern, r.direction, r.category);
    db.prepare("INSERT INTO app_meta (key, value) VALUES ('default_rules_seeded', '1')").run();
  }
}
