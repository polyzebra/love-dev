/**
 * Live tests for the Web Push notification backend. Run with:
 *   npx tsx tests/notifications.test.ts
 *
 * Talks to the real database from .env. A spy transport is injected via
 * setPushTransport, so the suite NEVER contacts a real push service - every
 * "send" is recorded in-memory and success/failure is scripted per endpoint.
 * All seeded rows are cleaned up in `finally`.
 */
import "dotenv/config";
import assert from "node:assert/strict";

process.env.AUTH_HASH_SALT = process.env.AUTH_HASH_SALT || "test-salt";

const RUN = Date.now().toString(36);
const testEmail = (tag: string) => `notif-${tag}-${RUN}@example.com`;
const fakeEndpoint = (tag: string) =>
  `https://fcm.googleapis.com/fcm/send/${tag}-${RUN}-${Math.random().toString(36).slice(2)}`;

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

async function main() {
  const { db } = await import("../src/lib/db");
  const {
    setPushTransport,
    registerPushSubscription,
    revokePushSubscription,
    listPushDevices,
    sendPushToUser,
    getVapidConfig,
    truncateEndpoint,
  } = await import("../src/lib/services/push");
  const {
    notifyUser,
    evaluateQuietHours,
    pushCopyFor,
    pushBackoffMs,
    dispatchPushDelivery,
    processPendingPush,
    heartbeatPresence,
    revokeStaleSubscriptions,
  } = await import("../src/lib/services/notify");
  const { validatePushEndpoint } = await import("../src/lib/validators/push");
  const { rateLimit, RATE_LIMITS } = await import("../src/lib/rate-limit");
  const { sendMessage } = await import("../src/lib/services/chat");

  // -------------------------------------------------------------------------
  // Spy transport: scripts outcomes per endpoint, records every payload.
  // -------------------------------------------------------------------------
  type Sent = { endpoint: string; payload: string; ttl: number; urgency: string };
  const sent: Sent[] = [];
  const failWith = new Map<string, number>(); // endpoint -> statusCode to throw
  setPushTransport(async (target, payload, options) => {
    const status = failWith.get(target.endpoint);
    if (status !== undefined) {
      throw Object.assign(new Error(`push service says ${status}`), { statusCode: status });
    }
    sent.push({
      endpoint: target.endpoint,
      payload,
      ttl: options.ttl,
      urgency: options.urgency,
    });
    return { statusCode: 201 };
  });

  const userIds: string[] = [];
  const conversationIds: string[] = [];

  async function seedUser(tag: string, name: string): Promise<string> {
    const user = await db.user.create({
      data: {
        email: testEmail(tag),
        profile: {
          create: {
            displayName: name,
            birthDate: new Date("1995-06-15"),
            gender: "WOMAN",
          },
        },
      },
      select: { id: true },
    });
    userIds.push(user.id);
    return user.id;
  }

  try {
    const alice = await seedUser("alice", "Alice");
    const bob = await seedUser("bob", "Bob");
    const carol = await seedUser("carol", "Carol");

    // =========================================================================
    console.log("endpoint validation");
    // =========================================================================

    await check("accepts the major push services, https only", () => {
      for (const good of [
        "https://fcm.googleapis.com/fcm/send/abc",
        "https://web.push.apple.com/QOJx",
        "https://sub.push.apple.com/x",
        "https://updates.push.services.mozilla.com/wpush/v2/x",
        "https://db5p.notify.windows.com/w/?token=x",
      ]) {
        assert.equal(validatePushEndpoint(good).ok, true, good);
      }
    });

    await check("rejects http, localhost/private, same-origin and unknown hosts", () => {
      const cases: Array<[string, string]> = [
        ["http://fcm.googleapis.com/fcm/send/abc", "endpoint_not_https"],
        ["https://localhost/push", "endpoint_private_host"],
        ["https://127.0.0.1/push", "endpoint_private_host"],
        ["https://192.168.1.10/push", "endpoint_private_host"],
        ["https://evil.example.com/push", "endpoint_unknown_push_service"],
        ["not a url", "endpoint_invalid_url"],
      ];
      for (const [raw, reason] of cases) {
        const res = validatePushEndpoint(raw, "https://tirvea.app");
        assert.equal(res.ok, false, raw);
        if (!res.ok) assert.equal(res.reason, reason, raw);
      }
      const sameOrigin = validatePushEndpoint("https://tirvea.app/api/push", "https://tirvea.app");
      assert.equal(sameOrigin.ok, false);
      if (!sameOrigin.ok) assert.equal(sameOrigin.reason, "endpoint_same_origin");
    });

    // =========================================================================
    console.log("subscribe / unsubscribe / status");
    // =========================================================================

    const aliceEndpoint = fakeEndpoint("alice-1");

    await check(
      "subscribe upserts by endpoint (register twice -> one row, keys refreshed)",
      async () => {
        const first = await registerPushSubscription(alice, {
          endpoint: aliceEndpoint,
          p256dh: "p256dh-v1",
          auth: "auth-v1",
          platform: "macOS",
          browser: "Chrome",
        });
        assert.equal(first.rebound, false);
        const second = await registerPushSubscription(alice, {
          endpoint: aliceEndpoint,
          p256dh: "p256dh-v2",
          auth: "auth-v2",
        });
        assert.equal(second.id, first.id);
        assert.equal(second.rebound, false);
        const rows = await db.notificationDevice.findMany({ where: { endpoint: aliceEndpoint } });
        assert.equal(rows.length, 1);
        assert.equal(rows[0].p256dh, "p256dh-v2");
        assert.equal(rows[0].userId, alice);
      },
    );

    await check(
      "an endpoint owned by another user is rebound to the caller + audited",
      async () => {
        const result = await registerPushSubscription(bob, {
          endpoint: aliceEndpoint,
          p256dh: "p256dh-bob",
          auth: "auth-bob",
        });
        assert.equal(result.rebound, true);
        const row = await db.notificationDevice.findUniqueOrThrow({
          where: { endpoint: aliceEndpoint },
        });
        assert.equal(row.userId, bob);
        const audit = await db.authVerificationEvent.findFirst({
          where: { userId: bob, type: "push_subscription_rebound" },
        });
        assert.ok(audit, "expected a push_subscription_rebound audit event");
        // Hand it back to alice for the rest of the suite.
        await registerPushSubscription(alice, {
          endpoint: aliceEndpoint,
          p256dh: "p256dh-v3",
          auth: "auth-v3",
        });
      },
    );

    await check("unsubscribe revokes own subscription only, keeps the row", async () => {
      assert.equal(await revokePushSubscription(bob, aliceEndpoint), false, "not bob's endpoint");
      assert.equal(await revokePushSubscription(alice, aliceEndpoint), true);
      const row = await db.notificationDevice.findUniqueOrThrow({
        where: { endpoint: aliceEndpoint },
      });
      assert.equal(row.enabled, false);
      assert.ok(row.invalidatedAt, "revokedAt set");
      // Re-subscribing re-enables the same row.
      await registerPushSubscription(alice, {
        endpoint: aliceEndpoint,
        p256dh: "p256dh-v4",
        auth: "auth-v4",
        deviceLabel: "MacBook",
      });
      const again = await db.notificationDevice.findUniqueOrThrow({
        where: { endpoint: aliceEndpoint },
      });
      assert.equal(again.enabled, true);
      assert.equal(again.invalidatedAt, null);
    });

    await check("status lists active devices with truncated endpoints + vapid key", async () => {
      const devices = await listPushDevices(alice);
      assert.equal(devices.length, 1);
      assert.ok((devices[0].endpoint ?? "").length <= 60 && devices[0].endpoint);
      assert.ok(!devices[0].endpoint!.includes(aliceEndpoint.slice(-20)), "endpoint truncated");
      assert.equal(devices[0].deviceLabel, "MacBook");
      const config = getVapidConfig();
      assert.equal(config.configured, true);
      assert.ok(config.publicKey && config.publicKey.length > 40);
      assert.equal(truncateEndpoint("short"), "short");
    });

    // =========================================================================
    console.log("quiet hours matrix");
    // =========================================================================

    await check("disabled / empty / null windows are never quiet", () => {
      const noon = new Date("2026-01-15T12:00:00Z");
      assert.equal(
        evaluateQuietHours(
          {
            quietHoursEnabled: false,
            quietHoursStart: 0,
            quietHoursEnd: 1439,
            timezone: "Etc/UTC",
          },
          noon,
        ),
        false,
      );
      assert.equal(
        evaluateQuietHours(
          { quietHoursEnabled: true, quietHoursStart: null, quietHoursEnd: 480, timezone: null },
          noon,
        ),
        false,
      );
      assert.equal(
        evaluateQuietHours(
          { quietHoursEnabled: true, quietHoursStart: 480, quietHoursEnd: 480, timezone: null },
          noon,
        ),
        false,
        "start === end is an empty window",
      );
    });

    await check("simple daytime window: inside quiet, outside not", () => {
      const cfg = {
        quietHoursEnabled: true,
        quietHoursStart: 700, // 11:40
        quietHoursEnd: 800, // 13:20
        timezone: "Etc/UTC",
      };
      assert.equal(evaluateQuietHours(cfg, new Date("2026-01-15T12:00:00Z")), true);
      assert.equal(evaluateQuietHours(cfg, new Date("2026-01-15T14:00:00Z")), false);
      // End is exclusive, start inclusive.
      assert.equal(evaluateQuietHours(cfg, new Date("2026-01-15T11:40:00Z")), true);
      assert.equal(evaluateQuietHours(cfg, new Date("2026-01-15T13:20:00Z")), false);
    });

    await check("overnight window wraps midnight", () => {
      const cfg = {
        quietHoursEnabled: true,
        quietHoursStart: 22 * 60, // 22:00
        quietHoursEnd: 7 * 60, // 07:00
        timezone: "Etc/UTC",
      };
      assert.equal(evaluateQuietHours(cfg, new Date("2026-01-15T23:30:00Z")), true);
      assert.equal(evaluateQuietHours(cfg, new Date("2026-01-16T03:00:00Z")), true);
      assert.equal(evaluateQuietHours(cfg, new Date("2026-01-16T06:59:00Z")), true);
      assert.equal(evaluateQuietHours(cfg, new Date("2026-01-16T07:00:00Z")), false);
      assert.equal(evaluateQuietHours(cfg, new Date("2026-01-15T12:00:00Z")), false);
    });

    await check("window is evaluated in the user's timezone", () => {
      // 23:30 UTC = 18:30 in New York (January, UTC-5).
      const at = new Date("2026-01-15T23:30:00Z");
      const window = {
        quietHoursEnabled: true,
        quietHoursStart: 22 * 60,
        quietHoursEnd: 7 * 60,
      };
      assert.equal(evaluateQuietHours({ ...window, timezone: "Etc/UTC" }, at), true);
      assert.equal(evaluateQuietHours({ ...window, timezone: "America/New_York" }, at), false);
      // Dublin in January is UTC+0 -> quiet.
      assert.equal(evaluateQuietHours({ ...window, timezone: "Europe/Dublin" }, at), true);
    });

    await check("an invalid timezone falls back to UTC instead of throwing", () => {
      const cfg = {
        quietHoursEnabled: true,
        quietHoursStart: 700,
        quietHoursEnd: 800,
        timezone: "Not/AZone",
      };
      assert.equal(evaluateQuietHours(cfg, new Date("2026-01-15T12:00:00Z")), true);
    });

    // =========================================================================
    console.log("notifyUser pipeline");
    // =========================================================================

    await check("creates Notification + IN_APP SENT + PUSH PENDING", async () => {
      const result = await notifyUser({
        userId: alice,
        type: "NEW_MATCH",
        title: "It's a match!",
        body: "You liked each other.",
        url: "/matches",
        actorUserId: bob,
        dedupeKey: `t:${RUN}:basic`,
        data: { matchId: "m-test" },
      });
      assert.equal(result.created, true);
      if (!result.created) return;
      assert.equal(result.push, "PENDING");
      const deliveries = await db.notificationDelivery.findMany({
        where: { notificationId: result.notificationId },
      });
      const inApp = deliveries.find((d) => d.channel === "IN_APP");
      const push = deliveries.find((d) => d.channel === "PUSH");
      assert.equal(inApp?.status, "SENT");
      assert.ok(inApp?.sentAt);
      assert.equal(push?.status, "PENDING");
      assert.equal(push?.attempt, 0);
    });

    await check("dedupeKey makes a second call a no-op", async () => {
      const again = await notifyUser({
        userId: alice,
        type: "NEW_MATCH",
        title: "It's a match!",
        actorUserId: bob,
        dedupeKey: `t:${RUN}:basic`,
      });
      assert.deepEqual(again, { created: false, reason: "deduped" });
      const count = await db.notification.count({
        where: { userId: alice, type: "NEW_MATCH", title: "It's a match!" },
      });
      assert.equal(count, 1);
    });

    await check("the actor is never notified about their own action", async () => {
      const result = await notifyUser({
        userId: alice,
        type: "NEW_MESSAGE",
        title: "New message",
        actorUserId: alice,
        dedupeKey: `t:${RUN}:self`,
      });
      assert.deepEqual(result, { created: false, reason: "self_actor" });
    });

    await check("a block in either direction suppresses the notification entirely", async () => {
      const block = await db.block.create({ data: { blockerId: alice, blockedId: carol } });
      try {
        const blockedActor = await notifyUser({
          userId: alice,
          type: "NEW_MESSAGE",
          title: "New message",
          actorUserId: carol,
          dedupeKey: `t:${RUN}:blocked-1`,
        });
        assert.deepEqual(blockedActor, { created: false, reason: "blocked_pair" });
        // Reverse direction: carol blocked alice-ward too.
        const reverse = await notifyUser({
          userId: carol,
          type: "NEW_MESSAGE",
          title: "New message",
          actorUserId: alice,
          dedupeKey: `t:${RUN}:blocked-2`,
        });
        assert.deepEqual(reverse, { created: false, reason: "blocked_pair" });
      } finally {
        await db.block.delete({ where: { id: block.id } });
      }
    });

    await check("per-type push preference gates the PUSH row", async () => {
      await db.userSettings.update({ where: { userId: alice }, data: { pushMessages: false } });
      const result = await notifyUser({
        userId: alice,
        type: "NEW_MESSAGE",
        title: "New message",
        actorUserId: bob,
        dedupeKey: `t:${RUN}:pref-off`,
      });
      assert.equal(result.created, true);
      if (result.created) assert.equal(result.push, "skipped");
      await db.userSettings.update({ where: { userId: alice }, data: { pushMessages: true } });
    });

    await check("quiet hours suppress push (SUPPRESSED, in-app still SENT)", async () => {
      await db.userSettings.update({
        where: { userId: alice },
        data: {
          quietHoursEnabled: true,
          quietHoursStart: 700,
          quietHoursEnd: 800,
          timezone: "Etc/UTC",
        },
      });
      const result = await notifyUser(
        {
          userId: alice,
          type: "NEW_MATCH",
          title: "It's a match!",
          actorUserId: bob,
          dedupeKey: `t:${RUN}:quiet`,
        },
        { now: new Date("2026-01-15T12:10:00Z") },
      );
      assert.equal(result.created, true);
      if (!result.created) return;
      assert.equal(result.push, "SUPPRESSED");
      const push = await db.notificationDelivery.findFirst({
        where: { notificationId: result.notificationId, channel: "PUSH" },
      });
      assert.equal(push?.status, "SUPPRESSED");
      assert.equal(push?.errorCode, "quiet_hours");
    });

    await check("SAFETY notices ignore quiet hours", async () => {
      const result = await notifyUser(
        {
          userId: alice,
          type: "SAFETY",
          title: "Security alert",
          body: "A new device signed in to your account.",
          dedupeKey: `t:${RUN}:safety`,
        },
        { now: new Date("2026-01-15T12:10:00Z") },
      );
      assert.equal(result.created, true);
      if (result.created) assert.equal(result.push, "PENDING");
      await db.userSettings.update({
        where: { userId: alice },
        data: { quietHoursEnabled: false },
      });
    });

    await check(
      "EMAIL/SMS rows exist only for safety/account types, honestly stubbed",
      async () => {
        // The SAFETY notification above: email row PENDING (RESEND_API_KEY is
        // set in this env) or DEAD not_configured without it - never SENT.
        const safetyEmail = await db.notificationDelivery.findFirst({
          where: { idempotencyKey: `t:${RUN}:safety:email` },
        });
        assert.ok(safetyEmail, "safety email delivery row exists");
        if (process.env.RESEND_API_KEY?.trim()) {
          assert.equal(safetyEmail.status, "PENDING");
          assert.equal(safetyEmail.provider, "resend");
        } else {
          assert.equal(safetyEmail.status, "DEAD");
          assert.equal(safetyEmail.errorCode, "not_configured");
        }
        // smsEnabled defaults false -> no SMS row even though safetySms=true.
        const safetySms = await db.notificationDelivery.findFirst({
          where: { idempotencyKey: `t:${RUN}:safety:sms` },
        });
        assert.equal(safetySms, null);
        // Engagement types never get email/sms rows.
        const matchEmail = await db.notificationDelivery.findFirst({
          where: { idempotencyKey: `t:${RUN}:basic:email` },
        });
        assert.equal(matchEmail, null);
        // Without the provider env the row is DEAD not_configured immediately.
        const savedResend = process.env.RESEND_API_KEY;
        delete process.env.RESEND_API_KEY;
        try {
          const r = await notifyUser({
            userId: alice,
            type: "SYSTEM",
            title: "System notice",
            dedupeKey: `t:${RUN}:sys-noresend`,
          });
          assert.equal(r.created, true);
          const email = await db.notificationDelivery.findFirst({
            where: { idempotencyKey: `t:${RUN}:sys-noresend:email` },
          });
          assert.equal(email?.status, "DEAD");
          assert.equal(email?.provider, "none");
          assert.equal(email?.errorCode, "not_configured");
        } finally {
          if (savedResend !== undefined) process.env.RESEND_API_KEY = savedResend;
        }
      },
    );

    // =========================================================================
    console.log("presence suppression");
    // =========================================================================

    // A conversation between alice and bob for the messaging tests.
    const conversation = await db.conversation.create({
      data: { participants: { create: [{ userId: alice }, { userId: bob }] } },
      select: { id: true },
    });
    conversationIds.push(conversation.id);

    await check("push is suppressed while the recipient is viewing the conversation", async () => {
      await heartbeatPresence(alice, conversation.id);
      const result = await notifyUser({
        userId: alice,
        type: "NEW_MESSAGE",
        title: "New message",
        actorUserId: bob,
        conversationId: conversation.id,
        dedupeKey: `t:${RUN}:viewing`,
      });
      assert.equal(result.created, true);
      if (!result.created) return;
      assert.equal(result.push, "SUPPRESSED");
      const push = await db.notificationDelivery.findFirst({
        where: { notificationId: result.notificationId, channel: "PUSH" },
      });
      assert.equal(push?.errorCode, "viewing_conversation");
    });

    await check("a stale heartbeat (>30s) no longer suppresses", async () => {
      await db.conversationPresence.update({
        where: { userId_conversationId: { userId: alice, conversationId: conversation.id } },
        data: { lastSeenAt: new Date(Date.now() - 35_000) },
      });
      const result = await notifyUser({
        userId: alice,
        type: "NEW_MESSAGE",
        title: "New message",
        actorUserId: bob,
        conversationId: conversation.id,
        dedupeKey: `t:${RUN}:stale-presence`,
      });
      assert.equal(result.created, true);
      if (result.created) assert.equal(result.push, "PENDING");
    });

    // =========================================================================
    console.log("dispatch, fan-out, retries");
    // =========================================================================

    // Clear the PENDING backlog accumulated above so dispatch tests are exact.
    await db.notificationDelivery.updateMany({
      where: { channel: "PUSH", status: "PENDING", notification: { userId: { in: userIds } } },
      data: { status: "SUPPRESSED", errorCode: "test_cleared" },
    });

    const aliceEndpoint2 = fakeEndpoint("alice-2");
    await registerPushSubscription(alice, {
      endpoint: aliceEndpoint2,
      p256dh: "k2",
      auth: "a2",
    });

    await check(
      "multi-device fanout: one 410 revokes that device, the other succeeds -> SENT",
      async () => {
        failWith.set(aliceEndpoint, 410);
        sent.length = 0;
        const result = await notifyUser({
          userId: alice,
          type: "NEW_MATCH",
          title: "It's a match!",
          actorUserId: bob,
          dedupeKey: `t:${RUN}:fanout`,
          data: { matchId: "m-fanout" },
        });
        assert.equal(result.created, true);
        if (!result.created) return;
        const delivery = await db.notificationDelivery.findFirstOrThrow({
          where: { notificationId: result.notificationId, channel: "PUSH" },
        });
        const dispatch = await dispatchPushDelivery(delivery.id);
        assert.equal(dispatch.status, "SENT");
        assert.equal(dispatch.endpoints.length, 2);
        assert.equal(dispatch.endpoints.filter((e) => e.ok).length, 1);
        const gone = dispatch.endpoints.find((e) => !e.ok);
        assert.equal(gone?.revoked, true);
        assert.equal(gone?.statusCode, 410);
        // DB state: endpoint 1 revoked, endpoint 2 succeeded.
        const dead = await db.notificationDevice.findUniqueOrThrow({
          where: { endpoint: aliceEndpoint },
        });
        assert.equal(dead.enabled, false);
        assert.ok(dead.invalidatedAt);
        const alive = await db.notificationDevice.findUniqueOrThrow({
          where: { endpoint: aliceEndpoint2 },
        });
        assert.equal(alive.enabled, true);
        assert.ok(alive.lastSuccessAt);
        assert.equal(alive.failureCount, 0);
        // Delivery bookkeeping.
        const after = await db.notificationDelivery.findUniqueOrThrow({
          where: { id: delivery.id },
        });
        assert.equal(after.status, "SENT");
        assert.equal(after.provider, "web-push");
        assert.ok(after.sentAt);
        // Exactly one real payload left the building, tagged for collapse.
        assert.equal(sent.length, 1);
        const payload = JSON.parse(sent[0].payload);
        assert.equal(payload.tag, "match-m-fanout");
        assert.equal(payload.type, "NEW_MATCH");
        assert.equal(sent[0].ttl, 86400);
        failWith.delete(aliceEndpoint);
      },
    );

    await check("retry with exponential backoff, DEAD after 4 attempts", async () => {
      failWith.set(aliceEndpoint2, 500);
      const result = await notifyUser({
        userId: alice,
        type: "NEW_MESSAGE",
        title: "New message",
        actorUserId: bob,
        conversationId: conversation.id,
        dedupeKey: `t:${RUN}:retries`,
      });
      assert.equal(result.created, true);
      if (!result.created) return;
      const delivery = await db.notificationDelivery.findFirstOrThrow({
        where: { notificationId: result.notificationId, channel: "PUSH" },
      });

      const t0 = new Date();
      // Attempt 1 fails -> PENDING with nextAttemptAt = t0 + 60s.
      const first = await processPendingPush(50, t0);
      assert.equal(first.claimed, 1);
      assert.equal(first.retrying, 1);
      let row = await db.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
      assert.equal(row.status, "PENDING");
      assert.equal(row.attempt, 1);
      assert.equal(row.errorCode, "http_500");
      assert.equal(row.nextAttemptAt!.getTime(), t0.getTime() + pushBackoffMs(1));
      assert.equal(pushBackoffMs(1), 60_000);
      assert.equal(pushBackoffMs(2), 120_000);
      assert.equal(pushBackoffMs(3), 240_000);

      // Not due yet: a sweep 30s later must not claim it.
      const early = await processPendingPush(50, new Date(t0.getTime() + 30_000));
      assert.equal(early.claimed, 0);

      // Attempts 2..4, each after its backoff elapses; the 4th goes DEAD.
      let now = row.nextAttemptAt!;
      for (let attempt = 2; attempt <= 4; attempt++) {
        const sweep = await processPendingPush(50, now);
        assert.equal(sweep.claimed, 1, `attempt ${attempt} claimed`);
        row = await db.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
        assert.equal(row.attempt, attempt);
        if (attempt < 4) {
          assert.equal(row.status, "PENDING");
          now = row.nextAttemptAt!;
        } else {
          assert.equal(row.status, "DEAD");
          assert.equal(row.nextAttemptAt, null);
        }
      }

      // A later sweep finds nothing left to do for it.
      const done = await processPendingPush(50, new Date(now.getTime() + 3_600_000));
      assert.equal(done.claimed, 0);
      failWith.delete(aliceEndpoint2);
    });

    await check("5 accumulated failures permanently disable a subscription", async () => {
      await db.notificationDevice.update({
        where: { endpoint: aliceEndpoint2 },
        data: { failureCount: 4 },
      });
      failWith.set(aliceEndpoint2, 500);
      const result = await sendPushToUser(alice, {
        title: "x",
        body: "y",
        url: "/notifications",
        tag: "t",
        type: "SYSTEM",
        notificationId: "n/a",
      });
      assert.equal(result.delivered, 0);
      assert.equal(result.results[0].disabled, true);
      const row = await db.notificationDevice.findUniqueOrThrow({
        where: { endpoint: aliceEndpoint2 },
      });
      assert.equal(row.enabled, false);
      assert.equal(row.failureCount, 5);
      failWith.delete(aliceEndpoint2);
    });

    await check(
      "dispatch with zero active devices goes DEAD (no_active_subscriptions)",
      async () => {
        // Both of alice's subscriptions are now revoked/disabled, but pushes
        // gate on subscription existence at notify time - so re-enable one,
        // notify, then disable it again before dispatching.
        await db.notificationDevice.update({
          where: { endpoint: aliceEndpoint2 },
          data: { enabled: true, failureCount: 0 },
        });
        const result = await notifyUser({
          userId: alice,
          type: "NEW_MATCH",
          title: "It's a match!",
          actorUserId: bob,
          dedupeKey: `t:${RUN}:no-devices`,
        });
        assert.equal(result.created, true);
        if (!result.created) return;
        await db.notificationDevice.update({
          where: { endpoint: aliceEndpoint2 },
          data: { enabled: false },
        });
        const delivery = await db.notificationDelivery.findFirstOrThrow({
          where: { notificationId: result.notificationId, channel: "PUSH" },
        });
        const dispatch = await dispatchPushDelivery(delivery.id);
        assert.equal(dispatch.status, "DEAD");
        const row = await db.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
        assert.equal(row.errorCode, "no_active_subscriptions");
      },
    );

    // =========================================================================
    console.log("real message send path (chat service integration)");
    // =========================================================================

    await check(
      "sendMessage notifies the recipient, never the sender, with private push copy",
      async () => {
        const bobEndpoint = fakeEndpoint("bob-1");
        await registerPushSubscription(bob, { endpoint: bobEndpoint, p256dh: "kb", auth: "ab" });
        sent.length = 0;

        const secret = `the launch codes are 0000 (${RUN})`;
        const message = await sendMessage({
          conversationId: conversation.id,
          senderId: alice,
          body: secret,
        });

        // In-app notification for bob, none for alice.
        const bobNotif = await db.notification.findFirst({
          where: {
            userId: bob,
            type: "NEW_MESSAGE",
            data: { path: ["messageId"], equals: message.id },
          },
        });
        assert.ok(bobNotif, "recipient got an in-app notification");
        const aliceNotif = await db.notification.findFirst({
          where: {
            userId: alice,
            type: "NEW_MESSAGE",
            data: { path: ["messageId"], equals: message.id },
          },
        });
        assert.equal(aliceNotif, null, "sender is never notified");
        // In-app copy never includes the message text either.
        assert.ok(!(bobNotif.body ?? "").includes("launch codes"));

        // Dispatch and inspect the actual encrypted-payload plaintext.
        const summary = await processPendingPush(50);
        assert.equal(summary.sent, 1);
        assert.equal(sent.length, 1);
        assert.equal(sent[0].endpoint, bobEndpoint);
        const payload = JSON.parse(sent[0].payload);
        assert.ok(
          !sent[0].payload.includes("launch codes"),
          "push payload never carries chat text",
        );
        assert.equal(payload.title, "New message");
        assert.equal(payload.body, "Someone sent you a message on Tirvea.");
        assert.equal(payload.url, `/chat/${conversation.id}`);
        assert.equal(payload.tag, `msg-${conversation.id}`);
        assert.equal(sent[0].ttl, 3600);
        assert.equal(sent[0].urgency, "high");

        // Idempotency: replaying the notification for the same message no-ops.
        const replay = await notifyUser({
          userId: bob,
          type: "NEW_MESSAGE",
          title: "New message",
          actorUserId: alice,
          conversationId: conversation.id,
          dedupeKey: `message:${message.id}:recipient:${bob}`,
        });
        assert.deepEqual(replay, { created: false, reason: "deduped" });
      },
    );

    await check("sendMessage to a blocked pair suppresses the notification", async () => {
      const block = await db.block.create({ data: { blockerId: bob, blockedId: alice } });
      try {
        const message = await sendMessage({
          conversationId: conversation.id,
          senderId: alice,
          body: "hello?",
        });
        const notif = await db.notification.findFirst({
          where: { userId: bob, data: { path: ["messageId"], equals: message.id } },
        });
        assert.equal(notif, null);
      } finally {
        await db.block.delete({ where: { id: block.id } });
      }
    });

    await check("pushCopyFor never leaks message-like bodies", () => {
      const msg = pushCopyFor("NEW_MESSAGE", "New message", "super secret text");
      assert.ok(!msg.body.includes("secret"));
      const like = pushCopyFor("NEW_LIKE", "Ann sent you a message", "super secret text");
      assert.ok(!like.body.includes("secret"));
      assert.ok(!like.title.includes("Ann"));
      const match = pushCopyFor("NEW_MATCH", "It's a match!", "You liked each other.");
      assert.equal(match.title, "It's a match!");
    });

    // =========================================================================
    console.log("housekeeping + limits");
    // =========================================================================

    await check("stale subscriptions get revoked by the cron sweep", async () => {
      const staleEndpoint = fakeEndpoint("stale");
      await registerPushSubscription(carol, { endpoint: staleEndpoint, p256dh: "k", auth: "a" });
      await db.notificationDevice.update({
        where: { endpoint: staleEndpoint },
        data: { lastSeenAt: new Date(Date.now() - 120 * 24 * 3600 * 1000) },
      });
      const revoked = await revokeStaleSubscriptions();
      assert.ok(revoked >= 1);
      const row = await db.notificationDevice.findUniqueOrThrow({
        where: { endpoint: staleEndpoint },
      });
      assert.equal(row.enabled, false);
      assert.ok(row.invalidatedAt);
    });

    await check("push test-route budget: 3 per hour, the 4th is limited", async () => {
      const key = `push-test:limit-check-${RUN}`;
      for (let i = 1; i <= 3; i++) {
        const r = await rateLimit(key, RATE_LIMITS.pushTest);
        assert.equal(r.ok, true, `call ${i} allowed`);
      }
      const fourth = await rateLimit(key, RATE_LIMITS.pushTest);
      assert.equal(fourth.ok, false, "4th call within the hour is limited");
    });

    console.log(`\nAll ${passed} checks passed.`);
  } finally {
    setPushTransport(null);
    // Cleanup: users cascade to profiles/participants/settings/subscriptions/
    // notifications(->deliveries)/presence/blocks; conversations and audit
    // events are removed explicitly.
    await db.authVerificationEvent.deleteMany({ where: { userId: { in: userIds } } });
    if (conversationIds.length > 0) {
      await db.conversation.deleteMany({ where: { id: { in: conversationIds } } });
    }
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error("\nFAILED:", error);
  process.exitCode = 1;
});
