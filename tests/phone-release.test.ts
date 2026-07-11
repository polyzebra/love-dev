/**
 * Live tests for the phone-release lifecycle: orphaned holders, the
 * supers-only releaseDeletedUserPhone service, and the dead-holder
 * auto-release in both phone flows. Run with:
 *   npx tsx tests/phone-release.test.ts
 *
 * Talks to the real database from .env. Users, seeded auth.users rows and
 * audit events are namespaced per run and removed in `finally`. SMS never
 * leaves the building (spy providers / spy auth clients only) and GoTrue
 * is never contacted (the admin sync is always injected).
 *
 * The matrix:
 *   1.  Orphan class A detection: app row whose auth.users identity is
 *       gone is releasable; live and DELETED classified correctly
 *   2.  Orphan class B detection: auth.users-only holder still answers
 *       duplicate_phone pre-provider (zero provider calls)
 *   3.  Safe release of a DELETED holder: phone columns cleared, row +
 *       email + prior audit rows preserved
 *   4.  Safe release of an auth-dead ACTIVE holder (the incident class)
 *       with newOwnerUserId: validated but NEVER attached
 *   5.  ACTIVE holder with a LIVE auth user -> holder_active abort,
 *       nothing changed
 *   6.  Typed aborts on every ambiguity: holder_mismatch,
 *       invalid_new_owner, concurrent_change, holder_not_found
 *   7.  Release never attaches: the released number reaches the new
 *       owner ONLY through the normal fresh-OTP flow
 *   8.  No duplicate users created; the actor's role is unchanged
 *   9.  Historical audit rows preserved + AdminLog/AuthVerificationEvent
 *       written (masked number only in AdminLog)
 *   10. teardownAccount leaves no phone ownership on EITHER store + audit
 *   11. Concurrent release: FOR UPDATE serializes - exactly one wins
 *   12. Authorization + flow policy: phones:release is supers-only and
 *       the route wires it; phone-change flow auto-releases an auth-dead
 *       holder and still 409s a live one; phone-login verify bridge
 *       auto-releases a dead owner into a fresh signup
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

process.env.AUTH_HASH_SALT = process.env.AUTH_HASH_SALT || "test-salt";

const RUN = Date.now().toString(36);
const testEmail = (tag: string) => `phone-release-${tag}-${RUN}@example.com`;

// Valid Irish mobiles reserved for THIS suite (+35386123480x/1x block -
// distinct from verification 450x, login 460x, sync 470x).
const NUMBERS = {
  orphanA: "+353861234801",
  orphanB: "+353861234802",
  deletedHolder: "+353861234803",
  authDead: "+353861234804",
  liveHolder: "+353861234805",
  aborts: "+353861234806",
  teardown: "+353861234807",
  concurrent: "+353861234808",
  flowAuto: "+353861234809",
  flowLive: "+353861234810",
  loginAuto: "+353861234811",
} as const;

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

async function main() {
  const { db } = await import("../src/lib/db");
  const { isReleasablePhoneHolder, teardownAccount } = await import("../src/lib/auth/identity");
  const {
    releaseDeletedUserPhone,
    PhoneReleaseError,
  } = await import("../src/lib/services/user-admin");
  const {
    sendPhoneVerification,
    confirmPhoneVerification,
    findAuthPhoneHolder,
    gotruePhone,
  } = await import("../src/lib/auth/phone-flow");
  const { verifyPhoneLoginCode } = await import("../src/lib/auth/phone-login-flow");
  const { hasPermission, PERMISSIONS } = await import("../src/lib/rbac");
  type Provider = import("../src/lib/auth/phone").PhoneVerificationProvider;
  type AuthClient = import("../src/lib/auth/phone-login-flow").PhoneLoginAuthClient;

  function spyProvider(verifyAnswer: "approved" | "incorrect" = "approved") {
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

  /** Spy AdminPhoneSyncClient - GoTrue is never contacted in this suite. */
  function adminSpy() {
    const calls: { uid: string; phone: string }[] = [];
    return {
      calls,
      client: {
        async updateUserById(uid: string, attrs: { phone: string; phone_confirm: boolean }) {
          calls.push({ uid, phone: attrs.phone });
          return { error: null };
        },
      },
    };
  }

  /** Spy phone-login auth client approving OTPs as the given uid. */
  function loginClient(verifyAs: string) {
    const calls: string[] = [];
    const client: AuthClient = {
      async signInWithOtp() {
        calls.push("signInWithOtp");
        return { error: null };
      },
      async verifyOtp({ phone }) {
        calls.push("verifyOtp");
        return { data: { user: { id: verifyAs, email: null, phone }, session: {} }, error: null };
      },
      async signOut() {
        calls.push("signOut");
        return { error: null };
      },
    };
    return { client, calls };
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
  async function createAppUser(
    tag: string,
    data: Record<string, unknown> = {},
  ): Promise<string> {
    const id = (data.id as string | undefined) ?? randomUUID();
    await db.user.create({
      data: { id, email: testEmail(tag), ...data } as never,
    });
    createdUserIds.push(id);
    return id;
  }

  /** Full verified-phone column set, as the verify transaction writes it. */
  function phoneColumns(phoneE164: string) {
    const now = new Date();
    return {
      phoneE164,
      phone: phoneE164,
      phoneVerified: now,
      phoneVerifiedAt: now,
      phoneCountryIso: "IE",
      phoneDialCode: "+353",
      phoneSyncStatus: "PENDING" as const,
      phoneSyncUpdatedAt: now,
    };
  }

  async function phoneFieldsOf(id: string) {
    return db.user.findUniqueOrThrow({
      where: { id },
      select: {
        phone: true,
        phoneVerified: true,
        phoneE164: true,
        phoneCountryIso: true,
        phoneDialCode: true,
        phoneVerifiedAt: true,
        phoneSyncStatus: true,
        phoneSyncErrorCode: true,
        phoneSyncUpdatedAt: true,
        status: true,
        email: true,
        role: true,
      },
    });
  }

  function assertPhoneCleared(row: Awaited<ReturnType<typeof phoneFieldsOf>>) {
    assert.equal(row.phone, null);
    assert.equal(row.phoneVerified, null);
    assert.equal(row.phoneE164, null);
    assert.equal(row.phoneCountryIso, null);
    assert.equal(row.phoneDialCode, null);
    assert.equal(row.phoneVerifiedAt, null);
    assert.equal(row.phoneSyncStatus, null);
    assert.equal(row.phoneSyncErrorCode, null);
    assert.equal(row.phoneSyncUpdatedAt, null);
  }

  const actorId = await createAppUser("actor", {
    role: "SUPER_ADMIN",
    emailVerified: new Date(),
  });

  try {
    // ------------------------------------------------------------ case 1
    console.log("1. orphan class A detection (app row without auth user)");
    await check("auth-dead ACTIVE holder is releasable; live is not; DELETED is", async () => {
      const orphan = await createAppUser("orphan-a", phoneColumns(NUMBERS.orphanA));
      assert.equal(
        await isReleasablePhoneHolder({ id: orphan, status: "ACTIVE" }),
        true,
        "auth-dead holder must be releasable",
      );
      const liveId = await createAppUser("live-a");
      await seedAuthUser({ id: liveId });
      assert.equal(
        await isReleasablePhoneHolder({ id: liveId, status: "ACTIVE" }),
        false,
        "live holder must NOT be releasable",
      );
      assert.equal(
        await isReleasablePhoneHolder({ id: liveId, status: "DELETED" }),
        true,
        "DELETED shell is releasable regardless of auth state",
      );
    });

    // ------------------------------------------------------------ case 2
    console.log("2. orphan class B detection (auth user without app row)");
    await check("auth-only phone holder -> duplicate_phone pre-provider", async () => {
      const authOnly = await seedAuthUser({ phoneE164: NUMBERS.orphanB });
      assert.equal(await findAuthPhoneHolder(NUMBERS.orphanB), authOnly);
      const claimant = await createAppUser("claimant-b");
      const { provider, calls } = spyProvider();
      const sync = adminSpy();
      const outcome = await confirmPhoneVerification({
        user: { id: claimant },
        phone: NUMBERS.orphanB,
        code: "123456",
        provider,
        adminSync: sync.client,
      });
      assert.equal(outcome.kind, "duplicate_phone");
      assert.equal(calls.length, 0, "provider must never run");
      assert.equal(sync.calls.length, 0, "admin sync must never run");
    });

    // ------------------------------------------------------------ case 3
    console.log("3. safe release of a DELETED holder");
    await check("phone columns cleared; row, email and audit rows preserved", async () => {
      const holder = await createAppUser("deleted-holder", {
        ...phoneColumns(NUMBERS.deletedHolder),
        status: "DELETED",
      });
      await db.authVerificationEvent.create({
        data: { type: "phone_otp_verify", userId: holder, phoneE164: NUMBERS.deletedHolder },
      });
      const result = await releaseDeletedUserPhone({
        phoneE164: NUMBERS.deletedHolder,
        expectedOldUserId: holder,
        reason: "test: deleted holder release",
        actorId,
      });
      assert.equal(result.oldOwnerId, holder);
      assert.equal(result.released, NUMBERS.deletedHolder);
      const row = await phoneFieldsOf(holder);
      assertPhoneCleared(row);
      assert.equal(row.status, "DELETED", "status untouched");
      assert.equal(row.email, testEmail("deleted-holder"), "email untouched");
      const historical = await db.authVerificationEvent.count({
        where: { userId: holder, type: "phone_otp_verify" },
      });
      assert.equal(historical, 1, "historical audit row preserved");
    });

    // ------------------------------------------------------------ case 4
    console.log("4. safe release of an auth-dead ACTIVE holder (incident class)");
    const incidentHolder = await createAppUser("auth-dead", phoneColumns(NUMBERS.authDead));
    const newOwner = await createAppUser("new-owner", { emailVerified: new Date() });
    await check("release succeeds; newOwner validated but NEVER attached", async () => {
      const result = await releaseDeletedUserPhone({
        phoneE164: NUMBERS.authDead,
        expectedOldUserId: incidentHolder,
        newOwnerUserId: newOwner,
        reason: "test: orphaned by account deletion",
        actorId,
      });
      assert.equal(result.newOwnerId, newOwner);
      assertPhoneCleared(await phoneFieldsOf(incidentHolder));
      const owner = await phoneFieldsOf(newOwner);
      assert.equal(owner.phoneE164, null, "release must NOT attach the number");
      assert.equal(owner.phoneVerifiedAt, null, "no verification may be minted");
    });

    // ------------------------------------------------------------ case 5
    console.log("5. ACTIVE holder with live auth user -> abort");
    await check("holder_active typed abort; nothing changed", async () => {
      const holder = await createAppUser("live-holder", phoneColumns(NUMBERS.liveHolder));
      await seedAuthUser({ id: holder });
      await assert.rejects(
        releaseDeletedUserPhone({
          phoneE164: NUMBERS.liveHolder,
          expectedOldUserId: holder,
          reason: "test: must abort",
          actorId,
        }),
        (error: unknown) =>
          error instanceof PhoneReleaseError && error.code === "holder_active",
      );
      const row = await phoneFieldsOf(holder);
      assert.equal(row.phoneE164, NUMBERS.liveHolder, "claim untouched");
      assert.ok(row.phoneVerifiedAt, "verification untouched");
    });

    // ------------------------------------------------------------ case 6
    console.log("6. typed aborts on every ambiguity");
    await check("holder_mismatch / invalid_new_owner / concurrent_change / holder_not_found", async () => {
      const holder = await createAppUser("aborts-holder", phoneColumns(NUMBERS.aborts));
      const stranger = await createAppUser("aborts-stranger");
      await assert.rejects(
        releaseDeletedUserPhone({
          phoneE164: NUMBERS.aborts,
          expectedOldUserId: stranger,
          reason: "test",
          actorId,
        }),
        (e: unknown) => e instanceof PhoneReleaseError && e.code === "holder_mismatch",
      );
      const unverified = await createAppUser("aborts-unverified"); // no emailVerified
      await assert.rejects(
        releaseDeletedUserPhone({
          phoneE164: NUMBERS.aborts,
          expectedOldUserId: holder,
          newOwnerUserId: unverified,
          reason: "test",
          actorId,
        }),
        (e: unknown) => e instanceof PhoneReleaseError && e.code === "invalid_new_owner",
      );
      await assert.rejects(
        releaseDeletedUserPhone({
          phoneE164: NUMBERS.aborts,
          expectedOldUserId: holder,
          newOwnerUserId: holder,
          reason: "test",
          actorId,
        }),
        (e: unknown) => e instanceof PhoneReleaseError && e.code === "invalid_new_owner",
      );
      // Holder exists but no longer carries the number -> concurrent_change.
      await db.user.update({
        where: { id: holder },
        data: { phoneE164: null, phone: null, phoneVerifiedAt: null, phoneVerified: null },
      });
      await assert.rejects(
        releaseDeletedUserPhone({
          phoneE164: NUMBERS.aborts,
          expectedOldUserId: holder,
          reason: "test",
          actorId,
        }),
        (e: unknown) => e instanceof PhoneReleaseError && e.code === "concurrent_change",
      );
      await assert.rejects(
        releaseDeletedUserPhone({
          phoneE164: NUMBERS.aborts,
          expectedOldUserId: randomUUID(),
          reason: "test",
          actorId,
        }),
        (e: unknown) => e instanceof PhoneReleaseError && e.code === "holder_not_found",
      );
      // The whole case wrote nothing: no release audit for this number.
      const releases = await db.authVerificationEvent.count({
        where: { phoneE164: NUMBERS.aborts, type: "admin_release_deleted_phone" },
      });
      assert.equal(releases, 0, "aborts must not audit as releases");
    });

    // ------------------------------------------------------------ case 7
    console.log("7. release never attaches - fresh OTP is the ONLY path in");
    await check("released number lands on the new owner only via send+verify", async () => {
      // Continues case 4: NUMBERS.authDead is free, newOwner holds nothing.
      const { provider, calls } = spyProvider();
      const sync = adminSpy();
      const sent = await sendPhoneVerification({
        user: { id: newOwner, bannedAt: null, status: "ACTIVE" },
        phone: NUMBERS.authDead,
        countryIso: "IE",
        provider,
      });
      assert.equal(sent.kind, "sent");
      const verified = await confirmPhoneVerification({
        user: { id: newOwner },
        phone: NUMBERS.authDead,
        code: "123456",
        countryIso: "IE",
        provider,
        adminSync: sync.client,
      });
      assert.equal(verified.kind, "verified");
      assert.deepEqual(
        calls.map((c) => c.method),
        ["send", "verify"],
        "a real OTP round-trip is mandatory",
      );
      const owner = await phoneFieldsOf(newOwner);
      assert.equal(owner.phoneE164, NUMBERS.authDead);
      assert.ok(owner.phoneVerifiedAt, "verified through the normal flow");
    });

    // ------------------------------------------------------------ case 8
    console.log("8. no duplicate users; actor role unchanged");
    await check("user count stable across a release; actor stays SUPER_ADMIN", async () => {
      const holder = await createAppUser("count-holder", {
        ...phoneColumns(NUMBERS.concurrent),
        status: "DELETED",
      });
      const before = await db.user.count();
      await releaseDeletedUserPhone({
        phoneE164: NUMBERS.concurrent,
        expectedOldUserId: holder,
        reason: "test: count stability",
        actorId,
      });
      assert.equal(await db.user.count(), before, "release must not create/delete users");
      const actor = await phoneFieldsOf(actorId);
      assert.equal(actor.role, "SUPER_ADMIN", "actor role untouched");
    });

    // ------------------------------------------------------------ case 9
    console.log("9. audit rows preserved + new ones written");
    await check("AdminLog admin.phone.release-deleted (masked) + auth event exist", async () => {
      // The releases above (cases 3, 4, 8) must each have produced a pair.
      const log = await db.adminLog.findFirst({
        where: { action: "admin.phone.release-deleted", targetId: incidentHolder },
        orderBy: { createdAt: "desc" },
      });
      assert.ok(log, "AdminLog row written");
      const meta = log.metadata as Record<string, unknown>;
      assert.equal(meta.oldOwner, incidentHolder);
      assert.equal(meta.newOwner, newOwner);
      assert.equal(meta.reason, "test: orphaned by account deletion");
      assert.ok(
        typeof meta.maskedPhone === "string" &&
          meta.maskedPhone.includes("•") &&
          !JSON.stringify(meta).includes(NUMBERS.authDead),
        "AdminLog carries the MASKED number only",
      );
      const ev = await db.authVerificationEvent.findFirst({
        where: { type: "admin_release_deleted_phone", userId: incidentHolder },
      });
      assert.ok(ev, "AuthVerificationEvent written on the old owner's timeline");
      // Pre-release history for the number is still there (case 4 wrote
      // nothing over it; the claim events from case 7 add to it).
      const history = await db.authVerificationEvent.count({
        where: { phoneE164: NUMBERS.authDead },
      });
      assert.ok(history >= 3, "historical + new audit rows all present");
    });

    // ------------------------------------------------------------ case 10
    console.log("10. teardown leaves no phone ownership on either store");
    await check("app columns NULL, auth.users.phone NULL, audit written", async () => {
      const id = randomUUID();
      await seedAuthUser({ id, phoneE164: NUMBERS.teardown });
      await createAppUser("teardown", { id, ...phoneColumns(NUMBERS.teardown) });
      await teardownAccount(id, "test: teardown frees the phone");
      const row = await phoneFieldsOf(id);
      assertPhoneCleared(row);
      assert.equal(row.status, "DELETED");
      assert.equal(
        await findAuthPhoneHolder(NUMBERS.teardown),
        null,
        "auth.users.phone must be cleared for the same uid",
      );
      const ev = await db.authVerificationEvent.findFirst({
        where: { type: "phone_released_on_teardown", userId: id },
      });
      assert.ok(ev, "teardown release audited");
      assert.equal((ev.metadata as Record<string, unknown>).authPhoneCleared, "cleared");
    });

    // ------------------------------------------------------------ case 11
    console.log("11. concurrent release - FOR UPDATE serializes");
    await check("exactly one of two concurrent releases wins", async () => {
      const holder = await createAppUser("concurrent", {
        ...phoneColumns(NUMBERS.flowLive), // reuse a fresh number for the lock test
        status: "DELETED",
      });
      const attempt = () =>
        releaseDeletedUserPhone({
          phoneE164: NUMBERS.flowLive,
          expectedOldUserId: holder,
          reason: "test: concurrency",
          actorId,
        });
      const results = await Promise.allSettled([attempt(), attempt()]);
      const wins = results.filter((r) => r.status === "fulfilled");
      const losses = results.filter(
        (r): r is PromiseRejectedResult => r.status === "rejected",
      );
      assert.equal(wins.length, 1, "exactly one winner");
      assert.equal(losses.length, 1, "exactly one loser");
      assert.ok(
        losses[0].reason instanceof PhoneReleaseError &&
          losses[0].reason.code === "concurrent_change",
        `loser must abort typed, got: ${String(losses[0].reason)}`,
      );
      assertPhoneCleared(await phoneFieldsOf(holder));
      // Free the number again for case 12b's live-holder test.
      await db.authVerificationEvent
        .deleteMany({ where: { phoneE164: NUMBERS.flowLive } })
        .catch(() => {});
    });

    // ------------------------------------------------------------ case 12
    console.log("12. authorization + flow policy");
    await check("phones:release is supers-only and the route enforces it", () => {
      assert.deepEqual([...PERMISSIONS["phones:release"]], ["SUPER_ADMIN"]);
      for (const role of ["USER", "MODERATOR", "ADMIN"] as const) {
        assert.equal(hasPermission(role, "phones:release"), false, `${role} must get 403`);
      }
      assert.equal(hasPermission("SUPER_ADMIN", "phones:release"), true);
      const route = readFileSync(
        path.join(
          __dirname,
          "../src/app/api/admin/users/[id]/release-deleted-phone/route.ts",
        ),
        "utf8",
      );
      assert.ok(
        route.includes('requirePermission("phones:release")'),
        "route must gate on phones:release",
      );
      // And the release service has NO attach path: it never writes a
      // phone value other than null.
      const service = readFileSync(
        path.join(__dirname, "../src/lib/services/user-admin.ts"),
        "utf8",
      );
      const fn = service.slice(service.indexOf("export async function releaseDeletedUserPhone"));
      const body = fn.slice(0, fn.indexOf("\n/**"));
      assert.equal((body.match(/\.update\(/g) ?? []).length, 1, "exactly one row update");
      assert.ok(body.includes("phoneE164: null"), "the single update clears the claim");
      assert.ok(!/phoneVerifiedAt:(?!\s*null)/.test(body), "no verification is ever minted");
    });

    await check("phone-change flow auto-releases an auth-dead holder", async () => {
      const deadHolder = await createAppUser("flow-dead", phoneColumns(NUMBERS.flowAuto));
      const claimant = await createAppUser("flow-claimant");
      const { provider, calls } = spyProvider();
      const sync = adminSpy();
      const sent = await sendPhoneVerification({
        user: { id: claimant, bannedAt: null, status: "ACTIVE" },
        phone: NUMBERS.flowAuto,
        countryIso: "IE",
        provider,
      });
      assert.equal(sent.kind, "sent", "dead holder must not block the send");
      const shell = await phoneFieldsOf(deadHolder);
      assert.equal(shell.status, "DELETED", "dead holder torn down");
      assertPhoneCleared(shell);
      const verified = await confirmPhoneVerification({
        user: { id: claimant },
        phone: NUMBERS.flowAuto,
        code: "123456",
        countryIso: "IE",
        provider,
        adminSync: sync.client,
      });
      assert.equal(verified.kind, "verified", "claim completes after auto-release");
      assert.equal(calls.filter((c) => c.method === "send").length, 1);
      const released = await db.authVerificationEvent.findFirst({
        where: { type: "phone_holder_auto_released", phoneE164: NUMBERS.flowAuto },
      });
      assert.ok(released, "auto-release audited");
    });

    await check("phone-change flow still 409s a LIVE holder", async () => {
      const liveHolder = await createAppUser("flow-live", phoneColumns(NUMBERS.flowLive));
      await seedAuthUser({ id: liveHolder });
      const claimant = await createAppUser("flow-live-claimant");
      const { provider, calls } = spyProvider();
      const outcome = await sendPhoneVerification({
        user: { id: claimant, bannedAt: null, status: "ACTIVE" },
        phone: NUMBERS.flowLive,
        countryIso: "IE",
        provider,
      });
      assert.equal(outcome.kind, "duplicate_phone");
      assert.equal(calls.length, 0, "live conflict never reaches the provider");
      const row = await phoneFieldsOf(liveHolder);
      assert.equal(row.phoneE164, NUMBERS.flowLive, "live holder untouched");
      assert.equal(row.status, "ACTIVE");
    });

    await check("phone-login verify bridge auto-releases a dead owner", async () => {
      const prevEnabled = process.env.PHONE_LOGIN_ENABLED;
      const prevCountries = process.env.PHONE_LOGIN_COUNTRIES;
      process.env.PHONE_LOGIN_ENABLED = "true";
      process.env.PHONE_LOGIN_COUNTRIES = "IE";
      try {
        const deadOwner = await createAppUser("login-dead", phoneColumns(NUMBERS.loginAuto));
        const newUid = randomUUID();
        createdUserIds.push(newUid);
        const { client, calls } = loginClient(newUid);
        const outcome = await verifyPhoneLoginCode({
          phone: NUMBERS.loginAuto,
          code: "123456",
          countryIso: "IE",
          client,
        });
        assert.equal(outcome.kind, "login", "dead owner must not conflict the login");
        assert.ok(outcome.kind === "login" && outcome.user.id === newUid);
        assert.ok(!calls.includes("signOut"), "session must stand");
        const shell = await phoneFieldsOf(deadOwner);
        assert.equal(shell.status, "DELETED", "dead owner torn down");
        assertPhoneCleared(shell);
        const fresh = await phoneFieldsOf(newUid);
        assert.equal(fresh.phoneE164, NUMBERS.loginAuto, "fresh signup owns the number");
      } finally {
        if (prevEnabled === undefined) delete process.env.PHONE_LOGIN_ENABLED;
        else process.env.PHONE_LOGIN_ENABLED = prevEnabled;
        if (prevCountries === undefined) delete process.env.PHONE_LOGIN_COUNTRIES;
        else process.env.PHONE_LOGIN_COUNTRIES = prevCountries;
      }
    });

    console.log(`\n${passed} checks passed`);
  } finally {
    await db.adminLog
      .deleteMany({ where: { actorId: { in: [actorId, ...createdUserIds] } } })
      .catch(() => {});
    await db.authVerificationEvent
      .deleteMany({
        where: {
          OR: [
            { phoneE164: { in: Object.values(NUMBERS) } },
            { userId: { in: createdUserIds } },
          ],
        },
      })
      .catch(() => {});
    await db.user
      .deleteMany({
        where: {
          OR: [{ id: { in: createdUserIds } }, { email: { contains: "phone-release-" } }],
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
