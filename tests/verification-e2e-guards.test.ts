/**
 * Stripe Identity E2E guard tests:
 *   npx tsx tests/verification-e2e-guards.test.ts
 *
 * The regressions this task's end-to-end run surfaced or nearly hit:
 *  1. explore profile clobber - visibleWhere() carries its own `id` key,
 *     so spreading it after `id: targetId` silently DROPPED the target
 *     constraint and the explore viewer returned someone else's profile
 *     (this is exactly how the E2E's public-badge assertion failed)
 *  2. unknown Stripe Identity states must map to the safe no-op channel
 *     ("pending"), never to an outcome that stamps or clears a verdict
 *  3. a webhook naming the WRONG provider for a real session id must be
 *     a session_not_found no-op (provider is part of the row's identity)
 *  4. the reset-test-user CLI: allowlist matrix, dry-run-by-default,
 *     refusal exit codes, and a full confirm lifecycle on a minted user
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const RUN = Date.now().toString(36);

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

async function main() {
  process.env.VERIFICATION_PROVIDER = "mock";
  const { mapStripeIdentityStatus, applyVerificationOutcome } =
    await import("../src/lib/services/photo-verification");
  const { isApprovedTestEmail } = await import("../scripts/reset-test-user");
  const { getExploreProfile } = await import("../src/lib/services/explore");
  const { db } = await import("../src/lib/db");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const minted: string[] = [];
  const mkUser = async (tag: string, phoneTail: string) => {
    const email = `e2e-guard-${tag}-${RUN}@example.com`;
    const created = await admin.auth.admin.createUser({
      email,
      password: `eg-${RUN}-Aa1!`,
      email_confirm: true,
    });
    const uid = created.data.user!.id;
    const now = new Date();
    await db.user.create({
      data: {
        id: uid,
        email,
        name: `EG ${tag}`,
        emailVerified: now,
        phone: `+3538784${phoneTail}`,
        phoneVerifiedAt: now,
        ageConfirmedAt: now,
        termsVersion: "2026-07",
        privacyVersion: "2026-07",
        communityVersion: "2026-07",
        onboardingDone: true,
      },
    });
    await db.profile.create({
      data: {
        userId: uid,
        displayName: `EG ${tag}`,
        birthDate: new Date("1993-03-03"),
        gender: tag === "viewer" ? "MAN" : "WOMAN",
      },
    });
    minted.push(uid);
    return { uid, email };
  };

  try {
    console.log("Stripe status mapping - unknown states are safe");

    await check("known states map to the documented outcomes", () => {
      assert.equal(mapStripeIdentityStatus({ status: "verified" }), "approved");
      assert.equal(mapStripeIdentityStatus({ status: "processing" }), "pending");
      assert.equal(mapStripeIdentityStatus({ status: "canceled" }), "expired");
      assert.equal(
        mapStripeIdentityStatus({
          status: "requires_input",
          last_error: { code: "document_unverified_other" },
        }),
        "rejected",
      );
    });

    await check("requires_input WITHOUT last_error stays pending (user mid-flow)", () => {
      assert.equal(mapStripeIdentityStatus({ status: "requires_input" }), "pending");
    });

    await check("unknown/future Stripe states -> pending (no-op), never a verdict", () => {
      for (const status of ["requires_action", "verified_v2", "", undefined]) {
        const mapped = mapStripeIdentityStatus({
          status,
        } as unknown as Parameters<typeof mapStripeIdentityStatus>[0]);
        assert.equal(mapped, "pending", `status=${String(status)}`);
      }
    });

    console.log("provider identity - a session id belongs to ONE provider");

    const owner = await mkUser("owner", "01");
    const sessionId = `mock_guard_${RUN}`;
    await db.verification.create({
      data: {
        userId: owner.uid,
        type: "PHOTO",
        status: "PENDING",
        statusChangedAt: new Date(),
        provider: "mock",
        providerSessionId: sessionId,
      },
    });

    await check("approved outcome under the WRONG provider name is session_not_found", async () => {
      const result = await applyVerificationOutcome("stripe_identity", sessionId, "approved");
      assert.deepEqual(result, { applied: false, reason: "session_not_found", userId: null });
      const row = await db.verification.findUniqueOrThrow({
        where: { userId_type: { userId: owner.uid, type: "PHOTO" } },
      });
      const user = await db.user.findUniqueOrThrow({ where: { id: owner.uid } });
      assert.equal(row.status, "PENDING", "workflow untouched");
      assert.equal(user.photoVerifiedAt, null, "no verdict stamped");
    });

    await check("the same outcome under the OWNING provider applies", async () => {
      const result = await applyVerificationOutcome("mock", sessionId, "approved");
      assert.equal(result.applied, true);
      const user = await db.user.findUniqueOrThrow({ where: { id: owner.uid } });
      assert.notEqual(user.photoVerifiedAt, null);
    });

    console.log("explore profile - the payload is the REQUESTED user");

    const viewer = await mkUser("viewer", "02");
    const decoy = await mkUser("decoy", "03");

    await check("getExploreProfile returns the target, not the first visible user", async () => {
      // owner is photo-verified (stamped above); decoy exists so the old
      // clobbered where ({id:{notIn}} replacing id:targetId) had multiple
      // candidates to wrongly return the first of.
      const profile = await getExploreProfile(viewer.uid, owner.uid);
      assert.ok(profile, "target is visible to the viewer");
      assert.equal(profile.userId, owner.uid, "payload user matches the request");
      assert.equal(profile.isVerified, true, "verified badge rides the CORRECT user");
      const decoyProfile = await getExploreProfile(viewer.uid, decoy.uid);
      assert.equal(decoyProfile?.userId, decoy.uid);
      assert.equal(decoyProfile?.isVerified, false);
    });

    await check("visibility rules still hold: self is never returned", async () => {
      assert.equal(await getExploreProfile(viewer.uid, viewer.uid), null);
    });

    console.log("reset-test-user CLI - allowlist, dry-run default, confirm lifecycle");

    await check("isApprovedTestEmail: approves ONLY obvious test identities", () => {
      for (const good of [
        "anything@example.com",
        "person@test.tirvea.app",
        "test-run1@gmail.com",
        "e2e+badge@outlook.com",
        "qa_checkout@yahoo.com",
        "martins+e2e-run@gmail.com",
      ]) {
        assert.equal(isApprovedTestEmail(good), true, good);
      }
      for (const real of [
        "emartinsbox@gmail.com",
        "teste@gmail.com", // starts with "test" but no separator - a real name
        "protest@gmail.com",
        "sarah.qa.smith@gmail.com", // qa not anchored at start / not a +tag
        "member@tirvea.app", // production domain, NOT test.tirvea.app
        "",
      ]) {
        assert.equal(isApprovedTestEmail(real), false, real || "(empty)");
      }
    });

    const cli = (args: string[]) => {
      try {
        const stdout = execFileSync("npx", ["tsx", "scripts/reset-test-user.ts", ...args], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
        return { code: 0, out: stdout };
      } catch (error) {
        const failure = error as { status: number | null; stdout?: string; stderr?: string };
        return { code: failure.status ?? 1, out: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
      }
    };

    await check("CLI refuses a non-test email with exit 1 and touches nothing", () => {
      const result = cli(["emartinsbox@gmail.com", "--confirm"]);
      assert.equal(result.code, 1);
      assert.match(result.out, /REFUSED/);
    });

    const victim = await mkUser("victim", "04");
    await check("dry run (default) audits but deletes nothing", async () => {
      const result = cli([victim.email]);
      assert.equal(result.code, 0);
      assert.match(result.out, /DRY RUN - nothing was deleted/);
      assert.ok(await db.user.findUnique({ where: { id: victim.uid } }), "user still present");
    });

    await check("--confirm removes app row AND auth identity; rerun finds nothing", async () => {
      const result = cli([victim.email, "--confirm"]);
      assert.equal(result.code, 0);
      assert.match(result.out, /RESET COMPLETE/);
      assert.equal(await db.user.findUnique({ where: { id: victim.uid } }), null);
      const rerun = cli([victim.email]);
      assert.match(rerun.out, /Nothing to reset/);
      minted.splice(minted.indexOf(victim.uid), 1);
    });

    await check("unrelated users are untouched by a confirm run", async () => {
      const still = await db.user.findMany({ where: { id: { in: minted } }, select: { id: true } });
      assert.equal(still.length, minted.length);
    });
  } finally {
    for (const uid of minted) {
      await db.user.delete({ where: { id: uid } }).catch(() => {});
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
