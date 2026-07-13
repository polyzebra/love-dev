"use client";

import { BillingActionButton } from "@/components/billing/billing-action-button";

/**
 * "Resume subscription" - clears the scheduled cancellation on the
 * user's EXISTING Stripe subscription (POST /api/billing/resume). No new
 * subscription, no checkout, no portal detour.
 */
export function ResumeSubscriptionButton({ className }: { className?: string }) {
  return (
    <BillingActionButton
      endpoint="/api/billing/resume"
      idleLabel="Resume subscription"
      busyLabel="Resuming..."
      successToast="Welcome back - your membership will continue."
      fallbackError="We couldn't resume your membership. Please try again."
      className={className}
    />
  );
}
