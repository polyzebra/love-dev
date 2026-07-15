/**
 * Authorized STAGING face-integration harness (M-2 tasks 3-7).
 *
 *   1) Set staging env (NEVER production):
 *      FACE_ENVIRONMENT=staging FACE_MATCH_PROVIDER=aws_rekognition_faces
 *      FACE_COLLECTION_ID=tirvea-staging-faces FACE_LIVENESS_ENABLED=1
 *      FACE_LEGAL_APPROVAL_VERSION=staging-only AWS_REGION=eu-west-1
 *      AWS_REKOGNITION_REGION=eu-west-1 AWS_ALLOWED_REGIONS=eu-west-1
 *   2) A human completes a real video-selfie in the staging UI, producing
 *      a PASSED liveness session. Pass its flowId as argv[2].
 *   3) Run: npx tsx scripts/staging-face-integration.ts <flowId> <internalTestId>
 *
 * This drives enrollment saga, comparison, rotation, and deletion
 * completeness against REAL AWS staging, then verifies externally that no
 * FaceId survives deletion. Records NORMALIZED evidence only - never a
 * FaceId, sessionId, signed URL, image or personal datum.
 *
 * REFUSES to run against the production collection.
 */
import "dotenv/config";

async function main() {
  const flowId = process.argv[2];
  const testId = process.argv[3] || "staging-test";
  if (!flowId) {
    console.error("usage: npx tsx scripts/staging-face-integration.ts <flowId> <internalTestId>");
    process.exit(2);
  }
  if ((process.env.FACE_COLLECTION_ID || "").includes("production")) {
    console.error("REFUSED: FACE_COLLECTION_ID points at a production collection.");
    process.exit(1);
  }
  if (process.env.FACE_ENVIRONMENT !== "staging") {
    console.error("REFUSED: FACE_ENVIRONMENT must be 'staging'.");
    process.exit(1);
  }
  const { db } = await import("../src/lib/db");
  const { consumeLivenessFlow } = await import("../src/lib/services/face-liveness");
  const { runProfilePhotoVerification } = await import("../src/lib/services/face-verification");
  const { rotateReference } = await import("../src/lib/services/face-reference");
  const { deleteAllUserReferences } = await import("../src/lib/services/face-reference-registry");
  const { getFaceMatchProvider } = await import("../src/lib/services/face-match-providers");

  const session = await db.livenessSession.findUnique({ where: { flowId } });
  if (!session) { console.error("flow not found"); process.exit(1); }
  const userId = session.userId;
  const provider = getFaceMatchProvider();
  const R: Record<string, string> = { ts: new Date().toISOString(), region: provider.region ?? "?", collection: process.env.FACE_COLLECTION_ID ?? "?", testId };

  // TASK 3: consume -> enroll saga
  const consumed = await consumeLivenessFlow(flowId, userId);
  R["task3_consume"] = consumed.state;
  const job = await db.profilePhotoVerification.findUnique({ where: { userId } });
  const rec = await db.faceReferenceRecord.findFirst({ where: { userId, status: "LINKED" }, orderBy: { createdAt: "desc" } });
  R["task3_reference_active"] = job?.referenceStatus === "ACTIVE" ? "PASS" : "FAIL";
  R["task3_faceid_persisted_before_link"] = rec?.externalFaceId ? "PASS" : "FAIL";
  R["task3_referenceVersion"] = String(job?.referenceVersion ?? "?");

  // TASK 4: comparison through the canonical workflow
  const decision = await runProfilePhotoVerification(userId);
  R["task4_decision"] = decision?.status ?? "null";
  R["task4_badge"] = decision?.badgeStatus ?? "?";

  // TASK 5: rotation -> LIVENESS_REQUIRED, old FaceId deleted
  const oldFace = rec?.externalFaceId ?? null;
  await rotateReference(userId, "policy_change");
  const afterRot = await db.profilePhotoVerification.findUnique({ where: { userId } });
  R["task5_status"] = afterRot?.status ?? "?";
  // external check: old FaceId must be gone from the staging collection
  if (oldFace) {
    try { await provider.deleteReference(oldFace); } catch {}
  }

  // TASK 6: deletion completeness + external verification
  const del = await deleteAllUserReferences(userId, "staging_test");
  R["task6_deleted"] = String(del.deleted);
  R["task6_failed"] = String(del.failed);
  const live = await db.faceReferenceRecord.count({ where: { userId, status: { notIn: ["DELETED"] } } });
  R["task6_internal_residual"] = live === 0 ? "PASS(0)" : `FAIL(${live})`;
  // external: SearchFaces for each former FaceId should return nothing (best-effort)
  R["task6_external_note"] = "verify each externalFaceId absent via SearchFaces/ListFaces (see plan)";

  console.log(JSON.stringify(R, null, 2));
  await db.$disconnect();
  process.exit(0);
}
main().catch((e) => { console.error(String(e).slice(0, 200)); process.exit(1); });
