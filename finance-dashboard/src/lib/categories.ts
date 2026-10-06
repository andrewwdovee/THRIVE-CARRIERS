export type CategoryKind = "income" | "expense" | "transfer";

export const DEFAULT_CATEGORIES: { name: string; kind: CategoryKind }[] = [
  // Income
  { name: "Commission Income", kind: "income" },
  { name: "Lead Sales", kind: "income" },
  { name: "Interest & Dividends", kind: "income" },
  { name: "Refunds & Credits", kind: "income" },
  { name: "Other Income", kind: "income" },
  // Expenses
  { name: "Advertising & Lead Gen", kind: "expense" },
  { name: "Lead Purchases", kind: "expense" },
  { name: "Agent Payouts & Overrides", kind: "expense" },
  { name: "Commission Chargebacks", kind: "expense" },
  { name: "Payroll & Contractors", kind: "expense" },
  { name: "Software & SaaS", kind: "expense" },
  { name: "Licensing & E&O Insurance", kind: "expense" },
  { name: "Professional Services", kind: "expense" },
  { name: "Rent & Utilities", kind: "expense" },
  { name: "Office & Equipment", kind: "expense" },
  { name: "Meals & Entertainment", kind: "expense" },
  { name: "Travel", kind: "expense" },
  { name: "Bank & Merchant Fees", kind: "expense" },
  { name: "Taxes", kind: "expense" },
  { name: "Loan Payments", kind: "expense" },
  { name: "Owner Draws", kind: "expense" },
  { name: "Other Expense", kind: "expense" },
  // Transfers (excluded from income / spending totals)
  { name: "Internal Transfer", kind: "transfer" },
  { name: "Credit Card Payment", kind: "transfer" },
];

/** Starter keyword rules, inserted once on first run. Pattern = "|"-separated, case-insensitive substrings. */
export const DEFAULT_RULES: { pattern: string; category: string; direction: "any" | "in" | "out" }[] = [
  { pattern: "facebk|facebook|meta ads|meta platforms|google ads|googleads|tiktok ads|bing ads|microsoft ads", category: "Advertising & Lead Gen", direction: "out" },
  { pattern: "gusto|adp|paychex|rippling|deel|upwork", category: "Payroll & Contractors", direction: "out" },
  { pattern: "google workspace|gsuite|microsoft 365|zoom|slack|ringcentral|twilio|hubspot|salesforce|gohighlevel|highlevel|openai|anthropic|aws|amazon web services|vercel|notion|docusign|quickbooks|intuit", category: "Software & SaaS", direction: "out" },
  { pattern: "nipr|sircon|e&o insurance|errors and omissions", category: "Licensing & E&O Insurance", direction: "out" },
  { pattern: "irs|usataxpymt|eftps|franchise tax|dept of revenue", category: "Taxes", direction: "out" },
  { pattern: "chargeback|charge back|comm adj|commission adj", category: "Commission Chargebacks", direction: "out" },
  { pattern: "mutual of omaha|americo|aetna|cvs health|foresters|transamerica|corebridge|aig|american amicable|royal neighbors|lincoln|prudential|john hancock|f&g|banner|sbli|gerber|liberty bankers|ethos|commission", category: "Commission Income", direction: "in" },
];

/**
 * Map a Plaid personal_finance_category (primary / detailed) onto our category names.
 * `amount` is signed (+ in / - out).
 */
export function mapPlaidCategory(primary: string | null, detailed: string | null, amount: number): string {
  const p = primary || "";
  const d = detailed || "";
  if (d === "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT") return "Credit Card Payment";
  if (p === "TRANSFER_IN" || p === "TRANSFER_OUT") return "Internal Transfer";
  if (d === "INCOME_DIVIDENDS" || d === "INCOME_INTEREST_EARNED") return "Interest & Dividends";
  if (p === "INCOME") return "Other Income";
  if (amount > 0) {
    // money in that Plaid did not tag as income: refunds, reversals, etc.
    if (p && p !== "INCOME") return "Refunds & Credits";
    return "Other Income";
  }
  if (p === "LOAN_PAYMENTS") return "Loan Payments";
  if (p === "BANK_FEES") return "Bank & Merchant Fees";
  if (p === "FOOD_AND_DRINK" || p === "ENTERTAINMENT") return "Meals & Entertainment";
  if (p === "TRAVEL" || p === "TRANSPORTATION") return "Travel";
  if (p === "RENT_AND_UTILITIES") return "Rent & Utilities";
  if (d === "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT") return "Taxes";
  if (d === "GENERAL_SERVICES_ACCOUNTING_AND_FINANCIAL_PLANNING" || d === "GENERAL_SERVICES_CONSULTING_AND_LEGAL")
    return "Professional Services";
  if (d === "GENERAL_SERVICES_INSURANCE") return "Licensing & E&O Insurance";
  if (d === "GENERAL_MERCHANDISE_OFFICE_SUPPLIES" || d === "GENERAL_MERCHANDISE_ELECTRONICS" || p === "HOME_IMPROVEMENT")
    return "Office & Equipment";
  return "Other Expense";
}
