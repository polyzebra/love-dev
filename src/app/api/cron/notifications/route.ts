import { NextResponse } from "next/server";
import {
  processPendingPush,
  prunePresence,
  revokeStaleSubscriptions,
} from "@/lib/services/notify";

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
  const revoked = await revokeStaleSubscriptions();
  const presencePruned = await prunePresence();

  console.info(
    `[cron:notifications] push claimed=${push.claimed} sent=${push.sent} ` +
      `retrying=${push.retrying} dead=${push.dead}; ` +
      `revoked ${revoked} stale subscription(s), pruned ${presencePruned} presence row(s)`,
  );
  return NextResponse.json({ data: { push, revoked, presencePruned } });
}
