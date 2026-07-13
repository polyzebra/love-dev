import { notFound, ok, parseBody, requirePermission } from "@/lib/api";
import { db } from "@/lib/db";
import { reportResolveSchema } from "@/lib/validators/admin";
import { resolveReport } from "@/lib/services/reports";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/reports/[id]/resolve - close a member report as
 * actioned or dismissed (Phase 0E; previously a server action only).
 * Records the resolving staff member + timestamp and lands in AdminLog.
 */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const { user: actor, response } = await requirePermission("reports:resolve");
  if (response) return response;

  const { data, response: invalid } = await parseBody(req, reportResolveSchema);
  if (invalid) return invalid;

  const report = await db.report.findUnique({ where: { id }, select: { id: true } });
  if (!report) return notFound("Report");

  await resolveReport({
    actorId: actor.id,
    reportId: id,
    outcome: data.outcome,
    resolution: data.resolution,
  });
  return ok({ id, status: data.outcome });
}
