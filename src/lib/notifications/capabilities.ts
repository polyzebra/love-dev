"use client";

/**
 * Pure feature detection for the notification stack. Every field is a
 * real runtime probe - no capability is ever assumed from the UA alone
 * (the one exception is the iOS *identity* check, which is inherently a
 * platform question and uses a feature+UA hybrid).
 *
 * Client-only: call from effects or event handlers, never during SSR.
 */

export type NotificationPermissionState = NotificationPermission | "unsupported";

export type NotificationCapabilities = {
  /** `Notification` constructor exists (window-level API). */
  notificationsApi: boolean;
  /** Service workers are available (required for push). */
  serviceWorker: boolean;
  /** PushManager exists - actual Web Push support. */
  pushManager: boolean;
  /** Running as an installed app (display-mode: standalone / navigator.standalone). */
  installedPwa: boolean;
  /** iOS/iPadOS device - the platform where push requires Home Screen install. */
  ios: boolean;
  /** Current permission, or "unsupported" when Notification doesn't exist. */
  permission: NotificationPermissionState;
};

/** Installed check: display-mode media query plus Safari's legacy flag. */
function detectInstalledPwa(): boolean {
  if (typeof window === "undefined") return false;
  const standaloneQuery = window.matchMedia?.("(display-mode: standalone)")?.matches ?? false;
  // iOS Safari exposes navigator.standalone (true only when launched
  // from a Home Screen icon).
  const legacyStandalone =
    "standalone" in window.navigator &&
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standaloneQuery || legacyStandalone;
}

/**
 * iOS detection - feature-first hybrid. Modern iPads report a Mac UA, so
 * a pure UA sniff misses them; "Mac + touch points" catches that case.
 */
function detectIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  // iPadOS 13+ masquerades as macOS but is the only "Mac" with touch.
  return /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
}

export function detectCapabilities(): NotificationCapabilities {
  if (typeof window === "undefined") {
    return {
      notificationsApi: false,
      serviceWorker: false,
      pushManager: false,
      installedPwa: false,
      ios: false,
      permission: "unsupported",
    };
  }

  const notificationsApi = "Notification" in window;
  return {
    notificationsApi,
    serviceWorker: "serviceWorker" in navigator,
    pushManager: "PushManager" in window,
    installedPwa: detectInstalledPwa(),
    ios: detectIos(),
    permission: notificationsApi ? Notification.permission : "unsupported",
  };
}
