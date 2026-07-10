/**
 * Live tests for the one-phone-one-account defense (phone-flow service).
 * Run with:
 *   npx tsx tests/phone-verification.test.ts
 *
 * Talks to the real database from .env. Users and audit events are
 * namespaced per run and removed in `finally`. SMS never leaves the
 * building: every case injects a fake/spy provider - Twilio is never hit.
 *
 * The 8-case matrix:
 *   1. A verifies a number (provider success simulated)
 *   2. B tries the same number -> 409 duplicate, ZERO provider calls,
 *      zero pending/auth state, A intact
 *   3. A retries its own verified number -> alreadyVerified, no SMS
 *   4. An expired pending send by another user does NOT block the number
 *   5. A failed OTP claims nothing (row untouched, fail audited)
 *   6. Two concurrent verifies for one number -> exactly one wins
 *   7. Normalization: national / E.164 / bare-country-code input (IE)
 *      produce the same canonical E.164
 *   8. Invalid or unsupported-country numbers are rejected BEFORE the
 *      provider (zero provider calls)
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

process.env.AUTH_HASH_SALT = process.env.AUTH_HASH_SALT || "test-salt";

const RUN = Date.now().toString(36);
const testEmail = (tag: string) => `phone-verif-${tag}-${RUN}@example.com`;

// Valid Irish mobile numbers reserved for this suite (never real users').
const NUMBERS = {
  main: "+353861234501",
  pending: "+353861234502",
  failed: "+353861234503",
  race: "+353861234504",
} as const;

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

async function main() {
  const { db } = await import("../src/lib/db");
  const { sendPhoneVerification, confirmPhoneVerification, normalizePhone } = await import(
    "../src/lib/auth/phone-flow"
  );
  type Provider = import("../src/lib/auth/phone").PhoneVerificationProvider;
  type Check = import("../src/lib/auth/phone").PhoneVerifyCheck;

  /** Spy provider: records every call; verify answers as instructed. */
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

  const emails = {
    a: testEmail("account-a"),
    b: testEmail("account-b"),
    c: testEmail("pending-c"),
    d: testEmail("winner-d"),
    e: testEmail("failed-e"),
    f: testEmail("race-f"),
    g: testEmail("race-g"),
  };
  const ids: Record<keyof typeof emails, string> = {
    a: randomUUID(),
    b: randomUUID(),
    c: randomUUID(),
    d: randomUUID(),
    e: randomUUID(),
    f: randomUUID(),
    g: randomUUID(),
  };

  const sessionUser = (id: string) => ({ id, bannedAt: null, status: "ACTIVE" });

  try {
    for (const key of Object.keys(emails) as (keyof typeof emails)[]) {
      await db.user.create({ data: { id: ids[key], email: emails[key] } });
    }

    // ------------------------------------------------------------ case 1
    console.log("1. account A verifies a number");
    await check("send -> sent (provider called once), verify -> verified + row stamped", async () => {
      const send = spyProvider();
      const sent = await sendPhoneVerification({
        user: sessionUser(ids.a),
        phone: NUMBERS.main,
        provider: send.provider,
      });
      assert.equal(sent.kind, "sent");
      assert.deepEqual(send.calls, [{ method: "send", phoneE164: NUMBERS.main }]);

      const confirm = spyProvider("approved");
      const verified = await confirmPhoneVerification({
        user: { id: ids.a },
        phone: NUMBERS.main,
        code: "123456",
        provider: confirm.provider,
      });
      assert.equal(verified.kind, "verified");
      const row = await db.user.findUniqueOrThrow({ where: { id: ids.a } });
      assert.equal(row.phoneE164, NUMBERS.main);
      assert.equal(row.phone, NUMBERS.main); // legacy mirror
      assert.ok(row.phoneVerifiedAt, "phoneVerifiedAt stamped");
      assert.equal(row.phoneCountryIso, "IE");
      assert.equal(row.phoneDialCode, "+353");
      assert.equal(row.authCompleted, true);
    });

    // ------------------------------------------------------------ case 2
    console.log("2. account B tries A's number");
    await check("send -> duplicate_phone with ZERO provider calls", async () => {
      const spy = spyProvider();
      const outcome = await sendPhoneVerification({
        user: sessionUser(ids.b),
        phone: NUMBERS.main,
        provider: spy.provider,
      });
      assert.equal(outcome.kind, "duplicate_phone");
      assert.equal(spy.calls.length, 0, "provider must never be reached");
    });
    await check("verify path is ALSO blocked pre-provider for B", async () => {
      const spy = spyProvider("approved"); // even an 'approved' code must not help
      const outcome = await confirmPhoneVerification({
        user: { id: ids.b },
        phone: NUMBERS.main,
        code: "123456",
        provider: spy.provider,
      });
      assert.equal(outcome.kind, "duplicate_phone");
      assert.equal(spy.calls.length, 0, "provider must never be reached");
    });
    await check("B's attempt polluted nothing (only a conflict audit event)", async () => {
      const b = await db.user.findUniqueOrThrow({ where: { id: ids.b } });
      assert.equal(b.phoneE164, null);
      assert.equal(b.phone, null);
      assert.equal(b.phoneVerifiedAt, null);
      assert.equal(b.authCompleted, false);
      const events = await db.authVerificationEvent.findMany({ where: { userId: ids.b } });
      assert.ok(events.length >= 2);
      assert.ok(
        events.every((e) => e.type === "phone_otp_send_conflict" || e.type === "phone_otp_verify_conflict"),
        `only conflict events, got: ${events.map((e) => e.type).join(",")}`,
      );
    });
    await check("account A is fully intact after B's attempts", async () => {
      const a = await db.user.findUniqueOrThrow({ where: { id: ids.a } });
      assert.equal(a.phoneE164, NUMBERS.main);
      assert.ok(a.phoneVerifiedAt);
      assert.equal(a.authCompleted, true);
    });

    // ------------------------------------------------------------ case 3
    console.log("3. account A retries its own number");
    await check("send -> already_verified, ZERO provider calls (no SMS burned)", async () => {
      const spy = spyProvider();
      const outcome = await sendPhoneVerification({
        user: sessionUser(ids.a),
        phone: NUMBERS.main,
        provider: spy.provider,
      });
      assert.equal(outcome.kind, "already_verified");
      assert.equal(spy.calls.length, 0);
      assert.ok(outcome.kind === "already_verified" && outcome.user.phoneVerifiedAt);
    });
    await check("verify of the same number on A -> already_verified (idempotent)", async () => {
      const spy = spyProvider();
      const outcome = await confirmPhoneVerification({
        user: { id: ids.a },
        phone: NUMBERS.main,
        code: "000000",
        provider: spy.provider,
      });
      assert.equal(outcome.kind, "already_verified");
      assert.equal(spy.calls.length, 0);
    });

    // ------------------------------------------------------------ case 4
    console.log("4. expired pending send never blocks the number");
    await check("C sent but never verified; D can claim the number later", async () => {
      const cSend = spyProvider();
      const sent = await sendPhoneVerification({
        user: sessionUser(ids.c),
        phone: NUMBERS.pending,
        provider: cSend.provider,
      });
      assert.equal(sent.kind, "sent");
      // Let C's pending send "expire" (age it past the resend cooldown -
      // there IS no other app-side pending state, which is the point).
      await db.authVerificationEvent.updateMany({
        where: { phoneE164: NUMBERS.pending, type: "phone_otp_send" },
        data: { createdAt: new Date(Date.now() - 10 * 60 * 1000) },
      });

      const dSend = spyProvider();
      const dSent = await sendPhoneVerification({
        user: sessionUser(ids.d),
        phone: NUMBERS.pending,
        provider: dSend.provider,
      });
      assert.equal(dSent.kind, "sent", "C's abandoned send must not block D");
      const dConfirm = spyProvider("approved");
      const verified = await confirmPhoneVerification({
        user: { id: ids.d },
        phone: NUMBERS.pending,
        code: "123456",
        provider: dConfirm.provider,
      });
      assert.equal(verified.kind, "verified");
      const c = await db.user.findUniqueOrThrow({ where: { id: ids.c } });
      assert.equal(c.phoneE164, null, "C never claimed anything by sending");
    });

    // ------------------------------------------------------------ case 5
    console.log("5. failed OTP claims nothing");
    await check("incorrect code -> row untouched, fail audited", async () => {
      const send = spyProvider();
      await sendPhoneVerification({
        user: sessionUser(ids.e),
        phone: NUMBERS.failed,
        provider: send.provider,
      });
      const confirm = spyProvider("incorrect");
      const outcome = await confirmPhoneVerification({
        user: { id: ids.e },
        phone: NUMBERS.failed,
        code: "999999",
        provider: confirm.provider,
      });
      assert.equal(outcome.kind, "incorrect");
      const e = await db.user.findUniqueOrThrow({ where: { id: ids.e } });
      assert.equal(e.phoneE164, null);
      assert.equal(e.phoneVerifiedAt, null);
      const fail = await db.authVerificationEvent.findFirst({
        where: { userId: ids.e, type: "otp_verify_fail" },
      });
      assert.ok(fail, "otp_verify_fail audited");
    });
    await check("expired code -> distinct outcome, row untouched", async () => {
      const confirm = spyProvider("expired");
      const outcome = await confirmPhoneVerification({
        user: { id: ids.e },
        phone: NUMBERS.failed,
        code: "999999",
        provider: confirm.provider,
      });
      assert.equal(outcome.kind, "expired");
      const e = await db.user.findUniqueOrThrow({ where: { id: ids.e } });
      assert.equal(e.phoneE164, null);
    });

    // ------------------------------------------------------------ case 6
    console.log("6. concurrent verify - only one wins");
    await check("two simultaneous verifies: exactly one verified, one duplicate", async () => {
      const [first, second] = await Promise.all([
        confirmPhoneVerification({
          user: { id: ids.f },
          phone: NUMBERS.race,
          code: "123456",
          provider: spyProvider("approved").provider,
        }),
        confirmPhoneVerification({
          user: { id: ids.g },
          phone: NUMBERS.race,
          code: "123456",
          provider: spyProvider("approved").provider,
        }),
      ]);
      const kinds = [first.kind, second.kind].sort();
      assert.deepEqual(kinds, ["duplicate_phone", "verified"]);
      const holders = await db.user.findMany({ where: { phoneE164: NUMBERS.race } });
      assert.equal(holders.length, 1, "exactly one account holds the number");
      assert.ok(holders[0].phoneVerifiedAt);
    });

    // ------------------------------------------------------------ case 7
    console.log("7. normalization (region IE)");
    await check("0868672333 / +353868672333 / 353868672333 -> same E.164", () => {
      for (const input of ["0868672333", "+353868672333", "353868672333"]) {
        const n = normalizePhone(input, "IE");
        assert.ok(n.ok, `${input} should normalize`);
        assert.equal(n.phoneE164, "+353868672333");
        assert.equal(n.countryIso, "IE");
        assert.equal(n.dialCode, "+353");
      }
    });

    // ------------------------------------------------------------ case 8
    console.log("8. invalid / unsupported input rejected pre-provider");
    await check("garbage, bogus country code, invalid region -> rejected, ZERO provider calls", async () => {
      const spy = spyProvider();
      for (const [phone, countryIso] of [
        ["12345", "IE"],
        ["+999123456789", undefined],
        ["0868672333", "XX"], // libphonenumber invalid region
      ] as const) {
        const outcome = await sendPhoneVerification({
          user: sessionUser(ids.b),
          phone,
          countryIso,
          provider: spy.provider,
        });
        assert.equal(outcome.kind, "invalid_phone", `${phone} (${countryIso}) must be invalid`);
      }
      assert.equal(spy.calls.length, 0, "provider must never be reached");
    });
    await check("valid but region-less number (UIFN +800) -> unsupported_country", async () => {
      const spy = spyProvider();
      const outcome = await sendPhoneVerification({
        user: sessionUser(ids.b),
        phone: "+80012341234",
        provider: spy.provider,
      });
      assert.equal(outcome.kind, "unsupported_country");
      assert.equal(spy.calls.length, 0);
    });

    console.log(`\n${passed} checks passed`);
  } finally {
    await db.user
      .deleteMany({ where: { email: { contains: `phone-verif-` } } })
      .catch(() => {});
    await db.authVerificationEvent
      .deleteMany({
        where: {
          OR: [
            { phoneE164: { in: Object.values(NUMBERS) } },
            { userId: { in: Object.values(ids) } },
          ],
        },
      })
      .catch(() => {});
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error("\nTEST FAILURE:", error);
  process.exit(1);
});
