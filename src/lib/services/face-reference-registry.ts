import { createHmac } from "node:crypto";
import { db } from "@/lib/db";
import { getFaceMatchProvider } from "@/lib/services/face-match-providers";
import { faceEnvironment } from "@/lib/services/face-rollout";
import { recordVerificationAudit } from "@/lib/services/face-verification";

/**
 * Provider-reference registry + enrollment saga (H-1 / H-3).
 *
 * Every FaceId ever created is tracked in FaceReferenceRecord until
 * deletion is CONFIRMED - so deletion is complete (all FaceIds, not just
 * the active pointer) and enrollment is a recoverable saga, not an
 * assumed atomic DB+AWS transaction.
 *
 * Idempotency is owned by the DB, not by ListFaces: idempotencyKey is a
 * keyed hash of (environment, userId, referenceVersion), unique. A
 * concurrent or retried enrollment for the same (env,user,version) hits
 * the unique constraint and reuses the existing record - one FaceId per
 * reference version, guaranteed.
 */

/** Keyed, opaque, deterministic per (env, user, version). Not a raw PII
 *  value - a hash under FACE_REFERENCE_KEY_SECRET (falls back to
 *  AUTH_HASH_SALT so it is always keyed, never plaintext). */
export function referenceIdempotencyKey(
  environment: string,
  userId: string,
  referenceVersion: number,
): string {
  const secret =
    process.env.FACE_REFERENCE_KEY_SECRET?.trim() || process.env.AUTH_HASH_SALT || "dev";
  return createHmac("sha256", secret)
    .update(`${environment}:${userId}:${referenceVersion}`)
    .digest("hex")
    .slice(0, 40);
}

export type EnrollResult =
  | { ok: true; referenceId: string; recordId: string; reused: boolean }
  | { ok: false; reason: "link_failed" | "provider_error"; recordId: string | null };

/**
 * Enrollment saga: PENDING_PROVIDER -> (AWS IndexFaces) -> PROVIDER_CREATED
 * (FaceId persisted immediately) -> LINKED. A failure AFTER the FaceId is
 * minted never orphans it: the FaceId is already in the registry, so the
 * reconciler/deletion can always find it; the attempt is marked
 * LINK_FAILED and a compensating deletion is queued.
 */
export async function enrollReferenceSaga(input: {
  userId: string;
  verificationId: string;
  referenceVersion: number;
  livenessSessionId: string;
}): Promise<EnrollResult> {
  const provider = getFaceMatchProvider();
  const environment = faceEnvironment();
  const key = referenceIdempotencyKey(environment, input.userId, input.referenceVersion);
  const externalImageId = key; // deterministic, opaque - the ExternalImageId at AWS

  // Idempotent attempt row. A second concurrent enrollment for the same
  // (env,user,version) loses the unique race and reuses the record.
  let record = await db.faceReferenceRecord.findUnique({ where: { idempotencyKey: key } });
  if (!record) {
    record = await db.faceReferenceRecord
      .create({
        data: {
          userId: input.userId,
          verificationId: input.verificationId,
          referenceVersion: input.referenceVersion,
          provider: provider.name,
          environment,
          idempotencyKey: key,
          externalImageId,
          livenessSessionId: input.livenessSessionId,
          status: "PENDING_PROVIDER",
        },
      })
      .catch(async () => db.faceReferenceRecord.findUnique({ where: { idempotencyKey: key } }));
  }
  if (!record) return { ok: false, reason: "provider_error", recordId: null };

  // Already complete? Idempotent replay returns the existing FaceId.
  if (record.status === "LINKED" && record.externalFaceId) {
    return { ok: true, referenceId: record.externalFaceId, recordId: record.id, reused: true };
  }

  // Mint at the provider only if we do not already hold a FaceId.
  let faceId = record.externalFaceId;
  if (!faceId) {
    if (!provider.createReferenceFromLiveness) {
      return { ok: false, reason: "provider_error", recordId: record.id };
    }
    try {
      const ref = await provider.createReferenceFromLiveness({
        userId: input.userId,
        livenessSessionId: input.livenessSessionId,
        externalImageId,
      });
      faceId = ref.referenceId;
    } catch {
      return { ok: false, reason: "provider_error", recordId: record.id };
    }
    // Persist the FaceId IMMEDIATELY (PROVIDER_CREATED) - before any
    // linking - so a subsequent failure can never orphan it.
    await db.faceReferenceRecord.update({
      where: { id: record.id },
      data: { externalFaceId: faceId, status: "PROVIDER_CREATED" },
    });
  }

  // Link onto the canonical job row.
  try {
    const ttlDays = Number(process.env.FACE_REFERENCE_TTL_DAYS) || 365;
    await db.$transaction([
      db.profilePhotoVerification.update({
        where: { id: input.verificationId },
        data: {
          referenceId: faceId,
          referenceStatus: "ACTIVE",
          provider: provider.name,
          providerModelVersion: provider.modelVersion ?? null,
          providerRegion: provider.region ?? null,
          rotationReason: null,
          expiresAt: new Date(Date.now() + ttlDays * 24 * 3600 * 1000),
        },
      }),
      db.faceReferenceRecord.update({
        where: { id: record.id },
        data: { status: "LINKED", linkedAt: new Date() },
      }),
    ]);
    return { ok: true, referenceId: faceId, recordId: record.id, reused: false };
  } catch {
    // FaceId exists at the provider but linking failed. NEVER re-index -
    // mark LINK_FAILED and queue compensating deletion (the reconciler
    // will delete this FaceId; a retry reuses this record's FaceId).
    await db.faceReferenceRecord.update({
      where: { id: record.id },
      data: { status: "LINK_FAILED" },
    });
    await recordVerificationAudit({
      userId: input.userId,
      verificationId: input.verificationId,
      eventType: "face_reference_link_failed",
      actorType: "system",
      reasonCode: "db_link_failed_after_mint",
    });
    return { ok: false, reason: "link_failed", recordId: record.id };
  }
}

/**
 * Delete EVERY provider FaceId for a user (not just the active pointer) -
 * account deletion, consent withdrawal, rotation, emergency purge.
 * Idempotent, retryable, audited, dead-lettered on repeated failure.
 */
export async function deleteAllUserReferences(
  userId: string,
  reason: string,
): Promise<{ deleted: number; failed: number }> {
  const provider = getFaceMatchProvider();
  const records = await db.faceReferenceRecord.findMany({
    where: {
      userId,
      status: {
        in: ["PROVIDER_CREATED", "LINKED", "LINK_FAILED", "DELETE_PENDING", "DELETE_FAILED"],
      },
      externalFaceId: { not: null },
    },
    select: { id: true, externalFaceId: true, deleteAttempts: true },
  });
  let deleted = 0;
  let failed = 0;
  const maxAttempts = Number(process.env.FACE_DELETE_MAX_ATTEMPTS) || 5;
  for (const rec of records) {
    await db.faceReferenceRecord.update({
      where: { id: rec.id },
      data: { status: "DELETE_PENDING" },
    });
    try {
      await provider.deleteReference(rec.externalFaceId!); // idempotent at AWS
      await db.faceReferenceRecord.update({
        where: { id: rec.id },
        data: { status: "DELETED", deletedAt: new Date() },
      });
      deleted += 1;
    } catch {
      const attempts = rec.deleteAttempts + 1;
      await db.faceReferenceRecord.update({
        where: { id: rec.id },
        data: {
          deleteAttempts: attempts,
          status: attempts >= maxAttempts ? "DELETE_FAILED" : "DELETE_PENDING",
        },
      });
      failed += 1;
    }
  }
  await recordVerificationAudit({
    userId,
    eventType: "face_references_deleted",
    actorType: "system",
    reasonCode: reason,
    metadata: { deleted, failed, total: records.length },
  });
  return { deleted, failed };
}

/**
 * Reconciliation sweep (admin/cron - NOT the hot path): retries stuck
 * deletions and clears orphans (provider created, never linked).
 */
export async function reconcileReferences(limit = 25): Promise<{ retried: number }> {
  const stuck = await db.faceReferenceRecord.findMany({
    where: { status: { in: ["LINK_FAILED", "DELETE_PENDING"] } },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true, userId: true, externalFaceId: true, deleteAttempts: true },
  });
  const provider = getFaceMatchProvider();
  let retried = 0;
  const maxAttempts = Number(process.env.FACE_DELETE_MAX_ATTEMPTS) || 5;
  for (const rec of stuck) {
    if (!rec.externalFaceId) {
      await db.faceReferenceRecord.update({
        where: { id: rec.id },
        data: { status: "DELETED", deletedAt: new Date() },
      });
      retried += 1;
      continue;
    }
    try {
      await provider.deleteReference(rec.externalFaceId);
      await db.faceReferenceRecord.update({
        where: { id: rec.id },
        data: { status: "DELETED", deletedAt: new Date() },
      });
      retried += 1;
    } catch {
      const attempts = rec.deleteAttempts + 1;
      await db.faceReferenceRecord.update({
        where: { id: rec.id },
        data: {
          deleteAttempts: attempts,
          status: attempts >= maxAttempts ? "DELETE_FAILED" : "DELETE_PENDING",
        },
      });
    }
  }
  return { retried };
}
