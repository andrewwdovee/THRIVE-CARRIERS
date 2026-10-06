import { transactions } from "@/lib/analytics";
import { getEntity, isEntityId } from "@/lib/entities";

const esc = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(req: Request) {
  const u = new URL(req.url);
  const entity = u.searchParams.get("entity");
  const month = u.searchParams.get("month");
  const { rows } = transactions({
    entity: entity && isEntityId(entity) ? entity : null,
    month: month || null,
    limit: 1_000_000,
  });
  const lines = [
    ["Date", "Company", "Account", "Description", "Merchant", "Category", "Amount", "Pending", "Note"].join(","),
    ...rows.map((r) =>
      [r.date, getEntity(r.entity_id)?.name, `${r.account_name} ${r.account_mask ?? ""}`.trim(), r.name, r.merchant_name, r.category_name, r.amount.toFixed(2), r.pending ? "yes" : "", r.note]
        .map(esc)
        .join(","),
    ),
  ];
  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="transactions${month ? "-" + month : ""}.csv"`,
    },
  });
}
