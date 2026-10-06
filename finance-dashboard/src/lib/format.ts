export function usd(n: number | null | undefined, opts: { cents?: boolean; compact?: boolean; sign?: boolean } = {}) {
  if (n == null || Number.isNaN(n)) return "—";
  const s = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: opts.compact ? "compact" : "standard",
    minimumFractionDigits: opts.cents ? 2 : 0,
    maximumFractionDigits: opts.compact ? 1 : opts.cents ? 2 : 0,
  }).format(n);
  return opts.sign && n > 0 ? `+${s}` : s;
}

export function num(n: number | null | undefined, digits = 0) {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
}

export function pct(n: number | null | undefined, digits = 1) {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

export function formatUnit(n: number | null | undefined, unit: "count" | "usd" | "pct" | "ratio") {
  if (unit === "usd") return usd(n);
  if (unit === "pct") return pct(n);
  if (unit === "ratio") return n == null ? "—" : `${n.toFixed(2)}×`;
  return num(n);
}

export function shortDate(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function relativeTime(sqliteUtc: string | null) {
  if (!sqliteUtc) return "never";
  const t = new Date(sqliteUtc.replace(" ", "T") + "Z").getTime();
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} hr ago`;
  return `${Math.round(h / 24)} days ago`;
}
