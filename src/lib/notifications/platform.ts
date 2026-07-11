"use client";

import { detectCapabilities } from "@/lib/notifications/capabilities";

/**
 * Platform-level notification capabilities - the single place that
 * answers "what may THIS shell configure about notifications?".
 *
 * Web today: push is a runtime probe, but notification sounds and
 * haptics are never configurable in-app - the OS/browser owns both for
 * displayed notifications. A future native (Capacitor) shell replaces
 * this implementation to report 'ios'/'android' with configurable
 * sounds/haptics backed by real native APIs - product code keeps
 * consuming the same shape. See docs/NOTIFICATIONS-NATIVE.md.
 *
 * Client-only: call from effects or event handlers, never during SSR.
 */
export type PlatformNotificationCapabilities = {
  platform: "web" | "ios" | "android";
  /** The current shell can deliver push (on web: SW + PushManager + Notification). */
  pushSupported: boolean;
  /** The app may offer an in-app "notification sounds" preference. Never on web. */
  notificationSoundsConfigurable: boolean;
  /** The app may offer an in-app haptics preference. Never on web. */
  hapticsConfigurable: boolean;
};

export function getPlatformNotificationCapabilities(): PlatformNotificationCapabilities {
  const caps = detectCapabilities();
  return {
    platform: "web",
    pushSupported: caps.serviceWorker && caps.pushManager && caps.notificationsApi,
    notificationSoundsConfigurable: false,
    hapticsConfigurable: false,
  };
}
