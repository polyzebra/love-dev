/**
 * Profile-photo verification (face layer) tests:
 *   npx tsx tests/face-verification.test.ts
 *
 * Live lane (Prisma + in-process mock face provider; photo bytes come
 * from the injected loader seam - no storage, no network). Covers the
 * required matrix: policy classification, cover mismatch fail-closed,
 * no-face gallery allowance, group photos, mixed identities, stale
 * photo versions, idempotency, provider outage, manual review + admin
 * actions, photo replacement, badge suspension/restoration, account
 * deletion, and the identity->face enqueue seam.
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const RUN = Date.now().toString(36);

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}
const src = (...parts: string[]) => readFileSync(path.join(process.cwd(), "src", ...parts), "utf8");

async function main() {
  process.env.VERIFICATION_PROVIDER = "mock";
  process.env.FACE_MATCH_PROVIDER = "mock";

  const {
    classifyComparison,
    decideProfile,
    enqueueProfilePhotoVerification,
    runProfilePhotoVerification,
    adminFaceAction,
    deleteFaceVerificationData,
    setFaceImageLoader,
    sweepQueuedFaceChecks,
  } = await import("../src/lib/services/face-verification");
  const { mockFaceMatchProvider, getFaceMatchProvider, faceMatchNotConfiguredProvider } =
    await import("../src/lib/services/face-match-providers");
  const { isPubliclyVerified } = await import("../src/lib/services/verification");
  const { db } = await import("../src/lib/db");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ------------------------------------------------------------- pure policy
  console.log("policy - per-photo classification (pure)");

  await check("cover: confident single-face owner match -> PASSED", () => {
    const v = classifyComparison(
      {
        similarity: 0.97,
        ownerDetected: true,
        faceCount: 1,
        dominantFaceRatio: 0.6,
        qualityScore: 0.9,
      },
      0.02,
      { isCover: true },
    );
    assert.equal(v.classification, "OWNER_MATCHED");
    assert.equal(v.decision, "PASSED");
  });

  await check("cover: confident mismatch fails CLOSED", () => {
    const v = classifyComparison(
      {
        similarity: 0.1,
        ownerDetected: false,
        faceCount: 1,
        dominantFaceRatio: 0.6,
        qualityScore: 0.9,
      },
      0.02,
      { isCover: true },
    );
    assert.equal(v.classification, "OTHER_PERSON_ONLY");
    assert.equal(v.decision, "REJECTED");
    assert.equal(v.failureReason, "cover_other_person");
  });

  await check(
    "cover: uncertain (low quality) -> FLAGGED for manual review, never a verdict",
    () => {
      const v = classifyComparison(
        {
          similarity: 0.62,
          ownerDetected: false,
          faceCount: 1,
          dominantFaceRatio: 0.4,
          qualityScore: 0.35,
        },
        0.02,
        { isCover: true },
      );
      assert.equal(v.decision, "FLAGGED");
    },
  );

  await check("cover: no face -> REJECTED (a cover must show the user)", () => {
    const v = classifyComparison(
      {
        similarity: null,
        ownerDetected: false,
        faceCount: 0,
        dominantFaceRatio: null,
        qualityScore: 0.9,
      },
      0.02,
      { isCover: true },
    );
    assert.equal(v.classification, "NO_FACE");
    assert.equal(v.decision, "REJECTED");
  });

  await check("gallery: no face is ALLOWED (lifestyle photos)", () => {
    const v = classifyComparison(
      {
        similarity: null,
        ownerDetected: false,
        faceCount: 0,
        dominantFaceRatio: null,
        qualityScore: 0.9,
      },
      0.02,
      { isCover: false },
    );
    assert.equal(v.decision, "ALLOWED");
  });

  await check("gallery: group photo with owner present is ALLOWED", () => {
    const v = classifyComparison(
      {
        similarity: 0.93,
        ownerDetected: true,
        faceCount: 3,
        dominantFaceRatio: 0.35,
        qualityScore: 0.85,
      },
      0.02,
      { isCover: false },
    );
    assert.equal(v.classification, "GROUP_PHOTO");
    assert.equal(v.decision, "ALLOWED");
  });

  await check("gallery: unrelated person only -> FLAGGED", () => {
    const v = classifyComparison(
      {
        similarity: 0.12,
        ownerDetected: false,
        faceCount: 1,
        dominantFaceRatio: 0.6,
        qualityScore: 0.9,
      },
      0.02,
      { isCover: false },
    );
    assert.equal(v.classification, "OTHER_PERSON_ONLY");
    assert.equal(v.decision, "FLAGGED");
  });

  await check("manipulation risk beats everything", () => {
    const v = classifyComparison(
      {
        similarity: 0.97,
        ownerDetected: true,
        faceCount: 1,
        dominantFaceRatio: 0.6,
        qualityScore: 0.9,
      },
      0.95,
      { isCover: true },
    );
    assert.equal(v.classification, "MANIPULATION_RISK");
    assert.equal(v.decision, "REJECTED");
  });

  console.log("policy - aggregate profile decision (pure)");

  await check("cover pass + benign gallery -> AUTO_VERIFIED", () => {
    const d = decideProfile([
      { decision: "PASSED", classification: "OWNER_MATCHED", isCover: true },
      { decision: "ALLOWED", classification: "NO_FACE", isCover: false },
      { decision: "ALLOWED", classification: "GROUP_PHOTO", isCover: false },
    ]);
    assert.equal(d.status, "AUTO_VERIFIED");
    assert.equal(d.badgeStatus, "ACTIVE");
  });

  await check("mixed identities beyond the cap -> SUSPENDED", () => {
    const other = {
      decision: "FLAGGED",
      classification: "OTHER_PERSON_ONLY",
      isCover: false,
    } as const;
    const d = decideProfile([
      { decision: "PASSED", classification: "OWNER_MATCHED", isCover: true },
      other,
      other,
      other,
    ]);
    assert.equal(d.status, "SUSPENDED");
    assert.equal(d.badgeStatus, "SUSPENDED");
  });

  await check("cover rejected -> profile REJECTED (action required)", () => {
    const d = decideProfile([
      { decision: "REJECTED", classification: "OTHER_PERSON_ONLY", isCover: true },
    ]);
    assert.equal(d.status, "REJECTED");
    assert.equal(d.badgeStatus, "SUSPENDED");
  });

  await check("flagged anything (within cap) -> MANUAL_REVIEW, badge keeps REVIEWING", () => {
    const d = decideProfile([
      { decision: "FLAGGED", classification: "UNCERTAIN", isCover: true },
      { decision: "ALLOWED", classification: "NO_FACE", isCover: false },
    ]);
    assert.equal(d.status, "MANUAL_REVIEW");
    assert.equal(d.badgeStatus, "REVIEWING");
  });

  // --------------------------------------------------------------- live runs
  console.log("end-to-end runs (db + mock provider + injected image loader)");

  const email = `e2e-face-${RUN}@example.com`;
  const created = await admin.auth.admin.createUser({
    email,
    password: `fc-${RUN}-Aa1!`,
    email_confirm: true,
  });
  const uid = created.data.user!.id;
  const now = new Date();
  await db.user.create({
    data: {
      id: uid,
      email,
      name: "E2E Face",
      emailVerified: now,
      phone: `+3538790${RUN.slice(-5)}`,
      phoneVerifiedAt: now,
      ageConfirmedAt: now,
      termsVersion: "2026-07",
      privacyVersion: "2026-07",
      communityVersion: "2026-07",
      onboardingDone: true,
      photoVerifiedAt: now, // identity layer verified (precondition)
    },
  });
  await db.profile.create({
    data: {
      userId: uid,
      displayName: "E2E Face",
      birthDate: new Date("1994-04-04"),
      gender: "WOMAN",
    },
  });

  const mkPhoto = (id: string, position: number, isCover: boolean) =>
    db.photo.create({
      data: {
        id: `fc${RUN}${id}`,
        userId: uid,
        url: `/api/media/fc${RUN}${id}/card`,
        position,
        isCover,
        status: "ACTIVE",
        moderation: "APPROVED",
        storagePath: `users/${uid}/photos/fc${RUN}${id}`,
      },
    });

  // marker-driven bytes per photo (the mock provider reads these)
  const markers = new Map<string, string>();
  setFaceImageLoader(async (storagePath) => {
    const key = storagePath ?? "";
    return Buffer.from(markers.get(key) ?? "face:owner");
  });

  const cover = await mkPhoto("cov", 0, true);
  const lifestyle = await mkPhoto("pet", 1, false);
  const group = await mkPhoto("grp", 2, false);
  markers.set(cover.storagePath!, "face:owner");
  markers.set(lifestyle.storagePath!, "face:none");
  markers.set(group.storagePath!, "face:group");

  const providerCalls: string[] = [];
  const countingProvider = {
    ...mockFaceMatchProvider,
    compareReferenceToPhoto: async (
      ref: string,
      input: { image: Buffer; photoId: string; photoVersion: number },
    ) => {
      providerCalls.push(`${input.photoId}@v${input.photoVersion}`);
      return mockFaceMatchProvider.compareReferenceToPhoto(ref, input);
    },
  };

  try {
    await check("identity-approved enqueue creates the job (QUEUED, badge REVIEWING)", async () => {
      const enqueued = await enqueueProfilePhotoVerification(uid, "identity_verified", {
        identitySessionId: "vs_test",
        consent: true,
      });
      assert.equal(enqueued, true);
      const job = await db.profilePhotoVerification.findUniqueOrThrow({ where: { userId: uid } });
      assert.equal(job.status, "QUEUED");
      assert.equal(job.badgeStatus, "REVIEWING");
      assert.ok(job.consentVersion, "biometric consent version stamped");
      const audit = await db.verificationAuditEvent.findFirst({
        where: { userId: uid, eventType: "face_check_enqueued" },
      });
      assert.ok(audit, "enqueue audited");
    });

    await check(
      "first run: owner cover + no-face + group -> AUTO_VERIFIED, badge ACTIVE",
      async () => {
        const decision = await runProfilePhotoVerification(uid, { provider: countingProvider });
        assert.equal(decision?.status, "AUTO_VERIFIED");
        assert.equal(decision?.badgeStatus, "ACTIVE");
        const user = await db.user.findUniqueOrThrow({ where: { id: uid } });
        assert.equal(isPubliclyVerified(user), true, "public badge live");
        const checks = await db.photoFaceCheck.findMany({ where: { userId: uid } });
        assert.equal(checks.length, 3);
        assert.equal(providerCalls.length, 3, "every ACTIVE photo version analysed exactly once");
      },
    );

    await check(
      "idempotency: re-run reuses stored verdicts (zero new provider calls)",
      async () => {
        const before = providerCalls.length;
        await enqueueProfilePhotoVerification(uid, "rerun");
        const decision = await runProfilePhotoVerification(uid, { provider: countingProvider });
        assert.equal(decision?.status, "AUTO_VERIFIED");
        assert.equal(providerCalls.length, before, "unchanged versions never re-analysed");
        const checks = await db.photoFaceCheck.findMany({ where: { userId: uid } });
        assert.equal(checks.length, 3, "no duplicate check rows");
      },
    );

    await check(
      "stale photo version: mediaVersion bump invalidates ONLY that photo's result",
      async () => {
        const before = providerCalls.length;
        await db.photo.update({
          where: { id: group.id },
          data: { mediaVersion: { increment: 1 } },
        });
        markers.set(group.storagePath!, "face:owner");
        await enqueueProfilePhotoVerification(uid, "photo_replaced");
        const decision = await runProfilePhotoVerification(uid, { provider: countingProvider });
        assert.equal(decision?.status, "AUTO_VERIFIED");
        assert.equal(providerCalls.length, before + 1, "exactly the changed version re-analysed");
        const rows = await db.photoFaceCheck.findMany({ where: { photoId: group.id } });
        assert.equal(rows.length, 2, "old-version row retained for audit, new version added");
      },
    );

    await check(
      "photo replacement: badge stays (REVIEWING) while the new photo is checked",
      async () => {
        await enqueueProfilePhotoVerification(uid, "photo_uploaded");
        const job = await db.profilePhotoVerification.findUniqueOrThrow({ where: { userId: uid } });
        assert.equal(job.badgeStatus, "REVIEWING", "temporarily reviewing, not revoked");
        const user = await db.user.findUniqueOrThrow({ where: { id: uid } });
        assert.equal(isPubliclyVerified(user), true, "public badge NOT dropped during re-check");
        await runProfilePhotoVerification(uid, { provider: countingProvider });
      },
    );

    await check(
      "cover mismatch: confident other person -> REJECTED + badge suspended",
      async () => {
        await db.photo.update({
          where: { id: cover.id },
          data: { mediaVersion: { increment: 1 } },
        });
        markers.set(cover.storagePath!, "face:other");
        await enqueueProfilePhotoVerification(uid, "cover_changed");
        const decision = await runProfilePhotoVerification(uid, { provider: countingProvider });
        assert.equal(decision?.status, "REJECTED");
        const user = await db.user.findUniqueOrThrow({ where: { id: uid } });
        assert.equal(isPubliclyVerified(user), false, "public badge withheld");
        assert.notEqual(
          user.photoVerifiedAt,
          null,
          "identity verification NEVER revoked by the face layer",
        );
      },
    );

    await check(
      "manual review path: uncertain cover -> MANUAL_REVIEW; admin approve -> badge ACTIVE",
      async () => {
        await db.photo.update({
          where: { id: cover.id },
          data: { mediaVersion: { increment: 1 } },
        });
        markers.set(cover.storagePath!, "face:uncertain");
        await enqueueProfilePhotoVerification(uid, "cover_changed");
        const decision = await runProfilePhotoVerification(uid, { provider: countingProvider });
        assert.equal(decision?.status, "MANUAL_REVIEW");
        const job = await db.profilePhotoVerification.findUniqueOrThrow({ where: { userId: uid } });
        const result = await adminFaceAction({
          actorId: uid,
          verificationId: job.id,
          action: "approve",
        });
        assert.equal(result?.badgeStatus, "ACTIVE");
        const user = await db.user.findUniqueOrThrow({ where: { id: uid } });
        assert.equal(isPubliclyVerified(user), true);
        const audit = await db.verificationAuditEvent.findFirst({
          where: { userId: uid, eventType: "face_admin_approve" },
        });
        assert.ok(audit, "admin action audited with actor");
        assert.equal(audit!.actorType, "admin");
      },
    );

    await check("mixed identities in gallery beyond cap -> SUSPENDED", async () => {
      const others = [];
      for (let i = 0; i < 3; i++) {
        const photo = await mkPhoto(`oth${i}`, 3 + i, false);
        markers.set(photo.storagePath!, "face:other");
        others.push(photo);
      }
      await enqueueProfilePhotoVerification(uid, "photo_uploaded");
      const decision = await runProfilePhotoVerification(uid, { provider: countingProvider });
      assert.equal(decision?.status, "SUSPENDED");
      const user = await db.user.findUniqueOrThrow({ where: { id: uid } });
      assert.equal(isPubliclyVerified(user), false);
      // clean up the extra photos for the next checks
      for (const photo of others) await db.photo.delete({ where: { id: photo.id } });
    });

    await check("badge suspension and restoration (admin)", async () => {
      const job = await db.profilePhotoVerification.findUniqueOrThrow({ where: { userId: uid } });
      await adminFaceAction({ actorId: uid, verificationId: job.id, action: "restore_badge" });
      let user = await db.user.findUniqueOrThrow({ where: { id: uid } });
      assert.equal(isPubliclyVerified(user), true, "restored");
      await adminFaceAction({ actorId: uid, verificationId: job.id, action: "suspend_badge" });
      user = await db.user.findUniqueOrThrow({ where: { id: uid } });
      assert.equal(isPubliclyVerified(user), false, "suspended");
      await adminFaceAction({ actorId: uid, verificationId: job.id, action: "restore_badge" });
      user = await db.user.findUniqueOrThrow({ where: { id: uid } });
      assert.equal(isPubliclyVerified(user), true);
    });

    await check(
      "provider outage: run fails SAFE - job back to QUEUED, nothing granted",
      async () => {
        await db.photo.update({
          where: { id: cover.id },
          data: { mediaVersion: { increment: 1 } },
        });
        await enqueueProfilePhotoVerification(uid, "cover_changed");
        const brokenProvider = {
          ...mockFaceMatchProvider,
          compareReferenceToPhoto: async () => {
            throw new Error("vendor timeout");
          },
        };
        const decision = await runProfilePhotoVerification(uid, { provider: brokenProvider });
        assert.equal(decision, null);
        const job = await db.profilePhotoVerification.findUniqueOrThrow({ where: { userId: uid } });
        assert.equal(job.status, "QUEUED", "parked for the cron sweep");
        const audit = await db.verificationAuditEvent.findFirst({
          where: { userId: uid, eventType: "face_check_error" },
          orderBy: { createdAt: "desc" },
        });
        assert.equal(audit?.reasonCode, "provider_error");
      },
    );

    await check("cron sweep picks up the parked job", async () => {
      markers.set(cover.storagePath!, "face:owner");
      const processed = await sweepQueuedFaceChecks(5);
      assert.ok(processed >= 1, "sweep processed the queued job");
      const job = await db.profilePhotoVerification.findUniqueOrThrow({ where: { userId: uid } });
      assert.equal(job.status, "AUTO_VERIFIED");
    });

    await check("unconfigured layer is fully dormant (provider gate)", async () => {
      const saved = process.env.FACE_MATCH_PROVIDER;
      delete process.env.FACE_MATCH_PROVIDER;
      assert.equal(getFaceMatchProvider(), faceMatchNotConfiguredProvider);
      const enqueued = await enqueueProfilePhotoVerification(uid, "noop");
      assert.equal(enqueued, false, "enqueue refuses while dormant");
      process.env.FACE_MATCH_PROVIDER = saved;
    });

    await check("account deletion destroys the job + provider reference", async () => {
      await deleteFaceVerificationData(uid);
      const job = await db.profilePhotoVerification.findUnique({ where: { userId: uid } });
      assert.equal(job, null);
      const audit = await db.verificationAuditEvent.findFirst({
        where: { userId: uid, eventType: "face_data_deleted" },
      });
      assert.ok(audit, "deletion audited");
    });

    console.log("integration seams (source pins)");

    await check("webhook + poll paths enqueue the face job after identity approval", () => {
      const route = src("app", "api", "webhooks", "verification", "route.ts");
      assert.ok(route.includes("enqueueProfilePhotoVerification"), "webhook enqueues");
      assert.ok(
        route.includes("after(() => runProfilePhotoVerification"),
        "webhook runs post-response",
      );
      const service = src("lib", "services", "photo-verification.ts");
      assert.ok(service.includes("enqueueProfilePhotoVerification"), "poll path enqueues");
    });

    await check("photo mutations re-check; teardown deletes face data", () => {
      for (const file of [
        ["app", "api", "photos", "route.ts"],
        ["app", "api", "photos", "[id]", "route.ts"],
        ["app", "api", "photos", "reorder", "route.ts"],
      ] as const) {
        assert.ok(src(...file).includes("onProfilePhotosChanged"), file.join("/"));
      }
      assert.ok(
        src("lib", "auth", "identity.ts").includes("deleteFaceVerificationData"),
        "teardown hook",
      );
    });

    await check("no biometric vectors anywhere near User/Photo records", () => {
      const schema = readFileSync(path.join(process.cwd(), "prisma", "schema.prisma"), "utf8")
        .split("\n")
        .map((line) => line.replace(/\/\/.*$/, ""))
        .join("\n");
      assert.ok(!/embedding|template|descriptor/i.test(schema), "schema stores no vectors");
      const service = src("lib", "services", "face-verification.ts");
      assert.ok(!service.includes("console.log"), "no raw values logged from the service");
    });
  } finally {
    setFaceImageLoader(null);
    await db.user.delete({ where: { id: uid } }).catch(() => {});
    await admin.auth.admin.deleteUser(uid).catch(() => {});
    await db.$disconnect();
  }

  console.log(`\n${passed} checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
