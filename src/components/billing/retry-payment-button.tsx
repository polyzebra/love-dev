"use client";

import { BillingActionButton } from "@/components/billing/billing-action-button";

/**
 * "Retry payment" - asks Stripe to collect the open invoice with the
 * saved payment method (POST /api/billing/retry-payment). A declined
 * card answers an honest inline message pointing at the payment-method
 * update flow; nothing is retried behind the user's back.
 */
export function RetryPaymentButton({ className }: { className?: string }) {
  return (
    <BillingActionButton
      endpoint="/api/billing/retry-payment"
      idleLabel="Retry payment"
      busyLabel="Retrying payment..."
      successToast="Payment received - your membership is active again."
      fallbackError="We couldn't retry the payment. Please try again."
      variant="outline"
      className={className}
    />
  );
}
