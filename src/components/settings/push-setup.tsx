"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BellOff,
  BellRing,
  CircleCheck,
  Loader2,
  MonitorSmartphone,
  RefreshCw,
  Send,
  Share,
  SquarePlus,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  detectCapabilities,
  type NotificationCapabilities,
} from "@/lib/notifications/capabilities";
import {
  getPlatformNotificationCapabilities,
  type PlatformNotificationCapabilities,
} from "@/lib/notifications/platform";
import {
  fetchPushStatus,
  getLocalSubscription,
  sendTestPush,
  subscribeToPush,
  unsubscribeFromPush,
  type PushStatus,
  type PushTestResult,
} from "@/lib/notifications/push";
import { formatRelativeTime } from "@/lib/utils";

/**
 * Device-level push setup. Every state below is derived from real
 * probes (capabilities + permission + local subscription + server
 * status) - the card never claims a delivery path that does not exist.
 */
type SetupState =
  | "loading"
  | "ios-install" // iOS Safari tab: push exists only after Home Screen install
  | "unsupported" // browser has no SW/Push/Notification stack
  | "blocked" // permission denied at the OS/browser level
  | "enabled" // active local subscription, verified against the server
  | "reconnect" // permission granted but this browser lost its subscription
  | "setup-required"; // ready - waiting for the user's explicit opt-in

const IOS_STEPS = [
  { icon: Share, text: "Tap the Share button in Safari's toolbar." },
  { icon: SquarePlus, text: "Choose “Add to Home Screen” and confirm." },
  { icon: MonitorSmartphone, text: "Open Tirvea from the new Home Screen icon." },
  { icon: BellRing, text: "Return here and tap “Enable push notifications”." },
] as const;

export function PushSetup() {
  const [caps, setCaps] = useState<NotificationCapabilities | null>(null);
  const [platformCaps, setPlatformCaps] = useState<PlatformNotificationCapabilities | null>(null);
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [hasLocalSub, setHasLocalSub] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResults, setTestResults] = useState<PushTestResult[] | null>(null);

  const refresh = useCallback(async () => {
    const nextCaps = detectCapabilities();
    const nextPlatform = getPlatformNotificationCapabilities();
    const [nextStatus, sub] = await Promise.all([fetchPushStatus(), getLocalSubscription()]);
    setCaps(nextCaps);
    setPlatformCaps(nextPlatform);
    setStatus(nextStatus);
    setHasLocalSub(Boolean(sub));
    setStatusLoaded(true);
  }, []);

  // Mount probe: state is only committed inside the async callback,
  // never synchronously in the effect body.
  useEffect(() => {
    let cancelled = false;
    const nextCaps = detectCapabilities();
    const nextPlatform = getPlatformNotificationCapabilities();
    void Promise.all([fetchPushStatus(), getLocalSubscription()]).then(([nextStatus, sub]) => {
      if (cancelled) return;
      setCaps(nextCaps);
      setPlatformCaps(nextPlatform);
      setStatus(nextStatus);
      setHasLocalSub(Boolean(sub));
      setStatusLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const configured = status?.configured === true;
  const vapidKey = status?.vapidPublicKey ?? process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null;
  const devices = status?.devices ?? [];

  let state: SetupState = "loading";
  if (caps && platformCaps && statusLoaded) {
    if (caps.ios && !caps.installedPwa) state = "ios-install";
    else if (!platformCaps.pushSupported) state = "unsupported";
    else if (caps.permission === "denied") state = "blocked";
    else if (hasLocalSub) state = "enabled";
    else if (caps.permission === "granted" && configured && devices.length > 0) state = "reconnect";
    else state = "setup-required";
  }

  /** Permission is requested here and ONLY here - on the user's click. */
  async function enable() {
    if (!vapidKey) return;
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      setCaps(detectCapabilities());
      if (permission !== "granted") {
        if (permission === "denied") {
          toast.error("Notifications are blocked in device settings.");
        }
        return;
      }
      await subscribeToPush(vapidKey);
      setHasLocalSub(true);
      toast.success("Push notifications are on for this device.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not enable push notifications.");
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  async function disable() {
    setBusy(true);
    try {
      await unsubscribeFromPush();
      setHasLocalSub(false);
      setTestResults(null);
      toast("Push is off on this device.");
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  async function runTest() {
    setTesting(true);
    setTestResults(null);
    try {
      const results = await sendTestPush();
      setTestResults(results);
      const failed = results.filter((r) => !r.ok).length;
      if (results.length === 0) toast("No devices are subscribed yet.");
      else if (failed === 0) toast.success("Test sent to every device.");
      else
        toast.error(
          `${failed} of ${results.length} device${results.length === 1 ? "" : "s"} failed.`,
        );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The test could not be sent.");
    } finally {
      setTesting(false);
    }
  }

  return (
    <section aria-label="Push on this device" className="mb-8">
      <h2 className="text-muted-foreground mb-2 px-1 text-sm font-semibold tracking-wide uppercase">
        This device
      </h2>

      {/* Honest server banner - VAPID not configured means nothing below can deliver */}
      {statusLoaded && !configured && state !== "ios-install" && state !== "unsupported" && (
        <div className="border-destructive/30 bg-destructive/10 mb-3 flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm">
          <TriangleAlert className="text-destructive mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p className="text-foreground/90">
            Push is not configured on the server yet. Your preferences below are saved and will
            apply once it is.
          </p>
        </div>
      )}

      <div className="glass rounded-3xl px-5 py-5">
        {state === "loading" && (
          <div className="text-muted-foreground flex items-center gap-3 text-sm">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Checking this device…
          </div>
        )}

        {state === "ios-install" && (
          <div>
            <p className="font-medium">Add Tirvea to your Home Screen first</p>
            <p className="text-muted-foreground mt-1 text-sm">
              On iPhone and iPad, Apple only allows push notifications for apps installed on the
              Home Screen.
            </p>
            <ol className="mt-4 space-y-3">
              {IOS_STEPS.map(({ icon: Icon, text }, i) => (
                <li key={text} className="flex items-center gap-3 text-sm">
                  <span className="bg-accent flex size-8 shrink-0 items-center justify-center rounded-xl">
                    <Icon className="text-accent-foreground size-4" aria-hidden="true" />
                  </span>
                  <span>
                    <span className="text-muted-foreground mr-1.5 font-medium">{i + 1}.</span>
                    {text}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {state === "unsupported" && (
          <div className="flex items-start gap-3">
            <BellOff className="text-muted-foreground mt-0.5 size-5 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-medium">This browser can&apos;t receive push notifications</p>
              <p className="text-muted-foreground mt-1 text-sm">
                Open Tirvea in a current version of Chrome, Edge, Firefox or Safari to get notified
                when the app is closed.
              </p>
            </div>
          </div>
        )}

        {state === "blocked" && (
          <div className="flex items-start gap-3">
            <BellOff className="text-destructive mt-0.5 size-5 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-medium">Notifications are blocked in device settings.</p>
              <p className="text-muted-foreground mt-1 text-sm">
                Allow notifications for Tirvea in your browser or system settings, then come back
                here.
              </p>
            </div>
          </div>
        )}

        {state === "setup-required" && (
          <div>
            <div className="flex items-start gap-3">
              <BellRing className="text-primary-soft mt-0.5 size-5 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-medium">Get notified when the app is closed</p>
                <p className="text-muted-foreground mt-1 text-sm">
                  Your browser will ask for permission - nothing is sent until you allow it.
                </p>
              </div>
            </div>
            <Button
              className="mt-4 w-full"
              onClick={() => void enable()}
              disabled={busy || !configured || !vapidKey}
            >
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Enable push notifications
            </Button>
          </div>
        )}

        {state === "reconnect" && (
          <div>
            <div className="flex items-start gap-3">
              <RefreshCw className="text-gold mt-0.5 size-5 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-medium">This device needs to reconnect</p>
                <p className="text-muted-foreground mt-1 text-sm">
                  Permission is granted, but this browser&apos;s push connection was lost. Reconnect
                  to keep receiving notifications here.
                </p>
              </div>
            </div>
            <Button
              className="mt-4 w-full"
              onClick={() => void enable()}
              disabled={busy || !vapidKey}
            >
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Reconnect this device
            </Button>
          </div>
        )}

        {state === "enabled" && (
          <div>
            <div className="flex items-start gap-3">
              <CircleCheck className="text-success mt-0.5 size-5 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-medium">Push is on for this device</p>
                {/* On platforms where the app can't configure notification
                    sounds/haptics itself (all of web), say so honestly. */}
                {platformCaps &&
                  !platformCaps.notificationSoundsConfigurable &&
                  !platformCaps.hapticsConfigurable && (
                    <p className="text-muted-foreground mt-1 text-sm">
                      Delivery, sound and vibration outside the app follow your device&apos;s
                      notification settings.
                    </p>
                  )}
              </div>
            </div>

            {devices.length > 0 && (
              <ul className="mt-4 space-y-2" aria-label="Subscribed devices">
                {devices.map((d) => (
                  <li
                    key={d.id}
                    className="border-border flex items-center gap-3 rounded-2xl border px-3.5 py-2.5 text-sm"
                  >
                    <MonitorSmartphone
                      className="text-muted-foreground size-4 shrink-0"
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">
                        {d.deviceLabel ??
                          ([d.browser, d.platform].filter(Boolean).join(" · ") || "Device")}
                      </span>
                      <span className="text-muted-foreground block truncate text-xs">
                        {d.lastSuccessAt
                          ? `Last delivered ${formatRelativeTime(d.lastSuccessAt)}`
                          : "Nothing delivered yet"}
                        {" · "}
                        {d.endpoint}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => void runTest()}
                disabled={testing}
              >
                {testing ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Send className="size-4" aria-hidden="true" />
                )}
                Send test notification
              </Button>
              <Button
                variant="ghost"
                className="flex-1"
                onClick={() => void disable()}
                disabled={busy}
              >
                Turn off on this device
              </Button>
            </div>

            {testResults && (
              <ul className="mt-3 space-y-1.5" aria-label="Test results">
                {testResults.length === 0 && (
                  <li className="text-muted-foreground text-sm">No subscribed devices to test.</li>
                )}
                {testResults.map((r, i) => (
                  <li key={`${r.device}-${i}`} className="flex items-center gap-2 text-sm">
                    {r.ok ? (
                      <CircleCheck className="text-success size-4 shrink-0" aria-hidden="true" />
                    ) : (
                      <TriangleAlert
                        className="text-destructive size-4 shrink-0"
                        aria-hidden="true"
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate">
                      {r.device}
                      {!r.ok && r.error ? (
                        <span className="text-muted-foreground"> - {r.error}</span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
