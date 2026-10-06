import { DashboardView } from "@/components/DashboardView";
import { parseRange } from "@/lib/analytics";

export default async function OverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return <DashboardView entity={null} range={parseRange(sp.range)} />;
}
