"use client";

import { getServiceWorkerRegistration, registerServiceWorker } from "@/lib/notifications/register";

/**
 * Client half of Web Push, matched to the real server routes:
 *   GET  /api/push/status      -> { data: { configured, vapidPublicKey, subscriptions } }
 *   POST /api/push/subscribe   -> { data: { id, rebound } }
 *   POST /api/push/unsubscribe -> { data: { revoked: true } }   (body { endpoint })
 *   POST /api/push/test        -> { data: { notificationId, status, devices } }
 * Every endpoint string coming back is truncated server-side - full
 * endpoints are capability URLs and never leave the server.
 */

export type PushDevice = {
  id: string;
  /** Truncated endpoint - display only. */
  endpoint: string;
  platform: string | null;
  browser: string | null;
  deviceLabel: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  lastSuccessAt: string | null;
  failureCount: number;
};

export type PushStatus = {
  configured: boolean;
  vapidPublicKey: string | null;
  devices: PushDevice[];
};

export type PushTestResult = {
  /** Truncated endpoint identifying the device. */
  device: string;
  ok: boolean;
  error?: string;
};

type ApiErrorBody = { error?: { code?: string; message?: string } };

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
  return body?.error?.message ?? fallback;
}

/** VAPID key (base64url) -> the Uint8Array PushManager.subscribe expects. */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

/**
 * Server push status. `null` means the status endpoint itself is
 * unreachable - callers treat that as "not configured on the server
 * yet", honestly.
 */
export async function fetchPushStatus(): Promise<PushStatus | null> {
  try {
    const res = await fetch("/api/push/status");
    if (!res.ok) return null;
    const { data } = (await res.json()) as {
      data: { configured: boolean; vapidPublicKey: string | null; subscriptions: PushDevice[] };
    };
    return {
      configured: data.configured === true,
      vapidPublicKey: data.vapidPublicKey ?? null,
      devices: data.subscriptions ?? [],
    };
  } catch {
    return null;
  }
}

/** This browser's current push subscription, if any. */
export async function getLocalSubscription(): Promise<PushSubscription | null> {
  const registration = await getServiceWorkerRegistration();
  if (!registration || !("pushManager" in registration)) return null;
  try {
    return await registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/** Best-effort platform/browser labels so device rows are readable. */
function describeClient(): { platform: string; browser: string } {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const platform = /iPhone|iPad|iPod/i.test(ua)
    ? "iOS"
    : /Android/i.test(ua)
      ? "Android"
      : /Macintosh/i.test(ua)
        ? "macOS"
        : /Windows/i.test(ua)
          ? "Windows"
          : /Linux/i.test(ua)
            ? "Linux"
            : "Unknown";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : /Firefox\//.test(ua)
            ? "Firefox"
            : "Unknown";
  return { platform, browser };
}

/**
 * Full subscribe flow AFTER permission is granted: ensure the worker,
 * subscribe against the push service, register with the server.
 * Throws with a human-readable message on any failure.
 */
export async function subscribeToPush(vapidPublicKey: string): Promise<void> {
  const registration = (await registerServiceWorker()) ?? (await getServiceWorkerRegistration());
  if (!registration) throw new Error("Service worker could not be registered.");

  const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: applicationServerKey.buffer as ArrayBuffer,
  });

  const { platform, browser } = describeClient();
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subscription: subscription.toJSON(),
      userAgent: navigator.userAgent,
      platform,
      browser,
    }),
  });
  if (!res.ok) {
    // Server rejected it - drop the orphan browser subscription.
    const message = await errorMessage(res, "The server could not save this device.");
    await subscription.unsubscribe().catch(() => undefined);
    throw new Error(message);
  }
}

/** Unsubscribe this browser and tell the server to revoke the endpoint. */
export async function unsubscribeFromPush(): Promise<void> {
  const subscription = await getLocalSubscription();
  if (!subscription) return;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe().catch(() => undefined);
  await fetch("/api/push/unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
    keepalive: true,
  }).catch(() => undefined);
}

/** Fire a real server-side test push; returns honest per-device results. */
export async function sendTestPush(): Promise<PushTestResult[]> {
  const res = await fetch("/api/push/test", { method: "POST" });
  if (!res.ok) {
    throw new Error(await errorMessage(res, "The test could not be sent."));
  }
  const { data } = (await res.json()) as {
    data: {
      devices: { endpoint: string; ok: boolean; error: string | null }[];
    };
  };
  return (data.devices ?? []).map((d) => ({
    device: d.endpoint,
    ok: d.ok,
    error: d.error ?? undefined,
  }));
}
