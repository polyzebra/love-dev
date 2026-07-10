/**
 * Live tests for the auth hardening layer. Run with:
 *   npx tsx tests/auth-hardening.test.ts
 *
 * Talks to the real database from .env (writes are namespaced under
 * test-specific emails/phones/uuids and cleaned up in `finally`).
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

process.env.AUTH_HASH_SALT = process.env.AUTH_HASH_SALT || "test-salt";

const RUN = Date.now().toString(36);
const testEmail = (tag: string) => `auth-hardening-${tag}-${RUN}@example.com`;
const TEST_PHONE = "+15005550006";

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
  // ---------------------------------------------------------------- url.ts
  console.log("url helpers");
  const { siteUrl, authRedirectUrl } = await import("../src/lib/auth/url");
  const savedSite = process.env.NEXT_PUBLIC_SITE_URL;
  const savedVercel = process.env.VERCEL_URL;

  process.env.NEXT_PUBLIC_SITE_URL = "https://tirvea.com/";
  await check("NEXT_PUBLIC_SITE_URL wins, trailing slash trimmed", () =>
    assert.equal(siteUrl(), "https://tirvea.com"),
  );
  process.env.NEXT_PUBLIC_SITE_URL = "";
  process.env.VERCEL_URL = "preview-abc.vercel.app";
  await check("VERCEL_URL fallback gets https://", () =>
    assert.equal(siteUrl(), "https://preview-abc.vercel.app"),
  );
  delete process.env.VERCEL_URL;
  await check("localhost fallback when nothing set", () =>
    assert.equal(siteUrl(), "http://localhost:3000"),
  );
  process.env.NEXT_PUBLIC_SITE_URL = "https://tirvea.com";
  await check("authRedirectUrl joins paths (with and without slash)", () => {
    assert.equal(authRedirectUrl("/auth/callback"), "https://tirvea.com/auth/callback");
    assert.equal(authRedirectUrl("auth/callback"), "https://tirvea.com/auth/callback");
  });
  if (savedSite === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = savedSite;
  if (savedVercel === undefined) delete process.env.VERCEL_URL;
  else process.env.VERCEL_URL = savedVercel;

  // --------------------------------------------------- disposable domains
  console.log("disposable domains");
  const { isDisposableEmail } = await import("../src/lib/auth/disposable-domains");
  await check("known disposables blocked (incl. subdomains)", () => {
    assert.equal(isDisposableEmail("x@mailinator.com"), true);
    assert.equal(isDisposableEmail("X@YOPMAIL.COM"), true);
    assert.equal(isDisposableEmail("a@mx.guerrillamail.com"), true);
  });
  await check("real providers pass", () => {
    assert.equal(isDisposableEmail("me@gmail.com"), false);
    assert.equal(isDisposableEmail("me@tirvea.com"), false);
    assert.equal(isDisposableEmail("not-an-email"), false);
  });

  // ------------------------------------------------------------ gate matrix
  console.log("gate matrix");
  const { authNextStep } = await import("../src/lib/auth/gate");
  const { CURRENT_VERSIONS } = await import("../src/lib/auth/consent");
  const base = {
    status: "ACTIVE",
    bannedAt: null as Date | null,
    emailVerified: new Date(),
    phoneVerifiedAt: new Date(),
    ageConfirmedAt: new Date(),
    termsVersion: CURRENT_VERSIONS.terms as string,
    privacyVersion: CURRENT_VERSIONS.privacy as string,
    communityVersion: CURRENT_VERSIONS.community as string,
    onboardingDone: true,
  };
  await check("banned/suspended -> /account-blocked", () => {
    assert.equal(authNextStep({ ...base, bannedAt: new Date() }, true), "/account-blocked");
    assert.equal(authNextStep({ ...base, status: "SUSPENDED" }, false), "/account-blocked");
  });
  await check("unverified email -> /login (before phone/onboarding)", () => {
    assert.equal(
      authNextStep({ ...base, emailVerified: null, phoneVerifiedAt: null, onboardingDone: false }, true),
      "/login",
    );
  });
  await check("phone required only when enabled", () => {
    assert.equal(authNextStep({ ...base, phoneVerifiedAt: null }, true), "/auth/phone");
    assert.equal(authNextStep({ ...base, phoneVerifiedAt: null }, false), "/discover");
  });
  await check("onboarding then discover", () => {
    assert.equal(authNextStep({ ...base, onboardingDone: false }, true), "/onboarding");
    assert.equal(authNextStep(base, true), "/discover");
    assert.equal(authNextStep({ ...base, phoneVerifiedAt: null, onboardingDone: false }, false), "/onboarding");
  });

  // -------------------------------------------------------- flow-state errors
  console.log("callback flow-state branch");
  const { isFlowStateError } = await import("../src/lib/auth/flow-error");
  await check("consumed/stale code errors detected (2nd GET with same code)", () => {
    assert.equal(isFlowStateError({ code: "flow_state_not_found", message: "" }), true);
    assert.equal(isFlowStateError({ code: "flow_state_expired", message: "" }), true);
    assert.equal(isFlowStateError({ code: "bad_code_verifier", message: "" }), true);
    assert.equal(isFlowStateError({ message: "invalid flow state, no valid flow state found" }), true);
    assert.equal(
      isFlowStateError({ message: "invalid request: both auth code and code verifier should be non-empty" }),
      true,
    );
  });
  await check("unrelated auth errors are NOT treated as expired links", () => {
    assert.equal(isFlowStateError({ code: "user_banned", message: "banned" }), false);
    assert.equal(isFlowStateError(null), false);
    assert.equal(isFlowStateError(undefined), false);
  });

  // ------------------------------------------------- live DB-backed pieces
  const { db } = await import("../src/lib/db");
  const { recordAuthEvent, sha256Hash, ipHashFrom } = await import("../src/lib/auth/audit");
  const { resendCooldown, checkOtpSendIpLimit, checkOtpVerifyBlocked } = await import(
    "../src/lib/auth/rate-limit"
  );
  const { ensureAppUser } = await import("../src/lib/auth/identity");

  const cleanupEmails: string[] = [];
  const cleanupUserIds: string[] = [];

  try {
    console.log("audit events (live)");
    const auditEmail = testEmail("audit");
    cleanupEmails.push(auditEmail);
    const req = fakeReq("203.0.113.9");
    await recordAuthEvent({ type: "email_otp_send", email: auditEmail, req, metadata: { t: 1 } });
    const row = await db.authVerificationEvent.findFirst({ where: { email: auditEmail } });
    await check("recordAuthEvent writes hashed ip/ua, never raw", () => {
      assert.ok(row);
      assert.equal(row!.type, "email_otp_send");
      assert.equal(row!.ipHash, sha256Hash("203.0.113.9")); // first XFF hop only
      assert.equal(row!.userAgentHash, sha256Hash("test-agent/1.0"));
      assert.notEqual(row!.ipHash, "203.0.113.9");
    });

    console.log("rate limits (live sliding windows)");
    const minutesAgo = (m: number) => new Date(Date.now() - m * 60 * 1000);
    const rlEmail = testEmail("rl");
    cleanupEmails.push(rlEmail);
    // 4 sends spread over the hour, ladder cooldowns all elapsed
    for (const m of [50, 40, 30, 20]) {
      await db.authVerificationEvent.create({
        data: { type: "email_otp_send", email: rlEmail, createdAt: minutesAgo(m) },
      });
    }
    await check("email send allowed at 4/5 (ladder elapsed)", async () => {
      assert.equal((await resendCooldown("email", rlEmail)).allowed, true);
    });
    await db.authVerificationEvent.create({
      data: { type: "email_otp_send", email: rlEmail, createdAt: minutesAgo(9) },
    });
    await check("email send blocked at 5/5 per email (hourly cap)", async () => {
      const res = await resendCooldown("email", rlEmail);
      assert.equal(res.allowed, false);
      assert.ok(res.retryAfter > 120); // capped for the window, not just the ladder
    });
    const ipHash = ipHashFrom(fakeReq("198.51.100.7"))!;
    const ipEmailPrefix = testEmail("iprl");
    for (let i = 0; i < 10; i++) {
      await db.authVerificationEvent.create({
        data: { type: "email_otp_send", email: `${i}.${ipEmailPrefix}`, ipHash },
      });
    }
    cleanupEmails.push(ipEmailPrefix);
    await check("email send blocked at 10/h per IP across emails", async () => {
      const res = await checkOtpSendIpLimit(ipHash);
      assert.equal(res.ok, false);
      assert.equal(res.reason, "ip_hourly");
    });
    for (let i = 0; i < 5; i++) {
      await db.authVerificationEvent.create({
        data: {
          type: "phone_otp_send",
          phoneE164: TEST_PHONE,
          email: testEmail("phone-rl"),
          createdAt: minutesAgo(30),
        },
      });
    }
    await check("phone send blocked at 5/h per number", async () => {
      assert.equal((await resendCooldown("phone", TEST_PHONE)).allowed, false);
    });
    const failEmail = testEmail("fails");
    cleanupEmails.push(failEmail);
    for (let i = 0; i < 5; i++) {
      await db.authVerificationEvent.create({ data: { type: "otp_verify_fail", email: failEmail } });
    }
    await check("verification locked after 5 fails/15min", async () => {
      assert.equal((await checkOtpVerifyBlocked({ email: failEmail })).ok, false);
      assert.equal((await checkOtpVerifyBlocked({ email: testEmail("clean") })).ok, true);
    });

    console.log("ensureAppUser (live identity rules)");
    const uid = randomUUID();
    const email = testEmail("ensure");
    cleanupEmails.push(email);
    cleanupUserIds.push(uid);
    const supaUser = {
      id: uid,
      email,
      email_confirmed_at: new Date().toISOString(),
      app_metadata: { provider: "email" },
      user_metadata: { full_name: "Test Ensure" },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const created = await ensureAppUser(supaUser, { req: fakeReq("192.0.2.1") });
    await check("new auth uid -> new app row with login stamps", () => {
      assert.equal(created.ok, true);
      if (!created.ok) return;
      assert.equal(created.created, true);
      assert.equal(created.user.id, uid);
      assert.equal(created.user.email, email);
      assert.ok(created.user.emailVerified);
      assert.equal(created.user.lastLoginIpHash, sha256Hash("192.0.2.1"));
    });

    const again = await ensureAppUser(supaUser, { req: fakeReq("192.0.2.2") });
    await check("same uid again -> reused row, previous ip hash surfaced", () => {
      assert.equal(again.ok, true);
      if (!again.ok) return;
      assert.equal(again.created, false);
      assert.equal(again.previousLoginIpHash, sha256Hash("192.0.2.1"));
      assert.equal(again.user.lastLoginIpHash, sha256Hash("192.0.2.2"));
    });

    await db.user.update({ where: { id: uid }, data: { status: "DEACTIVATED", deletionRequested: new Date() } });
    const reactivated = await ensureAppUser(supaUser, { req: fakeReq("192.0.2.3") });
    await check("DEACTIVATED (grace window) -> reactivated by sign-in", () => {
      assert.equal(reactivated.ok, true);
      if (!reactivated.ok) return;
      assert.equal(reactivated.user.status, "ACTIVE");
      assert.equal(reactivated.user.deletionRequested, null);
    });

    await db.user.update({ where: { id: uid }, data: { status: "SUSPENDED" } });
    const suspended = await ensureAppUser(supaUser, { req: fakeReq("192.0.2.4") });
    await check("SUSPENDED -> rejected", () => {
      assert.deepEqual(suspended, { ok: false, reason: "suspended" });
    });
    await db.user.update({ where: { id: uid }, data: { status: "ACTIVE" } });

    const blockedEmail = testEmail("blocked");
    cleanupEmails.push(blockedEmail);
    await db.blockedIdentity.create({ data: { email: blockedEmail, reason: "test" } });
    const blockedUid = randomUUID();
    cleanupUserIds.push(blockedUid);
    const blocked = await ensureAppUser(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ...supaUser, id: blockedUid, email: blockedEmail } as any,
      { req: fakeReq("192.0.2.5") },
    );
    await check("blocked identity -> rejected, no app row", async () => {
      assert.deepEqual(blocked, { ok: false, reason: "blocked" });
      assert.equal(await db.user.findUnique({ where: { id: blockedUid } }), null);
    });
    await db.blockedIdentity.delete({ where: { email: blockedEmail } });

    // Orphan takeover: email held by an app row whose auth user is gone
    const orphanId = randomUUID();
    const newUid = randomUUID();
    cleanupUserIds.push(orphanId, newUid);
    await db.user.delete({ where: { id: uid } }); // free the email first
    await db.user.create({ data: { id: orphanId, email } }); // email now held by orphan
    const takeover = await ensureAppUser(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ...supaUser, id: newUid } as any,
      { req: fakeReq("192.0.2.6") },
    );
    await check("orphaned email holder torn down, new identity starts fresh", async () => {
      assert.equal(takeover.ok, true);
      if (!takeover.ok) return;
      assert.equal(takeover.created, true);
      assert.equal(takeover.user.id, newUid);
      const orphan = await db.user.findUnique({ where: { id: orphanId } });
      assert.equal(orphan?.status, "DELETED");
      assert.ok(orphan?.email.startsWith("deleted+"));
    });
  } finally {
    // ------------------------------------------------------------- cleanup
    await db.authVerificationEvent.deleteMany({
      where: {
        OR: [
          { email: { contains: `auth-hardening-` } },
          { phoneE164: TEST_PHONE },
        ],
      },
    });
    await db.blockedIdentity.deleteMany({ where: { email: { contains: "auth-hardening-" } } });
    await db.user.deleteMany({
      where: {
        OR: [
          { id: { in: cleanupUserIds } },
          { email: { contains: "auth-hardening-" } },
          { email: { in: cleanupUserIds.map((id) => `deleted+${id}@tombstone.tirvea.app`) } },
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
