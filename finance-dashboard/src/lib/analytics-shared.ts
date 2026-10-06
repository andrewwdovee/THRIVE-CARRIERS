// Pure helpers safe to import from client components.
export type Range = "3m" | "6m" | "12m" | "ytd";
export const RANGES: { id: Range; label: string }[] = [
  { id: "3m", label: "3 months" },
  { id: "6m", label: "6 months" },
  { id: "12m", label: "12 months" },
  { id: "ytd", label: "Year to date" },
];

export function parseRange(v: string | string[] | undefined): Range {
  return RANGES.some((r) => r.id === v) ? (v as Range) : "6m";
}

function ym(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Months in the range, oldest first, including the current month. */
export function monthsFor(range: Range, now = new Date()): string[] {
  const count = range === "ytd" ? now.getMonth() + 1 : Number(range.replace("m", ""));
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) out.push(ym(new Date(now.getFullYear(), now.getMonth() - i, 1)));
  return out;
}

export function monthLabel(m: string, withYear = false) {
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, mo - 1, 1).toLocaleString("en-US", withYear ? { month: "short", year: "numeric" } : { month: "short" });
}

