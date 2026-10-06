"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { RANGES, type Range } from "@/lib/analytics-shared";

export function RangePicker({ value }: { value: Range }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  return (
    <select
      className="select"
      aria-label="Time range"
      value={value}
      onChange={(e) => {
        const p = new URLSearchParams(params.toString());
        p.set("range", e.target.value);
        router.push(`${path}?${p.toString()}`);
      }}
    >
      {RANGES.map((r) => (
        <option key={r.id} value={r.id}>
          {r.label}
        </option>
      ))}
    </select>
  );
}
