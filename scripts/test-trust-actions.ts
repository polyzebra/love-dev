import "dotenv/config";
/**
 * Live smoke test for the admin trust actions (run: npx tsx scripts/test-trust-actions.ts).
 * Uses throwaway rows against the real database and cleans up after itself:
 *  1. ban      -> bannedAt/banReason/status writes + gate blocks + AdminLog + AuthVerificationEvent
 *  2. unban    -> fields cleared, gate open again
 *  3. release phone -> unique constraint freed (second user can take the number)
 *  4. release email -> BlockedIdentity row deleted
 *  5. require phone re-verification + reset onboarding field writes
 */
import { db } from "../src/lib/db";
import { authNextStep } from "../src/lib/auth/gate";
import { CURRENT_VERSIONS } from "../src/lib/auth/consent";
import {
  banUser,
  releaseEmail,
  releasePhone,
  requirePhoneReverification,
  resetOnboarding,
  unbanUser,
} from "../src/lib/services/user-admin";

let failures = 0;

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  PASS ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` - ${detail}` : ""}`);
  }
}

async function main() {
  const stamp = Date.now();
  const adminEmail = `trust-test-admin-${stamp}@example.test`;
  const targetEmail = `trust-test-target-${stamp}@example.test`;
  const secondEmail = `trust-test-second-${stamp}@example.test`;
  const phone = `+3538${String(stamp).slice(-8)}`;

  const admin = await db.user.create({
    data: { email: adminEmail, role: "ADMIN", emailVerified: new Date() },
  });
  const target = await db.user.create({
    data: {
      email: targetEmail,
      emailVerified: new Date(),
      phone,
      phoneE164: phone,
      phoneVerifiedAt: new Date(),
      authCompleted: true,
      onboardingDone: true,
      // Satisfy the age/consent gate steps so ladder assertions isolate
      // the fields THIS test mutates.
      ageConfirmedAt: new Date(),
      termsVersion: CURRENT_VERSIONS.terms,
      privacyVersion: CURRENT_VERSIONS.privacy,
      communityVersion: CURRENT_VERSIONS.community,
    },
  });
  let second: { id: string } | null = null;

  try {
    // ---- 1. Ban ----
    console.log("ban:");
    await banUser({ actorId: admin.id, userId: target.id, reason: "Spam - test run" });
    const banned = await db.user.findUniqueOrThrow({ where: { id: target.id } });
    check("bannedAt set", banned.bannedAt != null);
    check("banReason stored", banned.banReason === "Spam - test run");
    check("status SUSPENDED", banned.status === "SUSPENDED");
    check("gate routes to /account-blocked", authNextStep(banned) === "/account-blocked");
    const banLog = await db.adminLog.findFirst({
      where: { actorId: admin.id, action: "user.ban", targetId: target.id },
    });
    check("AdminLog user.ban row", banLog != null);
    const banEvent = await db.authVerificationEvent.findFirst({
      where: { userId: target.id, type: "admin_ban" },
    });
    check("AuthVerificationEvent admin_ban row", banEvent != null);

    // ---- 2. Unban ----
    console.log("unban:");
    await unbanUser({ actorId: admin.id, userId: target.id });
    const restored = await db.user.findUniqueOrThrow({ where: { id: target.id } });
    check("bannedAt cleared", restored.bannedAt == null);
    check("banReason cleared", restored.banReason == null);
    check("status ACTIVE", restored.status === "ACTIVE");
    check("gate no longer blocks", authNextStep(restored) !== "/account-blocked");
    const unbanLog = await db.adminLog.findFirst({
      where: { actorId: admin.id, action: "user.unban", targetId: target.id },
    });
    check("AdminLog user.unban row", unbanLog != null);

    // ---- 3. Release phone frees the unique constraint ----
    console.log("release phone:");
    let conflict = false;
    try {
      second = await db.user.create({ data: { email: secondEmail, phoneE164: phone, phone } });
    } catch {
      conflict = true;
    }
    check("second user with same phone rejected before release", conflict);
    const { released } = await releasePhone({ actorId: admin.id, userId: target.id });
    check("released number reported", released === phone);
    const freed = await db.user.findUniqueOrThrow({ where: { id: target.id } });
    check(
      "phone fields cleared",
      freed.phone == null &&
        freed.phoneE164 == null &&
        freed.phoneVerifiedAt == null &&
        freed.phoneVerified == null &&
        freed.phoneCountryIso == null &&
        freed.phoneDialCode == null,
    );
    second = await db.user.create({ data: { email: secondEmail, phoneE164: phone, phone } });
    check("second user can take the number after release", second != null);
    const phoneLog = await db.adminLog.findFirst({
      where: { actorId: admin.id, action: "user.release_phone", targetId: target.id },
    });
    check("AdminLog user.release_phone row", phoneLog != null);

    // ---- 4. Release email deletes BlockedIdentity ----
    console.log("release email:");
    await db.blockedIdentity.create({
      data: { email: targetEmail.toLowerCase(), reason: "test block" },
    });
    const { removed } = await releaseEmail({ actorId: admin.id, userId: target.id });
    check("removed=true reported", removed);
    const blockRow = await db.blockedIdentity.findUnique({
      where: { email: targetEmail.toLowerCase() },
    });
    check("BlockedIdentity row deleted", blockRow == null);
    const { removed: removedAgain } = await releaseEmail({ actorId: admin.id, userId: target.id });
    check("second release is a no-op (removed=false)", !removedAgain);
    const emailLog = await db.adminLog.findFirst({
      where: { actorId: admin.id, action: "user.release_email", targetId: target.id },
    });
    check("AdminLog user.release_email row", emailLog != null);

    // ---- 5. Re-verification + onboarding resets ----
    console.log("require phone re-verification / reset onboarding:");
    await db.user.update({
      where: { id: target.id },
      data: { phoneVerifiedAt: new Date(), authCompleted: true },
    });
    await requirePhoneReverification({ actorId: admin.id, userId: target.id });
    const reverify = await db.user.findUniqueOrThrow({ where: { id: target.id } });
    check("phoneVerifiedAt cleared", reverify.phoneVerifiedAt == null);
    check("authCompleted false", !reverify.authCompleted);
    check(
      "gate demands phone step when SMS is enabled",
      authNextStep(reverify, true) === "/auth/phone",
    );
    await resetOnboarding({ actorId: admin.id, userId: target.id });
    const reset = await db.user.findUniqueOrThrow({ where: { id: target.id } });
    check("onboardingDone false", !reset.onboardingDone);
    check("gate demands onboarding", authNextStep(reset, false) === "/onboarding");
  } finally {
    // ---- Cleanup ----
    const ids = [admin.id, target.id, ...(second ? [second.id] : [])];
    await db.adminLog.deleteMany({ where: { actorId: admin.id } });
    await db.authVerificationEvent.deleteMany({ where: { userId: { in: ids } } });
    await db.authVerificationEvent.deleteMany({
      where: { email: { in: [adminEmail, targetEmail, secondEmail] } },
    });
    await db.blockedIdentity.deleteMany({ where: { email: targetEmail.toLowerCase() } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log("\nAll checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
