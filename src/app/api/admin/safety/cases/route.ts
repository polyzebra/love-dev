import { ok, requirePermission } from "@/lib/api";
import { countModerationCases, listModerationCases } from "@/lib/services/appeals";
import type { CaseSeverity, ModerationCaseStatus } from "@/generated/prisma/enums";

const STATUSES: ModerationCaseStatus[] = [
  "OPEN",
  "UNDER_REVIEW",
  "ACTION_TAKEN",
  "DISMISSED",
  "APPEALED",
  "REVERSED",
];
const SEVERITIES: CaseSeverity[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

/**
 * GET /api/admin/safety/cases - staff queue. Filters:
 *   status, severity, priority, assignedTo (staff id | "unassigned" |
 *   "me"), overdue=true, q (case id / user id / user email contains).
 * Returns { cases, total } - total is the honest match count; cases is
 * take-limited (most urgent first).
 */
export async function GET(req: Request) {
  const { user, response } = await requirePermission("safety:read");
  if (response) return response;

  const url = new URL(req.url);
  const status = url.searchParams.get("status")?.toUpperCase();
  const severity = url.searchParams.get("severity")?.toUpperCase();
  const priority = url.searchParams.get("priority")?.toUpperCase();
  const assignedTo = url.searchParams.get("assignedTo");
  const q = url.searchParams.get("q")?.trim();

  const filter = {
    status: STATUSES.includes(status as ModerationCaseStatus)
      ? (status as ModerationCaseStatus)
      : undefined,
    severity: SEVERITIES.includes(severity as CaseSeverity)
      ? (severity as CaseSeverity)
      : undefined,
    priority: SEVERITIES.includes(priority as CaseSeverity)
      ? (priority as CaseSeverity)
      : undefined,
    assignedToId:
      assignedTo === "me" ? user.id : assignedTo && assignedTo.length > 0 ? assignedTo : undefined,
    overdueOnly: url.searchParams.get("overdue") === "true",
    search: q && q.length > 0 ? q : undefined,
  };

  const [cases, total] = await Promise.all([
    listModerationCases(filter),
    countModerationCases(filter),
  ]);
  return ok({ cases, total });
}
