"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * THE upgrade CTA - every "Get Tirvea Plus/Gold" entry point renders this
 * one component so the checkout contract lives in exactly one place.
 *
 * Contract (see /api/billing/checkout):
 *  - click  -> POST { plan } -> 201 { data.url } -> window.location.assign(url)
 *  - 401    -> the visitor is signed out: send them to /login with a safe
 *              same-origin callbackUrl (the login page validates it) so
 *              they land back on this page after signing in
 *  - 409    -> already subscribed: open the billing portal instead
 *  - errors -> restore the CTA and show a calm INLINE message; retrying
 *              is always allowed and nothing redirects
 *
 * Size stability: BOTH labels ("Get Tirvea Plus" and the loading line)
 * are always rendered, stacked in the same grid cell, with the inactive
 * one invisible - the button's width and height are the max of the two
 * from first paint, so toggling the loading state can never shift layout.
 * No white pill, no skeleton: the gradient CTA itself is the indicator.
 */
export function CheckoutButton({
  plan,
  label,
  className,
  errorClassName,
}: {
  plan: "PLUS" | "GOLD";
  /** Visible CTA text; defaults to "Get Tirvea Plus/Gold". */
  label?: string;
  className?: string;
  errorClassName?: string;
}) {
  const planName = plan === "PLUS" ? "Tirvea Plus" : "Tirvea Gold";
  const ctaLabel = label ?? `Get ${planName}`;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });

      if (res.status === 401) {
        // Signed out: /login honors a same-origin callbackUrl (validated
        // server-side), so the visitor returns here to finish the upgrade.
        const here = `${window.location.pathname}${window.location.search}`;
        window.location.assign(`/login?callbackUrl=${encodeURIComponent(here)}`);
        return; // stay busy while the browser navigates
      }

      if (res.status === 409) {
        // Already subscribed - the right surface is the billing portal.
        toast(`You already have an active Tirvea membership - opening billing.`);
        const portal = await fetch("/api/billing/portal", { method: "POST" });
        const payload = (await portal.json().catch(() => null)) as {
          data?: { url?: string };
        } | null;
        if (portal.ok && payload?.data?.url) {
          window.location.assign(payload.data.url);
          return;
        }
        setBusy(false);
        setError(
          "You already have an active membership, but billing didn't open. You can manage it under Settings > Subscription.",
        );
        return;
      }

      const payload = (await res.json().catch(() => null)) as {
        data?: { url?: string };
        error?: { message?: string };
      } | null;

      if (res.ok && payload?.data?.url) {
        window.location.assign(payload.data.url);
        return; // stay busy while the browser navigates to Stripe
      }

      setBusy(false);
      setError(
        payload?.error?.message ??
          "We couldn't open checkout. Nothing was charged - please try again.",
      );
    } catch {
      setBusy(false);
      setError("We couldn't reach Tirvea. Check your connection and try again.");
    }
  }

  return (
    <div className="inline-flex max-w-full flex-col items-center gap-3">
      <Button
        type="button"
        onClick={start}
        disabled={busy}
        aria-busy={busy}
        className={cn("min-h-11 max-w-full", className)}
      >
        <span className="grid max-w-full place-items-center">
          <span
            aria-hidden={busy}
            className={cn(
              "col-start-1 row-start-1 inline-flex items-center gap-2 truncate",
              busy && "invisible",
            )}
          >
            {ctaLabel}
          </span>
          <span
            aria-hidden={!busy}
            className={cn(
              "col-start-1 row-start-1 inline-flex items-center gap-2 truncate",
              !busy && "invisible",
            )}
          >
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Opening secure checkout...
          </span>
        </span>
      </Button>
      <p
        role="status"
        aria-live="polite"
        className={cn(
          "max-w-xs text-sm text-muted-foreground",
          !error && "sr-only",
          errorClassName,
        )}
      >
        {error}
      </p>
    </div>
  );
}
