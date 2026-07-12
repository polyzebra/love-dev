"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * "Manage billing" / "Change plan" - opens the Stripe billing portal for
 * the STORED customer (POST /api/billing/portal carries no body). Same
 * calm loading contract as CheckoutButton: size reserved via stacked
 * labels, aria-busy, inline error, retry allowed, no redirect on failure.
 */
export function ManageBillingButton({
  label = "Manage billing",
  variant = "outline",
  className,
}: {
  label?: string;
  variant?: "default" | "outline" | "secondary";
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const payload = (await res.json().catch(() => null)) as {
        data?: { url?: string };
        error?: { message?: string };
      } | null;
      if (res.ok && payload?.data?.url) {
        window.location.assign(payload.data.url);
        return; // stay busy while the browser navigates
      }
      setBusy(false);
      setError(
        payload?.error?.message ??
          "We couldn't open the billing portal. Please try again.",
      );
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
        onClick={open}
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
            {label}
          </span>
          <span
            aria-hidden={!busy}
            className={cn(
              "col-start-1 row-start-1 inline-flex items-center gap-2 truncate",
              !busy && "invisible",
            )}
          >
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Opening billing...
          </span>
        </span>
      </Button>
      <p
        role="status"
        aria-live="polite"
        className={cn("max-w-xs text-sm text-muted-foreground", !error && "sr-only")}
      >
        {error}
      </p>
    </div>
  );
}
