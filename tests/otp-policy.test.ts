/**
 * Live tests for the OTP resend/lock policy and the Twilio Verify
 * provider. Run with:
 *   npx tsx tests/otp-policy.test.ts
 *
 * Talks to the real database from .env (writes are namespaced under
 * test-specific emails/phones and cleaned up in `finally`). The Twilio
 * provider tests are pure unit tests - fetch is injected, no network.
 */
import "dotenv/config";
import assert from "node:assert/strict";

process.env.AUTH_HASH_SALT = process.env.AUTH_HASH_SALT || "test-salt";

const RUN = Date.now().toString(36);
const testEmail = (tag: string) => `otp-policy-${tag}-${RUN}@example.com`;
const TEST_PHONE = "+15005550007";

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

const secondsAgo = (s: number) => new Date(Date.now() - s * 1000);

async function main() {
  // ------------------------------------------------ twilio provider (unit)
  console.log("twilio verify provider (fetch injected)");
  const { twilioVerifyProvider, PhoneProviderRejectedError } = await import(
    "../src/lib/auth/phone"
  );

  const config = { accountSid: "ACtest", authToken: "secret-token", serviceSid: "VAtest" };
  type Call = { url: string; init: RequestInit };

  function providerWith(status: number, json: unknown, calls: Call[] = []) {
    const fetchImpl = (async (url: URL | RequestInfo, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify(json), { status });
    }) as typeof fetch;
    return twilioVerifyProvider(config, fetchImpl);
  }

  {
    const calls: Call[] = [];
    await providerWith(201, { status: "pending" }, calls).sendCode("+15005550006");
    await check("sendCode: URL, basic auth and form body shape", () => {
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, "https://verify.twilio.com/v2/Services/VAtest/Verifications");
      assert.equal(calls[0].init.method, "POST");
      const headers = calls[0].init.headers as Record<string, string>;
      assert.equal(
        headers.Authorization,
        "Basic " + Buffer.from("ACtest:secret-token").toString("base64"),
      );
      assert.equal(headers["Content-Type"], "application/x-www-form-urlencoded");
      assert.equal(calls[0].init.body, "To=%2B15005550006&Channel=sms");
    });
  }

  {
    const calls: Call[] = [];
    const ok = await providerWith(200, { status: "approved" }, calls).verifyCode(
      "+15005550006",
      "123456",
    );
    await check("verifyCode: VerificationCheck URL/body, approved -> true", () => {
      assert.equal(calls[0].url, "https://verify.twilio.com/v2/Services/VAtest/VerificationCheck");
      assert.equal(calls[0].init.body, "To=%2B15005550006&Code=123456");
      assert.equal(ok, true);
    });
  }

  await check("verifyCode: non-approved status -> false (denied)", async () => {
    assert.equal(await providerWith(200, { status: "pending" }).verifyCode("+1", "000000"), false);
  });
  await check("verifyCode: 404 (expired / no pending verification) -> false", async () => {
    assert.equal(await providerWith(404, { code: 20404 }).verifyCode("+1", "123456"), false);
  });

  await check("60200 invalid number -> neutral copy + audit metadata", async () => {
    await assert.rejects(
      providerWith(400, { code: 60200, message: "Invalid parameter `To`" }).sendCode("+1999"),
      (error: unknown) => {
        assert.ok(error instanceof PhoneProviderRejectedError);
        assert.equal(error.neutralMessage, "That number can't be used right now.");
        assert.equal(error.httpStatus, 400);
        assert.deepEqual(error.auditMetadata, {
          provider: "twilio",
          twilioCode: 60200,
          reason: "invalid_number",
        });
        assert.ok(!error.message.includes("Invalid parameter")); // never Twilio's words
        return true;
      },
    );
  });
  await check("60203 max sends -> neutral copy + audit metadata", async () => {
    await assert.rejects(
      providerWith(429, { code: 60203 }).sendCode("+15005550006"),
      (error: unknown) => {
        assert.ok(error instanceof PhoneProviderRejectedError);
        assert.equal(
          error.neutralMessage,
          "Too many codes requested for this number. Try again later.",
        );
        assert.equal(error.httpStatus, 429);
        assert.equal(error.auditMetadata.reason, "max_send_attempts");
        return true;
      },
    );
  });
  await check("60202 max check attempts -> neutral locked copy", async () => {
    await assert.rejects(
      providerWith(429, { code: 60202 }).verifyCode("+15005550006", "123456"),
      (error: unknown) => {
        assert.ok(error instanceof PhoneProviderRejectedError);
        assert.equal(error.neutralMessage, "Too many attempts. Please try again in a few minutes.");
        assert.equal(error.auditMetadata.reason, "max_check_attempts");
        return true;
      },
    );
  });
  await check("unknown twilio error -> plain outage Error, not a rejection", async () => {
    await assert.rejects(
      providerWith(401, { code: 20003 }).sendCode("+15005550006"),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(!(error instanceof PhoneProviderRejectedError));
        assert.match(error.message, /http 401 code 20003/);
        return true;
      },
    );
  });

  // ------------------------------------------- provider selection matrix
  console.log("phoneVerificationEnabled / provider selection matrix");
  const { phoneVerificationEnabled, phoneVerificationProviderKind } = await import(
    "../src/lib/auth/phone"
  );
  const { isPhoneVerificationEnabled } = await import("../src/lib/auth/gate");

  const ENV_KEYS = [
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_VERIFY_SERVICE_SID",
    "SUPABASE_PHONE_ENABLED",
  ] as const;
  const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  const setEnv = (values: Partial<Record<(typeof ENV_KEYS)[number], string>>) => {
    for (const key of ENV_KEYS) {
      if (values[key] === undefined) delete process.env[key];
      else process.env[key] = values[key];
    }
  };
  const twilioTrio = {
    TWILIO_ACCOUNT_SID: "AC1",
    TWILIO_AUTH_TOKEN: "tok",
    TWILIO_VERIFY_SERVICE_SID: "VA1",
  };

  try {
    setEnv(twilioTrio);
    await check("all three TWILIO_* set -> twilio (supabase flag irrelevant)", () => {
      assert.equal(phoneVerificationProviderKind(), "twilio");
      assert.equal(phoneVerificationEnabled(), true);
    });
    setEnv({ ...twilioTrio, SUPABASE_PHONE_ENABLED: "true" });
    await check("twilio wins over SUPABASE_PHONE_ENABLED=true", () => {
      assert.equal(phoneVerificationProviderKind(), "twilio");
    });
    setEnv({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "tok", SUPABASE_PHONE_ENABLED: "true" });
    await check("partial twilio env + supabase flag -> supabase", () => {
      assert.equal(phoneVerificationProviderKind(), "supabase");
      assert.equal(phoneVerificationEnabled(), true);
    });
    setEnv({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "tok" });
    await check("partial twilio env alone -> none (disabled)", () => {
      assert.equal(phoneVerificationProviderKind(), "none");
      assert.equal(phoneVerificationEnabled(), false);
    });
    setEnv({ SUPABASE_PHONE_ENABLED: "false" });
    await check("nothing configured -> none; gate alias agrees", () => {
      assert.equal(phoneVerificationProviderKind(), "none");
      assert.equal(phoneVerificationEnabled(), false);
      assert.equal(isPhoneVerificationEnabled(), false);
    });
    setEnv({ SUPABASE_PHONE_ENABLED: "true" });
    await check("supabase-only -> supabase; gate alias agrees", () => {
      assert.equal(phoneVerificationProviderKind(), "supabase");
      assert.equal(isPhoneVerificationEnabled(), true);
    });
  } finally {
    setEnv(savedEnv as Record<(typeof ENV_KEYS)[number], string>);
  }

  // -------------------------------------------------- live DB-backed policy
  const { db } = await import("../src/lib/db");
  const { resendCooldown, checkOtpVerifyBlocked, MAX_SENDS_PER_HOUR } = await import(
    "../src/lib/auth/rate-limit"
  );
  const { sha256Hash } = await import("../src/lib/auth/audit");

  const ladderEmail = testEmail("ladder");

  async function seedSends(agesSeconds: number[], phone = false) {
    await db.authVerificationEvent.deleteMany({
      where: phone ? { phoneE164: TEST_PHONE } : { email: ladderEmail },
    });
    for (const age of agesSeconds) {
      await db.authVerificationEvent.create({
        data: phone
          ? { type: "phone_otp_send", phoneE164: TEST_PHONE, createdAt: secondsAgo(age) }
          : { type: "email_otp_send", email: ladderEmail, createdAt: secondsAgo(age) },
      });
    }
  }

  try {
    console.log("resend ladder (live sliding window)");
    await check("no sends yet -> allowed, next cooldown 30s", async () => {
      await seedSends([]);
      assert.deepEqual(await resendCooldown("email", ladderEmail), {
        allowed: true,
        retryAfter: 30,
      });
    });
    await check("after send #1 -> 30s cooldown enforced", async () => {
      await seedSends([10]);
      const res = await resendCooldown("email", ladderEmail);
      assert.equal(res.allowed, false);
      assert.ok(res.retryAfter >= 15 && res.retryAfter <= 30, `retryAfter=${res.retryAfter}`);
    });
    await check("send #1 cooled down -> allowed, next cooldown 60s", async () => {
      await seedSends([40]);
      const res = await resendCooldown("email", ladderEmail);
      assert.equal(res.allowed, true);
      assert.equal(res.retryAfter, 60);
    });
    await check("after send #2 -> 60s cooldown enforced", async () => {
      await seedSends([100, 35]);
      const res = await resendCooldown("email", ladderEmail);
      assert.equal(res.allowed, false);
      assert.ok(res.retryAfter >= 20 && res.retryAfter <= 60, `retryAfter=${res.retryAfter}`);
    });
    await check("send #2 cooled down -> allowed, next cooldown 120s", async () => {
      await seedSends([200, 70]);
      const res = await resendCooldown("email", ladderEmail);
      assert.equal(res.allowed, true);
      assert.equal(res.retryAfter, 120);
    });
    await check("after send #3 -> 120s cooldown enforced", async () => {
      await seedSends([400, 300, 110]);
      const res = await resendCooldown("email", ladderEmail);
      assert.equal(res.allowed, false);
      assert.ok(res.retryAfter <= 120);
    });
    await check("after send #4 -> ladder stays at 120s", async () => {
      await seedSends([500, 400, 300, 130]);
      const res = await resendCooldown("email", ladderEmail);
      assert.equal(res.allowed, true);
      assert.equal(res.retryAfter, 120);
    });
    await check("send #6 within the hour -> blocked until the window frees", async () => {
      assert.equal(MAX_SENDS_PER_HOUR, 5);
      await seedSends([3000, 2400, 1800, 1200, 600]);
      const res = await resendCooldown("email", ladderEmail);
      assert.equal(res.allowed, false);
      assert.ok(res.retryAfter > 120 && res.retryAfter <= 3600, `retryAfter=${res.retryAfter}`);
    });
    await check("sends older than an hour do not count", async () => {
      await seedSends([3700, 3660]);
      assert.deepEqual(await resendCooldown("email", ladderEmail), {
        allowed: true,
        retryAfter: 30,
      });
    });
    await check("phone kind uses the same ladder", async () => {
      await seedSends([10], true);
      assert.equal((await resendCooldown("phone", TEST_PHONE)).allowed, false);
      await seedSends([40], true);
      const res = await resendCooldown("phone", TEST_PHONE);
      assert.equal(res.allowed, true);
      assert.equal(res.retryAfter, 60);
    });

    console.log("failure lock (5 fails / 15 min)");
    const lockEmail = testEmail("lock");
    await check("4 fails -> not locked yet", async () => {
      for (let i = 0; i < 4; i++) {
        await db.authVerificationEvent.create({
          data: { type: "otp_verify_fail", email: lockEmail },
        });
      }
      assert.equal((await checkOtpVerifyBlocked({ email: lockEmail })).ok, true);
    });
    await check("exactly 5 fails -> locked", async () => {
      await db.authVerificationEvent.create({
        data: { type: "otp_verify_fail", email: lockEmail },
      });
      const res = await checkOtpVerifyBlocked({ email: lockEmail });
      assert.equal(res.ok, false);
      assert.equal(res.reason, "verify_locked_email");
    });
    await check("otp_verify_locked audit rows never extend the lock", async () => {
      for (let i = 0; i < 5; i++) {
        await db.authVerificationEvent.create({
          data: { type: "otp_verify_locked", email: lockEmail },
        });
      }
      // still exactly 5 fails - the lock state is unchanged, and once the
      // fails age out (below) the locked rows alone keep nothing locked
      assert.equal((await checkOtpVerifyBlocked({ email: lockEmail })).ok, false);
    });
    await check("unlocks after the 15-minute window (backdated fails)", async () => {
      await db.authVerificationEvent.updateMany({
        where: { type: "otp_verify_fail", email: lockEmail },
        data: { createdAt: secondsAgo(16 * 60) },
      });
      assert.equal((await checkOtpVerifyBlocked({ email: lockEmail })).ok, true);
    });
    await check("lock also applies per phone and per IP", async () => {
      const ipHash = sha256Hash("203.0.113.77");
      for (let i = 0; i < 5; i++) {
        await db.authVerificationEvent.create({
          data: { type: "otp_verify_fail", phoneE164: TEST_PHONE, ipHash },
        });
      }
      const byPhone = await checkOtpVerifyBlocked({ phoneE164: TEST_PHONE });
      assert.equal(byPhone.ok, false);
      assert.equal(byPhone.reason, "verify_locked_phone");
      const byIp = await checkOtpVerifyBlocked({ email: testEmail("other"), ipHash });
      assert.equal(byIp.ok, false);
      assert.equal(byIp.reason, "verify_locked_ip");
    });
  } finally {
    await db.authVerificationEvent.deleteMany({
      where: {
        OR: [
          { email: { contains: "otp-policy-" } },
          { phoneE164: TEST_PHONE },
          { ipHash: sha256Hash("203.0.113.77") },
        ],
      },
    });
    await db.$disconnect();
  }

  console.log(`\n${passed} checks passed`);
}

main().catch((error) => {
  console.error("\nTEST FAILURE:", error);
  process.exit(1);
});
