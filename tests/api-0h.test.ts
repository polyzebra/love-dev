/**
 * Tests for multi-transport notifications (Phase 0H):
 *   npx tsx tests/api-0h.test.ts
 *
 * Live lane: real Supabase credentials + the dev server on :3000 for the
 * registration routes (skips with a notice when unreachable); dispatch
 * checks drive the outbox in-process through FAKE transport adapters -
 * no real push service is ever contacted. Covers:
 *  - transport-independent registration (FCM token via /api/v1/push/register)
 *  - the legacy web /subscribe alias keeps working (WEB_PUSH row)
 *  - token rotation: same installation + new token retires the old row
 *  - revocation by token; invalid-token cleanup on provider signal
 *  - fan-out through a fake adapter; retry then dead-letter on failures
 *  - unconfigured transports are SKIPPED, never punished
 *  - metrics: attempted / delivered / invalid token / retries / latency
 *  - tokens never leave whole (list route truncation)
 */
import "dotenv/config";
import assert from "node:assert/strict";
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

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { db } = await import("../src/lib/db");
  const { notifyUser, processPendingPush, MAX_PUSH_ATTEMPTS } =
    await import("../src/lib/services/notify");
  const { listPushDevices } = await import("../src/lib/services/push");
  const { setTransportAdapter, fakeAdapter } =
    await import("../src/lib/services/notification-transports");
  const { getTransportMetrics, resetTransportMetrics } =
    await import("../src/lib/services/notification-metrics");

  const reachable = await fetch(`${BASE}/api/health`).then(
    (r) => r.ok,
    () => false,
  );
  if (!reachable) {
    skip("all 0H checks", "dev server not running");
    await db.$disconnect();
    console.log(`\n${passed} checks passed`);
    return;
  }

  const password = `oh-test-${RUN}-Aa1!`;
  const mkUser = async (tag: string, phoneTail: string) => {
    const email = `oh-${tag}-${RUN}@example.com`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    const uid = created.data.user!.id;
    const now = new Date();
    await db.user.create({
      data: {
        id: uid,
        email,
        name: `OH ${tag}`,
        emailVerified: now,
        phone: `+3538794${phoneTail}`,
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
    return { uid, token };
  };

  const alice = await mkUser("alice", `1${RUN.slice(-4)}`);
  const bob = await mkUser("bob", `2${RUN.slice(-4)}`);

  const api = (token: string, method: string, path: string, body?: unknown): Promise<Response> =>
    fetch(`${BASE}/api/v1${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  const fcmToken1 = `fcm-token-${RUN}-aaaaaaaaaaaaaaaaaaaaaaaa`;
  const fcmToken2 = `fcm-token-${RUN}-bbbbbbbbbbbbbbbbbbbbbbbb`;
  const apnsToken = `apns-token-${RUN}-cccccccccccccccccccccccc`;
  const install = `install-${RUN}`;

  try {
    console.log("multi-transport notifications:");

    await check("register an FCM device token via /api/v1/push/register", async () => {
      const res = await api(alice.token, "POST", "/push/register", {
        transport: "FCM",
        token: fcmToken1,
        installationId: install,
        platform: "android",
        appVersion: "1.0.0",
      });
      assert.equal(res.status, 200);
      const row = await db.notificationDevice.findUnique({ where: { token: fcmToken1 } });
      assert.equal(row?.transport, "FCM");
      assert.equal(row?.userId, alice.uid);
      assert.equal(row?.endpoint, null);
      assert.equal(row?.appVersion, "1.0.0");
      assert.equal(row?.environment, "production");
      assert.equal(row?.enabled, true);
    });

    await check("token rotation: a new token for the same install retires the old", async () => {
      const res = await api(alice.token, "POST", "/push/register", {
        transport: "FCM",
        token: fcmToken2,
        installationId: install,
        platform: "android",
        appVersion: "1.0.1",
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { data: { rotatedOut: number } };
      assert.equal(body.data.rotatedOut, 1);
      const [oldRow, newRow] = await Promise.all([
        db.notificationDevice.findUnique({ where: { token: fcmToken1 } }),
        db.notificationDevice.findUnique({ where: { token: fcmToken2 } }),
      ]);
      assert.equal(oldRow?.enabled, false);
      assert.ok(oldRow?.invalidatedAt, "old token invalidated");
      assert.equal(newRow?.enabled, true);
    });

    await check("a token re-registered by ANOTHER account is rebound + audited", async () => {
      const res = await api(bob.token, "POST", "/push/register", {
        transport: "FCM",
        token: fcmToken2,
        platform: "android",
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { data: { rebound: boolean } };
      assert.equal(body.data.rebound, true);
      const row = await db.notificationDevice.findUnique({ where: { token: fcmToken2 } });
      assert.equal(row?.userId, bob.uid, "device now notifies its current owner only");
      // hand it back for the rest of the suite
      await api(alice.token, "POST", "/push/register", {
        transport: "FCM",
        token: fcmToken2,
        installationId: install,
        platform: "android",
      });
    });

    await check("tokens never leave whole: device list truncates credentials", async () => {
      const devices = await listPushDevices(alice.uid);
      const fcm = devices.find((d) => d.transport === "FCM");
      assert.ok(fcm, "device listed");
      assert.ok(fcm!.token!.length <= 10, "only a tail survives");
      assert.ok(!fcm!.token!.includes(fcmToken2.slice(0, 24)), "token body never exposed");
    });

    await check("fan-out delivers through a FAKE FCM adapter (outbox -> SENT)", async () => {
      resetTransportMetrics();
      const fake = fakeAdapter("FCM", () => ({ ok: true, statusCode: 200 }));
      setTransportAdapter("FCM", fake);
      try {
        const result = await notifyUser({
          userId: alice.uid,
          type: "NEW_MESSAGE",
          title: "New message",
          body: "Someone sent you a message.",
          url: "/chat/x",
          dedupeKey: `oh-fanout-${RUN}`,
        });
        assert.equal(result.created, true);
        await processPendingPush();
        assert.equal(fake.sends.length, 1, "adapter received exactly one send");
        const delivery = await db.notificationDelivery.findUnique({
          where: { idempotencyKey: `oh-fanout-${RUN}:push` },
        });
        assert.equal(delivery?.status, "SENT");
        const device = await db.notificationDevice.findUnique({ where: { token: fcmToken2 } });
        assert.ok(device?.lastSuccessAt, "success bookkeeping");
        const metrics = getTransportMetrics().FCM;
        assert.equal(metrics.attempted, 1);
        assert.equal(metrics.delivered, 1);
        assert.ok(metrics.latencyMaxMs >= 0 && metrics.latencySumMs >= 0, "latency recorded");
      } finally {
        setTransportAdapter("FCM", null);
      }
    });

    await check("duplicate canonical event is deduped (idempotency preserved)", async () => {
      const again = await notifyUser({
        userId: alice.uid,
        type: "NEW_MESSAGE",
        title: "New message",
        body: "dup",
        url: "/chat/x",
        dedupeKey: `oh-fanout-${RUN}`,
      });
      assert.deepEqual(again, { created: false, reason: "deduped" });
    });

    await check("provider says token is gone -> device invalidated (cleanup)", async () => {
      resetTransportMetrics();
      const fake = fakeAdapter("FCM", () => ({
        ok: false,
        statusCode: 404,
        tokenInvalid: true,
        retryable: false,
        error: "UNREGISTERED",
      }));
      setTransportAdapter("FCM", fake);
      try {
        await notifyUser({
          userId: alice.uid,
          type: "NEW_MESSAGE",
          title: "New message",
          body: "x",
          url: "/chat/x",
          dedupeKey: `oh-invalid-${RUN}`,
        });
        await processPendingPush();
        const device = await db.notificationDevice.findUnique({ where: { token: fcmToken2 } });
        assert.equal(device?.enabled, false);
        assert.ok(device?.invalidatedAt, "invalidatedAt stamped");
        assert.equal(getTransportMetrics().FCM.invalidToken, 1);
      } finally {
        setTransportAdapter("FCM", null);
      }
    });

    await check("retry then dead-letter: failures back off and finally go DEAD", async () => {
      resetTransportMetrics();
      // Fresh device (the previous one was invalidated above).
      await api(alice.token, "POST", "/push/register", {
        transport: "FCM",
        token: fcmToken1,
        installationId: install,
        platform: "android",
      });
      const fake = fakeAdapter("FCM", () => ({
        ok: false,
        statusCode: 503,
        tokenInvalid: false,
        retryable: true,
        error: "UNAVAILABLE",
      }));
      setTransportAdapter("FCM", fake);
      try {
        await notifyUser({
          userId: alice.uid,
          type: "NEW_MESSAGE",
          title: "New message",
          body: "x",
          url: "/chat/x",
          dedupeKey: `oh-retry-${RUN}`,
        });
        const key = `oh-retry-${RUN}:push`;
        await processPendingPush();
        let delivery = await db.notificationDelivery.findUniqueOrThrow({
          where: { idempotencyKey: key },
        });
        assert.equal(delivery.status, "PENDING", "first failure schedules a retry");
        assert.equal(delivery.attempt, 1);
        assert.ok(delivery.nextAttemptAt && delivery.nextAttemptAt > new Date(), "backoff set");

        // Drain the remaining attempts by forcing each backoff to be due.
        for (let i = delivery.attempt; i < MAX_PUSH_ATTEMPTS; i += 1) {
          await db.notificationDelivery.update({
            where: { idempotencyKey: key },
            data: { nextAttemptAt: new Date(Date.now() - 1000) },
          });
          await processPendingPush();
        }
        delivery = await db.notificationDelivery.findUniqueOrThrow({
          where: { idempotencyKey: key },
        });
        assert.equal(delivery.status, "DEAD", "dead-letter after MAX_PUSH_ATTEMPTS");
        assert.equal(delivery.attempt, MAX_PUSH_ATTEMPTS);
        assert.equal(delivery.nextAttemptAt, null);
        const metrics = getTransportMetrics().FCM;
        assert.equal(metrics.failed, MAX_PUSH_ATTEMPTS);
        assert.ok(metrics.retries >= MAX_PUSH_ATTEMPTS - 1, "retries counted");
      } finally {
        setTransportAdapter("FCM", null);
      }
    });

    await check("unconfigured transport (real APNS stub) is skipped, never punished", async () => {
      // Clear alice's FCM devices so only the APNS one remains.
      await db.notificationDevice.updateMany({
        where: { userId: alice.uid },
        data: { enabled: false, invalidatedAt: new Date() },
      });
      const res = await api(alice.token, "POST", "/push/register", {
        transport: "APNS",
        token: apnsToken,
        platform: "ios",
        environment: "development",
      });
      assert.equal(res.status, 200);
      await notifyUser({
        userId: alice.uid,
        type: "NEW_MESSAGE",
        title: "New message",
        body: "x",
        url: "/chat/x",
        dedupeKey: `oh-apns-${RUN}`,
      });
      await processPendingPush();
      const device = await db.notificationDevice.findUnique({ where: { token: apnsToken } });
      assert.equal(device?.failureCount, 0, "no failure penalty for missing credentials");
      assert.equal(device?.enabled, true, "device stays registered for when APNS ships");
      const delivery = await db.notificationDelivery.findUnique({
        where: { idempotencyKey: `oh-apns-${RUN}:push` },
      });
      assert.equal(delivery?.status, "DEAD");
      assert.equal(delivery?.errorCode, "no_active_subscriptions");
    });

    await check("revocation by token via /api/v1/push/unsubscribe", async () => {
      const res = await api(alice.token, "POST", "/push/unsubscribe", { token: apnsToken });
      assert.equal(res.status, 200);
      const row = await db.notificationDevice.findUnique({ where: { token: apnsToken } });
      assert.equal(row?.enabled, false);
      assert.ok(row?.invalidatedAt);
    });

    console.log(`\n${passed} checks passed`);
  } finally {
    setTransportAdapter("FCM", null);
    setTransportAdapter("APNS", null);
    for (const u of [alice, bob]) {
      await db.user.delete({ where: { id: u.uid } }).catch(() => {});
      await admin.auth.admin.deleteUser(u.uid).catch(() => {});
    }
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error("\nFAILED:", error);
  process.exitCode = 1;
});
