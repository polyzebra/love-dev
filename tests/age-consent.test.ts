/**
 * Live tests for the 18+ / legal-consent steps. Run with:
 *   npx tsx tests/age-consent.test.ts
 *
 * Talks to the real database from .env (writes are namespaced under
 * test-specific emails/uuids and cleaned up in `finally`).
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

process.env.AUTH_HASH_SALT = process.env.AUTH_HASH_SALT || "test-salt";

const RUN = Date.now().toString(36);
const testEmail = (tag: string) => `age-consent-${tag}-${RUN}@example.com`;

let passed = 0;
function check(name: string, fn: () => void | Promise<void>): Promise<void> | void {
  const done = () => {
    passed += 1;
    console.log(`  ok - ${name}`);
  };
  const result = fn();
  if (result instanceof Promise) return result.then(done);
  done();
}

function fakeReq(ip: string, ua = "test-agent/1.0"): Request {
  return new Request("http://test.local/api", {
    headers: { "x-forwarded-for": `${ip}, 10.0.0.1`, "user-agent": ua },
  });
}

async function main() {
  const { authNextStep } = await import("../src/lib/auth/gate");
  const {
    CURRENT_VERSIONS,
    needsAgeConfirmation,
    needsConsent,
    confirmAgeForUser,
    acceptConsentForUser,
  } = await import("../src/lib/auth/consent");

  // ------------------------------------------------------------ predicates
  console.log("consent predicates");
  await check("needsAgeConfirmation flips on ageConfirmedAt", () => {
    assert.equal(needsAgeConfirmation({ ageConfirmedAt: null }), true);
    assert.equal(needsAgeConfirmation({ ageConfirmedAt: new Date() }), false);
  });
  await check("needsConsent: never accepted / any stale version / current set", () => {
    const current = {
      termsVersion: CURRENT_VERSIONS.terms as string,
      privacyVersion: CURRENT_VERSIONS.privacy as string,
      communityVersion: CURRENT_VERSIONS.community as string,
    };
    assert.equal(
      needsConsent({ termsVersion: null, privacyVersion: null, communityVersion: null }),
      true,
    );
    assert.equal(needsConsent(current), false);
    // A bump to ANY single document forces re-consent.
    assert.equal(needsConsent({ ...current, termsVersion: "2025-01" }), true);
    assert.equal(needsConsent({ ...current, privacyVersion: "2025-01" }), true);
    assert.equal(needsConsent({ ...current, communityVersion: "2025-01" }), true);
  });

  // ------------------------------------------------------------ gate matrix
  console.log("gate matrix (age + consent steps)");
  const base = {
    status: "ACTIVE",
    bannedAt: null as Date | null,
    emailVerified: new Date(),
    phoneVerifiedAt: new Date(),
    ageConfirmedAt: new Date() as Date | null,
    termsVersion: CURRENT_VERSIONS.terms as string | null,
    privacyVersion: CURRENT_VERSIONS.privacy as string | null,
    communityVersion: CURRENT_VERSIONS.community as string | null,
    onboardingDone: true,
  };
  await check("full ladder order: blocked > email > phone > age > legal > onboarding", () => {
    const raw = {
      ...base,
      emailVerified: null,
      phoneVerifiedAt: null,
      ageConfirmedAt: null,
      termsVersion: null,
      privacyVersion: null,
      communityVersion: null,
      onboardingDone: false,
    };
    assert.equal(authNextStep({ ...raw, bannedAt: new Date() }, true), "/account-blocked");
    assert.equal(authNextStep(raw, true), "/login");
    assert.equal(authNextStep({ ...raw, emailVerified: new Date() }, true), "/auth/phone");
    assert.equal(
      authNextStep({ ...raw, emailVerified: new Date(), phoneVerifiedAt: new Date() }, true),
      "/auth/age",
    );
    assert.equal(
      authNextStep(
        { ...raw, emailVerified: new Date(), phoneVerifiedAt: new Date(), ageConfirmedAt: new Date() },
        true,
      ),
      "/auth/legal",
    );
  });
  await check("phone flag off hides the step but NOT age/consent", () => {
    assert.equal(
      authNextStep({ ...base, phoneVerifiedAt: null, ageConfirmedAt: null }, false),
      "/auth/age",
    );
    assert.equal(
      authNextStep({ ...base, phoneVerifiedAt: null, termsVersion: null }, false),
      "/auth/legal",
    );
  });
  await check("version bump = re-consent for an otherwise finished user", () => {
    assert.equal(authNextStep(base, true), "/discover");
    assert.equal(authNextStep({ ...base, termsVersion: "2025-12" }, true), "/auth/legal");
    assert.equal(authNextStep({ ...base, communityVersion: "2025-12" }, true), "/auth/legal");
  });
  await check("age before legal, legal before onboarding", () => {
    assert.equal(
      authNextStep({ ...base, ageConfirmedAt: null, termsVersion: null, onboardingDone: false }, true),
      "/auth/age",
    );
    assert.equal(authNextStep({ ...base, termsVersion: null, onboardingDone: false }, true), "/auth/legal");
    assert.equal(authNextStep({ ...base, onboardingDone: false }, true), "/onboarding");
  });

  // ------------------------------------------------- live DB-backed pieces
  const { db } = await import("../src/lib/db");
  const { sha256Hash } = await import("../src/lib/auth/audit");

  const email = testEmail("flow");
  const uid = randomUUID();

  try {
    await db.user.create({
      data: { id: uid, email, emailVerified: new Date(), phoneVerifiedAt: new Date() },
    });
    const user = (await db.user.findUniqueOrThrow({ where: { id: uid } }));

    console.log("age confirmation (live)");
    const afterAge = await confirmAgeForUser(user, fakeReq("203.0.113.50"));
    await check("stamps ageConfirmedAt + hashed IP (raw IP absent)", () => {
      assert.ok(afterAge.ageConfirmedAt);
      assert.equal(afterAge.ageConfirmedIpHash, sha256Hash("203.0.113.50"));
      assert.notEqual(afterAge.ageConfirmedIpHash, "203.0.113.50");
      assert.ok(!JSON.stringify(afterAge).includes("203.0.113.50"));
    });
    await check("age_confirmed audit row written with hashes, never raw", async () => {
      const rows = await db.authVerificationEvent.findMany({
        where: { userId: uid, type: "age_confirmed" },
      });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].ipHash, sha256Hash("203.0.113.50"));
      assert.equal(rows[0].userAgentHash, sha256Hash("test-agent/1.0"));
      assert.ok(!JSON.stringify(rows[0]).includes("203.0.113.50"));
    });
    const ageAgain = await confirmAgeForUser(afterAge, fakeReq("198.51.100.99"));
    await check("idempotent: repeat keeps timestamp/hash, no duplicate audit row", async () => {
      assert.equal(ageAgain.ageConfirmedAt!.getTime(), afterAge.ageConfirmedAt!.getTime());
      assert.equal(ageAgain.ageConfirmedIpHash, sha256Hash("203.0.113.50"));
      const rows = await db.authVerificationEvent.count({
        where: { userId: uid, type: "age_confirmed" },
      });
      assert.equal(rows, 1);
    });
    await check("gate: age step done -> /auth/legal next", () => {
      assert.equal(authNextStep(ageAgain, true), "/auth/legal");
    });

    console.log("legal consent (live)");
    const afterConsent = await acceptConsentForUser(ageAgain, fakeReq("203.0.113.51", "ua/2.0"));
    await check("stamps all three versions + timestamp + ip/ua hashes", () => {
      assert.equal(afterConsent.termsVersion, CURRENT_VERSIONS.terms);
      assert.equal(afterConsent.privacyVersion, CURRENT_VERSIONS.privacy);
      assert.equal(afterConsent.communityVersion, CURRENT_VERSIONS.community);
      assert.ok(afterConsent.consentAcceptedAt);
      assert.equal(afterConsent.consentIpHash, sha256Hash("203.0.113.51"));
      assert.equal(afterConsent.consentUserAgentHash, sha256Hash("ua/2.0"));
      assert.ok(!JSON.stringify(afterConsent).includes("203.0.113.51"));
      assert.ok(!JSON.stringify(afterConsent).includes("ua/2.0"));
    });
    const consentAgain = await acceptConsentForUser(afterConsent, fakeReq("198.51.100.99"));
    await check("idempotent while versions match: nothing rewritten, one audit row", async () => {
      assert.equal(
        consentAgain.consentAcceptedAt!.getTime(),
        afterConsent.consentAcceptedAt!.getTime(),
      );
      assert.equal(consentAgain.consentIpHash, sha256Hash("203.0.113.51"));
      const rows = await db.authVerificationEvent.count({
        where: { userId: uid, type: "terms_accepted" },
      });
      assert.equal(rows, 1);
    });
    await check("gate: consent done -> /onboarding next", () => {
      assert.equal(authNextStep(consentAgain, true), "/onboarding");
    });

    // Version bump simulation: the stored versions predate the current set.
    await db.user.update({
      where: { id: uid },
      data: { termsVersion: "2025-12", consentAcceptedAt: new Date(Date.now() - 86_400_000) },
    });
    const stale = (await db.user.findUniqueOrThrow({ where: { id: uid } }));
    await check("version bump: gate demands re-consent", () => {
      assert.equal(needsConsent(stale), true);
      assert.equal(authNextStep(stale, true), "/auth/legal");
    });
    const reconsented = await acceptConsentForUser(stale, fakeReq("203.0.113.52", "ua/3.0"));
    await check("re-consent re-stamps everything and writes a second audit row", async () => {
      assert.equal(reconsented.termsVersion, CURRENT_VERSIONS.terms);
      assert.ok(
        reconsented.consentAcceptedAt!.getTime() > stale.consentAcceptedAt!.getTime(),
      );
      assert.equal(reconsented.consentIpHash, sha256Hash("203.0.113.52"));
      assert.equal(reconsented.consentUserAgentHash, sha256Hash("ua/3.0"));
      const rows = await db.authVerificationEvent.count({
        where: { userId: uid, type: "terms_accepted" },
      });
      assert.equal(rows, 2);
    });
    await check("gate: fully consented user flows past age/legal", () => {
      assert.equal(authNextStep(reconsented, true), "/onboarding");
      assert.equal(authNextStep({ ...reconsented, onboardingDone: true }, true), "/discover");
    });
  } finally {
    await db.authVerificationEvent.deleteMany({
      where: { OR: [{ userId: uid }, { email: { contains: "age-consent-" } }] },
    });
    await db.user.deleteMany({
      where: { OR: [{ id: uid }, { email: { contains: "age-consent-" } }] },
    });
    await db.$disconnect();
  }

  console.log(`\n${passed} checks passed`);
}

main().catch((error) => {
  console.error("\nTEST FAILURE:", error);
  process.exit(1);
});
