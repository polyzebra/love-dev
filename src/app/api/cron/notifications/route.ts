import { NextResponse } from "next/server";
import {
  processPendingEmail,
  processPendingPush,
  prunePresence,
  revokeStaleSubscriptions,
} from "@/lib/services/notify";
import { expireStaleNeedsInfo } from "@/lib/services/appeals";
import { escalateOverdueCases } from "@/lib/services/trust-safety";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/notifications - outbox sweep. Vercel Cron invokes this
 * (vercel.json) with `Authorization: Bearer ${CRON_SECRET}`:
 *  - drains due PENDING push deliveries (this is what executes the
 *    exponential-backoff retries scheduled via nextAttemptAt)
 *  - revokes subscriptions that have been silent for 90 days
 *  - prunes stale ConversationPresence heartbeats
 *
 * Fails CLOSED, same as /api/cron/auth-cleanup: no CRON_SECRET configured
 * or wrong bearer -> identical 401 either way.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization");
  if (!secret || header !== `Bearer ${secret}`) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }

  const push = await processPendingPush(200);
  const email = await processPendingEmail(200);
  const revoked = await revokeStaleSubscriptions();
  const presencePruned = await prunePresence();
  // Trust & safety sweeps ride the same 5-minute cron: SLA escalation for
  // overdue unassigned cases + auto-expiry of stale NEEDS_INFO appeals.
  const escalation = await escalateOverdueCases();
  const appealsExpired = await expireStaleNeedsInfo();

  console.info(
    `[cron:notifications] push claimed=${push.claimed} sent=${push.sent} ` +
      `retrying=${push.retrying} dead=${push.dead}; ` +
      `email claimed=${email.claimed} sent=${email.sent} ` +
      `retrying=${email.retrying} dead=${email.dead}; ` +
      `revoked ${revoked} stale subscription(s), pruned ${presencePruned} presence row(s); ` +
      `escalated ${escalation.escalated} overdue case(s), expired ${appealsExpired} stale appeal(s)`,
  );
  return NextResponse.json({
    data: { push, email, revoked, presencePruned, escalation, appealsExpired },
  });
}
