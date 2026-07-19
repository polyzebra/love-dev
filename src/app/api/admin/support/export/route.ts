import { requirePermission } from "@/lib/api";
import { audit } from "@/lib/audit";
import { listSupportRequests } from "@/lib/services/support";

const EXPORT_CAP = 5000;

/** Neutralise CSV-injection: a field starting with = + - @ is prefixed with '. */
function csvCell(value: unknown): string {
  const s = value == null ? "" : String(value);
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** GET /api/admin/support/export - CSV of support requests (staff-only). */
export async function GET(req: Request) {
  const { user, response } = await requirePermission("support:read");
  if (response) return response;

  const url = new URL(req.url);
  const includeSpam = url.searchParams.get("includeSpam") === "1";
  const { rows } = await listSupportRequests({ status: "all", includeSpam, pageSize: EXPORT_CAP });

  const header = [
    "id",
    "createdAt",
    "status",
    "priority",
    "category",
    "name",
    "email",
    "accountEmail",
    "reference",
    "assignedAdmin",
    "spam",
    "emailDelivered",
  ];
  const lines = [header.map(csvCell).join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        r.createdAt.toISOString(),
        r.status,
        r.priority,
        r.category,
        r.name,
        r.email,
        r.accountEmail ?? "",
        r.reference ?? "",
        r.assignedAdmin ?? "",
        r.spam,
        r.emailDelivered,
      ]
        .map(csvCell)
        .join(","),
    );
  }

  await audit({ actorId: user.id, action: "support.export", metadata: { count: rows.length } });

  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="support-requests.csv"`,
    },
  });
}
