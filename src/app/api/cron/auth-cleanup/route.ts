import { NextResponse } from "next/server";
import { cleanupAbandonedAuthUsers } from "@/lib/auth/cleanup";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/auth-cleanup - scheduled sweep of abandoned (ghost)
 * auth.users rows (see src/lib/auth/cleanup.ts). Invoked by Vercel Cron
 * (vercel.json), which sends `Authorization: Bearer ${CRON_SECRET}`.
 *
 * Fails CLOSED: without CRON_SECRET configured, or without the matching
 * bearer token, nothing runs. The response never reveals whether the
 * secret exists - both misses are the same 401.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization");
  if (!secret || header !== `Bearer ${secret}`) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }

  const deleted = await cleanupAbandonedAuthUsers();
  console.info(`[cron:auth-cleanup] swept ${deleted} abandoned auth user(s)`);
  return NextResponse.json({ data: { deleted } });
}
