/**
 * Live tests for the hardened profile-photo pipeline. Run with:
 *   npx tsx tests/photo-pipeline.test.ts
 *
 * Service-level cases always run (sharp only, no network beyond the DB for
 * the E2E section). Set PHOTO_TEST_BASE_URL (e.g. http://localhost:3100)
 * with the app running to also exercise the POST /api/photos route and the
 * /api/media ETag end to end; the E2E section mints a throwaway
 * email+password auth user (confirmed via direct SQL) plus an app User row
 * and removes BOTH in `finally`, along with any rows/objects it created.
 *
 * The matrix:
 *   1. Alpha PNG (partial transparency) -> opaque white-backed variants:
 *      channels=3, no alpha, exact dims, NOT blank
 *   2. Fully transparent PNG (flattens to blank white) -> rejected with
 *      PhotoProcessingError - never stored as a white rectangle
 *   3. Corrupt/tiny input -> processProfilePhoto throws (route answers 422)
 *   4. validateProcessedVariant rejects a deliberately blank output (fake
 *      transformer output: right dims/format, zero variance) but ACCEPTS
 *      the same plain output when the INPUT was near-uniform, and accepts
 *      a small byte size only for near-uniform inputs
 *   5. mediaEtag changes when mediaVersion bumps (reprocess cache-bust)
 *   6. E2E: corrupt upload -> 422, nothing in DB or storage
 *   7. E2E: valid upload -> 201, stored variants decode (ch=3, exact dims,
 *      no UTF-8 mangling signature), /api/media serves ETag v0 + 304 on
 *      If-None-Match, bumping mediaVersion changes the ETag and re-serves
 *      200 for the stale tag
 *   8. E2E: fully transparent PNG -> 422 image_processing_failed, nothing
 *      persisted
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";

const BASE_URL = process.env.PHOTO_TEST_BASE_URL ?? "";

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

function gradientRaw(w: number, h: number, channels: 3 | 4, alpha: (x: number, y: number) => number) {
  const raw = Buffer.alloc(w * h * channels);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * channels;
      raw[i] = ((x * 255) / w) | 0;
      raw[i + 1] = 128;
      raw[i + 2] = ((y * 255) / h) | 0;
      if (channels === 4) raw[i + 3] = alpha(x, y);
    }
  }
  return raw;
}

async function main() {
  const { processProfilePhoto, validateProcessedVariant, mediaEtag, PhotoProcessingError, PHOTO_VARIANTS, PHOTO_VARIANT_NAMES } =
    await import("../src/lib/services/photos");

  const w = 900;
  const h = 1200;

  // 1. Partial-alpha PNG -> opaque, white-backed, non-blank variants.
  await check("alpha PNG -> opaque white-backed non-blank variants", async () => {
    const png = await sharp(
      gradientRaw(w, h, 4, (x, y) => ((x - w / 2) ** 2 + (y - h / 2) ** 2 < 200 ** 2 ? 255 : 0)),
      { raw: { width: w, height: h, channels: 4 } },
    )
      .png()
      .toBuffer();
    const processed = await processProfilePhoto(png);
    for (const variant of PHOTO_VARIANT_NAMES) {
      const meta = await sharp(processed[variant]).metadata();
      assert.equal(meta.format, "webp");
      assert.equal(meta.channels, 3, `${variant} must be opaque (alpha flattened)`);
      assert.equal(meta.hasAlpha, false);
      assert.equal(meta.width, PHOTO_VARIANTS[variant].width);
      assert.equal(meta.height, PHOTO_VARIANTS[variant].height);
      const stats = await sharp(processed[variant]).stats();
      const maxStdev = Math.max(...stats.channels.map((c) => c.stdev));
      assert.ok(maxStdev > 3, `${variant} must not be blank (maxStdev=${maxStdev.toFixed(2)})`);
      // White-backed: the transparent area must be white, so means sit high.
      const means = stats.channels.map((c) => c.mean);
      assert.ok(Math.min(...means) > 200, `${variant} transparent area must flatten to white`);
    }
  });

  // 2. Fully transparent PNG flattens to blank -> rejected, never stored.
  await check("fully transparent PNG is rejected (no blank white upload)", async () => {
    const png = await sharp(gradientRaw(w, h, 4, () => 0), {
      raw: { width: w, height: h, channels: 4 },
    })
      .png()
      .toBuffer();
    await assert.rejects(processProfilePhoto(png), (e: unknown) => e instanceof PhotoProcessingError);
  });

  // 3. Corrupt input throws (the route maps this to 422 invalid_image).
  await check("corrupt input -> processProfilePhoto throws", async () => {
    await assert.rejects(processProfilePhoto(Buffer.from("not-an-image")));
    await assert.rejects(processProfilePhoto(Buffer.alloc(0)));
  });

  // 4. Validation rejects a deliberately blank output; plain inputs exempt.
  await check("validateProcessedVariant rejects blank output, allows plain input", async () => {
    const { width, height } = PHOTO_VARIANTS.thumb;
    const blank = await sharp({
      create: { width, height, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .webp({ quality: 84 })
      .toBuffer();
    // Fake transformer output: correct dims/format/channels, zero variance.
    await assert.rejects(
      validateProcessedVariant("thumb", blank, { maxStdev: 50 }),
      (e: unknown) =>
        e instanceof PhotoProcessingError && /near-uniform|bytes/.test(String(e.message)),
    );
    // Same buffer from a near-uniform INPUT is a legitimately plain photo.
    await validateProcessedVariant("thumb", blank, { maxStdev: 0.5 });
    // Wrong dimensions always fail, no matter the input.
    await assert.rejects(
      validateProcessedVariant("card", blank, { maxStdev: 0.5 }),
      (e: unknown) => e instanceof PhotoProcessingError && /dimensions/.test(String(e.message)),
    );
  });

  // 5. ETag changes when mediaVersion bumps.
  await check("mediaEtag changes after reprocess (version bump)", () => {
    const id = randomUUID();
    const v0 = mediaEtag(id, "thumb", 0);
    const v1 = mediaEtag(id, "thumb", 1);
    assert.notEqual(v0, v1);
    assert.ok(v0.startsWith('"') && v0.endsWith('"'));
    assert.notEqual(mediaEtag(id, "thumb", 0), mediaEtag(id, "card", 0));
  });

  if (!BASE_URL) {
    console.log(`\n${passed} checks passed (set PHOTO_TEST_BASE_URL to run the route E2E section)`);
    return;
  }

  // ------------------------------------------------------------------ E2E
  const { db } = await import("../src/lib/db");
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const PROJECT_REF = new URL(SUPABASE_URL).hostname.split(".")[0];
  const RUN = Date.now().toString(36);
  const email = `photo-pipeline-${RUN}@example.com`;
  const password = `Ph0to-${randomUUID()}`;
  let uid: string | null = null;
  let accessToken: string | null = null;

  const cookieFor = (session: unknown) => {
    const value = `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
    const name = `sb-${PROJECT_REF}-auth-token`;
    const MAX = 3180;
    if (value.length <= MAX) return `${name}=${value}`;
    const parts: string[] = [];
    for (let i = 0; i * MAX < value.length; i++) {
      parts.push(`${name}.${i}=${value.slice(i * MAX, (i + 1) * MAX)}`);
    }
    return parts.join("; ");
  };

  try {
    // Throwaway session: email+password signup, confirmed via direct SQL.
    const signup = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: "POST",
      headers: { apikey: ANON, "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const signupBody = (await signup.json()) as { id?: string; user?: { id: string } };
    assert.ok(signup.ok, "signup must succeed");
    uid = signupBody.user?.id ?? signupBody.id ?? null;
    assert.ok(uid, "signup must return a user id");
    await db.$executeRaw`update auth.users set email_confirmed_at = now() where id = ${uid}::uuid`;
    const grant = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: ANON, "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const session = (await grant.json()) as { access_token?: string };
    assert.ok(grant.ok && session.access_token, "password grant must succeed");
    accessToken = session.access_token!;
    const cookie = cookieFor(session);
    await db.user.create({
      data: { id: uid, email, emailVerified: new Date(), authCompleted: true, name: "Photo Pipeline Test" },
    });

    const postPhoto = (bytes: Buffer, type: string, name: string) => {
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(bytes)], { type }), name);
      return fetch(`${BASE_URL}/api/photos`, { method: "POST", headers: { cookie }, body: form });
    };

    // 6. Corrupt input -> 422, nothing uploaded anywhere.
    await check("E2E: corrupt upload -> 422, nothing persisted", async () => {
      const res = await postPhoto(Buffer.from("definitely-not-an-image"), "image/jpeg", "x.jpg");
      assert.equal(res.status, 422);
      const body = (await res.json()) as { error: { code: string } };
      assert.equal(body.error.code, "invalid_image");
      assert.equal(await db.photo.count({ where: { userId: uid! } }), 0);
      const objects = await db.$queryRaw<{ n: bigint }[]>`
        select count(*) as n from storage.objects
        where bucket_id = 'listing-images' and name like ${"users/" + uid + "/%"}`;
      assert.equal(Number(objects[0].n), 0, "no storage objects may exist after a 422");
    });

    // 8 (order: cheap negative before positive). Transparent PNG -> 422.
    await check("E2E: fully transparent PNG -> 422 image_processing_failed, nothing persisted", async () => {
      const png = await sharp(gradientRaw(w, h, 4, () => 0), {
        raw: { width: w, height: h, channels: 4 },
      })
        .png()
        .toBuffer();
      const res = await postPhoto(png, "image/png", "transparent.png");
      assert.equal(res.status, 422);
      const body = (await res.json()) as { error: { code: string } };
      assert.equal(body.error.code, "image_processing_failed");
      assert.equal(await db.photo.count({ where: { userId: uid! } }), 0);
    });

    // 7. Valid upload -> stored variants are real; ETag bumps with version.
    await check("E2E: valid upload stores decodable variants; ETag busts on version bump", async () => {
      const jpeg = await sharp(gradientRaw(w, h, 3, () => 255), {
        raw: { width: w, height: h, channels: 3 },
      })
        .jpeg({ quality: 90 })
        .toBuffer();
      const res = await postPhoto(jpeg, "image/jpeg", "gradient.jpg");
      assert.equal(res.status, 201);
      const body = (await res.json()) as { data: { id: string } };
      const photoId = body.data.id;

      // Stored objects decode and carry no UTF-8 mangling signature.
      for (const variant of PHOTO_VARIANT_NAMES) {
        const dl = await fetch(
          `${SUPABASE_URL}/storage/v1/object/listing-images/users/${uid}/photos/${photoId}/${variant}.webp`,
          { headers: { apikey: ANON, authorization: `Bearer ${session.access_token}` } },
        );
        assert.ok(dl.ok, `${variant} must download`);
        const buf = Buffer.from(await dl.arrayBuffer());
        const meta = await sharp(buf).metadata();
        assert.equal(meta.format, "webp");
        assert.equal(meta.channels, 3);
        assert.equal(meta.width, PHOTO_VARIANTS[variant].width);
        assert.equal(meta.height, PHOTO_VARIANTS[variant].height);
      }

      // ETag v0 + 304 on If-None-Match.
      const media = await fetch(`${BASE_URL}/api/media/${photoId}/thumb`, { headers: { cookie } });
      assert.equal(media.status, 200);
      const etag0 = media.headers.get("etag");
      assert.equal(etag0, mediaEtag(photoId, "thumb", 0));
      const cached = await fetch(`${BASE_URL}/api/media/${photoId}/thumb`, {
        headers: { cookie, "if-none-match": etag0! },
      });
      assert.equal(cached.status, 304);

      // Reprocess bumps mediaVersion -> new ETag, stale tag re-serves 200.
      await db.photo.update({ where: { id: photoId }, data: { mediaVersion: { increment: 1 } } });
      const bumped = await fetch(`${BASE_URL}/api/media/${photoId}/thumb`, {
        headers: { cookie, "if-none-match": etag0! },
      });
      assert.equal(bumped.status, 200, "stale ETag must refetch after reprocess");
      assert.equal(bumped.headers.get("etag"), mediaEtag(photoId, "thumb", 1));

      const del = await fetch(`${BASE_URL}/api/photos/${photoId}`, {
        method: "DELETE",
        headers: { cookie },
      });
      assert.equal(del.status, 200);
    });

    console.log(`\n${passed} checks passed`);
  } finally {
    if (uid) {
      // Remove anything the run left behind: storage objects (via the
      // storage REST API so the underlying blobs are actually deleted, not
      // just their rows), photo rows, app row, auth row.
      if (accessToken) {
        const leftovers = await db.$queryRaw<{ name: string }[]>`
          select name from storage.objects
          where bucket_id = 'listing-images' and name like ${"users/" + uid + "/%"}`;
        for (const { name } of leftovers) {
          await fetch(`${SUPABASE_URL}/storage/v1/object/listing-images/${name}`, {
            method: "DELETE",
            headers: { apikey: ANON, authorization: `Bearer ${accessToken}` },
          }).catch(() => undefined);
        }
      }
      await db.photo.deleteMany({ where: { userId: uid } });
      await db.user.deleteMany({ where: { id: uid } });
      await db.$executeRaw`delete from auth.users where id = ${uid}::uuid`;
    }
    await db.$disconnect();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
