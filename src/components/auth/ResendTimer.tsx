"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

/**
 * The "Resend code" line under an OTP field. Mounts already cooling
 * down (a code was just sent), counts 30s, then offers a quiet link;
 * every use re-enters the cooldown. After 5 sends we stop offering -
 * hammering the provider never reads the user's inbox for them.
 */

const COOLDOWN_SECONDS = 30;
const MAX_RESENDS = 5;

export function ResendTimer({
  onResend,
  disabled = false,
}: {
  /** Re-sends the code; resolve when the request settles. */
  onResend: () => Promise<void> | void;
  disabled?: boolean;
}) {
  const [secondsLeft, setSecondsLeft] = useState(COOLDOWN_SECONDS);
  const [resends, setResends] = useState(0);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const t = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [secondsLeft]);

  async function resend() {
    if (sending || disabled) return;
    setSending(true);
    try {
      await onResend();
    } finally {
      setSending(false);
      setResends((n) => n + 1);
      setSecondsLeft(COOLDOWN_SECONDS);
    }
  }

  if (resends >= MAX_RESENDS) {
    return (
      <p className="text-center text-sm text-muted-foreground">
        Still nothing? Check your spam folder, or go back and re-enter your details.
      </p>
    );
  }

  return (
    <p className="text-center text-sm text-muted-foreground" aria-live="polite">
      {secondsLeft > 0 ? (
        <>
          Resend code in{" "}
          <span className="tabular-nums">
            0:{String(secondsLeft).padStart(2, "0")}
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
