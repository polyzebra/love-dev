"use client";

import { useEffect } from "react";
import { registerServiceWorker } from "@/lib/notifications/register";

/**
 * Registers /sw.js once when the signed-in app shell mounts. Renders
 * nothing - it exists so the (app) layout (a server component) can kick
 * off registration on the client.
 */
export function ServiceWorkerMount() {
  useEffect(() => {
    void registerServiceWorker();
  }, []);
  return null;
}
