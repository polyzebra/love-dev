/**
 * Live tests for the safety email delivery pipeline. Run:
 *   npx tsx tests/safety-email.test.ts
 *
 * Talks to the real database from .env. A SPY email provider is injected
 * via setEmailProviderForTests BEFORE anything can dispatch, so the suite
 * NEVER contacts Resend - every "send" is recorded in memory with
 * scripted success/transient/permanent outcomes. All rows cleaned in
 * `finally`.
 *
 * Coverage:
 *  - template coverage: every SafetyNoticeKind has copy and renders an
 *    email with the /account/status deep link
 *  - outbox honesty: no provider -> DEAD not_configured; spy provider ->
 *    PENDING -> SENT with the provider message id
 *  - retry: transient failure backs off and retries; after
 *    MAX_EMAIL_ATTEMPTS -> FAILED max_attempts (never silently lost)
 *  - permanent failure -> FAILED immediately
 *  - webhook lifecycle: delivered / bounced / complained applied
 *    idempotently; bounce + complaint land on SuppressedEmail and the
 *    next send to that address is refused (DEAD suppressed)
 *  - webhook signature: valid Svix signature accepted; bad signature,
 *    stale timestamp and missing headers rejected
 *  - Stripe webhook signature helper (audit fix): valid/bad/replay
 */
import "dotenv/config";
import assert from "node:assert/strict";
import type { EmailSendResult } from "../src/lib/services/email";

process.env.AUTH_HASH_SALT = process.env.AUTH_HASH_SALT || "test-salt";

const RUN = Date.now().toString(36);
const testEmail = (tag: string) => `safety-email-${tag}-${RUN}@example.test`;

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

async function main() {
  const { db } = await import("../src/lib/db");
  const {
    makeSpyEmailProvider,
    setEmailProviderForTests,
    renderNotificationEmail,
    verifyEmailWebhookSignature,
    signEmailWebhook,
    pickEmailProvider,
    notConfiguredEmailProvider,
  } = await import("../src/lib/services/email");
  const {
    dispatchEmailDelivery,
    applyEmailProviderEvent,
    emailBackoffMs,
    isEmailSuppressed,
    MAX_EMAIL_ATTEMPTS,
  } = await import("../src/lib/services/notify");
  const { SAFETY_NOTICE_COPY, sendSafetyNotice } = await import(
    "../src/lib/services/safety-notices"
  );
  const { verifyStripeSignature } = await import("../src/lib/webhook-signatures");
  const { createHmac } = await import("node:crypto");

  // Default spy: succeeds, deterministic message ids.
  let messageSeq = 0;
  let behavior: (to: string) => EmailSendResult = () => ({
    ok: true,
    providerMessageId: `spy-msg-${RUN}-${++messageSeq}`,
  });
  const spy = makeSpyEmailProvider((msg) => behavior(msg.to));
  setEmailProviderForTests(spy);

  const userIds: string[] = [];
  const makeUser = async (tag: string) => {
    const u = await db.user.create({
      data: { email: testEmail(tag), emailVerified: new Date(), onboardingDone: true },
    });
    userIds.push(u.id);
    return u;
  };
  const emailDeliveryFor = (dedupeKey: string) =>
    db.notificationDelivery.findUniqueOrThrow({
      where: { idempotencyKey: `${dedupeKey}:email` },
      include: { notification: true },
    });
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  /**
   * Drive one EMAIL delivery to a non-PENDING state. sendSafetyNotice kicks
   * a detached outbox drain, so either that racer or our explicit dispatch
   * finishes the row - loop until it settles (bounded).
   */
  const driveEmail = async (dedupeKey: string) => {
    for (let i = 0; i < 20; i++) {
      const delivery = await emailDeliveryFor(dedupeKey);
      if (delivery.status !== "PENDING") return delivery;
      // Clear any backoff/lease so the row is due right now, then dispatch.
      await db.notificationDelivery
        .updateMany({ where: { id: delivery.id, status: "PENDING" }, data: { nextAttemptAt: new Date(0) } })
        .catch(() => {});
      await dispatchEmailDelivery(delivery.id);
      await sleep(50);
    }
    return emailDeliveryFor(dedupeKey);
  };

  // ------------------------------------------------------------------ A
  console.log("A. templates + rendering (pure)");

  await check("every safety notice kind has non-empty copy", () => {
    for (const [kind, copy] of Object.entries(SAFETY_NOTICE_COPY)) {
      assert.ok(copy.title.length > 4, `${kind} title`);
      assert.ok(copy.body.length > 20, `${kind} body`);
    }
    // The full production set the milestone requires:
    for (const kind of [
      "appeal_submitted",
      "appeal_approved",
      "appeal_rejected",
      "appeal_needs_info",
      "appeal_withdrawn",
      "appeal_expired",
      "warning",
      "limited",
      "suspended",
      "banned",
      "restriction_lifted",
      "restriction_extended",
      "photo_approved",
      "photo_removed",
      "verification_required",
      "verification_approved",
      "verification_rejected",
    ]) {
      assert.ok(kind in SAFETY_NOTICE_COPY, `missing template: ${kind}`);
    }
  });

  await check("rendered email carries the copy + /account/status deep link", () => {
    const copy = SAFETY_NOTICE_COPY.suspended;
    const rendered = renderNotificationEmail({
      title: copy.title,
      body: copy.body,
      url: "/account/status",
    });
    assert.equal(rendered.subject, copy.title);
    assert.ok(rendered.text.includes("/account/status"));
    assert.ok(rendered.html.includes("/account/status"));
    assert.ok(rendered.html.includes("Tirvea"));
  });

  await check("renderer refuses off-origin URLs (falls back to /account/status)", () => {
    const rendered = renderNotificationEmail({
      title: "t",
      body: "b",
      url: "//evil.example/phish",
    });
    assert.ok(!rendered.text.includes("//evil.example"));
    assert.ok(rendered.text.includes("/account/status"));
  });

  await check("email backoff is exponential", () => {
    assert.equal(emailBackoffMs(1), 60_000);
    assert.equal(emailBackoffMs(2), 120_000);
    assert.equal(emailBackoffMs(3), 240_000);
  });

  // ------------------------------------------------------------------ B
  console.log("B. outbox lifecycle (live db, spy transport)");

  try {
    // --- honest not-configured ------------------------------------------
    await check("no provider -> EMAIL row DEAD not_configured (never fake-sent)", async () => {
      setEmailProviderForTests(notConfiguredEmailProvider);
      const saved = process.env.RESEND_API_KEY;
      process.env.RESEND_API_KEY = "";
      try {
        assert.equal(pickEmailProvider().configured, false);
        const user = await makeUser("noprov");
        const key = `test:${RUN}:noprov`;
        await sendSafetyNotice(user.id, "warning", key);
        const delivery = await emailDeliveryFor(key);
        assert.equal(delivery.status, "DEAD");
        assert.equal(delivery.errorCode, "not_configured");
      } finally {
        process.env.RESEND_API_KEY = saved;
        setEmailProviderForTests(spy);
      }
    });

    // --- happy path -------------------------------------------------------
    const user = await makeUser("happy");
    const happyKey = `test:${RUN}:happy`;
    let happyMessageId = "";

    await check("safety notice -> PENDING email -> SENT via spy with message id", async () => {
      await sendSafetyNotice(user.id, "suspended", happyKey, { violationId: "v-test" });
      const delivery = await driveEmail(happyKey);
      assert.equal(delivery.status, "SENT");
      assert.equal(delivery.provider, "spy");
      assert.ok(delivery.providerMessageId?.startsWith("spy-msg-"));
      assert.ok(delivery.sentAt);
      happyMessageId = delivery.providerMessageId!;
      const sentMail = spy.sent.find((m) => m.to === user.email.toLowerCase());
      assert.ok(sentMail, "spy recorded the send");
      assert.ok(sentMail!.text.includes("/account/status"));
    });

    await check("webhook email.delivered -> DELIVERED, idempotent on replay", async () => {
      const first = await applyEmailProviderEvent("email.delivered", happyMessageId, user.email);
      assert.ok(first.applied);
      const delivery = await emailDeliveryFor(happyKey);
      assert.equal(delivery.status, "DELIVERED");
      assert.ok(delivery.deliveredAt);
      const replay = await applyEmailProviderEvent("email.delivered", happyMessageId, user.email);
      assert.deepEqual(replay, { applied: false, reason: "already_applied" });
    });

    await check("webhook for an unknown message id reports unknown_message", async () => {
      const result = await applyEmailProviderEvent("email.delivered", `ghost-${RUN}`, null);
      assert.deepEqual(result, { applied: false, reason: "unknown_message" });
    });

    // --- retry + max attempts ---------------------------------------------
    await check("transient failure retries with backoff, then durable FAILED", async () => {
      const flaky = await makeUser("flaky");
      const key = `test:${RUN}:flaky`;
      behavior = () => ({
        ok: false,
        transient: true,
        errorCode: "http_500",
        errorMessage: "spy induced outage",
      });
      await sendSafetyNotice(flaky.id, "limited", key);
      const delivery = await driveEmail(key);
      assert.equal(delivery.status, "FAILED");
      assert.equal(delivery.errorCode, "max_attempts");
      assert.ok(delivery.errorMessage?.includes("http_500"));
      assert.equal(delivery.attempt, MAX_EMAIL_ATTEMPTS);
      behavior = () => ({ ok: true, providerMessageId: `spy-msg-${RUN}-${++messageSeq}` });
    });

    await check("permanent provider rejection -> FAILED immediately (no retry)", async () => {
      const rejected = await makeUser("permfail");
      const key = `test:${RUN}:permfail`;
      behavior = () => ({
        ok: false,
        transient: false,
        errorCode: "http_422",
        errorMessage: "invalid recipient",
      });
      await sendSafetyNotice(rejected.id, "warning", key);
      const delivery = await driveEmail(key);
      assert.equal(delivery.status, "FAILED");
      assert.equal(delivery.errorCode, "http_422");
      assert.equal(delivery.attempt, 1);
      behavior = () => ({ ok: true, providerMessageId: `spy-msg-${RUN}-${++messageSeq}` });
    });

    // --- bounce -> suppression ---------------------------------------------
    await check("hard bounce -> BOUNCED + suppression; next send refused", async () => {
      const bouncer = await makeUser("bounce");
      const key1 = `test:${RUN}:bounce1`;
      await sendSafetyNotice(bouncer.id, "banned", key1);
      let delivery = await driveEmail(key1);
      assert.equal(delivery.status, "SENT");

      const bounce = await applyEmailProviderEvent(
        "email.bounced",
        delivery.providerMessageId!,
        bouncer.email,
      );
      assert.ok(bounce.applied && bounce.suppressed);
      delivery = await emailDeliveryFor(key1);
      assert.equal(delivery.status, "BOUNCED");
      assert.equal(await isEmailSuppressed(bouncer.email), true);

      // A late "delivered" event must not resurrect a bounced delivery.
      const late = await applyEmailProviderEvent(
        "email.delivered",
        delivery.providerMessageId!,
        bouncer.email,
      );
      assert.deepEqual(late, { applied: false, reason: "already_applied" });

      // The next notice to this user creates a row but the worker refuses it.
      const key2 = `test:${RUN}:bounce2`;
      const before = spy.sent.length;
      await sendSafetyNotice(bouncer.id, "warning", key2);
      const second = await driveEmail(key2);
      assert.equal(second.status, "DEAD");
      assert.equal(second.errorCode, "suppressed");
      const attemptedToBounced = spy.sent
        .slice(before)
        .some((m) => m.to === bouncer.email.toLowerCase());
      assert.equal(attemptedToBounced, false, "suppressed address never reached the provider");
    });

    await check("complaint -> COMPLAINED + suppression", async () => {
      const complainer = await makeUser("complaint");
      const key = `test:${RUN}:complaint`;
      await sendSafetyNotice(complainer.id, "photo_removed", key);
      const delivery = await driveEmail(key);
      assert.equal(delivery.status, "SENT");
      const result = await applyEmailProviderEvent(
        "email.complained",
        delivery.providerMessageId!,
        complainer.email,
      );
      assert.ok(result.applied && result.suppressed);
      assert.equal(await isEmailSuppressed(complainer.email), true);
      const row = await db.suppressedEmail.findUnique({
        where: { email: complainer.email.toLowerCase() },
      });
      assert.equal(row?.reason, "complaint");
    });

    // ------------------------------------------------------------------ C
    console.log("C. webhook signatures (pure)");

    const secretRaw = Buffer.from(`whsec-test-${RUN}`).toString("base64");
    const secret = `whsec_${secretRaw}`;

    await check("valid Svix signature verifies; tampered body does not", () => {
      const body = JSON.stringify({ type: "email.delivered", data: { email_id: "m1" } });
      const id = "msg_1";
      const ts = Math.floor(Date.now() / 1000);
      const sig = signEmailWebhook(body, id, ts, secret);
      assert.equal(
        verifyEmailWebhookSignature(body, { svixId: id, svixTimestamp: String(ts), svixSignature: sig }, secret),
        true,
      );
      assert.equal(
        verifyEmailWebhookSignature(body + " ", { svixId: id, svixTimestamp: String(ts), svixSignature: sig }, secret),
        false,
      );
      assert.equal(
        verifyEmailWebhookSignature(body, { svixId: id, svixTimestamp: String(ts), svixSignature: "v1,AAAA" }, secret),
        false,
      );
      assert.equal(
        verifyEmailWebhookSignature(body, { svixId: null, svixTimestamp: String(ts), svixSignature: sig }, secret),
        false,
      );
    });

    await check("stale Svix timestamp is rejected (replay protection)", () => {
      const body = "{}";
      const id = "msg_2";
      const ts = Math.floor(Date.now() / 1000) - 3600;
      const sig = signEmailWebhook(body, id, ts, secret);
      assert.equal(
        verifyEmailWebhookSignature(body, { svixId: id, svixTimestamp: String(ts), svixSignature: sig }, secret),
        false,
      );
    });

    await check("Stripe signature helper: valid accepted, bad + replay rejected", () => {
      const stripeSecret = `whsec_stripe_${RUN}`;
      const body = JSON.stringify({ id: "evt_1", type: "invoice.paid" });
      const ts = Math.floor(Date.now() / 1000);
      const sig = createHmac("sha256", stripeSecret).update(`${ts}.${body}`).digest("hex");
      assert.equal(verifyStripeSignature(body, `t=${ts},v1=${sig}`, stripeSecret), true);
      assert.equal(verifyStripeSignature(body, `t=${ts},v1=deadbeef`, stripeSecret), false);
      const oldTs = ts - 3600;
      const oldSig = createHmac("sha256", stripeSecret).update(`${oldTs}.${body}`).digest("hex");
      assert.equal(verifyStripeSignature(body, `t=${oldTs},v1=${oldSig}`, stripeSecret), false);
    });
  } finally {
    setEmailProviderForTests(null);
    for (const id of userIds) {
      await db.suppressedEmail
        .deleteMany({ where: { email: { contains: `safety-email-`, mode: "insensitive" } } })
        .catch(() => {});
      await db.user.delete({ where: { id } }).catch(() => {});
    }
    await db.$disconnect();
  }

  console.log(`\n${passed} checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
