/**
 * Live tests for the identity invariants behind the "two emails = two
 * accounts" support case (docs/IDENTITY.md). Run with:
 *   npx tsx tests/identity-invariants.test.ts
 *
 * Talks to the real database from .env. Users and audit events are
 * namespaced per run and removed in `finally`. SMS never leaves the
 * building - phone flows inject a spy provider.
 *
 * The matrix (mirrors the live incident: Google=email1, OTP=email2):
 *   1. Two different emails -> two canonical accounts; User.id === auth uid
 *   2. Account B verifies a phone; the gate skips /auth/phone for B on
 *      EVERY later entry path (email OTP and Google resolve the same row)
 *   3. B retries its own number -> already_verified (no provider call)
 *   4. Account A tries B's number -> duplicate_phone naming B as holder
 *   5. ensureAppUser's update path NEVER touches phone columns
 *      (before/after snapshot across an email- and a google-provider login)
 *      and never creates a second row for an existing uid
 *   6. Concurrent first login for one brand-new uid -> exactly one row
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { User as SupabaseAuthUser } from "@supabase/supabase-js";

process.env.AUTH_HASH_SALT = process.env.AUTH_HASH_SALT || "test-salt";

const RUN = Date.now().toString(36);
const testEmail = (tag: string) => `identity-inv-${tag}-${RUN}@example.com`;

// Valid Irish mobiles reserved for tests (never real users').
const NUMBER = "+353861234601";

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

/** Minimal Supabase auth-user stub accepted by ensureAppUser. */
function authUser(id: string, email: string, provider: "email" | "google"): SupabaseAuthUser {
  return {
    id,
    email,
    email_confirmed_at: new Date().toISOString(),
    app_metadata: { provider, providers: [provider] },
    user_metadata: {},
    aud: "authenticated",
    created_at: new Date().toISOString(),
  } as unknown as SupabaseAuthUser;
}

async function main() {
  const { db } = await import("../src/lib/db");
  const { ensureAppUser } = await import("../src/lib/auth/identity");
  const { sendPhoneVerification, confirmPhoneVerification } = await import(
    "../src/lib/auth/phone-flow"
  );
  const { authNextStep } = await import("../src/lib/auth/gate");
  type Provider = import("../src/lib/auth/phone").PhoneVerificationProvider;

  function spyProvider() {
    const calls: string[] = [];
    const provider: Provider = {
      async sendCode(p) {
        calls.push(`send:${p}`);
      },
      async verifyCode() {
        calls.push("verify");
        return "approved" as const;
      },
    };
    return { provider, calls };
  }

  const emails = {
    a: testEmail("google-only"), // the "Account A" of the incident
    b: testEmail("otp-plus-phone"), // the "Account B" that owns the phone
    race: testEmail("first-login-race"),
  };
  const ids = { a: randomUUID(), b: randomUUID(), race: randomUUID() };

  try {
    // ------------------------------------------------------------ case 1
    console.log("1. two different emails -> two canonical accounts");
    await check("both created; User.id === auth uid on each (same-column invariant)", async () => {
      const a = await ensureAppUser(authUser(ids.a, emails.a, "google"));
      const b = await ensureAppUser(authUser(ids.b, emails.b, "email"));
      assert.ok(a.ok && a.created && b.ok && b.created);
      assert.equal(a.user.id, ids.a, "app User.id IS the auth uid (A)");
      assert.equal(b.user.id, ids.b, "app User.id IS the auth uid (B)");
      assert.notEqual(a.user.id, b.user.id, "different emails never share an account");
    });

    // ------------------------------------------------------------ case 2
    console.log("2. B verifies a phone; the gate skips /auth/phone on every entry path");
    await check("verify stamps B's row; gate no longer routes to /auth/phone", async () => {
      const spy = spyProvider();
      const sent = await sendPhoneVerification({
        user: { id: ids.b, bannedAt: null, status: "ACTIVE" },
        phone: NUMBER,
        provider: spy.provider,
      });
      assert.equal(sent.kind, "sent");
      const verified = await confirmPhoneVerification({
        user: { id: ids.b },
        phone: NUMBER,
        code: "123456",
        provider: spy.provider,
      });
      assert.equal(verified.kind, "verified");
      const row = await db.user.findUniqueOrThrow({ where: { id: ids.b } });
      assert.equal(row.phoneE164, NUMBER);
      assert.ok(row.phoneVerifiedAt);
      // phoneEnabled=true: the verified row's next step must never be phone
      assert.notEqual(authNextStep(row, true), "/auth/phone");
    });
    await check("email-OTP and Google logins resolve the SAME row -> both skip phone", async () => {
      for (const provider of ["email", "google"] as const) {
        const again = await ensureAppUser(authUser(ids.b, emails.b, provider));
        assert.ok(again.ok && !again.created, `${provider} login reuses the row`);
        assert.equal(again.user.id, ids.b);
        assert.ok(again.user.phoneVerifiedAt, `${provider}: phoneVerifiedAt survives login`);
        assert.notEqual(authNextStep(again.user, true), "/auth/phone");
      }
    });

    // ------------------------------------------------------------ case 3
    console.log("3. B retries its own number");
    await check("own number -> already_verified, ZERO provider calls", async () => {
      const spy = spyProvider();
      const outcome = await sendPhoneVerification({
        user: { id: ids.b, bannedAt: null, status: "ACTIVE" },
        phone: NUMBER,
        provider: spy.provider,
      });
      assert.equal(outcome.kind, "already_verified");
      assert.equal(spy.calls.length, 0);
    });

    // ------------------------------------------------------------ case 4
    console.log("4. A tries B's number");
    await check("duplicate_phone naming B as holder, ZERO provider calls", async () => {
      const spy = spyProvider();
      const send = await sendPhoneVerification({
        user: { id: ids.a, bannedAt: null, status: "ACTIVE" },
        phone: NUMBER,
        provider: spy.provider,
      });
      assert.equal(send.kind, "duplicate_phone");
      assert.ok(send.kind === "duplicate_phone" && send.holderId === ids.b, "holderId = B");
      const verify = await confirmPhoneVerification({
        user: { id: ids.a },
        phone: NUMBER,
        code: "123456",
        provider: spy.provider,
      });
      assert.equal(verify.kind, "duplicate_phone");
      assert.ok(verify.kind === "duplicate_phone" && verify.holderId === ids.b, "holderId = B");
      assert.equal(spy.calls.length, 0, "provider must never be reached");
    });

    // ------------------------------------------------------------ case 5
    console.log("5. ensureAppUser update path is phone-safe and row-stable");
    await check("phone columns byte-identical across email AND google re-logins", async () => {
      const before = await db.user.findUniqueOrThrow({ where: { id: ids.b } });
      for (const provider of ["email", "google"] as const) {
        const result = await ensureAppUser(authUser(ids.b, emails.b, provider));
        assert.ok(result.ok && !result.created, `${provider}: reuses, never re-creates`);
      }
      const after = await db.user.findUniqueOrThrow({ where: { id: ids.b } });
      assert.equal(after.phoneE164, before.phoneE164);
      assert.equal(after.phone, before.phone);
      assert.equal(after.phoneCountryIso, before.phoneCountryIso);
      assert.equal(after.phoneDialCode, before.phoneDialCode);
      assert.equal(after.phoneVerifiedAt?.getTime(), before.phoneVerifiedAt?.getTime());
      assert.equal(after.phoneVerified?.getTime(), before.phoneVerified?.getTime());
      assert.equal(after.authCompleted, before.authCompleted);
    });
    await check("exactly one row per uid and per email", async () => {
      assert.equal(await db.user.count({ where: { id: ids.b } }), 1);
      assert.equal(await db.user.count({ where: { email: emails.b } }), 1);
    });

    // ------------------------------------------------------------ case 6
    console.log("6. concurrent first login - single row");
    await check("two simultaneous first logins for one uid -> exactly one row", async () => {
      const results = await Promise.all([
        ensureAppUser(authUser(ids.race, emails.race, "email")),
        ensureAppUser(authUser(ids.race, emails.race, "google")),
      ]);
      assert.ok(
        results.every((r) => r.ok && r.user.id === ids.race),
        "BOTH logins land (the race loser adopts the winner's row, never errors)",
      );
      assert.equal(
        results.filter((r) => r.ok && r.created).length,
        1,
        "exactly one login reports created=true",
      );
      const rows = await db.user.findMany({ where: { email: emails.race } });
      assert.equal(rows.length, 1, "exactly one app row exists");
      assert.equal(rows[0].id, ids.race);
    });

    console.log(`\n${passed} checks passed`);
  } finally {
    await db.user
      .deleteMany({ where: { email: { contains: "identity-inv-" } } })
      .catch(() => {});
    await db.authVerificationEvent
      .deleteMany({
        where: {
          OR: [{ phoneE164: NUMBER }, { userId: { in: Object.values(ids) } }],
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
