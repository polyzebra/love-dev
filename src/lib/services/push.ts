import { db } from "@/lib/db";
import { recordAuthEvent } from "@/lib/auth/audit";
import type { NotificationTransport, NotificationType } from "@/generated/prisma/enums";
import { adapterFor } from "@/lib/services/notification-transports";
import { recordTransportAttempt } from "@/lib/services/notification-metrics";

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
        "(mailto:info@tirvea.com) locally and in Vercel.",
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

/** One raw web-push send (adapter entry point - tests inject via setPushTransport). */
export async function sendWebPush(
  target: PushEndpoint,
  payload: string,
  options: PushSendOptions,
): Promise<{ statusCode: number }> {
  return activeTransport()(target, payload, options);
}

/** True when web-push can actually send (real VAPID config OR a test transport). */
export function isWebPushSendable(): boolean {
  return transportOverride !== null || isPushConfigured();
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
  appVersion?: string | null;
};

/**
 * Upsert a WEB_PUSH device for `userId`, keyed by endpoint (one transport
 * adapter's registration shape - see registerDeviceToken for APNS/FCM). An endpoint
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
  const existing = await db.notificationDevice.findUnique({
    where: { endpoint: input.endpoint },
    select: { id: true, userId: true },
  });
  const rebound = !!existing && existing.userId !== userId;

  const fields = {
    userId,
    transport: "WEB_PUSH" as const,
    p256dh: input.p256dh,
    auth: input.auth,
    userAgent: input.userAgent ?? null,
    platform: input.platform ?? null,
    browser: input.browser ?? null,
    deviceLabel: input.deviceLabel ?? null,
    installationId: input.installationId ?? null,
    appVersion: input.appVersion ?? null,
    enabled: true,
    invalidatedAt: null,
    failureCount: 0,
    lastSeenAt: new Date(),
  };

  const subscription = await db.notificationDevice.upsert({
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
  const result = await db.notificationDevice.updateMany({
    where: { endpoint, userId },
    data: { enabled: false, invalidatedAt: new Date() },
  });
  if (result.count === 0) return false;
  await recordAuthEvent({ type: "push_unsubscribed", userId, req });
  return true;
}

// ---------------------------------------------------------------------------
// Native device tokens (APNS/FCM) - registration/rotation/revocation are
// live NOW so the model and API are proven; sending activates when the
// transport credentials ship (notification-transports.ts).
// ---------------------------------------------------------------------------

export type RegisterDeviceTokenInput = {
  transport: Extract<NotificationTransport, "APNS" | "FCM">;
  token: string;
  installationId?: string | null;
  platform?: string | null;
  deviceLabel?: string | null;
  appVersion?: string | null;
  /** APNs sandbox vs production, FCM project flavor. */
  environment?: "production" | "development";
};

/**
 * Upsert a native device token, keyed by (unique) token. Rotation: when
 * the same installation re-registers with a NEW token, every other row
 * for that installation+transport is invalidated - exactly one live
 * token per app install. A token bound to a DIFFERENT user is rebound to
 * the caller and audited (device changed hands), like web endpoints.
 */
export async function registerDeviceToken(
  userId: string,
  input: RegisterDeviceTokenInput,
  req?: Request,
): Promise<{ id: string; rebound: boolean; rotatedOut: number }> {
  const existing = await db.notificationDevice.findUnique({
    where: { token: input.token },
    select: { id: true, userId: true },
  });
  const rebound = !!existing && existing.userId !== userId;

  const fields = {
    userId,
    transport: input.transport,
    platform: input.platform ?? null,
    deviceLabel: input.deviceLabel ?? null,
    installationId: input.installationId ?? null,
    appVersion: input.appVersion ?? null,
    environment: input.environment ?? "production",
    enabled: true,
    invalidatedAt: null,
    failureCount: 0,
    lastSeenAt: new Date(),
  };

  const device = await db.notificationDevice.upsert({
    where: { token: input.token },
    create: { token: input.token, ...fields },
    update: fields,
    select: { id: true },
  });

  // Token rotation: retire this installation's other tokens on this transport.
  let rotatedOut = 0;
  if (input.installationId) {
    const rotated = await db.notificationDevice.updateMany({
      where: {
        installationId: input.installationId,
        transport: input.transport,
        id: { not: device.id },
        enabled: true,
      },
      data: { enabled: false, invalidatedAt: new Date() },
    });
    rotatedOut = rotated.count;
  }

  await recordAuthEvent({
    type: rebound ? "push_subscription_rebound" : "push_subscribed",
    userId,
    req,
    metadata: {
      subscriptionId: device.id,
      transport: input.transport,
      ...(rebound && existing ? { previousUserId: existing.userId } : {}),
      platform: input.platform ?? null,
      ...(rotatedOut > 0 ? { rotatedOut } : {}),
    },
  });

  return { id: device.id, rebound, rotatedOut };
}

/** Revoke the caller's own device by token. Idempotent; row kept for audit. */
export async function revokeDeviceToken(
  userId: string,
  token: string,
  req?: Request,
): Promise<boolean> {
  const result = await db.notificationDevice.updateMany({
    where: { token, userId },
    data: { enabled: false, invalidatedAt: new Date() },
  });
  if (result.count === 0) return false;
  await recordAuthEvent({ type: "push_unsubscribed", userId, req });
  return true;
}

/** Active devices for the status route - credentials truncated, never whole. */
export async function listPushDevices(userId: string) {
  const devices = await db.notificationDevice.findMany({
    where: { userId, enabled: true, invalidatedAt: null },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      transport: true,
      endpoint: true,
      token: true,
      platform: true,
      browser: true,
      deviceLabel: true,
      installationId: true,
      appVersion: true,
      environment: true,
      createdAt: true,
      lastSeenAt: true,
      lastSuccessAt: true,
      failureCount: true,
    },
  });
  return devices.map((d) => ({
    ...d,
    endpoint: d.endpoint ? truncateEndpoint(d.endpoint) : null,
    token: d.token ? truncateToken(d.token) : null,
  }));
}

// ---------------------------------------------------------------------------
// Fan-out
// ---------------------------------------------------------------------------

export type PushEndpointResult = {
  subscriptionId: string;
  transport: NotificationTransport;
  /** Truncated endpoint/token - credentials never leave whole. */
  endpoint: string;
  ok: boolean;
  statusCode: number | null;
  /** true when this send invalidated the device (endpoint/token gone). */
  revoked: boolean;
  /** true when repeated failures disabled the device. */
  disabled: boolean;
  error: string | null;
};

export type SendPushResult = {
  attempted: number;
  delivered: number;
  /** Devices whose transport cannot send yet (adapter unconfigured). */
  skipped: number;
  results: PushEndpointResult[];
};

export function truncateEndpoint(endpoint: string): string {
  return endpoint.length <= 60 ? endpoint : `${endpoint.slice(0, 57)}...`;
}

/** Device tokens are credentials: only the last 6 chars ever leave the DB. */
export function truncateToken(token: string): string {
  return `…${token.slice(-6)}`;
}

/** Failures at or beyond this count permanently disable a subscription. */
export const MAX_ENDPOINT_FAILURES = 5;

/**
 * ONE canonical event, fanned out through the transport adapters: sends
 * `payload` to every enabled, non-invalidated device the user has,
 * whatever its transport. Per-device bookkeeping:
 *  - token/endpoint gone (provider said so): invalidatedAt + enabled=false
 *  - other failure: failureCount++ / lastFailureAt; at
 *    MAX_ENDPOINT_FAILURES the device is disabled for good
 *  - success: lastSuccessAt, failureCount reset to 0
 *  - transport not configured (e.g. an FCM token before FCM credentials
 *    ship): SKIPPED - no attempt, no failure penalty for the device
 * Every attempt lands in the transport metrics (latency, outcome, retry).
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
  opts: { retry?: boolean } = {},
): Promise<SendPushResult> {
  const devices = await db.notificationDevice.findMany({
    where: { userId, enabled: true, invalidatedAt: null },
    orderBy: { createdAt: "asc" },
  });

  const policy = deliveryPolicyFor(payload.type);
  const body = JSON.stringify(payload);
  const now = new Date();

  const results: PushEndpointResult[] = [];
  let skipped = 0;

  for (const device of devices) {
    const adapter = adapterFor(device.transport);
    const label = device.endpoint
      ? truncateEndpoint(device.endpoint)
      : device.token
        ? truncateToken(device.token)
        : "unknown";

    if (!adapter.configured()) {
      skipped += 1;
      continue;
    }

    const startedAt = Date.now();
    const res = await adapter.send(
      {
        id: device.id,
        transport: device.transport,
        endpoint: device.endpoint,
        p256dh: device.p256dh,
        auth: device.auth,
        token: device.token,
        environment: device.environment,
      },
      body,
      { ttl: policy.ttl, urgency: policy.urgency, topic: undefined },
    );
    const latencyMs = Date.now() - startedAt;

    if (res.ok) {
      recordTransportAttempt({
        transport: device.transport,
        outcome: "delivered",
        latencyMs,
        retry: !!opts.retry,
      });
      await db.notificationDevice.update({
        where: { id: device.id },
        data: { lastSuccessAt: now, failureCount: 0 },
      });
      results.push({
        subscriptionId: device.id,
        transport: device.transport,
        endpoint: label,
        ok: true,
        statusCode: res.statusCode,
        revoked: false,
        disabled: false,
        error: null,
      });
      continue;
    }

    if (res.tokenInvalid) {
      // The provider says this endpoint/token no longer exists.
      recordTransportAttempt({
        transport: device.transport,
        outcome: "invalid_token",
        latencyMs,
        retry: !!opts.retry,
      });
      await db.notificationDevice.update({
        where: { id: device.id },
        data: { enabled: false, invalidatedAt: now, lastFailureAt: now },
      });
      results.push({
        subscriptionId: device.id,
        transport: device.transport,
        endpoint: label,
        ok: false,
        statusCode: res.statusCode,
        revoked: true,
        disabled: false,
        error: "endpoint_gone",
      });
      continue;
    }

    recordTransportAttempt({
      transport: device.transport,
      outcome: "failed",
      latencyMs,
      retry: !!opts.retry,
    });
    const failureCount = device.failureCount + 1;
    const disable = failureCount >= MAX_ENDPOINT_FAILURES;
    await db.notificationDevice.update({
      where: { id: device.id },
      data: {
        failureCount,
        lastFailureAt: now,
        ...(disable ? { enabled: false } : {}),
      },
    });
    results.push({
      subscriptionId: device.id,
      transport: device.transport,
      endpoint: label,
      ok: false,
      statusCode: res.statusCode,
      revoked: false,
      disabled: disable,
      error: res.error.slice(0, 200),
    });
  }

  return {
    attempted: results.length,
    delivered: results.filter((r) => r.ok).length,
    skipped,
    results,
  };
}
