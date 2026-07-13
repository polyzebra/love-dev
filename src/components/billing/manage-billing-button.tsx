"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * "Manage billing" / "Update payment method" - opens the Stripe billing
 * portal for the STORED customer (POST /api/billing/portal; an optional
 * `flow` deep-links a specific portal flow). Same calm loading contract
 * as CheckoutButton: size reserved via stacked labels, aria-busy, inline
 * error, retry allowed, no redirect on failure.
 */
export function ManageBillingButton({
  label = "Manage billing",
  variant = "outline",
  flow,
  className,
}: {
  label?: string;
  variant?: "default" | "outline" | "secondary";
  /** Deep-link a portal flow (e.g. "payment_method_update"). */
  flow?: "payment_method_update";
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/portal", {
        method: "POST",
        ...(flow
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ flow }),
            }
          : {}),
      });
      const payload = (await res.json().catch(() => null)) as {
        data?: { url?: string };
        error?: { message?: string };
      } | null;
      if (res.ok && payload?.data?.url) {
        window.location.assign(payload.data.url);
        return; // stay busy while the browser navigates
      }
      setBusy(false);
      setError(payload?.error?.message ?? "We couldn't open the billing portal. Please try again.");
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
        className={cn("text-muted-foreground max-w-xs text-sm", !error && "sr-only")}
      >
        {error}
      </p>
    </div>
  );
}
