/**
 * Photo verification go-live tests (Stripe Identity + UX unification):
 *   npx tsx tests/photo-verification.test.ts
 *
 * Live lane: real Supabase credentials + the dev server on :3000 for the
 * HTTP loop (skips those with a notice when unreachable). The Stripe
 * Identity adapter itself is exercised through the injected transport
 * seam - no network, real signature scheme. Covers the required matrix:
 * configuration gates, session start (auth/409/persistence/overposting),
 * status mapping, webhook signature + unrelated-event + idempotency
 * behavior, UX/navigation source pins, and the FULL mock-provider loop:
 * start -> webhook approved -> canonical verdict -> badge eligibility ->
 * restart 409.
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const RUN = Date.now().toString(36);
const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}
function skip(name: string, why: string) {
  console.log(`  skip - ${name} (${why})`);
}
const src = (...parts: string[]) => readFileSync(path.join(process.cwd(), "src", ...parts), "utf8");

/** Stripe-Signature header exactly as Stripe builds it. */
function stripeSig(rawBody: string, secret: string, at = new Date()): string {
  const t = Math.floor(at.getTime() / 1000);
  const v1 = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

async function main() {
  const {
    getPhotoVerificationProvider,
    isPhotoVerificationConfigured,
    setStripeIdentityTransport,
    mapStripeIdentityStatus,
    isFinalRejection,
    deriveVerificationUxState,
    notConfiguredProvider,
    VerificationWebhookError,
  } = await import("../src/lib/services/photo-verification");

  const savedEnv = {
    provider: process.env.VERIFICATION_PROVIDER,
    idSecret: process.env.STRIPE_IDENTITY_WEBHOOK_SECRET,
    stripeKey: process.env.STRIPE_SECRET_KEY,
    nodeEnv: process.env.NODE_ENV,
  };
  const restoreEnv = () => {
    process.env.VERIFICATION_PROVIDER = savedEnv.provider;
    process.env.STRIPE_IDENTITY_WEBHOOK_SECRET = savedEnv.idSecret;
    process.env.STRIPE_SECRET_KEY = savedEnv.stripeKey;
    (process.env as Record<string, string | undefined>).NODE_ENV = savedEnv.nodeEnv;
  };

  console.log("configuration gates");

  await check("no VERIFICATION_PROVIDER -> not configured", () => {
    delete process.env.VERIFICATION_PROVIDER;
    assert.equal(getPhotoVerificationProvider(), notConfiguredProvider);
    assert.equal(isPhotoVerificationConfigured(), false);
    restoreEnv();
  });

  await check("stripe_identity WITHOUT the identity webhook secret -> not configured", () => {
    process.env.VERIFICATION_PROVIDER = "stripe_identity";
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    delete process.env.STRIPE_IDENTITY_WEBHOOK_SECRET;
    assert.equal(getPhotoVerificationProvider(), notConfiguredProvider, "no partial availability");
    restoreEnv();
  });

  await check("stripe_identity with FULL config -> configured", () => {
    process.env.VERIFICATION_PROVIDER = "stripe_identity";
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_IDENTITY_WEBHOOK_SECRET = "whsec_test";
    assert.equal(getPhotoVerificationProvider().name, "stripe_identity");
    assert.equal(isPhotoVerificationConfigured(), true);
    restoreEnv();
  });

  await check("mock provider is refused in production", () => {
    process.env.VERIFICATION_PROVIDER = "mock";
    (process.env as Record<string, string>).NODE_ENV = "production";
    assert.equal(getPhotoVerificationProvider(), notConfiguredProvider);
    restoreEnv();
  });

  console.log("stripe identity adapter (injected transport, real signatures)");

  process.env.VERIFICATION_PROVIDER = "stripe_identity";
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
  process.env.STRIPE_IDENTITY_WEBHOOK_SECRET = "whsec_identity_test";
  const stripe = getPhotoVerificationProvider();

  await check("createSession: document+selfie session, minimal metadata, hosted url", async () => {
    const calls: Array<{ method: string; path: string; params?: Record<string, string> }> = [];
    setStripeIdentityTransport(async (method, path_, params) => {
      calls.push({ method, path: path_, params });
      return { id: "vs_test_123", status: "requires_input", url: "https://verify.stripe.com/x" };
    });
    try {
      const session = await stripe.createSession("user_abc");
      assert.equal(session.sessionId, "vs_test_123");
      assert.equal(session.url, "https://verify.stripe.com/x");
      const call = calls[0];
      assert.equal(call.method, "POST");
      assert.equal(call.path, "/identity/verification_sessions");
      assert.equal(call.params?.type, "document");
      assert.equal(call.params?.["options[document][require_matching_selfie]"], "true");
      assert.equal(call.params?.["metadata[tirvea_user_id]"], "user_abc");
      const metaKeys = Object.keys(call.params ?? {}).filter((k) => k.startsWith("metadata["));
      assert.deepEqual(metaKeys, ["metadata[tirvea_user_id]"], "no email/phone/PII in metadata");
      assert.ok(call.params?.return_url?.endsWith("/profile#photo-verification"));
    } finally {
      setStripeIdentityTransport(null);
    }
  });

  await check("status mapping covers every Stripe state", () => {
    assert.equal(mapStripeIdentityStatus({ status: "verified" }), "approved");
    assert.equal(mapStripeIdentityStatus({ status: "processing" }), "pending");
    assert.equal(mapStripeIdentityStatus({ status: "canceled" }), "expired");
    assert.equal(
      mapStripeIdentityStatus({
        status: "requires_input",
        last_error: { code: "selfie_face_mismatch" },
      }),
      "rejected",
    );
    assert.equal(
      mapStripeIdentityStatus({ status: "requires_input", last_error: null }),
      "pending",
      "unfinished flow is never a verdict",
    );
  });

  await check("webhook: valid Stripe signature accepted and mapped", async () => {
    const body = JSON.stringify({
      type: "identity.verification_session.verified",
      data: { object: { id: "vs_evt_1", status: "verified" } },
    });
    const event = await stripe.handleWebhook({
      rawBody: body,
      signature: stripeSig(body, "whsec_identity_test"),
    });
    assert.deepEqual(event, { sessionId: "vs_evt_1", status: "approved" });
  });

  await check("webhook: invalid signature -> bad_signature (no mutation path)", async () => {
    const body = JSON.stringify({ type: "identity.verification_session.verified" });
    await assert.rejects(
      () => stripe.handleWebhook({ rawBody: body, signature: stripeSig(body, "wrong_secret") }),
      (e: unknown) => e instanceof VerificationWebhookError && e.code === "bad_signature",
    );
  });

  await check("webhook: unrelated Stripe event is safely ignored (no-op outcome)", async () => {
    const body = JSON.stringify({
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_123", status: "succeeded" } },
    });
    const event = await stripe.handleWebhook({
      rawBody: body,
      signature: stripeSig(body, "whsec_identity_test"),
    });
    assert.equal(event.status, "pending", "'pending' short-circuits applyVerificationOutcome");
  });

  await check(
    "webhook: requires_input WITH last_error -> rejected; canceled -> expired",
    async () => {
      const rejected = JSON.stringify({
        type: "identity.verification_session.requires_input",
        data: {
          object: {
            id: "vs_evt_2",
            status: "requires_input",
            last_error: { code: "consent_declined" },
          },
        },
      });
      const expired = JSON.stringify({
        type: "identity.verification_session.canceled",
        data: { object: { id: "vs_evt_3", status: "canceled" } },
      });
      assert.equal(
        (
          await stripe.handleWebhook({
            rawBody: rejected,
            signature: stripeSig(rejected, "whsec_identity_test"),
          })
        ).status,
        "rejected",
      );
      assert.equal(
        (
          await stripe.handleWebhook({
            rawBody: expired,
            signature: stripeSig(expired, "whsec_identity_test"),
          })
        ).status,
        "expired",
      );
    },
  );
  restoreEnv();

  console.log("state rules");

  await check("isFinalRejection is the ONE finality rule; provider rejections retry", () => {
    assert.equal(isFinalRejection("provider:stripe_identity webhook -> rejected"), false);
    assert.equal(isFinalRejection("manual review: final - fraudulent document"), true);
    assert.equal(isFinalRejection(null), false);
    assert.equal(
      deriveVerificationUxState({
        photoVerifiedAt: null,
        verification: {
          status: "REJECTED",
          providerSessionId: "x",
          reviewNote: "provider:mock webhook -> rejected",
        },
      }),
      "retry_available",
    );
    assert.equal(
      deriveVerificationUxState({
        photoVerifiedAt: null,
        verification: { status: "REJECTED", providerSessionId: "x", reviewNote: "final" },
      }),
      "failed",
    );
  });

  console.log("ux / navigation source pins");

  await check("profile photo row anchors in-page; no circular Settings hop", () => {
    const page = src("app", "(app)", "profile", "page.tsx");
    // Since the consistency fix the row comes from the ONE shared mapper
    // (photoVerificationRow, surface "profile" -> #photo-verification) -
    // pin the mapper usage instead of the old literal tuple.
    assert.ok(
      page.includes("photoVerificationRow(verificationUx"),
      "canonical mapper drives the row",
    );
    assert.ok(page.includes('surface: "profile"'), "profile surface anchors in-page");
    assert.ok(!page.includes('["photo", "Photo verified"'), "boolean-derived row stays gone");
  });

  await check(
    "settings action deep-links to /profile#photo-verification; quiet when unconfigured",
    () => {
      const page = src("app", "(app)", "settings", "account", "page.tsx");
      assert.ok(page.includes('"/profile#photo-verification"'));
      assert.ok(!page.includes('href: "/profile" }'), "bare /profile hop removed");
      assert.ok(page.includes("isPhotoVerificationConfigured"), "availability-aware");
      assert.ok(page.includes('"Coming soon"'), "honest unavailable value");
    },
  );

  await check("one PhotoVerifyCard flow; stable focusable anchor; no timeouts", () => {
    const card = src("components", "profile", "photo-verify-card.tsx");
    assert.ok(card.includes('PHOTO_VERIFICATION_ANCHOR = "photo-verification"'));
    assert.ok(card.includes("tabIndex={-1}"), "programmatic focus target");
    assert.ok(card.includes("focus({ preventScroll: true })"), "focus moved accessibly");
    assert.ok(!card.includes("setTimeout"), "no timeout-based anchor hacks");
    const profile = src("app", "(app)", "profile", "page.tsx");
    assert.equal((profile.match(/<PhotoVerifyCard/g) ?? []).length, 1, "exactly one flow");
  });

  await check("shared badge + shared status row adopted", () => {
    assert.ok(src("components", "explore", "person-card.tsx").includes("VerifiedBadge"));
    assert.ok(src("components", "app", "profile-peek.tsx").includes("VerifiedBadge"));
    for (const f of [
      ["app", "(app)", "profile", "page.tsx"],
      ["app", "(app)", "settings", "account", "page.tsx"],
    ] as const) {
      assert.ok(src(...f).includes("VerificationStatusRow"), f.join("/"));
    }
  });

  // ------------------------------------------------------------------------
  // Full HTTP loop with the mock provider (dev server required)
  // ------------------------------------------------------------------------
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { db } = await import("../src/lib/db");

  const reachable = await fetch(`${BASE}/api/health`).then(
    (r) => r.ok,
    () => false,
  );
  const devMockReady =
    reachable && (await fetch(`${BASE}/api/verification/photo/status`)).status === 401;
  if (!reachable) {
    skip("HTTP loop", "dev server not running");
    await db.$disconnect();
    console.log(`\n${passed} checks passed`);
    return;
  }
  void devMockReady;

  const email = `pv-${RUN}@example.com`;
  const password = `pv-test-${RUN}-Aa1!`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const uid = created.data.user!.id;
  const now = new Date();
  await db.user.create({
    data: {
      id: uid,
      email,
      name: "PV Tester",
      emailVerified: now,
      phone: `+3538785${RUN.slice(-5)}`,
      phoneVerifiedAt: now,
      ageConfirmedAt: now,
      termsVersion: "2026-07",
      privacyVersion: "2026-07",
      communityVersion: "2026-07",
      onboardingDone: true,
    },
  });
  const anon = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const token = (await anon.auth.signInWithPassword({ email, password })).data.session!
    .access_token;

  const api = (
    method: string,
    pathName: string,
    opts: { auth?: boolean; body?: string; headers?: Record<string, string> } = {},
  ) =>
    fetch(`${BASE}${pathName}`, {
      method,
      headers: {
        ...(opts.auth === false ? {} : { authorization: `Bearer ${token}` }),
        ...(opts.body ? { "content-type": "application/json" } : {}),
        ...(opts.headers ?? {}),
      },
      body: opts.body,
    });

  try {
    console.log("http loop (mock provider on the dev server)");

    await check("unauthenticated start -> 401", async () => {
      const res = await api("POST", "/api/verification/photo/start", { auth: false });
      assert.equal(res.status, 401);
    });

    let sessionId = "";
    await check("start: session persisted + PHOTO row PENDING (client body ignored)", async () => {
      const res = await api("POST", "/api/verification/photo/start", {
        // Over-posting attempt: the route derives the user from the
        // session and reads NOTHING from the body.
        body: JSON.stringify({ userId: "someone-else" }),
      });
      if (res.status === 503) {
        skip("start loop", "dev server has no VERIFICATION_PROVIDER=mock");
        return;
      }
      assert.equal(res.status, 200);
      const { data } = (await res.json()) as { data: { sessionId: string } };
      sessionId = data.sessionId;
      assert.ok(sessionId.startsWith("mock_"));
      const [userRow, verifRow] = await Promise.all([
        db.user.findUniqueOrThrow({ where: { id: uid } }),
        db.verification.findUniqueOrThrow({
          where: { userId_type: { userId: uid, type: "PHOTO" } },
        }),
      ]);
      assert.equal(userRow.photoVerificationSession, sessionId);
      assert.equal(userRow.photoVerificationProvider, "mock");
      assert.equal(verifRow.status, "PENDING");
      assert.equal(verifRow.providerSessionId, sessionId);
    });

    if (sessionId) {
      const mockSecret = process.env.VERIFICATION_WEBHOOK_SECRET?.trim() ?? "";
      const webhook = (payload: string, sig: string) =>
        api("POST", "/api/webhooks/verification", {
          auth: false,
          body: payload,
          headers: { "x-verification-signature": sig },
        });
      const hmac = (body: string) => createHmac("sha256", mockSecret).update(body).digest("hex");

      await check("webhook with a bad signature -> 401, nothing mutates", async () => {
        const body = JSON.stringify({ sessionId, status: "approved" });
        const res = await webhook(body, "deadbeef");
        assert.equal(res.status, 401);
        const row = await db.verification.findUniqueOrThrow({
          where: { userId_type: { userId: uid, type: "PHOTO" } },
        });
        assert.equal(row.status, "PENDING", "state unchanged after forged webhook");
      });

      await check("approved webhook -> canonical verdict + badge eligibility", async () => {
        if (!mockSecret) return skip("approved webhook", "VERIFICATION_WEBHOOK_SECRET unset");
        const body = JSON.stringify({ sessionId, status: "approved" });
        const res = await webhook(body, hmac(body));
        assert.equal(res.status, 200);
        const [userRow, verifRow] = await Promise.all([
          db.user.findUniqueOrThrow({ where: { id: uid } }),
          db.verification.findUniqueOrThrow({
            where: { userId_type: { userId: uid, type: "PHOTO" } },
          }),
        ]);
        assert.ok(userRow.photoVerifiedAt, "User.photoVerifiedAt stamped (canonical)");
        assert.equal(verifRow.status, "APPROVED");
      });

      await check("duplicate approved webhook is idempotent (no double side effects)", async () => {
        if (!mockSecret) return skip("duplicate webhook", "secret unset");
        const before = await db.notification.count({
          where: { userId: uid, type: "PROFILE_VERIFIED" },
        });
        const body = JSON.stringify({ sessionId, status: "approved" });
        const res = await webhook(body, hmac(body));
        assert.equal(res.status, 200);
        const payload = (await res.json()) as { applied: boolean; reason?: string };
        assert.equal(payload.applied, false);
        assert.equal(payload.reason, "already_applied");
        const after = await db.notification.count({
          where: { userId: uid, type: "PROFILE_VERIFIED" },
        });
        assert.equal(after, before, "no duplicate notification");
      });

      await check("restart after verification -> 409 already_verified", async () => {
        const res = await api("POST", "/api/verification/photo/start");
        assert.equal(res.status, 409);
        const body = (await res.json()) as { error?: { code?: string } };
        assert.equal(body.error?.code, "already_verified");
      });

      await check("status endpoint reports the verified state", async () => {
        const res = await api("GET", "/api/verification/photo/status");
        assert.equal(res.status, 200);
        const { data } = (await res.json()) as { data: { state: string } };
        assert.equal(data.state, "verified");
      });
    }

    console.log(`\n${passed} checks passed`);
  } finally {
    await db.user.delete({ where: { id: uid } }).catch(() => {});
    await admin.auth.admin.deleteUser(uid).catch(() => {});
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error("\nFAILED:", error);
  process.exitCode = 1;
});
