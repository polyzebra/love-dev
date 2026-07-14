/**
 * Verification continue/reuse UX tests:
 *   npx tsx tests/verification-continue.test.ts
 *
 * The 2026-07-14 UX refinement: an OPEN provider session (Stripe
 * requires_input) is presented as "Complete your verification" with a
 * "Continue verification" action that REOPENS the same hosted session -
 * never minting a duplicate VerificationSession. "Verification in
 * progress" is reserved for the processing sub-state. Covers:
 *   - stripe describeSession (injected transport): url + raw sub-state
 *   - start endpoint reuses an open session (same id, nothing created)
 *   - start endpoint creates a NEW session only after a terminal state
 *   - status endpoint exposes the open-session detail
 *   - card wording matrix (source pins)
 */
import "dotenv/config";
import assert from "node:assert/strict";
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

/** The dev server resolves .env the Next.js way (LAST duplicate wins,
 *  unlike tsx/dotenv's first-wins) - so the server may run the LIVE
 *  stripe_identity provider while this process thinks "mock". HTTP
 *  verification loops must then SKIP: against live Stripe they would
 *  create real, billable VerificationSessions. */
function devServerRunsMock(base: string): boolean {
  if (!/localhost|127\.0\.0\.1/.test(base)) return false;
  // Explicit opt-in for a purpose-launched mock server (process env beats
  // .env in Next, so the .env heuristic below can't see it).
  if (process.env.TEST_ASSUME_MOCK === "1") return true;
  try {
    const env = readFileSync(path.join(process.cwd(), ".env"), "utf8");
    const matches = [...env.matchAll(/^VERIFICATION_PROVIDER\s*=\s*"?([^"\n]*)"?/gm)];
    return matches.length > 0 && matches[matches.length - 1][1].trim() === "mock";
  } catch {
    return false;
  }
}

async function main() {
  process.env.VERIFICATION_PROVIDER = "mock";
  const {
    describeProviderSession,
    getPhotoVerificationProvider,
    mockVerificationProvider,
    setStripeIdentityTransport,
  } = await import("../src/lib/services/photo-verification");
  const { db } = await import("../src/lib/db");

  console.log("stripe adapter - describeSession is read-only detail");

  await check("describeSession returns mapped status + RAW sub-state + live url", async () => {
    process.env.STRIPE_SECRET_KEY ||= "sk_test_placeholder";
    process.env.STRIPE_IDENTITY_WEBHOOK_SECRET ||= "whsec_placeholder";
    const calls: string[] = [];
    setStripeIdentityTransport(async (method, path2) => {
      calls.push(`${method} ${path2}`);
      return {
        id: "vs_open",
        status: "requires_input",
        url: "https://verify.stripe.com/start/vs_open_token",
      } as never;
    });
    try {
      process.env.VERIFICATION_PROVIDER = "stripe_identity";
      const provider = getPhotoVerificationProvider();
      assert.equal(provider.name, "stripe_identity");
      const detail = await describeProviderSession(provider, "vs_open");
      assert.deepEqual(detail, {
        status: "pending",
        providerStatus: "requires_input",
        url: "https://verify.stripe.com/start/vs_open_token",
      });
      assert.deepEqual(calls, ["GET /identity/verification_sessions/vs_open"], "one GET, no POST");
    } finally {
      setStripeIdentityTransport(null);
      process.env.VERIFICATION_PROVIDER = "mock";
    }
  });

  await check(
    "describeSession on a processing session reports the checking sub-state",
    async () => {
      setStripeIdentityTransport(
        async () => ({ id: "vs_p", status: "processing", url: null }) as never,
      );
      try {
        process.env.VERIFICATION_PROVIDER = "stripe_identity";
        const detail = await describeProviderSession(getPhotoVerificationProvider(), "vs_p");
        assert.equal(detail.status, "pending");
        assert.equal(detail.providerStatus, "processing");
        assert.equal(detail.url, null);
      } finally {
        setStripeIdentityTransport(null);
        process.env.VERIFICATION_PROVIDER = "mock";
      }
    },
  );

  await check("mock describeSession mirrors the open sub-state (no fake url)", async () => {
    const started = await mockVerificationProvider.createSession("user-x");
    const detail = await describeProviderSession(mockVerificationProvider, started.sessionId);
    assert.deepEqual(detail, { status: "pending", providerStatus: "requires_input", url: null });
  });

  console.log("card wording matrix (source pins)");

  await check("open session says Complete your verification / Continue verification", () => {
    const card = src("components", "profile", "photo-verify-card.tsx");
    assert.ok(card.includes('title="Complete your verification"'));
    assert.ok(
      card.includes(
        "Your verification session is ready. Continue with Stripe to verify your identity.",
      ),
    );
    assert.ok(card.includes("Continue verification"));
  });

  await check("processing keeps Verification in progress / Check status", () => {
    const card = src("components", "profile", "photo-verify-card.tsx");
    assert.ok(card.includes('providerStatus === "processing"'), "sub-state drives the variant");
    assert.ok(card.includes('title="Verification in progress"'));
    assert.ok(
      card.includes("We're checking your identity. This usually takes only a few minutes."),
    );
    assert.ok(card.includes("Check status"));
  });

  await check("manual review + expired wording per spec", () => {
    const card = src("components", "profile", "photo-verify-card.tsx");
    assert.ok(card.includes('title="Verification under review"'));
    assert.ok(card.includes("A member of our team is reviewing your verification."));
    assert.ok(card.includes('"Verification expired"'));
    assert.ok(card.includes("Your previous verification session expired before it was completed."));
    assert.ok(card.includes('"Start again"'));
  });

  await check("continue reopens the SAME hosted session client-side", () => {
    const card = src("components", "profile", "photo-verify-card.tsx");
    assert.ok(
      card.includes("if (openSession?.url) window.location.assign(openSession.url);"),
      "existing url is reopened directly",
    );
  });

  console.log("HTTP loop - session reuse (mock provider, dev server)");

  const up = await fetch(`${BASE}/api/health`)
    .then((r) => r.ok)
    .catch(() => false);
  if (!up) {
    skip("reuse HTTP scenarios", `dev server not reachable at ${BASE}`);
  } else if (!devServerRunsMock(BASE)) {
    skip(
      "reuse HTTP scenarios",
      "dev server provider is not mock - refusing to create real sessions",
    );
  } else {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const email = `e2e-continue-${RUN}@example.com`;
    const password = `vc-${RUN}-Aa1!`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    const uid = created.data.user!.id;
    const now = new Date();
    await db.user.create({
      data: {
        id: uid,
        email,
        name: "E2E Continue",
        emailVerified: now,
        phone: `+3538789${RUN.slice(-5)}`,
        phoneVerifiedAt: now,
        ageConfirmedAt: now,
        termsVersion: "2026-07",
        privacyVersion: "2026-07",
        communityVersion: "2026-07",
        onboardingDone: true,
      },
    });
    const token = (await anon.auth.signInWithPassword({ email, password })).data.session!
      .access_token;
    const post = () =>
      fetch(`${BASE}/api/verification/photo/start`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });

    try {
      let firstSession = "";
      await check("first start creates ONE session", async () => {
        const res = await post();
        assert.equal(res.status, 200);
        const body = (await res.json()) as { data: { sessionId: string; reused?: boolean } };
        assert.ok(body.data.sessionId.startsWith("mock_"));
        assert.notEqual(body.data.reused, true);
        firstSession = body.data.sessionId;
      });

      await check("second start REUSES the open session - no duplicate created", async () => {
        const res = await post();
        assert.equal(res.status, 200);
        const body = (await res.json()) as { data: { sessionId: string; reused?: boolean } };
        assert.equal(body.data.sessionId, firstSession, "same provider session id");
        assert.equal(body.data.reused, true);
        const row = await db.verification.findUniqueOrThrow({
          where: { userId_type: { userId: uid, type: "PHOTO" } },
        });
        assert.equal(row.providerSessionId, firstSession, "stored session untouched");
      });

      await check("status endpoint exposes the open-session sub-state", async () => {
        const res = await fetch(`${BASE}/api/verification/photo/status`, {
          headers: { authorization: `Bearer ${token}` },
        });
        assert.equal(res.status, 200);
        const body = (await res.json()) as {
          data: { state: string; session: { providerStatus: string | null } | null };
        };
        assert.equal(body.data.state, "pending");
        assert.equal(body.data.session?.providerStatus, "requires_input");
      });

      await check("after the session expires, start creates a FRESH session", async () => {
        // Expire through the real webhook (the dev server's mock map is a
        // separate process) - exactly how a canceled Stripe session lands.
        const { createHmac } = await import("node:crypto");
        const payload = JSON.stringify({ sessionId: firstSession, status: "expired" });
        const hook = await fetch(`${BASE}/api/webhooks/verification`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-verification-signature": createHmac(
              "sha256",
              process.env.VERIFICATION_WEBHOOK_SECRET!,
            )
              .update(payload)
              .digest("hex"),
          },
          body: payload,
        });
        assert.equal(hook.status, 200);
        const res = await post();
        assert.equal(res.status, 200);
        const body = (await res.json()) as { data: { sessionId: string; reused?: boolean } };
        assert.notEqual(body.data.sessionId, firstSession, "new session id");
        assert.notEqual(body.data.reused, true);
        const row = await db.verification.findUniqueOrThrow({
          where: { userId_type: { userId: uid, type: "PHOTO" } },
        });
        assert.equal(row.providerSessionId, body.data.sessionId);
        assert.equal(row.status, "PENDING");
      });
    } finally {
      await db.user.delete({ where: { id: uid } }).catch(() => {});
      await admin.auth.admin.deleteUser(uid).catch(() => {});
    }
  }

  await db.$disconnect();
  console.log(`\n${passed} checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
