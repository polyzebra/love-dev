/**
 * Live tests for the AUTHENTICATED email-attach flow (email-attach-flow
 * service + the /auth/email gate rung). Run with:
 *   npx tsx tests/email-attach.test.ts
 *
 * Talks to the real database from .env. Users, auth.users rows, blocked
 * identities and audit events are namespaced per run and removed in
 * `finally`. ZERO real emails and zero live GoTrue calls: every case
 * injects a spy auth client for updateUser/verifyOtp.
 *
 * The matrix:
 *   1.  GATE: a new phone-LOGIN account (placeholder email) has
 *       next=/auth/email right after the phone rung (flag on AND off);
 *       an existing phone-login owner with a real verified email logs
 *       straight in and never sees /auth/email; an email-first user
 *       never sees it; a Google-created user (verified email, no phone,
 *       flag on) gets /auth/phone and never /auth/email
 *   2.  Junk input pre-client: invalid shape, our own placeholder domain
 *       -> invalid_email; disposable + blocklisted -> ONE neutral
 *       not_allowed; zero client calls for all of them
 *   3.  CASE 1 happy path: send (updateUser({email}) called once,
 *       audited) + immediate resend -> neutral limited send (no client
 *       call); verify (verifyOtp type "email_change") replaces the
 *       placeholder + stamps emailVerified and the ladder continues
 *       (/auth/age)
 *   4.  CASE 2: the address is already verified on THIS account ->
 *       alreadyVerified success, no OTP, zero client calls
 *   5.  CASE 3 / account takeover: an address owned by another LIVE
 *       account -> email_in_use with the EXACT spec copy, no OTP at
 *       send AND no code burn at verify, owner untouched, no transfer
 *   6.  GoTrue-level holder (auth.users only): updateUser answers
 *       email_exists -> email_in_use
 *   7.  Wrong/expired codes + failure lock after 5 fails (locked
 *       attempts never reach the client, placeholder unchanged)
 *   8.  Concurrent attach race for one free address -> exactly one
 *       winner, the loser gets email_in_use, nothing merged
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

process.env.AUTH_HASH_SALT = process.env.AUTH_HASH_SALT || "test-salt";

const RUN = Date.now().toString(36);
const testEmail = (tag: string) => `email-attach-${tag}-${RUN}@example.com`;

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

function fakeReq(ip: string): Request {
  return new Request("http://test.local/api", {
    headers: { "x-forwarded-for": `${ip}, 10.0.0.1`, "user-agent": "test-agent/1.0" },
  });
}

async function main() {
  const { db } = await import("../src/lib/db");
  const { sendEmailAttach, verifyEmailAttach, EMAIL_IN_USE_MESSAGE } = await import(
    "../src/lib/auth/email-attach-flow"
  );
  const { authNextStep, needsEmailAttach } = await import("../src/lib/auth/gate");
  const { phonePlaceholderEmail, provisionPhoneLoginUser } = await import(
    "../src/lib/auth/identity"
  );
  type AuthClient = import("../src/lib/auth/email-attach-flow").EmailAttachAuthClient;

  /**
   * Spy auth client. `verifyAs` controls verifyOtp's returned uid (the
   * live session's auth user); an error code string = failure.
   */
  function spyClient(opts?: { verifyAs?: string; verifyError?: string; sendError?: string }) {
    const calls: { method: "updateUser" | "verifyOtp"; email?: string; type?: string }[] = [];
    const client: AuthClient = {
      async updateUser({ email }) {
        calls.push({ method: "updateUser", email });
        return {
          error: opts?.sendError ? { code: opts.sendError, message: opts.sendError } : null,
        };
      },
      async verifyOtp({ email, type }) {
        calls.push({ method: "verifyOtp", email, type });
        if (opts?.verifyError) {
          return {
            data: { user: null, session: null },
            error: { code: opts.verifyError, message: opts.verifyError },
          };
        }
        return {
          data: { user: { id: opts?.verifyAs ?? randomUUID(), email }, session: {} },
          error: null,
        };
      },
    };
    return { client, calls };
  }

  const seededAuthIds: string[] = [];
  /** Seed a throwaway auth.users row via SQL (liveEmailHolder aliveness). */
  async function seedAuthUser(opts: { id?: string; email?: string }): Promise<string> {
    const id = opts.id ?? randomUUID();
    await db.$executeRaw`
      INSERT INTO auth.users
        (id, instance_id, aud, role, email, created_at, updated_at,
         raw_app_meta_data, raw_user_meta_data, is_sso_user)
      VALUES
        (${id}::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated',
         'authenticated', ${opts.email ?? null}, now(), now(),
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false)`;
    seededAuthIds.push(id);
    return id;
  }

  const createdUserIds: string[] = [];
  /**
   * A phone-first app user living on its placeholder email. Seeds the
   * matching auth.users row too (User.id IS auth.users.id in production;
   * liveEmailHolder's orphan check must see the owner as alive).
   */
  async function createPhoneFirstUser(phoneTail: string): Promise<string> {
    const id = randomUUID();
    await seedAuthUser({ id });
    await db.user.create({
      data: {
        id,
        email: phonePlaceholderEmail(id),
        phoneE164: `+35386123${phoneTail}`,
        phone: `+35386123${phoneTail}`,
        phoneCountryIso: "IE",
        phoneDialCode: "+353",
        phoneVerifiedAt: new Date(),
        authCompleted: true,
      },
    });
    createdUserIds.push(id);
    return id;
  }
  const sessionUser = (id: string) => ({ id, bannedAt: null, status: "ACTIVE" });

  const blockedEmail = testEmail("blocked");

  try {
    // ------------------------------------------------------------ case 1
    console.log("1. gate ladder placement");
    await check("new phone-login account -> /auth/email right after phone (flag on/off)", async () => {
      const authUid = randomUUID();
      const provisioned = await provisionPhoneLoginUser({
        authUid,
        email: null,
        phoneE164: "+353861235101",
        phoneCountryIso: "IE",
        phoneDialCode: "+353",
      });
      createdUserIds.push(authUid);
      assert.ok(provisioned.ok);
      if (provisioned.ok) {
        assert.equal(provisioned.user.email, phonePlaceholderEmail(authUid));
        assert.equal(needsEmailAttach(provisioned.user), true);
        assert.equal(authNextStep(provisioned.user, true), "/auth/email");
        assert.equal(authNextStep(provisioned.user, false), "/auth/email");
      }
    });
    await check("existing phone-login owner with real verified email never sees /auth/email", () => {
      const owner = {
        status: "ACTIVE",
        bannedAt: null,
        email: testEmail("settled-owner"),
        emailVerified: new Date(),
        phoneVerifiedAt: new Date(),
        ageConfirmedAt: new Date(),
        termsVersion: null, // still owes legal - but NEVER /auth/email
        privacyVersion: null,
        communityVersion: null,
        onboardingDone: false,
      };
      assert.equal(needsEmailAttach(owner), false);
      assert.equal(authNextStep(owner, true), "/auth/legal");
    });
    await check("email-first user never sees /auth/email; Google user (no phone) -> /auth/phone", () => {
      const emailFirst = {
        status: "ACTIVE",
        bannedAt: null,
        email: testEmail("google"),
        emailVerified: new Date(),
        phoneVerifiedAt: null,
        ageConfirmedAt: null,
        termsVersion: null,
        privacyVersion: null,
        communityVersion: null,
        onboardingDone: false,
      };
      // Verified email + no phone + flag ON: phone rung first, never email.
      assert.equal(authNextStep(emailFirst, true), "/auth/phone");
      // Flag OFF: straight to age - the email rung stays invisible.
      assert.equal(authNextStep(emailFirst, false), "/auth/age");
      assert.equal(needsEmailAttach(emailFirst), false);
    });

    // ------------------------------------------------------------ case 2
    console.log("2. junk + blocked input (pre-client)");
    const junkUserId = await createPhoneFirstUser("5102");
    await db.blockedIdentity
      .create({ data: { email: blockedEmail, reason: "test-block" } })
      .catch(() => {});
    await check("invalid shape / placeholder domain -> invalid_email, zero client calls", async () => {
      const spy = spyClient();
      const junk = await sendEmailAttach({
        user: sessionUser(junkUserId),
        email: "not-an-email",
        client: spy.client,
      });
      assert.equal(junk.kind, "invalid_email");
      const placeholder = await sendEmailAttach({
        user: sessionUser(junkUserId),
        email: phonePlaceholderEmail(randomUUID()),
        client: spy.client,
      });
      assert.equal(placeholder.kind, "invalid_email");
      const verifyJunk = await verifyEmailAttach({
        user: sessionUser(junkUserId),
        email: "not-an-email",
        code: "123456",
        client: spy.client,
      });
      assert.equal(verifyJunk.kind, "invalid_email");
      assert.equal(spy.calls.length, 0, "client must never be reached");
    });
    await check("disposable + blocklisted -> ONE neutral not_allowed, zero client calls", async () => {
      const spy = spyClient();
      const disposable = await sendEmailAttach({
        user: sessionUser(junkUserId),
        email: `x-${RUN}@mailinator.com`,
        client: spy.client,
      });
      assert.equal(disposable.kind, "not_allowed");
      const blocked = await sendEmailAttach({
        user: sessionUser(junkUserId),
        email: blockedEmail,
        client: spy.client,
        req: fakeReq("203.0.113.60"),
      });
      assert.equal(blocked.kind, "not_allowed", "blocklist rejection is indistinguishable");
      const blockedVerify = await verifyEmailAttach({
        user: sessionUser(junkUserId),
        email: blockedEmail,
        code: "123456",
        client: spy.client,
      });
      assert.equal(blockedVerify.kind, "not_allowed");
      assert.equal(spy.calls.length, 0, "no OTP for junk/blocked addresses");
      const audit = await db.authVerificationEvent.findFirst({
        where: { type: "email_attach_send_blocked", email: blockedEmail },
      });
      assert.ok(audit, "blocked send audited with the real reason");
    });

    // ------------------------------------------------------------ case 3
    console.log("3. CASE 1 - attach happy path (placeholder replaced)");
    const happyId = await createPhoneFirstUser("5103");
    const happyEmail = testEmail("happy");
    await check("send: updateUser({email}) called once, audited; resend -> neutral limited", async () => {
      const spy = spyClient();
      const sent = await sendEmailAttach({
        user: sessionUser(happyId),
        email: happyEmail,
        client: spy.client,
        req: fakeReq("203.0.113.61"),
      });
      assert.equal(sent.kind, "sent");
      assert.ok(sent.kind === "sent" && !sent.limited);
      assert.deepEqual(spy.calls, [{ method: "updateUser", email: happyEmail }]);
      const audit = await db.authVerificationEvent.findFirst({
        where: { type: "email_attach_send", email: happyEmail, userId: happyId },
      });
      assert.ok(audit, "email_attach_send audited");

      const again = await sendEmailAttach({
        user: sessionUser(happyId),
        email: happyEmail,
        client: spy.client,
      });
      assert.equal(again.kind, "sent", "limited resend keeps the neutral shape");
      assert.ok(again.kind === "sent" && again.limited && again.retryAfter >= 1);
      assert.equal(spy.calls.length, 1, "limited resend must not reach the client");
    });
    await check("verify: type email_change; placeholder replaced + emailVerified; ladder -> /auth/age", async () => {
      const spy = spyClient({ verifyAs: happyId });
      const outcome = await verifyEmailAttach({
        user: sessionUser(happyId),
        email: happyEmail,
        code: "123456",
        client: spy.client,
        req: fakeReq("203.0.113.61"),
      });
      assert.equal(outcome.kind, "attached");
      assert.deepEqual(spy.calls, [
        { method: "verifyOtp", email: happyEmail, type: "email_change" },
      ]);
      const row = await db.user.findUniqueOrThrow({ where: { id: happyId } });
      assert.equal(row.email, happyEmail, "placeholder replaced");
      assert.ok(row.emailVerified, "emailVerified stamped");
      assert.equal(needsEmailAttach(row), false, "the rung never shows again");
      assert.equal(authNextStep(row, true), "/auth/age", "ladder continues past the rung");
      const audit = await db.authVerificationEvent.findFirst({
        where: { type: "email_attach_verified", email: happyEmail, userId: happyId },
      });
      assert.ok(audit, "email_attach_verified audited");
    });

    // ------------------------------------------------------------ case 4
    console.log("4. CASE 2 - already verified on THIS account");
    await check("same address again -> alreadyVerified success, zero client calls", async () => {
      const spy = spyClient();
      const outcome = await sendEmailAttach({
        user: sessionUser(happyId),
        email: happyEmail.toUpperCase(), // normalization proves itself
        client: spy.client,
      });
      assert.equal(outcome.kind, "already_verified");
      assert.equal(spy.calls.length, 0, "no OTP - nobody re-verifies what is verified");
      const verifySame = await verifyEmailAttach({
        user: sessionUser(happyId),
        email: happyEmail,
        code: "123456",
        client: spy.client,
      });
      assert.equal(verifySame.kind, "already_verified");
      assert.equal(spy.calls.length, 0);
    });

    // ------------------------------------------------------------ case 5
    console.log("5. CASE 3 - address owned by another account (takeover attempt)");
    const attackerId = await createPhoneFirstUser("5104");
    await check("send -> email_in_use with the exact copy, no OTP, owner untouched", async () => {
      const spy = spyClient();
      const outcome = await sendEmailAttach({
        user: sessionUser(attackerId),
        email: happyEmail,
        client: spy.client,
        req: fakeReq("203.0.113.62"),
      });
      assert.equal(outcome.kind, "email_in_use");
      assert.ok(outcome.kind === "email_in_use" && outcome.holderId === happyId);
      assert.equal(spy.calls.length, 0, "no OTP is ever sent for an owned address");
      assert.equal(
        EMAIL_IN_USE_MESSAGE,
        "This email is already associated with another Tirvea account. " +
          "Please sign in using Email, Google or Apple to access that account.",
        "the exact spec copy ships from ONE place",
      );
      const owner = await db.user.findUniqueOrThrow({ where: { id: happyId } });
      assert.equal(owner.email, happyEmail);
      assert.ok(owner.emailVerified, "owner untouched");
      const audit = await db.authVerificationEvent.findFirst({
        where: { type: "email_attach_conflict", email: happyEmail, userId: attackerId },
      });
      assert.ok(audit, "conflict audited against the attacker");
    });
    await check("verify -> email_in_use BEFORE the provider; no transfer", async () => {
      const spy = spyClient({ verifyAs: attackerId });
      const outcome = await verifyEmailAttach({
        user: sessionUser(attackerId),
        email: happyEmail,
        code: "123456",
        client: spy.client,
      });
      assert.equal(outcome.kind, "email_in_use");
      assert.equal(spy.calls.length, 0, "the code is never burned on an owned address");
      const attacker = await db.user.findUniqueOrThrow({ where: { id: attackerId } });
      assert.equal(attacker.email, phonePlaceholderEmail(attackerId), "attacker keeps placeholder");
      assert.equal(attacker.emailVerified, null, "nothing transferred");
      const owner = await db.user.findUniqueOrThrow({ where: { id: happyId } });
      assert.equal(owner.email, happyEmail, "owner still owns the address");
    });

    // ------------------------------------------------------------ case 6
    console.log("6. GoTrue-level holder (auth.users only)");
    await check("updateUser answers email_exists -> email_in_use", async () => {
      const spy = spyClient({ sendError: "email_exists" });
      const outcome = await sendEmailAttach({
        user: sessionUser(attackerId),
        email: testEmail("auth-only"),
        client: spy.client,
      });
      assert.equal(outcome.kind, "email_in_use");
      assert.equal(spy.calls.length, 1);
    });

    // ------------------------------------------------------------ case 7
    console.log("7. wrong/expired codes + failure lock");
    const lockId = await createPhoneFirstUser("5105");
    const lockEmail = testEmail("lock");
    await check("expired -> expired_code; 5 fails -> locked (client no longer called)", async () => {
      const expired = await verifyEmailAttach({
        user: sessionUser(lockId),
        email: lockEmail,
        code: "111111",
        client: spyClient({ verifyError: "otp_expired" }).client,
      });
      assert.equal(expired.kind, "expired_code");
      for (let i = 0; i < 4; i += 1) {
        const fail = await verifyEmailAttach({
          user: sessionUser(lockId),
          email: lockEmail,
          code: "222222",
          client: spyClient({ verifyError: "otp_invalid" }).client,
        });
        assert.equal(fail.kind, "invalid_code");
      }
      const spy = spyClient({ verifyAs: lockId });
      const locked = await verifyEmailAttach({
        user: sessionUser(lockId),
        email: lockEmail,
        code: "123456",
        client: spy.client,
      });
      assert.equal(locked.kind, "locked");
      assert.equal(spy.calls.length, 0, "locked attempts never reach the client");
      const row = await db.user.findUniqueOrThrow({ where: { id: lockId } });
      assert.equal(row.email, phonePlaceholderEmail(lockId), "failures claimed nothing");
      assert.equal(row.emailVerified, null);
      const audit = await db.authVerificationEvent.findFirst({
        where: { type: "email_attach_verify_locked", email: lockEmail, userId: lockId },
      });
      assert.ok(audit, "lock audited as its own type (never extends itself)");
    });

    // ------------------------------------------------------------ case 8
    console.log("8. concurrent attach race for one free address");
    await check("two users, one address -> exactly one winner, loser gets email_in_use", async () => {
      const raceEmail = testEmail("race");
      const aId = await createPhoneFirstUser("5106");
      const bId = await createPhoneFirstUser("5107");
      const [a, b] = await Promise.all([
        verifyEmailAttach({
          user: sessionUser(aId),
          email: raceEmail,
          code: "123456",
          client: spyClient({ verifyAs: aId }).client,
        }),
        verifyEmailAttach({
          user: sessionUser(bId),
          email: raceEmail,
          code: "123456",
          client: spyClient({ verifyAs: bId }).client,
        }),
      ]);
      const kinds = [a.kind, b.kind].sort();
      assert.deepEqual(kinds, ["attached", "email_in_use"], "exactly one winner");
      const holders = await db.user.findMany({ where: { email: raceEmail } });
      assert.equal(holders.length, 1, "the unique index kept one holder");
      const loserId = a.kind === "attached" ? bId : aId;
      const loser = await db.user.findUniqueOrThrow({ where: { id: loserId } });
      assert.equal(loser.email, phonePlaceholderEmail(loserId), "loser keeps placeholder - no merge");
    });

    console.log(`\n${passed} checks passed`);
  } finally {
    await db.user.deleteMany({ where: { id: { in: createdUserIds } } }).catch(() => {});
    await db.blockedIdentity.deleteMany({ where: { email: blockedEmail } }).catch(() => {});
    await db.authVerificationEvent
      .deleteMany({
        where: {
          OR: [
            { email: { contains: `email-attach-` } },
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
