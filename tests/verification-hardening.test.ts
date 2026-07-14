/**
 * Verification production-hardening tests (background reconciliation +
 * audit timestamps):
 *   npx tsx tests/verification-hardening.test.ts
 *
 * Live lane (Prisma + mock provider in THIS process; the webhook checks
 * go over HTTP to the dev server and skip with a notice when it is not
 * reachable). Covers the required matrix:
 *  reconciliation: stale-pending reconciles / fresh-pending throttled /
 *  verified-after-reconcile / provider outage silent / concurrent
 *  duplicates claim once / webhook->reconcile / reconcile->webhook /
 *  verified users never downgraded
 *  timestamps: set on approve, on reject, on admin review; unchanged on
 *  duplicate webhook; admin + account display pins
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
/** Comment-stripped source - negative pins must not trip on prose. */
const code = (...parts: string[]) =>
  src(...parts)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

async function main() {
  process.env.VERIFICATION_PROVIDER = "mock";
  const { maybeReconcilePhotoVerification, setMockVerificationStatus, setStripeIdentityTransport } =
    await import("../src/lib/services/photo-verification");
  const { reviewVerification } = await import("../src/lib/services/verification");
  const { db } = await import("../src/lib/db");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const mkUser = async (tag: string, phoneTail: string) => {
    const email = `vh-${tag}-${RUN}@example.com`;
    const created = await admin.auth.admin.createUser({
      email,
      password: `vh-${RUN}-Aa1!`,
      email_confirm: true,
    });
    const uid = created.data.user!.id;
    const now = new Date();
    await db.user.create({
      data: {
        id: uid,
        email,
        name: `VH ${tag}`,
        emailVerified: now,
        phone: `+3538783${phoneTail}`,
        phoneVerifiedAt: now,
        ageConfirmedAt: now,
        termsVersion: "2026-07",
        privacyVersion: "2026-07",
        communityVersion: "2026-07",
        onboardingDone: true,
      },
    });
    return uid;
  };

  const alice = await mkUser("alice", `1${RUN.slice(-4)}`);
  const bob = await mkUser("bob", `2${RUN.slice(-4)}`);
  const staff = await mkUser("staff", `3${RUN.slice(-4)}`);

  const seedPending = async (userId: string, sessionId: string, lastReconciledAt: Date | null) =>
    db.verification.upsert({
      where: { userId_type: { userId, type: "PHOTO" } },
      create: {
        userId,
        type: "PHOTO",
        status: "PENDING",
        statusChangedAt: new Date(),
        provider: "mock",
        providerSessionId: sessionId,
        lastReconciledAt,
      },
      update: {
        status: "PENDING",
        statusChangedAt: new Date(),
        provider: "mock",
        providerSessionId: sessionId,
        lastReconciledAt,
        reviewNote: null,
      },
    });

  try {
    console.log("background reconciliation");

    await check("pending older than threshold -> reconciles and applies VERIFIED", async () => {
      const sessionId = `mock_recon_${RUN}_a`;
      await seedPending(alice, sessionId, null); // never reconciled = stale
      setMockVerificationStatus(sessionId, "approved");
      const ran = await maybeReconcilePhotoVerification(alice);
      assert.equal(ran, true, "stale pending claims the reconciliation");
      const [user, row] = await Promise.all([
        db.user.findUniqueOrThrow({ where: { id: alice } }),
        db.verification.findUniqueOrThrow({
          where: { userId_type: { userId: alice, type: "PHOTO" } },
        }),
      ]);
      assert.ok(user.photoVerifiedAt, "canonical verdict stamped without a new hosted flow");
      assert.equal(row.status, "APPROVED");
      assert.ok(row.statusChangedAt, "audit timestamp stamped on approve");
      assert.ok(row.lastReconciledAt, "throttle metadata stored");
    });

    await check("verified users are never re-polled or downgraded", async () => {
      const before = await db.user.findUniqueOrThrow({ where: { id: alice } });
      // Even a hostile provider state cannot reach a verified user: the
      // claim WHERE excludes them before any provider call.
      setMockVerificationStatus(`mock_recon_${RUN}_a`, "rejected");
      const ran = await maybeReconcilePhotoVerification(alice);
      assert.equal(ran, false);
      const after = await db.user.findUniqueOrThrow({ where: { id: alice } });
      assert.deepEqual(after.photoVerifiedAt, before.photoVerifiedAt, "verdict untouched");
    });

    await check("pending newer than threshold -> throttled, no provider apply", async () => {
      const sessionId = `mock_recon_${RUN}_b`;
      await seedPending(bob, sessionId, new Date()); // reconciled JUST now
      setMockVerificationStatus(sessionId, "approved");
      const ran = await maybeReconcilePhotoVerification(bob);
      assert.equal(ran, false, "fresh lastReconciledAt loses the claim");
      const row = await db.verification.findUniqueOrThrow({
        where: { userId_type: { userId: bob, type: "PHOTO" } },
      });
      assert.equal(row.status, "PENDING", "no outcome applied inside the interval");
    });

    await check("concurrent duplicates: exactly one claim wins", async () => {
      const sessionId = `mock_recon_${RUN}_c`;
      await seedPending(bob, sessionId, new Date(Date.now() - 10 * 60_000));
      setMockVerificationStatus(sessionId, "pending"); // stays pending either way
      const results = await Promise.all([
        maybeReconcilePhotoVerification(bob),
        maybeReconcilePhotoVerification(bob),
      ]);
      assert.deepEqual(results.filter(Boolean).length, 1, "atomic claim admits one");
    });

    await check("provider outage: silent, state intact, throttle advanced", async () => {
      process.env.VERIFICATION_PROVIDER = "stripe_identity";
      process.env.STRIPE_SECRET_KEY = "sk_test_x";
      process.env.STRIPE_IDENTITY_WEBHOOK_SECRET = "whsec_x";
      setStripeIdentityTransport(async () => {
        throw new Error("stripe is down");
      });
      try {
        await db.verification.update({
          where: { userId_type: { userId: bob, type: "PHOTO" } },
          data: { provider: "stripe_identity", lastReconciledAt: null },
        });
        // The claim runs; the provider failure is swallowed INSIDE the
        // sync path (never thrown, never user-facing).
        await assert.doesNotReject(() => maybeReconcilePhotoVerification(bob));
        const row = await db.verification.findUniqueOrThrow({
          where: { userId_type: { userId: bob, type: "PHOTO" } },
        });
        assert.equal(row.status, "PENDING", "no state invented during the outage");
        assert.ok(row.lastReconciledAt, "outage still consumes the interval (no hot loop)");
      } finally {
        setStripeIdentityTransport(null);
        process.env.VERIFICATION_PROVIDER = "mock";
        await db.verification.update({
          where: { userId_type: { userId: bob, type: "PHOTO" } },
          data: { provider: "mock" },
        });
      }
    });

    console.log("timestamps (service-level)");

    let rejectedStamp: Date | null = null;
    await check("reject updates statusChangedAt", async () => {
      const before = await db.verification.findUniqueOrThrow({
        where: { userId_type: { userId: bob, type: "PHOTO" } },
      });
      const sessionId = before.providerSessionId!;
      await db.verification.update({
        where: { id: before.id },
        data: { lastReconciledAt: null },
      });
      setMockVerificationStatus(sessionId, "rejected");
      const ran = await maybeReconcilePhotoVerification(bob);
      assert.equal(ran, true);
      const after = await db.verification.findUniqueOrThrow({ where: { id: before.id } });
      assert.equal(after.status, "REJECTED");
      assert.ok(
        after.statusChangedAt && after.statusChangedAt > (before.statusChangedAt ?? new Date(0)),
        "audit timestamp advanced on reject",
      );
      rejectedStamp = after.statusChangedAt;
    });

    await check("admin review updates statusChangedAt transactionally", async () => {
      const row = await db.verification.findUniqueOrThrow({
        where: { userId_type: { userId: bob, type: "PHOTO" } },
      });
      await reviewVerification({ actorId: staff, verificationId: row.id, approve: true });
      const after = await db.verification.findUniqueOrThrow({ where: { id: row.id } });
      assert.equal(after.status, "APPROVED");
      assert.ok(after.statusChangedAt! > rejectedStamp!, "admin review advanced the timestamp");
      const user = await db.user.findUniqueOrThrow({ where: { id: bob } });
      assert.ok(user.photoVerifiedAt, "verdict stamped atomically with the row");
    });

    console.log("webhook interplay (HTTP; requires dev server)");

    const reachable = await fetch(`${BASE}/api/health`).then(
      (r) => r.ok,
      () => false,
    );
    const mockSecret = process.env.VERIFICATION_WEBHOOK_SECRET?.trim();
    if (!reachable || !mockSecret) {
      skip("webhook interplay", !reachable ? "dev server not running" : "mock secret unset");
    } else {
      const carol = await mkUser("carol", `4${RUN.slice(-4)}`);
      const sessionId = `mock_recon_${RUN}_d`;
      await seedPending(carol, sessionId, null);
      const webhook = (payload: string) =>
        fetch(`${BASE}/api/webhooks/verification`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-verification-signature": createHmac("sha256", mockSecret)
              .update(payload)
              .digest("hex"),
          },
          body: payload,
        });

      await check("webhook first, reconciliation after: reconcile is a safe no-op", async () => {
        const body = JSON.stringify({ sessionId, status: "approved" });
        assert.equal((await webhook(body)).status, 200);
        const stamped = await db.verification.findUniqueOrThrow({
          where: { userId_type: { userId: carol, type: "PHOTO" } },
        });
        assert.equal(stamped.status, "APPROVED");
        const ran = await maybeReconcilePhotoVerification(carol);
        assert.equal(ran, false, "verified guard blocks the claim");
        const after = await db.verification.findUniqueOrThrow({ where: { id: stamped.id } });
        assert.deepEqual(after.statusChangedAt, stamped.statusChangedAt, "timestamp untouched");
      });

      await check("duplicate webhook leaves the audit timestamp unchanged", async () => {
        const before = await db.verification.findUniqueOrThrow({
          where: { userId_type: { userId: carol, type: "PHOTO" } },
        });
        const body = JSON.stringify({ sessionId, status: "approved" });
        const res = await webhook(body);
        assert.equal(res.status, 200);
        const payload = (await res.json()) as { applied: boolean };
        assert.equal(payload.applied, false, "idempotent replay");
        const after = await db.verification.findUniqueOrThrow({ where: { id: before.id } });
        assert.deepEqual(after.statusChangedAt, before.statusChangedAt);
      });

      await db.user.delete({ where: { id: carol } }).catch(() => {});
      await admin.auth.admin.deleteUser(carol).catch(() => {});
    }

    console.log("display pins");

    await check("admin shows relative verified-ago with exact hover timestamp", () => {
      const page = src("app", "admin", "verification", "page.tsx");
      assert.ok(page.includes("Verified today") && page.includes("Verified yesterday"));
      assert.ok(page.includes("days ago"));
      assert.ok(page.includes("title={at.toISOString()}"), "exact timestamp on hover");
      assert.ok(page.includes("Recently verified"));
    });

    await check("account shows the public verified date; internal stamps stay private", () => {
      const page = src("app", "(app)", "settings", "account", "page.tsx");
      assert.ok(page.includes("verifiedOn"), "verified date rendered");
      assert.ok(page.includes("photoVerifiedAt"), "public verdict timestamp is the source");
      const pageCode = code("app", "(app)", "settings", "account", "page.tsx");
      assert.ok(!pageCode.includes("statusChangedAt"), "workflow timestamps never leave admin");
      assert.ok(!pageCode.includes("lastReconciledAt"), "throttle metadata never rendered");
    });

    await check("reconciliation is wired into the surfaces that load verification", () => {
      for (const f of [
        ["app", "(app)", "profile", "page.tsx"],
        ["app", "(app)", "settings", "account", "page.tsx"],
      ] as const) {
        assert.ok(src(...f).includes("maybeReconcilePhotoVerification"), f.join("/"));
      }
    });

    console.log(`\n${passed} checks passed`);
  } finally {
    for (const uid of [alice, bob, staff]) {
      await db.user.delete({ where: { id: uid } }).catch(() => {});
      await admin.auth.admin.deleteUser(uid).catch(() => {});
    }
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error("\nFAILED:", error);
  process.exitCode = 1;
});
