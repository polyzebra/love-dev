import type { NotificationTransport } from "@/generated/prisma/enums";
import { isWebPushSendable, sendWebPush, type PushSendOptions } from "@/lib/services/push";

/**
 * Transport adapters (Phase 0H). ONE canonical notification event
 * (notifyUser -> Notification row + outbox deliveries) fans out through
 * these; Web Push is just one adapter, not the domain model. APNS/FCM
 * are registered here with real storage and fan-out paths but answer
 * `transport_not_configured` until native credentials ship - no native
 * SDKs, no fake sends (same rule as the EMAIL/SMS channels).
 *
 * Credential hygiene: adapters receive only the delivery material for
 * one device and must never log a whole token/endpoint (see
 * truncateToken/truncateEndpoint).
 */

/** The delivery material one adapter needs for one device. */
export type DeviceTarget = {
  id: string;
  transport: NotificationTransport;
  endpoint: string | null;
  p256dh: string | null;
  auth: string | null;
  token: string | null;
  environment: string;
};

export type AdapterSendResult =
  | { ok: true; statusCode: number | null }
  | {
      ok: false;
      statusCode: number | null;
      /** The provider says this token/endpoint is gone - invalidate the device. */
      tokenInvalid: boolean;
      /** false = retrying cannot help (config/permanent errors). */
      retryable: boolean;
      error: string;
    };

export interface NotificationTransportAdapter {
  readonly transport: NotificationTransport;
  /** Can this adapter actually send right now (credentials present)? */
  configured(): boolean;
  send(
    device: DeviceTarget,
    payloadJson: string,
    options: PushSendOptions,
  ): Promise<AdapterSendResult>;
}

// ---------------------------------------------------------------------------
// WEB_PUSH - live (wraps the existing injectable web-push transport)
// ---------------------------------------------------------------------------

const webPushAdapter: NotificationTransportAdapter = {
  transport: "WEB_PUSH",
  configured: () => isWebPushSendable(),
  async send(device, payloadJson, options) {
    if (!device.endpoint || !device.p256dh || !device.auth) {
      return {
        ok: false,
        statusCode: null,
        tokenInvalid: true,
        retryable: false,
        error: "web_push_material_missing",
      };
    }
    try {
      const res = await sendWebPush(
        { endpoint: device.endpoint, p256dh: device.p256dh, auth: device.auth },
        payloadJson,
        options,
      );
      return { ok: true, statusCode: res.statusCode };
    } catch (error) {
      const statusCode =
        typeof (error as { statusCode?: unknown })?.statusCode === "number"
          ? (error as { statusCode: number }).statusCode
          : null;
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        statusCode,
        // 404/410: the push service says the endpoint no longer exists.
        tokenInvalid: statusCode === 404 || statusCode === 410,
        retryable: statusCode !== 404 && statusCode !== 410,
        error: message.slice(0, 200),
      };
    }
  },
};

// ---------------------------------------------------------------------------
// APNS / FCM - storage + fan-out ready, sending gated on credentials.
// Env names are reserved now so ops can prepare; the real senders land
// with the native shells (NO native SDKs in this phase).
// ---------------------------------------------------------------------------

const APNS_ENV = ["APNS_KEY_ID", "APNS_TEAM_ID", "APNS_PRIVATE_KEY", "APNS_BUNDLE_ID"] as const;
const FCM_ENV = ["FCM_SERVICE_ACCOUNT_JSON"] as const;

function envConfigured(names: readonly string[]): boolean {
  return names.every((name) => !!process.env[name]?.trim());
}

function unconfiguredAdapter(
  transport: NotificationTransport,
  env: readonly string[],
): NotificationTransportAdapter {
  return {
    transport,
    // Credentials may exist ahead of the sender shipping; either way the
    // send answers honestly instead of pretending.
    configured: () => false,
    async send() {
      return {
        ok: false,
        statusCode: null,
        tokenInvalid: false,
        retryable: false,
        error: envConfigured(env) ? "transport_sender_not_implemented" : "transport_not_configured",
      };
    },
  };
}

const apnsAdapter = unconfiguredAdapter("APNS", APNS_ENV);
const fcmAdapter = unconfiguredAdapter("FCM", FCM_ENV);

// ---------------------------------------------------------------------------
// Registry + test seam
// ---------------------------------------------------------------------------

const REAL_ADAPTERS: Record<NotificationTransport, NotificationTransportAdapter> = {
  WEB_PUSH: webPushAdapter,
  APNS: apnsAdapter,
  FCM: fcmAdapter,
};

const overrides = new Map<NotificationTransport, NotificationTransportAdapter>();

/** Test seam: inject a fake adapter for one transport (null restores). */
export function setTransportAdapter(
  transport: NotificationTransport,
  adapter: NotificationTransportAdapter | null,
): void {
  if (adapter) overrides.set(transport, adapter);
  else overrides.delete(transport);
}

export function adapterFor(transport: NotificationTransport): NotificationTransportAdapter {
  return overrides.get(transport) ?? REAL_ADAPTERS[transport];
}

/** Build a simple in-memory fake adapter for tests. */
export function fakeAdapter(
  transport: NotificationTransport,
  behavior: (device: DeviceTarget) => AdapterSendResult | Promise<AdapterSendResult>,
): NotificationTransportAdapter & { sends: DeviceTarget[] } {
  const sends: DeviceTarget[] = [];
  return {
    transport,
    sends,
    configured: () => true,
    async send(device) {
      sends.push(device);
      return behavior(device);
    },
  };
}
