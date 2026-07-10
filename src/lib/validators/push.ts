import { z } from "zod";

/**
 * Web Push subscription payloads. The endpoint is a capability URL minted
 * by the browser's push service - we only accept https endpoints on hosts
 * that are recognisable push services, and never our own origin/loopback
 * (an attacker-controlled endpoint would receive encrypted-but-routable
 * traffic and turn us into a request proxy).
 */

export const pushSubscribeSchema = z
  .object({
    subscription: z.object({
      endpoint: z.string().min(1).max(2048),
      expirationTime: z.number().nullable().optional(),
      keys: z.object({
        p256dh: z.string().min(1).max(512),
        auth: z.string().min(1).max(512),
      }),
    }),
    userAgent: z.string().max(512).optional(),
    platform: z.string().max(128).optional(),
    browser: z.string().max(128).optional(),
    installationId: z.string().max(128).optional(),
    deviceLabel: z.string().max(128).optional(),
  })
  .strict();

export type PushSubscribeInput = z.infer<typeof pushSubscribeSchema>;

export const pushUnsubscribeSchema = z
  .object({ endpoint: z.string().min(1).max(2048) })
  .strict();

/**
 * Hosts (exact or dot-suffix) operated by the browser vendors' push
 * services. Deliberately a little permissive within each vendor's domain -
 * push service hostnames shift (regional shards) - but never beyond them.
 */
const PUSH_HOST_EXACT = new Set(["fcm.googleapis.com", "web.push.apple.com"]);
const PUSH_HOST_SUFFIXES = [
  ".googleapis.com", // Chrome/FCM shards
  ".push.apple.com", // Safari
  ".mozilla.com", // Firefox (autopush)
  ".mozaws.net", // Firefox (legacy autopush hosts)
  ".windows.com", // Edge/WNS (notify.windows.com shards)
];

const LOOPBACK_OR_PRIVATE =
  /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0$|\[::1?\]$|::1$)/i;

export type EndpointCheck = { ok: true; url: URL } | { ok: false; reason: string };

export function validatePushEndpoint(raw: string, appOrigin?: string | null): EndpointCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "endpoint_invalid_url" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "endpoint_not_https" };

  const host = url.hostname.toLowerCase();
  if (LOOPBACK_OR_PRIVATE.test(host)) return { ok: false, reason: "endpoint_private_host" };

  if (appOrigin) {
    try {
      if (new URL(appOrigin).hostname.toLowerCase() === host) {
        return { ok: false, reason: "endpoint_same_origin" };
      }
    } catch {
      // Unparseable app origin config - skip the same-origin comparison.
    }
  }

  const allowed =
    PUSH_HOST_EXACT.has(host) || PUSH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
  if (!allowed) return { ok: false, reason: "endpoint_unknown_push_service" };

  return { ok: true, url };
}
