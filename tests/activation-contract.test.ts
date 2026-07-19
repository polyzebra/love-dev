/**
 * L7.3.9 - canonical activation contract (unit, no DB). Proves the single
 * activator NEVER silently activates against the rules. Only the REFUSAL
 * branches are exercised here (they return/throw before any audit or write),
 * so no database is touched; the success+audit path is verified in production.
 *
 *   npx tsx tests/activation-contract.test.ts
 */
import assert from "node:assert/strict";
import { activateAccountIfComplete, RegistrationStateViolation } from "@/lib/auth/identity";
import { CURRENT_VERSIONS as V } from "@/lib/auth/consent";

let passed = 0;
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

/** A completed-ladder row (all rungs done); override to walk back up. */
function row(o: Record<string, unknown> = {}) {
  return {
    id: "u1",
    status: "PENDING",
    bannedAt: null,
    email: "a@b.com",
    emailVerified: new Date(),
    phoneVerifiedAt: new Date(),
    ageConfirmedAt: new Date(),
    termsVersion: V.terms,
    privacyVersion: V.privacy,
    communityVersion: V.community,
    onboardingDone: true,
    onboardingCompletedAt: new Date(),
    registrationCompletedAt: null,
    ...o,
  };
}

/** Mock Prisma client that records update() calls and never hits a DB. */
function mockClient(r: Record<string, unknown>) {
  const updates: unknown[] = [];
  const client = {
    user: {
      findUnique: async () => r,
      update: async (args: unknown) => {
        updates.push(args);
        return r;
      },
    },
  } as never;
  return { client, updates };
}

async function main() {
  await check("throws when the user does not exist", async () => {
    const client = { user: { findUnique: async () => null } } as never;
    await assert.rejects(
      () => activateAccountIfComplete("missing", { client }),
      RegistrationStateViolation,
    );
  });

  await check("already-completed account is an idempotent no-op (no write)", async () => {
    const { client, updates } = mockClient(row({ registrationCompletedAt: new Date() }));
    const res = await activateAccountIfComplete("u1", { client });
    assert.equal(res.activated, false);
    assert.equal(res.reason, "already_active");
    assert.equal(updates.length, 0);
  });

  await check("incomplete ladder without force never activates (no write)", async () => {
    const { client, updates } = mockClient(row({ onboardingDone: false }));
    const res = await activateAccountIfComplete("u1", { client });
    assert.equal(res.activated, false);
    assert.equal(res.reason, "incomplete");
    assert.equal(updates.length, 0);
  });

  await check("suspended/banned account is never activated (no write)", async () => {
    for (const restricted of [{ status: "SUSPENDED" }, { bannedAt: new Date() }]) {
      const { client, updates } = mockClient(row(restricted));
      const res = await activateAccountIfComplete("u1", { client });
      assert.equal(res.activated, false);
      assert.equal(res.reason, "restricted");
      assert.equal(updates.length, 0);
    }
  });

  await check("force-activating a suspended/banned account throws (no write)", async () => {
    const { client, updates } = mockClient(row({ status: "SUSPENDED", onboardingDone: false }));
    await assert.rejects(
      () => activateAccountIfComplete("u1", { client, force: { actorId: "admin1", reason: "x" } }),
      RegistrationStateViolation,
    );
    assert.equal(updates.length, 0);
  });

  await check("force without actor+reason throws (no write)", async () => {
    const { client, updates } = mockClient(row({ onboardingDone: false }));
    await assert.rejects(
      () => activateAccountIfComplete("u1", { client, force: { actorId: "", reason: "" } }),
      RegistrationStateViolation,
    );
    assert.equal(updates.length, 0);
  });

  console.log(`\n${passed} checks passed`);
}

main();
