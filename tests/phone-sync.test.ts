/**
 * Live tests for the auth.users.phone mirror (admin-client sync +
 * reconciliation). Run with:
 *   npx tsx tests/phone-sync.test.ts
 *
 * Talks to the real database from .env. Users, seeded auth.users rows and
 * audit events are namespaced per run and removed in `finally`. SMS never
 * leaves the building (spy providers only) and GoTrue is only contacted
 * when SUPABASE_SERVICE_ROLE_KEY is present - in that case the REAL sync
 * is proven against a throwaway auth user and verified via SQL; when the
 * key is absent the durable FAILED path + reconciliation repair are
 * asserted instead (and the real-sync case logs "skipped").
 *
 * The matrix:
 *   1. Normalization matrix (IE/GB/LV/US + invalids) + GoTrue phone form
 *   2. Approval updates the CORRECT user only; every app field set;
 *      updateUserById(uid, {phone, phone_confirm:true}) exactly once ->
 *      SYNCED + authCompleted
 *   3. phone_confirm only after approval: wrong code -> zero admin calls,
 *      nothing written
 *   4. Number attached to a DIFFERENT auth.users row -> neutral 409
 *      (duplicate_phone) pre-provider
 *   5. Key absent -> durable FAILED ("service_key_missing"), claim kept,
 *      authCompleted false; reconciliation (injected client) repairs it
 *   6. Reconciliation heals a stale FAILED whose auth row already matches
 *      (consistent - zero admin calls)
 *   7. Conflict quarantine: rival auth row holds the number -> FAILED
 *      "auth_phone_conflict", NO auto-fix; auth-only numbers reported
 *   8. App row without ANY auth identity -> quarantine "auth_user_missing"
 *   9. Phone change keeps the OLD number until approval
 *  10. Idempotent re-approval: already_verified, zero provider/admin
 *      calls, no duplicate audit rows
 *  11. REAL sync (only when SUPABASE_SERVICE_ROLE_KEY present): throwaway
 *      auth user, live updateUserById, auth.users.phone checked via SQL
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

process.env.AUTH_HASH_SALT = process.env.AUTH_HASH_SALT || "test-salt";

const RUN = Date.now().toString(36);
const testEmail = (tag: string) => `phone-sync-${tag}-${RUN}@example.com`;

// Valid Irish mobiles reserved for THIS suite (+35386123470x block -
// distinct from phone-verification's 450x and phone-login's 460x).
const NUMBERS = {
  correct: "+353861234701",
  wrongCode: "+353861234702",
  authDupe: "+353861234703",
  failedPath: "+353861234704",
  consistent: "+353861234705",
  conflict: "+353861234706",
  orphan: "+353861234707",
  change1: "+353861234708",
  change2: "+353861234709",
  real: "+353861234710",
} as const;

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

async function main() {
  const { db } = await import("../src/lib/db");
  const {
    normalizePhone,
    gotruePhone,
    sendPhoneVerification,
    confirmPhoneVerification,
    serviceRoleKeyPresent,
  } = await import("../src/lib/auth/phone-flow");
  const { reconcilePhoneSync } = await import("../src/lib/services/phone-reconcile");
  type Provider = import("../src/lib/auth/phone").PhoneVerificationProvider;
  type Check = import("../src/lib/auth/phone").PhoneVerifyCheck;

  function spyProvider(verifyAnswer: Check = "approved") {
    const calls: { method: "send" | "verify"; phoneE164: string }[] = [];
    const provider: Provider = {
      async sendCode(phoneE164) {
        calls.push({ method: "send", phoneE164 });
      },
      async verifyCode(phoneE164) {
        calls.push({ method: "verify", phoneE164 });
        return verifyAnswer;
      },
    };
    return { provider, calls };
  }

  /** Spy admin client - the structural AdminPhoneSyncClient tests inject. */
  function adminSpy(fail = false) {
    const calls: { uid: string; phone: string; phone_confirm: boolean }[] = [];
    return {
      calls,
      client: {
        async updateUserById(uid: string, attrs: { phone: string; phone_confirm: boolean }) {
          calls.push({ uid, ...attrs });
          return fail ? { error: { code: "unexpected_failure", message: "boom" } } : { error: null };
        },
      },
    };
  }

  const seededAuthIds: string[] = [];
  /** Seed a throwaway auth.users row (optionally phone-keyed) via SQL. */
  async function seedAuthUser(opts: { id?: string; phoneE164?: string }): Promise<string> {
    const id = opts.id ?? randomUUID();
    const bare = opts.phoneE164 ? gotruePhone(opts.phoneE164) : null;
    await db.$executeRaw`
      INSERT INTO auth.users
        (id, instance_id, aud, role, phone, phone_confirmed_at, created_at, updated_at)
      VALUES
        (${id}::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated',
         'authenticated', ${bare}, ${bare ? new Date() : null}, NOW(), NOW())`;
    seededAuthIds.push(id);
    return id;
  }

  const createdUserIds: string[] = [];
  async function createAppUser(tag: string): Promise<string> {
    const id = randomUUID();
    await db.user.create({ data: { id, email: testEmail(tag) } });
    createdUserIds.push(id);
    return id;
  }

  try {
    // ------------------------------------------------------------ case 1
    console.log("1. normalization matrix + GoTrue phone form");
    await check("IE/GB/LV/US inputs normalize to canonical E.164", () => {
      const matrix: [string, string | undefined, string, string, string][] = [
        ["0868672333", "IE", "+353868672333", "IE", "+353"],
        ["+353868672333", undefined, "+353868672333", "IE", "+353"],
        // 7400 is a GB-proper mobile range (7911 maps to Guernsey).
        ["07400 123456", "GB", "+447400123456", "GB", "+44"],
        ["26123456", "LV", "+37126123456", "LV", "+371"],
        ["(415) 555-2671", "US", "+14155552671", "US", "+1"],
      ];
      for (const [input, iso, e164, country, dial] of matrix) {
        const n = normalizePhone(input, iso);
        assert.ok(n.ok, `${input} (${iso ?? "-"}) should normalize`);
        assert.equal(n.phoneE164, e164);
        assert.equal(n.countryIso, country);
        assert.equal(n.dialCode, dial);
      }
    });
    await check("invalid / bogus-region input rejected", () => {
      for (const [input, iso] of [
        ["12345", "IE"],
        ["+999123456789", undefined],
        ["0868672333", "XX"],
      ] as const) {
        const n = normalizePhone(input, iso);
        assert.equal(n.ok, false, `${input} (${iso ?? "-"}) must be rejected`);
      }
    });
    await check("GoTrue stores the number WITHOUT the leading '+'", () => {
      assert.equal(gotruePhone("+353868672333"), "353868672333");
      assert.equal(gotruePhone("353868672333"), "353868672333");
    });

    // ------------------------------------------------------------ case 2
    console.log("2. approval -> correct user, all fields, SYNCED via admin client");
    const userA = await createAppUser("a");
    const userB = await createAppUser("b");
    await check("updateUserById(uid, {phone, phone_confirm:true}) once; all fields stamped", async () => {
      const sync = adminSpy();
      const outcome = await confirmPhoneVerification({
        user: { id: userA },
        phone: NUMBERS.correct,
        code: "123456",
        provider: spyProvider("approved").provider,
        adminSync: sync.client,
      });
      assert.equal(outcome.kind, "verified");
      assert.deepEqual(sync.calls, [
        { uid: userA, phone: NUMBERS.correct, phone_confirm: true },
      ]);
      const a = await db.user.findUniqueOrThrow({ where: { id: userA } });
      assert.equal(a.phoneE164, NUMBERS.correct);
      assert.equal(a.phone, NUMBERS.correct);
      assert.equal(a.phoneCountryIso, "IE");
      assert.equal(a.phoneDialCode, "+353");
      assert.ok(a.phoneVerifiedAt);
      assert.equal(a.phoneSyncStatus, "SYNCED");
      assert.equal(a.phoneSyncErrorCode, null);
      assert.ok(a.phoneSyncUpdatedAt);
      assert.equal(a.authCompleted, true);
    });
    await check("the OTHER user's row is untouched", async () => {
      const b = await db.user.findUniqueOrThrow({ where: { id: userB } });
      assert.equal(b.phoneE164, null);
      assert.equal(b.phoneVerifiedAt, null);
      assert.equal(b.phoneSyncStatus, null);
    });

    // ------------------------------------------------------------ case 3
    console.log("3. phone_confirm only after approval");
    await check("wrong code -> zero admin calls, nothing written", async () => {
      const sync = adminSpy();
      const outcome = await confirmPhoneVerification({
        user: { id: userB },
        phone: NUMBERS.wrongCode,
        code: "999999",
        provider: spyProvider("incorrect").provider,
        adminSync: sync.client,
      });
      assert.equal(outcome.kind, "incorrect");
      assert.equal(sync.calls.length, 0, "admin client must never run pre-approval");
      const b = await db.user.findUniqueOrThrow({ where: { id: userB } });
      assert.equal(b.phoneE164, null);
      assert.equal(b.phoneSyncStatus, null);
    });

    // ------------------------------------------------------------ case 4
    console.log("4. number held by a DIFFERENT auth.users row -> neutral 409");
    await check("duplicate_phone pre-provider, holder = the auth uid", async () => {
      const rival = await seedAuthUser({ phoneE164: NUMBERS.authDupe });
      const provider = spyProvider("approved");
      const sync = adminSpy();
      const outcome = await confirmPhoneVerification({
        user: { id: userB },
        phone: NUMBERS.authDupe,
        code: "123456",
        provider: provider.provider,
        adminSync: sync.client,
      });
      assert.equal(outcome.kind, "duplicate_phone");
      assert.ok(outcome.kind === "duplicate_phone" && outcome.holderId === rival);
      assert.equal(provider.calls.length, 0, "provider never reached");
      assert.equal(sync.calls.length, 0);
      const b = await db.user.findUniqueOrThrow({ where: { id: userB } });
      assert.equal(b.phoneE164, null, "nothing claimed");
    });

    // ------------------------------------------------------------ case 5
    console.log("5. key-absent FAILED path + reconciliation repair");
    const userC = await createAppUser("c");
    if (serviceRoleKeyPresent()) {
      console.log("  (skipped FAILED-by-missing-key assertions - key IS present)");
    } else {
      await check("no client + no key -> verified, durable FAILED, claim kept", async () => {
        const outcome = await confirmPhoneVerification({
          user: { id: userC },
          phone: NUMBERS.failedPath,
          code: "123456",
          provider: spyProvider("approved").provider,
          // no adminSync injected - the real resolution path runs
        });
        assert.equal(outcome.kind, "verified", "user flow never thrown away");
        const c = await db.user.findUniqueOrThrow({ where: { id: userC } });
        assert.equal(c.phoneE164, NUMBERS.failedPath);
        assert.ok(c.phoneVerifiedAt, "business verification true");
        assert.equal(c.phoneSyncStatus, "FAILED");
        assert.equal(c.phoneSyncErrorCode, "service_key_missing");
        assert.equal(c.authCompleted, false, "authCompleted waits for SYNCED");
        const failedAudit = await db.authVerificationEvent.findFirst({
          where: { type: "phone_auth_sync_failed", userId: userC },
        });
        assert.ok(failedAudit, "failure audited");
      });
      await check("reconciliation without key/client -> configured:false, untouched", async () => {
        const report = await reconcilePhoneSync({ onlyUserIds: [userC] });
        assert.equal(report.configured, false);
        assert.equal(report.scanned, 0);
        const c = await db.user.findUniqueOrThrow({ where: { id: userC } });
        assert.equal(c.phoneSyncStatus, "FAILED");
      });
      await check("reconciliation (injected client) repairs the FAILED row", async () => {
        await seedAuthUser({ id: userC }); // same-uid auth identity, no phone yet
        const sync = adminSpy();
        const report = await reconcilePhoneSync({
          client: sync.client,
          onlyUserIds: [userC],
        });
        assert.equal(report.configured, true);
        assert.deepEqual(report.repaired, [{ userId: userC, phoneE164: NUMBERS.failedPath }]);
        assert.deepEqual(sync.calls, [
          { uid: userC, phone: NUMBERS.failedPath, phone_confirm: true },
        ]);
        const c = await db.user.findUniqueOrThrow({ where: { id: userC } });
        assert.equal(c.phoneSyncStatus, "SYNCED");
        assert.equal(c.authCompleted, true);
      });
    }

    // ------------------------------------------------------------ case 6
    console.log("6. reconciliation heals a stale FAILED that is already consistent");
    const userD = await createAppUser("d");
    await check("auth row already matches -> consistent, zero admin calls", async () => {
      const failing = adminSpy(true);
      await confirmPhoneVerification({
        user: { id: userD },
        phone: NUMBERS.consistent,
        code: "123456",
        provider: spyProvider("approved").provider,
        adminSync: failing.client,
      });
      // Simulate the mirror having landed anyway (e.g. fixed out-of-band).
      await seedAuthUser({ id: userD, phoneE164: NUMBERS.consistent });
      const sync = adminSpy();
      const report = await reconcilePhoneSync({ client: sync.client, onlyUserIds: [userD] });
      assert.equal(report.consistent, 1);
      assert.equal(sync.calls.length, 0, "consistent rows are never rewritten");
      const d = await db.user.findUniqueOrThrow({ where: { id: userD } });
      assert.equal(d.phoneSyncStatus, "SYNCED", "stale FAILED healed to the truth");
      assert.equal(d.authCompleted, true);
    });

    // ------------------------------------------------------------ case 7
    console.log("7. conflict quarantine + auth-only report");
    const userE = await createAppUser("e");
    await check("rival auth row -> FAILED auth_phone_conflict, no auto-fix", async () => {
      await confirmPhoneVerification({
        user: { id: userE },
        phone: NUMBERS.conflict,
        code: "123456",
        provider: spyProvider("approved").provider,
        adminSync: adminSpy(true).client, // leave it FAILED
      });
      await seedAuthUser({ id: userE }); // E's own identity, no phone
      const rival = await seedAuthUser({ phoneE164: NUMBERS.conflict }); // split brain
      const sync = adminSpy();
      const report = await reconcilePhoneSync({ client: sync.client, onlyUserIds: [userE] });
      assert.equal(report.conflicts.length, 1);
      assert.equal(report.conflicts[0].userId, userE);
      assert.equal(report.conflicts[0].reason, "auth_phone_conflict");
      assert.equal(report.conflicts[0].authHolderId, rival);
      assert.equal(sync.calls.length, 0, "conflicts are never auto-fixed");
      const e = await db.user.findUniqueOrThrow({ where: { id: userE } });
      assert.equal(e.phoneSyncStatus, "FAILED");
      assert.equal(e.phoneSyncErrorCode, "auth_phone_conflict");
      assert.ok(e.phoneVerifiedAt, "app claim untouched");
    });
    await check("auth-only numbers are reported, never auto-cleared", async () => {
      const orphanUid = await seedAuthUser({ phoneE164: NUMBERS.orphan });
      const report = await reconcilePhoneSync({ client: adminSpy().client, onlyUserIds: [] });
      const entry = report.authOnly.find((r) => r.authUserId === orphanUid);
      assert.ok(entry, "auth-only phone reported");
      assert.equal(entry!.phone, gotruePhone(NUMBERS.orphan));
      const stillThere = await db.$queryRaw<{ phone: string | null }[]>`
        SELECT phone FROM auth.users WHERE id = ${orphanUid}::uuid`;
      assert.equal(stillThere[0].phone, gotruePhone(NUMBERS.orphan));
    });

    // ------------------------------------------------------------ case 8
    console.log("8. app claim without ANY auth identity -> quarantine");
    const userF = await createAppUser("f");
    await check("auth_user_missing reported, stamped FAILED", async () => {
      await confirmPhoneVerification({
        user: { id: userF },
        phone: "+353861234711",
        code: "123456",
        provider: spyProvider("approved").provider,
        adminSync: adminSpy(true).client,
      });
      const report = await reconcilePhoneSync({ client: adminSpy().client, onlyUserIds: [userF] });
      assert.equal(report.conflicts.length, 1);
      assert.equal(report.conflicts[0].reason, "auth_user_missing");
      const f = await db.user.findUniqueOrThrow({ where: { id: userF } });
      assert.equal(f.phoneSyncErrorCode, "auth_user_missing");
    });

    // ------------------------------------------------------------ case 9
    console.log("9. phone change keeps the old number until approval");
    const userG = await createAppUser("g");
    await check("old number stays through send + wrong code; approval swaps it", async () => {
      const ok = adminSpy();
      await confirmPhoneVerification({
        user: { id: userG },
        phone: NUMBERS.change1,
        code: "123456",
        provider: spyProvider("approved").provider,
        adminSync: ok.client,
      });
      const sent = await sendPhoneVerification({
        user: { id: userG, bannedAt: null, status: "ACTIVE" },
        phone: NUMBERS.change2,
        provider: spyProvider().provider,
      });
      assert.equal(sent.kind, "sent");
      let g = await db.user.findUniqueOrThrow({ where: { id: userG } });
      assert.equal(g.phoneE164, NUMBERS.change1, "send never writes the claim");
      const wrong = await confirmPhoneVerification({
        user: { id: userG },
        phone: NUMBERS.change2,
        code: "000000",
        provider: spyProvider("incorrect").provider,
        adminSync: ok.client,
      });
      assert.equal(wrong.kind, "incorrect");
      g = await db.user.findUniqueOrThrow({ where: { id: userG } });
      assert.equal(g.phoneE164, NUMBERS.change1, "wrong code keeps the old number");
      const approved = await confirmPhoneVerification({
        user: { id: userG },
        phone: NUMBERS.change2,
        code: "123456",
        provider: spyProvider("approved").provider,
        adminSync: ok.client,
      });
      assert.equal(approved.kind, "verified");
      g = await db.user.findUniqueOrThrow({ where: { id: userG } });
      assert.equal(g.phoneE164, NUMBERS.change2, "approval commits the new number");
      assert.equal(g.phoneSyncStatus, "SYNCED");
    });

    // ----------------------------------------------------------- case 10
    console.log("10. idempotent re-approval - no dup audits, zero calls");
    await check("already_verified; provider + admin untouched; audit counts stable", async () => {
      const before = {
        verify: await db.authVerificationEvent.count({
          where: { type: "phone_otp_verify", phoneE164: NUMBERS.change2 },
        }),
        sync: await db.authVerificationEvent.count({
          where: { type: "phone_auth_sync", phoneE164: NUMBERS.change2 },
        }),
      };
      const provider = spyProvider("approved");
      const sync = adminSpy();
      const outcome = await confirmPhoneVerification({
        user: { id: userG },
        phone: NUMBERS.change2,
        code: "123456",
        provider: provider.provider,
        adminSync: sync.client,
      });
      assert.equal(outcome.kind, "already_verified");
      assert.equal(provider.calls.length, 0, "no provider call on re-approval");
      assert.equal(sync.calls.length, 0, "SYNCED state short-circuits the sync");
      const after = {
        verify: await db.authVerificationEvent.count({
          where: { type: "phone_otp_verify", phoneE164: NUMBERS.change2 },
        }),
        sync: await db.authVerificationEvent.count({
          where: { type: "phone_auth_sync", phoneE164: NUMBERS.change2 },
        }),
      };
      assert.deepEqual(after, before, "no duplicate audit rows");
    });

    // ----------------------------------------------------------- case 11
    console.log("11. REAL auth.users sync (service-role key)");
    if (!serviceRoleKeyPresent()) {
      console.log("  skipped - SUPABASE_SERVICE_ROLE_KEY absent (FAILED path proven in case 5)");
    } else {
      await check("live updateUserById writes auth.users.phone (SQL-verified)", async () => {
        const { createClient } = await import("@supabase/supabase-js");
        const admin = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { autoRefreshToken: false, persistSession: false } },
        );
        const created = await admin.auth.admin.createUser({
          email: testEmail("real-auth"),
          email_confirm: true,
        });
        assert.ok(created.data.user, `throwaway auth user created: ${created.error?.message}`);
        const uid = created.data.user!.id;
        try {
          await db.user.create({ data: { id: uid, email: testEmail("real-app") } });
          createdUserIds.push(uid);
          const outcome = await confirmPhoneVerification({
            user: { id: uid },
            phone: NUMBERS.real,
            code: "123456",
            provider: spyProvider("approved").provider,
            adminSync: admin.auth.admin,
          });
          assert.equal(outcome.kind, "verified");
          const rows = await db.$queryRaw<{ phone: string | null; confirmed: Date | null }[]>`
            SELECT phone, phone_confirmed_at AS confirmed FROM auth.users WHERE id = ${uid}::uuid`;
          assert.equal(rows[0].phone, gotruePhone(NUMBERS.real), "auth.users.phone = E.164 sans '+'");
          assert.ok(rows[0].confirmed, "phone_confirmed_at stamped");
          const row = await db.user.findUniqueOrThrow({ where: { id: uid } });
          assert.equal(row.phoneSyncStatus, "SYNCED");
        } finally {
          await admin.auth.admin.deleteUser(uid).catch(() => {});
        }
      });
    }

    console.log(`\n${passed} checks passed`);
  } finally {
    await db.user.deleteMany({ where: { email: { contains: "phone-sync-" } } }).catch(() => {});
    await db.authVerificationEvent
      .deleteMany({
        where: {
          OR: [
            { phoneE164: { in: [...Object.values(NUMBERS), "+353861234711"] } },
            { userId: { in: createdUserIds } },
          ],
        },
      })
      .catch(() => {});
    for (const id of seededAuthIds) {
      await db.$executeRaw`DELETE FROM auth.users WHERE id = ${id}::uuid`.catch(() => {});
    }
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error("\nTEST FAILURE:", error);
  process.exit(1);
});
