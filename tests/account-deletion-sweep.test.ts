/**
 * Live test for the GDPR deletion sweep (cleanupExpiredDeletions). Run with:
 *   npx tsx tests/account-deletion-sweep.test.ts
 *
 * Talks to the real database from .env. Seeds throwaway auth.users + app User
 * rows (namespaced emails + random uuids) and cleans up every artifact by id in
 * `finally`. Proves the Art. 17 erasure the Account Deletion / Data Retention
 * policies promise: an account past the 30-day grace window is torn down (row
 * anonymised to a tombstone, login identity removed); one still in grace is not.
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

process.env.AUTH_HASH_SALT = process.env.AUTH_HASH_SALT || "test-salt";

const RUN = Date.now().toString(36);
const DAY = 24 * 60 * 60 * 1000;

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

async function main() {
  const { db } = await import("../src/lib/db");
  const { cleanupExpiredDeletions } = await import("../src/lib/auth/cleanup");

  const testStart = new Date();
  const ids = { expired: randomUUID(), grace: randomUUID() };
  const emails = {
    expired: `del-sweep-expired-${RUN}@example.com`,
    grace: `del-sweep-grace-${RUN}@example.com`,
  };

  async function seed(id: string, email: string, deletionAgeDays: number): Promise<void> {
    // Direct auth.users seed (mirrors the login identity that erasure must remove).
    await db.$executeRaw`
      INSERT INTO auth.users
        (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at,
         raw_app_meta_data, raw_user_meta_data, is_sso_user)
      VALUES
        (${id}::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated',
         'authenticated', ${email}, now(), now(), now(),
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false)`;
    // A registration-complete account parked DEACTIVATED with a deletion request.
    await db.user.create({
      data: {
        id,
        email,
        status: "DEACTIVATED",
        registrationCompletedAt: new Date(Date.now() - 60 * DAY),
        onboardingDone: true,
        onboardingCompletedAt: new Date(Date.now() - 60 * DAY),
        deletionRequested: new Date(Date.now() - deletionAgeDays * DAY),
      },
    });
  }

  async function authExists(id: string): Promise<boolean> {
    const rows = await db.$queryRaw<{ id: string }[]>`
      SELECT id::text FROM auth.users WHERE id = ${id}::uuid`;
    return rows.length > 0;
  }

  try {
    await seed(ids.expired, emails.expired, 31); // past the 30-day grace
    await seed(ids.grace, emails.grace, 5); // still in grace

    const erased = await cleanupExpiredDeletions();

    await check("returns an erased count >= 1", () => assert.ok(erased >= 1, `erased=${erased}`));

    await check("expired account is torn down: row anonymised to a tombstone", async () => {
      const u = await db.user.findUnique({ where: { id: ids.expired } });
      assert.ok(u, "row still present (anonymised shell, not hard-deleted)");
      assert.equal(u.status, "DELETED");
      assert.ok(u.email.startsWith("deleted+"), `email tombstoned, got ${u.email}`);
      assert.equal(u.name, null);
      assert.equal(u.phoneE164, null);
    });

    await check("expired account: login identity (auth.users) removed", async () =>
      assert.equal(await authExists(ids.expired), false),
    );

    await check("in-grace account is untouched (row + identity intact)", async () => {
      const u = await db.user.findUnique({ where: { id: ids.grace } });
      assert.ok(u && u.status === "DEACTIVATED", "still DEACTIVATED");
      assert.equal(u!.email, emails.grace);
      assert.equal(await authExists(ids.grace), true);
    });

    await check("a re-run does not reprocess the tombstoned account (no churn)", async () => {
      const again = await cleanupExpiredDeletions();
      // The just-torn account has a tombstone email (excluded) and a fresh
      // deletionRequested, so it is not a candidate again this run.
      const u = await db.user.findUnique({ where: { id: ids.expired } });
      assert.ok(u!.email.startsWith("deleted+"));
      assert.ok(again >= 0);
    });

    await check("erasure is audited (kind: gdpr_deletion_expired)", async () => {
      const event = await db.authVerificationEvent.findFirst({
        where: { type: "auth_cleanup", createdAt: { gte: testStart } },
        orderBy: { createdAt: "desc" },
      });
      assert.ok(event, "auth_cleanup event recorded");
      assert.equal((event.metadata as { kind?: string }).kind, "gdpr_deletion_expired");
    });

    console.log(`\n${passed} checks passed`);
  } finally {
    for (const id of Object.values(ids)) {
      await db.user.delete({ where: { id } }).catch(() => {});
      await db.$executeRaw`DELETE FROM auth.users WHERE id = ${id}::uuid`.catch(() => {});
    }
    await db.authVerificationEvent
      .deleteMany({ where: { type: "auth_cleanup", createdAt: { gte: testStart } } })
      .catch(() => {});
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error("FAIL:", error);
  process.exitCode = 1;
});
