"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * THE in-place upgrade CTA for members who already hold a live
 * subscription - the sibling of CheckoutButton with the same calm
 * contract, but for /api/billing/change-plan: no Stripe redirect, the
 * existing subscription is updated in place (same customer, same billing
 * cycle, prorated) and the page re-renders with the new plan.
 *
 * Contract (see /api/billing/change-plan):
 *  - click -> POST { plan } -> 200 -> success toast + router.refresh();
 *    the server components re-read the persisted, Stripe-verified plan
 *  - 401   -> signed out: /login with a same-origin callbackUrl
 *  - 409   -> honest inline message (past-due, stale UI, downgrade) and a
 *             refresh so the page reflects the real state
 *  - errors-> restore the CTA, calm INLINE message, retry always allowed
 *
 * Size stability: both labels are always rendered, stacked in one grid
 * cell, the inactive one `invisible` - identical to CheckoutButton, so
 * toggling the loading state can never shift layout.
 */
export function UpgradePlanButton({
  plan,
  label,
  className,
  errorClassName,
}: {
  plan: "PLUS" | "GOLD";
  /** Visible CTA text; defaults to "Upgrade to Tirvea Plus/Gold". */
  label?: string;
  className?: string;
  errorClassName?: string;
}) {
  const planName = plan === "PLUS" ? "Tirvea Plus" : "Tirvea Gold";
  const ctaLabel = label ?? `Upgrade to ${planName}`;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upgrade() {
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/billing/change-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });

      if (res.status === 401) {
        const here = `${window.location.pathname}${window.location.search}`;
        window.location.assign(`/login?callbackUrl=${encodeURIComponent(here)}`);
        return; // stay busy while the browser navigates
      }

      const payload = (await res.json().catch(() => null)) as {
        data?: { plan?: string };
        error?: { message?: string };
      } | null;

      if (res.ok) {
        toast(`Welcome to ${planName}. Your upgrade is active now.`);
        router.refresh(); // hero + upgrade cards re-render from the DB
        return; // section unmounts with the refresh; no CTA to restore
      }

      setBusy(false);
      setError(
        payload?.error?.message ??
          "We couldn't change your plan. Nothing was charged - please try again.",
      );
      if (res.status === 409) {
        // The UI that offered this upgrade may be stale (plan changed in
        // another tab / in the portal) - re-render the real state under
        // the inline message.
        router.refresh();
      }
    } catch {
      setBusy(false);
      setError("We couldn't reach Tirvea. Check your connection and try again.");
    }
  }

  return (
    <div className="inline-flex max-w-full flex-col items-center gap-3">
      <Button
        type="button"
        onClick={upgrade}
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
            Upgrading your plan...
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