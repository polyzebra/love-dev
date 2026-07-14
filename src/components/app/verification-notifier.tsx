"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { Hourglass, X } from "lucide-react";
import type { VerificationUxState } from "@/lib/services/photo-verification";
import {
  ackKey,
  decideVerificationNotice,
  dismissKey,
  TOAST_COPY,
  watchKey,
} from "@/lib/verification-notice";

/**
 * Global photo-verification notices (banner + one-time outcome toasts).
 * Props arrive from the (app) layout's server render of the CANONICAL
 * state - this component never fetches, polls or keeps its own copy of
 * verification state. One-time semantics persist in localStorage keyed
 * by provider session id (the house client-state pattern), so a new
 * verification session automatically becomes eligible again.
 */
export function VerificationNotifier({
  state,
  sessionId,
}: {
  state: VerificationUxState | null;
  sessionId: string | null;
}) {
  const pathname = usePathname();
  // Storage is read in an effect (SSR-safe); until then nothing renders,
  // which also means zero hydration mismatch and zero layout shift on
  // pages where the banner will not show.
  const [decision, setDecision] = useState<{ showBanner: boolean } | null>(null);

  useEffect(() => {
    if (!state || !sessionId) {
      setDecision({ showBanner: false });
      return;
    }
    let watched = false;
    let acked = false;
    let dismissed = false;
    try {
      watched = localStorage.getItem(watchKey(sessionId)) === "1";
      acked = localStorage.getItem(ackKey(sessionId)) === "1";
      dismissed = sessionStorage.getItem(dismissKey(sessionId)) === "1";
    } catch {
      // Storage unavailable: banner still works, one-time falls back to
      // once-per-mount.
    }

    const d = decideVerificationNotice({ state, sessionId, pathname, watched, acked, dismissed });

    if (d.markWatched) {
      try {
        localStorage.setItem(watchKey(sessionId), "1");
      } catch {}
    }

    if (d.toast) {
      const copy = TOAST_COPY[d.toast];
      const kind = d.toast;
      try {
        localStorage.setItem(ackKey(sessionId), "1");
      } catch {}
      // queueMicrotask: on a full document load this effect can run BEFORE
      // the root layout's <Toaster> sibling subscribes (child effects flush
      // first), and sonner does not replay pre-subscription toasts. A
      // microtask lands after the whole commit's effects - no timers.
      queueMicrotask(() => {
        if (kind === "verified") {
          toast.success(copy.title, { description: copy.body, duration: 4000 });
        } else {
          toast(copy.title, { description: copy.body, duration: 5000 });
        }
      });
    }

    setDecision({ showBanner: d.showBanner });
  }, [state, sessionId, pathname]);

  if (!decision?.showBanner || !sessionId) return null;

  return (
    <div
      role="status"
      // Fixed overlay: zero layout shift, and it stays usable above
      // full-screen surfaces like the swipe deck (fixed z-30); safe-area
      // aware for notched devices.
      className="glass fixed inset-x-0 z-40 mx-auto flex w-[min(92%,28rem)] items-start gap-3 rounded-2xl p-4 shadow-lg"
      style={{
        top: "max(0.75rem, env(safe-area-inset-top))",
        borderColor: "color-mix(in srgb, var(--accent-foreground) 8%, transparent)",
      }}
    >
      <span className="glass-chip flex size-9 shrink-0 items-center justify-center rounded-full">
        <Hourglass className="text-gold size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Photo verification in progress</p>
        <p className="text-muted-foreground mt-0.5 text-sm">
          We&apos;ll update your verified badge automatically once the result arrives.{" "}
          <Link
            href="/profile#photo-verification"
            className="text-primary-soft font-medium underline-offset-2 hover:underline"
          >
            View status
          </Link>
        </p>
      </div>
      <button
        type="button"
        aria-label="Dismiss verification banner"
        className="text-muted-foreground hover:text-foreground focus-visible:ring-foreground/30 -m-1 rounded-full p-1 transition-colors outline-none focus-visible:ring-2"
        onClick={() => {
          try {
            sessionStorage.setItem(dismissKey(sessionId), "1");
          } catch {}
          setDecision({ showBanner: false });
        }}
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
