import { NextResponse } from "next/server";
import { sweepQueuedFaceChecks } from "@/lib/services/face-verification";
import { sweepReferenceLifecycle } from "@/lib/services/face-reference";
import { sweepDeadLetterJobs } from "@/lib/services/provider-resilience";
import { reconcileReferences } from "@/lib/services/face-reference-registry";
import { evaluateVerificationAlerts } from "@/lib/services/verification-metrics";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/face-checks - profile-photo verification sweep. Vercel
 * Cron invokes this (vercel.json) with `Authorization: Bearer
 * ${CRON_SECRET}`. Recovery lane for QUEUED jobs whose post-response
 * after() run was lost (deploy, crash, cold start) - the primary path
 * runs the job immediately after the webhook/photo-change response.
 *
 * No-op (0 processed) while FACE_MATCH_PROVIDER is unset - the layer is
 * dormant and this route is safe to keep scheduled.
 *
 * Fails CLOSED like every cron route: missing/wrong bearer -> 401.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization");
  if (!secret || header !== `Bearer ${secret}`) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Missing or invalid cron credential." } },
      { status: 401 },
    );
  }
  try {
    const processed = await sweepQueuedFaceChecks(10);
    // Reference lifecycle: EXPIRING marks, expiry + provider-upgrade
    // rotations (rotations re-enter the queue; next sweep re-enrols).
    const lifecycle = await sweepReferenceLifecycle(25);
    // Dead-letter: repeatedly-failing jobs escalate to humans (never
    // auto-rejected); alert rules fire at most once/day each.
    const deadLettered = await sweepDeadLetterJobs(20);
    const reconciled = await reconcileReferences(25);
    const alerts = await evaluateVerificationAlerts().catch(() => []);
    return NextResponse.json({ data: { processed, lifecycle, deadLettered, reconciled, alerts } });
  } catch (error) {
    // A cron failure is itself an alert event - fire it (error NAME only,
    // never a message/PII), then answer 500 so the scheduler records it.
    const { raiseOpsAlert } = await import("@/lib/services/provider-resilience");
    await raiseOpsAlert(
      "cron_failure",
      `face-checks cron failed: ${error instanceof Error ? error.name : "error"}`,
    ).catch(() => {});
    return NextResponse.json(
      { error: { code: "cron_failed", message: "The verification sweep failed." } },
      { status: 500 },
    );
  }
}
