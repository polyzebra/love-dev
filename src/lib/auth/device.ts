import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { sha256Hash } from "@/lib/auth/audit";

/**
 * Privacy-safe device identity.
 *
 * PRIVACY STANCE: we deliberately do NOT fingerprint. No canvas, no fonts,
 * no audio context, no screen metrics, no third-party fingerprinting libs.
 * A device is identified by a random uuid we hand out ourselves in an
 * httpOnly cookie ('tirvea_did') plus a COARSE parse of the user agent
 * (browser family + OS only - buckets shared by millions of devices).
 * Clearing cookies makes the device a new device, and that is fine: the
 * cost of a false "new device" signal is one extra verification step,
 * never a lockout. Raw identifiers (the uuid, the full user agent) are
 * never persisted - only a salted SHA-256 hash, so the Device table can
 * correlate a user's own logins but cannot be joined across services.
 */

export const DEVICE_COOKIE = "tirvea_did";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export type ParsedUserAgent = { uaFamily: string; os: string };

/**
 * Tiny internal UA parser - intentionally coarse. Order matters: Edge and
 * Opera embed "Chrome/", Chrome embeds "Safari/", so most-specific first.
 */
export function parseUserAgent(userAgent: string | null): ParsedUserAgent {
  const ua = userAgent ?? "";
  let uaFamily = "other";
  if (/\bEdg(e|A|iOS)?\//.test(ua)) uaFamily = "edge";
  else if (/\b(OPR|Opera)\b/.test(ua)) uaFamily = "opera";
  else if (/\bSamsungBrowser\//.test(ua)) uaFamily = "samsung";
  else if (/\b(Firefox|FxiOS)\//.test(ua)) uaFamily = "firefox";
  else if (/\b(Chrome|CriOS)\//.test(ua)) uaFamily = "chrome";
  else if (/\bSafari\//.test(ua)) uaFamily = "safari";

  let os = "other";
  if (/iPhone|iPad|iPod/.test(ua)) os = "ios";
  else if (/Android/.test(ua)) os = "android";
  else if (/Windows NT/.test(ua)) os = "windows";
  else if (/Mac OS X/.test(ua)) os = "macos";
  else if (/Linux/.test(ua)) os = "linux";

  return { uaFamily, os };
}

/**
 * Stable device hash: salted sha256(did + uaFamily + os). Reuses the
 * auth audit salt so one env var governs all identifier hashing. The
 * hash rotates when the cookie rotates or the browser/OS bucket changes.
 */
export function deviceHashFor(did: string, userAgent: string | null): string {
  const { uaFamily, os } = parseUserAgent(userAgent);
  return sha256Hash(`device:${did}:${uaFamily}:${os}`);
}

/**
 * Read the device-id cookie, minting a new random uuid when absent.
 * Route-handler only: setting cookies requires a mutable cookie store
 * (Next 16 async `cookies()` in a Route Handler / Server Function).
 */
export async function ensureDeviceIdCookie(): Promise<{ did: string; created: boolean }> {
  const store = await cookies();
  const existing = store.get(DEVICE_COOKIE)?.value;
  // A did we minted is always a uuid - reject tampered/oversized values
  if (existing && /^[0-9a-f-]{36}$/i.test(existing)) {
    return { did: existing, created: false };
  }
  const did = randomUUID();
  store.set(DEVICE_COOKIE, did, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
  });
  return { did, created: true };
}

export type RegisterDeviceResult = {
  deviceHash: string;
  /** True when this (user, device) pair had never been seen before. */
  isNewDevice: boolean;
  /** Distinct devices ever seen for this user (after this registration). */
  deviceCount: number;
};

/**
 * Register the requesting device for a signed-in user and keep the User
 * risk columns in sync (lastDeviceHash + deviceCount = distinct devices).
 * Stores ONLY the salted hash as the fingerprint plus the coarse parsed
 * buckets - never the raw uuid, raw user agent or any raw IP.
 *
 * DB-only core: callers in route handlers should obtain `did` via
 * ensureDeviceIdCookie() (which also sets the cookie on the response).
 */
export async function registerDeviceCore(
  userId: string,
  did: string,
  userAgent: string | null,
): Promise<RegisterDeviceResult> {
  const fingerprint = deviceHashFor(did, userAgent);
  const { uaFamily, os } = parseUserAgent(userAgent);
  const now = new Date();

  const existing = await db.device.findUnique({
    where: { userId_fingerprint: { userId, fingerprint } },
    select: { id: true },
  });
  if (existing) {
    await db.device.update({
      where: { id: existing.id },
      data: { lastSeenAt: now, userAgent: uaFamily, platform: os },
    });
  } else {
    await db.device.create({
      data: { userId, fingerprint, userAgent: uaFamily, platform: os, lastSeenAt: now },
    });
  }

  const deviceCount = await db.device.count({ where: { userId } });
  await db.user.update({
    where: { id: userId },
    data: { lastDeviceHash: fingerprint, deviceCount },
  });

  // Ban evasion: a device hash snapshotted from a BANNED account opens a
  // SYSTEM moderation case for manual review (never a hard block - the
  // cookie-based hash can be a shared/household device; the verified-phone
  // blocklist is the hard signal). Best-effort: must not break a login.
  if (!existing) {
    try {
      const { flagDeviceBanEvasion } = await import("@/lib/services/trust-safety");
      await flagDeviceBanEvasion(userId, fingerprint);
    } catch (error) {
      console.warn(`[auth:device] ban-evasion check failed for ${userId}:`, error);
    }
  }

  return { deviceHash: fingerprint, isNewDevice: !existing, deviceCount };
}

/**
 * Route-handler entry point: cookie + registration in one call.
 * Never throws - device tracking must not break a login.
 */
export async function registerDevice(
  userId: string,
  req: Request,
): Promise<RegisterDeviceResult | null> {
  try {
    const { did } = await ensureDeviceIdCookie();
    return await registerDeviceCore(userId, did, req.headers.get("user-agent"));
  } catch (error) {
    console.error(`[auth:device] registration failed for ${userId}:`, error);
    return null;
  }
}
