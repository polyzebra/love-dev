import { db } from "@/lib/db";
import { audit } from "@/lib/audit";

/**
 * Staff resolution of member reports. Routes own the permission checks
 * (requirePermission) - this function owns the mutation + audit trail,
 * so it is directly exercisable by tests.
 */
export async function resolveReport(opts: {
  actorId: string;
  reportId: string;
  outcome: "ACTION_TAKEN" | "DISMISSED";
  resolution?: string;
}): Promise<void> {
  await db.report.update({
    where: { id: opts.reportId },
    data: {
      status: opts.outcome,
      resolvedById: opts.actorId,
      resolvedAt: new Date(),
      resolution: opts.resolution,
    },
  });
  await audit({
    actorId: opts.actorId,
    action: `report.${opts.outcome === "ACTION_TAKEN" ? "action" : "dismiss"}`,
    targetType: "report",
    targetId: opts.reportId,
  });
}
