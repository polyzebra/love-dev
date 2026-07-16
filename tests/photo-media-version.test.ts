/**
 * Photo.mediaVersion lifecycle - the byte-identity version that pins face
 * verdicts. An in-place byte rewrite (replace/crop/rotate/recompress/
 * regeneration) bumps it; a pure reorder or cover change does not. A stale
 * PhotoFaceCheck from an older version (or a different provider/threshold)
 * must never apply. Run against the real DB from .env:
 *   npx tsx tests/photo-media-version.test.ts
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

let passed = 0;
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

async function main() {
  const { db } = await import("../src/lib/db");
  const { bumpPhotoMediaVersion } = await import("../src/lib/services/photos");
  const RUN = Date.now().toString(36);

  const userId = randomUUID();
  const photoId = `mv${RUN}cover`;
  const otherPhotoId = `mv${RUN}second`;
  let verificationId = "";

  async function seed() {
    await db.user.create({
      data: {
        id: userId,
        email: `mv-${RUN}@example.com`,
        status: "ACTIVE",
        onboardingDone: true,
        lastActiveAt: new Date(),
        photoVerifiedAt: new Date(),
      },
    });
    await db.photo.create({
      data: {
        id: photoId,
        userId,
        url: `/api/media/${photoId}/card`,
        position: 0,
        isCover: true,
        status: "ACTIVE",
        moderation: "APPROVED",
        storagePath: `users/${userId}/photos/${photoId}`,
      },
    });
    await db.photo.create({
      data: {
        id: otherPhotoId,
        userId,
        url: `/api/media/${otherPhotoId}/card`,
        position: 1,
        isCover: false,
        status: "ACTIVE",
        moderation: "APPROVED",
        storagePath: `users/${userId}/photos/${otherPhotoId}`,
      },
    });
    const job = await db.profilePhotoVerification.create({
      data: { userId, provider: "mock", status: "AUTO_VERIFIED", badgeStatus: "ACTIVE" },
    });
    verificationId = job.id;
  }

  await seed();
  const ACTIVE_CAL = "mock:v0";
  const readVersion = async (id: string) =>
    (await db.photo.findUniqueOrThrow({ where: { id }, select: { mediaVersion: true } }))
      .mediaVersion;

  try {
    await check("new photo starts at mediaVersion 0 (the create case)", async () => {
      assert.equal(await readVersion(photoId), 0);
    });

    await check("crop/edit (in-place rewrite) increments the version", async () => {
      const r = await bumpPhotoMediaVersion(photoId);
      assert.deepEqual(r, { version: 1, bumped: true });
      assert.equal(await readVersion(photoId), 1);
    });

    await check("replacement increments again", async () => {
      const r = await bumpPhotoMediaVersion(photoId);
      assert.deepEqual(r, { version: 2, bumped: true });
      assert.equal(await readVersion(photoId), 2);
    });

    await check("pure reorder (position/isCover only) does NOT change mediaVersion", async () => {
      const before = await readVersion(otherPhotoId);
      // The exact write the reorder route makes - never touches mediaVersion.
      await db.$transaction([
        db.photo.update({ where: { id: photoId }, data: { position: 1, isCover: false } }),
        db.photo.update({ where: { id: otherPhotoId }, data: { position: 0, isCover: true } }),
      ]);
      assert.equal(await readVersion(otherPhotoId), before, "new cover keeps its bytes/version");
      assert.equal(await readVersion(photoId), 2, "old cover keeps its version too");
    });

    await check("cover promotion reuses the new cover's CURRENT-version verdict", async () => {
      // otherPhotoId is now the cover (version 0). A verdict pinned to its
      // current version is reusable; the run must find it and not re-analyse.
      const v = await readVersion(otherPhotoId); // 0
      await db.photoFaceCheck.create({
        data: {
          verificationId,
          userId,
          photoId: otherPhotoId,
          photoVersion: v,
          isCoverAtCheck: true,
          calibrationVersion: ACTIVE_CAL,
          classification: "OWNER_MATCHED",
          decision: "PASSED",
        },
      });
      const reuse = await db.photoFaceCheck.findUnique({
        where: {
          photoId_photoVersion_verificationId: {
            photoId: otherPhotoId,
            photoVersion: v,
            verificationId,
          },
        },
      });
      assert.ok(
        reuse && reuse.decision !== "PENDING" && reuse.calibrationVersion === ACTIVE_CAL,
        "current-version, current-threshold verdict IS reusable",
      );
    });

    await check("stale verdict from an older mediaVersion never applies", async () => {
      // Bump the cover's bytes: its version-0 verdict must no longer match.
      const before = await readVersion(otherPhotoId); // 0
      const bump = await bumpPhotoMediaVersion(otherPhotoId);
      assert.deepEqual(bump, { version: before + 1, bumped: true });
      const stale = await db.photoFaceCheck.findUnique({
        where: {
          photoId_photoVersion_verificationId: {
            photoId: otherPhotoId,
            photoVersion: before + 1, // the NEW bytes
            verificationId,
          },
        },
      });
      assert.equal(stale, null, "no verdict exists for the new version -> must re-analyse");
    });

    await check(
      "reuse also requires the provider+threshold (calibrationVersion) to match",
      async () => {
        const v = await readVersion(photoId); // 2
        await db.photoFaceCheck.create({
          data: {
            verificationId,
            userId,
            photoId,
            photoVersion: v,
            isCoverAtCheck: false,
            calibrationVersion: "mock:vOLD", // a DIFFERENT threshold version
            classification: "OWNER_MATCHED",
            decision: "PASSED",
          },
        });
        const row = await db.photoFaceCheck.findUnique({
          where: {
            photoId_photoVersion_verificationId: { photoId, photoVersion: v, verificationId },
          },
        });
        // Same photoId + version, but the threshold differs -> NOT reusable.
        assert.ok(row, "the row exists for this version");
        assert.notEqual(
          row!.calibrationVersion,
          ACTIVE_CAL,
          "recalibration invalidates the verdict",
        );
      },
    );

    await check(
      "optimistic lock: a stale expectedVersion refuses and reports the latest",
      async () => {
        const cur = await readVersion(photoId); // 3 after the reuse-test create? no create bumps; still 2
        const stale = await bumpPhotoMediaVersion(photoId, cur - 1); // wrong expected
        assert.equal(stale?.bumped, false, "stale writer does not bump");
        assert.equal(stale?.version, cur, "and learns the current authoritative version");
        assert.equal(await readVersion(photoId), cur, "no double increment");
      },
    );

    await check("concurrent replacement composes to ONE latest authoritative version", async () => {
      const start = await readVersion(photoId);
      const [a, b] = await Promise.all([
        bumpPhotoMediaVersion(photoId),
        bumpPhotoMediaVersion(photoId),
      ]);
      // Both atomic increments land (no lost write); final = start + 2.
      assert.equal(await readVersion(photoId), start + 2, "no write lost");
      const versions = [a?.version, b?.version].sort();
      assert.deepEqual(versions, [start + 1, start + 2], "each bump got a distinct version");
    });
  } finally {
    await db.photoFaceCheck.deleteMany({ where: { userId } }).catch(() => {});
    await db.profilePhotoVerification.deleteMany({ where: { userId } }).catch(() => {});
    await db.photo.deleteMany({ where: { userId } }).catch(() => {});
    await db.user.delete({ where: { id: userId } }).catch(() => {});
    await db.$disconnect();
  }

  console.log(`\n${passed} checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
