import { after } from "next/server";
import { db } from "@/lib/db";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type {
  DeliveryStatus,
  NotificationType,
} from "@/generated/prisma/enums";
import {
  sendPushToUser,
  type PushEndpointResult,
  type PushPayload,
} from "@/lib/services/push";

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
 *  - EMAIL/SMS have no provider wired yet: rows are created for
 *    safety/account notices and immediately marked DEAD with
 *    errorCode "not_configured" unless the provider env exists (then they
 *    stay PENDING for the future email/sms worker - still never fake-SENT)
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
  return start < end
    ? minutes >= start && minutes < end
    : minutes >= start || minutes < end; // overnight wrap
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

const MAX_PUSH_ATTEMPTS = 4;

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
    await client.userSettings.createMany({ data: [{ userId: input.userId }], skipDuplicates: true });
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
    const subscriptions = await client.pushSubscription.count({
      where: { userId: input.userId, enabled: true, revokedAt: null },
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
  // No provider integration is wired yet: with the provider env present the
  // row waits PENDING for the future worker; without it the row goes DEAD
  // with not_configured immediately. Nothing is ever fake-SENT.
  const category = categoryOf(input.type);
  if (category === "safety" || category === "account") {
    const emailPref = category === "safety" ? settings.safetyEmail : settings.accountEmail;
    if (emailPref) {
      const hasResend = !!process.env.RESEND_API_KEY?.trim();
      rows.push({
        notificationId: notification.id,
        channel: "EMAIL",
        status: hasResend ? "PENDING" : "DEAD",
        provider: hasResend ? "resend" : "none",
        ...(hasResend ? {} : { errorCode: "not_configured" }),
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
  const conversationId =
    typeof data.conversationId === "string" ? data.conversationId : null;
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

  const result = await sendPushToUser(n.userId, payload);

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
 * Kick the outbox after the current response finishes. Uses Next's after()
 * inside a request scope; falls back to a detached promise anywhere else
 * (tests, scripts) so callers never have to care.
 */
export function schedulePushDispatch(): void {
  const run = () =>
    processPendingPush().catch((error) => {
      console.error("[notify] push dispatch failed:", error);
    });
  try {
    after(run);
  } catch {
    void run();
  }
}

// ---------------------------------------------------------------------------
// Cron housekeeping
// ---------------------------------------------------------------------------

/** Subscriptions silent for this long get revoked by the cron sweep. */
export const STALE_SUBSCRIPTION_DAYS = 90;

export async function revokeStaleSubscriptions(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_SUBSCRIPTION_DAYS * 24 * 3600 * 1000);
  const result = await db.pushSubscription.updateMany({
    where: {
      enabled: true,
      lastSeenAt: { lt: cutoff },
      OR: [{ lastSuccessAt: null }, { lastSuccessAt: { lt: cutoff } }],
    },
    data: { enabled: false, revokedAt: now },
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
