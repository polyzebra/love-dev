# Notifications: web today, native later

Documentation only - **no Capacitor packages are installed** and nothing in
this document is wired up. It records the agreed path so the web codebase
stays clean now and the native shell lands without archaeology later.

## Where the line is drawn today (web)

- Web Push (VAPID + service worker) is the only notification transport the
  web app manages: subscription registry, payload dispatch, quiet hours,
  presence suppression, click routing (`public/sw.js`,
  `src/lib/services/push.ts`, `src/lib/services/notify.ts`).
- Sound and vibration for a displayed push notification are the OS's /
  browser's decision. The payload carries no `silent` or vibration hints and
  the web UI offers no sound/haptic notification preferences.
- `src/lib/notifications/platform.ts` is the seam:
  `getPlatformNotificationCapabilities()` reports
  `{ platform: "web", pushSupported, notificationSoundsConfigurable: false, hapticsConfigurable: false }`.
  Product code gates on this shape, never on "is this iOS" checks of its own.
- `UserSettings.inAppSounds` / `UserSettings.inAppVibrations` are **native-only
  columns**: kept in the database and accepted by `settingsPatchSchema`
  (`src/lib/services/settings.ts`) for a future native client, but never
  rendered or written by the web UI.

## Future Capacitor path

When a native shell is built, the plan is:

1. **Packages** (none installed today):
   - `@capacitor/core` + platform projects (`@capacitor/ios`, `@capacitor/android`)
   - `@capacitor/push-notifications` for APNs/FCM tokens and notification events
   - `@capacitor/haptics` for real haptic feedback
2. **Platform detection**: reimplement `getPlatformNotificationCapabilities()`
   to return `platform: "ios" | "android"` (via `Capacitor.getPlatform()`),
   `pushSupported: true`, and `notificationSoundsConfigurable` /
   `hapticsConfigurable: true`. Everything currently gated on those flags
   (settings UI, copy) lights up without further changes.
3. **Token registration**: on `PushNotifications.register()`, POST the APNs/FCM
   token to a new native-token endpoint alongside the existing web-push
   subscription registry (same `PushSubscription`-style bookkeeping: per-device
   rows, revocation, failure counts). Server-side delivery adds an APNs/FCM
   transport next to the `web-push` transport behind the same
   `sendPushToUser` fan-out.
4. **Permission flow**: `PushNotifications.checkPermissions()` /
   `requestPermissions()` replaces `Notification.requestPermission()`; the
   request still happens only on an explicit user tap, mirroring
   `src/components/settings/push-setup.tsx`.
5. **Settings deep link**: when permission is denied, open the OS notification
   settings for the app (App-Info intent on Android, `app-settings:` URL on
   iOS - e.g. via `@capacitor/app` or a tiny plugin) instead of the web copy
   that tells the user to dig through browser settings.
6. **In-app sounds/haptics**: surface `inAppSounds` / `inAppVibrations` in the
   native settings screen, persisted through the existing PATCH
   (`settingsPatchSchema` already accepts both), and honor them with native
   audio + `@capacitor/haptics` for in-app moments. The OS keeps owning
   sound/vibration for system notifications.
