"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Shared base for billing actions that mutate the subscription in place
 * and re-render the page (resume, retry payment) - the same calm CTA
 * contract as CheckoutButton/UpgradePlanButton:
 *
 *  - click -> POST endpoint -> success toast + router.refresh(); the
 *    server components re-read persisted, Stripe-verified state
 *  - 401   -> /login with a same-origin callbackUrl
 *  - 4xx   -> honest INLINE message (server-provided) + refresh so a
 *             stale page re-renders the real state
 *  - size stability: both labels always rendered, stacked in one grid
 *    cell, the inactive one `invisible` - loading never shifts layout
 */
export function BillingActionButton({
  endpoint,
  idleLabel,
  busyLabel,
  successToast,
  fallbackError,
  variant = "default",
  className,
  errorClassName,
}: {
  endpoint: string;
  idleLabel: string;
  busyLabel: string;
  successToast: string;
  fallbackError: string;
  variant?: "default" | "outline" | "secondary";
  className?: string;
  errorClassName?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const res = await fetch(endpoint, { method: "POST" });

      if (res.status === 401) {
        const here = `${window.location.pathname}${window.location.search}`;
        window.location.assign(`/login?callbackUrl=${encodeURIComponent(here)}`);
        return; // stay busy while the browser navigates
      }

      const payload = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;

      if (res.ok) {
        toast(successToast);
        router.refresh();
        setBusy(false);
        return;
      }

      setBusy(false);
      setError(payload?.error?.message ?? fallbackError);
      if (res.status === 409) {
        // Stale UI (state changed in another tab / the portal) - show the
        // real state under the inline message.
        router.refresh();
      }
    } catch {
      setBusy(false);
      setError("We couldn't reach Tirvea. Check your connection and try again.");
    }
  }

  return (
    <div className="inline-flex max-w-full flex-col items-start gap-2">
      <Button
        type="button"
        variant={variant}
        onClick={run}
        disabled={busy}
        aria-busy={busy}
        className={cn("min-h-11 max-w-full rounded-full", className)}
      >
        <span className="grid max-w-full place-items-center">
          <span
            aria-hidden={busy}
            className={cn(
              "col-start-1 row-start-1 inline-flex items-center gap-2 truncate",
              busy && "invisible",
            )}
          >
            {idleLabel}
          </span>
          <span
            aria-hidden={!busy}
            className={cn(
              "col-start-1 row-start-1 inline-flex items-center gap-2 truncate",
              !busy && "invisible",
            )}
          >
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            {busyLabel}
          </span>
        </span>
      </Button>
      <p
        role="status"
        aria-live="polite"
        className={cn(
          "text-muted-foreground max-w-xs text-sm",
          !error && "sr-only",
          errorClassName,
        )}
      >
        {error}
      </p>
    </div>
  );
}
