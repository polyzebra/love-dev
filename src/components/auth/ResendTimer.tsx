"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

/**
 * The "Resend code" line under an OTP field. Mounts already cooling
 * down (a code was just sent), counts down, then offers a quiet link;
 * every use re-enters the cooldown. The countdown is SERVER-authoritative:
 * `initialSeconds` carries the send response's retryAfter, and each
 * resend's resolved retryAfter restarts the timer (30s fallback when the
 * server value is missing). After 5 sends we stop offering - hammering
 * the provider never reads the user's inbox for them.
 */

const FALLBACK_COOLDOWN_SECONDS = 30;
const MAX_RESENDS = 5;

export function ResendTimer({
  onResend,
  disabled = false,
  initialSeconds,
}: {
  /**
   * Re-sends the code; resolve when the request settles. Resolve the
   * server's retryAfter (seconds) to start the next countdown from it.
   */
  onResend: () => Promise<number | void> | number | void;
  disabled?: boolean;
  /** Server retryAfter for the send that led here; null/undefined -> 30s. */
  initialSeconds?: number | null;
}) {
  const [secondsLeft, setSecondsLeft] = useState(FALLBACK_COOLDOWN_SECONDS);
  const [resends, setResends] = useState(0);
  const [sending, setSending] = useState(false);

  // The server value arrives hydration-safely after mount (sessionStorage
  // is client-only) - adopt it when it (first) appears, during render, per
  // React's adjust-state-on-prop-change pattern.
  const [adoptedInitial, setAdoptedInitial] = useState<number | null>(null);
  if (
    typeof initialSeconds === "number" &&
    initialSeconds > 0 &&
    adoptedInitial !== initialSeconds
  ) {
    setAdoptedInitial(initialSeconds);
    setSecondsLeft(Math.ceil(initialSeconds));
  }

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const t = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [secondsLeft]);

  async function resend() {
    if (sending || disabled) return;
    setSending(true);
    let retryAfter: number | void = undefined;
    try {
      retryAfter = await onResend();
    } finally {
      setSending(false);
      setResends((n) => n + 1);
      setSecondsLeft(
        typeof retryAfter === "number" && retryAfter > 0
          ? Math.ceil(retryAfter)
          : FALLBACK_COOLDOWN_SECONDS,
      );
    }
  }

  if (resends >= MAX_RESENDS) {
    return (
      <p className="text-center text-sm text-muted-foreground">
        Still nothing? Check your spam folder, or go back and re-enter your details.
      </p>
    );
  }

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;

  return (
    <p className="text-center text-sm text-muted-foreground" aria-live="polite">
      {secondsLeft > 0 ? (
        <>
          Resend code in{" "}
          <span className="tabular-nums">
            {minutes}:{String(seconds).padStart(2, "0")}
          </span>
        </>
      ) : (
        <button
          type="button"
          onClick={resend}
          disabled={sending || disabled}
          className="inline-flex items-center gap-1.5 rounded-sm font-medium text-primary-soft underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-foreground/20 disabled:opacity-50"
        >
          {sending && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
          Resend code
        </button>
      )}
    </p>
  );
}
