/**
 * Live tests for anonymous phone LOGIN (phone-login-flow service) and the
 * auth.users.phone backfill hook in the phone-change flow. Run with:
 *   npx tsx tests/phone-login.test.ts
 *
 * Talks to the real database from .env. Users, auth.users rows and audit
 * events are namespaced per run and removed in `finally`. No SMS and no
 * live GoTrue call ever happens: every case injects a fake/spy auth
 * client for the native-OTP calls.
 *
 * The matrix:
 *   1.  Flag off -> send AND verify answer not_available (route: 503
 *       PHONE_LOGIN_NOT_AVAILABLE), zero client calls
 *   2.  Country narrowing (PHONE_LOGIN_COUNTRIES=IE,GB set explicitly -
 *       the default is now the FULL dataset): US number rejected;
 *       invalid input rejected - all pre-client
 *   3.  Send happy path (client called once, audit auth_phone_code_sent)
 *       + immediate resend -> resend_too_soon
 *   4.  EXISTING-OWNER BRIDGE at send: app-owned number with no matching
 *       auth.users mapping -> identity_conflict, zero client calls, no SMS
 *   5.  EXISTING-OWNER BRIDGE at verify: OTP approves under a NEW uid ->
 *       identity_conflict, session signed OUT, no second app row, owner
 *       untouched, audit auth_login_failed
 *   6.  uid-match (backfilled world; auth.users row seeded with the phone)
 *       -> login into the canonical account, no new row, gate skips
 *       onboarding (-> /discover)
 *   7.  New phone: wrong code creates NOTHING; approved code creates the
 *       account with phoneE164 + phoneVerifiedAt stamped; gate continues
 *       past email/phone rungs
 *   8.  Wrong/expired code outcomes + failure lock after 5 fails
 *   9.  Concurrent new-phone first login -> exactly one row (P2002 adopt)
 *   10. Phone-change verify still works AND attempts the guarded
 *       auth.users.phone sync (spy asserted; failure never blocks the
 *       claim; flag off -> no attempt)
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

process.env.AUTH_HASH_SALT = process.env.AUTH_HASH_SALT || "test-salt";

const RUN = Date.now().toString(36);
const testEmail = (tag: string) => `phone-login-${tag}-${RUN}@example.com`;

// Valid Irish mobiles reserved for THIS suite (distinct from the
// phone-verification suite's +35386123450x block).
const NUMBERS = {
  flagOff: "+353861234601",
  send: "+353861234602",
  ownerBridge: "+353861234603",
  uidMatch: "+353861234604",
  fresh: "+353861234605",
  codes: "+353861234606",
  race: "+353861234607",
  sync: "+353861234608",
  us: "+12025550123",
} as const;

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

async function main() {
  const { db } = await import("../src/lib/db");
  const { sendPhoneLoginCode, verifyPhoneLoginCode } = await import(
    "../src/lib/auth/phone-login-flow"
  );
  const { confirmPhoneVerification } = await import("../src/lib/auth/phone-flow");
  const { authNextStep } = await import("../src/lib/auth/gate");
  const { CURRENT_VERSIONS } = await import("../src/lib/auth/consent");
  type AuthClient = import("../src/lib/auth/phone-login-flow").PhoneLoginAuthClient;

  /**
   * Spy auth client. `verifyAs` controls verifyOtp: a uid = approved
   * session under that uid; an error code string = failure.
   */
  function spyClient(opts?: { verifyAs?: string; verifyError?: string; sendError?: string }) {
    const calls: { method: "signInWithOtp" | "verifyOtp" | "signOut"; phone?: string }[] = [];
    const client: AuthClient = {
      async signInWithOtp({ phone }) {
        calls.push({ method: "signInWithOtp", phone });
        return {
          error: opts?.sendError ? { code: opts.sendError, message: opts.sendError } : null,
        };
      },
      async verifyOtp({ phone }) {
        calls.push({ method: "verifyOtp", phone });
        if (opts?.verifyError) {
          return {
            data: { user: null, session: null },
            error: { code: opts.verifyError, message: opts.verifyError },
          };
        }
        return {
          data: {
            user: { id: opts?.verifyAs ?? randomUUID(), email: null, phone },
            session: {},
          },
          error: null,
        };
      },
      async signOut() {
        calls.push({ method: "signOut" });
        return { error: null };
      },
    };
    return { client, calls };
  }

  const seededAuthIds: string[] = [];
  /** Seed a throwaway auth.users row (optionally phone-keyed) via SQL. */
  async function seedAuthUser(opts: { email?: string; phoneE164?: string }): Promise<string> {
    const id = randomUUID();
    const bare = opts.phoneE164?.replace(/^\+/, "") ?? null;
    await db.$executeRaw`
      INSERT INTO auth.users
        (id, instance_id, aud, role, email, phone, phone_confirmed_at, created_at, updated_at,
         raw_app_meta_data, raw_user_meta_data, is_sso_user)
      VALUES
        (${id}::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated',
         'authenticated', ${opts.email ?? null}, ${bare},
         ${bare ? new Date() : null},
         now(), now(),
         '{"provider":"phone","providers":["phone"]}'::jsonb, '{}'::jsonb, false)`;
    seededAuthIds.push(id);
    return id;
  }

  const createdUserIds: string[] = [];
  async function createAppUser(data: Record<string, unknown>): Promise<string> {
    const id = (data.id as string | undefined) ?? randomUUID();
    await db.user.create({ data: { id, ...data, email: data.email as string } as never });
    createdUserIds.push(id);
    return id;
  }

  // Explicit narrowing for case 2's US rejection - with every country
  // env unset the default is now the FULL dataset (US would be accepted;
  // tests/phone-countries.test.ts covers that side).
  process.env.PHONE_LOGIN_COUNTRIES = "IE,GB";
  delete process.env.SUPPORTED_PHONE_COUNTRIES;

  try {
    // ------------------------------------------------------------ case 1
    console.log("1. feature flag off");
    process.env.PHONE_LOGIN_ENABLED = "false";
    await check("send + verify -> not_available, zero client calls", async () => {
      const spy = spyClient();
      const sent = await sendPhoneLoginCode({ phone: NUMBERS.flagOff, client: spy.client });
      assert.equal(sent.kind, "not_available");
      const verified = await verifyPhoneLoginCode({
        phone: NUMBERS.flagOff,
        code: "123456",
        client: spy.client,
      });
      assert.equal(verified.kind, "not_available");
      assert.equal(spy.calls.length, 0, "client must never be reached with the flag off");
    });

    process.env.PHONE_LOGIN_ENABLED = "true";

    // ------------------------------------------------------------ case 2
    console.log("2. country allowlist + invalid input (pre-client)");
    await check("US number -> unsupported_country; garbage -> invalid_phone", async () => {
      const spy = spyClient();
      const us = await sendPhoneLoginCode({ phone: NUMBERS.us, client: spy.client });
      assert.equal(us.kind, "unsupported_country");
      const usVerify = await verifyPhoneLoginCode({
        phone: NUMBERS.us,
        code: "123456",
        client: spy.client,
      });
      assert.equal(usVerify.kind, "unsupported_country");
      const garbage = await sendPhoneLoginCode({
        phone: "12345",
        countryIso: "IE",
        client: spy.client,
      });
      assert.equal(garbage.kind, "invalid_phone");
      assert.equal(spy.calls.length, 0, "client must never be reached");
    });

    // ------------------------------------------------------------ case 3
    console.log("3. send happy path + resend cooldown");
    await check("sent (client called once, audited), immediate resend -> resend_too_soon", async () => {
      const spy = spyClient();
      const sent = await sendPhoneLoginCode({ phone: NUMBERS.send, client: spy.client });
      assert.equal(sent.kind, "sent");
      assert.deepEqual(spy.calls, [{ method: "signInWithOtp", phone: NUMBERS.send }]);
      const audit = await db.authVerificationEvent.findFirst({
        where: { type: "auth_phone_code_sent", phoneE164: NUMBERS.send },
      });
      assert.ok(audit, "auth_phone_code_sent audited");

      const again = await sendPhoneLoginCode({ phone: NUMBERS.send, client: spy.client });
      assert.equal(again.kind, "resend_too_soon");
      assert.ok(again.kind === "resend_too_soon" && again.retryAfter >= 1);
      assert.equal(spy.calls.length, 1, "limited resend must not reach the client");
    });

    // ------------------------------------------------------------ case 4
    console.log("4. existing-owner bridge at SEND (no auth.users mapping)");
    const ownerId = await createAppUser({
      email: testEmail("owner"),
      emailVerified: new Date(),
      phoneE164: NUMBERS.ownerBridge,
      phone: NUMBERS.ownerBridge,
      phoneCountryIso: "IE",
      phoneDialCode: "+353",
      phoneVerifiedAt: new Date(),
      authCompleted: true,
    });
    await check("owned number -> identity_conflict BEFORE any SMS/client call", async () => {
      const spy = spyClient();
      const outcome = await sendPhoneLoginCode({ phone: NUMBERS.ownerBridge, client: spy.client });
      assert.equal(outcome.kind, "identity_conflict");
      assert.equal(spy.calls.length, 0, "no SMS burned, no stray auth user minted");
      const audit = await db.authVerificationEvent.findFirst({
        where: { type: "auth_login_failed", phoneE164: NUMBERS.ownerBridge, userId: ownerId },
      });
      assert.ok(audit, "auth_login_failed audited with the owner id");
    });

    // ------------------------------------------------------------ case 5
    console.log("5. existing-owner bridge at VERIFY (uid mismatch)");
    await check("approved OTP under new uid -> identity_conflict, session killed, owner untouched", async () => {
      const strangerUid = randomUUID();
      const spy = spyClient({ verifyAs: strangerUid });
      const outcome = await verifyPhoneLoginCode({
        phone: NUMBERS.ownerBridge,
        code: "123456",
        client: spy.client,
      });
      assert.equal(outcome.kind, "identity_conflict");
      assert.deepEqual(
        spy.calls.map((c) => c.method),
        ["verifyOtp", "signOut"],
        "the just-minted session must be signed out",
      );
      const strangerRow = await db.user.findUnique({ where: { id: strangerUid } });
      assert.equal(strangerRow, null, "NO second app account");
      const owner = await db.user.findUniqueOrThrow({ where: { id: ownerId } });
      assert.equal(owner.phoneE164, NUMBERS.ownerBridge);
      assert.ok(owner.phoneVerifiedAt, "owner untouched");
      const audit = await db.authVerificationEvent.findFirst({
        where: { type: "auth_login_failed", phoneE164: NUMBERS.ownerBridge, userId: ownerId },
        orderBy: { createdAt: "desc" },
      });
      assert.ok(audit, "auth_login_failed audited");
    });

    // ------------------------------------------------------------ case 6
    console.log("6. uid-match login (backfilled auth.users.phone)");
    await check("login into the canonical account, no new row, onboarding skipped", async () => {
      const uid = await seedAuthUser({ phoneE164: NUMBERS.uidMatch });
      await createAppUser({
        id: uid,
        email: testEmail("uid-match"),
        emailVerified: new Date(),
        phoneE164: NUMBERS.uidMatch,
        phone: NUMBERS.uidMatch,
        phoneCountryIso: "IE",
        phoneDialCode: "+353",
        phoneVerifiedAt: new Date(),
        authCompleted: true,
        ageConfirmedAt: new Date(),
        termsVersion: CURRENT_VERSIONS.terms,
        privacyVersion: CURRENT_VERSIONS.privacy,
        communityVersion: CURRENT_VERSIONS.community,
        onboardingDone: true,
      });
      const before = await db.user.count();

      // Pre-check at send now passes (auth mapping matches the owner)
      const sendSpy = spyClient();
      const sent = await sendPhoneLoginCode({ phone: NUMBERS.uidMatch, client: sendSpy.client });
      assert.equal(sent.kind, "sent");

      const spy = spyClient({ verifyAs: uid });
      const outcome = await verifyPhoneLoginCode({
        phone: NUMBERS.uidMatch,
        code: "123456",
        client: spy.client,
      });
      assert.equal(outcome.kind, "login");
      assert.ok(outcome.kind === "login" && !outcome.created, "existing account, not created");
      assert.equal(await db.user.count(), before, "no new row");
      assert.ok(!spy.calls.some((c) => c.method === "signOut"), "session must survive");
      if (outcome.kind === "login") {
        assert.ok(outcome.user.lastLoginAt, "login stamped");
        assert.equal(authNextStep(outcome.user), "/discover", "gate skips onboarding");
      }
      const audit = await db.authVerificationEvent.findFirst({
        where: { type: "auth_login_succeeded", phoneE164: NUMBERS.uidMatch, userId: uid },
      });
      assert.ok(audit, "auth_login_succeeded audited");
    });

    // ------------------------------------------------------------ case 7
    console.log("7. new phone -> account only after OTP approval");
    await check("wrong code creates nothing; approval creates row with phone stamped", async () => {
      const uid = randomUUID();
      const wrong = await verifyPhoneLoginCode({
        phone: NUMBERS.fresh,
        code: "999999",
        client: spyClient({ verifyError: "otp_invalid" }).client,
      });
      assert.equal(wrong.kind, "invalid_code");
      assert.equal(await db.user.findUnique({ where: { id: uid } }), null);
      assert.equal(await db.user.findUnique({ where: { phoneE164: NUMBERS.fresh } }), null);

      const outcome = await verifyPhoneLoginCode({
        phone: NUMBERS.fresh,
        code: "123456",
        client: spyClient({ verifyAs: uid }).client,
      });
      createdUserIds.push(uid);
      assert.equal(outcome.kind, "login");
      assert.ok(outcome.kind === "login" && outcome.created);
      const row = await db.user.findUniqueOrThrow({ where: { id: uid } });
      assert.equal(row.phoneE164, NUMBERS.fresh);
      assert.equal(row.phone, NUMBERS.fresh); // legacy mirror
      assert.ok(row.phoneVerifiedAt, "phoneVerifiedAt stamped in the same write");
      assert.equal(row.phoneCountryIso, "IE");
      assert.equal(row.authCompleted, true);
      assert.equal(row.email, `phone+${uid}@placeholder.tirvea.app`);
      // Gate: the first channel is proven (never bounced back to /login
      // or /auth/phone), but the account lives on a placeholder email -
      // the email-attach rung comes next, before age/legal/onboarding.
      const next = authNextStep(row);
      assert.notEqual(next, "/login");
      assert.notEqual(next, "/auth/phone");
      assert.equal(next, "/auth/email");
    });

    // ------------------------------------------------------------ case 8
    console.log("8. wrong/expired codes + failure lock");
    await check("expired -> expired_code; 5 fails -> locked (client no longer called)", async () => {
      const expired = await verifyPhoneLoginCode({
        phone: NUMBERS.codes,
        code: "111111",
        client: spyClient({ verifyError: "otp_expired" }).client,
      });
      assert.equal(expired.kind, "expired_code");
      for (let i = 0; i < 4; i += 1) {
        const fail = await verifyPhoneLoginCode({
          phone: NUMBERS.codes,
          code: "222222",
          client: spyClient({ verifyError: "otp_invalid" }).client,
        });
        assert.equal(fail.kind, "invalid_code");
      }
      const spy = spyClient({ verifyAs: randomUUID() });
      const locked = await verifyPhoneLoginCode({
        phone: NUMBERS.codes,
        code: "123456",
        client: spy.client,
      });
      assert.equal(locked.kind, "locked");
      assert.equal(spy.calls.length, 0, "locked attempts never reach the client");
      assert.equal(
        await db.user.findUnique({ where: { phoneE164: NUMBERS.codes } }),
        null,
        "failures claimed nothing",
      );
    });

    // ------------------------------------------------------------ case 9
    console.log("9. concurrent new-phone first login");
    await check("two simultaneous verifies for one uid -> exactly one row, both logins", async () => {
      const uid = randomUUID();
      const [first, second] = await Promise.all([
        verifyPhoneLoginCode({
          phone: NUMBERS.race,
          code: "123456",
          client: spyClient({ verifyAs: uid }).client,
        }),
        verifyPhoneLoginCode({
          phone: NUMBERS.race,
          code: "123456",
          client: spyClient({ verifyAs: uid }).client,
        }),
      ]);
      createdUserIds.push(uid);
      assert.deepEqual([first.kind, second.kind], ["login", "login"]);
      const rows = await db.user.findMany({ where: { phoneE164: NUMBERS.race } });
      assert.equal(rows.length, 1, "exactly one app row (P2002 adopt path)");
      assert.equal(rows[0].id, uid);
    });

    // ----------------------------------------------------------- case 10
    console.log("10. phone-change verify still works + guarded auth sync");
    const syncUserId = await createAppUser({ email: testEmail("sync") });
    function syncSpy(fail = false) {
      const calls: { phone: string }[] = [];
      return {
        calls,
        client: {
          async updateUser({ phone }: { phone: string }) {
            calls.push({ phone });
            return fail
              ? { error: { code: "phone_provider_disabled", message: "disabled" } }
              : { error: null };
          },
        },
      };
    }
    const approvedProvider = {
      async sendCode() {},
      async verifyCode() {
        return "approved" as const;
      },
    };
    await check("verify succeeds AND attempts updateUser({phone}) when flag on", async () => {
      const sync = syncSpy();
      const outcome = await confirmPhoneVerification({
        user: { id: syncUserId },
        phone: NUMBERS.sync,
        code: "123456",
        provider: approvedProvider,
        authSync: sync.client,
      });
      assert.equal(outcome.kind, "verified");
      assert.deepEqual(sync.calls, [{ phone: NUMBERS.sync }], "guarded sync attempted");
      const row = await db.user.findUniqueOrThrow({ where: { id: syncUserId } });
      assert.equal(row.phoneE164, NUMBERS.sync);
      assert.ok(row.phoneVerifiedAt);
      const audit = await db.authVerificationEvent.findFirst({
        where: { type: "phone_auth_sync", phoneE164: NUMBERS.sync, userId: syncUserId },
      });
      assert.ok(audit, "phone_auth_sync audited");
    });
    await check("sync failure NEVER fails the app-side claim (audited instead)", async () => {
      await db.user.update({
        where: { id: syncUserId },
        data: { phoneE164: null, phone: null, phoneVerifiedAt: null },
      });
      const sync = syncSpy(true);
      const outcome = await confirmPhoneVerification({
        user: { id: syncUserId },
        phone: NUMBERS.sync,
        code: "123456",
        provider: approvedProvider,
        authSync: sync.client,
      });
      assert.equal(outcome.kind, "verified", "claim survives a failed sync");
      assert.equal(sync.calls.length, 1);
      const audit = await db.authVerificationEvent.findFirst({
        where: { type: "phone_auth_sync_failed", phoneE164: NUMBERS.sync, userId: syncUserId },
      });
      assert.ok(audit, "phone_auth_sync_failed audited");
    });
    await check("flag off -> NO sync attempt (idempotent re-verify short-circuits aside)", async () => {
      process.env.PHONE_LOGIN_ENABLED = "false";
      await db.user.update({
        where: { id: syncUserId },
        data: { phoneE164: null, phone: null, phoneVerifiedAt: null },
      });
      const sync = syncSpy();
      const outcome = await confirmPhoneVerification({
        user: { id: syncUserId },
        phone: NUMBERS.sync,
        code: "123456",
        provider: approvedProvider,
        authSync: sync.client,
      });
      assert.equal(outcome.kind, "verified");
      assert.equal(sync.calls.length, 0, "sync must be guarded by PHONE_LOGIN_ENABLED");
    });

    console.log(`\n${passed} checks passed`);
  } finally {
    await db.user.deleteMany({ where: { email: { contains: "phone-login-" } } }).catch(() => {});
    await db.user.deleteMany({ where: { id: { in: createdUserIds } } }).catch(() => {});
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
