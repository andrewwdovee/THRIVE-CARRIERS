export type Unit = "count" | "usd" | "pct" | "ratio";

export interface InputMetric {
  key: string;
  label: string;
  unit: Unit;
  help?: string;
  /** If not entered by hand, fall back to this bank category's monthly total. */
  bankCategory?: string;
}

export interface MetricMonth {
  month: string;
  values: Record<string, number | null>;
  /** Which values came from bank data rather than manual entry. */
  fromBank: Record<string, boolean>;
  derived: Record<string, number | null>;
}

