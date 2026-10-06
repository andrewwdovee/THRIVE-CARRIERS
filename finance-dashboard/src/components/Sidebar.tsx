"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const DASHBOARDS = [
  { href: "/", label: "Overview", color: null },
  { href: "/thrive", label: "Thrive Companies", color: "var(--entity-thrive)" },
  { href: "/leadtech", label: "Lead Tech", color: "var(--entity-leadtech)" },
];
const TOOLS = [
  { href: "/transactions", label: "Transactions" },
  { href: "/investments", label: "Investments" },
  { href: "/kpis", label: "Business KPIs" },
  { href: "/settings", label: "Banks & Settings" },
];

export function Sidebar() {
  const path = usePathname();
  const current = (href: string) => (href === "/" ? path === "/" : path.startsWith(href)) ? "page" : undefined;

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark" aria-hidden>T</span>
        Thrive Finance
      </div>
      <div className="nav-label">Dashboards</div>
      <nav className="nav" aria-label="Dashboards">
        {DASHBOARDS.map((d) => (
          <Link key={d.href} href={d.href} aria-current={current(d.href)}>
            {d.color ? <span className="dot" style={{ background: d.color }} /> : <span className="dot" style={{ background: "#fff" }} />}
            {d.label}
          </Link>
        ))}
      </nav>
      <div className="nav-label">Tools</div>
      <nav className="nav" aria-label="Tools">
        {TOOLS.map((d) => (
          <Link key={d.href} href={d.href} aria-current={current(d.href)}>
            {d.label}
          </Link>
        ))}
      </nav>
      <div className="sidebar-foot">
        <button onClick={logout}>Sign out</button>
      </div>
    </aside>
  );
}
