import { apiError, clientIp, created, guardRate, parseBody, requireActiveAccount } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { reportSchema } from "@/lib/validators/safety";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import type { ModerationCaseType, ReportReason } from "@/generated/prisma/enums";
import { openModerationCase } from "@/lib/services/trust-safety";
import { recomputeTrustForEvent } from "@/lib/services/trust-engine";

/** Report reason -> moderation case type (spec taxonomy). */
const REPORT_CASE_TYPE: Partial<Record<ReportReason, ModerationCaseType>> = {
  FAKE_PROFILE: "IMPERSONATION",
  INAPPROPRIATE_CONTENT: "EXPLICIT_CONTENT",
  HARASSMENT: "HARASSMENT",
  SPAM: "SPAM",
  SCAM: "SCAM",
  UNDERAGE: "MINOR_SAFETY",
};

export async function POST(req: Request) {
  const { user, response } = await requireActiveAccount();
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

  // Trust & safety: escalate to a moderation case once the reported user
  // has OPEN reports from 3+ DISTINCT reporters (deduped per user+type in
  // openModerationCase), and refresh the composite risk profile.
  try {
    const reporters = await db.report.findMany({
      where: { reportedId: data.reportedId, status: "OPEN" },
      select: { reporterId: true },
      distinct: ["reporterId"],
    });
    if (reporters.length >= 3) {
      await openModerationCase({
        userId: data.reportedId,
        caseType: REPORT_CASE_TYPE[data.reason] ?? "OTHER",
        severity: data.reason === "UNDERAGE" ? "CRITICAL" : "MEDIUM",
        source: "USER_REPORT",
        summary: `${reporters.length} distinct members reported this account (latest: ${data.reason.toLowerCase()}).`,
        evidence: { reportId: report.id, reason: data.reason, distinctReporters: reporters.length },
        reportId: report.id,
      });
    }
  } catch (error) {
    console.warn("[reports] case escalation failed:", error);
  }
  await recomputeTrustForEvent(data.reportedId, "report_created");

  return created({
    reportId: report.id,
    message: "Thanks for letting us know. Our team will review this.",
  });
}
