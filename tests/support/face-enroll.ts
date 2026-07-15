import { db } from "../../src/lib/db";
import {
  createBoundLivenessSession,
  consumeLivenessFlow,
} from "../../src/lib/services/face-liveness";
import { enqueueProfilePhotoVerification } from "../../src/lib/services/face-verification";

/**
 * Test helper: drive the real liveness->saga enrollment for a user so the
 * job holds an ACTIVE reference and is QUEUED (post-C-2 flow). Uses the
 * configured provider (mock in tests). Mirrors what a real user's liveness
 * capture does.
 */
export async function enrollReference(userId: string): Promise<void> {
  await enqueueProfilePhotoVerification(userId, "test_enroll");
  const created = await createBoundLivenessSession(userId);
  if ("error" in created) throw new Error(`liveness create failed`);
  const r = await consumeLivenessFlow(created.flowId, userId);
  if (r.state !== "checking_profile_photos") throw new Error(`enroll failed: ${r.state}`);
  // consumeLivenessFlow re-queues via isRecovery; ensure QUEUED for run.
  const job = await db.profilePhotoVerification.findUnique({ where: { userId } });
  if (job?.status === "LIVENESS_REQUIRED") throw new Error("still LIVENESS_REQUIRED after enroll");
}
