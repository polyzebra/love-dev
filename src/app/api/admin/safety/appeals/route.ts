import { ok, requirePermission } from "@/lib/api";
import { listAppeals } from "@/lib/services/appeals";
import type { AppealStatus } from "@/generated/prisma/enums";

const STATUSES: AppealStatus[] = [
  "SUBMITTED",
  "PENDING_REVIEW",
  "UNDER_REVIEW",
  "NEEDS_INFO",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
  "WITHDRAWN",
];

/** GET /api/admin/safety/appeals?status=SUBMITTED - staff appeal queue. */
export async function GET(req: Request) {
  const { response } = await requirePermission("safety:read");
  if (response) return response;

  const url = new URL(req.url);
  const status = url.searchParams.get("status")?.toUpperCase();

  const appeals = await listAppeals({
    status: STATUSES.includes(status as AppealStatus) ? (status as AppealStatus) : undefined,
  });
  return ok({ appeals });
}
