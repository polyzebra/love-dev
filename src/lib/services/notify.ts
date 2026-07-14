import { deferAfterResponse } from "@/lib/defer";
import { db } from "@/lib/db";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { DeliveryStatus, NotificationType } from "@/generated/prisma/enums";
import { sendPushToUser, type PushEndpointResult, type PushPayload } from "@/lib/services/push";
import { pickEmailProvider, renderNotificationEmail } from "@/lib/services/email";

/**
 * Notification pipeline - a transactional outbox.
 *
 * notifyUser() writes the Notification row (the in-app notification centre
 * reads it directly, so IN_APP is SENT immediately) plus one
 * NotificationDelivery row per additional channel the user's preferences
 * allow. Nothing external happens inside the caller's transaction; the
 * PUSH rows are drained by processPendingPush() - kicked after the response
 * via schedulePushDispatch() in the creating routes, and swept by
 * /api/cron/notifications for retries/backoff.
 *
 * Honesty rules:
 *  - a delivery is only SENT when a provider accepted it
 *  - EMAIL rows are drained by processPendingEmail() through the provider
 *    abstraction in email.ts (Resend adapter); without RESEND_API_KEY the
 *    row goes DEAD with errorCode "not_configured" at creation - never
 *    fake-SENT. Provider webhooks advance SENT -> DELIVERED/BOUNCED/
 *    COMPLAINED (see /api/webhooks/email); hard bounces + complaints land
 *    on the SuppressedEmail list and are never sent to again.
 *  - SMS has no provider wired yet: rows are created for safety/account
 *    notices and immediately marked DEAD with "not_configured" unless the
 *    Twilio env exists (then they stay PENDING for the future sms worker)
 *  - push payloads never carry chat text (see pushCopyFor)
 */

type DbClient = PrismaClient | Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// Per-type routing policy
// ---------------------------------------------------------------------------

export type NotificationCategory = "engagement" | "safety" | "account";

export function categoryOf(type: NotificationType): NotificationCategory {
  switch (type) {
    case "NEW_MATCH":
    case "NEW_MESSAGE":
    case "NEW_LIKE":
    case "SUPER_LIKE":
      return "engagement";
    case "SAFETY":
      return "safety";
    default:
      // PROFILE_VERIFIED | SUBSCRIPTION | SYSTEM
      return "account";
  }
}

type SettingsRow = Prisma.UserSettingsGetPayload<Record<string, never>>;

/** The user's per-type push toggle for this notification type. */
export function pushPrefEnabled(settings: SettingsRow, type: NotificationType): boolean {
  switch (type) {
    case "NEW_MATCH":
      return settings.pushNewMatches;
    case "NEW_MESSAGE":
      return settings.pushMessages;
    case "NEW_LIKE":
      return settings.pushMessageLikes;
    case "SUPER_LIKE":
      return settings.pushSuperLikes;
    case "SAFETY":
      return settings.safetyPush;
    default:
      return settings.accountPush;
  }
}

// ---------------------------------------------------------------------------
// Quiet hours
// ---------------------------------------------------------------------------

export type QuietHoursConfig = {
  quietHoursEnabled: boolean;
  /** Minutes since local midnight, 0-1439. */
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
  /** IANA timezone name; invalid/missing falls back to UTC. */
  timezone: string | null;
};

/** Minutes since midnight of `now` in the given timezone (UTC on bad input). */
export function localMinutesIn(timezone: string | null, now: Date): number {
  let hour = now.getUTCHours();
  let minute = now.getUTCMinutes();
  if (timezone) {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour: "numeric",
        minute: "numeric",
        hourCycle: "h23",
      }).formatToParts(now);
      const h = parts.find((p) => p.type === "hour")?.value;
      const m = parts.find((p) => p.type === "minute")?.value;
      if (h !== undefined && m !== undefined) {
        hour = Number(h);
        minute = Number(m);
      }
    } catch {
      // Unknown timezone string - evaluate in UTC rather than failing the send.
    }
  }
  return hour * 60 + minute;
}

/**
 * True when `now` falls inside the user's quiet-hours window, evaluated in
 * THEIR timezone. Overnight ranges wrap (start 22:00, end 07:00 covers
 * 22:00-23:59 and 00:00-06:59). start === end is an empty window.
 * Exported for tests.
 */
export function evaluateQuietHours(config: QuietHoursConfig, now: Date = new Date()): boolean {
  if (!config.quietHoursEnabled) return false;
  const start = config.quietHoursStart;
  const end = config.quietHoursEnd;
  if (start === null || end === null || start === end) return false;
  if (start < 0 || start > 1439 || end < 0 || end > 1439) return false;

  const minutes = localMinutesIn(config.timezone, now);
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end; // overnight wrap
}

// ---------------------------------------------------------------------------
// Conversation presence (active-conversation suppression)
// ---------------------------------------------------------------------------

/** A presence heartbeat younger than this counts as "currently viewing". */
export const PRESENCE_FRESH_MS = 30_000;

export async function heartbeatPresence(userId: string, conversationId: string): Promise<void> {
  await db.conversationPresence.upsert({
    where: { userId_conversationId: { userId, conversationId } },
    create: { userId, conversationId },
    update: { lastSeenAt: new Date() },
  });
}

async function isViewingConversation(
  client: DbClient,
  userId: string,
  conversationId: string,
  now: Date,
): Promise<boolean> {
  const presence = await client.conversationPresence.findUnique({
    where: { userId_conversationId: { userId, conversationId } },
    select: { lastSeenAt: true },
  });
  return !!presence && now.getTime() - presence.lastSeenAt.getTime() < PRESENCE_FRESH_MS;
}

// ---------------------------------------------------------------------------
// notifyUser - the single entry point for every notification
// ---------------------------------------------------------------------------

export type NotifyInput = {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  /** Same-origin path the notification opens, e.g. /chat/abc123. */
  url?: string;
  /** Who caused this (sender/liker). Enables self- and block-suppression. */
  actorUserId?: string;
  /** Set for message notifications - enables active-viewing suppression. */
  conversationId?: string;
  /**
   * Idempotency key for the whole notification (e.g.
   * message:{id}:recipient:{uid}). A second call with the same key no-ops.
   */
  dedupeKey: string;
  /** Extra keys merged into Notification.data (matchId, firstMessageId, ...). */
  data?: Record<string, string | number | boolean | null>;
};

export type NotifyResult =
  | { created: false; reason: "deduped" | "self_actor" | "blocked_pair" }
  | {
      created: true;
      notificationId: string;
      push: DeliveryStatus | "skipped";
    };

export type NotifyOptions = {
  /** Transaction client when called inside db.$transaction. */
  client?: DbClient;
  /** Test-route escape hatch: a test push should fire even in quiet hours. */
  bypassQuietHours?: boolean;
  now?: Date;
};

export const MAX_PUSH_ATTEMPTS = 4;

export async function notifyUser(
  input: NotifyInput,
  opts: NotifyOptions = {},
): Promise<NotifyResult> {
  const client = opts.client ?? db;
  const now = opts.now ?? new Date();

  // Never notify someone about their own action.
  if (input.actorUserId && input.actorUserId === input.userId) {
    return { created: false, reason: "self_actor" };
  }

  // A block in EITHER direction suppresses everything.
  if (input.actorUserId) {
    const block = await client.block.findFirst({
      where: {
        OR: [
          { blockerId: input.userId, blockedId: input.actorUserId },
          { blockerId: input.actorUserId, blockedId: input.userId },
        ],
      },
      select: { id: true },
    });
    if (block) return { created: false, reason: "blocked_pair" };
  }

  // Fast-path dedupe (the unique idempotencyKey below is the real guarantee).
  const existing = await client.notificationDelivery.findUnique({
    where: { idempotencyKey: `${input.dedupeKey}:in_app` },
    select: { id: true },
  });
  if (existing) return { created: false, reason: "deduped" };

  // Settings row (created lazily with defaults on first touch).
  let settings = await client.userSettings.findUnique({ where: { userId: input.userId } });
  if (!settings) {
    await client.userSettings.createMany({
      data: [{ userId: input.userId }],
      skipDuplicates: true,
    });
    settings = await client.userSettings.findUniqueOrThrow({ where: { userId: input.userId } });
  }

  const notification = await client.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      data: {
        ...(input.url ? { url: input.url } : {}),
        ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
        ...(input.data ?? {}),
      },
    },
    select: { id: true },
  });

  type DeliveryRow = {
    notificationId: string;
    channel: "PUSH" | "EMAIL" | "SMS" | "IN_APP";
    status: DeliveryStatus;
    provider?: string;
    errorCode?: string;
    idempotencyKey: string;
    sentAt?: Date;
    nextAttemptAt?: Date;
  };

  const rows: DeliveryRow[] = [
    // The Notification row IS the in-app delivery - the /notifications
    // centre reads it directly, so this channel is SENT by construction.
    {
      notificationId: notification.id,
      channel: "IN_APP",
      status: "SENT",
      sentAt: now,
      idempotencyKey: `${input.dedupeKey}:in_app`,
    },
  ];

  // PUSH - only when the per-type preference is on AND a device can receive.
  let pushStatus: DeliveryStatus | "skipped" = "skipped";
  if (pushPrefEnabled(settings, input.type)) {
    const subscriptions = await client.notificationDevice.count({
      where: { userId: input.userId, enabled: true, invalidatedAt: null },
    });
    if (subscriptions > 0) {
      const quiet =
        !opts.bypassQuietHours &&
        input.type !== "SAFETY" && // safety notices ignore quiet hours
        evaluateQuietHours(settings, now);
      const viewing =
        !quiet && input.conversationId
          ? await isViewingConversation(client, input.userId, input.conversationId, now)
          : false;

      if (quiet || viewing) {
        pushStatus = "SUPPRESSED";
        rows.push({
          notificationId: notification.id,
          channel: "PUSH",
          status: "SUPPRESSED",
          errorCode: quiet ? "quiet_hours" : "viewing_conversation",
          idempotencyKey: `${input.dedupeKey}:push`,
        });
      } else {
        pushStatus = "PENDING";
        rows.push({
          notificationId: notification.id,
          channel: "PUSH",
          status: "PENDING",
          nextAttemptAt: now,
          idempotencyKey: `${input.dedupeKey}:push`,
        });
      }
    }
  }

  // EMAIL/SMS - safety and account notices only, never engagement volume.
  // EMAIL rows wait PENDING for processPendingEmail() when a provider is
  // configured; without one the row goes DEAD with not_configured
  // immediately. Nothing is ever fake-SENT.
  const category = categoryOf(input.type);
  if (category === "safety" || category === "account") {
    const emailPref = category === "safety" ? settings.safetyEmail : settings.accountEmail;
    if (emailPref) {
      const emailProvider = pickEmailProvider();
      rows.push({
        notificationId: notification.id,
        channel: "EMAIL",
        status: emailProvider.configured ? "PENDING" : "DEAD",
        provider: emailProvider.configured ? emailProvider.name : "none",
        ...(emailProvider.configured ? { nextAttemptAt: now } : { errorCode: "not_configured" }),
        idempotencyKey: `${input.dedupeKey}:email`,
      });
    }
    const smsPref =
      settings.smsEnabled && (category === "safety" ? settings.safetySms : settings.accountSms);
    if (smsPref) {
      const hasTwilio =
        !!process.env.TWILIO_ACCOUNT_SID?.trim() && !!process.env.TWILIO_AUTH_TOKEN?.trim();
      rows.push({
        notificationId: notification.id,
        channel: "SMS",
        status: hasTwilio ? "PENDING" : "DEAD",
        provider: hasTwilio ? "twilio" : "none",
        ...(hasTwilio ? {} : { errorCode: "not_configured" }),
        idempotencyKey: `${input.dedupeKey}:sms`,
      });
    }
  }

  const inserted = await client.notificationDelivery.createMany({
    data: rows,
    skipDuplicates: true,
  });
  if (inserted.count < rows.length) {
    // Lost a dedupe race: another call with the same key created the
    // deliveries between our check and our insert. Remove the duplicate
    // notification (and any delivery rows that did land, via cascade).
    await client.notification.delete({ where: { id: notification.id } });
    return { created: false, reason: "deduped" };
  }

  return { created: true, notificationId: notification.id, push: pushStatus };
}

// ---------------------------------------------------------------------------
// Push payload construction (privacy: no chat text, same-origin URLs only)
// ---------------------------------------------------------------------------

/** Safe push copy per type. Message-like types NEVER leak the message body. */
export function pushCopyFor(
  type: NotificationType,
  title: string,
  body: string | null,
): { title: string; body: string } {
  if (type === "NEW_MESSAGE" || type === "NEW_LIKE") {
    return { title: "New message", body: "Someone sent you a message on Tirvea." };
  }
  // Remaining types carry server-generated generic copy already.
  return { title, body: body ?? "" };
}

function sameOriginPath(url: unknown): string {
  return typeof url === "string" && url.startsWith("/") && !url.startsWith("//")
    ? url
    : "/notifications";
}

// ---------------------------------------------------------------------------
// Outbox worker
// ---------------------------------------------------------------------------

/** Exponential backoff after the nth failed attempt: 60s, 120s, 240s. */
export function pushBackoffMs(attempt: number): number {
  return 60_000 * 2 ** Math.max(0, attempt - 1);
}

export type DispatchResult = {
  deliveryId: string;
  status: DeliveryStatus | "skipped";
  endpoints: PushEndpointResult[];
};

/**
 * Sends one PENDING PUSH delivery to all of the recipient's devices and
 * records the outcome. Claims the row optimistically (status+attempt CAS)
 * so overlapping workers never double-send.
 */
export async function dispatchPushDelivery(
  deliveryId: string,
  now: Date = new Date(),
): Promise<DispatchResult> {
  const delivery = await db.notificationDelivery.findUnique({
    where: { id: deliveryId },
    include: { notification: true },
  });
  if (!delivery || delivery.channel !== "PUSH" || delivery.status !== "PENDING") {
    return { deliveryId, status: "skipped", endpoints: [] };
  }

  // Optimistic claim: bump attempt and lease the row for 5 minutes so a
  // crashed worker's rows become eligible again instead of sticking forever.
  const claimed = await db.notificationDelivery.updateMany({
    where: { id: delivery.id, status: "PENDING", attempt: delivery.attempt },
    data: { attempt: delivery.attempt + 1, nextAttemptAt: new Date(now.getTime() + 5 * 60_000) },
  });
  if (claimed.count === 0) return { deliveryId, status: "skipped", endpoints: [] };
  const attempt = delivery.attempt + 1;

  const n = delivery.notification;
  const data = (n.data ?? {}) as Record<string, unknown>;
  const copy = pushCopyFor(n.type, n.title, n.body);
  const conversationId = typeof data.conversationId === "string" ? data.conversationId : null;
  const matchId = typeof data.matchId === "string" ? data.matchId : null;
  // Deterministic tag: repeated pushes for the same conversation/match
  // collapse into one OS notification client-side.
  const tag = conversationId
    ? `msg-${conversationId}`
    : matchId
      ? `match-${matchId}`
      : `${n.type.toLowerCase()}-${n.id}`;

  const payload: PushPayload = {
    title: copy.title,
    body: copy.body,
    url: sameOriginPath(data.url),
    tag,
    type: n.type,
    notificationId: n.id,
  };

  const result = await sendPushToUser(n.userId, payload, { retry: attempt > 1 });

  if (result.attempted === 0) {
    // Every subscription is gone/disabled - retrying cannot help.
    await db.notificationDelivery.update({
      where: { id: delivery.id },
      data: { status: "DEAD", errorCode: "no_active_subscriptions", nextAttemptAt: null },
    });
    return { deliveryId, status: "DEAD", endpoints: result.results };
  }

  if (result.delivered > 0) {
    await db.notificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status: "SENT",
        provider: "web-push",
        sentAt: now,
        errorCode: null,
        errorMessage: null,
        nextAttemptAt: null,
      },
    });
    return { deliveryId, status: "SENT", endpoints: result.results };
  }

  const firstError = result.results[0];
  const dead = attempt >= MAX_PUSH_ATTEMPTS;
  await db.notificationDelivery.update({
    where: { id: delivery.id },
    data: {
      status: dead ? "DEAD" : "PENDING",
      errorCode: firstError?.statusCode ? `http_${firstError.statusCode}` : "send_failed",
      errorMessage: firstError?.error ?? null,
      nextAttemptAt: dead ? null : new Date(now.getTime() + pushBackoffMs(attempt)),
    },
  });
  return { deliveryId, status: dead ? "DEAD" : "PENDING", endpoints: result.results };
}

export type ProcessResult = {
  claimed: number;
  sent: number;
  dead: number;
  retrying: number;
};

/**
 * Drains due PENDING push deliveries (attempt < 4, nextAttemptAt reached).
 * Called after responses via schedulePushDispatch() and by the cron sweep
 * (which is what actually executes the backed-off retries).
 */
export async function processPendingPush(
  limit = 50,
  now: Date = new Date(),
): Promise<ProcessResult> {
  const due = await db.notificationDelivery.findMany({
    where: {
      channel: "PUSH",
      status: "PENDING",
      attempt: { lt: MAX_PUSH_ATTEMPTS },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  });

  const summary: ProcessResult = { claimed: 0, sent: 0, dead: 0, retrying: 0 };
  for (const row of due) {
    const result = await dispatchPushDelivery(row.id, now);
    if (result.status === "skipped") continue;
    summary.claimed += 1;
    if (result.status === "SENT") summary.sent += 1;
    else if (result.status === "DEAD") summary.dead += 1;
    else summary.retrying += 1;
  }
  return summary;
}

/**
 * Kick the outbox after the current response finishes (deferAfterResponse
 * seam - request-scoped in Next, detached promise in tests/scripts, so
 * callers never have to care).
 */
export function schedulePushDispatch(): void {
  const run = () =>
    processPendingPush().catch((error) => {
      console.error("[notify] push dispatch failed:", error);
    });
  deferAfterResponse(run);
}

/**
 * Kick BOTH outbox channels (push + email) after the response. Safety and
 * account notices use this so an email leaves promptly instead of waiting
 * for the 5-minute cron sweep (which still executes backed-off retries).
 */
export function scheduleOutboxDispatch(): void {
  const run = async () => {
    await processPendingPush().catch((error) => {
      console.error("[notify] push dispatch failed:", error);
    });
    await processPendingEmail().catch((error) => {
      console.error("[notify] email dispatch failed:", error);
    });
  };
  deferAfterResponse(run);
}

// ---------------------------------------------------------------------------
// Email outbox worker (provider abstraction in email.ts)
// ---------------------------------------------------------------------------

export const MAX_EMAIL_ATTEMPTS = 4;

/** Exponential backoff after the nth failed email attempt: 60s, 120s, 240s. */
export function emailBackoffMs(attempt: number): number {
  return 60_000 * 2 ** Math.max(0, attempt - 1);
}

export function isEmailSuppressed(email: string): Promise<boolean> {
  return db.suppressedEmail
    .findUnique({ where: { email: email.toLowerCase() }, select: { id: true } })
    .then((row) => !!row);
}

export type EmailDispatchResult = {
  deliveryId: string;
  status: DeliveryStatus | "skipped";
  errorCode?: string;
};

/**
 * Sends one PENDING EMAIL delivery through the configured provider and
 * records the honest outcome:
 *  - provider accepted            -> SENT (+ providerMessageId; DELIVERED/
 *                                   BOUNCED/COMPLAINED arrive via webhook)
 *  - suppressed recipient         -> DEAD "suppressed" (never sent)
 *  - not configured               -> DEAD "not_configured"
 *  - permanent provider rejection -> FAILED (errorCode/errorMessage kept)
 *  - transient failure            -> retry with backoff; after
 *                                   MAX_EMAIL_ATTEMPTS -> FAILED "max_attempts"
 * Claims the row optimistically (status+attempt CAS) like the push worker,
 * so overlapping workers never double-send.
 */
export async function dispatchEmailDelivery(
  deliveryId: string,
  now: Date = new Date(),
): Promise<EmailDispatchResult> {
  const delivery = await db.notificationDelivery.findUnique({
    where: { id: deliveryId },
    include: { notification: { include: { user: { select: { email: true } } } } },
  });
  if (!delivery || delivery.channel !== "EMAIL" || delivery.status !== "PENDING") {
    return { deliveryId, status: "skipped" };
  }

  // Optimistic claim (5-minute lease, same pattern as push).
  const claimed = await db.notificationDelivery.updateMany({
    where: { id: delivery.id, status: "PENDING", attempt: delivery.attempt },
    data: { attempt: delivery.attempt + 1, nextAttemptAt: new Date(now.getTime() + 5 * 60_000) },
  });
  if (claimed.count === 0) return { deliveryId, status: "skipped" };
  const attempt = delivery.attempt + 1;

  const fail = async (
    status: DeliveryStatus,
    errorCode: string,
    errorMessage: string | null,
    retryAt: Date | null,
  ): Promise<EmailDispatchResult> => {
    await db.notificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status,
        errorCode,
        errorMessage: errorMessage?.slice(0, 500) ?? null,
        nextAttemptAt: retryAt,
      },
    });
    return { deliveryId, status, errorCode };
  };

  const provider = pickEmailProvider();
  if (!provider.configured) {
    return fail("DEAD", "not_configured", "no email provider configured", null);
  }

  const to = delivery.notification.user.email.toLowerCase();
  // Suppression list: hard-bounced/complained addresses are dead ends -
  // sending again hurts deliverability and the recipient asked us to stop.
  if (await isEmailSuppressed(to)) {
    return fail("DEAD", "suppressed", "recipient address is on the suppression list", null);
  }

  const n = delivery.notification;
  const data = (n.data ?? {}) as Record<string, unknown>;
  const rendered = renderNotificationEmail({
    title: n.title,
    body: n.body,
    url: typeof data.url === "string" ? data.url : null,
  });

  const result = await provider.send({
    to,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    idempotencyKey: delivery.idempotencyKey,
  });

  if (result.ok) {
    await db.notificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status: "SENT",
        provider: provider.name,
        providerMessageId: result.providerMessageId,
        sentAt: now,
        errorCode: null,
        errorMessage: null,
        nextAttemptAt: null,
      },
    });
    return { deliveryId, status: "SENT" };
  }

  if (!result.transient) {
    return fail("FAILED", result.errorCode, result.errorMessage, null);
  }
  if (attempt >= MAX_EMAIL_ATTEMPTS) {
    return fail("FAILED", "max_attempts", `${result.errorCode}: ${result.errorMessage}`, null);
  }
  return fail(
    "PENDING",
    result.errorCode,
    result.errorMessage,
    new Date(now.getTime() + emailBackoffMs(attempt)),
  );
}

/**
 * Drains due PENDING EMAIL deliveries. Called by scheduleOutboxDispatch()
 * after safety/account notices and by the /api/cron/notifications sweep
 * (which executes the backed-off retries).
 */
export async function processPendingEmail(
  limit = 50,
  now: Date = new Date(),
): Promise<ProcessResult> {
  const due = await db.notificationDelivery.findMany({
    where: {
      channel: "EMAIL",
      status: "PENDING",
      attempt: { lt: MAX_EMAIL_ATTEMPTS },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  });

  const summary: ProcessResult = { claimed: 0, sent: 0, dead: 0, retrying: 0 };
  for (const row of due) {
    const result = await dispatchEmailDelivery(row.id, now);
    if (result.status === "skipped") continue;
    summary.claimed += 1;
    if (result.status === "SENT") summary.sent += 1;
    else if (result.status === "PENDING") summary.retrying += 1;
    else summary.dead += 1; // DEAD or FAILED - both terminal
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Email provider webhook application (route: /api/webhooks/email)
// ---------------------------------------------------------------------------

export type EmailWebhookEventType = "email.delivered" | "email.bounced" | "email.complained";

export type ApplyEmailEventResult =
  | { applied: true; deliveryId: string; status: DeliveryStatus; suppressed: boolean }
  | { applied: false; reason: "unknown_message" | "already_applied" | "ignored_type" };

/**
 * Apply one provider webhook event to the delivery lifecycle, idempotently:
 *  - email.delivered  -> SENT -> DELIVERED (deliveredAt stamped)
 *  - email.bounced    -> BOUNCED + the recipient joins SuppressedEmail
 *  - email.complained -> COMPLAINED + suppression (they marked us as spam)
 * A repeat delivery of the same event finds the row already in the target
 * state and no-ops. Unknown message ids report unknown_message (200 at the
 * route - provider retries must not error-loop).
 */
export async function applyEmailProviderEvent(
  type: string,
  providerMessageId: string,
  recipientEmail: string | null,
  now: Date = new Date(),
): Promise<ApplyEmailEventResult> {
  if (type !== "email.delivered" && type !== "email.bounced" && type !== "email.complained") {
    return { applied: false, reason: "ignored_type" };
  }
  const delivery = await db.notificationDelivery.findFirst({
    where: { providerMessageId, channel: "EMAIL" },
    include: { notification: { include: { user: { select: { email: true } } } } },
  });
  if (!delivery) return { applied: false, reason: "unknown_message" };

  const target: DeliveryStatus =
    type === "email.delivered" ? "DELIVERED" : type === "email.bounced" ? "BOUNCED" : "COMPLAINED";
  if (delivery.status === target) return { applied: false, reason: "already_applied" };
  // A terminal bounce/complaint outranks a late "delivered" event.
  if (
    target === "DELIVERED" &&
    (delivery.status === "BOUNCED" || delivery.status === "COMPLAINED")
  ) {
    return { applied: false, reason: "already_applied" };
  }

  await db.notificationDelivery.update({
    where: { id: delivery.id },
    data: {
      status: target,
      ...(target === "DELIVERED" ? { deliveredAt: now } : {}),
      ...(target !== "DELIVERED"
        ? { errorCode: target === "BOUNCED" ? "hard_bounce" : "complaint" }
        : {}),
    },
  });

  let suppressed = false;
  if (target === "BOUNCED" || target === "COMPLAINED") {
    const email = (recipientEmail ?? delivery.notification.user.email).toLowerCase();
    await db.suppressedEmail.upsert({
      where: { email },
      create: {
        email,
        reason: target === "BOUNCED" ? "hard_bounce" : "complaint",
        sourceMessageId: providerMessageId,
      },
      update: {}, // first suppression reason wins; row is already terminal
    });
    suppressed = true;
    console.warn(
      `[notify:email] ${email} suppressed (${target.toLowerCase()}) - delivery ${delivery.id}`,
    );
  }

  return { applied: true, deliveryId: delivery.id, status: target, suppressed };
}

// ---------------------------------------------------------------------------
// Cron housekeeping
// ---------------------------------------------------------------------------

/** Subscriptions silent for this long get revoked by the cron sweep. */
export const STALE_SUBSCRIPTION_DAYS = 90;

export async function revokeStaleSubscriptions(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_SUBSCRIPTION_DAYS * 24 * 3600 * 1000);
  const result = await db.notificationDevice.updateMany({
    where: {
      enabled: true,
      lastSeenAt: { lt: cutoff },
      OR: [{ lastSuccessAt: null }, { lastSuccessAt: { lt: cutoff } }],
    },
    data: { enabled: false, invalidatedAt: now },
  });
  return result.count;
}

/** Presence rows are only meaningful for 30s; drop anything older than a day. */
export async function prunePresence(now: Date = new Date()): Promise<number> {
  const result = await db.conversationPresence.deleteMany({
    where: { lastSeenAt: { lt: new Date(now.getTime() - 24 * 3600 * 1000) } },
  });
  return result.count;
}

/**
 * Explicit read-marking for the notification centre (Phase 0M): pages
 * render pure reads; the CLIENT calls POST /api/notifications/read after
 * paint. Idempotent - only unread rows change.
 */
export async function markNotificationsRead(userId: string): Promise<number> {
  const result = await db.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}
