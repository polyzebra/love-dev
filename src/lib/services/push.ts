import { db } from "@/lib/db";
import { recordAuthEvent } from "@/lib/auth/audit";
import type { NotificationType } from "@/generated/prisma/enums";

/**
 * Web Push transport. Wraps the `web-push` library behind a tiny injectable
 * transport so the unit suite can spy on sends without ever touching a real
 * push service.
 *
 * Key handling:
 *  - NEXT_PUBLIC_VAPID_PUBLIC_KEY is safe to expose (clients need it to
 *    subscribe).
 *  - VAPID_PRIVATE_KEY lives ONLY in env. It is never stored in the
 *    database, never logged, never returned by any route.
 *  - Configuration is validated lazily: a build (or a deploy) without the
 *    keys succeeds; routes answer 503 until they are set.
 *
 * Payload discipline: the encrypted payload NEVER contains chat text -
 * callers pass safe generic copy plus a same-origin path the client opens.
 */

// ---------------------------------------------------------------------------
// Configuration (lazy - never crashes a keyless build)
// ---------------------------------------------------------------------------

const VAPID_ENV_NAMES = [
  "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
] as const;

export type VapidConfig = {
  configured: boolean;
  missing: string[];
  publicKey: string | null;
};

export function getVapidConfig(): VapidConfig {
  const missing = VAPID_ENV_NAMES.filter((name) => !process.env[name]?.trim());
  return {
    configured: missing.length === 0,
    missing,
    publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() || null,
  };
}

export function isPushConfigured(): boolean {
  return getVapidConfig().configured;
}

/** Throws a clear, actionable error naming exactly which env vars are absent. */
function assertConfigured(): { publicKey: string; privateKey: string; subject: string } {
  const cfg = getVapidConfig();
  if (!cfg.configured) {
    throw new Error(
      `Web Push is not configured - missing env: ${cfg.missing.join(", ")}. ` +
        "Generate a keypair with `npx web-push generate-vapid-keys` and set " +
        "NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT " +
        "(mailto:support@tirvea.app) locally and in Vercel.",
    );
  }
  return {
    publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!.trim(),
    privateKey: process.env.VAPID_PRIVATE_KEY!.trim(),
    subject: process.env.VAPID_SUBJECT!.trim(),
  };
}

// ---------------------------------------------------------------------------
// Injectable transport
// ---------------------------------------------------------------------------

export type PushEndpoint = { endpoint: string; p256dh: string; auth: string };

export type PushSendOptions = {
  /** Seconds the push service may hold the message for an offline device. */
  ttl: number;
  urgency: "very-low" | "low" | "normal" | "high";
  /** Collapse key - a newer push with the same topic replaces the older one. */
  topic?: string;
};

/**
 * Sends one encrypted payload to one endpoint. Resolves on 2xx; rejects
 * with an error carrying `statusCode` otherwise (matching web-push's
 * WebPushError shape). Tests inject a spy here via setPushTransport.
 */
export type PushTransport = (
  target: PushEndpoint,
  payload: string,
  options: PushSendOptions,
) => Promise<{ statusCode: number }>;

let transportOverride: PushTransport | null = null;

/** Test seam: inject a fake transport (pass null to restore the real one). */
export function setPushTransport(transport: PushTransport | null): void {
  transportOverride = transport;
}

async function realTransport(
  target: PushEndpoint,
  payload: string,
  options: PushSendOptions,
): Promise<{ statusCode: number }> {
  const { publicKey, privateKey, subject } = assertConfigured();
  // Lazy import keeps web-push (and its crypto setup) out of routes that
  // never send, and out of any client bundle graph entirely.
  const { default: webpush } = await import("web-push");
  const result = await webpush.sendNotification(
    {
      endpoint: target.endpoint,
      keys: { p256dh: target.p256dh, auth: target.auth },
    },
    payload,
    {
      vapidDetails: { subject, publicKey, privateKey },
      TTL: options.ttl,
      urgency: options.urgency,
      ...(options.topic ? { topic: options.topic } : {}),
    },
  );
  return { statusCode: result.statusCode };
}

function activeTransport(): PushTransport {
  return transportOverride ?? realTransport;
}

// ---------------------------------------------------------------------------
// Payload + per-type delivery policy
// ---------------------------------------------------------------------------

export type PushPayload = {
  title: string;
  body: string;
  /** Same-origin path (e.g. /chat/abc123) - never a full external URL. */
  url: string;
  /** Deterministic notification tag so repeats collapse client-side. */
  tag: string;
  type: NotificationType;
  notificationId: string;
};

/** TTL/urgency by notification type: messages are ephemeral, matches keep. */
export function deliveryPolicyFor(type: NotificationType): {
  ttl: number;
  urgency: PushSendOptions["urgency"];
} {
  switch (type) {
    case "NEW_MESSAGE":
      return { ttl: 3600, urgency: "high" };
    case "NEW_MATCH":
    case "NEW_LIKE":
    case "SUPER_LIKE":
      return { ttl: 86400, urgency: "high" };
    case "SAFETY":
      return { ttl: 86400, urgency: "high" };
    default:
      return { ttl: 3600, urgency: "normal" };
  }
}

// ---------------------------------------------------------------------------
// Subscription registry
// ---------------------------------------------------------------------------

export type RegisterSubscriptionInput = {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
  platform?: string | null;
  browser?: string | null;
  deviceLabel?: string | null;
  installationId?: string | null;
};

/**
 * Upsert a device subscription for `userId`, keyed by endpoint. An endpoint
 * currently bound to a DIFFERENT user is rebound to the caller and audited
 * (same browser profile, new account - the device changed hands): a push
 * endpoint must only ever notify the account that owns the session.
 * Re-registering also re-enables a previously revoked/failed endpoint.
 */
export async function registerPushSubscription(
  userId: string,
  input: RegisterSubscriptionInput,
  req?: Request,
): Promise<{ id: string; rebound: boolean }> {
  const existing = await db.pushSubscription.findUnique({
    where: { endpoint: input.endpoint },
    select: { id: true, userId: true },
  });
  const rebound = !!existing && existing.userId !== userId;

  const fields = {
    userId,
    p256dh: input.p256dh,
    auth: input.auth,
    userAgent: input.userAgent ?? null,
    platform: input.platform ?? null,
    browser: input.browser ?? null,
    deviceLabel: input.deviceLabel ?? null,
    installationId: input.installationId ?? null,
    enabled: true,
    revokedAt: null,
    failureCount: 0,
    lastSeenAt: new Date(),
  };

  const subscription = await db.pushSubscription.upsert({
    where: { endpoint: input.endpoint },
    create: { endpoint: input.endpoint, ...fields },
    update: fields,
    select: { id: true },
  });

  await recordAuthEvent({
    type: rebound ? "push_subscription_rebound" : "push_subscribed",
    userId,
    req,
    metadata: {
      subscriptionId: subscription.id,
      ...(rebound && existing ? { previousUserId: existing.userId } : {}),
      platform: input.platform ?? null,
      browser: input.browser ?? null,
    },
  });

  return { id: subscription.id, rebound };
}

/**
 * Revoke the caller's own subscription for `endpoint`. Returns false when
 * no subscription with that endpoint belongs to this user (someone else's
 * endpoint is indistinguishable from a nonexistent one). The row is kept
 * (revokedAt + enabled=false) for device-history audit. Idempotent.
 */
export async function revokePushSubscription(
  userId: string,
  endpoint: string,
  req?: Request,
): Promise<boolean> {
  const result = await db.pushSubscription.updateMany({
    where: { endpoint, userId },
    data: { enabled: false, revokedAt: new Date() },
  });
  if (result.count === 0) return false;
  await recordAuthEvent({ type: "push_unsubscribed", userId, req });
  return true;
}

/** Active devices for the status route - endpoints truncated. */
export async function listPushDevices(userId: string) {
  const subscriptions = await db.pushSubscription.findMany({
    where: { userId, enabled: true, revokedAt: null },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      endpoint: true,
      platform: true,
      browser: true,
      deviceLabel: true,
      installationId: true,
      createdAt: true,
      lastSeenAt: true,
      lastSuccessAt: true,
      failureCount: true,
    },
  });
  return subscriptions.map((s) => ({ ...s, endpoint: truncateEndpoint(s.endpoint) }));
}

// ---------------------------------------------------------------------------
// Fan-out
// ---------------------------------------------------------------------------

export type PushEndpointResult = {
  subscriptionId: string;
  /** Truncated endpoint - full endpoints are capability URLs, keep them out of logs/responses. */
  endpoint: string;
  ok: boolean;
  statusCode: number | null;
  /** true when this send caused the subscription to be revoked (404/410). */
  revoked: boolean;
  /** true when repeated failures disabled the subscription. */
  disabled: boolean;
  error: string | null;
};

export type SendPushResult = {
  attempted: number;
  delivered: number;
  results: PushEndpointResult[];
};

export function truncateEndpoint(endpoint: string): string {
  return endpoint.length <= 60 ? endpoint : `${endpoint.slice(0, 57)}...`;
}

/** Failures at or beyond this count permanently disable a subscription. */
export const MAX_ENDPOINT_FAILURES = 5;

/**
 * Sends `payload` to every enabled, unrevoked subscription the user has.
 * Per-endpoint bookkeeping:
 *  - 404/410 (endpoint gone): revokedAt + enabled=false - the browser
 *    unsubscribed or the subscription expired.
 *  - other failure: failureCount++ / lastFailureAt; at MAX_ENDPOINT_FAILURES
 *    the subscription is disabled for good.
 *  - success: lastSuccessAt, failureCount reset to 0.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<SendPushResult> {
  const subscriptions = await db.pushSubscription.findMany({
    where: { userId, enabled: true, revokedAt: null },
    orderBy: { createdAt: "asc" },
  });

  const policy = deliveryPolicyFor(payload.type);
  const body = JSON.stringify(payload);
  const transport = activeTransport();
  const now = new Date();

  const results: PushEndpointResult[] = [];
  for (const sub of subscriptions) {
    const target = { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth };
    try {
      const res = await transport(target, body, {
        ttl: policy.ttl,
        urgency: policy.urgency,
        topic: undefined,
      });
      await db.pushSubscription.update({
        where: { id: sub.id },
        data: { lastSuccessAt: now, failureCount: 0 },
      });
      results.push({
        subscriptionId: sub.id,
        endpoint: truncateEndpoint(sub.endpoint),
        ok: true,
        statusCode: res.statusCode,
        revoked: false,
        disabled: false,
        error: null,
      });
    } catch (error) {
      const statusCode =
        typeof (error as { statusCode?: unknown })?.statusCode === "number"
          ? (error as { statusCode: number }).statusCode
          : null;
      const message = error instanceof Error ? error.message : String(error);

      if (statusCode === 404 || statusCode === 410) {
        // The push service says this endpoint no longer exists.
        await db.pushSubscription.update({
          where: { id: sub.id },
          data: { enabled: false, revokedAt: now, lastFailureAt: now },
        });
        results.push({
          subscriptionId: sub.id,
          endpoint: truncateEndpoint(sub.endpoint),
          ok: false,
          statusCode,
          revoked: true,
          disabled: false,
          error: "endpoint_gone",
        });
        continue;
      }

      const failureCount = sub.failureCount + 1;
      const disable = failureCount >= MAX_ENDPOINT_FAILURES;
      await db.pushSubscription.update({
        where: { id: sub.id },
        data: {
          failureCount,
          lastFailureAt: now,
          ...(disable ? { enabled: false } : {}),
        },
      });
      results.push({
        subscriptionId: sub.id,
        endpoint: truncateEndpoint(sub.endpoint),
        ok: false,
        statusCode,
        revoked: false,
        disabled: disable,
        error: message.slice(0, 200),
      });
    }
  }

  return {
    attempted: results.length,
    delivered: results.filter((r) => r.ok).length,
    results,
  };
}
