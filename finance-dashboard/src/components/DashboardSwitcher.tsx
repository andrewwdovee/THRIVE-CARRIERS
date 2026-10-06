import Link from "next/link";
import type { Range } from "@/lib/analytics";

const ITEMS = [
  { id: null, href: "/", label: "Overview", color: null },
  { id: "thrive", href: "/thrive", label: "Thrive Companies", color: "var(--entity-thrive)" },
  { id: "leadtech", href: "/leadtech", label: "Lead Tech", color: "var(--entity-leadtech)" },
];

/** Segmented control for swapping between the three dashboards; keeps the selected range. */
export function DashboardSwitcher({ active, range }: { active: string | null; range: Range }) {
  return (
    <nav className="switcher" aria-label="Switch dashboard">
      {ITEMS.map((i) => (
        <Link key={i.href} href={`${i.href}?range=${range}`} aria-current={i.id === active ? "page" : undefined}>
          {i.color && <span className="dot" style={{ background: i.color }} />}
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
