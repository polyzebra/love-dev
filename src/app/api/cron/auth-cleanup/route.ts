import { NextResponse } from "next/server";
import {
  cleanupAbandonedAuthUsers,
  cleanupAbandonedRegistrations,
  cleanupStalePhoneClaims,
} from "@/lib/auth/cleanup";

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
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Missing or invalid cron credential." } },
      { status: 401 },
    );
  }

  const deleted = await cleanupAbandonedAuthUsers();
  const abandonedRegistrations = await cleanupAbandonedRegistrations();
  const phoneClaimsCleared = await cleanupStalePhoneClaims();
  console.info(
    `[cron:auth-cleanup] swept ${deleted} abandoned auth user(s), ` +
      `${abandonedRegistrations} abandoned registration(s), ` +
      `cleared ${phoneClaimsCleared} stale phone claim(s)`,
  );
  return NextResponse.json({ data: { deleted, abandonedRegistrations, phoneClaimsCleared } });
}
