import { ok, requirePermission } from "@/lib/api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/face-checks - profile-photo verification review queue.
 * Staff see classifications, confidence BANDS and reason codes - never
 * raw biometric values, and never identity documents (those stay at
 * Stripe behind its own restricted-access dashboard).
 */
export async function GET() {
  const { response } = await requirePermission("verifications:review");
  if (response) return response;

  const queue = await db.profilePhotoVerification.findMany({
    where: { status: { in: ["MANUAL_REVIEW", "REJECTED", "SUSPENDED"] } },
    orderBy: { updatedAt: "asc" },
    take: 50,
    select: {
      id: true,
      status: true,
      badgeStatus: true,
      riskLevel: true,
      lastRunAt: true,
      updatedAt: true,
      // Lifecycle + duplicate classification - normalized values only
      // (the provider referenceId is a vendor identifier and stays out).
      referenceStatus: true,
      referenceVersion: true,
      providerModelVersion: true,
      rotationReason: true,
      duplicateClass: true,
      user: {
        select: {
          id: true,
          email: true,
          photoVerifiedAt: true,
          profile: { select: { displayName: true } },
        },
      },
      checks: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          photoId: true,
          photoVersion: true,
          isCoverAtCheck: true,
          classification: true,
          decision: true,
          confidenceBand: true,
          failureReason: true,
          reviewedById: true,
          reviewedAt: true,
          createdAt: true,
          photo: { select: { url: true, thumbUrl: true, status: true, mediaVersion: true } },
        },
      },
    },
  });
  return ok({ queue });
}
