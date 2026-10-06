import { db } from "./db";
import type { EntityId } from "./entities";

import type { InputMetric, Unit } from "./metrics-types";
export type { InputMetric, MetricMonth, Unit } from "./metrics-types";

export interface DerivedMetric {
  key: string;
  label: string;
  unit: Unit;
  help: string;
  /** Higher is better? Drives the up/down hint only. */
  higherIsBetter: boolean;
  compute: (v: Record<string, number | null>) => number | null;
}

const div = (a: number | null, b: number | null) => (a == null || b == null || b === 0 ? null : a / b);
const sub = (a: number | null, b: number | null) => (a == null ? null : a - (b ?? 0));

export const METRIC_DEFS: Record<EntityId, { inputs: InputMetric[]; bank: InputMetric[]; derived: DerivedMetric[] }> = {
  thrive: {
    inputs: [
      { key: "apps_submitted", label: "Applications submitted", unit: "count" },
      { key: "policies_issued", label: "Policies issued / placed", unit: "count" },
      { key: "submitted_ap", label: "Submitted annual premium", unit: "usd" },
      { key: "issued_ap", label: "Issued annual premium", unit: "usd" },
      { key: "active_agents", label: "Active writing agents", unit: "count" },
      { key: "new_agents", label: "New agents contracted", unit: "count" },
      { key: "persistency_13m", label: "13-month persistency", unit: "pct", help: "Percent, e.g. 82" },
    ],
    bank: [
      { key: "commission_income", label: "Commissions received", unit: "usd", bankCategory: "Commission Income" },
      { key: "agent_payouts", label: "Agent payouts & overrides", unit: "usd", bankCategory: "Agent Payouts & Overrides" },
      { key: "chargebacks", label: "Commission chargebacks", unit: "usd", bankCategory: "Commission Chargebacks" },
      { key: "lead_cost", label: "Lead purchases", unit: "usd", bankCategory: "Lead Purchases" },
    ],
    derived: [
      {
        key: "placement_rate",
        label: "Placement rate",
        unit: "pct",
        help: "Policies issued ÷ applications submitted",
        higherIsBetter: true,
        compute: (v) => {
          const r = div(v.policies_issued, v.apps_submitted);
          return r == null ? null : r * 100;
        },
      },
      {
        key: "avg_ap",
        label: "Avg premium per policy",
        unit: "usd",
        help: "Issued AP ÷ policies issued",
        higherIsBetter: true,
        compute: (v) => div(v.issued_ap, v.policies_issued),
      },
      {
        key: "ap_per_agent",
        label: "Submitted AP per agent",
        unit: "usd",
        help: "Submitted AP ÷ active agents",
        higherIsBetter: true,
        compute: (v) => div(v.submitted_ap, v.active_agents),
      },
      {
        key: "net_commission",
        label: "Net commission (house)",
        unit: "usd",
        help: "Commissions received − agent payouts − chargebacks",
        higherIsBetter: true,
        compute: (v) => sub(sub(v.commission_income, v.agent_payouts), v.chargebacks),
      },
      {
        key: "chargeback_ratio",
        label: "Chargeback ratio",
        unit: "pct",
        help: "Chargebacks ÷ commissions received",
        higherIsBetter: false,
        compute: (v) => {
          const r = div(v.chargebacks, v.commission_income);
          return r == null ? null : r * 100;
        },
      },
      {
        key: "cost_per_policy",
        label: "Lead cost per issued policy",
        unit: "usd",
        help: "Lead purchases ÷ policies issued",
        higherIsBetter: false,
        compute: (v) => div(v.lead_cost, v.policies_issued),
      },
    ],
  },
  leadtech: {
    inputs: [
      { key: "leads_generated", label: "Leads generated", unit: "count" },
      { key: "leads_sold", label: "Leads sold", unit: "count" },
      { key: "leads_returned", label: "Leads returned / credited", unit: "count" },
      { key: "active_buyers", label: "Active buyers", unit: "count" },
      { key: "transfers", label: "Live transfers delivered", unit: "count" },
    ],
    bank: [
      { key: "lead_revenue", label: "Lead sales revenue", unit: "usd", bankCategory: "Lead Sales" },
      { key: "ad_spend", label: "Ad spend", unit: "usd", bankCategory: "Advertising & Lead Gen" },
      { key: "payroll", label: "Payroll & contractors", unit: "usd", bankCategory: "Payroll & Contractors" },
      { key: "software", label: "Software & SaaS", unit: "usd", bankCategory: "Software & SaaS" },
    ],
    derived: [
      {
        key: "cpl",
        label: "Cost per lead",
        unit: "usd",
        help: "Ad spend ÷ leads generated",
        higherIsBetter: false,
        compute: (v) => div(v.ad_spend, v.leads_generated),
      },
      {
        key: "rev_per_lead",
        label: "Revenue per lead sold",
        unit: "usd",
        help: "Lead revenue ÷ leads sold",
        higherIsBetter: true,
        compute: (v) => div(v.lead_revenue, v.leads_sold),
      },
      {
        key: "sell_through",
        label: "Sell-through",
        unit: "pct",
        help: "Leads sold ÷ leads generated",
        higherIsBetter: true,
        compute: (v) => {
          const r = div(v.leads_sold, v.leads_generated);
          return r == null ? null : r * 100;
        },
      },
      {
        key: "return_rate",
        label: "Return rate",
        unit: "pct",
        help: "Leads returned ÷ leads sold",
        higherIsBetter: false,
        compute: (v) => {
          const r = div(v.leads_returned, v.leads_sold);
          return r == null ? null : r * 100;
        },
      },
      {
        key: "roas",
        label: "Return on ad spend",
        unit: "ratio",
        help: "Lead revenue ÷ ad spend",
        higherIsBetter: true,
        compute: (v) => div(v.lead_revenue, v.ad_spend),
      },
      {
        key: "gross_profit",
        label: "Gross profit",
        unit: "usd",
        help: "Lead revenue − ad spend",
        higherIsBetter: true,
        compute: (v) => sub(v.lead_revenue, v.ad_spend),
      },
    ],
  },
};

import type { MetricMonth } from "./metrics-types";

export function metricsFor(entity: EntityId, months: string[]): MetricMonth[] {
  const defs = METRIC_DEFS[entity];
  const d = db();
  const manual = d
    .prepare("SELECT month, metric, value FROM business_metrics WHERE entity_id = ? AND month BETWEEN ? AND ?")
    .all(entity, months[0], months[months.length - 1]) as { month: string; metric: string; value: number }[];
  const bankRows = d
    .prepare(
      `SELECT substr(t.date,1,7) AS month, c.name AS category, SUM(ABS(t.amount)) AS value
       FROM transactions t JOIN categories c ON c.id = t.category_id JOIN accounts a ON a.account_id = t.account_id
       WHERE a.hidden = 0 AND t.entity_id = ? AND substr(t.date,1,7) BETWEEN ? AND ?
       GROUP BY month, category`,
    )
    .all(entity, months[0], months[months.length - 1]) as { month: string; category: string; value: number }[];

  return months.map((month) => {
    const values: Record<string, number | null> = {};
    const fromBank: Record<string, boolean> = {};
    for (const m of [...defs.inputs, ...defs.bank]) {
      const man = manual.find((r) => r.month === month && r.metric === m.key);
      if (man) {
        values[m.key] = man.value;
        fromBank[m.key] = false;
      } else if (m.bankCategory) {
        values[m.key] = bankRows.find((r) => r.month === month && r.category === m.bankCategory)?.value ?? 0;
        fromBank[m.key] = true;
      } else {
        values[m.key] = null;
        fromBank[m.key] = false;
      }
    }
    const derived: Record<string, number | null> = {};
    for (const k of defs.derived) derived[k.key] = k.compute(values);
    return { month, values, fromBank, derived };
  });
}

export function saveMetric(entity: EntityId, month: string, metric: string, value: number | null) {
  const d = db();
  if (value == null || Number.isNaN(value)) {
    d.prepare("DELETE FROM business_metrics WHERE entity_id = ? AND month = ? AND metric = ?").run(entity, month, metric);
  } else {
    d.prepare(
      `INSERT INTO business_metrics (entity_id, month, metric, value) VALUES (?, ?, ?, ?)
       ON CONFLICT(entity_id, month, metric) DO UPDATE SET value = excluded.value`,
    ).run(entity, month, metric, value);
  }
}

export function isKnownMetric(entity: EntityId, key: string) {
  const defs = METRIC_DEFS[entity];
  return [...defs.inputs, ...defs.bank].some((m) => m.key === key);
}
