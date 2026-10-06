import { notFound } from "next/navigation";
import { DashboardView } from "@/components/DashboardView";
import { parseRange } from "@/lib/analytics";
import { isEntityId } from "@/lib/entities";

export default async function EntityPage({
  params,
  searchParams,
}: {
  params: Promise<{ entity: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { entity } = await params;
  if (!isEntityId(entity)) notFound();
  const sp = await searchParams;
  return <DashboardView entity={entity} range={parseRange(sp.range)} />;
}
