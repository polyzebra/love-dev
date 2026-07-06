import { apiError, clientIp, created, guardRate, parseBody, requireSession } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { reportSchema } from "@/lib/validators/safety";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";

export async function POST(req: Request) {
  const { user, response } = await requireSession();
  if (response) return response;

  const limited = await guardRate(`report:${user.id}`, RATE_LIMITS.report);
  if (limited) return limited;

  const { data, response: invalid } = await parseBody(req, reportSchema);
  if (invalid) return invalid;

  if (data.reportedId === user.id) {
    return apiError(400, "invalid_target", "You cannot report yourself.");
  }

  const report = await db.report.create({
    data: {
      reporterId: user.id,
      reportedId: data.reportedId,
      messageId: data.messageId,
      reason: data.reason,
      details: data.details,
    },
  });

  await audit({
    actorId: user.id,
    action: "report.create",
    targetType: "user",
    targetId: data.reportedId,
    metadata: { reason: data.reason, reportId: report.id },
    ip: clientIp(req),
  });

  return created({ reportId: report.id, message: "Thanks for letting us know. Our team will review this." });
}
