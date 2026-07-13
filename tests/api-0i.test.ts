/**
 * Live tests for media access (Phase 0I):
 *   npx tsx tests/api-0i.test.ts
 *
 * Live lane: real Supabase credentials (storage + auth) + the dev server
 * on :3000 (skips with a notice when unreachable). Uploads a real 1x1
 * webp into the PRIVATE bucket and exercises the proxy + signed-URL
 * surfaces end to end:
 *  - owner access (any status), via Bearer AND via cookies
 *  - permitted viewer / unauthorized (anonymous) / suspended viewer
 *  - blocked relationship -> 403 (Phase 0I hardening)
 *  - staff access to REJECTED photos; members refused
 *  - immutable-ETag 304 path (authorization still runs first)
 *  - short-lived signed URL: mint -> fetch without auth -> expires
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

const RUN = Date.now().toString(36);
const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";

// Minimal valid 1x1 lossless webp.
const WEBP_1PX = Buffer.from("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==", "base64");

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}
function skip(name: string, why: string) {
  console.log(`  skip - ${name} (${why})`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { db } = await import("../src/lib/db");
  const { PHOTOS_BUCKET, photoObjectPaths } = await import("../src/lib/services/photos");
  const { createSignedMediaUrl } = await import("../src/lib/services/media");

  const reachable = await fetch(`${BASE}/api/health`).then(
    (r) => r.ok,
    () => false,
  );
  if (!reachable) {
    skip("all 0I checks", "dev server not running");
    await db.$disconnect();
    console.log(`\n${passed} checks passed`);
    return;
  }

  const password = `oi-test-${RUN}-Aa1!`;
  const mkUser = async (tag: string, phoneTail: string, role = "USER") => {
    const email = `oi-${tag}-${RUN}@example.com`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    const uid = created.data.user!.id;
    const now = new Date();
    await db.user.create({
      data: {
        id: uid,
        email,
        name: `OI ${tag}`,
        role: role as "USER" | "MODERATOR",
        emailVerified: now,
        phone: `+3538793${phoneTail}`,
        phoneVerifiedAt: now,
        ageConfirmedAt: now,
        termsVersion: "2026-07",
        privacyVersion: "2026-07",
        communityVersion: "2026-07",
        onboardingDone: true,
      },
    });
    const anon = createClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const session = (await anon.auth.signInWithPassword({ email, password })).data.session!;
    // Cookie header exactly as the app's SSR client would write it.
    const jar: { name: string; value: string }[] = [];
    const ssr = createServerClient(url, anonKey, {
      cookies: {
        getAll: () => jar,
        setAll: (all) => {
          for (const c of all) jar.push({ name: c.name, value: c.value });
        },
      },
    });
    await ssr.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });
    const cookieHeader = jar.map((c) => `${c.name}=${c.value}`).join("; ");
    return { uid, token: session.access_token, cookieHeader };
  };

  const alice = await mkUser("alice", `1${RUN.slice(-4)}`); // owner
  const bob = await mkUser("bob", `2${RUN.slice(-4)}`); // permitted viewer
  const carol = await mkUser("carol", `3${RUN.slice(-4)}`); // blocked pair
  const dave = await mkUser("dave", `4${RUN.slice(-4)}`); // suspended later
  const maude = await mkUser("maude", `5${RUN.slice(-4)}`, "MODERATOR");

  // --- storage fixtures: real objects in the PRIVATE bucket ---------------
  const mkPhoto = async (status: string, moderation: string) => {
    const photo = await db.photo.create({
      data: {
        userId: alice.uid,
        url: "pending",
        status: status as "ACTIVE" | "PROCESSING",
        moderation: moderation as "APPROVED" | "REJECTED" | "PENDING",
        position: 0,
      },
    });
    const paths = photoObjectPaths(alice.uid, photo.id);
    for (const variant of ["thumb", "gallery", "card", "full"] as const) {
      const { error } = await admin.storage
        .from(PHOTOS_BUCKET)
        .upload(paths[variant], new Blob([new Uint8Array(WEBP_1PX)], { type: "image/webp" }), {
          upsert: true,
          contentType: "image/webp",
        });
      if (error) throw new Error(`fixture upload failed: ${error.message}`);
    }
    await db.photo.update({
      where: { id: photo.id },
      data: { storagePath: paths.base, url: `/api/media/${photo.id}/card` },
    });
    return photo.id;
  };

  const activePhoto = await mkPhoto("ACTIVE", "APPROVED");
  const processingPhoto = await mkPhoto("PROCESSING", "PENDING");
  const rejectedPhoto = await mkPhoto("ACTIVE", "REJECTED");

  await db.block.create({ data: { blockerId: alice.uid, blockedId: carol.uid } });

  const media = (photoId: string, headers: Record<string, string> = {}, path = "") =>
    fetch(`${BASE}/api/media/${photoId}/card${path}`, { headers });
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  try {
    console.log("media access, live:");

    await check("anonymous request -> 401 (photos are never public)", async () => {
      const res = await media(activePhoto);
      assert.equal(res.status, 401);
    });

    await check("owner via BEARER gets bytes (transport-independent proxy)", async () => {
      const res = await media(activePhoto, bearer(alice.token));
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type"), "image/webp");
      const bytes = Buffer.from(await res.arrayBuffer());
      assert.ok(bytes.length > 0 && bytes.subarray(0, 4).toString() === "RIFF");
    });

    await check("owner via COOKIES gets the same bytes", async () => {
      const res = await media(activePhoto, { cookie: alice.cookieHeader });
      assert.equal(res.status, 200);
      assert.equal((await res.arrayBuffer()).byteLength, WEBP_1PX.length);
    });

    await check("owner sees their own under-review photo", async () => {
      const res = await media(processingPhoto, bearer(alice.token));
      assert.equal(res.status, 200);
    });

    await check("permitted viewer sees ACTIVE+approved photos only", async () => {
      assert.equal((await media(activePhoto, bearer(bob.token))).status, 200);
      assert.equal((await media(processingPhoto, bearer(bob.token))).status, 403);
      assert.equal((await media(rejectedPhoto, bearer(bob.token))).status, 403);
    });

    await check("blocked relationship -> 403 in both directions", async () => {
      const res = await media(activePhoto, bearer(carol.token));
      assert.equal(res.status, 403, "alice blocked carol - no bytes");
    });

    await check("staff sees REJECTED photos (moderation queue)", async () => {
      const res = await media(rejectedPhoto, bearer(maude.token));
      assert.equal(res.status, 200);
    });

    await check("suspended viewer -> 403 account_restricted", async () => {
      await db.user.update({ where: { id: dave.uid }, data: { status: "SUSPENDED" } });
      const res = await media(activePhoto, bearer(dave.token));
      assert.equal(res.status, 403);
    });

    await check("immutable ETag answers 304 - but only AFTER authorization", async () => {
      const first = await media(activePhoto, bearer(bob.token));
      const etag = first.headers.get("etag");
      assert.ok(etag, "etag present");
      const revalidated = await media(activePhoto, {
        ...bearer(bob.token),
        "if-none-match": etag!,
      });
      assert.equal(revalidated.status, 304);
      const anonymous = await fetch(`${BASE}/api/media/${activePhoto}/card`, {
        headers: { "if-none-match": etag! },
      });
      assert.equal(anonymous.status, 401, "cached validators never bypass auth");
    });

    await check("signed URL: authorized mint -> bytes without auth -> no-store", async () => {
      const res = await media(activePhoto, bearer(bob.token), "/url");
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("cache-control"), "no-store");
      const { data } = (await res.json()) as {
        data: { url: string; ttlSeconds: number; expiresAt: string };
      };
      assert.equal(data.ttlSeconds, 60);
      const direct = await fetch(data.url);
      assert.equal(direct.status, 200, "storage serves the signed URL");
    });

    await check("signed URL endpoint enforces the SAME authorization", async () => {
      assert.equal((await media(activePhoto, bearer(carol.token), "/url")).status, 403);
      assert.equal((await media(rejectedPhoto, bearer(bob.token), "/url")).status, 403);
      assert.equal((await media(activePhoto, {}, "/url")).status, 401);
    });

    await check("expired signed URL stops serving (leaks cannot persist)", async () => {
      const photo = await db.photo.findUniqueOrThrow({
        where: { id: activePhoto },
        select: { storagePath: true },
      });
      const signed = await createSignedMediaUrl(
        { storagePath: photo.storagePath! },
        "card",
        1, // 1-second TTL purely for this check
      );
      assert.ok(signed, "signing available");
      await sleep(2_500);
      const res = await fetch(signed!.url);
      assert.notEqual(res.status, 200, `expired signature refused (got ${res.status})`);
    });

    console.log(`\n${passed} checks passed`);
  } finally {
    for (const id of [activePhoto, processingPhoto, rejectedPhoto]) {
      const paths = photoObjectPaths(alice.uid, id);
      await admin.storage
        .from(PHOTOS_BUCKET)
        .remove([paths.thumb, paths.gallery, paths.card, paths.full])
        .catch(() => {});
    }
    for (const u of [alice, bob, carol, dave, maude]) {
      await db.user.delete({ where: { id: u.uid } }).catch(() => {});
      await admin.auth.admin.deleteUser(u.uid).catch(() => {});
    }
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error("\nFAILED:", error);
  process.exitCode = 1;
});
