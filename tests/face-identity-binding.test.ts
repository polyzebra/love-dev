/**
 * Epic 1 / F1 (live, DB): the FaceIdentityBinding data model + faceVerifiedAt
 * default. Proves the additive schema is present and behaves - inert positive
 * column defaults null, referential integrity holds, and the one-binding-per-
 * liveness-capture lifecycle policy is enforced. No binding is ever created by
 * app code in this phase; these are direct model assertions.
 *
 * Live lane. Run with: npx tsx tests/face-identity-binding.test.ts
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

let passed = 0;
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

const RUN = Math.abs(hashStr(`${process.env.USER ?? "x"}:${process.argv.join()}`)) % 100000;
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { db } = await import("../src/lib/db");

  const minted: string[] = [];
  const mkUser = async (tag: string, tail: string) => {
    const email = `e2e-fib-${tag}-${RUN}@example.com`;
    const uid = (
      await admin.auth.admin.createUser({ email, password: `fib-${RUN}-Aa1!`, email_confirm: true })
    ).data.user!.id;
    const now = new Date();
    await db.user.create({
      data: {
        id: uid,
        email,
        name: `FIB ${tag}`,
        emailVerified: now,
        phone: `+3538798${tail}${String(RUN).padStart(4, "0").slice(0, 2)}`,
        phoneVerifiedAt: now,
        ageConfirmedAt: now,
        termsVersion: "2026-07",
        privacyVersion: "2026-07",
        communityVersion: "2026-07",
        onboardingDone: true,
        photoVerifiedAt: now,
      },
    });
    minted.push(uid);
    return uid;
  };

  try {
    let uid = "";
    await check("faceVerifiedAt defaults to NULL for a new user (inert)", async () => {
      uid = await mkUser("a", "1");
      const u = await db.user.findUniqueOrThrow({
        where: { id: uid },
        select: { faceVerifiedAt: true },
      });
      assert.equal(u.faceVerifiedAt, null, "positive grant column is inert/null by default");
    });

    await check("referential integrity: a binding to a non-existent user is rejected", async () => {
      await assert.rejects(
        () =>
          db.faceIdentityBinding.create({
            data: { userId: `ghost-${RUN}`, method: "HUMAN_REVIEW", provider: "manual" },
          }),
        "FK violation on userId",
      );
    });

    await check(
      "referential integrity: a binding to a non-existent reference is rejected",
      async () => {
        await assert.rejects(
          () =>
            db.faceIdentityBinding.create({
              data: {
                userId: uid,
                faceReferenceId: `noref-${RUN}`,
                method: "HUMAN_REVIEW",
                provider: "manual",
              },
            }),
          "FK violation on faceReferenceId",
        );
      },
    );

    await check(
      "lifecycle policy: at most ONE binding per liveness capture (flowId unique)",
      async () => {
        const flow = `flow-${RUN}`;
        await db.faceIdentityBinding.create({
          data: {
            userId: uid,
            livenessFlowId: flow,
            method: "STRIPE_SELFIE_COMPARE",
            provider: "aws",
          },
        });
        await assert.rejects(
          () =>
            db.faceIdentityBinding.create({
              data: {
                userId: uid,
                livenessFlowId: flow,
                method: "STRIPE_SELFIE_COMPARE",
                provider: "aws",
              },
            }),
          "duplicate binding for the same capture is rejected",
        );
      },
    );

    await check(
      "multiple bindings with NULL flowId are allowed (pre-capture / human review)",
      async () => {
        const a = await db.faceIdentityBinding.create({
          data: { userId: uid, method: "HUMAN_REVIEW", provider: "manual" },
        });
        const b = await db.faceIdentityBinding.create({
          data: { userId: uid, method: "HUMAN_REVIEW", provider: "manual" },
        });
        assert.ok(a.id !== b.id, "two null-flow bindings coexist");
        assert.equal(a.status, "BINDING_REQUIRED", "default status");
      },
    );
  } finally {
    for (const uid of minted) {
      await db.faceIdentityBinding.deleteMany({ where: { userId: uid } }).catch(() => {});
      await db.user.deleteMany({ where: { id: uid } }).catch(() => {});
      await admin.auth.admin.deleteUser(uid).catch(() => {});
    }
    await db.$disconnect();
  }

  console.log(`\n${passed} checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
