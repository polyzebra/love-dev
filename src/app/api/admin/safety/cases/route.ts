import { ok, requirePermission } from "@/lib/api";
import { listModerationCases } from "@/lib/services/appeals";
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

/** GET /api/admin/safety/cases?status=OPEN&severity=CRITICAL - staff queue. */
export async function GET(req: Request) {
  const { response } = await requirePermission("safety:read");
  if (response) return response;

  const url = new URL(req.url);
  const status = url.searchParams.get("status")?.toUpperCase();
  const severity = url.searchParams.get("severity")?.toUpperCase();

  const cases = await listModerationCases({
    status: STATUSES.includes(status as ModerationCaseStatus)
      ? (status as ModerationCaseStatus)
      : undefined,
    severity: SEVERITIES.includes(severity as CaseSeverity)
      ? (severity as CaseSeverity)
      : undefined,
  });
  return ok({ cases });
}
