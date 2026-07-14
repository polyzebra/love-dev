"use client";

import { useEffect } from "react";

/**
 * Fires the explicit read-marking mutation once the notification list
 * has painted (Phase 0M - render stays a pure read, so the unread
 * styling the user sees reflects the pre-read state). Fire-and-forget:
 * a failed mark simply leaves rows unread for the next visit.
 */
export function MarkNotificationsRead() {
  useEffect(() => {
    try {
      void fetch("/api/notifications/read", { method: "POST" }).catch(() => undefined);
    } catch {
      // Never let bookkeeping break the page.
    }
  }, []);
  return null;
}
