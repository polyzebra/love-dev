"use client";

/**
 * Service worker registration - one worker at /sw.js with root scope.
 * Safe to call repeatedly; the browser dedupes identical registrations.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    // Registration failing (private mode, storage pressure) must never
    // break the app - push setup will surface the state honestly.
    return null;
  }
}

/** The registration once it is active - or null where unsupported. */
export async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}
