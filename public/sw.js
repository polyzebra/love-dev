/*
 * Tirvea service worker - Web Push display + click routing only.
 * Plain JS, no build step, served from / so its scope covers the app.
 *
 * Payload contract (JSON): { title, body?, url?, notificationId?, tag?, silent? }
 */

/* Take over immediately so push works right after first registration. */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/** Safe JSON parse - a malformed payload must never kill the event. */
function parsePushData(event) {
  try {
    return event.data ? event.data.json() : {};
  } catch {
    return { body: event.data ? event.data.text() : undefined };
  }
}

/**
 * Only same-origin app paths may be opened from a notification.
 * Rejects absolute URLs, protocol-relative "//host" and anything
 * not starting with a single "/".
 */
function safePath(url) {
  if (typeof url !== "string") return "/discover";
  if (!url.startsWith("/") || url.startsWith("//")) return "/discover";
  return url;
}

self.addEventListener("push", (event) => {
  const data = parsePushData(event);
  const title = typeof data.title === "string" && data.title ? data.title : "Tirvea";

  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : undefined,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: typeof data.tag === "string" ? data.tag : undefined,
      renotify: false,
      silent: data.silent === true,
      data: {
        url: safePath(data.url),
        notificationId:
          typeof data.notificationId === "string" ? data.notificationId : undefined,
      },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const { url, notificationId } = event.notification.data || {};
  let target = safePath(url);
  // No dedicated mark-read endpoint exists yet - carry the id in the
  // query so the opened page can mark it read itself.
  if (notificationId) {
    target += (target.includes("?") ? "&" : "?") + "notificationId=" + encodeURIComponent(notificationId);
  }

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // Focus an existing app window when there is one.
      for (const client of clientList) {
        if (new URL(client.url).origin === self.location.origin && "focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(target);
            } catch {
              /* cross-process navigation can fail - focused is enough */
            }
          }
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});

self.addEventListener("notificationclose", () => {
  /* no-op by design - closing is not a signal we track */
});

/**
 * The push service rotated our subscription - re-subscribe with the same
 * applicationServerKey and tell the server, otherwise this device goes
 * silently deaf.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const oldKey =
        event.oldSubscription && event.oldSubscription.options
          ? event.oldSubscription.options.applicationServerKey
          : undefined;
      if (!oldKey) return;
      try {
        const subscription = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: oldKey,
        });
        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subscription: subscription.toJSON() }),
        });
      } catch {
        /* the next app open re-syncs via the settings page */
      }
    })(),
  );
});
