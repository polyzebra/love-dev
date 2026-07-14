import { NextResponse } from "next/server";
import { sweepQueuedFaceChecks } from "@/lib/services/face-verification";

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
  const processed = await sweepQueuedFaceChecks(10);
  return NextResponse.json({ data: { processed } });
}
